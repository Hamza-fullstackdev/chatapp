import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/context/auth-context';
import { useWaTheme } from '@/context/theme-context';
import { useStatuses } from '@/hooks/use-status';
import { getDb } from '@/db/database';
import { listUserProfiles, type StoredProfile } from '@/db/repositories';
import { formatStatusTime } from '@/lib/format';
import type { StatusDTO } from '@/types/api';

export default function StatusScreen() {
  const { colors, dark } = useWaTheme();
  const { user } = useAuth();
  const { data: statuses, loading, error, refresh } = useStatuses(true);
  const [profiles, setProfiles] = useState<Map<string, StoredProfile>>(new Map());
  const [viewedExpanded, setViewedExpanded] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const db = await getDb();
      const ids = Array.from(new Set((statuses ?? []).map((s) => s.userId)));
      const cached = await listUserProfiles(db, ids);
      if (!active) return;
      setProfiles(cached);
    })();
    return () => {
      active = false;
    };
  }, [statuses]);

  const profileFor = (id: string) => profiles.get(id);

  // Group statuses by author, my own excluded from other updates.
  const grouped = useMemo(() => {
    const mine: StatusDTO[] = [];
    const others = new Map<string, StatusDTO[]>();
    for (const s of statuses ?? []) {
      if (s.userId === user?.id) {
        mine.push(s);
      } else {
        const list = others.get(s.userId) ?? [];
        list.push(s);
        others.set(s.userId, list);
      }
    }

    const sortedOthers = Array.from(others.entries()).map(([authorId, list]) => {
      const sortedList = list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      const latestTime = Math.max(...sortedList.map((s) => Date.parse(s.createdAt)));
      const allViewed = sortedList.every((s) => s.viewed);
      return { authorId, list: sortedList, latestTime, allViewed };
    });

    const recent = sortedOthers
      .filter((item) => !item.allViewed)
      .sort((a, b) => b.latestTime - a.latestTime);

    const viewed = sortedOthers
      .filter((item) => item.allViewed)
      .sort((a, b) => b.latestTime - a.latestTime);

    return {
      mine: mine.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
      recent,
      viewed,
    };
  }, [statuses, user?.id]);

  const myCount = grouped.mine.length;

  const openMyStatuses = () => {
    if (myCount === 0) {
      router.push({ pathname: '/status/create', params: { mode: 'text' } });
      return;
    }
    router.push({ pathname: '/status/[id]', params: { id: grouped.mine[0]!.id, mine: '1' } });
  };

  const openAuthor = (authorId: string, list: StatusDTO[]) => {
    const firstUnseen = list.find((s) => !s.viewed) ?? list[0];
    if (firstUnseen) {
      router.push({ pathname: '/status/[id]', params: { id: firstUnseen.id } });
    }
  };

  const renderRow = (authorId: string, list: StatusDTO[], isMine: boolean) => {
    const profile = profileFor(authorId);
    const name = isMine ? 'My status' : (profile?.fullName ?? 'Unknown');
    const avatarUri = isMine ? user?.avatarUrl : profile?.avatarUrl;
    const total = list.length;
    const seen = list.filter((s) => s.viewed).length;
    const unseen = list.some((s) => !s.viewed);
    const latest = total > 0 ? list[list.length - 1]! : null;
    const borderColor = total === 0
      ? 'transparent'
      : unseen
        ? colors.brand
        : dark
          ? '#2A3942'
          : '#DADDE1';

    return (
      <Pressable
        key={isMine ? 'mine' : authorId}
        onPress={() => (isMine ? openMyStatuses() : openAuthor(authorId, list))}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? colors.divider : 'transparent' },
        ]}
      >
        <View style={[styles.ring, { borderColor }]}>
          <Avatar name={name} uri={avatarUri} size={56} />
          {isMine && total === 0 && (
            <Pressable
              hitSlop={8}
              style={[styles.addBtn, { backgroundColor: colors.brand }]}
              onPress={() => router.push({ pathname: '/status/create', params: { mode: 'text' } })}
            >
              <Ionicons name="add" size={18} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.time, { color: colors.textSecondary }]} numberOfLines={1}>
            {isMine
              ? total === 0
                ? 'Tap to add status update'
                : `${total} update${total > 1 ? 's' : ''} · ${latest ? formatStatusTime(latest.createdAt) : ''}`
              : latest ? formatStatusTime(latest.createdAt) : ''}
          </Text>
        </View>
        {isMine ? (
          <Pressable
            hitSlop={8}
            onPress={() => router.push({ pathname: '/status/create', params: { mode: 'media' } })}
            style={{ padding: 6 }}
          >
            <Ionicons name="camera-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <Ionicons
            name={seen === total && total > 0 ? 'eye-outline' : 'ellipse'}
            size={seen === total && total > 0 ? 18 : 10}
            color={seen === total && total > 0 ? colors.textSecondary : colors.brand}
          />
        )}
      </Pressable>
    );
  };

  return (
    <View style={[styles.safe, { backgroundColor: colors.backgroundSecondary }]}>
      <Tabs.Screen options={{ headerShadowVisible: false }} />
      <FlatList
        data={[]}
        keyExtractor={() => 'x'}
        renderItem={null}
        refreshControl={
          <RefreshControl refreshing={loading && statuses != null} onRefresh={refresh} />
        }
        ListHeaderComponent={
          <View>
            <View style={[styles.section, { backgroundColor: colors.background }]}>
              {renderRow(user?.id ?? '', grouped.mine, true)}
              <Pressable
                onPress={() => router.push('/status/audience')}
                style={({ pressed }) => [
                  styles.privacyRow,
                  { backgroundColor: pressed ? colors.divider : 'transparent', borderTopColor: colors.divider },
                ]}
              >
                <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.privacyText, { color: colors.text }]}>Status privacy</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>

            {grouped.recent.length > 0 && (
              <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>Recent updates</Text>
            )}
            <View style={{ backgroundColor: colors.background }}>
              {grouped.recent.map(({ authorId, list }) => renderRow(authorId, list, false))}
            </View>

            {grouped.viewed.length > 0 && (
              <Pressable
                onPress={() => setViewedExpanded(!viewedExpanded)}
                style={styles.viewedHeaderRow}
              >
                <Text style={[styles.sectionHeader, { flex: 1, color: colors.textSecondary }]}>
                  Viewed updates
                </Text>
                <Ionicons
                  name={viewedExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textSecondary}
                  style={styles.headerChevron}
                />
              </Pressable>
            )}
            {grouped.viewed.length > 0 && viewedExpanded && (
              <View style={{ backgroundColor: colors.background }}>
                {grouped.viewed.map(({ authorId, list }) => renderRow(authorId, list, false))}
              </View>
            )}

            {loading && statuses == null && (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.brand} />
              </View>
            )}
            {error && statuses == null && (
              <View style={styles.center}>
                <Text style={[styles.errorText, { color: colors.text }]}>Couldn&apos;t load statuses</Text>
                <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>{error}</Text>
              </View>
            )}
          </View>
        }
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
      />

      {/* WhatsApp Floating Action Buttons */}
      <View style={styles.fabContainer}>
        <Pressable
          style={[styles.fabSecondary, { backgroundColor: dark ? '#202C33' : '#F0F2F5' }]}
          onPress={() => router.push({ pathname: '/status/create', params: { mode: 'text' } })}
        >
          <Ionicons name="pencil" size={20} color={colors.text} />
        </Pressable>
        <Pressable
          style={[styles.fabPrimary, { backgroundColor: colors.brand }]}
          onPress={() => router.push({ pathname: '/status/create', params: { mode: 'media' } })}
        >
          <Ionicons name="camera" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  listContent: { paddingBottom: 100 },
  section: {},
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
  },
  viewedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerChevron: {
    marginRight: 16,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ring: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  time: { fontSize: 13, marginTop: 2 },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  privacyText: { flex: 1, marginLeft: 12, fontSize: 15 },
  center: { alignItems: 'center', padding: 32 },
  errorText: { fontSize: 16, fontWeight: '600' },
  errorDetail: { fontSize: 13, marginTop: 4 },
  fabContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    alignItems: 'center',
    gap: 12,
  },
  fabPrimary: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  fabSecondary: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
  },
});