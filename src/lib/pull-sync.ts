import { getDb } from '@/db/database';
import {
  deleteMessageRow,
  deleteStatusLocal,
  getSyncCursor,
  setMessageReactions,
  setSyncCursor,
  touchUserProfile,
  updateConversationInfo,
  upsertConversation,
  upsertMessage,
  upsertStatus,
  refreshConversationFromMessage,
  upsertUserProfile,
  cacheUsers,
  saveConversationMembers,
  setConversationMeta,
} from '@/db/repositories';
import { syncApi } from '@/lib/api';
import { prewarmMessageMedia } from '@/lib/media-cache';
import { getActiveConversationId } from '@/lib/active-conversation';
import { notifyLocalDb } from '@/lib/local-db-events';
import type { SyncChange } from '@/types/api';

/**
 * Pull the server changelog since the last synced cursor and apply every change
 * to the local SQLite store.
 *
 * Returns the number of applied changes so callers can decide whether to
 * re-read cached screens.
 */
export async function pullAndApply(currentUserId: string): Promise<number> {
  const db = await getDb();
  const cursor = await getSyncCursor(db);
  const { changes, cursor: nextCursor } = await syncApi.pull(cursor, 200);

  for (const change of changes) {
    await applyChange(db, change, currentUserId);
  }

  if (changes.length > 0) {
    await setSyncCursor(db, nextCursor);
  }
  return changes.length;
}

async function applyChange(
  db: Awaited<ReturnType<typeof getDb>>,
  change: SyncChange,
  currentUserId: string,
): Promise<void> {
  const payload = change.payload as Record<string, unknown>;
  try {
    if (change.entityType === 'message') {
      switch (change.operation) {
        case 'insert':
        case 'update': {
          const message = normalizeMessagePayload(payload);
          await upsertMessage(db, message);
          await refreshConversationFromMessage(db, message, {
            currentUserId,
            activeConversationId: getActiveConversationId(),
          });
          prewarmMessageMedia(message, currentUserId);
          break;
        }
        case 'delete': {
          const id = String(payload.id ?? change.entityId);
          await deleteMessageRow(db, id);
          break;
        }
        case 'reaction': {
          const messageId = String(payload.messageId ?? change.entityId);
          const reactions = Array.isArray(payload.reactions)
            ? (payload.reactions as { userId: string; emoji: string }[]).map((r) => ({
                userId: r.userId,
                emoji: r.emoji,
              }))
            : [];
          await setMessageReactions(db, messageId, reactions);
          break;
        }
        default: {
          if (typeof payload.id === 'string') {
            await upsertMessage(db, normalizeMessagePayload(payload));
          }
        }
      }
      notifyLocalDb();
      return;
    }

    if (change.entityType === 'member') {
      if (typeof payload.conversationId !== 'string') return;
      const name =
        typeof payload.name === 'string' && change.operation === 'conversation'
          ? payload.name
          : undefined;
      const avatarUrl =
        typeof payload.avatarUrl === 'string' && change.operation === 'conversation'
          ? payload.avatarUrl
          : undefined;
      await updateConversationInfo(db, payload.conversationId, { name, avatarUrl });
      notifyLocalDb();
      return;
    }

    if (change.entityType === 'conversation') {
      if (typeof payload.conversationId !== 'string') return;
      await updateConversationInfo(db, payload.conversationId, {
        name: typeof payload.name === 'string' ? payload.name : undefined,
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : undefined,
      });
      notifyLocalDb();
      return;
    }

    if (change.entityType === 'status') {
      if (change.operation === 'delete') {
        const id = String(payload.statusId ?? change.entityId);
        await deleteStatusLocal(db, id);
      } else if (typeof payload.id === 'string') {
        await upsertStatus(db, payload as unknown as import('@/types/api').StatusDTO);
      }
      notifyLocalDb();
      return;
    }

    // Unknown entity types are ignored — the changelog is forward-compatible.
  } catch {
    // A single malformed change must never poison the whole pull loop.
  }
}

function normalizeMessagePayload(payload: Record<string, unknown>): import('@/types/api').MessageDTO {
  return {
    id: String(payload.id),
    clientMessageId: String(payload.clientMessageId ?? payload.id ?? ''),
    conversationId: String(payload.conversationId ?? ''),
    senderId: String(payload.senderId ?? ''),
    type: String(payload.type ?? 'text'),
    text: typeof payload.text === 'string' ? payload.text : null,
    replyTo: typeof payload.replyTo === 'string' ? payload.replyTo : null,
    statusReplyTo: typeof payload.statusReplyTo === 'string' ? payload.statusReplyTo : null,
    callType: typeof payload.callType === 'string' ? payload.callType : null,
    callDurationMs: typeof payload.callDurationMs === 'number' ? payload.callDurationMs : null,
    callStatus: typeof payload.callStatus === 'string' ? payload.callStatus : null,
    status: String(payload.status ?? 'sent'),
    createdAt: String(payload.createdAt ?? new Date().toISOString()),
    editedAt: typeof payload.editedAt === 'string' ? payload.editedAt : null,
    deletedAt: typeof payload.deletedAt === 'string' ? payload.deletedAt : null,
    hasAttachments: Boolean(payload.hasAttachments),
    attachments: Array.isArray(payload.attachments)
      ? (payload.attachments as import('@/types/api').AttachmentDTO[])
      : [],
    reactions: Array.isArray(payload.reactions)
      ? (payload.reactions as import('@/types/api').ReactionDTO[])
      : [],
  };
}

/** Upsert the latest conversation list into the local store. */
export async function refreshConversations(conversations: import('@/types/api').ConversationDTO[]): Promise<void> {
  const db = await getDb();
  for (const c of conversations) {
    await upsertConversation(db, c);
    if (c.otherUserId && c.otherUserName) {
      await touchUserProfile(db, c.otherUserId, {
        fullName: c.otherUserName,
        avatarUrl: c.otherUserAvatarUrl,
      });
    }
  }
}

/** Cache a directory/contact user list so searches render offline. */
export async function cacheDirectoryUsers(users: import('@/types/api').UserDTO[]): Promise<void> {
  const db = await getDb();
  await cacheUsers(db, users);
  notifyLocalDb();
}

/** Rebuild a conversation cache row from a freshly fetched detail. */
export async function cacheDetail(detail: import('@/types/api').ConversationDetailDTO): Promise<void> {
  const db = await getDb();
  await upsertConversation(db, detail.conversation);
  await saveConversationMembers(
    db,
    detail.conversation.id,
    detail.members.map((m) => ({
      id: m.id,
      name: m.name,
      username: m.username,
      avatarUrl: m.avatarUrl,
      role: m.role,
      lastSeenAt: null,
    })),
  );
  if (detail.conversation.type === 'group' && detail.members.length > 0) {
    await setConversationMeta(db, detail.conversation.id, { memberCount: detail.members.length });
  }
  for (const member of detail.members) {
    await upsertUserProfile(db, {
      id: member.id,
      fullName: member.name,
      username: member.username,
      avatarUrl: member.avatarUrl,
      lastSeenAt: null,
    });
  }
  for (const m of detail.messages) {
    await upsertMessage(db, m);
    await touchUserProfile(db, m.senderId);
  }
}

/** Clear a message that was dropped by the server (e.g. rejected sync op). */
export async function removeLocalMessage(messageId: string): Promise<void> {
  const db = await getDb();
  await deleteMessageRow(db, messageId);
}