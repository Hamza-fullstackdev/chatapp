import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { AttachmentDTO, MessageDTO } from '@/types/api';
import { formatMessageTime } from '@/lib/format';
import { useWaTheme } from '@/context/theme-context';
import { getAttachmentUrl } from '@/lib/media';

interface MessageBubbleProps {
  message: MessageDTO;
  isOwn: boolean;
  showSenderName?: boolean;
  senderName?: string;
  replyPreview?: { senderId: string; text: string | null; type: string } | null;
  onFailedRetry?: () => void;
  onLongPress?: (message: MessageDTO) => void;
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
    const base = styles.mediaImage;
    return <Image source={{ uri: url }} style={base} contentFit="cover" transition={100} />;
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
}: MessageBubbleProps) {
  const { colors } = useWaTheme();

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
          {message.attachments.filter((a) => a.type === 'image' || a.type === 'gif').length > 0 && (
            <View style={styles.mediaWrap}>
              {message.attachments
                .filter((a) => a.type === 'image' || a.type === 'gif')
                .map((a) => (
                  <AttachmentMedia key={a.id} attachment={a} isOwn={isOwn} />
                ))}
            </View>
          )}
          {message.attachments.some((a) => a.type === 'sticker') && (
            <View style={styles.mediaWrap}>
              {message.attachments
                .filter((a) => a.type === 'sticker')
                .map((a) => (
                  <AttachmentMedia key={a.id} attachment={a} isOwn={isOwn} />
                ))}
            </View>
          )}
          {message.attachments.some((a) => a.type === 'video' || a.type === 'audio' || a.type === 'file') && (
            <View style={styles.fileWrap}>
              {message.attachments
                .filter((a) => a.type === 'video' || a.type === 'audio' || a.type === 'file')
                .map((a) => (
                  <AttachmentMedia key={a.id} attachment={a} isOwn={isOwn} />
                ))}
            </View>
          )}
          {message.text ? (
            <Text style={[styles.text, { color: colors.text }]} selectable>
              {message.text}
            </Text>
          ) : null}
        </>
      )}

      <View style={styles.metaRow}>
        {message.editedAt && !message.deletedAt ? (
          <Text style={[styles.edited, { color: colors.textSecondary }]}>edited</Text>
        ) : null}
        {message.reactions.length > 0 && !message.deletedAt ? (
          <View style={styles.reactionPills}>
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
        ) : null}
        <Text style={[styles.time, { color: colors.textSecondary }]}>{formatMessageTime(message.createdAt)}</Text>
        {isOwn && message.status === 'failed' && onFailedRetry ? (
          <Pressable hitSlop={8} onPress={onFailedRetry} style={styles.tick}>
            <Ionicons name="alert-circle" size={16} color="#E5423D" />
          </Pressable>
        ) : isOwn ? (
          <Ionicons
            name={message.status === 'read' ? 'checkmark-done' : 'checkmark'}
            size={14}
            color={message.status === 'read' ? '#34B7F1' : colors.textSecondary}
            style={styles.tick}
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowIncoming]}>
      {onLongPress ? (
        <Pressable onLongPress={() => onLongPress(message)} delayLongPress={250}>
          {baseContent}
        </Pressable>
      ) : (
        baseContent
      )}
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
  bubble: {
    maxWidth: '82%',
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
  mediaImage: {
    width: 220,
    height: 220,
    borderRadius: 6,
    marginBottom: 4,
  },
  mediaPlaceholder: {
    width: 220,
    height: 220,
    borderRadius: 6,
    marginBottom: 4,
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
    marginTop: 2,
  },
  reactionPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginRight: 6,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 5,
    paddingVertical: 1,
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
  },
});