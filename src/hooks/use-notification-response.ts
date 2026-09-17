import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

/** Subscribe to push-tap navigation and dispatch on the data payload. */
export function useNotificationResponses(onOpen: (data: Record<string, unknown>) => void): void {
  useEffect(() => {
    const handle = (data: Record<string, unknown> | undefined | null) => {
      if (data) onOpen(data);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handle(response.notification.request.content.data);
    });
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) handle(last.notification.request.content.data);
    });
    return () => {
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}