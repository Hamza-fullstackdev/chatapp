import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

/**
 * Subscribe to push responses (tap or action button) and dispatch on the
 * payload plus the identifier of the action that triggered it
 * (`Notifications.DEFAULT_ACTION_IDENTIFIER` for a plain tap).
 */
export function useNotificationResponses(
  onOpen: (data: Record<string, unknown>, actionIdentifier: string) => void,
): void {
  useEffect(() => {
    const handle = (
      data: Record<string, unknown> | undefined | null,
      actionIdentifier: string,
    ) => {
      if (data) onOpen(data, actionIdentifier);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handle(response.notification.request.content.data, response.actionIdentifier);
    });
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) handle(last.notification.request.content.data, last.actionIdentifier);
    });
    return () => {
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}