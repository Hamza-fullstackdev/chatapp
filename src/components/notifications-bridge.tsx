import { useEffect } from 'react';
import { router } from 'expo-router';
import {
  CALL_ACTION_ANSWER,
  CALL_ACTION_DECLINE,
  configureNotificationHandler,
  registerCallNotificationChannel,
} from '@/lib/notifications';
import { useNotificationResponses } from '@/hooks/use-notification-response';
import { callsApi } from '@/lib/api';
import { openCallScreen } from '@/lib/call-routing';

function handleCallResponse(
  callId: string,
  callType: string | undefined,
  actionIdentifier: string,
): void {
  if (actionIdentifier === CALL_ACTION_DECLINE) {
    void callsApi.updateStatus(callId, 'rejected').catch(() => undefined);
    return;
  }
  // Plain tap or "Answer": bring up the ringing/connecting screen and accept —
  // the full-screen UI then runs the WebRTC handshake.
  openCallScreen(callId, callType);
  if (actionIdentifier === CALL_ACTION_ANSWER) {
    void callsApi.updateStatus(callId, 'accepted').catch(() => undefined);
  }
}

function handleNotificationResponse(data: Record<string, unknown>, actionIdentifier: string): void {
  if (data.kind === 'incoming-call' && data.callId) {
    handleCallResponse(String(data.callId), typeof data.callType === 'string' ? data.callType : undefined, actionIdentifier);
    return;
  }
  if (data.conversationId) {
    router.push({ pathname: '/chat/[id]', params: { id: String(data.conversationId) } });
  }
}

/** Sets up the push handler, call channel/category, and routes taps into their screens. */
export function NotificationsBridge() {
  useEffect(() => {
    configureNotificationHandler();
    void registerCallNotificationChannel();
  }, []);

  useNotificationResponses(handleNotificationResponse);

  return null;
}