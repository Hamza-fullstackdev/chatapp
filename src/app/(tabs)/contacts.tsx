import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Tabs, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/context/auth-context';
import { useContacts, useConversations } from '@/hooks/use-data';
import { useSocketEvent } from '@/context/socket-context';
import { conversationsApi, friendRequestsApi } from '@/lib/api';
import { useWaTheme } from '@/context/theme-context';
import type { FriendRequestDTO, UserDTO } from '@/types/api';

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

/** Shown whenever a request is sent (or already pending) so the sender knows
 * the recipient still has to accept before they can chat. */
const sentMessage = (name: string) =>
  `We have sent a request to ${name}. Wait until they accept your request.`;

export default function ContactsScreen() {
  const { colors } = useWaTheme();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const { data: users, loading, error, refresh } = useContacts(search);
  const { data: conversations } = useConversations(user?.id ?? '', true);
  const [friendRequests, setFriendRequests] = useState<{
    incoming: FriendRequestDTO[];
    outgoing: FriendRequestDTO[];
  }>({ incoming: [], outgoing: [] });
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadFriendRequests = useCallback(async () => {
    try {
      const result = await friendRequestsApi.list();
      setFriendRequests(result);
    } catch {
      // Non-fatal: the contacts list and existing conversations still render.
    }
  }, []);

  // Refresh invitations whenever the contacts tab regains focus.
  useFocusEffect(
    useCallback(() => {
      void loadFriendRequests();
    }, [loadFriendRequests]),
  );

  // Realtime: a new request, acceptance or rejection lands while the screen is
  // open — pull the latest invitations + friendship statuses.
  useSocketEvent('friend-request:new', () => {
    void loadFriendRequests();
    void refresh();
  });
  useSocketEvent('friend-request:accepted', () => {
    void loadFriendRequests();
    void refresh();
  });
  useSocketEvent('friend-request:rejected', () => {
    void loadFriendRequests();
    void refresh();
  });

  // Users already in a private conversation show under "Existing contacts".
  // (Private conversations are gated server-side to friends, so this set is
  // always a subset of accepted friends.)
  const existingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conversations ?? []) {
      if (c.type === 'private' && c.otherUserId) ids.add(c.otherUserId);
    }
    return ids;
  }, [conversations]);

  const friendshipOf = useCallback(
    (u: UserDTO) => u.friendship ?? (existingIds.has(u.id) ? 'friends' : 'none'),
    [existingIds],
  );

  type ContactRow = UserDTO | FriendRequestDTO;
  type ContactSection = {
    title: string;
    kind: 'users' | 'requests';
    data: ContactRow[];
  };

  const sections = useMemo<ContactSection[]>(() => {
    if (search.trim()) {
      return [{ title: 'Results', kind: 'users', data: users ?? [] }];
    }
    const incoming: FriendRequestDTO[] = friendRequests.incoming;
    const existing = (users ?? []).filter(
      (u) => friendshipOf(u) === 'friends' && existingIds.has(u.id),
    );
    const all = (users ?? []).filter(
      (u) => !(friendshipOf(u) === 'friends' && existingIds.has(u.id)),
    );
    const out: ContactSection[] = [];
    if (incoming.length > 0) out.push({ title: 'Friend requests', kind: 'requests', data: incoming });
    if (existing.length > 0) out.push({ title: 'Existing contacts', kind: 'users', data: existing });
    if (all.length > 0) out.push({ title: 'All users', kind: 'users', data: all });
    return out;
  }, [users, existingIds, friendshipOf, friendRequests.incoming, search]);

  const openChat = async (userId: string, name: string) => {
    if (busyId) return;
    setBusyId(userId);
    try {
      const { conversation } = await conversationsApi.createPrivate(userId);
      router.push({ pathname: '/chat/[id]', params: { id: conversation.id } });
    } catch {
      // Not friends yet (or request still pending) — the generic message keeps
      // the flow clear instead of a raw server error.
      Alert.alert('Request pending', sentMessage(name));
    } finally {
      setBusyId(null);
    }
  };

  const sendRequest = async (u: UserDTO) => {
    if (busyId) return;
    setBusyId(u.id);
    try {
      await friendRequestsApi.send(u.id);
      await Promise.all([refresh(), loadFriendRequests()]);
      Alert.alert('Request sent', sentMessage(u.fullName));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Try again';
      if (msg === 'REQUEST_ALREADY_PENDING' || msg.includes('already sent you a request')) {
        Alert.alert('Request pending', sentMessage(u.fullName));
      } else {
        Alert.alert('Could not send request', msg);
      }
    } finally {
      setBusyId(null);
    }
  };

  const respond = async (request: FriendRequestDTO, accept: boolean) => {
    if (busyId) return;
    setBusyId(request.id);
    try {
      await (accept
        ? friendRequestsApi.accept(request.id)
        : friendRequestsApi.reject(request.id));
      await Promise.all([refresh(), loadFriendRequests()]);
      if (accept) {
        const peer =
          request.user.fullName ||
          request.user.username ||
          request.user.id;
        Alert.alert('Connected', `You and ${peer} can now chat.`, [
          { text: 'OK' },
          { text: 'Chat', onPress: () => void openChat(request.user.id, peer) },
        ]);
      }
    } catch (e) {
      Alert.alert('Could not respond', e instanceof Error ? e.message : 'Try again');
    } finally {
      setBusyId(null);
    }
  };

  const renderRequest = ({ item }: { item: FriendRequestDTO }) => (
    <View style={[styles.row, { backgroundColor: colors.background }]}>
      <Avatar name={item.user.fullName} uri={item.user.avatarUrl} size={48} />
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {item.user.fullName}
        </Text>
        <Text style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
          @{item.user.username}
        </Text>
      </View>
      {busyId === item.id ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : (
        <View style={styles.requestActions}>
          <Pressable
            hitSlop={6}
            onPress={() => void respond(item, false)}
            style={({ pressed }) => [
              styles.requestBtn,
              { backgroundColor: colors.divider, marginRight: 8 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.requestBtnText, { color: colors.text }]}>Decline</Text>
          </Pressable>
          <Pressable
            hitSlop={6}
            onPress={() => void respond(item, true)}
            style={({ pressed }) => [
              styles.requestBtn,
              { backgroundColor: pressed ? '#00806b' : colors.brand },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.requestBtnText}>Accept</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const renderUser = ({ item }: { item: UserDTO }) => {
    const friendship = friendshipOf(item);
    const busy = busyId === item.id;
    const alreadyFriends = friendship === 'friends';

    const onPress = () => {
      if (alreadyFriends) {
        void openChat(item.id, item.fullName);
      } else if (friendship === 'pending_outgoing') {
        Alert.alert('Request pending', sentMessage(item.fullName));
      } else if (friendship === 'pending_incoming') {
        Alert.alert('Friend request', `${item.fullName} sent you a request.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Accept', onPress: () => void sendAcceptOrGuard(item) },
        ]);
      } else {
        void sendRequest(item);
      }
    };

    let right: React.ReactNode;
    if (busy) {
      right = <ActivityIndicator size="small" color={colors.brand} />;
    } else if (alreadyFriends) {
      right = <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.brand} />;
    } else if (friendship === 'pending_outgoing') {
      right = (
        <Text style={[styles.pendingText, { color: colors.textSecondary }]}>Request sent</Text>
      );
    } else if (friendship === 'pending_incoming') {
      right = (
        <Pressable
          hitSlop={6}
          onPress={(ev) => {
            ev.stopPropagation();
            void respondForUser(item);
          }}
          style={({ pressed }) => [
            styles.addBtn,
            { backgroundColor: pressed ? '#00806b' : colors.brand },
          ]}
        >
          <Text style={styles.addBtnText}>Accept</Text>
        </Pressable>
      );
    } else {
      right = (
        <Pressable
          hitSlop={6}
          onPress={(ev) => {
            ev.stopPropagation();
            void sendRequest(item);
          }}
          style={({ pressed }) => [
            styles.addBtn,
            { backgroundColor: pressed ? '#00806b' : colors.brand },
          ]}
        >
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        onPress={onPress}
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
        {right}
      </Pressable>
    );
  };

  // Accept the pending incoming request for a user (helper for the alert flow;
  // `respond` on a FriendRequestDTO requires the request id, which we look up).
  const sendAcceptOrGuard = async (u: UserDTO) => {
    const request = friendRequests.incoming.find((r) => r.user.id === u.id);
    if (request) void respond(request, true);
    else {
      // Fallback: refresh state; if it really wasn't pending, sending one now is
      // blocked server-side and surfaces the generic message.
      await refresh().catch(() => undefined);
    }
  };

  const respondForUser = async (u: UserDTO) => {
    const request = friendRequests.incoming.find((r) => r.user.id === u.id);
    if (request) void respond(request, true);
    else void sendRequest(u);
  };

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
          keyExtractor={(item) => ('user' in item ? `req:${item.user.id}` : `user:${item.id}`)}
          renderItem={({ section, item }) =>
            section.kind === 'requests'
              ? renderRequest({ item: item as FriendRequestDTO })
              : renderUser({ item: item as UserDTO })
          }
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
          onRefresh={() => {
            void refresh();
            void loadFriendRequests();
          }}
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
  pendingText: {
    fontSize: 13,
  },
  addBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  requestActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  requestBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  requestBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
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