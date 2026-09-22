import type { Socket } from 'socket.io-client';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '@/db/database';
import {
  clearConversationLastMessageIfMatch,
  deleteMessageRow,
  deleteStatusLocal,
  getConversation,
  getUserProfile,
  incrementStatusViewsLocal,
  markConversationLastMessageStatus,
  markMessagesDeliveredThrough,
  markMessagesReadThrough,
  refreshConversationFromMessage,
  setConversationLeftAt,
  setMessageReactions,
  touchUserProfile,
  upsertMessage,
  upsertStatus,
  upsertStatusView,
} from '@/db/repositories';
import { getActiveConversationId } from '@/lib/active-conversation';
import { prewarmMessageMedia } from '@/lib/media-cache';
import { notifyLocalDb } from '@/lib/local-db-events';
import { setPresence } from '@/lib/presence';
import { presentIncomingMessageNotification } from '@/lib/notifications';
import { previewText } from '@/lib/format';
import { sendMessageReceived } from '@/lib/socket';
import type {
  MessageDTO,
  MessageDeliveredEvent,
  MessageReadEvent,
  PresenceUpdateEvent,
  StatusDeleteEvent,
  StatusDTO,
  StatusViewEvent,
} from '@/types/api';

/**
 * Global realtime sink — the client-side half of WhatsApp-style push delivery.
 *
 * Every message-family event the server emits (message:new / update / delete /
 * reaction / read / delivered) lands in the local SQLite store *regardless of
 * which screen is open*, because the server now also fans events out to each
 * participant's personal room (`user:<id>`) at connect time.
 *
 * This is what makes the app offline-first: by the time the network drops,
 * the messages that were pushed to you (and their media) are already on disk,
 * so you can navigate conversations and read them without a connection.
 */
/**
 * Build and present the local banner for a freshly-incoming message. Titles
 * with the sender's name for private chats and the group's name for groups
 * (WhatsApp-style); the body is the message preview.
 */
async function notifyIncomingMessage(db: SQLiteDatabase, message: MessageDTO): Promise<void> {
  try {
    const conv = await getConversation(db, message.conversationId);
    const sender = await getUserProfile(db, message.senderId);
    const senderName = sender?.fullName?.trim() || sender?.username?.trim();
    let title: string;
    if (conv?.type === 'group') {
      title = conv?.name?.trim() || senderName || 'New message';
    } else {
      title = senderName || conv?.otherUserName?.trim() || 'New message';
    }
    await presentIncomingMessageNotification({
      title,
      body: previewText(message.type, message.text, conv?.type === 'group' ? senderName : undefined),
      data: { conversationId: message.conversationId, messageId: message.id, type: message.type },
    });
  } catch {
    // Best-effort; never break the realtime path for a failed banner.
  }
}

export function installRealtimeHandlers(socket: Socket, currentUserId: string): () => void {
  const run = (job: () => Promise<void>) => {
    void job().catch(() => undefined);
  };

  const onMessageNew = (message: MessageDTO) => {
    run(async () => {
      const db = await getDb();
      await upsertMessage(db, message);
      await touchUserProfile(db, message.senderId);
      await refreshConversationFromMessage(db, message, {
        currentUserId,
        activeConversationId: getActiveConversationId(),
      });
      prewarmMessageMedia(message, currentUserId);
      notifyLocalDb();

      // The device now holds the message: acknowledge it so the sender's tick
      // moves from single grey (sent) to double grey (delivered), exactly
      // like WhatsApp. Skip our own echoes.
      if (message.senderId !== currentUserId) {
        sendMessageReceived(message.conversationId, message.id);
      }

      // Banner the incoming message (WhatsApp-style): skip our own echoes,
      // whatever conversation we are currently reading on screen, and
      // scripted server notices (e.g. "X has left the chat").
      if (message.senderId === currentUserId) return;
      if (message.conversationId === getActiveConversationId()) return;
      if (message.type === 'system') return;
      void notifyIncomingMessage(db, message);
    });
  };

  const onMessageUpdate = (message: MessageDTO) => {
    run(async () => {
      const db = await getDb();
      await upsertMessage(db, message);
      await refreshConversationFromMessage(db, message, {
        currentUserId,
        activeConversationId: getActiveConversationId(),
      });
      notifyLocalDb();
    });
  };

  const onMessageDelete = (payload: { id: string; conversationId: string; deletedAt: string }) => {
    run(async () => {
      const db = await getDb();
      await deleteMessageRow(db, payload.id);
      await clearConversationLastMessageIfMatch(db, payload.conversationId, payload.id);
      notifyLocalDb();
    });
  };

  const onMessageReaction = (payload: {
    conversationId: string;
    messageId: string;
    reactions: { userId: string; emoji: string }[];
  }) => {
    run(async () => {
      const db = await getDb();
      await setMessageReactions(db, payload.messageId, payload.reactions);
      notifyLocalDb();
    });
  };

  const onMessageRead = (event: MessageReadEvent) => {
    run(async () => {
      // Ignore receipts we broadcast ourselves (our own read events land back
      // on this device). Otherwise our own outgoing messages would be marked
      // "read" simply because we read the chat — the self-blue-tick bug.
      if (event.userId === currentUserId) return;
      const db = await getDb();
      await markMessagesReadThrough(db, event.conversationId, currentUserId, event.messageId);
      await markConversationLastMessageStatus(db, event.conversationId, event.messageId, 'read');
      notifyLocalDb();
    });
  };

  const onMessageDelivered = (event: MessageDeliveredEvent) => {
    run(async () => {
      const db = await getDb();
      await markMessagesDeliveredThrough(db, event.conversationId, currentUserId, event.messageId);
      await markConversationLastMessageStatus(db, event.conversationId, event.messageId, 'delivered');
      notifyLocalDb();
    });
  };

  const onPresence = (event: PresenceUpdateEvent) => {
    // Presence is transient UI state; still remember the profile id locally.
    setPresence(event.userId, event.online);
    run(async () => {
      await touchUserProfile(await getDb(), event.userId);
    });
  };

  const onStatusNew = (status: StatusDTO) => {
    run(async () => {
      const db = await getDb();
      await upsertStatus(db, status);
      notifyLocalDb();
    });
  };

  const onStatusDelete = (event: StatusDeleteEvent) => {
    run(async () => {
      await deleteStatusLocal(await getDb(), event.statusId);
      notifyLocalDb();
    });
  };

  const onStatusView = (event: StatusViewEvent) => {
    run(async () => {
      const db = await getDb();
      await incrementStatusViewsLocal(db, event.statusId);
      await upsertStatusView(db, {
        statusId: event.statusId,
        userId: event.userId,
        viewedAt: event.viewedAt,
      });
      notifyLocalDb();
    });
  };

  /**
   * Soft-removal from a group. When the current user leaves / is removed, the
   * server emits `group:update` with kind 'removed' (to the member) and
   * 'member_removed' (to the room, carrying the userId). Mark the local
   * conversation left_at so the composer hides and a "you left" notice shows
   * without waiting for the next full refresh. Re-add clears it via the
   * regular details sync, and only the affected conversation changes.
   */
  const onGroupUpdate = (event: {
    conversationId?: string;
    kind?: string;
    userId?: string;
  }) => {
    const conversationId = event?.conversationId;
    if (!conversationId) return;
    const removedMe =
      event?.kind === 'removed' ||
      (event?.kind === 'member_removed' && event.userId === currentUserId);
    if (!removedMe) {
      // Re-added (left_at cleared server-side): restore the composer locally.
      if (event?.kind === 'member_added' && event.userId === currentUserId) {
        run(async () => {
          await setConversationLeftAt(await getDb(), conversationId, null);
          notifyLocalDb();
        });
      }
      return;
    }
    run(async () => {
      const db = await getDb();
      await setConversationLeftAt(db, conversationId, new Date().toISOString());
      notifyLocalDb();
    });
  };

  socket.on('message:new', onMessageNew);
  socket.on('message:update', onMessageUpdate);
  socket.on('message:delete', onMessageDelete);
  socket.on('message:reaction', onMessageReaction);
  socket.on('message:read', onMessageRead);
  socket.on('message:delivered', onMessageDelivered);
  socket.on('presence:update', onPresence);
  socket.on('status:new', onStatusNew);
  socket.on('status:delete', onStatusDelete);
  socket.on('status:view', onStatusView);
  socket.on('group:update', onGroupUpdate);

  return () => {
    socket.off('message:new', onMessageNew);
    socket.off('message:update', onMessageUpdate);
    socket.off('message:delete', onMessageDelete);
    socket.off('message:reaction', onMessageReaction);
    socket.off('message:read', onMessageRead);
    socket.off('message:delivered', onMessageDelivered);
    socket.off('presence:update', onPresence);
    socket.off('status:new', onStatusNew);
    socket.off('status:delete', onStatusDelete);
    socket.off('status:view', onStatusView);
    socket.off('group:update', onGroupUpdate);
  };
}