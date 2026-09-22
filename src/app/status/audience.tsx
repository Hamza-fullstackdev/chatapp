import { useState } from 'react';
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
import { useAuth } from '@/context/auth-context';
import { useWaTheme } from '@/context/theme-context';
import { useContacts } from '@/hooks/use-data';
import { setStatusAudience } from '@/lib/status-audience';
import type { StatusAudience, UserDTO } from '@/types/api';

export default function AudienceScreen() {
  const { colors } = useWaTheme();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    audience?: string;
    exclude?: string;
    include?: string;
  }>();

  const parseIds = (raw?: string): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };

  const [audience, setAudience] = useState<StatusAudience>(
    (params.audience as StatusAudience) || 'my_contacts',
  );
  const [exclude, setExclude] = useState<string[]>(parseIds(params.exclude));
  const [include, setInclude] = useState<string[]>(parseIds(params.include));
  const { data: contacts, loading } = useContacts('', true);

  const list = ((contacts ?? []).filter((c) => c.id !== user?.id) as UserDTO[]) ?? [];

  const toggle = (id: string) => {
    if (audience === 'my_contacts_except') {
      setExclude((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else if (audience === 'only_share_with') {
      setInclude((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }
  };

  const selected = (id: string) =>
    audience === 'my_contacts_except'
      ? exclude.includes(id)
      : audience === 'only_share_with'
        ? include.includes(id)
        : false;

  const save = () => {
    setStatusAudience({
      audience,
      excludeUserIds: audience === 'my_contacts_except' ? exclude : [],
      includeUserIds: audience === 'only_share_with' ? include : [],
    });
    router.back();
  };

  return (
    <View style={[styles.safe, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.brandDark }]}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Audience</Text>
        <Pressable hitSlop={10} onPress={save} style={styles.headerBtn}>
          <Text style={styles.doneLabel}>DONE</Text>
        </Pressable>
      </View>

      <View style={styles.intro}>
        <Text style={[styles.introText, { color: colors.textSecondary }]}>
          Choose who can see your status updates. Excluded and shared-with lists apply to your
          contacts.
        </Text>
      </View>

      <View style={styles.options}>
        <Option
          label="My contacts"
          detail="Everyone you share chats with"
          active={audience === 'my_contacts'}
          onPress={() => setAudience('my_contacts')}
        />
        <Option
          label="My contacts except…"
          detail="Hide from specific contacts"
          active={audience === 'my_contacts_except'}
          onPress={() => setAudience('my_contacts_except')}
        />
        <Option
          label="Only share with…"
          detail="Show only to specific contacts"
          active={audience === 'only_share_with'}
          onPress={() => setAudience('only_share_with')}
        />
      </View>

      {audience !== 'my_contacts' && (
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
          {audience === 'my_contacts_except' ? 'Exclude contacts' : 'Share with'}
        </Text>
      )}

      {audience !== 'my_contacts' ? (
        loading && contacts == null ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.brand} />
          </View>
        ) : (
          <FlatList
            data={list}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => toggle(item.id)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? colors.divider : colors.background },
                ]}
              >
                <Avatar name={item.fullName} uri={item.avatarUrl} size={44} />
                <View style={styles.info}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {item.fullName}
                  </Text>
                  <Text style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
                    @{item.username}
                  </Text>
                </View>
                <Ionicons
                  name={selected(item.id) ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={selected(item.id) ? colors.brand : colors.outline}
                />
              </Pressable>
            )}
            contentContainerStyle={styles.list}
          />
        )
      ) : (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={40} color={colors.outline} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Every contact can see your status.
          </Text>
        </View>
      )}
    </View>
  );
}

function Option({
  label,
  detail,
  active,
  onPress,
}: {
  label: string;
  detail: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useWaTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        { backgroundColor: pressed ? colors.divider : colors.background },
      ]}
    >
      <View style={styles.optionText}>
        <Text style={[styles.optionLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.optionDetail, { color: colors.textSecondary }]}>{detail}</Text>
      </View>
      <Ionicons
        name={active ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={active ? colors.brand : colors.outline}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  headerBtn: { padding: 8 },
  headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '600', marginLeft: 4 },
  doneLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  intro: { paddingHorizontal: 16, paddingTop: 12 },
  introText: { fontSize: 14, lineHeight: 20 },
  options: { marginTop: 8, backgroundColor: 'transparent' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  optionText: { flex: 1, marginRight: 12 },
  optionLabel: { fontSize: 16, fontWeight: '600' },
  optionDetail: { fontSize: 13, marginTop: 2 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
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
  center: { alignItems: 'center', padding: 32 },
  emptyText: { fontSize: 14, marginTop: 8 },
});