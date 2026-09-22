import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useAuth } from './auth-context';
import { useSocket } from './socket-context';
import { syncApi, conversationsApi, usersApi } from '@/lib/api';
import {
  enqueueOp,
  getPendingOps,
  loadQueue,
  removePendingOps,
  subscribeQueue,
  type QueuedOp,
} from '@/lib/offline-queue';
import { uploadAsset } from '@/lib/media';
import { pullAndApply, refreshConversations, cacheDirectoryUsers } from '@/lib/pull-sync';
import type { MessageDTO } from '@/types/api';

export interface FlushedMessage {
  clientMessageId: string;
  message: MessageDTO;
}

interface SyncValue {
  pendingCount: number;
  flushing: boolean;
  flushNow: () => Promise<FlushedMessage[]>;
  /** Increments whenever the local SQLite store is updated by a server pull. */
  dbGeneration: number;
}

interface SyncContextValue extends SyncValue {
  subscribeFlush: (listener: (items: FlushedMessage[]) => void) => () => void;
  subscribeDb: (listener: () => void) => () => void;
  runDbSync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({
  pendingCount: 0,
  flushing: false,
  flushNow: async () => [],
  dbGeneration: 0,
  subscribeFlush: () => () => undefined,
  subscribeDb: () => () => undefined,
  runDbSync: async () => undefined,
});

type SyncTarget = {
  operation:
    | 'CREATE_MESSAGE'
    | 'MARK_READ'
    | 'EDIT_MESSAGE'
    | 'DELETE_MESSAGE'
    | 'CREATE_REACTION'
    | 'DELETE_REACTION';
  clientMessageId?: string;
  conversationId?: string;
  payload?: Record<string, unknown>;
};

function queueToOps(ops: QueuedOp[]): SyncTarget[] {
  return ops.map((op) => {
    const common = {
      operation: op.type as SyncTarget['operation'],
      clientMessageId: op.clientMessageId,
      conversationId: op.conversationId,
    };
    if (op.type === 'MARK_READ') return common;
    return {
      ...common,
      // CREATE_MESSAGE (and the other operations) carry their full payload,
      // including type + attachment, so offline media messages survive the
      // queue round-trip and the server can recreate them exactly.
      payload: op.payload ?? {},
    };
  });
}

type QueuedAttachment = {
  type: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  storagePath?: string;
  gifUrl?: string;
  previewUrl?: string;
  provider?: string;
  localUri?: string;
};

function contentTypeFor(type: string): string {
  switch (type) {
    case 'audio':
      return 'audio/mp4';
    case 'video':
      return 'video/mp4';
    case 'image':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Prepare a queued op for its push attempt. Media (image/video/audio/file)
 * queued while offline still needs its local file uploaded to storage before
 * the server can persist the message. Returns `null` when the upload is not
 * possible yet (disconnected) so the op stays queued for the next flush.
 */
async function finalizeMediaOp(op: QueuedOp): Promise<QueuedOp | null> {
  if (op.type !== 'CREATE_MESSAGE') return op;
  const payload = (op.payload ?? {}) as {
    text?: string;
    replyTo?: string;
    type?: string;
    attachment?: QueuedAttachment;
  };
  const attachment = payload.attachment;
  if (!attachment || !attachment.localUri) return op;
  if (attachment.storagePath) return op;
  try {
    const { attachment: uploaded } = await uploadAsset(
      'chat-media',
      {
        uri: attachment.localUri,
        contentType: attachment.mimeType ?? contentTypeFor(attachment.type),
        fileName: attachment.fileName,
        size: attachment.size,
      },
      { width: attachment.width, height: attachment.height, durationMs: attachment.durationMs },
    );
    const next: QueuedOp = {
      ...op,
      payload: {
        ...payload,
        attachment: { ...attachment, ...uploaded },
      },
    };
    await enqueueOp(next);
    return next;
  } catch {
    // Disconnected or storage signing unavailable — retry next flush.
    return null;
  }
}

/**
 * Offline-first sync engine.
 *
 * Two directions, both persisted through the local SQLite store:
 *
 * 1. PUSH — operations enqueued while offline (messages, read receipts,
 *    edits, deletes, reactions) are flushed through POST /api/sync once a
 *    fresh socket connection exists. Every operation is idempotent.
 * 2. PULL — the server changelog since the saved cursor is applied to local
 *    tables; the chat / conversations screens re-read the database when the
 *    `dbGeneration` counter bumps.
 */
export function SyncProvider({ children }: SyncProviderProps) {
  const { token, status, user } = useAuth();
  const { connected } = useSocket();
  const [pendingCount, setPendingCount] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const [dbGeneration, setDbGeneration] = useState(0);

  const lastPullCycle = useRef<string | null>(null);
  const lastForegroundSync = useRef(0);
  const connectGeneration = useRef(0);
  const prevConnected = useRef(true);
  const flushListeners = useRef(new Set<(items: FlushedMessage[]) => void>());
  const dbListeners = useRef(new Set<() => void>());
  const syncing = useRef(false);

  const notifyFlush = (items: FlushedMessage[]) => {
    flushListeners.current.forEach((fn) => fn(items));
    setPendingCount(getPendingOps().length);
  };
  const bumpDb = () => {
    setDbGeneration((g) => g + 1);
    dbListeners.current.forEach((fn) => fn());
  };

  const flush = useCallback(async (): Promise<FlushedMessage[]> => {
    const ops = getPendingOps();
    if (ops.length === 0) return [];
    setFlushing(true);
    try {
      // Media queued while offline must be uploaded to storage first. Ops that
      // cannot upload yet (still disconnected) stay queued for the next flush.
      const ready: QueuedOp[] = [];
      for (const op of ops) {
        const finalized = await finalizeMediaOp(op);
        if (finalized) ready.push(finalized);
      }
      if (ready.length === 0) return [];
      const { results } = await syncApi.push(queueToOps(ready));
      const applied: FlushedMessage[] = [];
      const done: string[] = [];
      const seen = new Set<string>();
      for (const op of ready) {
        const result = results.find((r) => r.clientMessageId === op.clientMessageId);
        if (!result || result.status === 'error') continue;
        done.push(op.opId);
        if (result.data) {
          const cmi = result.clientMessageId ?? op.clientMessageId;
          if (!seen.has(cmi)) {
            seen.add(cmi);
            applied.push({ clientMessageId: cmi, message: result.data });
          }
        }
      }
      await removePendingOps(done);
      return applied;
    } finally {
      setFlushing(false);
    }
  }, []);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const flushNow = async (): Promise<FlushedMessage[]> => {
    const items = await flushRef.current();
    if (items.length > 0) notifyFlush(items);
    return items;
  };

  const pull = useCallback(async (): Promise<void> => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const applied = await pullAndApply(user?.id ?? '');
      if (applied > 0) {
        const { conversations } = await conversationsApi.list().catch(() => ({ conversations: [] }));
        if (Array.isArray(conversations) && conversations.length > 0) {
          await refreshConversations(conversations);
        }
        const { users } = await usersApi.list().catch(() => ({ users: [] }));
        if (Array.isArray(users) && users.length > 0) {
          await cacheDirectoryUsers(users);
        }
        bumpDb();
      }
    } catch {
      // Network failure: cursor is untouched, the next successful pull retries.
    } finally {
      syncing.current = false;
    }
  }, [user?.id]);

  const pullRef = useRef(pull);
  useEffect(() => {
    pullRef.current = pull;
  }, [pull]);

  const runDbSync = async (): Promise<void> => {
    await flushNow();
    await pullRef.current();
  };

  // Load the persisted queue once.
  useEffect(() => {
    void loadQueue();
  }, []);

  // Reflect queue size into state.
  useEffect(() => {
    const update = () => setPendingCount(getPendingOps().length);
    update();
    return subscribeQueue(update);
  }, []);

  // Flush + pull once per session reconnect.
  useEffect(() => {
    if (prevConnected.current === false && connected === true) {
      connectGeneration.current += 1;
    }
    prevConnected.current = connected;
  }, [connected]);

  useEffect(() => {
    if (status !== 'signedIn' || !token || !connected) return;
    const cycle = `${token}#${connectGeneration.current}`;
    if (lastPullCycle.current === cycle) return;
    lastPullCycle.current = cycle;
    void (async () => {
      const items = await flushRef.current();
      notifyFlush(items);
      await pullRef.current();
    })();
  }, [status, token, connected]);

  // Foreground refresh: the local store stays authoritative even if a push or
  // pull was missed while the app was backgrounded. Throttled to once/30s so
  // quick background/foreground cycles don't spam the API.
  useEffect(() => {
    if (status !== 'signedIn' || !token) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !connected) return;
      const now = Date.now();
      if (now - lastForegroundSync.current < 30_000) return;
      lastForegroundSync.current = now;
      void (async () => {
        const items = await flushRef.current();
        notifyFlush(items);
        await pullRef.current();
      })();
    });
    return () => sub.remove();
  }, [status, token, connected]);

  const value: SyncContextValue = {
    pendingCount,
    flushing,
    flushNow,
    dbGeneration,
    subscribeFlush: (listener) => {
      flushListeners.current.add(listener);
      return () => {
        flushListeners.current.delete(listener);
      };
    },
    subscribeDb: (listener) => {
      dbListeners.current.add(listener);
      return () => {
        dbListeners.current.delete(listener);
      };
    },
    runDbSync,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

interface SyncProviderProps {
  children: ReactNode;
}

export function useSync(): SyncValue {
  return useContext(SyncContext);
}

/**
 * Subscribe to every flush result, including the replay of queued messages.
 * The handler is stored in a ref (updated inside an effect) so the
 * subscription stays stable across re-renders.
 */
export function useSyncFlush(listener: (items: FlushedMessage[]) => void): void {
  const { subscribeFlush } = useContext(SyncContext);
  const handlerRef = useRef(listener);

  useEffect(() => {
    handlerRef.current = listener;
  }, [listener]);

  useEffect(() => {
    const unsubscribe = subscribeFlush((items) => handlerRef.current(items));
    return unsubscribe;
  }, [subscribeFlush]);
}

/**
 * Subscribe to local-database updates caused by server pull changes.
 */
export function useSyncDb(listener: () => void): void {
  const { subscribeDb } = useContext(SyncContext);
  const handlerRef = useRef(listener);

  useEffect(() => {
    handlerRef.current = listener;
  }, [listener]);

  useEffect(() => {
    const unsubscribe = subscribeDb(() => handlerRef.current());
    return unsubscribe;
  }, [subscribeDb]);
}

export { enqueueOp };