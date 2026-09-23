import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type CallToneKind = 'ringback' | 'ringtone';

const RINGBACK_SOURCE = require('@/assets/audio/ringback.wav');
const RINGTONE_SOURCE = require('@/assets/audio/ringtone.wav');

const RINGBACK_VOLUME = 0.45;
const RINGTONE_VOLUME = 0.7;

/**
 * Single shared ringtone/ringback player. Both the caller and the callee start
 * a tone from their own screens/context, so this is a module-level singleton to
 * guarantee only one sound ever plays at a time (and that starting a ringback
 * while a ringtone is already looping simply swaps the source).
 */
let player: AudioPlayer | null = null;
let toneKind: CallToneKind | null = null;

/** Play (or restart) a looping call tone: ringback while dialling, ringtone while being called. */
export function startCallTone(kind: CallToneKind): void {
  if (toneKind === kind && player) return;
  stopCallTone();
  try {
    const next = createAudioPlayer(kind === 'ringback' ? RINGBACK_SOURCE : RINGTONE_SOURCE, {
      updateInterval: 200,
      keepAudioSessionActive: true,
    });
    next.loop = true;
    next.volume = kind === 'ringback' ? RINGBACK_VOLUME : RINGTONE_VOLUME;
    player = next;
    toneKind = kind;
    next.play();
    void routeCallAudio(false);
  } catch {
    // Best-effort sound — never break the call flow over a missing tone.
  }
}

/** Stop any playing call tone and release the shared player. */
export function stopCallTone(): void {
  const current = player;
  player = null;
  toneKind = null;
  if (!current) return;
  try {
    current.pause();
  } catch {
    // No-op — the player may already be released.
  }
  try {
    current.remove();
  } catch {
    // No-op — the player may already be released.
  }
}

/**
 * Route call audio between the earpiece and the loudspeaker.
 * `shouldRouteThroughEarpiece` is respected on both platforms by expo-audio
 * (Android toggles MODE_IN_COMMUNICATION / speakerphone-on).
 * `allowsRecording` keeps iOS in the .playAndRecord category so the WebRTC mic
 * and the overridden output port both work.
 */
export async function routeCallAudio(speakerOn: boolean): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      shouldRouteThroughEarpiece: !speakerOn,
    });
  } catch {
    // Non-fatal: the OS default routing remains in place.
  }
}

/**
 * Return the global audio session to its non-call defaults (the mode used by
 * the rest of the app for voice-note playback).
 */
export async function resetCallAudioMode(): Promise<void> {
  stopCallTone();
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    // Non-fatal.
  }
}