import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/context/auth-context';
import { useContacts, useConversations } from '@/hooks/use-data';
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
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const { data: users, loading, error, refresh } = useContacts(search);
  const { data: conversations } = useConversations(user?.id ?? '', true);
  const [starting, setStarting] = useState<string | null>(null);

  // Users already in a private conversation show under "Existing users".
  const existingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conversations ?? []) {
      if (c.type === 'private' && c.otherUserId) ids.add(c.otherUserId);
    }
    return ids;
  }, [conversations]);

  const sections = useMemo(() => {
    if (search.trim()) {
      return [{ title: 'Results', data: users ?? [] }];
    }
    const existing = (users ?? []).filter((u) => existingIds.has(u.id));
    const all = (users ?? []).filter((u) => !existingIds.has(u.id));
    const out: { title: string; data: UserDTO[] }[] = [];
    if (existing.length > 0) out.push({ title: 'Existing users', data: existing });
    out.push({ title: 'All users', data: all });
    return out;
  }, [users, existingIds, search]);

  const openChat = async (userId: string) => {
    if (starting) return;
    setStarting(userId);
    try {
      const { conversation } = await conversationsApi.createPrivate(userId);
      router.push({ pathname: '/chat/[id]', params: { id: conversation.id } });
    } catch {
      // Fall through: loader stays visible briefly so the tap is noticeable,
      // then reverts so the user can retry.
    } finally {
      setStarting(null);
    }
  };

  const renderItem = ({ item }: { item: UserDTO }) => (
    <Pressable
      onPress={() => openChat(item.id)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.divider : colors.background }]}
      android_ripple={{ color: colors.divider }}
    >
      <Avatar name={item.fullName} uri={item.avatarUrl} size={48} />
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {item.fullName}
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

      <Pressable
        onPress={() => router.push('/group/new')}
        style={({ pressed }) => [
          styles.newGroupBtn,
          { backgroundColor: pressed ? '#00806b' : colors.brand },
        ]}
      >
        <Ionicons name="people" size={22} color="#FFFFFF" />
        <Text style={styles.newGroupText}>New group</Text>
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.85)" />
      </Pressable>

      {loading && users == null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : error && users == null ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.text }]}>Couldn&apos;t load contacts</Text>
          <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>{error}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(u) => u.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              {section.title}
            </Text>
          )}
          stickySectionHeadersEnabled={false}
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
  newGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 12,
    marginBottom: 4,
    paddingVertical: 13,
    borderRadius: 12,
    gap: 8,
  },
  newGroupText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    paddingVertical: 4,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
    backgroundColor: 'transparent',
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