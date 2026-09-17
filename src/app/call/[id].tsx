import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { RTCView, type MediaStream, type RTCPeerConnection } from 'react-native-webrtc';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSocketEvent } from '@/context/socket-context';
import { callsApi } from '@/lib/api';
import { sendCallSignal } from '@/lib/socket';
import {
  closePeer,
  createCallPeerConnection,
  handleIncomingSignal,
  sendOffer,
  type OutboundSignal,
} from '@/lib/webrtc';
import { Avatar } from '@/components/avatar';
import type { CallDTO } from '@/types/api';

export default function CallScreen() {
  const params = useLocalSearchParams<{ id: string; type?: string }>();
  const callId = String(params.id ?? '');
  const callType = String(params.type ?? 'voice');

  const [call, setCall] = useState<CallDTO | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [connectedText, setConnectedText] = useState('Connecting…');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const answerReceived = useRef(false);
  const offerTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef = useRef(false);

  const outgoing = call?.isOutgoing ?? false;
  const peerId = call?.peerId ?? '';

  const onSignal = useCallback(
    (packet: OutboundSignal) => {
      if (peerId) sendCallSignal(peerId, callId, packet.type, packet.data);
    },
    [peerId, callId],
  );

  const initPeer = useCallback(async () => {
    if (pcRef.current) return;
    const { pc, localStream: ls } = await createCallPeerConnection(callType === 'video', onSignal, (stream) =>
      setRemoteStream(stream),
    );
    pcRef.current = pc;
    localStreamRef.current = ls;
    if (ls) setLocalStream(ls);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setConnectedText('Connected');
      else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setConnectedText('Reconnecting…');
      }
    };
  }, [callType, onSignal]);

  const stopOfferLoop = useCallback(() => {
    if (offerTimer.current) {
      clearInterval(offerTimer.current);
      offerTimer.current = null;
    }
  }, []);

  // Load the call row once.
  useEffect(() => {
    let active = true;
    void callsApi
      .get(callId)
      .then(({ call: row }) => {
        if (active) {
          setCall(row);
          setConnectedText(row.status === 'ongoing' ? 'Connected' : 'Ringing…');
        }
      })
      .catch(() => {
        if (active) {
          Alert.alert('Call ended', 'This call is no longer available', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        }
      });
    return () => {
      active = false;
    };
  }, [callId]);

  // Establish the peer connection for the caller side and drive the offer loop.
  useEffect(() => {
    if (!call) return;
    const timer = setTimeout(() => {
      void initPeer();
      if (!call.isOutgoing) return;
      const attemptOffer = () => {
        if (pcRef.current) void sendOffer(pcRef.current, onSignal).catch(() => undefined);
      };
      attemptOffer();
      offerTimer.current = setInterval(() => {
        if (answerReceived.current || endedRef.current) {
          stopOfferLoop();
          return;
        }
        attemptOffer();
      }, 2500);
    }, 0);
    return () => {
      clearTimeout(timer);
      stopOfferLoop();
    };
  }, [call, initPeer, onSignal, stopOfferLoop]);

  // WebRTC signaling relay from the socket.
  useSocketEvent<{
    from: string;
    callId: string;
    type: 'offer' | 'answer' | 'ice';
    data: unknown;
  }>('call:signal', (event) => {
    if (event.callId !== callId || !pcRef.current) return;
    if (endedRef.current) return;
    void (async () => {
      const out = await handleIncomingSignal(pcRef.current!, {
        type: event.type,
        data: event.data,
      });
      if (event.type === 'answer') {
        answerReceived.current = true;
        stopOfferLoop();
        setConnectedText('Connected');
      }
      if (out) onSignal(out);
    })();
  });

  // Peer lifecycle events for this call.
  const endLocal = useCallback(
    (byPeer: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopOfferLoop();
      closePeer(pcRef.current, localStreamRef.current);
      pcRef.current = null;
      localStreamRef.current = null;
      if (byPeer) Alert.alert('Call ended', 'The call was ended by the other side');
      router.back();
    },
    [stopOfferLoop],
  );

  useSocketEvent<{ call: CallDTO }>('call:ongoing', (event) => {
    if (event.call.id !== callId) return;
    setConnectedText('Connected');
  });
  useSocketEvent<{ call: CallDTO }>('call:ended', (event) => {
    if (event.call.id !== callId) return;
    endLocal(true);
  });
  useSocketEvent<{ call: CallDTO }>('call:missed', (event) => {
    if (event.call.id !== callId) return;
    endLocal(true);
  });
  useSocketEvent<{ call: CallDTO }>('call:cancelled', (event) => {
    if (event.call.id !== callId) return;
    endLocal(true);
  });
  useSocketEvent<{ call: CallDTO }>('call:rejected', (event) => {
    if (event.call.id !== callId) return;
    endLocal(true);
  });

  const hangup = () => {
    if (endedRef.current) return;
    const status = outgoing && call?.status === 'ringing' ? 'cancelled' : 'ended';
    endedRef.current = true;
    stopOfferLoop();
    closePeer(pcRef.current, localStreamRef.current);
    pcRef.current = null;
    localStreamRef.current = null;
    void callsApi.updateStatus(callId, status).catch(() => undefined);
    router.back();
  };

  const muted = false; // toggle not implemented; keep simple
  const isVideo = callType === 'video';
  const showPeer = !!remoteStream;
  const peerName = call?.peerName ?? 'Contact';

  const statusLine =
    call?.status === 'ongoing' || connectedText === 'Connected' ? connectedText : 'Ringing…';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: '#0B141A' }]}>
      {isVideo && showPeer && remoteStream ? (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={styles.fullVideo}
          objectFit="cover"
          mirror={false}
        />
      ) : (
        <View style={styles.center}>
          <Avatar name={peerName} uri={call?.peerAvatarUrl} size={120} />
          <Text style={styles.peerName}>{peerName}</Text>
          <Text style={styles.statusLine}>
            {call?.isOutgoing ? `Calling… ${statusLine}` : statusLine}
          </Text>
        </View>
      )}

      {isVideo && localStream && (
        <RTCView
          streamURL={localStream.toURL()}
          style={styles.localVideo}
          objectFit="cover"
          mirror
          zOrder={1}
        />
      )}

      <View style={styles.controls}>
        {isVideo && <Pressable style={styles.controlBtn} onPress={() => undefined}>
          <Ionicons name={muted ? 'mic-off' : 'mic'} size={24} color="#FFFFFF" />
        </Pressable>}
        <Pressable style={[styles.controlBtn, styles.endBtn]} onPress={hangup}>
          <Ionicons name="call" size={30} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
        {!isVideo && (
          <Pressable style={styles.controlBtn} onPress={() => undefined}>
            <Ionicons name="volume-high" size={24} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  peerName: { color: '#FFFFFF', fontSize: 24, fontWeight: '600' },
  statusLine: { color: 'rgba(255,255,255,0.7)', fontSize: 15 },
  fullVideo: { flex: 1 },

  localVideo: {
    position: 'absolute',
    top: 50,
    right: 16,
    width: 110,
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#222D34',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    paddingVertical: 26,
  },
  controlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E5423D',
  },
});