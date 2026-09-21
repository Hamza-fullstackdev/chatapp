import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Tabs, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWaTheme } from '@/context/theme-context';
import { useCalls } from '@/context/call-context';
import { useLocalDb } from '@/lib/local-db-events';
import { callsApi } from '@/lib/api';
import { getDb } from '@/db/database';
import { deleteCallsLocal, listCalls, upsertCall } from '@/db/repositories';
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

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // SQLite-first: show the cached call history instantly (even offline), then
  // refresh from the API in the background.
  const reloadCache = useCallback(async () => {
    const db = await getDb();
    const rows = await listCalls(db, 100);
    setCalls((prev) => (prev == null ? rows : prev));
  }, []);

  useLocalDb(() => {
    void reloadCache();
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadCache();
  }, [reloadCache]);

  const load = useCallback(() => {
    setLoading(true);
    callsApi
      .history(50)
      .then(async ({ calls: list }) => {
        setCalls(list);
        const db = await getDb();
        for (const call of list) await upsertCall(db, call);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load calls'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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

  const confirmDeleteCalls = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    Alert.alert(
      'Delete calls',
      `Delete ${ids.length} call${ids.length > 1 ? 's' : ''} from your history?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteSelected(ids) },
      ],
    );
  };

  const deleteSelected = async (ids: string[]) => {
    try {
      await callsApi.remove(ids);
      const db = await getDb();
      await deleteCallsLocal(db, ids);
      setCalls((prev) => (prev ? prev.filter((c) => !ids.includes(c.id)) : prev));
    } catch (e) {
      Alert.alert('Could not delete calls', e instanceof Error ? e.message : 'Please try again');
    } finally {
      exitSelection();
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <Tabs.Screen
        options={{
          headerShadowVisible: false,
          headerTitle: selectMode ? `${selected.size} selected` : 'Calls',
          headerLeft: selectMode
            ? () => (
                <Pressable onPress={exitSelection} hitSlop={10} style={styles.headerIcon}>
                  <Ionicons name="close" size={24} color="#FFFFFF" />
                </Pressable>
              )
            : undefined,
          headerRight: selectMode
            ? () => (
                <Pressable
                  onPress={confirmDeleteCalls}
                  disabled={selected.size === 0}
                  hitSlop={10}
                  style={[styles.headerIcon, { opacity: selected.size === 0 ? 0.4 : 1 }]}
                >
                  <Ionicons name="trash-outline" size={22} color="#FFFFFF" />
                </Pressable>
              )
            : undefined,
        }}
      />

      {loading && calls == null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : error && calls == null ? (
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
            const isSelected = selected.has(item.id);
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? colors.divider : isSelected ? colors.divider : colors.background },
                ]}
                onPress={() => {
                  if (selectMode) toggleSelected(item.id);
                  else void startCall(item.peerId, item.callType === 'video' ? 'video' : 'voice');
                }}
                onLongPress={() => (selectMode ? toggleSelected(item.id) : enterSelection(item.id))}
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
                {selectMode ? (
                  <View
                    style={[
                      styles.selectionCircle,
                      { borderColor: colors.brand, backgroundColor: isSelected ? colors.brand : 'transparent' },
                    ]}
                  >
                    {isSelected && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                  </View>
                ) : (
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
                )}
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
  headerIcon: { marginHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  errorDetail: { fontSize: 13, textAlign: 'center', marginBottom: 16 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  listContent: { paddingVertical: 2, flexGrow: 1 },
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
  selectionCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});