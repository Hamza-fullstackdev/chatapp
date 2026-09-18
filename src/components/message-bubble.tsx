import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { AttachmentDTO, MessageDTO } from '@/types/api';
import { formatMessageTime } from '@/lib/format';
import { useWaTheme } from '@/context/theme-context';
import { getAttachmentUrl } from '@/lib/media';

const REPLY_SWIPE_THRESHOLD = 56;
const REPLY_SWIPE_MAX_SHIFT = 64;

interface MessageBubbleProps {
  message: MessageDTO;
  isOwn: boolean;
  showSenderName?: boolean;
  senderName?: string;
  replyPreview?: { senderId: string; text: string | null; type: string } | null;
  onFailedRetry?: () => void;
  onLongPress?: (message: MessageDTO) => void;
  onOpenMedia?: (attachment: AttachmentDTO) => void;
  onPress?: (message: MessageDTO) => void;
  onSwipeToReply?: (message: MessageDTO) => void;
  selecting?: boolean;
  selected?: boolean;
  highlighted?: boolean;
}

/**
 * Delivery tick, WhatsApp-style:
 *  - clock         = pending (uploading / in the offline queue)
 *  - single grey ✓ = sent
 *  - double grey ✓✓ = delivered to the other device
 *  - double blue ✓✓ = read
 */
function Tick({ status }: { status: string }) {
  if (status === 'failed') {
    return <Ionicons name="alert-circle" size={16} color="#E5423D" />;
  }
  if (status === 'pending' || status === 'syncing') {
    return <Ionicons name="time" size={13} color="#88929E" />;
  }
  if (status === 'read') {
    return <Ionicons name="checkmark-done" size={14} color="#34B7F1" />;
  }
  if (status === 'delivered') {
    return <Ionicons name="checkmark-done" size={14} color="#88929E" />;
  }
  return <Ionicons name="checkmark" size={14} color="#88929E" />;
}

/**
 * Status indicator overlaid on the photo corner: a progress spinner while the
 * media is uploading/delivering, a retry-able alert on failure, otherwise the
 * normal delivery tick.
 */
function MediaStatus({ status, onRetry }: { status: string; onRetry?: () => void }) {
  if (status === 'failed') {
    const icon = <Ionicons name="alert-circle" size={14} color="#FFE3E1" />;
    return onRetry ? (
      <Pressable hitSlop={8} onPress={onRetry} style={styles.tick}>
        {icon}
      </Pressable>
    ) : (
      icon
    );
  }
  if (status === 'pending' || status === 'syncing') {
    return <ActivityIndicator size="small" color="#FFFFFF" />;
  }
  return <Tick status={status} />;
}

function AttachmentMedia({ attachment, isOwn }: { attachment: AttachmentDTO; isOwn: boolean }) {
  const { colors } = useWaTheme();
  const [url, setUrl] = useState<string | null>(attachment.previewUrl ?? attachment.gifUrl ?? attachment.localUri ?? null);

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

  if (attachment.type === 'image' || attachment.type === 'gif' || attachment.type === 'sticker') {
    if (!url) {
      return <View style={[styles.mediaPlaceholder, { backgroundColor: colors.divider }]} />;
    }
    return <Image source={{ uri: url }} style={styles.mediaImage} contentFit="cover" transition={100} />;
  }

  const name =
    attachment.type === 'video'
      ? 'videocam'
      : attachment.type === 'audio'
        ? 'mic'
        : attachment.type === 'file'
          ? 'document-attach'
          : 'document';
  return (
    <View style={[styles.fileBox, { backgroundColor: colors.background }]}>
      <Ionicons name={name} size={26} color={colors.brand} />
      <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={2}>
        {attachment.mimeType ?? attachment.type}
      </Text>
    </View>
  );
}

export function MessageBubble({
  message,
  isOwn,
  showSenderName,
  senderName,
  replyPreview,
  onFailedRetry,
  onLongPress,
  onOpenMedia,
  onPress,
  onSwipeToReply,
  selecting = false,
  selected = false,
  highlighted = false,
}: MessageBubbleProps) {
  const { colors } = useWaTheme();

  const swipeEnabled = !!onSwipeToReply && !selecting && !message.deletedAt;
  const [translateX] = useState(() => new Animated.Value(0));

  const swipeResponder = useMemo(() => {
    const springBack = () => {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 7,
        tension: 60,
      }).start();
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        swipeEnabled && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
      onPanResponderGrant: () => {
        translateX.setValue(0);
      },
      onPanResponderMove: (_event, gesture) => {
        translateX.setValue(Math.max(0, Math.min(gesture.dx, REPLY_SWIPE_MAX_SHIFT)));
      },
      onPanResponderRelease: (_event, gesture) => {
        const triggered = gesture.dx > REPLY_SWIPE_THRESHOLD;
        springBack();
        if (triggered) onSwipeToReply?.(message);
      },
      onPanResponderTerminate: () => {
        springBack();
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [swipeEnabled, translateX, onSwipeToReply, message]);

  const images = message.attachments.filter((a) => a.type === 'image' || a.type === 'gif');
  const stickers = message.attachments.filter((a) => a.type === 'sticker');
  const others = message.attachments.filter((a) => a.type === 'video' || a.type === 'audio' || a.type === 'file');

  // When an image is the whole message, overlay the timestamp on the photo
  // corner like WhatsApp instead of a separate row underneath it.
  const overlayTime = images.length > 0 && !message.text && message.reactions.length === 0 && !message.editedAt;

  const hasReactions = message.reactions.length > 0 && !message.deletedAt;

  const reactionsOverlay =
    hasReactions ? (
      <View
        style={[
          styles.reactionsOverlay,
          isOwn ? styles.reactionsOwn : styles.reactionsIncoming,
        ]}
      >
        {Object.entries(
          message.reactions.reduce<Record<string, number>>((acc, r) => {
            acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([emoji, count]) => (
          <View key={emoji} style={styles.reactionPill}>
            <Text style={styles.reactionEmoji}>{emoji}</Text>
            {count > 1 && <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{count}</Text>}
          </View>
        ))}
      </View>
    ) : null;

  const metaRow = (
    <View style={styles.metaRow}>
      {message.editedAt && !message.deletedAt ? (
        <Text style={[styles.edited, { color: colors.textSecondary }]}>edited</Text>
      ) : null}
      <Text style={[styles.time, { color: colors.textSecondary }]}>{formatMessageTime(message.createdAt)}</Text>
      {isOwn && message.status === 'failed' && onFailedRetry ? (
        <Pressable hitSlop={8} onPress={onFailedRetry} style={styles.tick}>
          <Ionicons name="alert-circle" size={16} color="#E5423D" />
        </Pressable>
      ) : isOwn ? (
        <View style={styles.tick}>
          <Tick status={message.status} />
        </View>
      ) : null}
    </View>
  );

  const mediaStack = (list: AttachmentDTO[], overlayOnLast: boolean) =>
    list.map((a, index) => {
      const isLast = index === list.length - 1;
      const media = <AttachmentMedia key={a.id} attachment={a} isOwn={isOwn} />;
      const wrapped = onOpenMedia || onPress ? (
        <Pressable
          key={a.id}
          onPress={() => {
            if (onPress) onPress(message);
            else if (onOpenMedia) onOpenMedia(a);
          }}
          onLongPress={onLongPress ? () => onLongPress(message) : undefined}
          delayLongPress={250}
          style={({ pressed }) => pressed && { opacity: 0.85 }}
        >
          {media}
        </Pressable>
      ) : (
        media
      );
      return (
        <View key={a.id} style={styles.mediaBox}>
          {wrapped}
          {isLast && overlayOnLast && (
            <View style={styles.metaOverlay}>
              <Text style={styles.timeOverlay}>{formatMessageTime(message.createdAt)}</Text>
              {isOwn && !message.deletedAt && (
                <MediaStatus status={message.status} onRetry={onFailedRetry} />
              )}
            </View>
          )}
        </View>
      );
    });

  const baseContent = (
    <View
      style={[
        styles.bubble,
        {
          backgroundColor: isOwn ? colors.brandLight : colors.incomingBubble,
        },
      ]}
    >
      {showSenderName && (
        <Text style={[styles.senderName, { color: colors.brand }]} numberOfLines={1}>
          {senderName ?? message.senderId}
        </Text>
      )}

      {replyPreview && (
        <View style={[styles.replyBox, { borderLeftColor: colors.brand }]}>
          <Text style={[styles.replySender, { color: colors.brand }]} numberOfLines={1}>
            {replyPreview.senderId === message.senderId ? (isOwn ? 'You' : senderName ?? 'You') : replyPreview.senderId}
          </Text>
          <Text style={[styles.replyText, { color: colors.textSecondary }]} numberOfLines={1}>
            {replyPreview.type !== 'text' ? '📎 Media' : replyPreview.text}
          </Text>
        </View>
      )}

      {message.deletedAt ? (
        <View style={styles.deletedRow}>
          <Ionicons name="trash-outline" size={15} color={colors.textSecondary} />
          <Text style={[styles.deletedText, { color: colors.textSecondary }]}>This message was deleted</Text>
        </View>
      ) : (
        <>
          {images.length > 0 && <View style={styles.mediaWrap}>{mediaStack(images, overlayTime)}</View>}
          {stickers.length > 0 && <View style={styles.mediaWrap}>{mediaStack(stickers, false)}</View>}
          {others.length > 0 && (
            <View style={styles.fileWrap}>{mediaStack(others, false)}</View>
          )}
          {message.text ? (
            <Text style={[styles.text, { color: colors.text }]}>
              {message.text}
            </Text>
          ) : null}
          {!overlayTime && !message.deletedAt && metaRow}
          {!overlayTime && message.deletedAt && <View style={styles.deletedEnd} />}
        </>
      )}
    </View>
  );

  return (
    <View
      style={[
        styles.row,
        isOwn ? styles.rowOwn : styles.rowIncoming,
        hasReactions && styles.rowWithReactions,
        selecting && !selected && styles.dimmed,
      ]}
    >
      <View style={styles.bubbleWrap}>
        <Animated.View
          style={[
            highlighted && { borderRadius: 8, borderWidth: 2, borderColor: colors.brand },
            { transform: [{ translateX }] },
          ]}
          {...(swipeEnabled ? swipeResponder.panHandlers : {})}
        >
          {onLongPress || onPress ? (
            <Pressable
              onPress={() => onPress?.(message)}
              onLongPress={() => onLongPress?.(message)}
              delayLongPress={250}
            >
              {baseContent}
            </Pressable>
          ) : (
            baseContent
          )}
        </Animated.View>
        {reactionsOverlay}
        {selecting && (
          <View
            style={[
              styles.selectBadge,
              isOwn ? styles.selectBadgeOwn : styles.selectBadgeIncoming,
              {
                backgroundColor: selected ? '#34B7F1' : 'transparent',
                borderColor: selected ? '#34B7F1' : '#667781',
              },
            ]}
          >
            {selected && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 8,
    marginVertical: 2,
    flexDirection: 'row',
  },
  rowOwn: {
    justifyContent: 'flex-end',
  },
  rowIncoming: {
    justifyContent: 'flex-start',
  },
  rowWithReactions: {
    marginBottom: 24,
  },
  dimmed: {
    opacity: 0.5,
  },
  selectBadge: {
    position: 'absolute',
    bottom: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 6,
  },
  selectBadgeOwn: {
    right: -6,
  },
  selectBadgeIncoming: {
    left: -6,
  },
  bubbleWrap: {
    maxWidth: '80%',
  },
  bubble: {
    minWidth: 96,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    paddingBottom: 5,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyBox: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    marginBottom: 4,
    borderRadius: 2,
  },
  replySender: {
    fontSize: 12,
    fontWeight: '600',
  },
  replyText: {
    fontSize: 13,
    marginTop: 1,
  },
  deletedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  deletedText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  mediaWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    maxWidth: 240,
  },
  mediaBox: {
    marginBottom: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  mediaImage: {
    width: 220,
    height: 220,
    borderRadius: 6,
  },
  mediaPlaceholder: {
    width: 220,
    height: 220,
    borderRadius: 6,
  },
  metaOverlay: {
    position: 'absolute',
    bottom: 10,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  timeOverlay: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  fileWrap: {
    maxWidth: 220,
  },
  fileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
    maxWidth: 220,
  },
  fileName: {
    flex: 1,
    fontSize: 13,
  },
  text: {
    fontSize: 15,
    lineHeight: 20,
  },
  edited: {
    fontSize: 11,
    marginRight: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 2,
  },
  reactionsOverlay: {
    position: 'absolute',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 2,
    zIndex: 5,
  },
  reactionsOwn: {
    right: -2,
    bottom: -13,
    justifyContent: 'flex-end',
  },
  reactionsIncoming: {
    left: -2,
    bottom: -13,
    justifyContent: 'flex-start',
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 5,
    paddingVertical: 2,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  reactionEmoji: {
    fontSize: 12,
  },
  reactionCount: {
    fontSize: 11,
    marginLeft: 1,
  },
  time: {
    fontSize: 11,
  },
  tick: {
    marginLeft: 3,
    width: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deletedEnd: {
    height: 4,
  },
});