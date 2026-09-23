import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { RTCView, type MediaStream, type RTCPeerConnection } from 'react-native-webrtc';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSocketEvent } from '@/context/socket-context';
import { callsApi } from '@/lib/api';
import { sendCallSignal } from '@/lib/socket';
import {
  closePeer,
  createCallPeerConnection,
  handleIncomingSignal,
  sendOffer,
  setLocalTracksEnabled,
  type OutboundSignal,
} from '@/lib/webrtc';
import { Avatar } from '@/components/avatar';
import type { CallDTO, PresenceUpdateEvent } from '@/types/api';
import { resetCallAudioMode, routeCallAudio, startCallTone, stopCallTone } from '@/lib/call-audio';
import { claimActiveCallScreen, releaseActiveCallScreen } from '@/lib/call-routing';

interface SignalEvent {
  from: string;
  callId: string;
  type: 'offer' | 'answer' | 'ice' | 'request-offer';
  data: unknown;
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export default function CallScreen() {
  const params = useLocalSearchParams<{ id: string; type?: string }>();
  const callId = String(params.id ?? '');
  const callType = String(params.type ?? 'voice');
  const insets = useSafeAreaInsets();

  const [call, setCall] = useState<CallDTO | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaLive, setMediaLive] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);

  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Video calls default to the loudspeaker; voice calls to the earpiece.
  const [speakerOn, setSpeakerOn] = useState(callType === 'video');
  // True once a callee answers from this screen (covers the push-tap entry
  // where no in-app incoming banner was ever shown).
  const [incomingAccepted, setIncomingAccepted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const answerReceived = useRef(false);
  const offerTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef = useRef(false);
  const initPeerPromiseRef = useRef<Promise<void> | null>(null);
  const pendingSignalsRef = useRef<SignalEvent[]>([]);

  const outgoing = call?.isOutgoing ?? false;
  const peerId = call?.peerId ?? '';

  const onSignal = useCallback(
    (packet: OutboundSignal) => {
      if (peerId) sendCallSignal(peerId, callId, packet.type, packet.data);
    },
    [peerId, callId],
  );

  const stopOfferLoop = useCallback(() => {
    if (offerTimer.current) {
      clearInterval(offerTimer.current);
      offerTimer.current = null;
    }
  }, []);

  // Apply a relayed WebRTC packet. Anything that must be answered flows back
  // through `onSignal`. Expectation: this runs only with an active peer
  // connection — signals that arrive earlier are buffered and flushed on init.
  const processSignal = useCallback(
    (event: SignalEvent) => {
      const pc = pcRef.current;
      if (!pc || endedRef.current) return;
      void (async () => {
        try {
          const out = await handleIncomingSignal(pc, { type: event.type, data: event.data });
          if (event.type === 'answer') {
            answerReceived.current = true;
            stopOfferLoop();
          }
          if (out) onSignal(out);
        } catch {
          // A relayed signal raced with teardown — safe to ignore.
        }
      })();
    },
    [onSignal, stopOfferLoop],
  );

  const flushPendingSignals = useCallback(() => {
    if (pendingSignalsRef.current.length === 0) return;
    const queued = pendingSignalsRef.current.splice(0, pendingSignalsRef.current.length);
    for (const event of queued) processSignal(event);
  }, [processSignal]);

  // Create the peer connection and capture the local stream (mic/camera).
  // Serialised through a promise ref so a re-render can never spawn two PCs.
  const initPeer = useCallback(async () => {
    if (pcRef.current) return;
    if (initPeerPromiseRef.current) return initPeerPromiseRef.current;
    const pending = (async () => {
      try {
        const { pc, localStream: ls } = await createCallPeerConnection(
          callType === 'video',
          onSignal,
          (stream) => {
            setRemoteStream(stream);
            setMediaLive(true);
          },
        );
        if (endedRef.current) {
          closePeer(pc, ls);
          return;
        }
        pcRef.current = pc;
        localStreamRef.current = ls;
        if (ls) setLocalStream(ls);

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') setMediaLive(true);
        };

        // Any signals that raced the peer connection mount are replayed now.
        flushPendingSignals();
      } finally {
        initPeerPromiseRef.current = null;
      }
    })();
    initPeerPromiseRef.current = pending;
    return pending;
  }, [callType, onSignal, flushPendingSignals]);

  // Load the call row once.
  useEffect(() => {
    let active = true;
    void callsApi
      .get(callId)
      .then(({ call: row }) => {
        if (!active) return;
        if (row.status !== 'ringing' && row.status !== 'ongoing') {
          Alert.alert('Call ended', 'This call is no longer active', [
            { text: 'OK', onPress: () => router.back() },
          ]);
          return;
        }
        setCall(row);
        setPeerOnline(row.online);
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

  // Claim the call route (so push taps / socket events don't stack a second
  // call screen) and put the audio session into WebRTC mode — earpiece for
  // voice calls, loudspeaker for video. Restore everything on unmount.
  useEffect(() => {
    claimActiveCallScreen(callId);
    void routeCallAudio(callType === 'video');
    return () => {
      releaseActiveCallScreen(callId);
      stopCallTone();
      void resetCallAudioMode();
    };
  }, [callId, callType]);

  // Establish the peer connection and drive the offer/answer handshake.
  // Caller: re-announce the offer until the callee answers.
  // Callee: nudge the caller for an offer until media connects.
  useEffect(() => {
    if (!call) return;
    const timer = setTimeout(() => {
      if (call.isOutgoing) {
        const attemptOffer = () => {
          if (pcRef.current) void sendOffer(pcRef.current, onSignal).catch(() => undefined);
        };
        // Send the first offer as soon as the peer connection is live (initPeer
        // is async: getUserMedia + ICE load take a moment) rather than waiting
        // for the 2.5s retry tick.
        void initPeer().then(attemptOffer);
        offerTimer.current = setInterval(() => {
          if (answerReceived.current || endedRef.current) {
            stopOfferLoop();
            return;
          }
          attemptOffer();
        }, 2500);
      } else if ((call.status === 'ongoing' || incomingAccepted) && peerId) {
        const requestOffer = () => {
          if (endedRef.current || answerReceived.current) return;
          if (pcRef.current) sendCallSignal(peerId, callId, 'request-offer', {});
        };
        void initPeer().then(requestOffer);
        offerTimer.current = setInterval(() => {
          if (pcRef.current?.connectionState === 'connected' || endedRef.current) {
            stopOfferLoop();
            return;
          }
          requestOffer();
        }, 2500);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      stopOfferLoop();
    };
  }, [call, peerId, callId, incomingAccepted, initPeer, onSignal, stopOfferLoop]);

  // Relay WebRTC signaling. Signals arriving before the peer connection is
  // ready are buffered instead of dropped, so an offer that races the screen
  // mount is never lost.
  useSocketEvent<SignalEvent>('call:signal', (event) => {
    if (event.callId !== callId || endedRef.current) return;
    if (!pcRef.current) {
      pendingSignalsRef.current.push(event);
      return;
    }
    processSignal(event);
  });

  // Call duration clock while the media session is live.
  useEffect(() => {
    if (!mediaLive) return;
    const start = call?.answeredAt ? new Date(call.answeredAt).getTime() : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [mediaLive, call?.answeredAt]);

  // Peer lifecycle events for this call.
  const endLocal = useCallback(
    (message?: string) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopOfferLoop();
      closePeer(pcRef.current, localStreamRef.current);
      pcRef.current = null;
      localStreamRef.current = null;
      if (message) Alert.alert('Call ended', message);
      router.back();
    },
    [stopOfferLoop],
  );

  useSocketEvent<{ call: CallDTO }>('call:ongoing', (event) => {
    if (event.call.id !== callId) return;
    // Persist the server-accepted state (answeredAt drives the timer).
    setCall(event.call);
  });
  useSocketEvent<PresenceUpdateEvent>('presence:update', (event) => {
    if (event.userId === peerId) setPeerOnline(event.online);
  });

  useSocketEvent<{ call: CallDTO }>('call:ended', (event) => {
    if (event.call.id !== callId) return;
    endLocal('The call ended');
  });
  useSocketEvent<{ call: CallDTO }>('call:missed', (event) => {
    if (event.call.id !== callId) return;
    endLocal('No answer');
  });
  useSocketEvent<{ call: CallDTO }>('call:cancelled', (event) => {
    if (event.call.id !== callId) return;
    endLocal('The call was cancelled');
  });
  useSocketEvent<{ call: CallDTO }>('call:rejected', (event) => {
    if (event.call.id !== callId) return;
    endLocal('The call was declined');
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

  const toggleMute = () => {
    const next = !muted;
    setLocalTracksEnabled(localStreamRef.current, 'audio', !next);
    setMuted(next);
  };

  const toggleSpeaker = () => {
    setSpeakerOn((prev) => {
      const next = !prev;
      void routeCallAudio(next);
      return next;
    });
  };

  // Incoming call answered from this screen (push-tap entry): flip the server
  // state, then the effect above spins up media + the offer handshake.
  const acceptCall = () => {
    if (incomingAccepted) return;
    setIncomingAccepted(true);
    void callsApi.updateStatus(callId, 'accepted').catch(() => undefined);
  };

  const rejectCall = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    void callsApi.updateStatus(callId, 'rejected').catch(() => undefined);
    router.back();
  };

  const isVideo = callType === 'video';
  const showPeer = !!remoteStream;
  const peerName = call?.peerName ?? 'Contact';
  const ringingIncoming = !outgoing && call?.status === 'ringing' && !incomingAccepted;

  const statusLine = ringingIncoming
    ? 'Ringing…'
    : mediaLive
      ? `Connected · ${formatElapsed(elapsed)}`
      : outgoing
        ? peerOnline
          ? 'Ringing…'
          : 'Calling…'
        : call?.status === 'ongoing'
          ? 'Connecting…'
          : 'Ringing…';

  // Dial tone while calling, ringtone while being called — silenced as soon as
  // media connects (or the screen unmounts).
  useEffect(() => {
    if (mediaLive || endedRef.current) {
      stopCallTone();
      return;
    }
    if (ringingIncoming) startCallTone('ringtone');
    else if (outgoing) startCallTone('ringback');
  }, [mediaLive, ringingIncoming, outgoing]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: '#0B141A' }]}>
      <StatusBar style="light" />
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
          <Text style={styles.statusLine}>{statusLine}</Text>
        </View>
      )}

      {isVideo && localStream && (
        <RTCView
          streamURL={localStream.toURL()}
          style={[styles.localVideo, { top: insets.top + 12 }]}
          objectFit="cover"
          mirror
          zOrder={1}
        />
      )}

      {ringingIncoming ? (
        <View style={styles.controls}>
          <Pressable style={[styles.controlBtn, styles.declineBtn]} onPress={rejectCall}>
            <Ionicons name="call" size={26} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
          <Pressable style={[styles.controlBtn, styles.acceptBtn]} onPress={acceptCall}>
            <Ionicons name="call" size={26} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : (
        <View style={styles.controls}>
          <Pressable style={styles.controlBtn} onPress={toggleMute}>
            <Ionicons name={muted ? 'mic-off' : 'mic'} size={24} color="#FFFFFF" />
          </Pressable>
          <Pressable style={[styles.controlBtn, styles.endBtn]} onPress={hangup}>
            <Ionicons name="call" size={30} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
          <Pressable style={styles.controlBtn} onPress={toggleSpeaker}>
            <Ionicons name={speakerOn ? 'volume-high' : 'volume-low'} size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      )}
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
  acceptBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#25D366',
  },
  declineBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E5423D',
  },
});