import { useEffect, useState } from 'react';

type PresenceListener = () => void;

const online = new Set<string>();
const listeners = new Set<PresenceListener>();

/**
 * App-wide presence store fed by the global realtime sink's `presence:update`
 * events. Any screen (Chats tab, contacts, …) can render an online bubble for
 * a peer via `usePresence()` without pulling per-conversation state.
 */
export function setPresence(userId: string, isOnline: boolean): void {
  if (!userId) return;
  const had = online.has(userId);
  if (isOnline) online.add(userId);
  else online.delete(userId);
  if (had !== online.has(userId)) {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A misbehaving subscriber must never break the presence bus.
      }
    }
  }
}

/** Drop every cached online marker (e.g. the socket disconnected). */
export function clearPresence(): void {
  if (online.size === 0) return;
  online.clear();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export function isUserOnline(userId: string): boolean {
  return online.has(userId);
}

/** Subscribe a component to online-state changes; returns the current set. */
export function usePresence(): Set<string> {
  const [snapshot, setSnapshot] = useState(() => new Set(online));

  useEffect(() => {
    const update = () => setSnapshot(new Set(online));
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  return snapshot;
}