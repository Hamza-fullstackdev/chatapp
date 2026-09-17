import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from './avatar';
import type { ConversationDTO } from '@/types/api';
import { formatConversationTime, previewText } from '@/lib/format';
import { useWaTheme } from '@/context/theme-context';
import { Ionicons } from '@expo/vector-icons';

interface ConversationItemProps {
  conversation: ConversationDTO;
  currentUserId: string;
  onPress: (id: string) => void;
}

export function conversationTitle(c: ConversationDTO, currentUserId: string): string {
  if (c.type === 'group') return c.name ?? 'Group';
  return c.otherUserName ?? 'Unknown';
}

export function conversationAvatar(c: ConversationDTO): string | null {
  if (c.type === 'group') return c.avatarUrl;
  return c.otherUserAvatarUrl;
}

export function ConversationItem({ conversation, currentUserId, onPress }: ConversationItemProps) {
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
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.divider : colors.background },
      ]}
      android_ripple={{ color: colors.divider }}
    >
      <Avatar name={title} uri={conversationAvatar(conversation)} size={52} />

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
          <View style={styles.previewLeft}>
            {showTicks && (
              <Ionicons
                name="checkmark-done"
                size={16}
                color={conversation.unreadCount > 0 ? '#34B7F1' : colors.brand}
                style={styles.tick}
              />
            )}
            <Text
              style={[
                styles.preview,
                { color: conversation.unreadCount > 0 ? colors.text : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {preview}
            </Text>
          </View>
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
  previewLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tick: {
    marginRight: 4,
  },
  preview: {
    flex: 1,
    fontSize: 14,
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