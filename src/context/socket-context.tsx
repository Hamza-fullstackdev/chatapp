import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { installRealtimeHandlers } from '@/lib/realtime-sink';
import { clearPresence } from '@/lib/presence';

interface SocketValue {
  connected: boolean;
}

const SocketContext = createContext<SocketValue>({ connected: false });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { status, token, user } = useAuth();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (status !== 'signedIn' || !token) return;

    const socket = connectSocket(token);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      clearPresence();
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // Persist every realtime message event to SQLite — no matter which screen
    // is open. The server now fans events out to this user's personal room.
    let uninstall: (() => void) | undefined;
    const userId = user?.id ?? '';
    if (userId) {
      uninstall = installRealtimeHandlers(socket, userId);
    }

    return () => {
      uninstall?.();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      disconnectSocket();
    };
  }, [status, token, user]);

  return <SocketContext.Provider value={{ connected }}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketValue {
  return useContext(SocketContext);
}

/**
 * Subscribe to a socket event with a stable handler. The handler is kept in a
 * ref (updated inside an effect) so re-renders never drop in-flight events or
 * cause re-subscription churn.
 */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}