import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useAuth } from '@/context/auth-context';
import { useWaTheme } from '@/context/theme-context';
import { useSocket, useSocketEvent } from '@/context/socket-context';
import { enqueueOp, useSync, useSyncDb, useSyncFlush } from '@/context/sync-context';
import { conversationsApi, messagesApi, stickersApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { joinConversation, leaveConversation, sendMessageRead, sendTyping } from '@/lib/socket';
import { getDb } from '@/db/database';
import {
  listAllMessageIds,
  listMessages,
  markConversationRead,
  getConversation,
  setMessageDelivered as persistDelivered,
  setMessageReadStatus as persistRead,
  setMessageReactions as persistReactions,
  deleteMessageRow as persistDelete,
  upsertMessage as persistMessage,
  upsertConversation as persistConversation,
} from '@/db/repositories';
import { getAttachmentUrl, uploadAsset, fileNameFromUri } from '@/lib/media';
import { MessageBubble } from '@/components/message-bubble';
import { MessageActionsSheet } from '@/components/message-actions-sheet';
import { BUILTIN_GIFS, BUILTIN_STICKERS } from '@/constants/media-sources';
import type {
  AttachmentDTO,
  ConversationDetailDTO,
  ConversationDTO,
  MessageDTO,
  MessageDeliveredEvent,
  MessageReadEvent,
  PresenceUpdateEvent,
  TypingUpdateEvent,
} from '@/types/api';

interface DraftAttachment {
  type: string;
  mimeType?: string;
  storagePath?: string;
  width?: number;
  height?: number;
  gifUrl?: string;
  previewUrl?: string;
  provider?: string;
  localUri?: string;
}

interface SendDraft {
  text?: string;
  replyTo?: string;
  type?: string;
  attachment?: DraftAttachment;
}

function mergeBase(base: MessageDTO[], optimistic: MessageDTO[]): MessageDTO[] {
  const baseKeys = new Set(base.map((m) => m.clientMessageId || m.id));

  function inUse(msg: MessageDTO): boolean {
    return baseKeys.has(msg.clientMessageId || msg.id) || base.some((m) => m.id === msg.id);
  }

  const result = [...base];
  for (const o of optimistic) {
    if (!inUse(o)) result.push(o);
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function isRetryableError(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500;
  return true;
}

function attachToDto(
  conversationId: string,
  senderId: string,
  cid: string,
  draft: SendDraft,
  status = 'pending',
): MessageDTO {
  const attachments = draft.attachment
    ? [
        {
          id: Crypto.randomUUID(),
          type: draft.attachment.type,
          storagePath: draft.attachment.storagePath ?? null,
          mimeType: draft.attachment.mimeType ?? null,
          size: null,
          width: draft.attachment.width ?? null,
          height: draft.attachment.height ?? null,
          durationMs: null,
          thumbnailPath: null,
          provider: draft.attachment.provider ?? null,
          providerId: null,
          previewUrl: draft.attachment.previewUrl ?? null,
          gifUrl: draft.attachment.gifUrl ?? null,
          localUri: draft.attachment.localUri ?? null,
        },
      ]
    : [];
  return {
    id: cid,
    clientMessageId: cid,
    conversationId,
    senderId,
    type: draft.type ?? (draft.attachment ? draft.attachment.type : 'text'),
    text: draft.text ?? null,
    replyTo: draft.replyTo ?? null,
    status,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    hasAttachments: attachments.length > 0,
    attachments,
    reactions: [],
  };
}

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = String(params.id ?? '');
  const { user } = useAuth();
  const { colors } = useWaTheme();
  const { connected } = useSocket();
  const { pendingCount } = useSync();

  const myId = user?.id ?? '';

  const [detail, setDetail] = useState<ConversationDetailDTO | null>(null);
  const [localConv, setLocalConv] = useState<ConversationDTO | null>(null);
  const [base, setBase] = useState<MessageDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [optimistic, setOptimistic] = useState<MessageDTO[]>([]);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [peers, setPeers] = useState<Record<string, boolean>>({});

  const [replyTarget, setReplyTarget] = useState<MessageDTO | null>(null);
  const [editTarget, setEditTarget] = useState<MessageDTO | null>(null);
  const [actionTarget, setActionTarget] = useState<MessageDTO | null>(null);

  const [addMenu, setAddMenu] = useState(false);
  const [stickerModal, setStickerModal] = useState(false);

  const [mediaPreview, setMediaPreview] = useState<{
    uri: string;
    type: 'image' | 'video';
    mimeType?: string;
    width?: number;
    height?: number;
  } | null>(null);
  const [previewCaption, setPreviewCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<AttachmentDTO | null>(null);

  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastReadSent = useRef('');
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------
  // Derived state
  // ------------------------------------------------------------------
  const messages = useMemo(() => mergeBase(base, optimistic), [base, optimistic]);

  const { conversation } = detail ?? {};
  const conv = conversation ?? localConv;
  const isGroup = conv?.type === 'group';
  const amAdmin = isGroup
    ? (detail?.members.some((m) => m.id === myId && m.role === 'admin') ?? false)
    : false;
  const otherUserId = conv?.otherUserId ?? null;
  const peerOnline = otherUserId ? peers[otherUserId] === true : false;

  const messageById = useMemo(() => {
    const map = new Map<string, MessageDTO>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const title = isGroup
    ? conv?.name ?? 'Group'
    : conv?.otherUserName ?? 'Chat';
  const subtitle = pendingCount > 0
    ? `${pendingCount} pending…`
    : isGroup
      ? `${detail?.members.length ?? 0} members`
      : peerOnline
        ? 'online'
        : 'last seen recently';

  // ------------------------------------------------------------------
  // Initial load: show the cached copy from SQLite instantly, then
  // refresh detail + messages from the API in the background.
  // ------------------------------------------------------------------
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const db = await getDb();
        const [rows, conv] = await Promise.all([
          listMessages(db, conversationId, { limit: 100 }),
          getConversation(db, conversationId),
        ]);
        if (!active) return;
        setBase(rows);
        setLocalConv(conv);
        setLoading(false);
        void markConversationRead(db, conversationId);
      } catch (e) {
        if (active) {
          setLoading(false);
          setError(e instanceof Error ? e.message : 'Could not load conversation');
        }
      }
    })();

    (async () => {
      try {
        const loaded = await conversationsApi.detail(conversationId);
        if (!active) return;
        setDetail(loaded);
        setLocalConv(loaded.conversation);
        const db = await getDb();
        await persistConversation(db, loaded.conversation);
        if (loaded.messages.length > 0) {
          const fresh = loaded.messages
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setBase((prev) => mergeBase(fresh, prev));
          const existing = new Set(await listAllMessageIds(db, conversationId));
          const missing = fresh.filter((m) => !existing.has(m.id)).slice(0, 200);
          for (const m of missing) await persistMessage(db, m);
        }
      } catch {
        // Best-effort server refresh — the cached copy is already visible.
      }
    })();

    return () => {
      active = false;
    };
  }, [conversationId]);

  // Join the socket room for realtime events.
  useEffect(() => {
    if (!conversationId || !connected) return;
    joinConversation(conversationId);
    return () => leaveConversation(conversationId);
  }, [conversationId, connected]);

  // When the sync engine pulls server changes, reload this conversation.
  useSyncDb(() => {
    void (async () => {
      const db = await getDb();
      const rows = await listMessages(db, conversationId, { limit: 200 });
      setBase(rows);
    })();
  });

  // Mark everything visible as read when the conversation opens. Read
  // receipts are only ever sent for the newest *incoming* message — never
  // for our own messages (otherwise a just-sent message would instantly
  // show the blue "read" tick).
  useEffect(() => {
    if (messages.length === 0) return;
    const newest = messages[0];
    if (!newest || lastReadSent.current === newest.id) return;
    lastReadSent.current = newest.id;
    if (newest.senderId === myId) return;
    if (connected) {
      sendMessageRead(conversationId, newest.id);
    } else {
      void enqueueOp({
        opId: `read:${newest.id}`,
        type: 'MARK_READ',
        clientMessageId: newest.id,
        conversationId,
        createdAt: new Date().toISOString(),
      });
    }
  }, [messages, conversationId, connected, myId]);

  // ------------------------------------------------------------------
  // DB persistence helpers
  // ------------------------------------------------------------------
  const persist = (message: MessageDTO) => {
    void (async () => {
      const db = await getDb();
      await persistMessage(db, message);
    })();
  };

  const addOptimistic = (message: MessageDTO) => {
    setOptimistic((prev) => [
      ...prev.filter(
        (o) => o.clientMessageId !== message.clientMessageId && o.id !== message.id,
      ),
      message,
    ]);
  };

  const confirmSent = (message: MessageDTO) => {
    setOptimistic((prev) =>
      prev.filter((o) => o.clientMessageId !== message.clientMessageId),
    );
    setBase((prev) => mergeBase(prev, [{ ...message, status: 'sent' }]));
    persist(message);
  };

  // ------------------------------------------------------------------
  // Realtime events
  // ------------------------------------------------------------------
  useSocketEvent<MessageDTO>('message:new', (message) => {
    if (message.conversationId !== conversationId) return;
    setBase((prev) => mergeBase(prev, [message]));
    persist(message);
    if (message.senderId === myId) return;
    if (lastReadSent.current !== message.id) {
      lastReadSent.current = message.id;
      if (connected) sendMessageRead(conversationId, message.id);
      else {
        void enqueueOp({
          opId: `read:${message.id}`,
          type: 'MARK_READ',
          clientMessageId: message.id,
          conversationId,
          createdAt: new Date().toISOString(),
        });
      }
    }
  });

  useSocketEvent<MessageDTO>('message:update', (message) => {
    if (message.conversationId !== conversationId) return;
    setBase((prev) => mergeBase(prev, [message]));
    persist(message);
  });

  useSocketEvent<{ id: string; conversationId: string; deletedAt: string }>(
    'message:delete',
    (payload) => {
      if (payload.conversationId !== conversationId) return;
      setBase((prev) => prev.filter((m) => m.id !== payload.id));
      setOptimistic((prev) => prev.filter((o) => o.id !== payload.id));
      void (async () => {
        const db = await getDb();
        await persistDelete(db, payload.id);
      })();
    },
  );

  useSocketEvent<{ conversationId: string; messageId: string; reactions: { userId: string; emoji: string }[] }>(
    'message:reaction',
    (payload) => {
      if (payload.conversationId !== conversationId) return;
      setBase((prev) =>
        prev.map((m) => (m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m)),
      );
      void (async () => {
        const db = await getDb();
        await persistReactions(db, payload.messageId, payload.reactions);
      })();
    },
  );

  useSocketEvent<MessageReadEvent>('message:read', (event) => {
    if (event.conversationId !== conversationId) return;
    setBase((prev) =>
      prev.map((m) =>
        m.senderId === myId && m.id === event.messageId ? { ...m, status: 'read' } : m,
      ),
    );
    void (async () => {
      const db = await getDb();
      await persistRead(db, conversationId, myId, event.messageId);
    })();
  });

  useSocketEvent<MessageDeliveredEvent>('message:delivered', (event) => {
    if (event.conversationId !== conversationId) return;
    setBase((prev) =>
      prev.map((m) =>
        m.id === event.messageId && m.status !== 'read'
          ? { ...m, status: 'delivered' }
          : m,
      ),
    );
    void (async () => {
      const db = await getDb();
      await persistDelivered(db, event.messageId);
    })();
  });

  useSocketEvent<PresenceUpdateEvent>('presence:update', (event) => {
    setPeers((prev) => ({ ...prev, [event.userId]: event.online }));
  });

  useSocketEvent<TypingUpdateEvent>('typing:update', (event) => {
    if (event.conversationId !== conversationId || event.userId === myId) return;
    setTypingUsers((prev) => {
      const has = prev.includes(event.userId);
      if (event.isTyping && !has) return [...prev, event.userId];
      if (!event.isTyping && has) return prev.filter((id) => id !== event.userId);
      return prev;
    });
    if (event.isTyping) {
      const existing = typingTimers.current.get(event.userId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        typingTimers.current.delete(event.userId);
        setTypingUsers((prev) => prev.filter((id) => id !== event.userId));
      }, 4000);
      typingTimers.current.set(event.userId, timer);
    }
  });

  // When the sync engine replays queued messages, swap placeholders.
  useSyncFlush((flushed) => {
    for (const item of flushed) {
      if (item.message.conversationId !== conversationId) continue;
      confirmSent(item.message);
    }
  });

  // ------------------------------------------------------------------
  // Send / retry
  // ------------------------------------------------------------------
  const send = async (draft: SendDraft, clientMessageId?: string) => {
    if (sending) return;
    if (!draft.text?.trim() && !draft.attachment) return;
    const cid = clientMessageId ?? Crypto.randomUUID();
    const optimistic = attachToDto(conversationId, myId, cid, draft);
    addOptimistic(optimistic);
    if (!draft.attachment) setDraft('');
    setReplyTarget(null);
    setSending(true);
    sendTyping(conversationId, false);

    try {
      const { message } = await messagesApi.send(conversationId, {
        text: draft.text?.trim() || undefined,
        type: draft.type,
        clientMessageId: cid,
        replyTo: draft.replyTo,
        attachment: draft.attachment
          ? {
              type: draft.attachment.type,
              storagePath: draft.attachment.storagePath,
              mimeType: draft.attachment.mimeType,
              size: undefined,
              width: draft.attachment.width,
              height: draft.attachment.height,
              gifUrl: draft.attachment.gifUrl,
              previewUrl: draft.attachment.previewUrl,
              provider: draft.attachment.provider,
            }
          : undefined,
      });
      confirmSent(message);
    } catch (e) {
      if (isRetryableError(e)) {
        void enqueueOp({
          opId: cid,
          type: 'CREATE_MESSAGE',
          clientMessageId: cid,
          conversationId,
          payload: {
            text: draft.text?.trim() ?? '',
            replyTo: draft.replyTo,
            type: draft.type,
            attachment: draft.attachment,
          },
          createdAt: optimistic.createdAt,
        });
      } else {
        setBase((prev) =>
          prev.map((m) => (m.id === cid ? { ...m, status: 'failed' } : m)),
        );
        setOptimistic((prev) =>
          prev.map((o) => (o.id === cid ? { ...o, status: 'failed' } : o)),
        );
      }
    } finally {
      setSending(false);
    }
  };

  const sendText = () => {
    if (!draft.trim()) return;
    void send({
      text: draft,
      replyTo: replyTarget?.id,
    });
  };

  const retry = (message: MessageDTO) => {
    void send(
      {
        text: message.text ?? undefined,
        replyTo: message.replyTo ?? undefined,
        type: message.type === 'text' ? undefined : message.type,
        attachment: message.attachments[0]
          ? {
              type: message.attachments[0].type,
              storagePath: message.attachments[0].storagePath ?? undefined,
              gifUrl: message.attachments[0].gifUrl ?? undefined,
              previewUrl: message.attachments[0].previewUrl ?? undefined,
              provider: message.attachments[0].provider ?? undefined,
            }
          : undefined,
      },
      message.clientMessageId,
    );
  };

  const onChangeDraft = (text: string) => {
    setDraft(text);
    if (!connected) return;
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    sendTyping(conversationId, true);
    typingTimeout.current = setTimeout(() => sendTyping(conversationId, false), 2000);
  };

  // ------------------------------------------------------------------
  // Edit / delete / react
  // ------------------------------------------------------------------
  const startEdit = async (message: MessageDTO) => {
    if (message.attachments.length > 0) {
      setEditTarget(message);
      setPreviewCaption(message.text ?? '');
      const picked = await pickImage('library');
      if (!picked) setEditTarget(null);
    } else {
      setEditTarget(message);
      setDraft(message.text ?? '');
    }
  };

  const cancelEdit = () => {
    setEditTarget(null);
    setDraft('');
  };

  const commitEdit = async () => {
    const target = editTarget;
    const next = draft.trim();
    if (!target || !next) return;
    setEditTarget(null);
    setDraft('');
    setBase((prev) =>
      prev.map((m) =>
        m.id === target.id
          ? { ...m, text: next, editedAt: new Date().toISOString() }
          : m,
      ),
    );
    setOptimistic((prev) =>
      prev.map((o) =>
        o.id === target.id ? { ...o, text: next, editedAt: new Date().toISOString() } : o,
      ),
    );

    try {
      const { message } = await messagesApi.edit(target.id, { text: next });
      setBase((prev) => mergeBase(prev, [message]));
      persist(message);
    } catch (e) {
      if (isRetryableError(e)) {
        void enqueueOp({
          opId: `edit:${target.id}:${next.length}`,
          type: 'EDIT_MESSAGE',
          clientMessageId: target.id,
          conversationId,
          payload: { messageId: target.id, text: next },
          createdAt: new Date().toISOString(),
        });
      } else {
        Alert.alert('Edit failed', e instanceof Error ? e.message : 'Could not edit message');
        setBase((prev) => mergeBase(prev, [target]));
        setOptimistic((prev) =>
          prev.map((o) => (o.id === target.id ? target : o)),
        );
      }
    }
  };

  const commitMediaEdit = async (target: MessageDTO, attachment: DraftAttachment) => {
    const caption = previewCaption.trim();
    const optimisticEdited: MessageDTO = {
      ...target,
      type: attachment.type,
      text: caption || null,
      editedAt: new Date().toISOString(),
      hasAttachments: true,
      attachments: [
        {
          id: Crypto.randomUUID(),
          type: attachment.type,
          storagePath: attachment.storagePath ?? null,
          mimeType: attachment.mimeType ?? null,
          size: null,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
          durationMs: null,
          thumbnailPath: null,
          provider: attachment.provider ?? null,
          providerId: null,
          previewUrl: attachment.previewUrl ?? null,
          gifUrl: attachment.gifUrl ?? null,
          localUri: attachment.localUri ?? null,
        },
      ],
    };
    setEditTarget(null);
    setBase((prev) => prev.map((m) => (m.id === optimisticEdited.id ? optimisticEdited : m)));
    setOptimistic((prev) => prev.map((o) => (o.id === target.id ? optimisticEdited : o)));

    try {
      const { message } = await messagesApi.edit(target.id, {
        text: caption || undefined,
        attachment: {
          type: attachment.type,
          storagePath: attachment.storagePath,
          mimeType: attachment.mimeType,
          width: attachment.width,
          height: attachment.height,
          gifUrl: attachment.gifUrl,
          previewUrl: attachment.previewUrl,
          provider: attachment.provider,
        },
      });
      setBase((prev) => mergeBase(prev, [message]));
      persist(message);
    } catch (e) {
      if (isRetryableError(e)) {
        void enqueueOp({
          opId: `edit:${target.id}:${attachment.localUri}`,
          type: 'EDIT_MESSAGE',
          clientMessageId: target.id,
          conversationId,
          payload: { messageId: target.id, text: caption || undefined },
          createdAt: new Date().toISOString(),
        });
      } else {
        Alert.alert('Edit failed', e instanceof Error ? e.message : 'Could not replace media');
        setBase((prev) => mergeBase(prev, [target]));
      }
    }
  };

  const removeMessage = async (message: MessageDTO) => {
    setBase((prev) => prev.filter((m) => m.id !== message.id));
    setOptimistic((prev) => prev.filter((o) => o.id !== message.id));
    try {
      await messagesApi.delete(message.id);
      void (async () => {
        const db = await getDb();
        await persistDelete(db, message.id);
      })();
    } catch (e) {
      if (isRetryableError(e)) {
        void enqueueOp({
          opId: `delete:${message.id}`,
          type: 'DELETE_MESSAGE',
          clientMessageId: message.id,
          conversationId,
          payload: { messageId: message.id },
          createdAt: new Date().toISOString(),
        });
      }
    }
  };

  const isReacted = (message: MessageDTO, emoji: string) =>
    message.reactions.some((r) => r.userId === myId && r.emoji === emoji);

  const toggleReact = async (message: MessageDTO, emoji: string) => {
    const turningOn = !isReacted(message, emoji);
    const nextReactions = turningOn
      ? [...message.reactions, { userId: myId, emoji }]
      : message.reactions.filter(
          (r) => !(r.userId === myId && r.emoji === emoji),
        );
    setBase((prev) =>
      prev.map((m) => (m.id === message.id ? { ...m, reactions: nextReactions } : m)),
    );
    setOptimistic((prev) =>
      prev.map((o) =>
        o.id === message.id ? { ...o, reactions: nextReactions } : o,
      ),
    );

    try {
      const result = await messagesApi.toggleReaction(message.id, emoji);
      setBase((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, reactions: result.reactions } : m)),
      );
      void (async () => {
        const db = await getDb();
        await persistReactions(db, message.id, result.reactions);
      })();
    } catch (e) {
      if (isRetryableError(e)) {
        void enqueueOp({
          opId: `react:${message.id}:${emoji}`,
          type: turningOn ? 'CREATE_REACTION' : 'DELETE_REACTION',
          clientMessageId: message.id,
          conversationId,
          payload: { messageId: message.id, emoji },
          createdAt: new Date().toISOString(),
        });
      }
    }
  };

  // ------------------------------------------------------------------
  // Attachment picks
  // ------------------------------------------------------------------
  const pickImage = async (source: 'library' | 'camera'): Promise<boolean> => {
    const launcher =
      source === 'camera'
        ? ImagePicker.launchCameraAsync
        : ImagePicker.launchImageLibraryAsync;
    const result = await launcher({
      mediaTypes: ['images', 'videos'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return false;
    const asset = result.assets[0]!;
    const isVideo = asset.type === 'video';
    setMediaPreview({
      uri: asset.uri,
      type: isVideo ? 'video' : 'image',
      mimeType: asset.mimeType ?? undefined,
      width: asset.width,
      height: asset.height,
    });
    return true;
  };

  const closePreview = () => {
    setMediaPreview(null);
    setPreviewCaption('');
  };

  const sendPreview = async () => {
    const item = mediaPreview;
    if (!item || uploading) return;
    setUploading(true);
    try {
      const isVideo = item.type === 'video';
      const contentType = item.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
      const uploaded = await uploadAsset('chat-media', {
        uri: item.uri,
        contentType,
        fileName: undefined,
        size: undefined,
      });
      const target = editTarget;
      const attachment: DraftAttachment = {
        ...uploaded.attachment,
        width: item.width,
        height: item.height,
        localUri: item.uri,
      };
      if (target) {
        await commitMediaEdit(target, attachment);
      } else {
        await send({
          text: previewCaption.trim() || undefined,
          attachment,
        });
      }
      closePreview();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload media');
    } finally {
      setUploading(false);
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0]!;
    const contentType = asset.mimeType ?? 'application/octet-stream';
    try {
      const uploaded = await uploadAsset('chat-media', {
        uri: asset.uri,
        contentType,
        fileName: asset.name || fileNameFromUri(asset.uri),
        size: asset.size ?? undefined,
      });
      await send({
        attachment: {
          ...uploaded.attachment,
          localUri: asset.uri,
        },
      });
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload document');
    }
  };

  const sendGifOrSticker = ({ type, url }: { type: 'gif' | 'sticker'; url: string }) => {
    setStickerModal(false);
    void send({
      type,
      attachment: {
        type,
        gifUrl: type === 'gif' ? url : undefined,
        previewUrl: type === 'sticker' ? url : undefined,
        provider: type === 'gif' ? 'giphy' : 'stickerset',
      },
      text: undefined,
    });
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !detail) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.text }]}>Couldn&apos;t open this chat</Text>
          <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>{error}</Text>
          <Pressable onPress={() => router.back()} style={[styles.retry, { borderColor: colors.brand }]}>
            <Text style={{ color: colors.brand }}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const typingNames = typingUsers
    .map((id) => detail?.members.find((m) => m.id === id)?.name ?? 'Someone')
    .join(', ');

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.chatBackground }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.brandDark }]}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Pressable
          hitSlop={10}
          style={styles.headerBtn}
          onPress={() =>
            isGroup
              ? router.push(`/chat/${conversationId}/group-info`)
              : router.push(`/chat/${conversationId}`)
          }
        >
          <Ionicons name="ellipsis-vertical" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <FlatList
          data={messages}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => {
            const ref = item.replyTo ? messageById.get(item.replyTo) ?? null : null;
            return (
              <MessageBubble
                message={item}
                isOwn={item.senderId === myId}
                showSenderName={isGroup && item.senderId !== myId}
                senderName={detail?.members.find((m) => m.id === item.senderId)?.name}
                replyPreview={
                  ref
                    ? { senderId: ref.senderId, text: ref.text, type: ref.type }
                    : undefined
                }
                onFailedRetry={item.status === 'failed' ? () => retry(item) : undefined}
                onLongPress={setActionTarget}
                onOpenMedia={setViewer}
              />
            );
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: colors.textSecondary }}>No messages yet. Say hello!</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />

        {typingNames.length > 0 && (
          <View style={styles.typingRow}>
            <Text style={[styles.typingText, { color: colors.textSecondary }]}>{typingNames} typing…</Text>
          </View>
        )}

        {/* Reply / edit chip */}
        {(replyTarget || editTarget) && (
          <View style={[styles.chip, { backgroundColor: colors.incomingBubble }]}>
            <Ionicons
              name={editTarget ? 'create-outline' : 'arrow-undo'}
              size={16}
              color={colors.brand}
            />
            <View style={styles.chipTextWrap}>
              <Text style={[styles.chipTitle, { color: colors.brand }]} numberOfLines={1}>
                {editTarget
                  ? 'Editing message'
                  : `Replying to ${replyTarget?.senderId === myId ? 'you' : 'message'}`}
              </Text>
              <Text style={[styles.chipBody, { color: colors.textSecondary }]} numberOfLines={1}>
                {editTarget
                  ? editTarget.text ?? (editTarget.attachments.length > 0 ? '📎 Media' : '')
                  : replyTarget && replyTarget.type !== 'text'
                    ? '📎 Media'
                    : replyTarget?.text}
              </Text>
            </View>
            <Pressable
              hitSlop={8}
              onPress={() => {
                if (editTarget) {
                  cancelEdit();
                } else {
                  setReplyTarget(null);
                }
              }}
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        )}

        {/* Input bar */}
        <View style={[styles.inputBar, { backgroundColor: colors.incomingBubble }]}>
          <Pressable hitSlop={8} onPress={() => setAddMenu(true)} style={styles.iconBtn}>
            <Ionicons name="add" size={26} color={colors.brand} />
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={onChangeDraft}
            placeholder={editTarget ? 'Edit message' : 'Message'}
            placeholderTextColor={colors.textSecondary}
            multiline
            style={[styles.input, { color: colors.text }]}
            onSubmitEditing={() => (editTarget ? commitEdit() : sendText())}
            blurOnSubmit={false}
          />
          <Pressable hitSlop={8} onPress={() => setStickerModal(true)} style={styles.iconBtn}>
            <Ionicons name="happy" size={24} color={colors.brand} />
          </Pressable>
          {editTarget ? (
            <Pressable
              onPress={commitEdit}
              disabled={!draft.trim()}
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: pressed ? '#00806b' : colors.brand },
                !draft.trim() && styles.sendBtnDisabled,
              ]}
            >
              <Ionicons name="checkmark" size={22} color="#FFFFFF" />
            </Pressable>
          ) : (
            <Pressable
              onPress={sendText}
              disabled={sending || !draft.trim()}
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: pressed ? '#00806b' : colors.brand },
                (!draft.trim() || sending) && styles.sendBtnDisabled,
              ]}
            >
              <Ionicons name="arrow-up" size={22} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Actions sheet after long-press */}
      {actionTarget && (
        <MessageActionsSheet
          message={actionTarget}
          visible={!!actionTarget}
          canEdit={actionTarget.senderId === myId && !actionTarget.deletedAt}
          canDelete={
            (actionTarget.senderId === myId || (isGroup && amAdmin)) && !actionTarget.deletedAt
          }
          onReact={(emoji) => void toggleReact(actionTarget, emoji)}
          onReply={() => {
            setReplyTarget(actionTarget);
            setEditTarget(null);
            setDraft('');
          }}
          onEdit={() => startEdit(actionTarget)}
          onDelete={() => {
            Alert.alert(
              'Delete message',
              'Delete this message for everyone?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => void removeMessage(actionTarget) },
              ],
            );
          }}
          onClose={() => setActionTarget(null)}
        />
      )}

      {/* Attachment menu */}
      <Modal transparent visible={addMenu} animationType="fade" onRequestClose={() => setAddMenu(false)}>
        <Pressable style={styles.overlay} onPress={() => setAddMenu(false)}>
          <View style={[styles.addSheet, { backgroundColor: colors.incomingBubble }]}>
            {[
              { icon: 'images', label: 'Gallery', onPress: () => void pickImage('library') },
              { icon: 'camera', label: 'Camera', onPress: () => void pickImage('camera') },
              { icon: 'document', label: 'Document', onPress: () => void pickDocument() },
            ].map((item) => (
              <Pressable
                key={item.label}
                style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  setAddMenu(false);
                  item.onPress();
                }}
              >
                <Ionicons name={item.icon as never} size={22} color={colors.brand} />
                <Text style={[styles.addLabel, { color: colors.text }]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* GIF / sticker picker */}
      <GifStickerPicker
        visible={stickerModal}
        onClose={() => setStickerModal(false)}
        onPick={sendGifOrSticker}
      />

      {/* Preview before sending picked media */}
      {mediaPreview && (
        <MediaPreviewModal
          preview={mediaPreview}
          caption={previewCaption}
          onChangeCaption={setPreviewCaption}
          uploading={uploading}
          onSend={() => void sendPreview()}
          onClose={closePreview}
        />
      )}

      {/* Full-screen media viewer */}
      {viewer && <ImageViewerModal attachment={viewer} onClose={() => setViewer(null)} />}
    </SafeAreaView>
  );
}

function GifStickerPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (item: { type: 'gif' | 'sticker'; url: string }) => void;
}) {
  const { colors } = useWaTheme();
  const [tab, setTab] = useState<'gif' | 'sticker'>('gif');
  const [stickers, setStickers] = useState<{ id: string; url: string; title: string }[]>([]);

  useEffect(() => {
    if (!visible) return;
    void stickersApi
      .list()
      .then(({ stickers: server }) => {
        if (server.length > 0) {
          setStickers(
            server.map((s) => ({
              id: s.id,
              url: s.url || '',
              title: s.name,
            })),
          );
        } else {
          setStickers(BUILTIN_STICKERS);
        }
      })
      .catch(() => setStickers(BUILTIN_STICKERS));
  }, [visible]);

  const items = tab === 'gif' ? BUILTIN_GIFS : stickers;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={[styles.stickerSheet, { backgroundColor: colors.incomingBubble }]}>
        <View style={styles.stickerHeader}>
          <Pressable hitSlop={8} onPress={onClose}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.tabRow}>
            {(['gif', 'sticker'] as const).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={styles.tab}>
                <Text
                  style={[
                    styles.tabLabel,
                    t === tab ? { color: colors.brand } : { color: colors.textSecondary },
                    t === tab && styles.tabActive,
                  ]}
                >
                  {t === 'gif' ? 'GIFs' : 'Stickers'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <FlatList
          data={items}
          numColumns={4}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: colors.textSecondary }}>Nothing here yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.stickerCell} onPress={() => onPick({ type: tab, url: item.url })}>
              {item.url ? (
                <Image source={{ uri: item.url }} style={styles.stickerThumb} contentFit="contain" />
              ) : (
                <Ionicons name={tab === 'gif' ? 'play-circle' : 'happy'} size={40} color={colors.textSecondary} />
              )}
              <Text style={[styles.stickerTitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.title}
              </Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

function MediaPreviewModal({
  preview,
  caption,
  onChangeCaption,
  uploading,
  onSend,
  onClose,
}: {
  preview: { uri: string; type: 'image' | 'video'; width?: number; height?: number };
  caption: string;
  onChangeCaption: (text: string) => void;
  uploading: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  const { colors } = useWaTheme();
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={uploading ? () => undefined : onClose}
      statusBarTranslucent
    >
      <View style={[styles.previewOverlay, { backgroundColor: '#000000' }]}>
        <View style={styles.previewHeader}>
          <Pressable hitSlop={10} onPress={onClose} disabled={uploading}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.previewTitle}>
            {preview.type === 'video' ? 'Video' : 'Image'} preview
          </Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.previewBody}>
          {preview.type === 'image' ? (
            <Image source={{ uri: preview.uri }} style={styles.previewImage} contentFit="contain" />
          ) : (
            <View style={styles.previewVideoPlaceholder}>
              <Ionicons name="videocam" size={56} color="rgba(255,255,255,0.85)" />
              <Text style={styles.previewVideoText}>Video ready to send</Text>
            </View>
          )}
        </View>
        <View style={styles.previewFooter}>
          <TextInput
            value={caption}
            onChangeText={onChangeCaption}
            placeholder="Add a caption…"
            placeholderTextColor="rgba(255,255,255,0.5)"
            style={styles.previewInput}
            multiline
            editable={!uploading}
          />
          <Pressable
            onPress={onSend}
            disabled={uploading}
            style={({ pressed }) => [
              styles.previewSend,
              { backgroundColor: pressed ? '#00806b' : colors.brand },
            ]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="arrow-up" size={22} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ImageViewerModal({
  attachment,
  onClose,
}: {
  attachment: AttachmentDTO;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(
    attachment.previewUrl ?? attachment.gifUrl ?? attachment.localUri ?? null,
  );

  useEffect(() => {
    let active = true;
    if (!attachment.localUri && !attachment.previewUrl && !attachment.gifUrl) {
      void getAttachmentUrl(attachment).then((u) => {
        if (active) setUrl(u);
      });
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, attachment.storagePath]);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.previewOverlay, { backgroundColor: '#000000' }]}>
        <Pressable hitSlop={10} style={styles.viewerClose} onPress={onClose}>
          <Ionicons name="close" size={28} color="#FFFFFF" />
        </Pressable>
        {url ? (
          <Image source={{ uri: url }} style={styles.previewImage} contentFit="contain" transition={150} />
        ) : (
          <View style={styles.viewerLoading}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  previewOverlay: { flex: 1, backgroundColor: '#000000' },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  previewTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  previewBody: { flex: 1, justifyContent: 'center' },
  previewImage: { flex: 1, width: '100%' },
  previewVideoPlaceholder: { alignItems: 'center', gap: 12 },
  previewVideoText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  previewFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#111111',
  },
  previewInput: { flex: 1, color: '#FFFFFF', fontSize: 16, padding: 0 },
  previewSend: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerClose: { position: 'absolute', top: 48, right: 14, zIndex: 2 },
  viewerLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  errorDetail: { fontSize: 13, textAlign: 'center', marginBottom: 16 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  headerBtn: { padding: 8 },
  headerInfo: { flex: 1, marginLeft: 4 },
  headerTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  headerSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 1 },
  listContent: { paddingVertical: 10, flexGrow: 1 },
  typingRow: { paddingHorizontal: 14, paddingVertical: 2 },
  typingText: { fontSize: 12, fontStyle: 'italic' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 10,
    marginBottom: 6,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipTextWrap: { flex: 1 },
  chipTitle: { fontSize: 12, fontWeight: '600' },
  chipBody: { fontSize: 12, marginTop: 1 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
  },
  iconBtn: { padding: 6, marginBottom: 4 },
  input: {
    flex: 1,
    maxHeight: 120,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnDisabled: { opacity: 0.45 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  addSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  addLabel: { fontSize: 16 },
  stickerSheet: {
    maxHeight: 420,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 24,
  },
  stickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 6,
    paddingBottom: 10,
  },
  tabRow: { flexDirection: 'row', gap: 20 },
  tab: { paddingVertical: 4 },
  tabLabel: { fontSize: 16, fontWeight: '600' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#00A884' },
  stickerThumb: { width: 72, height: 72, borderRadius: 6 },
  stickerCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  stickerTitle: { fontSize: 10, marginTop: 4, maxWidth: 80 },
});