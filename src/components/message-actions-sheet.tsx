import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useWaTheme } from '@/context/theme-context';
import type { MessageDTO } from '@/types/api';
import { QUICK_REACTIONS } from '@/constants/media-sources';

interface MessageActionsSheetProps {
  message: MessageDTO;
  visible: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Bottom sheet shown after a long-press on a message: quick reactions plus
 * reply / edit / delete actions.
 */
export function MessageActionsSheet({
  message,
  visible,
  canEdit,
  canDelete,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onClose,
}: MessageActionsSheetProps) {
  const { colors } = useWaTheme();
  const ownReactions = new Set(message.reactions.map((r) => r.emoji));

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: colors.incomingBubble }]}>
          <Text style={[styles.title, { color: colors.textSecondary }]}>
            {message.type === 'text' && message.text ? message.text.slice(0, 60) : 'Message'}
          </Text>

          <View style={styles.reactionRow}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                hitSlop={6}
                onPress={() => onReact(emoji)}
                style={[
                  styles.emojiBtn,
                  ownReactions.has(emoji) && { backgroundColor: colors.brandLight },
                ]}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.divider} />

          <View style={styles.actionRow}>
            <Pressable style={styles.actionBtn} onPress={() => { onReply(); onClose(); }}>
              <Ionicons name="arrow-undo" size={20} color={colors.brand} />
              <Text style={[styles.actionLabel, { color: colors.text }]}>Reply</Text>
            </Pressable>
            {canEdit && (
              <Pressable style={styles.actionBtn} onPress={() => { onEdit(); onClose(); }}>
                <Ionicons name="create-outline" size={20} color={colors.brand} />
                <Text style={[styles.actionLabel, { color: colors.text }]}>Edit</Text>
              </Pressable>
            )}
            {canDelete && (
              <Pressable style={styles.actionBtn} onPress={() => { onDelete(); onClose(); }}>
                <Ionicons name="trash-outline" size={20} color="#E5423D" />
                <Text style={[styles.actionLabel, { color: '#E5423D' }]}>Delete</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    paddingBottom: 28,
  },
  title: {
    fontSize: 13,
    marginBottom: 14,
  },
  reactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 14,
  },
  emojiBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 26,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.12)',
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 10,
  },
  actionLabel: {
    fontSize: 13,
  },
});