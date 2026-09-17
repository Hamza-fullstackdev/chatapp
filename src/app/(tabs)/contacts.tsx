import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/avatar';
import { useContacts } from '@/hooks/use-data';
import { conversationsApi } from '@/lib/api';
import { useWaTheme } from '@/context/theme-context';
import type { UserDTO } from '@/types/api';

function HeaderRight() {
  const { colors } = useWaTheme();
  return (
    <Pressable
      hitSlop={8}
      style={{ marginRight: 12 }}
      onPress={() => router.push('/group/new')}
    >
      <Ionicons name="person-add" size={22} color={colors.text} />
    </Pressable>
  );
}

export default function ContactsScreen() {
  const { colors } = useWaTheme();
  const [search, setSearch] = useState('');
  const { data: users, loading, error, refresh } = useContacts(search);
  const [starting, setStarting] = useState<string | null>(null);

  const openChat = async (userId: string) => {
    if (starting) return;
    setStarting(userId);
    try {
      const { conversation } = await conversationsApi.createPrivate(userId);
      router.push({ pathname: '/chat/[id]', params: { id: conversation.id } });
    } catch {
      setStarting(null);
    }
  };

  const renderItem = ({ item }: { item: UserDTO }) => (
    <Pressable
      onPress={() => openChat(item.id)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.divider : colors.background }]}
      android_ripple={{ color: colors.divider }}
    >
      <Avatar name={item.name} uri={item.avatarUrl} size={48} />
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
          @{item.username}
        </Text>
      </View>
      {starting === item.id ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : (
        <Ionicons name="add-circle-outline" size={26} color={colors.brand} />
      )}
    </Pressable>
  );

  return (
    <View style={[styles.safe, { backgroundColor: colors.background }]}>
      <Tabs.Screen options={{ headerRight: () => <HeaderRight />, headerShadowVisible: false }} />
      <View style={[styles.searchWrap, { backgroundColor: colors.background }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.divider }]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
      </View>

      {loading && users == null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.text }]}>Couldn&apos;t load contacts</Text>
          <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={users ?? []}
          keyExtractor={(u) => u.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.divider }]} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: colors.textSecondary }}>No contacts found.</Text>
            </View>
          }
          onRefresh={refresh}
          refreshing={loading}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  searchWrap: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
  },
  listContent: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  username: {
    fontSize: 13,
    marginTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 74,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  errorDetail: {
    fontSize: 13,
    textAlign: 'center',
  },
});