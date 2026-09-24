import { http } from './api-client';
import type {
  AuthResponse,
  CallDTO,
  ConversationDTO,
  ConversationDetailDTO,
  FriendRequestDTO,
  GroupDetailDTO,
  IceServerDTO,
  MessageDTO,
  ReactionDTO,
  StickerDTO,
  StatusAudience,
  StatusDTO,
  StatusViewerDTO,
  SyncPushResponse,
  SyncResponse,
  UploadTargetDTO,
  UserDTO,
} from '@/types/api';

export type AttachmentPayload = {
  type: string;
  storagePath?: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  thumbnailPath?: string;
  provider?: string;
  providerId?: string;
  previewUrl?: string;
  gifUrl?: string;
};

export const authApi = {
  login(username: string, password: string): Promise<AuthResponse> {
    return http.post<AuthResponse>('/api/auth/login', { username, password });
  },
  register(input: {
    fullName: string;
    username: string;
    password: string;
    bio?: string | null;
  }): Promise<AuthResponse> {
    return http.post<AuthResponse>('/api/auth/register', input);
  },
  logout(): Promise<{ ok: boolean }> {
    return http.post<{ ok: boolean }>('/api/auth/logout');
  },
  me(): Promise<UserDTO> {
    return http.get<UserDTO>('/api/auth/me');
  },
  updateMe(input: {
    fullName?: string;
    username?: string;
    bio?: string | null;
    avatarUrl?: string | null;
  }): Promise<UserDTO> {
    return http.patch<UserDTO>('/api/auth/me', input);
  },
  changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    return http.post<{ ok: boolean }>('/api/auth/password', {
      currentPassword,
      newPassword,
    });
  },
  deleteAccount(): Promise<{ ok: boolean }> {
    return http.delete<{ ok: boolean }>('/api/users/me');
  },
};

export const usersApi = {
  list(search?: string): Promise<{ users: UserDTO[] }> {
    return http.get<{ users: UserDTO[] }>('/api/users', { search });
  },
  get(id: string): Promise<UserDTO> {
    return http.get<UserDTO>(`/api/users/${id}`);
  },
};

export const friendRequestsApi = {
  list(): Promise<{ incoming: FriendRequestDTO[]; outgoing: FriendRequestDTO[] }> {
    return http.get<{ incoming: FriendRequestDTO[]; outgoing: FriendRequestDTO[] }>(
      '/api/friend-requests',
    );
  },
  send(receiverId: string): Promise<{ request: FriendRequestDTO }> {
    return http.post<{ request: FriendRequestDTO }>('/api/friend-requests', { receiverId });
  },
  accept(id: string): Promise<{ request: FriendRequestDTO }> {
    return http.post<{ request: FriendRequestDTO }>(`/api/friend-requests/${id}/accept`);
  },
  reject(id: string): Promise<{ request: FriendRequestDTO }> {
    return http.post<{ request: FriendRequestDTO }>(`/api/friend-requests/${id}/reject`);
  },
};

export const conversationsApi = {
  list(): Promise<{ conversations: ConversationDTO[] }> {
    return http.get<{ conversations: ConversationDTO[] }>('/api/conversations');
  },
  detail(id: string): Promise<ConversationDetailDTO> {
    return http.get<ConversationDetailDTO>(`/api/conversations/${id}`);
  },
  createPrivate(userId: string): Promise<{ conversation: ConversationDTO }> {
    return http.post<{ conversation: ConversationDTO }>('/api/conversations/private', { userId });
  },
  createGroup(
    name: string,
    memberIds: string[],
    opts: { description?: string | null; avatarUrl?: string | null } = {},
  ): Promise<{ conversation: ConversationDTO }> {
    return http.post<{ conversation: ConversationDTO }>('/api/conversations/group', {
      name,
      memberIds,
      description: opts.description,
      avatarUrl: opts.avatarUrl,
    });
  },
  markRead(id: string): Promise<{ ok: boolean }> {
    return http.post<{ ok: boolean }>(`/api/conversations/${id}/read`);
  },
  remove(conversationIds: string[]): Promise<{ deletedIds: string[] }> {
    return http.post<{ deletedIds: string[] }>('/api/conversations/bulk-delete', { conversationIds });
  },
};

export const messagesApi = {
  list(
    conversationId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<{ messages: MessageDTO[] }> {
    return http.get<{ messages: MessageDTO[] }>(`/api/messages/${conversationId}`, {
      limit: opts.limit ?? 50,
      before: opts.before,
    });
  },
  send(
    conversationId: string,
    input: {
      text?: string;
      clientMessageId: string;
      type?: string;
      replyTo?: string;
      attachment?: AttachmentPayload;
    },
  ): Promise<{ message: MessageDTO }> {
    return http.post<{ message: MessageDTO }>(`/api/messages/${conversationId}`, input);
  },
  edit(messageId: string, input: { text?: string; attachment?: AttachmentPayload }): Promise<{ message: MessageDTO }> {
    return http.patch<{ message: MessageDTO }>(`/api/messages/${messageId}`, input);
  },
  delete(messageId: string): Promise<{ id: string; conversationId: string; deletedAt: string }> {
    return http.delete<{ id: string; conversationId: string; deletedAt: string }>(
      `/api/messages/${messageId}`,
    );
  },
  deleteMany(messageIds: string[]): Promise<{ deletedIds: string[] }> {
    return http.post<{ deletedIds: string[] }>('/api/messages/bulk-delete', { messageIds });
  },
  toggleReaction(messageId: string, emoji: string): Promise<{ reactions: ReactionDTO[] }> {
    return http.post<{ reactions: ReactionDTO[] }>(`/api/messages/${messageId}/reactions`, { emoji });
  },
  removeReaction(messageId: string, emoji: string): Promise<{ reactions: ReactionDTO[] }> {
    return http.delete<{ reactions: ReactionDTO[] }>(`/api/messages/${messageId}/reactions/${emoji}`);
  },
};

export const groupsApi = {
  detail(id: string): Promise<GroupDetailDTO> {
    return http.get<GroupDetailDTO>(`/api/groups/${id}`);
  },
  update(
    id: string,
    input: { name?: string; description?: string | null; avatarUrl?: string | null },
  ): Promise<{ group: { conversationId: string; name: string | null; avatarUrl: string | null } }> {
    return http.patch<{ group: { conversationId: string; name: string | null; avatarUrl: string | null } }>(
      `/api/groups/${id}`,
      input,
    );
  },
  addMembers(id: string, userIds: string[]): Promise<{ ok: boolean }> {
    return http.post<{ ok: boolean }>(`/api/groups/${id}/members`, { userIds });
  },
  removeMember(id: string, userId: string): Promise<{ ok: boolean }> {
    return http.delete<{ ok: boolean }>(`/api/groups/${id}/members/${userId}`);
  },
  promote(id: string, userId: string): Promise<{ ok: boolean }> {
    return http.post<{ ok: boolean }>(`/api/groups/${id}/members/${userId}/promote`);
  },
  demote(id: string, userId: string): Promise<{ ok: boolean }> {
    return http.post<{ ok: boolean }>(`/api/groups/${id}/members/${userId}/demote`);
  },
};

export const uploadsApi = {
  sign(input: { bucket: string; contentType: string; fileName?: string; size?: number }): Promise<UploadTargetDTO> {
    return http.post<UploadTargetDTO>('/api/uploads/sign', input);
  },
  downloadUrl(path: string): Promise<{ url: string }> {
    return http.get<{ url: string }>('/api/uploads/url', { path });
  },
};

export const callsApi = {
  create(input: { calleeId: string; callType?: 'voice' | 'video'; conversationId?: string | null }): Promise<{ call: CallDTO }> {
    return http.post<{ call: CallDTO }>('/api/calls', input);
  },
  history(limit = 50): Promise<{ calls: CallDTO[] }> {
    return http.get<{ calls: CallDTO[] }>('/api/calls/history', { limit });
  },
  get(id: string): Promise<{ call: CallDTO }> {
    return http.get<{ call: CallDTO }>(`/api/calls/${id}`);
  },
  remove(callIds: string[]): Promise<{ deletedIds: string[] }> {
    return http.post<{ deletedIds: string[] }>('/api/calls/bulk-delete', { callIds });
  },
  updateStatus(
    id: string,
    status: 'accepted' | 'rejected' | 'ended' | 'cancelled' | 'missed',
  ): Promise<{ call: CallDTO }> {
    return http.patch<{ call: CallDTO }>(`/api/calls/${id}`, { status });
  },
  iceConfig(): Promise<{ iceServers: IceServerDTO[] }> {
    return http.get<{ iceServers: IceServerDTO[] }>('/api/calls/ice-config');
  },
};

export const stickersApi = {
  list(): Promise<{ stickers: StickerDTO[] }> {
    return http.get<{ stickers: StickerDTO[] }>('/api/stickers');
  },
};

export const statusesApi = {
  list(): Promise<{ statuses: StatusDTO[] }> {
    return http.get<{ statuses: StatusDTO[] }>('/api/statuses');
  },
  create(input: {
    type: 'text' | 'image' | 'video';
    text?: string | null;
    font?: string | null;
    bgColor?: string | null;
    mediaPath?: string | null;
    mediaThumbnailPath?: string | null;
    mimeType?: string | null;
    audience: StatusAudience;
    excludeUserIds?: string[];
    includeUserIds?: string[];
  }): Promise<{ status: StatusDTO }> {
    return http.post<{ status: StatusDTO }>('/api/statuses', input);
  },
  viewers(id: string): Promise<{ viewers: StatusViewerDTO[] }> {
    return http.get<{ viewers: StatusViewerDTO[] }>(`/api/statuses/${id}/viewers`);
  },
  markViewed(id: string): Promise<{ ok: boolean }> {
    return http.post<{ ok: boolean }>(`/api/statuses/${id}/viewed`);
  },
  reply(id: string, text: string): Promise<{ message: MessageDTO }> {
    return http.post<{ message: MessageDTO }>(`/api/statuses/${id}/reply`, { text });
  },
  remove(id: string): Promise<{ ok: boolean }> {
    return http.delete<{ ok: boolean }>(`/api/statuses/${id}`);
  },
};

export const devicesApi = {
  register(input: {
    deviceIdentifier: string;
    platform?: string;
    name?: string;
  }): Promise<{ device: { id: string } }> {
    return http.post<{ device: { id: string } }>('/api/devices', input);
  },
  setPushToken(token: string): Promise<{ ok: boolean }> {
    return http.post<{ ok: boolean }>('/api/devices/push-token', { token });
  },
  removePushToken(token: string): Promise<{ ok: boolean }> {
    return http.delete<{ ok: boolean }>('/api/devices/push-token', { token });
  },
};

export const syncApi = {
  pull(cursor = 0, limit = 100): Promise<SyncResponse> {
    return http.get<SyncResponse>('/api/sync', { cursor, limit });
  },
  push(operations: {
    operation:
      | 'CREATE_MESSAGE'
      | 'MARK_READ'
      | 'EDIT_MESSAGE'
      | 'DELETE_MESSAGE'
      | 'CREATE_REACTION'
      | 'DELETE_REACTION';
    clientMessageId?: string;
    conversationId?: string;
    payload?: Record<string, unknown>;
  }[]): Promise<SyncPushResponse> {
    return http.post<SyncPushResponse>('/api/sync', { operations });
  },
};