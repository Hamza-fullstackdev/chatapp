import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWaTheme } from '@/context/theme-context';
import { useSocketEvent } from '@/context/socket-context';
import { callsApi } from '@/lib/api';
import { sendCallSignal } from '@/lib/socket';
import { getDb } from '@/db/database';
import { upsertCall } from '@/db/repositories';
import { notifyLocalDb } from '@/lib/local-db-events';
import { Avatar } from '@/components/avatar';
import type { CallDTO } from '@/types/api';

interface IncomingCall {
  call: CallDTO;
  from: { id: string; name?: string | null };
}

interface CallContextValue {
  incoming: IncomingCall | null;
  /** Place an outbound call and open the in-progress screen. */
  startCall: (calleeId: string, callType?: 'voice' | 'video', conversationId?: string) => Promise<void>;
  /** Navigate to an existing (ringing/ongoing) call's screen. */
  openCall: (callId: string, callType?: string) => void;
}

const CallContext = createContext<CallContextValue>({
  incoming: null,
  startCall: async () => undefined,
  openCall: () => undefined,
});

export function useCalls(): CallContextValue {
  return useContext(CallContext);
}

export function CallProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { colors } = useWaTheme();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);

  const dismissByCallId = useCallback((callId: string) => {
    setIncoming((prev) => (prev?.call.id === callId ? null : prev));
  }, []);

  const persistCall = useCallback((call: CallDTO) => {
    void (async () => {
      const db = await getDb();
      await upsertCall(db, call);
      notifyLocalDb();
    })().catch(() => undefined);
  }, []);

  useSocketEvent<IncomingCall>('call:incoming', (event) => {
    // Never interrupt an already-visible call screen with a second banner.
    persistCall(event.call);
    setIncoming((prev) => (prev ? prev : { call: event.call, from: event.from }));
  });

  useSocketEvent<{ call: CallDTO }>('call:ongoing', (event) => {
    persistCall(event.call);
    dismissByCallId(event.call.id);
  });
  useSocketEvent<{ call: CallDTO }>('call:rejected', (event) => {
    persistCall(event.call);
    dismissByCallId(event.call.id);
  });
  useSocketEvent<{ call: CallDTO }>('call:cancelled', (event) => {
    persistCall(event.call);
    dismissByCallId(event.call.id);
  });
  useSocketEvent<{ call: CallDTO }>('call:missed', (event) => {
    persistCall(event.call);
    dismissByCallId(event.call.id);
  });
  useSocketEvent<{ call: CallDTO }>('call:ended', (event) => {
    persistCall(event.call);
    dismissByCallId(event.call.id);
  });

  const startCall = useCallback(
    async (calleeId: string, callType: 'voice' | 'video' = 'voice', conversationId?: string) => {
      const { call } = await callsApi.create({ calleeId, callType, conversationId });
      persistCall(call);
      router.push({ pathname: '/call/[id]', params: { id: call.id, type: callType } });
      // Give the call screen a beat to mount before the first offer.
      setTimeout(() => sendCallSignal(calleeId, call.id, 'ice', { noop: true }), 50);
    },
    [persistCall, router],
  );

  const openCall = useCallback(
    (callId: string, callType?: string) => {
      router.push({ pathname: '/call/[id]', params: { id: callId, type: callType ?? 'voice' } });
    },
    [router],
  );

  const accept = useCallback(() => {
    const active = incoming;
    if (!active) return;
    setIncoming(null);
    void (async () => {
      try {
        await callsApi.updateStatus(active.call.id, 'accepted');
      } catch {
        // Proceed anyway; signaling bootstrap happens on the call screen.
      }
      router.push({
        pathname: '/call/[id]',
        params: { id: active.call.id, type: active.call.callType ?? 'voice' },
      });
    })();
  }, [incoming, router]);

  const decline = useCallback(() => {
    const active = incoming;
    if (!active) return;
    setIncoming(null);
    void callsApi.updateStatus(active.call.id, 'rejected').catch(() => undefined);
  }, [incoming]);

  return (
    <CallContext.Provider value={{ incoming, startCall, openCall }}>
      {children}
      <Modal transparent visible={!!incoming} animationType="fade" onRequestClose={decline}>
        <View style={styles.overlay}>
          <View style={[styles.card, { backgroundColor: colors.incomingBubble }]}>
            <Text style={[styles.title, { color: colors.text }]}>Incoming {incoming?.call.callType === 'video' ? 'video' : 'voice'} call</Text>
            <View style={styles.avatarWrap}>
              <Avatar name={incoming?.from.name ?? incoming?.call.peerName ?? 'Caller'} uri={incoming?.call.peerAvatarUrl} size={84} />
            </View>
            <Text style={[styles.name, { color: colors.text }]}>
              {incoming?.from.name ?? incoming?.call.peerName ?? 'Unknown'}
            </Text>
            <View style={styles.actions}>
              <Pressable style={styles.declineBtn} onPress={decline}>
                <Ionicons name="call" size={30} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
              </Pressable>
              <Pressable style={styles.acceptBtn} onPress={accept}>
                <Ionicons name="call" size={30} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </CallContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  avatarWrap: {
    marginVertical: 12,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 40,
  },
  declineBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#E5423D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
});