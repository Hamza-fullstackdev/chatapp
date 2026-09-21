import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
  type MediaStreamTrack,
} from 'react-native-webrtc';

export interface SignalData {
  type: 'offer' | 'answer' | 'ice';
  data: unknown;
}

export interface OutboundSignal {
  type: 'offer' | 'answer' | 'ice';
  data: unknown;
}

const iceServers: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function captureLocalStream(video: boolean): Promise<MediaStream | null> {
  try {
    return await mediaDevices.getUserMedia({
      audio: true,
      video: video ? { facingMode: 'user', width: 640, height: 480 } : false,
    });
  } catch {
    // Audio-only fallback when camera permission is missing.
    try {
      return await mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      return null;
    }
  }
}

/**
 * Create a peer connection bound to a signal emitter. All outgoing
 * offer/answer/ICE packets are forwarded through `onSignal` so the caller can
 * relay them over the socket; inbound remote streams surface via `onRemoteStream`.
 */
export async function createCallPeerConnection(
  video: boolean,
  onSignal: (packet: OutboundSignal) => void,
  onRemoteStream: (stream: MediaStream) => void,
): Promise<{ pc: RTCPeerConnection; localStream: MediaStream | null }> {
  const pc = new RTCPeerConnection({ iceServers });
  const localStream = await captureLocalStream(video);

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (event: { candidate?: RTCIceCandidate }) => {
    if (event.candidate) {
      onSignal({ type: 'ice', data: event.candidate.toJSON() });
    }
  };

  pc.ontrack = (event: { streams?: MediaStream[] }) => {
    const remote = event.streams?.[0];
    if (remote) onRemoteStream(remote);
  };

  return { pc, localStream };
}

type DescPayload = { type?: string; sdp?: string };

function toDescription(payload: unknown): RTCSessionDescription {
  const raw = (payload ?? {}) as DescPayload;
  return new RTCSessionDescription({
    type: (raw.type ?? 'offer') as 'offer' | 'answer' | 'pranswer' | 'rollback',
    sdp: raw.sdp ?? '',
  });
}

function toCandidate(payload: unknown): RTCIceCandidate {
  const raw = (payload ?? {}) as Record<string, unknown>;
  return new RTCIceCandidate({
    candidate: typeof raw.candidate === 'string' ? raw.candidate : '',
    sdpMLineIndex: typeof raw.sdpMLineIndex === 'number' ? raw.sdpMLineIndex : 0,
    sdpMid: typeof raw.sdpMid === 'string' ? raw.sdpMid : null,
  });
}

/**
 * ICE candidates cannot be added before a remote description exists; any that
 * overtake the offer/answer are buffered per connection and flushed the moment
 * the remote description lands (candidate order is preserved).
 */
const pendingIce = new WeakMap<RTCPeerConnection, RTCIceCandidate[]>();

async function flushPendingIce(pc: RTCPeerConnection): Promise<void> {
  const buffered = pendingIce.get(pc);
  if (!buffered) return;
  pendingIce.delete(pc);
  for (const candidate of buffered) {
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // Candidate turned stale while buffered — safe to ignore.
    }
  }
}

/**
 * Apply a relayed signal. Returns an outbound packet when the peer must answer.
 */
export async function handleIncomingSignal(
  pc: RTCPeerConnection,
  signal: SignalData,
): Promise<OutboundSignal | null> {
  if (signal.type === 'offer') {
    await pc.setRemoteDescription(toDescription(signal.data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await flushPendingIce(pc);
    return { type: 'answer', data: pc.localDescription?.toJSON() };
  }
  if (signal.type === 'answer') {
    await pc.setRemoteDescription(toDescription(signal.data));
    await flushPendingIce(pc);
    return null;
  }
  if (signal.type === 'ice') {
    const candidate = toCandidate(signal.data);
    if (!pc.remoteDescription) {
      // Offer/answer has not been applied yet — queue it instead of losing it.
      const buffered = pendingIce.get(pc) ?? [];
      buffered.push(candidate);
      pendingIce.set(pc, buffered);
      return null;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // Candidate arrived after the connection stabilized — safe to ignore.
    }
    return null;
  }
  return null;
}

/**
 * Create (or re-announce) the local offer. The retry loop in the call screen
 * calls this repeatedly until the peer answers; re-emitting the existing offer
 * lets the callee recover a copy that arrived before its peer connection was
 * ready, instead of the offer being lost forever.
 */
export async function sendOffer(pc: RTCPeerConnection, onSignal: (packet: OutboundSignal) => void) {
  if (pc.remoteDescription) {
    return;
  }
  if (pc.localDescription && pc.localDescription.type === 'offer') {
    onSignal({ type: 'offer', data: pc.localDescription.toJSON() });
    return;
  }
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await pc.setLocalDescription(offer);
  if (pc.localDescription) {
    onSignal({ type: 'offer', data: pc.localDescription.toJSON() });
  }
}

export function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
}

export function closePeer(pc: RTCPeerConnection | null, stream: MediaStream | null) {
  stopTracks(stream);
  pc?.close();
}

export { MediaStream };