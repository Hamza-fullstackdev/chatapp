import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { env } from '@/constants/env';
import { uploadsApi } from '@/lib/api';
import type { AttachmentDTO } from '@/types/api';

const SIGNED_URL_TTL = 55 * 60 * 1000; // server issues 1h URLs; keep a margin

const signedCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Resolve a private-storage attachment to a short-lived signed URL.
 * Results are cached until the server-side signing window approaches expiry.
 */
export async function getSignedUrl(storagePath: string | null | undefined): Promise<string | null> {
  if (!storagePath) return null;
  const hit = signedCache.get(storagePath);
  if (hit && hit.expiresAt > Date.now()) return hit.url;
  try {
    const { url } = await uploadsApi.downloadUrl(storagePath);
    signedCache.set(storagePath, { url, expiresAt: Date.now() + SIGNED_URL_TTL });
    return url;
  } catch {
    return null;
  }
}

export async function getAttachmentUrl(attachment: AttachmentDTO | null | undefined): Promise<string | null> {
  if (!attachment) return null;
  if (attachment.previewUrl || attachment.gifUrl) return attachment.previewUrl ?? attachment.gifUrl ?? null;
  return getSignedUrl(attachment.storagePath);
}

export interface LocalUploadSource {
  uri: string;
  contentType: string;
  fileName?: string;
  size?: number;
}

export interface UploadedAttachment {
  attachment: {
    type: string;
    storagePath: string;
    mimeType: string;
    size?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    provider?: string;
    providerId?: string;
    previewUrl?: string;
    gifUrl?: string;
  };
}

/**
 * Upload a local file to the private bucket via a signed URL and return the
 * attachment descriptor to attach to POST /api/messages.
 * The file bytes go straight from the device to Supabase Storage — the API
 * server only ever sees metadata.
 */
export async function uploadAsset(
  bucket: string,
  source: LocalUploadSource,
  meta: { width?: number; height?: number; durationMs?: number } = {},
): Promise<UploadedAttachment> {
  const target = await uploadsApi.sign({
    bucket,
    contentType: source.contentType,
    fileName: source.fileName,
    size: source.size,
  });

  const file = new File(source.uri);
  const result = await file.upload(target.uploadUrl, {
    httpMethod: 'PUT',
    uploadType: 0, // BINARY_CONTENT
    mimeType: source.contentType,
    headers: { 'Content-Type': source.contentType },
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (${result.status})`);
  }

  return {
    attachment: {
      ...target.attachment,
      width: meta.width,
      height: meta.height,
      durationMs: meta.durationMs,
    },
  };
}

export function mimeToMessageType(mimeType: string): string {
  if (mimeType.startsWith('image/')) {
    if (mimeType === 'image/gif') return 'gif';
    return 'image';
  }
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

export function fileNameFromUri(uri: string, fallback = 'file'): string {
  const cleaned = uri.split('?')[0] ?? uri;
  const parts = cleaned.split('/');
  const last = parts[parts.length - 1];
  return last && last.includes('.') ? last : fallback;
}

// ---------------------------------------------------------------------------
// Avatars (public avatars bucket — URLs render directly in <Avatar image>)
// ---------------------------------------------------------------------------

/** Turn a storage path (`avatars/...`) into a URL readable from any screen. */
export function publicStorageUrl(storagePath: string): string {
  return `${env.supabaseUrl}/storage/v1/object/public/${storagePath.replace(/^\/+/, '')}`;
}

/** Launch the system image picker in square-crop mode (profile photo). */
export async function pickAvatarImage(): Promise<LocalUploadSource | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0]!;
  return {
    uri: asset.uri,
    contentType: asset.mimeType ?? 'image/jpeg',
    fileName: fileNameFromUri(asset.uri),
  };
}

/** Upload a picked profile photo to the avatars bucket and return its public URL. */
export async function uploadAvatar(source: LocalUploadSource): Promise<string> {
  const { attachment } = await uploadAsset('avatars', source);
  return publicStorageUrl(attachment.storagePath);
}