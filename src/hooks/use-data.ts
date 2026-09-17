import * as Crypto from 'expo-crypto';
import { useCallback } from 'react';
import { conversationsApi, messagesApi, usersApi } from '@/lib/api';
import { usePolling, type PollState } from './use-polling';
import type { ConversationDTO, MessageDTO, UserDTO } from '@/types/api';

export function useConversations(
  currentUserId: string,
  enabled = true,
): PollState<ConversationDTO[]> {
  const state = usePolling(
    async () => {
      const { conversations } = await conversationsApi.list();
      return conversations;
    },
    5000,
    [currentUserId],
    enabled,
  );
  return state;
}

export function useMessages(conversationId: string, enabled = true): PollState<MessageDTO[]> & {
  send: (text: string, replyTo?: string) => Promise<void>;
} {
  const state = usePolling(
    async () => {
      const { messages } = await messagesApi.list(conversationId, { limit: 100 });
      return messages;
    },
    3000,
    [conversationId],
    enabled,
  );

  const send = useCallback(
    async (text: string, replyTo?: string) => {
      const clientMessageId = Crypto.randomUUID();
      await messagesApi.send(conversationId, { text, clientMessageId, replyTo });
      await state.refresh();
    },
    [conversationId, state],
  );

  return { ...state, send };
}

export function useContacts(search?: string, enabled = true): PollState<UserDTO[]> {
  const state = usePolling(
    async () => {
      const { users } = await usersApi.list(search);
      return users;
    },
    15000,
    [search],
    enabled,
  );
  return state;
}