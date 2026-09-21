import { useEffect, useRef } from 'react';

type DbChangeListener = () => void;

const listeners = new Set<DbChangeListener>();

/**
 * Tiny app-wide pub/sub for "the local SQLite store changed" events coming
 * from outside the sync engine (the realtime socket sink, media downloads,
 * foreground re-syncs). Screens that render from SQLite subscribe so the UI
 * stays in lock-step with the offline-first store.
 */
export function subscribeLocalDb(listener: DbChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyLocalDb(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A misbehaving subscriber must never break the bus.
    }
  }
}

/** Re-run a callback whenever the local store changes (socket/pull/media). */
export function useLocalDb(listener: DbChangeListener): void {
  const handlerRef = useRef(listener);
  useEffect(() => {
    handlerRef.current = listener;
  }, [listener]);
  useEffect(() => {
    const unsubscribe = subscribeLocalDb(() => handlerRef.current());
    return unsubscribe;
  }, []);
}