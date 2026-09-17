import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';

interface SocketValue {
  connected: boolean;
}

const SocketContext = createContext<SocketValue>({ connected: false });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { status, token } = useAuth();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (status !== 'signedIn' || !token) return;

    const socket = connectSocket(token);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      disconnectSocket();
    };
  }, [status, token]);

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