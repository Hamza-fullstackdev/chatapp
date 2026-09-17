import { useEffect } from 'react';
import { router } from 'expo-router';
import { configureNotificationHandler } from '@/lib/notifications';
import { useNotificationResponses } from '@/hooks/use-notification-response';

function navigateFromNotification(data: Record<string, unknown>): void {
  if (data.kind === 'incoming-call' && data.callId) {
    router.push({
      pathname: '/call/[id]',
      params: { id: String(data.callId), type: String(data.callType ?? 'voice') },
    });
    return;
  }
  if (data.conversationId) {
    router.push({ pathname: '/chat/[id]', params: { id: String(data.conversationId) } });
  }
}

/** Sets up the push handler and routes taps into their screens. */
export function NotificationsBridge() {
  useEffect(() => {
    configureNotificationHandler();
  }, []);

  useNotificationResponses(navigateFromNotification);

  return null;
}