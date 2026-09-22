import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Avatar } from '@/components/avatar';
import { useAuth } from '@/context/auth-context';
import { useWaTheme } from '@/context/theme-context';
import { statusesApi } from '@/lib/api';
import { getSignedUrl } from '@/lib/media';
import { getDb } from '@/db/database';
import {
  listStatuses,
  setStatusViewedLocal,
  deleteStatusLocal,
  listUserProfiles,
  type StoredProfile,
} from '@/db/repositories';
import { formatStatusTime } from '@/lib/format';
import { notifyLocalDb } from '@/lib/local-db-events';
import { buildStatusQueue } from '@/hooks/use-status';
import type { StatusDTO } from '@/types/api';

const AUTO_ADVANCE_MS = 5000;

export default function StatusViewerScreen() {
  const { colors } = useWaTheme();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string; mine?: string }>();
  const currentId = params.id ?? '';

  const [statuses, setStatuses] = useState<StatusDTO[]>([]);
  const [current, setCurrent] = useState<StatusDTO | null>(null);
  const [paused, setPaused] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [profiles, setProfiles] = useState<Map<string, StoredProfile>>(new Map());

  const refresh = async () => {
    const db = await getDb();
    const all = await listStatuses(db);
    if (params.mine === '1') {
      const mine = all.filter((s) => s.userId === user?.id);
      setStatuses(mine.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
    } else {
      const startingStatus = all.find((s) => s.id === currentId);
      const queue = buildStatusQueue(all, startingStatus?.userId);
      setStatuses(queue);
    }
  };

  useFocusEffect(() => {
    void refresh();
  });

  useEffect(() => {
    const idx = statuses.findIndex((s) => s.id === currentId);
    if (idx === -1) {
      setCurrent(statuses[0] ?? null);
    } else {
      setCurrent(statuses[idx]!);
    }
  }, [statuses, currentId]);

  useEffect(() => {
    let active = true;
    (async () => {
      const db = await getDb();
      const ids = Array.from(new Set(statuses.map((s) => s.userId)));
      const cached = await listUserProfiles(db, ids);
      if (!active) return;
      setProfiles(cached);
    })();
    return () => {
      active = false;
    };
  }, [statuses]);

  const isMine = current?.userId === user?.id;

  // Mark viewed (others' statuses) the first time a status is shown.
  useEffect(() => {
    if (!current || isMine) return;
    void (async () => {
      const db = await getDb();
      await setStatusViewedLocal(db, current.id);
      notifyLocalDb();
      try {
        await statusesApi.markViewed(current.id);
      } catch {
        // Best-effort; the cache is already updated and will reconcile on pull.
      }
    })();
  }, [current, isMine]);

  // Resolve signed media URL for image/video statuses.
  useEffect(() => {
    let active = true;
    if (!current || current.type === 'text') {
      setUrl(null);
      return;
    }
    void (async () => {
      const signed = await getSignedUrl(current.mediaPath ?? current.mediaThumbnailPath);
      if (!active) return;
      setUrl(signed);
    })();
    return () => {
      active = false;
    };
  }, [current]);

  const advance = (step: number) => {
    if (statuses.length === 0) return;
    const idx = statuses.findIndex((s) => s.id === current?.id);
    const next = idx + step;
    if (next < 0 || next >= statuses.length) {
      router.back();
      return;
    }
    // Update local URL search params to synchronize route and state
    router.setParams({ id: statuses[next]!.id });
    setCurrent(statuses[next]!);
  };

  // Reset progress when active status changes
  useEffect(() => {
    setProgress(0);
  }, [current?.id]);

  // Smooth, pausible auto-advance interval
  useEffect(() => {
    if (paused || !current) return;
    const intervalTime = 50;
    const step = (intervalTime / AUTO_ADVANCE_MS) * 100;

    const timer = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(timer);
          advance(1);
          return 100;
        }
        return p + step;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [current, paused, statuses]);

  const remove = async () => {
    if (!current) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert('Delete status?', 'This status will be removed for everyone who can see it.', [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
    if (!confirmed) return;
    try {
      await statusesApi.remove(current.id);
      const db = await getDb();
      await deleteStatusLocal(db, current.id);
      notifyLocalDb();
      advance(1);
    } catch (e) {
      Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again');
    }
  };

  if (!current) {
    return (
      <View style={[styles.safe, { backgroundColor: '#000000' }]}>
        <ActivityIndicator size="large" color={colors.brand} style={{ marginTop: 'auto', marginBottom: 'auto' }} />
      </View>
    );
  }

  const profile = profiles.get(current.userId);
  const authorName = isMine ? 'My status' : (profile?.fullName ?? `@${current.userId.slice(0, 8)}…`);
  const authorAvatar = isMine ? user?.avatarUrl : profile?.avatarUrl;

  return (
    <View style={[styles.safe, { backgroundColor: '#000000' }]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPressIn={() => setPaused(true)}
        onPressOut={() => setPaused(false)}
      />

      {/* Progress bars */}
      <View style={styles.progressRow}>
        {statuses.map((s, i) => {
          const currentIdx = statuses.findIndex((x) => x.id === current.id);
          const width = i < currentIdx ? '100%' : i === currentIdx ? `${progress}%` : '0%';
          return (
            <View key={s.id} style={[styles.progressTrack, { backgroundColor: 'rgba(255,255,255,0.35)' }]}>
              <View style={[styles.progressActive, { width }]} />
            </View>
          );
        })}
      </View>

      <SafeAreaView edges={['top', 'bottom']} style={styles.safeContainer}>
        <View style={styles.header}>
          <Avatar name={authorName} uri={authorAvatar} size={36} />
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text style={styles.authorName} numberOfLines={1}>
              {authorName}
            </Text>
            <Text style={styles.authorTime}>{formatStatusTime(current.createdAt)}</Text>
          </View>
          {isMine && (
            <Pressable
              hitSlop={8}
              onPress={() => router.push({ pathname: '/status/viewers', params: { id: current.id } })}
              style={styles.headerBtn}
            >
              <Ionicons name="eye-outline" size={22} color="#FFFFFF" />
            </Pressable>
          )}
          <Pressable hitSlop={8} onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
        </View>

        <Pressable style={styles.content}>
          {current.type === 'text' ? (
            <View style={[styles.textWrap, { backgroundColor: current.bgColor ?? '#00A884' }]}>
              <Text style={[styles.textStatus, fontStyle(current.font)]}>{current.text}</Text>
            </View>
          ) : url ? (
            current.type === 'video' ? (
              <VideoStatus url={url} paused={paused} />
            ) : (
              <Image source={{ uri: url }} style={styles.mediaFill} contentFit="contain" />
            )
          ) : (
            <ActivityIndicator size="large" color="#FFFFFF" />
          )}
        </Pressable>

        <View style={styles.footer}>
          {isMine ? (
            <Pressable onPress={() => void remove()} style={[styles.footerBtn, { borderColor: 'rgba(255,255,255,0.4)' }]}>
              <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
              <Text style={styles.footerLabel}>Delete</Text>
            </Pressable>
          ) : (
            <View style={[styles.footerBtn, { borderColor: 'rgba(255,255,255,0.25)' }]}>
              <Ionicons name="lock-closed-outline" size={14} color="rgba(255,255,255,0.7)" />
              <Text style={[styles.footerLabel, { color: 'rgba(255,255,255,0.8)' }]}>
                {current.viewCount} view{current.viewCount === 1 ? '' : 's'}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>

      {/* Previous / next tap zones */}
      <Pressable
        style={styles.prevZone}
        onPressIn={() => setPaused(true)}
        onPressOut={() => setPaused(false)}
        onPress={() => advance(-1)}
      />
      <Pressable
        style={styles.nextZone}
        onPressIn={() => setPaused(true)}
        onPressOut={() => setPaused(false)}
        onPress={() => advance(1)}
      />
    </View>
  );
}

function VideoStatus({ url, paused }: { url: string; paused: boolean }) {
  const player = useVideoPlayer({ uri: url }, (p) => {
    p.loop = false;
    if (!paused) {
      void p.play();
    }
  });

  useEffect(() => {
    if (paused) {
      player.pause();
    } else {
      player.play();
    }
  }, [paused, player]);

  useEffect(() => {
    if (!url) return;
    player.replaceAsync(url).catch(() => undefined);
  }, [url, player]);

  return (
    <VideoView
      player={player}
      style={styles.mediaFill}
      contentFit="contain"
      nativeControls={false}
      surfaceType={Platform.OS === 'android' ? 'textureView' : undefined}
    />
  );
}

function fontStyle(font: string | null): { fontFamily?: string; fontWeight?: '400' | '500' } {
  switch (font) {
    case 'Serif':
      return { fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }) };
    case 'Monospace':
      return { fontFamily: Platform.select({ ios: 'Courier', android: 'monospace' }) };
    default:
      return { fontWeight: '500' };
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  safeContainer: { flex: 1 },
  progressRow: {
    flexDirection: 'row',
    gap: 3,
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    zIndex: 5,
  },
  progressTrack: { flex: 1, height: 2.5, borderRadius: 2, overflow: 'hidden' },
  progressActive: { height: '100%', backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 24,
    zIndex: 4,
  },
  headerBtn: { padding: 10 },
  authorName: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  authorTime: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 1 },
  content: { flex: 1 },
  textWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  textStatus: { color: '#FFFFFF', fontSize: 30, textAlign: 'center', lineHeight: 40 },
  mediaFill: { flex: 1, width: '100%' },
  footer: { alignItems: 'center', paddingBottom: 16, zIndex: 4 },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  footerLabel: { color: '#FFFFFF', fontSize: 13 },
  prevZone: { position: 'absolute', left: 0, top: 0, width: '30%', height: '100%', zIndex: 6 },
  nextZone: { position: 'absolute', right: 0, top: 0, width: '30%', height: '100%', zIndex: 6 },
});