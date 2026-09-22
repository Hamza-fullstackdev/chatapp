import { useCallback, useEffect, useMemo, useState } from 'react';
import { statusesApi } from '@/lib/api';
import { getDb } from '@/db/database';
import { listStatuses, upsertStatus, deleteExpiredStatusesLocal } from '@/db/repositories';
import { useLocalDb } from '@/lib/local-db-events';
import type { StatusDTO } from '@/types/api';

interface PollState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * SQLite-first status feed. Renders the cached statuses immediately (offline
 * included) while the server feed is fetched in the background and written
 * back to the local store. Expired rows are pruned on each pass.
 */
export function useStatuses(enabled = true): PollState<StatusDTO[]> {
  const [data, setData] = useState<StatusDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRemote = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { statuses } = await statusesApi.list();
      const db = await getDb();
      for (const s of statuses) {
        await upsertStatus(db, s);
      }
      await deleteExpiredStatusesLocal(db, new Date().toISOString());
      setData(statuses);
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
    await deleteExpiredStatusesLocal(db, new Date().toISOString());
    const local = await listStatuses(db);
    setData(local);
  }, [enabled]);

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

/**
 * Order the full status list into a playback queue: optionally the given
 * `startUserId`'s statuses first (oldest → newest), then every other user with
 * active statuses (most-recent update first, oldest → newest within the user).
 * This mirrors WhatsApp's "play all" storyboard ordering.
 */
export function buildStatusQueue(
  statuses: StatusDTO[],
  startUserId?: string,
): StatusDTO[] {
  const byUser = new Map<string, StatusDTO[]>();
  for (const s of statuses) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }

  const orderUserIds = (ids: string[]): string[] =>
    ids.sort((a, b) => {
      const latestA = Math.max(...(byUser.get(a) ?? []).map((s) => Date.parse(s.createdAt)));
      const latestB = Math.max(...(byUser.get(b) ?? []).map((s) => Date.parse(s.createdAt)));
      return latestB - latestA;
    });

  const startIds = startUserId ? orderUserIds([startUserId]) : [];
  const restIds = orderUserIds(
    Array.from(byUser.keys()).filter((id) => id !== startUserId),
  );

  const queue: StatusDTO[] = [];
  for (const id of [...startIds, ...restIds]) {
    const list = (byUser.get(id) ?? []).slice().sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    queue.push(...list);
  }
  return queue;
}

/** Rebuild the queue after mutations (e.g. this client marked a status seen). */
export function useStatusQueue(statuses: StatusDTO[] | null, startUserId?: string): StatusDTO[] {
  return useMemo(() => buildStatusQueue(statuses ?? [], startUserId), [statuses, startUserId]);
}