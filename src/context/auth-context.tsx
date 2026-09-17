import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadAuth, saveAuth, clearAuth } from '@/lib/storage';
import { setAuthToken, setSessionExpiredHandler } from '@/lib/api-client';
import { authApi } from '@/lib/api';
import { setRefreshToken } from '@/lib/secure';
import { registerDeviceForPush, unregisterDevice } from '@/lib/notifications';
import type { UserDTO } from '@/types/api';

type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

interface AuthValue {
  status: AuthStatus;
  user: UserDTO | null;
  token: string | null;
  signIn: (identifier: string, code: string) => Promise<void>;
  completeAuth: (token: string, user: UserDTO, refreshToken?: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (user: UserDTO) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserDTO | null>(null);
  const [token, setTokenState] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { token: storedToken, user: storedUser } = await loadAuth();
      if (!active) return;
      if (storedToken && storedUser) {
        setAuthToken(storedToken);
        setTokenState(storedToken);
        setUser(storedUser);
        setStatus('signedIn');
      } else {
        setStatus('signedOut');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const applyCredentials = async (newToken: string, authedUser: UserDTO) => {
    setAuthToken(newToken);
    await saveAuth(newToken, authedUser);
    setTokenState(newToken);
    setUser(authedUser);
    setStatus('signedIn');
    void registerDeviceForPush().catch(() => undefined);
  };

  const signIn = async (identifier: string, code: string) => {
    const { token: newToken, refreshToken, user: authedUser } = await authApi.login(identifier, code);
    await setRefreshToken(refreshToken);
    await applyCredentials(newToken, authedUser);
  };

  const completeAuth = async (newToken: string, user: UserDTO, refreshToken?: string) => {
    if (refreshToken) await setRefreshToken(refreshToken);
    await applyCredentials(newToken, user);
  };

  const signOut = async () => {
    setAuthToken(null);
    await setRefreshToken(null);
    await clearAuth();
    setTokenState(null);
    setUser(null);
    setStatus('signedOut');
    void unregisterDevice().catch(() => undefined);
  };

  // When the API client exhausts a refresh attempt, force a local sign-out so
  // the user re-authenticates with fresh credentials.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      void signOut();
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const updateUser = (next: UserDTO) => {
    setUser(next);
    if (token) void saveAuth(token, next);
  };

  return (
    <AuthContext.Provider value={{ status, user, token, signIn, completeAuth, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}