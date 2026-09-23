import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useWaTheme } from '@/context/theme-context';
import { conversationsApi, friendRequestsApi, usersApi } from '@/lib/api';
import { getDb } from '@/db/database';
import { getUserProfile, upsertUserProfile } from '@/db/repositories';
import { Avatar } from '@/components/avatar';
import { formatLastSeen } from '@/lib/format';
import type { FriendshipStatus, UserDTO } from '@/types/api';

export default function UserProfileScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const userId = String(params.id ?? '');
  const { colors } = useWaTheme();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<UserDTO | null>(null);
  const [friendship, setFriendship] = useState<FriendshipStatus>('none');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      // Offline-first: render the cached profile instantly, then refresh.
      const db = await getDb();
      const cached = await getUserProfile(db, userId);
      if (!active) return;
      if (cached) {
        setProfile({ ...cached, createdAt: '' });
        setLoading(false);
      }
      try {
        const loaded = await usersApi.get(userId);
        if (!active) return;
        setProfile(loaded);
        setFriendship(loaded.friendship ?? 'none');
        setLoading(false);
        await upsertUserProfile(db, {
          id: loaded.id,
          fullName: loaded.fullName,
          username: loaded.username,
          bio: loaded.bio,
          avatarUrl: loaded.avatarUrl,
          lastSeenAt: loaded.lastSeenAt,
        });
      } catch (e) {
        if (active && !cached) {
          setLoading(false);
          setError(e instanceof Error ? e.message : 'Could not load profile');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const openChat = async () => {
    if (starting || !profile) return;
    setStarting(true);
    try {
      const { conversation } = await conversationsApi.createPrivate(profile.id);
      router.replace(`/chat/${conversation.id}`);
    } catch (e) {
      setStarting(false);
      Alert.alert('Could not open chat', e instanceof Error ? e.message : 'Try again');
    }
  };

  // "We have sent a request to X. Wait until they accept your request."
  const requestSentMessage = (name: string) =>
    `We have sent a request to ${name}. Wait until they accept your request.`;

  const sendRequest = async () => {
    if (starting || !profile) return;
    setStarting(true);
    try {
      await friendRequestsApi.send(profile.id);
      setFriendship('pending_outgoing');
      Alert.alert('Request sent', requestSentMessage(profile.fullName));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Try again';
      if (msg === 'REQUEST_ALREADY_PENDING') {
        setFriendship('pending_outgoing');
        Alert.alert('Request pending', requestSentMessage(profile.fullName));
      } else if (msg.includes('already sent you a request')) {
        setFriendship('pending_incoming');
        Alert.alert('Request pending', `${profile.fullName} sent you a request. Accept it to connect.`);
      } else if (msg.includes('already friends')) {
        setFriendship('friends');
        Alert.alert('Connected', `You and ${profile.fullName} are already friends.`);
      } else {
        Alert.alert('Could not send request', msg);
      }
    } finally {
      setStarting(false);
    }
  };

  const acceptRequest = async () => {
    if (starting || !profile) return;
    setStarting(true);
    try {
      const { incoming } = await friendRequestsApi.list();
      const request = incoming.find((r) => r.user.id === profile.id);
      if (!request) throw new Error('No pending request from this user');
      await friendRequestsApi.accept(request.id);
      setFriendship('friends');
      Alert.alert('Connected', `You and ${profile.fullName} can now chat.`, [
        { text: 'OK' },
        { text: 'Message', onPress: () => void openChat() },
      ]);
    } catch (e) {
      Alert.alert('Could not accept request', e instanceof Error ? e.message : 'Try again');
    } finally {
      setStarting(false);
    }
  };

  const primaryAction =
    friendship === 'friends'
      ? { handler: openChat, label: 'Message', icon: 'chatbubble-ellipses' as const }
      : friendship === 'pending_outgoing'
        ? { handler: undefined, label: 'Request sent', icon: 'time-outline' as const }
        : friendship === 'pending_incoming'
          ? { handler: acceptRequest, label: 'Accept request', icon: 'person-add' as const }
          : { handler: sendRequest, label: 'Add friend', icon: 'person-add' as const };

  const showName = profile?.fullName ?? '';
  const online = false;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.brandDark }]}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Contact info</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : error || !profile ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.text }]}>Couldn&apos;t load this profile</Text>
          <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>{error}</Text>
          <Pressable onPress={() => router.back()} style={[styles.retry, { borderColor: colors.brand }]}>
            <Text style={{ color: colors.brand }}>Go back</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.body}>
          <Pressable onPress={() => setViewingPhoto(true)} style={styles.avatarWrap}>
            <Avatar name={showName} uri={profile.avatarUrl} size={120} />
            <View style={styles.zoomHint}>
              <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
            </View>
          </Pressable>
          <Text style={[styles.name, { color: colors.text }]}>{profile.fullName}</Text>
          <Text style={[styles.username, { color: colors.textSecondary }]}>@{profile.username}</Text>
          <Text style={[styles.presence, { color: colors.textSecondary }]}>
            {online ? 'online' : profile.lastSeenAt ? `last seen ${formatLastSeen(profile.lastSeenAt)}` : 'offline'}
          </Text>

          <Pressable
            onPress={() => {
              if (primaryAction.handler) void primaryAction.handler();
            }}
            disabled={starting || !primaryAction.handler}
            style={({ pressed }) => [
              styles.messageBtn,
              { backgroundColor: pressed ? '#00806b' : colors.brand },
              (starting || !primaryAction.handler) && styles.busy,
            ]}
          >
            {starting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name={primaryAction.icon} size={20} color="#FFFFFF" />
            )}
            <Text style={styles.messageBtnText}>
              {starting ? 'Working…' : primaryAction.label}
            </Text>
          </Pressable>

          <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.row}>
              <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>About</Text>
              <Text style={[styles.rowValue, { color: colors.textSecondary }]} numberOfLines={4}>
                {profile.bio ?? `Hey there! I am using chat-app.`}
              </Text>
            </View>
          </View>
        </View>
      )}

      {viewingPhoto && profile?.avatarUrl && (
        <Modal visible animationType="fade" onRequestClose={() => setViewingPhoto(false)} statusBarTranslucent>
          <StatusBar style="light" />
          <View style={[styles.photoOverlay, { backgroundColor: '#000000' }]}>
            <Pressable
              hitSlop={10}
              style={[styles.photoClose, { top: insets.top + 8 }]}
              onPress={() => setViewingPhoto(false)}
            >
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </Pressable>
            <Image source={{ uri: profile.avatarUrl }} style={styles.photo} contentFit="contain" transition={150} />
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  headerBtn: { padding: 8 },
  headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '600', marginLeft: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  errorDetail: { fontSize: 13, textAlign: 'center', marginBottom: 16 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  body: { flex: 1, alignItems: 'center', padding: 24 },
  avatarWrap: {
    position: 'relative',
    borderRadius: 60,
    overflow: 'hidden',
  },
  zoomHint: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 14,
    padding: 5,
  },
  name: { fontSize: 20, fontWeight: '700', marginTop: 14 },
  username: { fontSize: 14, marginTop: 2 },
  presence: { fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  messageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginTop: 20,
    marginBottom: 24,
  },
  messageBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  busy: { opacity: 0.7 },
  card: { width: '100%', borderRadius: 14, paddingHorizontal: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomColor: 'rgba(0,0,0,0.06)',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 15, fontWeight: '600', width: 64 },
  rowValue: { flex: 1, fontSize: 14, textAlign: 'right' },
  photoOverlay: { flex: 1 },
  photoClose: { position: 'absolute', right: 20, zIndex: 2, padding: 6 },
  photo: { width: '100%', height: '100%' },
});