import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { devicesApi } from '@/lib/api';
import { getDeviceId } from '@/lib/secure';

const PUSH_TOKEN_KEY = 'chat.push.token';

async function storePushToken(token: string | null): Promise<void> {
  try {
    if (token) {
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    } else {
      await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
    }
  } catch {
    // Non-fatal: next launch re-registers.
  }
}

export async function readStoredPushToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Request permission, obtain the Expo push token and register the device so
 * the API can push to it. Safe to call on every sign-in.
 */
export async function registerDeviceForPush(): Promise<void> {
  const id = await getDeviceId();
  await devicesApi.register({
    deviceIdentifier: id,
    platform: Platform.OS,
    name: `${Platform.OS}-${id.slice(0, 8)}`,
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  let token: string | undefined;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
    token = expoToken.data;
  } catch {
    token = undefined;
  }
  if (!token) return;

  await storePushToken(token);
  try {
    await devicesApi.setPushToken(token);
  } catch {
    // The server may reject a duplicate; pushing still works for other installs.
  }
}

export async function unregisterDevice(): Promise<void> {
  const token = await readStoredPushToken();
  if (!token) return;
  try {
    await devicesApi.removePushToken(token);
  } catch {
    // Best-effort: token re-registration happens at the next sign-in.
  }
  await storePushToken(null);
}