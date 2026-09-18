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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useWaTheme } from '@/context/theme-context';
import { conversationsApi, usersApi } from '@/lib/api';
import { Avatar } from '@/components/avatar';
import { formatLastSeen } from '@/lib/format';
import type { UserDTO } from '@/types/api';

export default function UserProfileScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const userId = String(params.id ?? '');
  const { colors } = useWaTheme();

  const [profile, setProfile] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const loaded = await usersApi.get(userId);
        if (!active) return;
        setProfile(loaded);
        setLoading(false);
      } catch (e) {
        if (active) {
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

  const showName = profile?.name ?? '';
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
          <Text style={[styles.name, { color: colors.text }]}>{profile.name}</Text>
          <Text style={[styles.username, { color: colors.textSecondary }]}>@{profile.username}</Text>
          <Text style={[styles.presence, { color: colors.textSecondary }]}>
            {online ? 'online' : profile.lastSeenAt ? `last seen ${formatLastSeen(profile.lastSeenAt)}` : 'offline'}
          </Text>

          <Pressable
            onPress={openChat}
            disabled={starting}
            style={({ pressed }) => [
              styles.messageBtn,
              { backgroundColor: pressed ? '#00806b' : colors.brand },
              starting && styles.busy,
            ]}
          >
            {starting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="chatbubble-ellipses" size={20} color="#FFFFFF" />
            )}
            <Text style={styles.messageBtnText}>{starting ? 'Opening…' : 'Message'}</Text>
          </Pressable>

          <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
            {profile.phone ? (
              <View style={styles.row}>
                <Ionicons name="call-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.rowLabel, { color: colors.text }]}>Phone</Text>
                <Text style={[styles.rowValue, { color: colors.textSecondary }]}>
                  {profile.phone}
                </Text>
              </View>
            ) : null}
            {profile.email ? (
              <View style={styles.row}>
                <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.rowLabel, { color: colors.text }]}>Email</Text>
                <Text style={[styles.rowValue, { color: colors.textSecondary }]}>
                  {profile.email}
                </Text>
              </View>
            ) : null}
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
          <View style={[styles.photoOverlay, { backgroundColor: '#000000' }]}>
            <Pressable hitSlop={10} style={styles.photoClose} onPress={() => setViewingPhoto(false)}>
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
  photoClose: { position: 'absolute', top: 54, right: 20, zIndex: 2, padding: 6 },
  photo: { width: '100%', height: '100%' },
});