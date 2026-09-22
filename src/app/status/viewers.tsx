import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/avatar';
import { useWaTheme } from '@/context/theme-context';
import { statusesApi } from '@/lib/api';
import { getDb } from '@/db/database';
import { listUserProfiles } from '@/db/repositories';
import { formatStatusTime } from '@/lib/format';
import type { StatusViewerDTO } from '@/types/api';

export default function StatusViewersScreen() {
  const { colors } = useWaTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const [viewers, setViewers] = useState<StatusViewerDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { viewers: remote } = await statusesApi.viewers(params.id);
        // Prefer locally cached full names when available.
        const db = await getDb();
        const profiles = await listUserProfiles(db, remote.map((v) => v.userId));
        const merged = remote.map((v) => {
          const cached = profiles.get(v.userId);
          return cached
            ? { ...v, name: cached.fullName, avatarUrl: cached.avatarUrl }
            : v;
        });
        if (!active) return;
        setViewers(merged);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Request failed');
      }
    })();
    return () => {
      active = false;
    };
  }, [params.id]);

  return (
    <View style={[styles.safe, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.brandDark }]}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Visibility info</Text>
      </View>

      <View style={styles.infoRow}>
        <Ionicons name="eye-outline" size={18} color={colors.brand} />
        <Text style={[styles.infoText, { color: colors.textSecondary }]}>
          {viewers == null
            ? 'Loading…'
            : `${viewers.length} user${viewers.length === 1 ? 's' : ''} viewed this status`}
        </Text>
      </View>

      {viewers == null ? (
        <View style={styles.center}>
          {error ? (
            <>
              <Text style={[styles.errorText, { color: colors.text }]}>Couldn&apos;t load viewers</Text>
              <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>{error}</Text>
            </>
          ) : (
            <ActivityIndicator size="large" color={colors.brand} />
          )}
        </View>
      ) : (
        <FlatList
          data={viewers}
          keyExtractor={(v) => v.userId}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Avatar name={item.name} uri={item.avatarUrl} size={44} />
              <View style={styles.info}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
                  @{item.username}
                </Text>
              </View>
              <Text style={[styles.time, { color: colors.textSecondary }]}>
                {formatStatusTime(item.viewedAt)}
              </Text>
            </View>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: colors.textSecondary }}>No one has seen this yet.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  headerBtn: { padding: 8 },
  headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '600', marginLeft: 4 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  infoText: { fontSize: 14 },
  list: { paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  info: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  username: { fontSize: 13, marginTop: 1 },
  time: { fontSize: 12 },
  center: { alignItems: 'center', padding: 32 },
  errorText: { fontSize: 16, fontWeight: '600' },
  errorDetail: { fontSize: 13, marginTop: 4 },
});