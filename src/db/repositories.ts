import type { SQLiteDatabase } from 'expo-sqlite';
import type { AttachmentDTO, ConversationDTO, MessageDTO, ReactionDTO } from '@/types/api';

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
  last_message_has_attachments: number;
  unread_count: number;
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
      last_message_created_at, last_message_has_attachments, unread_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    c.lastMessage?.createdAt ?? null,
    c.lastMessage?.hasAttachments ? 1 : 0,
    c.unreadCount ?? 0,
    c.updatedAt,
  );
}

export async function listConversations(db: SQLiteDatabase): Promise<ConversationDTO[]> {
  const rows = await db.getAllAsync<ConversationRow>(
    `SELECT * FROM conversations ORDER BY COALESCE(updated_at, last_message_created_at, '') DESC`,
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
  await db.runAsync('UPDATE conversations SET unread_count = 0 WHERE id = ?', id);
}

export async function deleteConversation(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM conversations WHERE id = ?', id);
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

export async function setMessageDelivered(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    "UPDATE messages SET status = 'delivered' WHERE id = ? AND status NOT IN ('read', 'failed')",
    id,
  );
}

export async function setMessageReadStatus(
  db: SQLiteDatabase,
  conversationId: string,
  senderId: string,
  messageId: string,
): Promise<void> {
  await db.runAsync(
    "UPDATE messages SET status = 'read' WHERE conversation_id = ? AND sender_id = ? AND id = ?",
    conversationId,
    senderId,
    messageId,
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