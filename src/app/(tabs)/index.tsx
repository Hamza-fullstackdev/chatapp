import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth-context';
import { useWaTheme } from '@/context/theme-context';
import { useConversations } from '@/hooks/use-data';
import { ConversationItem } from '@/components/conversation-item';
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

  const renderItem = ({ item }: { item: ConversationDTO }) => (
    <ConversationItem
      conversation={item}
      currentUserId={user?.id ?? ''}
      onPress={(id) => router.push({ pathname: '/chat/[id]', params: { id } })}
    />
  );

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <Tabs.Screen
        options={{
          headerRight: () => <HeaderRight />,
          headerShadowVisible: false,
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

      <Pressable
        onPress={() => router.push('/contacts')}
        style={({ pressed }) => [styles.fab, { backgroundColor: pressed ? '#00806b' : colors.brand }]}
      >
        <Ionicons name="add" size={30} color="#FFFFFF" />
      </Pressable>
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
    paddingVertical: 4,
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