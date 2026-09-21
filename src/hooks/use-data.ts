import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { conversationsApi, messagesApi, usersApi } from '@/lib/api';
import { cacheDirectoryUsers, refreshConversations } from '@/lib/pull-sync';
import { getDb } from '@/db/database';
import { listAllUserProfiles, listConversations } from '@/db/repositories';
import { useLocalDb } from '@/lib/local-db-events';
import type { ConversationDTO, MessageDTO, UserDTO } from '@/types/api';

interface PollState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * SQLite-first contacts directory. Cached profiles render instantly (offline
 * included) while the network copy is refreshed in the background and written
 * back to SQLite for the next offline session.
 */
export function useContacts(search?: string, enabled = true): PollState<UserDTO[]> {
  const [data, setData] = useState<UserDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRemote = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { users } = await usersApi.list(search);
      await cacheDirectoryUsers(users);
      setData(users);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [search, enabled]);

  const readLocal = useCallback(async () => {
    if (!enabled) return;
    const db = await getDb();
    const local = await listAllUserProfiles(db, search);
    setData(local.map((u) => ({ ...u, createdAt: '' })));
  }, [search, enabled]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void readLocal();
    void fetchRemote();
  }, [search, enabled, readLocal, fetchRemote]);

  useLocalDb(() => {
    void readLocal();
  });

  return { data, loading, error, refresh: fetchRemote };
}

/**
 * SQLite-first conversation list. Renders from the local cache immediately
 * (works offline) and refreshes/persists from the server in the background.
 */
export function useConversations(currentUserId: string, enabled = true): PollState<ConversationDTO[]> {
  const [data, setData] = useState<ConversationDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRemote = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { conversations } = await conversationsApi.list();
      await refreshConversations(conversations);
      setData(conversations);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const readLocal = useCallback(async () => {
    if (!enabled) return;
    const db = await getDb();
    const local = await listConversations(db, currentUserId);
    setData(local);
  }, [enabled, currentUserId]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void readLocal();
    void fetchRemote();
  }, [enabled, readLocal, fetchRemote]);

  useLocalDb(() => {
    void readLocal();
  });

  return { data, loading, error, refresh: fetchRemote };
}

export function useMessages(conversationId: string, enabled = true): PollState<MessageDTO[]> & {
  send: (text: string, replyTo?: string) => Promise<void>;
} {
  const fetcher = useCallback(async () => {
    const { messages } = await messagesApi.list(conversationId, { limit: 100 });
    return messages;
  }, [conversationId]);

  const [data, setData] = useState<MessageDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await fetcher();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [enabled, fetcher]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [enabled, run]);

  const send = useCallback(
    async (text: string, replyTo?: string) => {
      const clientMessageId = Crypto.randomUUID();
      await messagesApi.send(conversationId, { text, clientMessageId, replyTo });
      await run();
    },
    [conversationId, run],
  );

  return { data, loading, error, refresh: run, send };
}