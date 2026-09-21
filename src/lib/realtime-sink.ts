import type { Socket } from 'socket.io-client';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '@/db/database';
import {
  clearConversationLastMessageIfMatch,
  deleteMessageRow,
  getConversation,
  getUserProfile,
  markConversationLastMessageStatus,
  refreshConversationFromMessage,
  setMessageDelivered,
  setMessageReadStatus,
  setMessageReactions,
  touchUserProfile,
  upsertMessage,
} from '@/db/repositories';
import { getActiveConversationId } from '@/lib/active-conversation';
import { prewarmMessageMedia } from '@/lib/media-cache';
import { notifyLocalDb } from '@/lib/local-db-events';
import { presentIncomingMessageNotification } from '@/lib/notifications';
import { previewText } from '@/lib/format';
import type {
  MessageDTO,
  MessageDeliveredEvent,
  MessageReadEvent,
  PresenceUpdateEvent,
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
    const senderName = sender?.name?.trim() || sender?.username?.trim();
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

      // Banner the incoming message (WhatsApp-style): skip our own echoes and
      // whatever conversation we are currently reading on screen.
      if (message.senderId === currentUserId) return;
      if (message.conversationId === getActiveConversationId()) return;
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
      const db = await getDb();
      const messageId = event.messageId;
      await setMessageReadStatus(db, event.conversationId, currentUserId, messageId);
      await markConversationLastMessageStatus(db, event.conversationId, messageId, 'read');
      notifyLocalDb();
    });
  };

  const onMessageDelivered = (event: MessageDeliveredEvent) => {
    run(async () => {
      const db = await getDb();
      await setMessageDelivered(db, event.messageId);
      await markConversationLastMessageStatus(db, event.conversationId, event.messageId, 'delivered');
      notifyLocalDb();
    });
  };

  const onPresence = (event: PresenceUpdateEvent) => {
    // Presence is transient UI state; still remember the profile id locally.
    run(async () => {
      await touchUserProfile(await getDb(), event.userId);
    });
  };

  socket.on('message:new', onMessageNew);
  socket.on('message:update', onMessageUpdate);
  socket.on('message:delete', onMessageDelete);
  socket.on('message:reaction', onMessageReaction);
  socket.on('message:read', onMessageRead);
  socket.on('message:delivered', onMessageDelivered);
  socket.on('presence:update', onPresence);

  return () => {
    socket.off('message:new', onMessageNew);
    socket.off('message:update', onMessageUpdate);
    socket.off('message:delete', onMessageDelete);
    socket.off('message:reaction', onMessageReaction);
    socket.off('message:read', onMessageRead);
    socket.off('message:delivered', onMessageDelivered);
    socket.off('presence:update', onPresence);
  };
}