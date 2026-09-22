import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useWaTheme } from "@/context/theme-context";
import type { MessageDTO } from "@/types/api";
import { Avatar } from "@/components/avatar";

export interface ReactionUserInfo {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  isMe: boolean;
}

interface ReactionsSheetProps {
  message: MessageDTO | null;
  myId: string;
  resolveUser: (userId: string) => ReactionUserInfo;
  visible: boolean;
  onReact: (emoji: string) => void;
  onClose: () => void;
}

interface EmojiTab {
  key: string;
  emoji: string | null;
  label: string;
  count: number;
}

interface ReactionGroup {
  emoji: string;
  count: number;
  users: ReactionUserInfo[];
  isMine: boolean;
}

/** One user counts at most once per emoji — merge stray duplicates. */
function groupUsers(
  rows: { userId: string }[],
  resolveUser: (userId: string) => ReactionUserInfo,
): ReactionUserInfo[] {
  const seen = new Set<string>();
  const out: ReactionUserInfo[] = [];
  for (const row of rows) {
    if (!row.userId || seen.has(row.userId)) continue;
    seen.add(row.userId);
    out.push(resolveUser(row.userId));
  }
  return out;
}

/**
 * WhatsApp-style "reactions" bottom sheet: who reacted to a message and with
 * which emoji. An "Everyone" tab shows each emoji grouped with its users; the
 * per-emoji tabs list only the people who used that reaction.
 */
export function ReactionsSheet({
  message,
  myId,
  resolveUser,
  visible,
  onReact,
  onClose,
}: ReactionsSheetProps) {
  const { colors } = useWaTheme();
  const insets = useSafeAreaInsets();
  const [selectedTab, setSelectedTab] = useState<string>("all");

  const groups = useMemo(() => {
    if (!message) return [];
    const order = message.reactions.reduce<string[]>((acc, r) => {
      if (!acc.includes(r.emoji)) acc.push(r.emoji);
      return acc;
    }, []);
    return order.map((emoji) => ({
      emoji,
      count: message.reactions.filter((r) => r.emoji === emoji && r.userId)
        .length,
      isMine: message.reactions.some(
        (r) => r.userId === myId && r.emoji === emoji,
      ),
      users: groupUsers(
        message.reactions.filter((r) => r.emoji === emoji),
        resolveUser,
      ),
    }));
  }, [message, myId, resolveUser]);

  const tabs = useMemo<EmojiTab[]>(
    () => [
      {
        key: "all",
        emoji: null,
        label: "All",
        count: message?.reactions.length ?? 0,
      },
      ...groups.map((g) => ({
        key: g.emoji,
        emoji: g.emoji,
        label: g.emoji,
        count: g.count,
      })),
    ],
    [message, groups],
  );

  const shownGroups =
    selectedTab === "all"
      ? groups
      : groups.filter((g) => g.emoji === selectedTab);

  const renderGroupHeader = (group: ReactionGroup) => (
    <Pressable
      style={({ pressed }) => [styles.groupHeader, pressed && { opacity: 0.6 }]}
      onPress={() => onReact(group.emoji)}
    >
      <Text style={styles.groupEmoji}>{group.emoji}</Text>
      <View
        style={[
          styles.groupCountChip,
          group.isMine && { backgroundColor: colors.brandLight },
        ]}
      >
        <Text
          style={[
            styles.groupCount,
            { color: group.isMine ? colors.brand : colors.textSecondary },
          ]}
        >
          {group.count}
        </Text>
        {group.isMine && (
          <Ionicons name='checkmark' size={14} color={colors.brand} />
        )}
      </View>
    </Pressable>
  );

  const renderUserRow = (user: ReactionUserInfo) => (
    <View style={styles.userRow}>
      <Avatar name={user.name} uri={user.avatarUrl} size={36} />
      <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
        {user.name}
        {user.isMe ? (
          <Text style={[styles.youBadge, { color: colors.textSecondary }]}>
            {" "}
            (You)
          </Text>
        ) : null}
      </Text>
      {selectedTab !== "all" && (
        <Text style={styles.userEmoji}>{selectedTab}</Text>
      )}
    </View>
  );

  const renderEveryone = (info: ListRenderItemInfo<ReactionGroup>) => {
    const group = info.item;
    return (
      <View style={styles.group}>
        {renderGroupHeader(group)}
        {group.users.map((user) => (
          <View key={`${group.emoji}|${user.id}`}>
            {renderUserRow(user)}
            <View
              style={[styles.userDivider, { backgroundColor: colors.divider }]}
            />
          </View>
        ))}
      </View>
    );
  };

  const renderPerEmoji = (info: ListRenderItemInfo<ReactionGroup>) => {
    const group = info.item;
    return (
      <View style={styles.group}>
        {group.users.map((user) => (
          <View key={`${group.emoji}|${user.id}`}>
            {renderUserRow(user)}
            <View
              style={[styles.userDivider, { backgroundColor: colors.divider }]}
            />
          </View>
        ))}
      </View>
    );
  };

  const isSelected = selectedTab !== "all";
  const activeTabStyles = (active: boolean) => [
    styles.tab,
    active && { borderBottomColor: colors.brand, borderBottomWidth: 3 },
  ];

  return (
    <Modal
      transparent
      visible={visible}
      animationType='slide'
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.incomingBubble,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.header}>
            <Text
              style={[styles.messagePreview, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {message && message.type === "text" && message.text
                ? message.text
                : message && message.attachments.length > 0
                  ? "📎 Media"
                  : "Message"}
            </Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <Ionicons name='close' size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View>
            <FlatList
              data={tabs}
              keyExtractor={(t) => t.key}
              horizontal
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [
                    activeTabStyles(item.key === selectedTab),
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => setSelectedTab(item.key)}
                >
                  {item.emoji ? (
                    <Text style={styles.tabEmoji}>{item.emoji}</Text>
                  ) : (
                    <Text style={[styles.tabLabel, { color: colors.text }]}>
                      {item.label}
                    </Text>
                  )}
                  <Text
                    style={[styles.tabCount, { color: colors.textSecondary }]}
                  >
                    {item.count}
                  </Text>
                </Pressable>
              )}
            />
            <View
              style={[
                styles.tabBottomLine,
                { backgroundColor: colors.divider },
              ]}
            />
          </View>

          {message && shownGroups.length > 0 ? (
            <FlatList
              data={shownGroups}
              keyExtractor={(g) => g.emoji}
              renderItem={isSelected ? renderPerEmoji : renderEveryone}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps='handled'
            />
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No reactions yet
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: "72%",
    paddingTop: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 12,
    gap: 12,
  },
  messagePreview: {
    flex: 1,
    fontSize: 13,
  },
  tabBottomLine: {
    height: StyleSheet.hairlineWidth,
  },
  tab: {
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 2,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  tabEmoji: {
    fontSize: 20,
  },
  tabCount: {
    fontSize: 12,
  },
  listContent: {
    paddingVertical: 6,
  },
  group: {
    paddingHorizontal: 18,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  groupEmoji: {
    fontSize: 24,
  },
  groupCountChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  groupCount: {
    fontSize: 14,
    fontWeight: "600",
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  userName: {
    flex: 1,
    fontSize: 15,
  },
  youBadge: {
    fontSize: 15,
  },
  userEmoji: {
    fontSize: 18,
  },
  userDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 48,
    marginTop: 4,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
  },
});
