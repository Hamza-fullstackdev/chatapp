import { createContext, useCallback, useContext, type ReactNode } from 'react';
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
}

const CallContext = createContext<CallContextValue>({
  startCall: async () => undefined,
  openCall: () => undefined,
});

export function useCalls(): CallContextValue {
  return useContext(CallContext);
}

export function CallProvider({ children }: { children: ReactNode }) {
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
  useSocketEvent<{ call: CallDTO }>('call:rejected', (event) => {
    persistCall(event.call);
    stopCallTone();
  });
  useSocketEvent<{ call: CallDTO }>('call:cancelled', (event) => {
    persistCall(event.call);
    stopCallTone();
  });
  useSocketEvent<{ call: CallDTO }>('call:missed', (event) => {
    persistCall(event.call);
    stopCallTone();
  });
  useSocketEvent<{ call: CallDTO }>('call:ended', (event) => {
    persistCall(event.call);
    stopCallTone();
  });

  const startCall = useCallback(
    async (calleeId: string, callType: 'voice' | 'video' = 'voice', conversationId?: string) => {
      const { call } = await callsApi.create({ calleeId, callType, conversationId });
      persistCall(call);
      startCallTone('ringback');
      openCallScreen(call.id, callType);
    },
    [persistCall],
  );

  const openCall = useCallback((callId: string, callType?: string) => {
    openCallScreen(callId, callType);
  }, []);

  return <CallContext.Provider value={{ startCall, openCall }}>{children}</CallContext.Provider>;
}