import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserDTO } from '@/types/api';

const TOKEN_KEY = 'chat.auth.token';
const USER_KEY = 'chat.auth.user';

export async function loadAuth(): Promise<{ token: string | null; user: UserDTO | null }> {
  const [token, userRaw] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(USER_KEY),
  ]);
  let user: UserDTO | null = null;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as UserDTO;
    } catch {
      user = null;
    }
  }
  return { token, user };
}

export async function saveAuth(token: string, user: UserDTO): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(TOKEN_KEY, token),
    AsyncStorage.setItem(USER_KEY, JSON.stringify(user)),
  ]);
}

export async function clearAuth(): Promise<void> {
  await Promise.all([AsyncStorage.removeItem(TOKEN_KEY), AsyncStorage.removeItem(USER_KEY)]);
}