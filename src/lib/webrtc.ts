import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
  type MediaStreamTrack,
} from 'react-native-webrtc';
import { callsApi } from '@/lib/api';
import type { IceServerDTO } from '@/types/api';

export interface SignalData {
  type: 'offer' | 'answer' | 'ice' | 'request-offer';
  data: unknown;
}

export interface OutboundSignal {
  type: 'offer' | 'answer' | 'ice';
  data: unknown;
}

const fallbackIceServers: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let cachedIceServers: RTCIceServer[] | null = null;

/**
 * Fetch the ICE servers (STUN + optional short-lived TURN credentials) the
 * server publishes for call media. Falls back to public STUN when the request
 * fails so a call can still start (and succeed on networks with permissive
 * NATs). Values are cached for the app lifetime.
 */
async function loadIceServers(): Promise<RTCIceServer[]> {
  if (cachedIceServers) return cachedIceServers;
  try {
    const { iceServers } = await callsApi.iceConfig();
    const servers = (Array.isArray(iceServers) ? iceServers : []).map(toRtcIceServer);
    if (servers.length > 0) {
      cachedIceServers = servers;
      return servers;
    }
  } catch {
    // Fall through to the static STUN list below.
  }
  cachedIceServers = fallbackIceServers;
  return fallbackIceServers;
}

function toRtcIceServer(dto: IceServerDTO): RTCIceServer {
  return {
    urls: dto.urls,
    username: dto.username,
    credential: dto.credential,
  };
}

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
 * Every ICE candidate this side has gathered for a connection. Offers are
 * re-announced (a callee may recover a copy that raced its mount), and each
 * re-announcement replays the gathered candidates so none are ever lost to a
 * peer that was not listening yet — the classic "offer arrives but ICE never
 * does" failure mode.
 */
const gatheredIce = new WeakMap<RTCPeerConnection, RTCIceCandidate[]>();

function storeGatheredCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidate): void {
  const list = gatheredIce.get(pc) ?? [];
  list.push(candidate);
  gatheredIce.set(pc, list);
}

function gatheredFor(pc: RTCPeerConnection): RTCIceCandidate[] {
  return gatheredIce.get(pc) ?? [];
}

/**
 * Resolve once the connection has finished gathering ICE candidates (or after
 * a safety timeout). Used to make the first offer bundle every candidate into
 * the SDP — non-trickle — so a peer that missed the individual `ice` packets
 * still gets a fully routable offer on the very first attempt.
 */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      pc.onicegatheringstatechange = null;
      clearTimeout(timer);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    pc.onicegatheringstatechange = onState;
    timer = setTimeout(finish, timeoutMs);
  });
}

/** Re-broadcast every candidate gathered so far (used when re-announcing an offer). */
function reemitGatheredIce(pc: RTCPeerConnection, onSignal: (packet: OutboundSignal) => void): void {
  for (const candidate of gatheredFor(pc)) {
    onSignal({ type: 'ice', data: candidate.toJSON() });
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
  const iceServers = await loadIceServers();
  const pc = new RTCPeerConnection({ iceServers });
  const localStream = await captureLocalStream(video);

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (event: { candidate?: RTCIceCandidate }) => {
    if (event.candidate) {
      storeGatheredCandidate(pc, event.candidate);
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
  if (signal.type === 'request-offer') {
    // A peer that joined (or recovered) the call asks for our current offer so
    // it never has to wait for the next re-announcement tick. Hold off until
    // gathering completes so the returned offer carries every ICE candidate.
    if (pc.localDescription && pc.localDescription.type === 'offer') {
      await waitForIceGathering(pc);
      return { type: 'offer', data: pc.localDescription.toJSON() };
    }
    return null;
  }
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
 * (with its gathered ICE candidates back-ported into the SDP and re-sent
 * individually) lets the callee recover a copy that arrived before its peer
 * connection was ready, instead of the offer being lost forever.
 */
export async function sendOffer(pc: RTCPeerConnection, onSignal: (packet: OutboundSignal) => void) {
  if (pc.remoteDescription) {
    return;
  }
  if (pc.localDescription && pc.localDescription.type === 'offer') {
    onSignal({ type: 'offer', data: pc.localDescription.toJSON() });
    reemitGatheredIce(pc, onSignal);
    return;
  }
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await pc.setLocalDescription(offer);
  // Two-stage handshake help: bundle the gathered candidates into the SDP
  // before announcing so a peer that missed the trickled `ice` packets still
  // receives a fully routable offer.
  await waitForIceGathering(pc);
  if (pc.localDescription) {
    onSignal({ type: 'offer', data: pc.localDescription.toJSON() });
    reemitGatheredIce(pc, onSignal);
  }
}

export function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
}

/**
 * Mute/unmute every local track of a given kind (audio or video) without
 * tearing down the peer connection — the remote side simply hears/sees silence.
 */
export function setLocalTracksEnabled(
  stream: MediaStream | null,
  kind: 'audio' | 'video',
  enabled: boolean,
): void {
  stream
    ?.getTracks()
    .filter((t: MediaStreamTrack) => t.kind === kind)
    .forEach((t: MediaStreamTrack) => {
      t.enabled = enabled;
    });
}

export function closePeer(pc: RTCPeerConnection | null, stream: MediaStream | null) {
  stopTracks(stream);
  pc?.close();
}

export { MediaStream };