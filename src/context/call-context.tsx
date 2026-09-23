import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useSocketEvent } from '@/context/socket-context';
import { callsApi } from '@/lib/api';
import { getDb } from '@/db/database';
import { upsertCall } from '@/db/repositories';
import { notifyLocalDb } from '@/lib/local-db-events';
import { startCallTone, stopCallTone } from '@/lib/call-audio';
import { isCallScreenActive, openCallScreen } from '@/lib/call-routing';
import type { CallDTO } from '@/types/api';

interface CallContextValue {
  /** Place an outbound call and open the in-progress screen. */
  startCall: (calleeId: string, callType?: 'voice' | 'video', conversationId?: string) => Promise<void>;
  /** Navigate to an existing (ringing/ongoing) call's screen. */
  openCall: (callId: string, callType?: string) => void;
  /**
   * True while a call is being placed. Call buttons should be disabled while
   * this is set so a double-tap can never start two simultaneous calls.
   */
  starting: boolean;
  /** True when any call screen is currently open (server also blocks a second). */
  active: boolean;
}

const CallContext = createContext<CallContextValue>({
  startCall: async () => undefined,
  openCall: () => undefined,
  starting: false,
  active: false,
});

export function useCalls(): CallContextValue {
  return useContext(CallContext);
}

export function CallProvider({ children }: { children: ReactNode }) {
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState(isCallScreenActive());
  const callStartingRef = useRef(false);
  const persistCall = useCallback((call: CallDTO) => {
    void (async () => {
      const db = await getDb();
      await upsertCall(db, call);
      notifyLocalDb();
    })().catch(() => undefined);
  }, []);

  // Incoming call: bring up the full-screen ringing UI (WhatsApp behaviour).
  // If a call screen is already open we never interrupt it with a second call —
  // the call simply goes unanswered and expires as missed on the server.
  useSocketEvent<{ call: CallDTO } & { from?: { id: string; name?: string | null } }>(
    'call:incoming',
    (event) => {
      persistCall(event.call);
      if (isCallScreenActive()) return;
      startCallTone('ringtone');
      openCallScreen(event.call.id, event.call.callType);
    },
  );

  useSocketEvent<{ call: CallDTO }>('call:ongoing', (event) => {
    persistCall(event.call);
    stopCallTone();
  });
  useSocketEvent<{ call: CallDTO }>('call:incoming', () => void 0);
  useSocketEvent<{ call: CallDTO }>('call:rejected', (event) => {
    persistCall(event.call);
    stopCallTone();
    setActive(false);
  });
  useSocketEvent<{ call: CallDTO }>('call:cancelled', (event) => {
    persistCall(event.call);
    stopCallTone();
    setActive(false);
  });
  useSocketEvent<{ call: CallDTO }>('call:missed', (event) => {
    persistCall(event.call);
    stopCallTone();
    setActive(false);
  });
  useSocketEvent<{ call: CallDTO }>('call:ended', (event) => {
    persistCall(event.call);
    stopCallTone();
    setActive(false);
  });

  const startCall = useCallback(
    async (calleeId: string, callType: 'voice' | 'video' = 'voice', conversationId?: string) => {
      // Never place a second call while one is starting or a call screen is
      // already open — the server rejects it too, but the client should stay
      // silent and keep the button disabled instead of surfacing an error.
      if (callStartingRef.current || isCallScreenActive()) return;
      callStartingRef.current = true;
      setActive(true);
      setStarting(true);
      try {
        const { call } = await callsApi.create({ calleeId, callType, conversationId });
        persistCall(call);
        startCallTone('ringback');
        openCallScreen(call.id, callType);
      } finally {
        callStartingRef.current = false;
        setStarting(false);
      }
    },
    [persistCall],
  );

  const openCall = useCallback((callId: string, callType?: string) => {
    if (isCallScreenActive()) return;
    setActive(true);
    openCallScreen(callId, callType);
  }, []);

  return (
    <CallContext.Provider
      value={{ startCall, openCall, starting: starting || active, active }}
    >
      {children}
    </CallContext.Provider>
  );
}