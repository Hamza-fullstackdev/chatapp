import { io, type Socket } from 'socket.io-client';
import { env } from '@/constants/env';

let socket: Socket | null = null;

/**
 * Connect (or reconnect) the realtime socket using the caller's JWT.
 * Only one socket is ever alive; a previous instance is torn down first.
 */
export function connectSocket(token: string): Socket {
  if (socket) socket.disconnect();
  socket = io(env.apiUrl, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function joinConversation(conversationId: string): void {
  socket?.emit('conversation:join', { conversationId });
}

export function leaveConversation(conversationId: string): void {
  socket?.emit('conversation:leave', { conversationId });
}

export function sendTyping(conversationId: string, isTyping: boolean): void {
  socket?.emit(isTyping ? 'typing:start' : 'typing:stop', { conversationId });
}

export function sendMessageRead(conversationId: string, messageId: string): void {
  socket?.emit('message:read', { conversationId, messageId });
}

/** Relay a WebRTC offer/answer/ICE packet to the target user (server forwards it). */
export function sendCallSignal(
  to: string,
  callId: string,
  type: 'offer' | 'answer' | 'ice',
  data: unknown,
): void {
  socket?.emit('call:signal', { to, callId, type, data });
}