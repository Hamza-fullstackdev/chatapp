import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync as requestMediaLibraryPermissions } from 'expo-media-library';
import SaveToDownloads from '../../modules/save-to-downloads/src/SaveToDownloadsModule';
import { getDb } from '@/db/database';
import {
  getCachedMedia,
  getCachedMediaForAttachment,
  listMessages,
  markMediaSavedToPhotos,
  markMediaSavedToDevice,
  mediaCacheSize,
  removeCachedMedia,
  upsertCachedMedia,
  type MediaCacheEntry,
} from '@/db/repositories';
import { getSignedUrl } from '@/lib/media';
import { notifyLocalDb, useLocalDb } from '@/lib/local-db-events';
import type { AttachmentDTO } from '@/types/api';

const MEDIA_DIR = new Directory(Paths.document, 'media');

export function mediaDirectory(): Directory {
  if (!MEDIA_DIR.exists) MEDIA_DIR.create();
  return MEDIA_DIR;
}

/**
 * `File.uri` already carries the `file://` scheme, but older builds persisted
 * "file://file://…" values. Collapse any duplicated scheme so cached URIs are
 * always valid for expo-image / expo-audio / expo-video.
 */
export function toFileUri(uri: string): string {
  let out = uri;
  while (/^file:\/\/file:\/\//i.test(out)) {
    out = out.slice('file://'.length);
  }
  return out;
}

/** True when the URI points at a file that actually exists on this device. */
export function localFileExists(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    return new File(toFileUri(uri)).exists;
  } catch {
    return false;
  }
}

/** A stable cache key: the storage path when present, else the public URL, else the attachment id. */
export function mediaCacheKey(attachment: AttachmentDTO): string {
  return attachment.storagePath ?? attachment.previewUrl ?? attachment.gifUrl ?? attachment.id;
}

function extFor(attachment: AttachmentDTO): string {
  const mime = attachment.mimeType ?? '';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return '.mp3';
  if (mime === 'audio/mp4' || mime === 'audio/m4a') return '.m4a';
  if (mime.startsWith('image/')) return '.img';
  if (mime.startsWith('video/')) return '.mp4';
  if (mime.startsWith('audio/')) return '.m4a';
  return '.bin';
}

async function md5(input: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, input);
}

async function fileFor(attachment: AttachmentDTO): Promise<File> {
  const dir = mediaDirectory();
  const key = await md5(mediaCacheKey(attachment));
  return new File(dir, `${key}${extFor(attachment)}`);
}

export async function getCachedFile(attachment: AttachmentDTO): Promise<File | null> {
  const file = await fileFor(attachment);
  if (file.exists) return file;
  // In case a previous build named the file differently, fall back to the DB row.
  const db = await getDb();
  const entry = await getCachedMediaForAttachment(db, attachment.id);
  if (entry) {
    try {
      const existing = new File(toFileUri(entry.localUri));
      if (existing.exists) return existing;
    } catch {
      // Malformed stored path (e.g. legacy double scheme) — treat as missing.
    }
  }
  return null;
}

/** Local URI when the attachment bytes are already on disk — otherwise null. */
export async function getCachedUri(attachment: AttachmentDTO): Promise<string | null> {
  if (attachment.type === 'sticker') return attachment.previewUrl ?? attachment.gifUrl ?? null;
  const file = await getCachedFile(attachment);
  return file?.exists ? file.uri : null;
}

/**
 * Download (or reuse) an attachment's bytes into the persistent media
 * directory and mirror it in SQLite. Runs safely offline — a failed download
 * is swallowed and the caller falls back to the remote URL.
 *
 * Work is serialized through a small concurrency-limited queue so background
 * prewarming of whole conversations never starves the network or the UI, and
 * de-duplicated by storage key so a second request for a file already in
 * flight awaits the first download instead of re-downloading it.
 */
const inFlight = new Map<string, Promise<string | null>>();
const MAX_PARALLEL_DOWNLOADS = 3;
let activeDownloads = 0;

interface QueueItem {
  attachment: AttachmentDTO;
  meta: { messageId?: string; conversationId?: string };
  resolve: (uri: string | null) => void;
}

const downloadQueue: QueueItem[] = [];

async function runDownload(
  attachment: AttachmentDTO,
  meta: { messageId?: string; conversationId?: string },
): Promise<string | null> {
  try {
    const current = await getCachedFile(attachment);
    if (current) {
      await upsertCachedMedia(await getDb(), {
        storageKey: await md5(mediaCacheKey(attachment)),
        attachmentId: attachment.id,
        messageId: meta.messageId ?? null,
        conversationId: meta.conversationId ?? null,
        storagePath: attachment.storagePath,
        mimeType: attachment.mimeType,
        size: current.size,
        localUri: current.uri,
        downloadedAt: new Date().toISOString(),
        savedToPhotos: false,
        savedToDevice: false,
      });
      return current.uri;
    }

    const remote =
      attachment.previewUrl ?? attachment.gifUrl ?? (await getSignedUrl(attachment.storagePath));
    if (!remote) return null;

    const dest = await fileFor(attachment);
    const file = await File.downloadFileAsync(remote, dest, { idempotent: true });
    if (!file.exists) return null;

    await upsertCachedMedia(await getDb(), {
      storageKey: await md5(mediaCacheKey(attachment)),
      attachmentId: attachment.id,
      messageId: meta.messageId ?? null,
      conversationId: meta.conversationId ?? null,
      storagePath: attachment.storagePath,
      mimeType: attachment.mimeType,
      size: file.size,
      localUri: file.uri,
      downloadedAt: new Date().toISOString(),
      savedToPhotos: false,
      savedToDevice: false,
    });
    notifyLocalDb();
    return file.uri;
  } catch {
    return null;
  }
}

function pump(): void {
  while (activeDownloads < MAX_PARALLEL_DOWNLOADS && downloadQueue.length > 0) {
    const item = downloadQueue.shift();
    if (!item) break;
    const key = mediaCacheKey(item.attachment);
    activeDownloads += 1;
    void (async () => {
      try {
        item.resolve(await runDownload(item.attachment, item.meta));
      } finally {
        activeDownloads -= 1;
        inFlight.delete(key);
        pump();
      }
    })();
  }
}

export function downloadAttachment(
  attachment: AttachmentDTO,
  meta: { messageId?: string; conversationId?: string } = {},
): Promise<string | null> {
  if (attachment.type === 'sticker') {
    return Promise.resolve(attachment.previewUrl ?? attachment.gifUrl ?? null);
  }
  const key = mediaCacheKey(attachment);
  if (!key) return Promise.resolve(null);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = new Promise<string | null>((resolve) => {
    downloadQueue.push({ attachment, meta, resolve });
  });
  inFlight.set(key, task);
  pump();
  return task;
}

/** True while the attachment's bytes are queued or actively downloading. */
export function isMediaDownloading(attachment: AttachmentDTO): boolean {
  const key = mediaCacheKey(attachment);
  return !!key && inFlight.has(key);
}

/** Fire-and-forget download of every attachment on a message (auto-download on receive). */
export function prewarmMessageMedia(
  message: import('@/types/api').MessageDTO,
  currentUserId: string,
): void {
  for (const attachment of message.attachments ?? []) {
    void downloadAttachment(attachment, {
      messageId: message.id,
      conversationId: message.conversationId,
    });
  }
}

/**
 * Queue background downloads for every attachment in a set of messages so the
 * conversation re-opens instantly from the local cache (WhatsApp-style). The
 * queue de-duplicates work already in flight and skips files already on disk.
 */
export function prewarmConversationMedia(messages: import('@/types/api').MessageDTO[]): void {
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      void downloadAttachment(attachment, {
        messageId: message.id,
        conversationId: message.conversationId,
      });
    }
  }
}

/**
 * Prewarm media for the most recent messages of a set of conversations. Called
 * from the Chats tab so background downloads begin before a chat is even opened.
 */
export async function prewarmRecentConversations(conversations: { id: string }[], limit = 15): Promise<void> {
  const db = await getDb();
  for (const conversation of conversations.slice(0, 8)) {
    try {
      const rows = await listMessages(db, conversation.id, { limit });
      prewarmConversationMedia(rows);
    } catch {
      // A vanishing conversation row is not worth aborting the whole sweep.
    }
  }
}

// ---------------------------------------------------------------------------
// React hook — resolve the best renderable URI for an attachment
// ---------------------------------------------------------------------------

export type AttachmentSource =
  | { status: 'loading'; url: string | null }
  | { status: 'ready'; url: string | null; cached: boolean };

/**
 * Offline-first media resolution. Returns the local cached file URI when the
 * bytes are on disk; otherwise falls back to the remote (signed/public) URL
 * and downloads the bytes in the background so the next visit is instant and
 * fully offline.
 */
export function useAttachmentSource(attachment: AttachmentDTO | null | undefined): AttachmentSource {
  const [state, setState] = useState<AttachmentSource>({ status: 'loading', url: null });

  const resolve = async () => {
    try {
      if (!attachment) {
        setState({ status: 'ready', url: null, cached: false });
        return;
      }
      if (attachment.type === 'sticker') {
        setState({ status: 'ready', url: attachment.previewUrl ?? attachment.gifUrl ?? null, cached: false });
        return;
      }
      // A recorded/captured file only exists on the device that created it and
      // can be purged (app cache clear, media cleanup). Verify before trusting
      // the stored URI, otherwise fall through to the cache / remote paths.
      let candidate: AttachmentDTO = attachment;
      if (candidate.localUri && localFileExists(candidate.localUri)) {
        setState({ status: 'ready', url: toFileUri(candidate.localUri), cached: false });
        void downloadAttachment(candidate);
        return;
      }
      if (candidate.localUri) {
        // Stale local reference — drop it so the resolve path below can heal.
        candidate = { ...candidate, localUri: null };
      }
      const cached = await getCachedUri(candidate);
      if (cached) {
        setState({ status: 'ready', url: cached, cached: true });
        return;
      }
      const remote = candidate.previewUrl ?? candidate.gifUrl ?? null;
      if (remote) {
        setState({ status: 'ready', url: remote, cached: false });
        void downloadAttachment(candidate);
        return;
      }
      const signed = await getSignedUrl(candidate.storagePath);
      if (signed) {
        setState({ status: 'ready', url: signed, cached: false });
        void downloadAttachment(candidate);
        return;
      }
      setState({ status: 'ready', url: null, cached: false });
    } catch {
      setState({ status: 'ready', url: null, cached: false });
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void resolve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment?.id, attachment?.storagePath, attachment?.previewUrl, attachment?.gifUrl]);

  // When a background download finishes, hot-swap to the local file.
  useLocalDb(() => {
    if (!attachment || attachment.type === 'sticker') return;
    void (async () => {
      const cached = await getCachedUri(attachment);
      if (cached) setState({ status: 'ready', url: cached, cached: true });
    })();
  });

  return state;
}

export type MediaDownloadState = 'idle' | 'downloading' | 'downloaded';

/** Types the user can actually persist into the device photo library. */
function isGalleryShareable(attachment: AttachmentDTO): boolean {
  return attachment.type === 'image' || attachment.type === 'gif' || attachment.type === 'video';
}

/** True when the cached bytes were already exported to the device gallery. */
async function isSavedToPhotos(attachment: AttachmentDTO): Promise<boolean> {
  const db = await getDb();
  const entry = await getCachedMedia(db, await md5(mediaCacheKey(attachment)));
  return entry?.savedToPhotos === true;
}

/** True when the cached bytes were already copied into the Downloads folder. */
async function isSavedToDevice(attachment: AttachmentDTO): Promise<boolean> {
  const db = await getDb();
  const entry = await getCachedMedia(db, await md5(mediaCacheKey(attachment)));
  return entry?.savedToDevice === true;
}

/**
 * Best-effort original file name for the receiver's Downloads entry: the
 * explicit `fileName` when the sender forwarded one, else the storage object's
 * basename (the server stores it under `safeFileName(...)`), else a mime-ish
 * fallback.
 */
function displayFileName(attachment: AttachmentDTO): string {
  if (attachment.fileName?.trim()) return attachment.fileName.trim();
  const path = attachment.storagePath ?? '';
  const parts = path.split('/').filter(Boolean);
  const base = parts.length > 1 ? parts[parts.length - 1] : '';
  if (base) return base;
  return `document${extFor(attachment)}`;
}

/**
 * Copy a locally-cached file into the device's public Downloads folder
 * (Android "Downloads / Media Files"). Android 10+ writes through MediaStore
 * and needs no storage permission; Android 5–9 requests WRITE_EXTERNAL_STORAGE
 * at runtime. Marks the cache entry so the download chip never returns.
 */
async function saveToDownloadsFolder(localUri: string, attachment: AttachmentDTO): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Platform.Version < 29) {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return false;
    } catch {
      return false;
    }
  }
  try {
    await SaveToDownloads.saveToDownloads(toFileUri(localUri), displayFileName(attachment), attachment.mimeType);
    const db = await getDb();
    await markMediaSavedToDevice(db, await md5(mediaCacheKey(attachment)));
    notifyLocalDb();
    return true;
  } catch {
    return false;
  }
}

/**
 * Export a locally-cached file into the device photo library. Asks the user
 * for the media-library permission the first time (write-only, so no read
 * scope is granted). Returns false if denied or the export failed.
 */
async function saveToPhotoLibrary(localUri: string, storageKey: string): Promise<boolean> {
  try {
    const permission = await requestMediaLibraryPermissions(true);
    if (!permission.granted) return false;
    await Asset.create(toFileUri(localUri));
    const db = await getDb();
    await markMediaSavedToPhotos(db, storageKey);
    notifyLocalDb();
    return true;
  } catch {
    return false;
  }
}

/**
 * WhatsApp-style "Download": ensures the bytes live in the app's private
 * persistent cache (fast render on re-open) and then persists a copy where the
 * user expects it — documents go into the device Downloads/Media Files folder,
 * images/GIFs/videos into the device photo library via the storage permission
 * prompt. Audio files are considered downloaded once cached for offline playback.
 */
export async function downloadAndSaveToGallery(attachment: AttachmentDTO): Promise<boolean> {
  const uri = await downloadAttachment(attachment);
  if (!uri) return false;
  if (attachment.type === 'file') {
    return saveToDownloadsFolder(uri, attachment);
  }
  if (isGalleryShareable(attachment)) {
    return saveToPhotoLibrary(uri, await md5(mediaCacheKey(attachment)));
  }
  return true;
}

/**
 * Per-attachment download state for the manual download button on media
 * bubbles. The app auto-caches bytes in the background for fast rendering, so
 * for images/GIFs/videos the button stays visible until the user taps it to
 * save into the device gallery; audio/files are considered downloaded once
 * their bytes are on disk. `idle` shows the chip, `downloading` the spinner.
 */
export function useAttachmentDownloadState(
  attachment: AttachmentDTO | null | undefined,
): { state: MediaDownloadState; download: () => void } {
  const [state, setState] = useState<MediaDownloadState>('idle');

  const refresh = async () => {
    if (!attachment) {
      setState('idle');
      return;
    }
    if (attachment.type === 'sticker') {
      setState('downloaded');
      return;
    }
    if (attachment.type === 'audio') {
      const cached = await getCachedFile(attachment);
      setState(cached && cached.exists ? 'downloaded' : (isMediaDownloading(attachment) ? 'downloading' : 'idle'));
      return;
    }
    // file: downloaded only once the user exported it into the Downloads folder.
    if (attachment.type === 'file') {
      if (await isSavedToDevice(attachment)) {
        setState('downloaded');
        return;
      }
      setState(isMediaDownloading(attachment) ? 'downloading' : 'idle');
      return;
    }
    // image / gif / video: downloaded only when persisted to the gallery.
    if (await isSavedToPhotos(attachment)) {
      setState('downloaded');
      return;
    }
    if (isMediaDownloading(attachment)) {
      setState('downloading');
      return;
    }
    setState('idle');
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment?.id, attachment?.storagePath, attachment?.previewUrl, attachment?.gifUrl]);

  useLocalDb(() => {
    void refresh();
  });

  const download = useCallback(() => {
    if (!attachment) return;
    setState('downloading');
    void downloadAndSaveToGallery(attachment).then((saved) => {
      if (!saved) setState('idle');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment?.id, attachment?.storagePath, attachment?.previewUrl, attachment?.gifUrl]);

  return { state, download };
}

// ---------------------------------------------------------------------------
// Cache management / hygiene
// ---------------------------------------------------------------------------

export async function removeAttachmentCache(attachment: AttachmentDTO): Promise<void> {
  try {
    const file = await fileFor(attachment);
    if (file.exists) file.delete();
  } catch {
    // best effort
  }
  const db = await getDb();
  await removeCachedMedia(db, await md5(mediaCacheKey(attachment)));
  notifyLocalDb();
}

export async function getMediaCacheStats(): Promise<{ entries: number; bytes: number }> {
  const db = await getDb();
  const size = await mediaCacheSize(db);
  const rows = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM media_cache');
  return { entries: rows[0]?.n ?? 0, bytes: size };
}

export async function clearMediaCache(): Promise<void> {
  const db = await getDb();
  const dir = mediaDirectory();
  for (const child of dir.list()) {
    try {
      child.delete();
    } catch {
      // best effort
    }
  }
  await db.runAsync('DELETE FROM media_cache');
  notifyLocalDb();
}

export type { MediaCacheEntry };