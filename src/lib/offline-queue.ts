import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '@/db/database';
import {
  insertPendingOp,
  listPendingOps,
  removePendingOps as removePendingOpsInDb,
  truncatePendingOps,
} from '@/db/repositories';

const STORAGE_CAP = 500;

export type QueuedOpType = 'CREATE_MESSAGE' | 'MARK_READ' | 'EDIT_MESSAGE' | 'DELETE_MESSAGE' | 'CREATE_REACTION' | 'DELETE_REACTION';

export interface QueuedOp {
  opId: string;
  type: QueuedOpType;
  clientMessageId: string;
  conversationId: string;
  text?: string;
  replyTo?: string;
  /** Optional JSON payload for non-message operations (messageId, emoji, …). */
  payload?: Record<string, unknown>;
  createdAt: string;
}

let queue: QueuedOp[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
let dbInstance: SQLiteDatabase | null = null;
const listeners = new Set<() => void>();

async function db(): Promise<SQLiteDatabase> {
  dbInstance ??= await getDb();
  return dbInstance;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function opToQueued(row: { op_id: string; operation: string; client_message_id: string | null; conversation_id: string | null; payload: string | null; created_at: string }): QueuedOp {
  let payload: Record<string, unknown> | undefined;
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = undefined;
    }
  }
  const type = row.operation as QueuedOpType;
  return {
    opId: row.op_id,
    type,
    clientMessageId: row.client_message_id ?? row.op_id,
    conversationId: row.conversation_id ?? '',
    text: typeof payload?.text === 'string' ? payload.text : undefined,
    replyTo: typeof payload?.replyTo === 'string' ? payload.replyTo : undefined,
    payload,
    createdAt: row.created_at,
  };
}

export async function loadQueue(): Promise<void> {
  if (loaded) {
    await loadPromise;
    return;
  }
  loadPromise = (async () => {
    loaded = true;
    try {
      const rows = await listPendingOps(await db());
      queue = rows.map(opToQueued);
    } catch {
      queue = [];
    }
  })();
  await loadPromise;
  notify();
}

/**
 * Enqueue a pending operation. Ops with the same `clientMessageId` are
 * deduplicated so a failed optimistically-sent message is never queued twice
 * (the server dedupes by idempotency key anyway).
 */
export async function enqueueOp(op: QueuedOp): Promise<void> {
  const client = await db();
  const existing = queue.findIndex((item) => item.clientMessageId === op.clientMessageId && item.type === op.type);
  if (existing >= 0) {
    queue[existing] = op;
  } else {
    if (queue.length >= STORAGE_CAP) queue.shift();
    queue.push(op);
  }
  await truncatePendingOps(client);
  for (const item of queue) {
    await insertPendingOp(client, {
      opId: item.opId,
      operation: item.type,
      clientMessageId: item.clientMessageId,
      conversationId: item.conversationId || undefined,
      payload: item.payload ?? (item.type === 'CREATE_MESSAGE' ? { text: item.text ?? '', replyTo: item.replyTo } : undefined),
      createdAt: item.createdAt,
    });
  }
  notify();
}

/** Remove ops that have been applied on the server. */
export async function removePendingOps(opIds: string[]): Promise<void> {
  if (opIds.length === 0) return;
  const removed = new Set(opIds);
  const next = queue.filter((item) => !removed.has(item.opId));
  if (next.length === queue.length) return;
  queue = next;
  await removePendingOpsInDb(await db(), opIds);
  notify();
}

export function getPendingOps(): QueuedOp[] {
  return queue;
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}