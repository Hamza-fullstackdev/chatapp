import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWaTheme } from '@/context/theme-context';
import { useAuth } from '@/context/auth-context';
import { conversationsApi, usersApi } from '@/lib/api';
import { Avatar } from '@/components/avatar';
import type { UserDTO } from '@/types/api';

export default function NewGroupScreen() {
  const { colors } = useWaTheme();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<UserDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const selected = new Set(members.map((m) => m.id));

  useEffect(() => {
    let active = true;
    usersApi
      .list()
      .then(({ users }) => {
        if (active) setMembers(users.filter((u) => u.id !== user?.id));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (member: UserDTO) => {
    setMembers((prev) => {
      const has = prev.some((m) => m.id === member.id);
      return has ? prev.filter((m) => m.id !== member.id) : [...prev, member];
    });
  };

  const create = async () => {
    const cleaned = name.trim();
    if (!cleaned) {
      Alert.alert('Group name required', 'Give your group a name.');
      return;
    }
    if (selected.size < 1) {
      Alert.alert('Add members', 'Select at least one member.');
      return;
    }
    setBusy(true);
    try {
      const { conversation } = await conversationsApi.createGroup(
        cleaned,
        Array.from(selected),
      );
      router.replace({ pathname: '/chat/[id]', params: { id: conversation.id } });
    } catch (e) {
      Alert.alert('Could not create group', e instanceof Error ? e.message : 'Try again');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.brandDark }]}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>New group</Text>
        <Pressable hitSlop={10} onPress={() => void create()} disabled={busy} style={styles.headerBtn}>
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="checkmark" size={24} color="#FFFFFF" />
          )}
        </Pressable>
      </View>

      <View style={[styles.nameWrap, { backgroundColor: colors.background }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Group name"
          placeholderTextColor={colors.textSecondary}
          style={[styles.nameInput, { color: colors.text }]}
        />
      </View>

      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        {selected.size > 0 ? `Group will have ${selected.size + 1} members` : 'Select members'}
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            return (
              <Pressable
                onPress={() => toggle(item)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? colors.divider : colors.background },
                ]}
              >
                <Avatar name={item.name} uri={item.avatarUrl} size={44} />
                <View style={styles.info}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
                    @{item.username}
                  </Text>
                </View>
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={isSelected ? colors.brand : colors.outline}
                />
              </Pressable>
            );
          }}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 4,
  },
  nameWrap: { paddingHorizontal: 14, paddingTop: 14 },
  nameInput: {
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#00A884',
    paddingVertical: 8,
  },
  hint: { fontSize: 13, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  info: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  username: { fontSize: 13, marginTop: 1 },
});