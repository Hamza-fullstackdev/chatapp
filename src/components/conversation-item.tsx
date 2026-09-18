import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from './avatar';
import type { ConversationDTO } from '@/types/api';
import { formatConversationTime, previewText } from '@/lib/format';
import { useWaTheme } from '@/context/theme-context';
import type { WaPalette } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';

interface ConversationItemProps {
  conversation: ConversationDTO;
  currentUserId: string;
  selecting?: boolean;
  selected?: boolean;
  onPress: (id: string) => void;
  onLongPress?: (id: string) => void;
}

export function conversationTitle(c: ConversationDTO, currentUserId: string): string {
  if (c.type === 'group') return c.name ?? 'Group';
  return c.otherUserName ?? 'Unknown';
}

export function conversationAvatar(c: ConversationDTO): string | null {
  if (c.type === 'group') return c.avatarUrl;
  return c.otherUserAvatarUrl;
}

/**
 * Delivery tick for the conversation's last message:
 *  - clock          = pending / syncing (offline queue)
 *  - single grey ✓  = sent
 *  - double grey ✓✓ = delivered
 *  - double blue ✓✓ = read
 */
function LastMessageTick({ status, colors }: { status: string; colors: WaPalette }) {
  if (status === 'failed') {
    return <Ionicons name="alert-circle" size={16} color="#E5423D" style={styles.tick} />;
  }
  if (status === 'pending' || status === 'syncing') {
    return <Ionicons name="time" size={13} color={colors.textSecondary} style={styles.tick} />;
  }
  if (status === 'read') {
    return <Ionicons name="checkmark-done" size={16} color="#34B7F1" style={styles.tick} />;
  }
  if (status === 'delivered') {
    return <Ionicons name="checkmark-done" size={16} color={colors.textSecondary} style={styles.tick} />;
  }
  return <Ionicons name="checkmark" size={16} color={colors.textSecondary} style={styles.tick} />;
}

export function ConversationItem({
  conversation,
  currentUserId,
  selecting = false,
  selected = false,
  onPress,
  onLongPress,
}: ConversationItemProps) {
  const { colors } = useWaTheme();
  const { lastMessage } = conversation;
  const title = conversationTitle(conversation, currentUserId);

  const isOwn = lastMessage?.senderId === currentUserId;
  const preview =
    lastMessage == null
      ? conversation.type === 'group'
        ? 'Group created'
        : 'Tap to start chatting'
      : previewText(lastMessage.type, lastMessage.text, isOwn ? 'You' : undefined);

  const showTicks = isOwn && lastMessage;

  return (
    <Pressable
      onPress={() => onPress(conversation.id)}
      onLongPress={onLongPress ? () => onLongPress(conversation.id) : undefined}
      delayLongPress={250}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.divider : colors.background },
        selecting && !selected && styles.dimmed,
      ]}
      android_ripple={{ color: colors.divider }}
    >
      <View style={styles.avatarWrap}>
        <Avatar name={title} uri={conversationAvatar(conversation)} size={52} />
        {selecting && (
          <View
            style={[
              styles.checkCircle,
              selected
                ? { backgroundColor: '#34B7F1', borderColor: '#34B7F1' }
                : { backgroundColor: 'rgba(0,0,0,0.35)', borderColor: '#FFFFFF' },
            ]}
          >
            {selected && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
          </View>
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {conversation.updatedAt && (
            <Text style={[styles.time, { color: colors.textSecondary }]}>
              {formatConversationTime(conversation.updatedAt)}
            </Text>
          )}
        </View>

        <View style={styles.previewRow}>
          {showTicks && <LastMessageTick status={lastMessage.status ?? 'sent'} colors={colors} />}
          <Text
            style={[
              styles.preview,
              { color: conversation.unreadCount > 0 ? colors.text : colors.textSecondary },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {preview}
          </Text>
          {conversation.unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dimmed: {
    opacity: 0.5,
  },
  avatarWrap: {
    position: 'relative',
  },
  checkCircle: {
    position: 'absolute',
    top: -4,
    left: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  content: {
    flex: 1,
    marginLeft: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
    marginLeft: 8,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  tick: {
    marginRight: 4,
  },
  preview: {
    flex: 1,
    fontSize: 14,
    minWidth: 0,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});