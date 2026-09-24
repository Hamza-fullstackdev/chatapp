import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/avatar';
import { useWaTheme } from '@/context/theme-context';
import { statusesApi } from '@/lib/api';
import { getDb } from '@/db/database';
import { listUserProfiles } from '@/db/repositories';
import { formatStatusTime } from '@/lib/format';
import type { StatusViewerDTO } from '@/types/api';

interface StatusViewersSheetProps {
  statusId: string | null;
  visible: boolean;
  onClose: () => void;
}

/**
 * WhatsApp-style "seen by" bottom sheet for the current user's status. Renders
 * as a modal that slides up from the bottom instead of a separate screen, and
 * deliberately does NOT unmount the status viewer behind it, so the status
 * playback can be paused/resumed by the screen while the sheet is open.
 */
export function StatusViewersSheet({ statusId, visible, onClose }: StatusViewersSheetProps) {
  const { colors } = useWaTheme();
  const insets = useSafeAreaInsets();
  const [viewers, setViewers] = useState<StatusViewerDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !statusId) return;
    let active = true;
    (async () => {
      try {
        // Reset happens after the first await so opening the sheet for another
        // status still shows the loading state, without a synchronous
        // setState in the effect body.
        const db = await getDb();
        if (!active) return;
        setViewers(null);
        setError(null);
        const { viewers: remote } = await statusesApi.viewers(statusId);
        // Prefer locally cached full names when available.
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
  }, [visible, statusId]);

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.divider,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.divider }]} />

          <View style={styles.header}>
            <Ionicons name="eye-outline" size={18} color={colors.brand} />
            <Text style={[styles.headerText, { color: colors.text }]} numberOfLines={1}>
              {viewers == null
                ? 'Visibility info'
                : `${viewers.length} user${viewers.length === 1 ? '' : 's'} viewed this status`}
            </Text>
            <Pressable hitSlop={8} onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.divider }]} />

          {viewers == null ? (
            <View style={styles.center}>
              {error ? (
                <>
                  <Text style={[styles.errorTitle, { color: colors.text }]}>
                    Couldn&apos;t load viewers
                  </Text>
                  <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>
                    {error}
                  </Text>
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
                    <Text
                      style={[styles.username, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
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
                  <Text style={{ color: colors.textSecondary }}>
                    No one has seen this yet.
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: "72%",
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  closeBtn: { padding: 4 },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  list: { paddingBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  info: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: "600" },
  username: { fontSize: 13, marginTop: 1 },
  time: { fontSize: 12 },
  center: { alignItems: "center", padding: 32 },
  errorTitle: { fontSize: 16, fontWeight: "600" },
  errorDetail: { fontSize: 13, marginTop: 4 },
});