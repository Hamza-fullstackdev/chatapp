import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REFRESH_KEY = 'chat.auth.refresh';
const DEVICE_KEY = 'chat.device.id';

/** SecureStore is iOS/Android only; web falls back to AsyncStorage. */
function isNative(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function setRefreshToken(token: string | null): Promise<void> {
  if (isNative()) {
    if (token) {
      await SecureStore.setItemAsync(REFRESH_KEY, token);
    } else {
      await SecureStore.deleteItemAsync(REFRESH_KEY);
    }
  } else if (token) {
    await AsyncStorage.setItem(REFRESH_KEY, token);
  } else {
    await AsyncStorage.removeItem(REFRESH_KEY);
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    if (isNative()) {
      return await SecureStore.getItemAsync(REFRESH_KEY);
    }
    return await AsyncStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export async function clearRefreshToken(): Promise<void> {
  if (isNative()) {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  } else {
    await AsyncStorage.removeItem(REFRESH_KEY);
  }
}

/** A stable per-install identifier used to register this device/server. */
export async function getDeviceId(): Promise<string> {
  try {
    const existing = isNative()
      ? await SecureStore.getItemAsync(DEVICE_KEY)
      : await AsyncStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = Crypto.randomUUID();
    if (isNative()) {
      await SecureStore.setItemAsync(DEVICE_KEY, id);
    } else {
      await AsyncStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return Crypto.randomUUID();
  }
}