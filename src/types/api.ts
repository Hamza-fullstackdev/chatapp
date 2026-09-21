export interface UserDTO {
  id: string;
  fullName: string;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface AttachmentDTO {
  id: string;
  type: string;
  storagePath: string | null;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  thumbnailPath: string | null;
  provider: string | null;
  providerId: string | null;
  previewUrl: string | null;
  gifUrl: string | null;
  /** Client-only: local URI of an in-flight/pending attachment (not serialized). */
  localUri?: string | null;
}

export interface ReactionDTO {
  userId: string;
  emoji: string;
}

export interface MessageDTO {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  type: string;
  text: string | null;
  replyTo: string | null;
  status: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  hasAttachments: boolean;
  attachments: AttachmentDTO[];
  reactions: ReactionDTO[];
}

export interface LastMessageDTO {
  id: string;
  type: string;
  text: string | null;
  senderId: string;
  status: string | null;
  createdAt: string;
  hasAttachments: boolean;
}

export interface ConversationDTO {
  id: string;
  type: 'private' | 'group';
  name: string | null;
  avatarUrl: string | null;
  otherUserId: string | null;
  otherUserName: string | null;
  otherUserAvatarUrl: string | null;
  lastMessage: LastMessageDTO | null;
  unreadCount: number;
  updatedAt: string | null;
}

export interface ConversationDetailDTO {
  conversation: ConversationDTO;
  members: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
    role: string;
  }[];
  messages: MessageDTO[];
}

export interface GroupDetailDTO {
  conversationId: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  memberIds: string[];
  admins: string[];
  myRole: string | null;
}

export interface CallDTO {
  id: string;
  conversationId: string | null;
  callerId: string;
  calleeId: string;
  callType: string;
  status: 'ringing' | 'ongoing' | 'ended' | 'missed' | 'rejected' | 'cancelled';
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  createdAt: string;
  peerId: string;
  peerName: string | null;
  peerAvatarUrl: string | null;
  isOutgoing: boolean;
  online: boolean;
}

export interface StickerDTO {
  id: string;
  bucket: string;
  path: string;
  url: string;
  name: string;
}

export interface UploadTargetDTO {
  bucket: string;
  path: string;
  uploadUrl: string;
  token: string;
  attachment: {
    type: string;
    storagePath: string;
    mimeType: string;
    size?: number;
  };
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: Record<string, unknown>;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: UserDTO;
}

export interface SyncChange {
  id: number;
  entityType: string;
  entityId: string;
  operation: string;
  payload: Record<string, unknown>;
}

export interface SyncResponse {
  cursor: number;
  changes: SyncChange[];
}

export interface SyncPushResult {
  operation: string;
  clientMessageId: string | null;
  idempotencyKey: string;
  status: 'ok' | 'duplicate' | 'unsupported' | 'error';
  message?: string;
  data?: MessageDTO;
}

export interface SyncPushResponse {
  results: SyncPushResult[];
}

// ---------------------------------------------------------------------------
// Socket.IO event payloads (must match src/sockets on the server)
// ---------------------------------------------------------------------------

export interface PresenceUpdateEvent {
  userId: string;
  online: boolean;
  updatedAt: string;
}

export interface TypingUpdateEvent {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface MessageReadEvent {
  conversationId: string;
  messageId: string;
  userId: string;
  readAt: string;
}

export interface MessageDeliveredEvent {
  conversationId: string;
  messageId: string;
  deliveredAt: string;
}

export interface GroupUpdateEvent {
  conversationId: string;
  kind?: string;
  userId?: string;
  userIds?: string[];
  role?: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface IncomingCallEvent {
  call: CallDTO;
  from: { id: string; name?: string | null };
}

export interface CallSignalEvent {
  from: string;
  callId: string;
  type: 'offer' | 'answer' | 'ice' | 'request-offer';
  data: unknown;
}

export interface IceServerDTO {
  urls: string | string[];
  username?: string;
  credential?: string;
}