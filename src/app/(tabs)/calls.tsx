import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWaTheme } from '@/context/theme-context';
import { useCalls } from '@/context/call-context';
import { callsApi } from '@/lib/api';
import { Avatar } from '@/components/avatar';
import { formatTime } from '@/lib/format';
import type { CallDTO } from '@/types/api';

function callIcon(call: CallDTO) {
  if (call.status === 'missed') return { name: 'call' as const, color: '#E5423D', rotate: true };
  if (call.status === 'ongoing') return { name: 'call' as const, color: '#25D366', rotate: false };
  if (call.status === 'rejected') return { name: 'call' as const, color: '#E5423D', rotate: false };
  return { name: call.callType === 'video' ? ('videocam' as const) : ('call' as const), color: '#8696A0', rotate: false };
}

export default function CallsScreen() {
  const { colors } = useWaTheme();
  const { startCall } = useCalls();
  const [calls, setCalls] = useState<CallDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    callsApi
      .history(50)
      .then(({ calls: list }) => setCalls(list))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load calls'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <Tabs.Screen options={{ headerShadowVisible: false }} />

      {loading && calls == null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.text }]}>Couldn&apos;t load calls</Text>
          <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>{error}</Text>
          <Pressable onPress={load} style={[styles.retry, { borderColor: colors.brand }]}>
            <Text style={{ color: colors.brand }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={calls ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.empty, { color: colors.textSecondary }]}>
                No calls yet. Start one from the contacts tab.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const icon = callIcon(item);
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? colors.divider : colors.background },
                ]}
                onPress={() => void startCall(item.peerId, item.callType === 'video' ? 'video' : 'voice')}
              >
                <Avatar name={item.peerName ?? '?'} uri={item.peerAvatarUrl} size={52} />
                <View style={styles.content}>
                  <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                    {item.peerName ?? 'Unknown'}
                  </Text>
                  <View style={styles.subRow}>
                    <Ionicons
                      name={icon.name}
                      size={14}
                      color={icon.color}
                      style={icon.rotate ? { transform: [{ rotate: '135deg' }] } : undefined}
                    />
                    <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                      {item.status === 'missed' ? 'Missed ' : item.status === 'ongoing' ? 'On going ' : item.isOutgoing ? 'Outgoing ' : 'Incoming '}
                      · {formatTime(item.createdAt)}
                    </Text>
                  </View>
                </View>
                <Pressable
                  hitSlop={8}
                  style={styles.callBtn}
                  onPress={() => void startCall(item.peerId, item.callType === 'video' ? 'video' : 'voice')}
                >
                  <Ionicons
                    name={item.callType === 'video' ? 'videocam' : 'call'}
                    size={22}
                    color={colors.brand}
                  />
                </Pressable>
              </Pressable>
            );
          }}
          onRefresh={load}
          refreshing={loading}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  errorDetail: { fontSize: 13, textAlign: 'center', marginBottom: 16 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  listContent: { paddingVertical: 4, flexGrow: 1 },
  empty: { fontSize: 14, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  content: { flex: 1, marginLeft: 12 },
  title: { fontSize: 16, fontWeight: '600' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  subtitle: { fontSize: 13 },
  callBtn: { padding: 8 },
});