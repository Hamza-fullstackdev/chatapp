import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadAuth, saveAuth, clearAuth } from '@/lib/storage';
import { setAuthToken, setSessionExpiredHandler } from '@/lib/api-client';
import { authApi } from '@/lib/api';
import { setRefreshToken } from '@/lib/secure';
import { registerDeviceForPush, unregisterDevice } from '@/lib/notifications';
import { getDb, purgeDatabase } from '@/db/database';
import { getKv, setKv, upsertUserProfile } from '@/db/repositories';
import type { UserDTO } from '@/types/api';

const DB_USER_KEY = 'db_user_id';

type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

interface AuthValue {
  status: AuthStatus;
  user: UserDTO | null;
  token: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  completeAuth: (token: string, user: UserDTO, refreshToken?: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (user: UserDTO) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserDTO | null>(null);
  const [token, setTokenState] = useState<string | null>(null);

  const persistProfile = (u: UserDTO) => {
    void (async () => {
      const db = await getDb();
      await upsertUserProfile(db, {
        id: u.id,
        fullName: u.fullName,
        username: u.username,
        bio: u.bio,
        avatarUrl: u.avatarUrl,
        lastSeenAt: u.lastSeenAt,
      });
    })().catch(() => undefined);
  };

  // The on-device SQLite cache belongs to a single account. If a different user
  // id signs in (new account, or another account on a shared device), wipe the
  // cache first so nobody ever sees another account's chats, messages, media or
  // call history. The owning user id is remembered in app_kv across restarts.
  const ensureUserScoped = async (userId: string) => {
    const db = await getDb();
    const owner = await getKv(db, DB_USER_KEY);
    if (owner === userId) return;
    await purgeDatabase();
    await setKv(await getDb(), DB_USER_KEY, userId);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const { token: storedToken, user: storedUser } = await loadAuth();
      if (!active) return;
      if (storedToken && storedUser) {
        setAuthToken(storedToken);
        await ensureUserScoped(storedUser.id).catch(() => undefined);
        persistProfile(storedUser);
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
    await ensureUserScoped(authedUser.id).catch(() => undefined);
    await saveAuth(newToken, authedUser);
    persistProfile(authedUser);
    setTokenState(newToken);
    setUser(authedUser);
    setStatus('signedIn');
    void registerDeviceForPush().catch(() => undefined);
  };

  const signIn = async (username: string, password: string) => {
    const { token: newToken, refreshToken, user: authedUser } = await authApi.login(username, password);
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
    persistProfile(next);
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