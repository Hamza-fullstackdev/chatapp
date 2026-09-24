import { router } from 'expo-router';

/**
 * The id of the call screen currently open on the navigation stack, kept in
 * module scope so provider-level listeners (socket + push taps) can agree on a
 * single "active call" and never stack duplicate call screens on top of each
 * other.
 */
export const activeCallRouteId: { current: string | null } = { current: null };

export interface RouterLike {
  push(opts: { pathname: string; params: Record<string, string> }): void;
}

/**
 * Subscribers notified whenever the active call screen claim changes (claimed,
 * released, or overtaken by a different call). Used by the CallProvider to keep
 * its `active` flag in sync with reality instead of relying on socket events,
 * which are only delivered to the peer and never the actor who ended the call.
 */
const routeListeners = new Set<() => void>();

function notifyRouteListeners(): void {
  for (const fn of routeListeners) fn();
}

export function onCallRouteChange(fn: () => void): () => void {
  routeListeners.add(fn);
  return () => routeListeners.delete(fn);
}

/**
 * Navigate to the call screen unless one is already open for the same call.
 * Returns whether navigation actually happened.
 */
export function openCallScreen(callId: string, callType?: string): boolean {
  const type = callType ?? 'voice';
  if (activeCallRouteId.current === callId) return false;
  activeCallRouteId.current = callId;
  router.push({ pathname: '/call/[id]', params: { id: callId, type } });
  return true;
}

/** Claim the call screen route as the active one (called on mount). */
export function claimActiveCallScreen(callId: string): void {
  activeCallRouteId.current = callId;
  notifyRouteListeners();
}

/** Release the claim when the call screen unmounts. */
export function releaseActiveCallScreen(callId: string): void {
  if (activeCallRouteId.current === callId) {
    activeCallRouteId.current = null;
    notifyRouteListeners();
  }
}

/** Whether a call screen is currently open (any call). */
export function isCallScreenActive(): boolean {
  return activeCallRouteId.current !== null;
}