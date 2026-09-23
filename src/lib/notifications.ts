import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { devicesApi } from '@/lib/api';
import { getDeviceId } from '@/lib/secure';

const PUSH_TOKEN_KEY = 'chat.push.token';

/** Notification category for incoming calls; its actions answer or decline. */
export const CALL_CATEGORY_ID = 'incoming-call';
export const CALL_ACTION_ANSWER = 'answer';
export const CALL_ACTION_DECLINE = 'decline';
/** Android channel incoming-call pushes are delivered on (loud, heads-up). */
export const CALL_CHANNEL_ID = 'calls';

/** True when a push notification carries an incoming-call payload. */
export function isIncomingCallNotification(data: Record<string, unknown> | null | undefined): boolean {
  return !!data && data.kind === 'incoming-call';
}

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
    handleNotification: async (notification) => {
      // Incoming calls are answered by the on-screen call UI (the app plays its
      // own ringtone), so suppress the banner/sound the OS would otherwise
      // bolt on top of it. Everything else keeps the default behaviour.
      const isCall = isIncomingCallNotification(notification.request.content.data);
      return {
        shouldShowBanner: !isCall,
        shouldShowList: true,
        shouldPlaySound: !isCall,
        shouldSetBadge: false,
      };
    },
  });
}

/**
 * Register the artifacts incoming-call pushes rely on:
 *  - an Android "calls" channel (importance MAX so ringing breaks through in
 *    the background), and
 *  - the "incoming-call" category whose Answer / Decline buttons surface on
 *    the lock screen / notification drawer on both platforms.
 */
export async function registerCallNotificationChannel(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CALL_CHANNEL_ID, {
        name: 'Calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 500, 250],
      });
    }
    await Notifications.setNotificationCategoryAsync(CALL_CATEGORY_ID, [
      { identifier: CALL_ACTION_ANSWER, buttonTitle: 'Answer' },
      {
        identifier: CALL_ACTION_DECLINE,
        buttonTitle: 'Decline',
        options: { isDestructive: true },
      },
    ]);
  } catch {
    // Categories/channels are best-effort; calls still ring in-app.
  }
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
  await registerCallNotificationChannel();

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

/**
 * Present a notification immediately (no scheduling delay).
 *
 * The realtime sink calls this so incoming messages always banner — even when
 * the remote push would be skipped (recipient is connected via socket) or no
 * Expo push token exists (no EAS project configured). Tapping it routes to the
 * conversation via `data.conversationId`.
 */
export async function presentIncomingMessageNotification(input: {
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        data: input.data,
        sound: 'default',
      },
      trigger: null,
    });
  } catch {
    // Notifications are best-effort; never let them break message delivery.
  }
}