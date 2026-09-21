let activeConversationId: string | null = null;

/**
 * Tracks which conversation (if any) is currently open on screen. The
 * realtime sink consults this before bumping the cached unread counter, so a
 * chat the user is actively reading never counts against them (WhatsApp-style).
 */
export function setActiveConversationId(id: string | null): void {
  activeConversationId = id;
}

export function getActiveConversationId(): string | null {
  return activeConversationId;
}