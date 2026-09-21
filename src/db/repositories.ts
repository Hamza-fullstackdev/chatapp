import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  AttachmentDTO,
  CallDTO,
  ConversationDTO,
  ConversationDetailDTO,
  GroupDetailDTO,
  MessageDTO,
  ReactionDTO,
  UserDTO,
} from '@/types/api';

// ---------------------------------------------------------------------------
// Key-value metadata (sync cursor, flags)
// ---------------------------------------------------------------------------

export async function setKv(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)',
    key,
    value,
  );
}

export async function getKv(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_kv WHERE key = ?', key);
  return row?.value ?? null;
}

export async function deleteKv(db: SQLiteDatabase, key: string): Promise<void> {
  await db.runAsync('DELETE FROM app_kv WHERE key = ?', key);
}

const SYNC_CURSOR_KEY = 'sync.cursor';

export async function getSyncCursor(db: SQLiteDatabase): Promise<number> {
  const raw = await getKv(db, SYNC_CURSOR_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function setSyncCursor(db: SQLiteDatabase, cursor: number): Promise<void> {
  await setKv(db, SYNC_CURSOR_KEY, String(cursor));
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

type ConversationRow = {
  id: string;
  type: string;
  name: string | null;
  avatar_url: string | null;
  other_user_id: string | null;
  other_user_name: string | null;
  other_user_avatar_url: string | null;
  last_message_id: string | null;
  last_message_type: string | null;
  last_message_text: string | null;
  last_message_sender_id: string | null;
  last_message_created_at: string | null;
  last_message_status: string | null;
  last_message_has_attachments: number;
  unread_count: number;
  last_read_message_id: string | null;
  updated_at: string | null;
  member_count: number;
  is_group_admin: number;
};

function rowToConversation(row: ConversationRow): ConversationDTO {
  return {
    id: row.id,
    type: row.type === 'group' ? 'group' : 'private',
    name: row.name,
    avatarUrl: row.avatar_url,
    otherUserId: row.other_user_id,
    otherUserName: row.other_user_name,
    otherUserAvatarUrl: row.other_user_avatar_url,
    lastMessage: row.last_message_id
      ? {
          id: row.last_message_id,
          type: row.last_message_type ?? 'text',
          text: row.last_message_text,
          senderId: row.last_message_sender_id ?? '',
          status: row.last_message_status ?? 'sent',
          createdAt: row.last_message_created_at ?? '',
          hasAttachments: row.last_message_has_attachments === 1,
        }
      : null,
    unreadCount: row.unread_count,
    updatedAt: row.updated_at,
  };
}

export async function upsertConversation(db: SQLiteDatabase, c: ConversationDTO): Promise<void> {
  await db.runAsync(
    `INSERT INTO conversations (
      id, type, name, avatar_url, other_user_id, other_user_name, other_user_avatar_url,
      last_message_id, last_message_type, last_message_text, last_message_sender_id,
      last_message_status, last_message_created_at, last_message_has_attachments, unread_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      name = excluded.name,
      avatar_url = excluded.avatar_url,
      other_user_id = excluded.other_user_id,
      other_user_name = excluded.other_user_name,
      other_user_avatar_url = excluded.other_user_avatar_url,
      last_message_id = excluded.last_message_id,
      last_message_type = excluded.last_message_type,
      last_message_text = excluded.last_message_text,
      last_message_sender_id = excluded.last_message_sender_id,
      last_message_status = excluded.last_message_status,
      last_message_created_at = excluded.last_message_created_at,
      last_message_has_attachments = excluded.last_message_has_attachments,
      unread_count = excluded.unread_count,
      updated_at = excluded.updated_at`,
    c.id,
    c.type,
    c.name,
    c.avatarUrl,
    c.otherUserId,
    c.otherUserName,
    c.otherUserAvatarUrl,
    c.lastMessage?.id ?? null,
    c.lastMessage?.type ?? null,
    c.lastMessage?.text ?? null,
    c.lastMessage?.senderId ?? null,
    c.lastMessage?.status ?? null,
    c.lastMessage?.createdAt ?? null,
    c.lastMessage?.hasAttachments ? 1 : 0,
    c.unreadCount ?? 0,
    c.updatedAt,
  );
}

export async function deleteConversationsLocal(db: SQLiteDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(`DELETE FROM conversations WHERE id IN (${placeholders})`, ...ids);
}

export async function deleteMessagesLocal(db: SQLiteDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(`DELETE FROM messages WHERE id IN (${placeholders})`, ...ids);
}

/**
 * True unread count for a conversation: every incoming message newer than the
 * local read marker — or every incoming message when the user has never read
 * it. This is derived from the messages table rather than an incremented
 * counter, so duplicate deliveries of the same message (socket + pull, or the
 * insert/delivered changelog pair the server writes per message) can never
 * inflate the badge.
 */
async function computeUnreadCount(
  db: SQLiteDatabase,
  conversationId: string,
  currentUserId: string,
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n
     FROM messages m
     WHERE m.conversation_id = ?
       AND m.sender_id <> ?
       AND (
         (SELECT last_read_message_id FROM conversations WHERE id = ?) IS NULL
         OR m.created_at > (
           SELECT created_at FROM messages WHERE id =
             (SELECT last_read_message_id FROM conversations WHERE id = ?)
         )
       )`,
    conversationId,
    currentUserId,
    conversationId,
    conversationId,
  );
  return row?.n ?? 0;
}

export async function listConversations(db: SQLiteDatabase, currentUserId: string): Promise<ConversationDTO[]> {
  const rows = await db.getAllAsync<ConversationRow>(
    `SELECT
      c.id, c.type, c.name, c.avatar_url, c.other_user_id, c.other_user_name,
      c.other_user_avatar_url, c.last_message_id, c.last_message_type,
      c.last_message_text, c.last_message_sender_id, c.last_message_created_at,
      c.last_message_status, c.last_message_has_attachments, c.updated_at,
      c.member_count, c.is_group_admin,
      (
        SELECT COUNT(*) FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_id <> ?
          AND (
            c.last_read_message_id IS NULL
            OR m.created_at > (
              SELECT created_at FROM messages WHERE id = c.last_read_message_id
            )
          )
      ) AS unread_count
     FROM conversations c
     ORDER BY COALESCE(c.updated_at, c.last_message_created_at, '') DESC`,
    currentUserId,
  );
  return rows.map(rowToConversation);
}

export async function getConversation(db: SQLiteDatabase, id: string): Promise<ConversationDTO | null> {
  const row = await db.getFirstAsync<ConversationRow>(
    'SELECT * FROM conversations WHERE id = ?',
    id,
  );
  return row ? rowToConversation(row) : null;
}

export async function setConversationMeta(
  db: SQLiteDatabase,
  id: string,
  meta: { memberCount?: number; isGroupAdmin?: boolean },
): Promise<void> {
  if (meta.memberCount != null) {
    await db.runAsync('UPDATE conversations SET member_count = ? WHERE id = ?', meta.memberCount, id);
  }
  if (meta.isGroupAdmin != null) {
    await db.runAsync('UPDATE conversations SET is_group_admin = ? WHERE id = ?', meta.isGroupAdmin ? 1 : 0, id);
  }
}

export async function markConversationRead(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    `UPDATE conversations
     SET unread_count = 0,
         last_read_message_id = (
           SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1
         )
     WHERE id = ?`,
    id,
    id,
  );
}

export async function deleteConversation(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM conversations WHERE id = ?', id);
}

// ---------------------------------------------------------------------------
// Conversation members (offline group / member rendering)
// ---------------------------------------------------------------------------

export type StoredMember = {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  role: string;
  lastSeenAt: string | null;
};

export async function saveConversationMembers(
  db: SQLiteDatabase,
  conversationId: string,
  members: StoredMember[],
): Promise<void> {
  await db.runAsync('DELETE FROM conversation_members WHERE conversation_id = ?', conversationId);
  for (const m of members) {
    await db.runAsync(
      `INSERT OR REPLACE INTO conversation_members
        (conversation_id, user_id, name, username, avatar_url, role, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      conversationId,
      m.id,
      m.name,
      m.username,
      m.avatarUrl,
      m.role,
      m.lastSeenAt ?? null,
    );
  }
}

export async function listConversationMembers(
  db: SQLiteDatabase,
  conversationId: string,
): Promise<StoredMember[]> {
  const rows = await db.getAllAsync<{
    conversation_id: string;
    user_id: string;
    name: string | null;
    username: string | null;
    avatar_url: string | null;
    role: string | null;
    last_seen_at: string | null;
  }>(
    'SELECT * FROM conversation_members WHERE conversation_id = ? ORDER BY name COLLATE NOCASE ASC',
    conversationId,
  );
  return rows.map((r) => ({
    id: r.user_id,
    name: r.name ?? '',
    username: r.username ?? '',
    avatarUrl: r.avatar_url,
    role: r.role ?? 'member',
    lastSeenAt: r.last_seen_at,
  }));
}

/**
 * Rebuild a ConversationDetailDTO from the local store (members + conversation
 * row) so group info and header details render offline.
 */
export async function getCachedDetail(
  db: SQLiteDatabase,
  conversationId: string,
): Promise<ConversationDetailDTO | null> {
  const conversation = await getConversation(db, conversationId);
  if (!conversation) return null;
  const members = await listConversationMembers(db, conversationId);
  return { conversation, members, messages: [] };
}

/** Rebuild a GroupDetailDTO from the local store (name, admins, myRole). */
export async function getStoredGroupDetail(
  db: SQLiteDatabase,
  conversationId: string,
): Promise<GroupDetailDTO | null> {
  const row = await db.getFirstAsync<ConversationRow>(
    "SELECT * FROM conversations WHERE id = ? AND type = 'group'",
    conversationId,
  );
  if (!row) return null;
  const members = await listConversationMembers(db, conversationId);
  return {
    conversationId,
    name: row.name ?? 'Group',
    description: null,
    avatarUrl: row.avatar_url,
    memberIds: members.map((m) => m.id),
    admins: members.filter((m) => m.role === 'admin').map((m) => m.id),
    myRole: row.is_group_admin === 1 ? 'admin' : 'member',
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type MessageRow = {
  id: string;
  client_message_id: string | null;
  conversation_id: string;
  sender_id: string;
  type: string;
  text: string | null;
  reply_to: string | null;
  status: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  has_attachments: number;
};

type AttachmentRow = AttachmentDTO & { message_id: string };
type ReactionRow = ReactionDTO & { message_id: string };

function rowToMessage(row: MessageRow, attachments: AttachmentDTO[], reactions: ReactionDTO[]): MessageDTO {
  return {
    id: row.id,
    clientMessageId: row.client_message_id ?? row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    type: row.type,
    text: row.text,
    replyTo: row.reply_to,
    status: row.status,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    hasAttachments: row.has_attachments === 1,
    attachments,
    reactions,
  };
}

export async function upsertMessage(db: SQLiteDatabase, message: MessageDTO): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO messages (
      id, client_message_id, conversation_id, sender_id, type, text, reply_to,
      status, created_at, edited_at, deleted_at, has_attachments
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    message.id,
    message.clientMessageId,
    message.conversationId,
    message.senderId,
    message.type,
    message.text,
    message.replyTo,
    message.status,
    message.createdAt,
    message.editedAt,
    message.deletedAt,
    message.hasAttachments ? 1 : 0,
  );

  await db.runAsync('DELETE FROM message_attachments WHERE message_id = ?', message.id);
  for (const a of message.attachments ?? []) {
    await db.runAsync(
      `INSERT OR REPLACE INTO message_attachments (
        id, message_id, type, storage_path, mime_type, size, width, height,
        duration_ms, thumbnail_path, provider, provider_id, preview_url, gif_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.id,
      message.id,
      a.type,
      a.storagePath,
      a.mimeType,
      a.size ?? null,
      a.width ?? null,
      a.height ?? null,
      a.durationMs ?? null,
      a.thumbnailPath,
      a.provider,
      a.providerId,
      a.previewUrl,
      a.gifUrl,
    );
  }

  await db.runAsync('DELETE FROM message_reactions WHERE message_id = ?', message.id);
  for (const r of message.reactions ?? []) {
    await db.runAsync(
      `INSERT OR REPLACE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)`,
      message.id,
      r.userId,
      r.emoji,
    );
  }
}

export async function getMessageById(db: SQLiteDatabase, id: string): Promise<MessageDTO | null> {
  const row = await db.getFirstAsync<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
  if (!row) return null;
  return loadFullMessage(db, row);
}

async function loadFullMessage(db: SQLiteDatabase, row: MessageRow): Promise<MessageDTO> {
  const attachments = await db.getAllAsync<AttachmentRow>(
    'SELECT * FROM message_attachments WHERE message_id = ? ORDER BY rowid ASC',
    row.id,
  );
  const reactions = await db.getAllAsync<ReactionRow>(
    'SELECT * FROM message_reactions WHERE message_id = ? ORDER BY rowid ASC',
    row.id,
  );
  return rowToMessage(
    row,
    attachments.map(({ message_id: _m, ...rest }) => rest),
    reactions.map(({ message_id: _m, ...rest }) => rest),
  );
}

export async function listMessages(
  db: SQLiteDatabase,
  conversationId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<MessageDTO[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = opts.before
    ? await db.getAllAsync<MessageRow>(
        `SELECT * FROM messages
         WHERE conversation_id = ? AND created_at < ?
         ORDER BY created_at DESC LIMIT ?`,
        conversationId,
        opts.before,
        limit,
      )
    : await db.getAllAsync<MessageRow>(
        `SELECT * FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC LIMIT ?`,
        conversationId,
        limit,
      );

  const out: MessageDTO[] = [];
  for (const row of rows) {
    out.push(await loadFullMessage(db, row));
  }
  return out.reverse();
}

export async function listAllMessageIds(db: SQLiteDatabase, conversationId: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM messages WHERE conversation_id = ?',
    conversationId,
  );
  return rows.map((r) => r.id);
}

export async function deleteMessageRow(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM messages WHERE id = ?', id);
}

export async function clearConversationMessages(db: SQLiteDatabase, conversationId: string): Promise<void> {
  await db.runAsync('DELETE FROM messages WHERE conversation_id = ?', conversationId);
}

// ---------------------------------------------------------------------------
// Message status / reactions updates
// ---------------------------------------------------------------------------

export async function setMessageStatus(
  db: SQLiteDatabase,
  id: string,
  status: string,
): Promise<void> {
  await db.runAsync('UPDATE messages SET status = ? WHERE id = ?', status, id);
}

/**
 * Mark this sender's messages in a conversation as 'delivered' up to and
 * including `throughMessageId` (matching the server's flip boundary). Never
 * upgrades past delivered and never downgrades read/failed rows.
 */
export async function markMessagesDeliveredThrough(
  db: SQLiteDatabase,
  conversationId: string,
  senderId: string,
  throughMessageId: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE messages SET status = 'delivered'
     WHERE conversation_id = ? AND sender_id = ?
       AND status = 'sent'
       AND created_at <= (SELECT created_at FROM messages WHERE id = ?)`,
    conversationId,
    senderId,
    throughMessageId,
  );
}

/**
 * Mark this sender's messages in a conversation as 'read' up to and including
 * `throughMessageId`. Never downgrades already-read rows.
 */
export async function markMessagesReadThrough(
  db: SQLiteDatabase,
  conversationId: string,
  senderId: string,
  throughMessageId: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE messages SET status = 'read'
     WHERE conversation_id = ? AND sender_id = ?
       AND status IN ('sent', 'delivered')
       AND created_at <= (SELECT created_at FROM messages WHERE id = ?)`,
    conversationId,
    senderId,
    throughMessageId,
  );
}

export async function softDeleteMessage(
  db: SQLiteDatabase,
  id: string,
  deletedAt: string,
): Promise<void> {
  await db.runAsync('UPDATE messages SET deleted_at = ?, text = NULL WHERE id = ?', deletedAt, id);
}

export async function setMessageReactions(
  db: SQLiteDatabase,
  messageId: string,
  reactions: ReactionDTO[],
): Promise<void> {
  await db.runAsync('DELETE FROM message_reactions WHERE message_id = ?', messageId);
  for (const r of reactions) {
    await db.runAsync(
      'INSERT OR REPLACE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
      messageId,
      r.userId,
      r.emoji,
    );
  }
}

export async function toggleReactionLocal(
  db: SQLiteDatabase,
  messageId: string,
  userId: string,
  emoji: string,
): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    messageId,
    userId,
    emoji,
  );
  if ((row?.n ?? 0) > 0) {
    await db.runAsync(
      'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      messageId,
      userId,
      emoji,
    );
  } else {
    await db.runAsync(
      'INSERT OR REPLACE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
      messageId,
      userId,
      emoji,
    );
  }
}

export async function updateConversationInfo(
  db: SQLiteDatabase,
  id: string,
  info: { name?: string | null; avatarUrl?: string | null },
): Promise<void> {
  if (info.name !== undefined) {
    await db.runAsync('UPDATE conversations SET name = ? WHERE id = ?', info.name, id);
  }
  if (info.avatarUrl !== undefined) {
    await db.runAsync('UPDATE conversations SET avatar_url = ? WHERE id = ?', info.avatarUrl, id);
  }
}

// ---------------------------------------------------------------------------
// Pending operations (offline queue persisted in SQLite)
// ---------------------------------------------------------------------------

export interface PendingOpRow {
  op_id: string;
  operation: string;
  client_message_id: string | null;
  conversation_id: string | null;
  payload: string | null;
  created_at: string;
}

export async function insertPendingOp(
  db: SQLiteDatabase,
  op: {
    opId: string;
    operation: string;
    clientMessageId?: string;
    conversationId?: string;
    payload?: Record<string, unknown>;
    createdAt: string;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO pending_ops (op_id, operation, client_message_id, conversation_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    op.opId,
    op.operation,
    op.clientMessageId ?? null,
    op.conversationId ?? null,
    op.payload ? JSON.stringify(op.payload) : null,
    op.createdAt,
  );
}

export async function listPendingOps(db: SQLiteDatabase): Promise<PendingOpRow[]> {
  return db.getAllAsync<PendingOpRow>('SELECT * FROM pending_ops ORDER BY created_at ASC');
}

export async function removePendingOps(db: SQLiteDatabase, opIds: string[]): Promise<void> {
  if (opIds.length === 0) return;
  const placeholders = opIds.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM pending_ops WHERE op_id IN (${placeholders})`, ...opIds);
}

export async function truncatePendingOps(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM pending_ops');
}

export async function countPendingOps(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pending_ops');
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Media cache (offline attachment bytes on disk, mirrored in SQLite)
// ---------------------------------------------------------------------------

export interface MediaCacheEntry {
  storageKey: string;
  attachmentId: string;
  messageId: string | null;
  conversationId: string | null;
  storagePath: string | null;
  mimeType: string | null;
  size: number;
  localUri: string;
  downloadedAt: string;
  savedToPhotos: boolean;
}

type MediaCacheRow = {
  storage_key: string;
  attachment_id: string;
  message_id: string | null;
  conversation_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size: number;
  local_uri: string;
  downloaded_at: string;
  saved_to_photos: number;
};

function rowToMediaCache(row: MediaCacheRow): MediaCacheEntry {
  return {
    storageKey: row.storage_key,
    attachmentId: row.attachment_id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    size: row.size,
    localUri: row.local_uri,
    downloadedAt: row.downloaded_at,
    savedToPhotos: row.saved_to_photos === 1,
  };
}

export async function upsertCachedMedia(db: SQLiteDatabase, entry: MediaCacheEntry): Promise<void> {
  await db.runAsync(
    `INSERT INTO media_cache (
      storage_key, attachment_id, message_id, conversation_id, storage_path,
      mime_type, size, local_uri, downloaded_at, saved_to_photos
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(storage_key) DO UPDATE SET
      attachment_id = excluded.attachment_id,
      message_id = excluded.message_id,
      conversation_id = excluded.conversation_id,
      storage_path = excluded.storage_path,
      mime_type = excluded.mime_type,
      size = excluded.size,
      local_uri = excluded.local_uri,
      downloaded_at = excluded.downloaded_at,
      saved_to_photos = media_cache.saved_to_photos OR excluded.saved_to_photos`,
    entry.storageKey,
    entry.attachmentId,
    entry.messageId,
    entry.conversationId,
    entry.storagePath,
    entry.mimeType,
    entry.size,
    entry.localUri,
    entry.downloadedAt,
    entry.savedToPhotos ? 1 : 0,
  );
}

/** Marks a cached file as exported to the device photo library (idempotent). */
export async function markMediaSavedToPhotos(db: SQLiteDatabase, storageKey: string): Promise<void> {
  await db.runAsync('UPDATE media_cache SET saved_to_photos = 1 WHERE storage_key = ?', storageKey);
}

export async function getCachedMedia(db: SQLiteDatabase, storageKey: string): Promise<MediaCacheEntry | null> {
  const row = await db.getFirstAsync<MediaCacheRow>(
    'SELECT * FROM media_cache WHERE storage_key = ?',
    storageKey,
  );
  return row ? rowToMediaCache(row) : null;
}

export async function getCachedMediaForAttachment(db: SQLiteDatabase, attachmentId: string): Promise<MediaCacheEntry | null> {
  const row = await db.getFirstAsync<MediaCacheRow>(
    'SELECT * FROM media_cache WHERE attachment_id = ? ORDER BY downloaded_at DESC LIMIT 1',
    attachmentId,
  );
  return row ? rowToMediaCache(row) : null;
}

export async function listCachedMedia(db: SQLiteDatabase): Promise<MediaCacheEntry[]> {
  const rows = await db.getAllAsync<MediaCacheRow>('SELECT * FROM media_cache ORDER BY downloaded_at DESC');
  return rows.map(rowToMediaCache);
}

export async function removeCachedMedia(db: SQLiteDatabase, storageKey: string): Promise<void> {
  await db.runAsync('DELETE FROM media_cache WHERE storage_key = ?', storageKey);
}

export async function removeCachedMediaByKeys(db: SQLiteDatabase, storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;
  const placeholders = storageKeys.map(() => '?').join(', ');
  await db.runAsync(`DELETE FROM media_cache WHERE storage_key IN (${placeholders})`, ...storageKeys);
}

export async function clearMediaCacheTable(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM media_cache');
}

export async function mediaCacheSize(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COALESCE(SUM(size), 0) AS n FROM media_cache');
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// User profiles (offline identity cache for senders / peers / group members)
// ---------------------------------------------------------------------------

type UserProfileRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  last_seen_at: string | null;
  updated_at: string;
};

export type StoredProfile = Pick<
  UserDTO,
  'id' | 'fullName' | 'username' | 'bio' | 'avatarUrl' | 'lastSeenAt'
>;

function rowToProfile(row: UserProfileRow): StoredProfile {
  return {
    id: row.id,
    fullName: row.full_name ?? '',
    username: row.username ?? '',
    bio: row.bio,
    avatarUrl: row.avatar_url,
    lastSeenAt: row.last_seen_at,
  };
}

export async function upsertUserProfile(
  db: SQLiteDatabase,
  profile: Partial<StoredProfile> & Pick<UserDTO, 'id'>,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO user_profiles (id, full_name, username, bio, avatar_url, last_seen_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       full_name = COALESCE(excluded.full_name, full_name),
       username = COALESCE(excluded.username, username),
       bio = COALESCE(excluded.bio, bio),
       avatar_url = COALESCE(excluded.avatar_url, avatar_url),
       last_seen_at = COALESCE(excluded.last_seen_at, last_seen_at),
       updated_at = excluded.updated_at`,
    profile.id,
    profile.fullName !== undefined ? profile.fullName : null,
    profile.username !== undefined ? profile.username : null,
    profile.bio !== undefined ? profile.bio : null,
    profile.avatarUrl !== undefined ? profile.avatarUrl : null,
    profile.lastSeenAt !== undefined ? profile.lastSeenAt : null,
    new Date().toISOString(),
  );
}

/**
 * Bulk-cache a full user list (e.g. contacts / directory responses) so the
 * Contacts tab and group member picker can render offline.
 */
export async function cacheUsers(db: SQLiteDatabase, users: UserDTO[]): Promise<void> {
  for (const u of users) {
    await upsertUserProfile(db, {
      id: u.id,
      fullName: u.fullName,
      username: u.username,
      bio: u.bio,
      avatarUrl: u.avatarUrl,
      lastSeenAt: u.lastSeenAt,
    });
  }
}

/**
 * Remember that a user was seen (message sender, presence update, peer) so an
 * offline lookup at least knows the id exists. Names/avatars are filled in
 * whenever a full profile is observed.
 */
export async function touchUserProfile(
  db: SQLiteDatabase,
  id: string,
  partial?: Partial<Pick<UserDTO, 'fullName' | 'username' | 'bio' | 'avatarUrl' | 'lastSeenAt'>>,
): Promise<void> {
  if (!id) return;
  await db.runAsync(
    `INSERT INTO user_profiles (id, full_name, username, bio, avatar_url, last_seen_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       full_name = COALESCE(excluded.full_name, full_name),
       username = COALESCE(excluded.username, username),
       bio = COALESCE(excluded.bio, bio),
       avatar_url = COALESCE(excluded.avatar_url, avatar_url),
       last_seen_at = COALESCE(excluded.last_seen_at, last_seen_at),
       updated_at = excluded.updated_at`,
    id,
    partial?.fullName ?? null,
    partial?.username ?? null,
    partial?.bio ?? null,
    partial?.avatarUrl ?? null,
    partial?.lastSeenAt ?? null,
    new Date().toISOString(),
  );
}

export async function getUserProfile(db: SQLiteDatabase, id: string): Promise<StoredProfile | null> {
  const row = await db.getFirstAsync<UserProfileRow>('SELECT * FROM user_profiles WHERE id = ?', id);
  return row ? rowToProfile(row) : null;
}

export async function listUserProfiles(
  db: SQLiteDatabase,
  ids: string[],
): Promise<Map<string, StoredProfile>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.getAllAsync<UserProfileRow>(
    `SELECT * FROM user_profiles WHERE id IN (${placeholders})`,
    ...ids,
  );
  const out = new Map<string, StoredProfile>();
  for (const row of rows) out.set(row.id, rowToProfile(row));
  return out;
}

/**
 * All known user profiles, optionally name-filtered. This is the offline
 * directory for the Contacts tab and group member picker.
 */
export async function listAllUserProfiles(
  db: SQLiteDatabase,
  search?: string,
): Promise<StoredProfile[]> {
  const q = search?.trim();
  const rows = q
    ? await db.getAllAsync<UserProfileRow>(
        `SELECT * FROM user_profiles
         WHERE full_name LIKE ? OR username LIKE ?
         ORDER BY full_name COLLATE NOCASE ASC`,
        `%${q}%`,
        `%${q}%`,
      )
    : await db.getAllAsync<UserProfileRow>(
        'SELECT * FROM user_profiles ORDER BY full_name COLLATE NOCASE ASC',
      );
  return rows.map(rowToProfile);
}

// ---------------------------------------------------------------------------
// Calls (offline call history)
// ---------------------------------------------------------------------------

type CallRow = {
  id: string;
  conversation_id: string | null;
  caller_id: string;
  callee_id: string;
  call_type: string;
  status: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
  peer_id: string;
  peer_name: string | null;
  peer_avatar_url: string | null;
  is_outgoing: number;
};

function rowToCall(row: CallRow): CallDTO {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    callType: row.call_type,
    status: row.status as CallDTO['status'],
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    peerId: row.peer_id,
    peerName: row.peer_name,
    peerAvatarUrl: row.peer_avatar_url,
    isOutgoing: row.is_outgoing === 1,
    online: false,
  };
}

export async function upsertCall(db: SQLiteDatabase, call: CallDTO): Promise<void> {
  await db.runAsync(
    `INSERT INTO calls (
      id, conversation_id, caller_id, callee_id, call_type, status, started_at,
      answered_at, ended_at, created_at, peer_id, peer_name, peer_avatar_url, is_outgoing
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      started_at = excluded.started_at,
      answered_at = excluded.answered_at,
      ended_at = excluded.ended_at,
      peer_name = excluded.peer_name,
      peer_avatar_url = excluded.peer_avatar_url`,
    call.id,
    call.conversationId,
    call.callerId,
    call.calleeId,
    call.callType,
    call.status,
    call.startedAt,
    call.answeredAt,
    call.endedAt,
    call.createdAt,
    call.peerId,
    call.peerName,
    call.peerAvatarUrl,
    call.isOutgoing ? 1 : 0,
  );
}

export async function listCalls(db: SQLiteDatabase, limit = 100): Promise<CallDTO[]> {
  const rows = await db.getAllAsync<CallRow>(
    'SELECT * FROM calls ORDER BY created_at DESC LIMIT ?',
    limit,
  );
  return rows.map(rowToCall);
}

export async function deleteCallsLocal(db: SQLiteDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(`DELETE FROM calls WHERE id IN (${placeholders})`, ...ids);
}

export async function clearCallsLocal(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM calls');
}

// ---------------------------------------------------------------------------
// Conversation cache refresh from a live message (socket / pull-sync)
// ---------------------------------------------------------------------------

function lastMessageFromMessage(message: MessageDTO) {
  return {
    id: message.id,
    type: message.type,
    text: message.text,
    senderId: message.senderId,
    status: message.status,
    createdAt: message.createdAt,
    hasAttachments: message.hasAttachments,
  };
}

/**
 * Keep the `conversations` cache row consistent with an incoming/outgoing
 * message that just arrived via socket or pull-sync. The row is created if it
 * does not exist yet (offline-first: a chat you have never opened still
 * appears in the Chats tab), its last-message preview is advanced only when
 * the new message is newer, and unread is **recomputed** from the messages
 * table against the local read marker — never incremented — so reapplying the
 * same message (socket + pull, insert/delivered changelog pairs) is
 * idempotent and can never double the badge.
 */
export async function refreshConversationFromMessage(
  db: SQLiteDatabase,
  message: MessageDTO,
  opts: { currentUserId: string; activeConversationId: string | null },
): Promise<void> {
  const existing = await db.getFirstAsync<ConversationRow>(
    'SELECT * FROM conversations WHERE id = ?',
    message.conversationId,
  );

  const last = lastMessageFromMessage(message);
  const incoming = message.senderId !== opts.currentUserId;
  const isActive = opts.activeConversationId === message.conversationId;

  // The chat is on screen: anything arriving is seen immediately, so roll the
  // local read marker forward and let the recompute report zero unread.
  if (existing && isActive) {
    await db.runAsync(
      `UPDATE conversations
       SET last_read_message_id = (
         SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1
       )
       WHERE id = ?`,
      message.conversationId,
      message.conversationId,
    );
  }

  const unread = await computeUnreadCount(db, message.conversationId, opts.currentUserId);

  if (!existing) {
    await db.runAsync(
      `INSERT INTO conversations (
        id, type, name, other_user_id, other_user_name, last_message_id,
        last_message_type, last_message_text, last_message_sender_id,
        last_message_status, last_message_created_at, last_message_has_attachments,
        unread_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      message.conversationId,
      'private',
      null,
      incoming ? message.senderId : null,
      null,
      last.id,
      last.type,
      last.text,
      last.senderId,
      last.status,
      last.createdAt,
      last.hasAttachments ? 1 : 0,
      unread,
      message.createdAt,
    );
    return;
  }

  const currentLastAt = existing.last_message_created_at;
  const isNewer = !currentLastAt || message.createdAt > currentLastAt;
  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (isNewer) {
    updates.push(
      'last_message_id = ?',
      'last_message_type = ?',
      'last_message_text = ?',
      'last_message_sender_id = ?',
      'last_message_status = ?',
      'last_message_created_at = ?',
      'last_message_has_attachments = ?',
    );
    params.push(last.id, last.type, last.text, last.senderId, last.status, last.createdAt, last.hasAttachments ? 1 : 0);
  }

  updates.push('updated_at = ?');
  params.push(message.createdAt > (currentLastAt ?? '') ? message.createdAt : new Date().toISOString());

  updates.push('unread_count = ?');
  params.push(unread);

  await db.runAsync(
    `UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`,
    ...params,
    message.conversationId,
  );
}

/**
 * Upgrade the cached last-message delivery status (sent → delivered → read)
 * so the Chats tab ticks reflect reality without a network round-trip.
 */
export async function markConversationLastMessageStatus(
  db: SQLiteDatabase,
  conversationId: string,
  messageId: string,
  status: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE conversations
     SET last_message_status = ?
     WHERE id = ? AND last_message_id = ?`,
    status,
    conversationId,
    messageId,
  );
}

/** Drop the cached last-message preview when that exact message was deleted. */
export async function clearConversationLastMessageIfMatch(
  db: SQLiteDatabase,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE conversations
     SET last_message_id = NULL,
         last_message_type = NULL,
         last_message_text = NULL,
         last_message_sender_id = NULL,
         last_message_status = NULL,
         last_message_created_at = NULL,
         last_message_has_attachments = 0
     WHERE id = ? AND last_message_id = ?`,
    conversationId,
    messageId,
  );
}