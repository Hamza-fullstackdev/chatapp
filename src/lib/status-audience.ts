import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StatusAudience } from '@/types/api';

export interface StatusAudienceSelection {
  audience: StatusAudience;
  excludeUserIds: string[];
  includeUserIds: string[];
}

const STORAGE_KEY = 'chat.status.audience';

/**
 * Remembered audience for the *next* status the user posts (like WhatsApp).
 * Persisted on-device so the chosen settings apply again after a restart.
 */
export async function getStatusAudience(): Promise<StatusAudienceSelection | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StatusAudienceSelection>;
    if (!parsed || typeof parsed.audience !== 'string') return null;
    return {
      audience: parsed.audience as StatusAudience,
      excludeUserIds: Array.isArray(parsed.excludeUserIds) ? parsed.excludeUserIds : [],
      includeUserIds: Array.isArray(parsed.includeUserIds) ? parsed.includeUserIds : [],
    };
  } catch {
    return null;
  }
}

export async function setStatusAudience(selection: StatusAudienceSelection): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      audience: selection.audience,
      excludeUserIds: selection.excludeUserIds ?? [],
      includeUserIds: selection.includeUserIds ?? [],
    }),
  );
}

export async function resetStatusAudience(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}