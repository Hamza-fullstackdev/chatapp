import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useState } from 'react';
import { router, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth-context';
import { useWaTheme } from '@/context/theme-context';
import { useConversations } from '@/hooks/use-data';
import { ConversationItem } from '@/components/conversation-item';
import { conversationsApi } from '@/lib/api';
import { getDb } from '@/db/database';
import { deleteConversationsLocal } from '@/db/repositories';
import type { ConversationDTO } from '@/types/api';

function HeaderRight() {
  const { colors } = useWaTheme();
  return (
    <View style={styles.headerIcons}>
      <Pressable hitSlop={8} style={styles.headerIcon}>
        <Ionicons name="camera-outline" size={22} color={colors.text} />
      </Pressable>
      <Pressable hitSlop={8} style={styles.headerIcon}>
        <Ionicons name="search" size={22} color={colors.text} />
      </Pressable>
      <Pressable hitSlop={8} style={styles.headerIcon} onPress={() => router.push('/settings')}>
        <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}

export default function ChatsScreen() {
  const { user } = useAuth();
  const { colors } = useWaTheme();
  const { data: conversations, loading, error, refresh } = useConversations(user?.id ?? '', true);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const enterSelection = (id: string) => {
    setSelected(new Set([id]));
    setSelectMode(true);
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const confirmDeleteChats = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    Alert.alert(
      'Delete chats',
      `Delete ${ids.length} chat${ids.length > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void deleteChats(ids),
        },
      ],
    );
  };

  const deleteChats = async (ids: string[]) => {
    try {
      await conversationsApi.remove(ids);
      const db = await getDb();
      await deleteConversationsLocal(db, ids);
    } catch (e) {
      Alert.alert('Could not delete chats', e instanceof Error ? e.message : 'Please try again');
    } finally {
      exitSelection();
      void refresh();
    }
  };

  const renderItem = ({ item }: { item: ConversationDTO }) => (
    <ConversationItem
      conversation={item}
      currentUserId={user?.id ?? ''}
      selecting={selectMode}
      selected={selected.has(item.id)}
      onPress={(id) => {
        if (selectMode) toggleSelected(id);
        else router.push({ pathname: '/chat/[id]', params: { id } });
      }}
      onLongPress={enterSelection}
    />
  );

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <Tabs.Screen
        options={{
          headerShadowVisible: false,
          headerTitle: selectMode ? `${selected.size} selected` : 'Chats',
          headerLeft: selectMode
            ? () => (
                <Pressable
                  onPress={exitSelection}
                  hitSlop={10}
                  style={styles.headerIcon}
                >
                  <Ionicons name="close" size={24} color="#FFFFFF" />
                </Pressable>
              )
            : undefined,
          headerRight: selectMode
            ? () => (
                <Pressable
                  onPress={confirmDeleteChats}
                  disabled={selected.size === 0}
                  hitSlop={10}
                  style={[styles.headerIcon, { opacity: selected.size === 0 ? 0.4 : 1 }]}
                >
                  <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
                </Pressable>
              )
            : () => <HeaderRight />,
        }}
      />

      {loading && conversations == null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.text }]}>Couldn&apos;t load chats</Text>
          <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>{error}</Text>
          <Pressable onPress={refresh} style={[styles.retry, { borderColor: colors.brand }]}>
            <Text style={{ color: colors.brand }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={conversations ?? []}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.divider }]} />}
          contentContainerStyle={[styles.listContent]}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.empty, { color: colors.textSecondary }]}>
                No conversations yet. Use the + button to start one.
              </Text>
            </View>
          }
          onRefresh={refresh}
          refreshing={loading}
        />
      )}

      {!selectMode && (
        <Pressable
          onPress={() => router.push('/contacts')}
          style={({ pressed }) => [styles.fab, { backgroundColor: pressed ? '#00806b' : colors.brand }]}
        >
          <Ionicons name="add" size={30} color="#FFFFFF" />
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    marginLeft: 18,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  listContent: {
    paddingVertical: 2,
    flexGrow: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 78,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  errorDetail: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  retry: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  empty: {
    fontSize: 14,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 28,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});