import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWaTheme } from '@/context/theme-context';
import { useAuth } from '@/context/auth-context';
import { conversationsApi, groupsApi, usersApi } from '@/lib/api';
import { cacheDetail, cacheDirectoryUsers } from '@/lib/pull-sync';
import { getDb } from '@/db/database';
import {
  getCachedDetail,
  getStoredGroupDetail,
  listAllUserProfiles,
  updateConversationInfo,
} from '@/db/repositories';
import { Avatar } from '@/components/avatar';
import { pickAvatarImage, uploadAvatar } from '@/lib/media';
import type { ConversationDetailDTO, GroupDetailDTO, UserDTO } from '@/types/api';

export default function GroupInfoScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const groupId = String(params.id ?? '');
  const { user } = useAuth();
  const { colors } = useWaTheme();

  const [detail, setDetail] = useState<ConversationDetailDTO | null>(null);
  const [group, setGroup] = useState<GroupDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [candidates, setCandidates] = useState<UserDTO[]>([]);
  const [editName, setEditName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editDesc, setEditDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);

  const myId = user?.id ?? '';
  const amAdmin = group?.myRole === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [conv, grp] = await Promise.all([
        conversationsApi.detail(groupId),
        groupsApi.detail(groupId),
      ]);
      setDetail(conv);
      setGroup(grp);
      setNameDraft(grp.name ?? '');
      // Persist members + identities so group info renders offline later.
      const db = await getDb();
      await cacheDetail(conv);
      await updateConversationInfo(db, groupId, { name: grp.name, avatarUrl: grp.avatarUrl });
    } catch {
      // Offline-first fallback: render from the local store.
      const db = await getDb();
      const cachedConv = await getCachedDetail(db, groupId);
      const cachedGroup = await getStoredGroupDetail(db, groupId);
      if (cachedConv) {
        setDetail(cachedConv);
        setNameDraft(cachedConv.conversation.name ?? groupId);
      }
      if (cachedGroup) setGroup(cachedGroup);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openAddMembers = async () => {
    setAddOpen(true);
    const existing = new Set(detail?.members.map((m) => m.id) ?? []);
    try {
      const { users } = await usersApi.list();
      await cacheDirectoryUsers(users);
      setCandidates(users.filter((u) => !existing.has(u.id)));
    } catch {
      const db = await getDb();
      const cached = await listAllUserProfiles(db);
      setCandidates(
        cached
          .map((u) => ({ ...u, createdAt: '' }))
          .filter((u) => !existing.has(u.id)),
      );
    }
  };

  const addMembers = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      await groupsApi.addMembers(groupId, ids);
      await load();
    } catch (e) {
      Alert.alert('Could not add members', e instanceof Error ? e.message : 'Try again');
    }
  };

  const removeMember = (userId: string, name: string) => {
    Alert.alert('Remove member', `Remove ${name} from this group?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void groupsApi
            .removeMember(groupId, userId)
            .then(load)
            .catch((e) => Alert.alert('Failed', e instanceof Error ? e.message : 'Try again')),
      },
    ]);
  };

  const setRole = async (userId: string, role: 'admin' | 'member', name: string) => {
    try {
      if (role === 'admin') await groupsApi.promote(groupId, userId);
      else await groupsApi.demote(groupId, userId);
      await load();
    } catch (e) {
      Alert.alert('Action failed', e instanceof Error ? e.message : `Could not update ${name}`);
    }
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next) return;
    setEditName(false);
    try {
      await groupsApi.update(groupId, { name: next });
      await load();
    } catch (e) {
      Alert.alert('Could not rename', e instanceof Error ? e.message : 'Try again');
    }
  };

  const pickAndUploadAvatar = async () => {
    if (avatarBusy) return;
    const source = await pickAvatarImage();
    if (!source) return;
    setAvatarBusy(true);
    try {
      const avatarUrl = await uploadAvatar(source);
      await groupsApi.update(groupId, { avatarUrl });
      await load();
    } catch (e) {
      Alert.alert('Could not update photo', e instanceof Error ? e.message : 'Try again');
    } finally {
      setAvatarBusy(false);
    }
  };

  const clearAvatar = async () => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    try {
      await groupsApi.update(groupId, { avatarUrl: null });
      await load();
    } catch (e) {
      Alert.alert('Could not remove photo', e instanceof Error ? e.message : 'Try again');
    } finally {
      setAvatarBusy(false);
    }
  };

  const changeAvatar = () => {
    if (avatarBusy) return;
    if (group?.avatarUrl) {
      Alert.alert('Group photo', 'Update the photo shown to group members.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove photo', style: 'destructive', onPress: () => void clearAvatar() },
        { text: 'Change photo', onPress: () => void pickAndUploadAvatar() },
      ]);
    } else {
      void pickAndUploadAvatar();
    }
  };

  const saveDescription = async () => {
    setEditDesc(false);
    const next = descDraft.trim();
    try {
      await groupsApi.update(groupId, { description: next || null });
      await load();
    } catch (e) {
      Alert.alert('Could not update description', e instanceof Error ? e.message : 'Try again');
    }
  };

  const leaveGroup = () => {
    Alert.alert('Exit group', 'You will stop receiving messages from this group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Exit',
        style: 'destructive',
        onPress: () =>
          void groupsApi
            .removeMember(groupId, myId)
            .then(() => router.replace('/'))
            .catch((e) => Alert.alert('Could not exit group', e instanceof Error ? e.message : 'Try again')),
      },
    ]);
  };

  if (loading && !detail) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  const members = detail?.members ?? [];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.brandDark }]}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Group info</Text>
        {amAdmin && !editName && (
          <Pressable hitSlop={10} style={styles.headerBtn} onPress={() => openAddMembers()}>
            <Ionicons name="person-add" size={22} color="#FFFFFF" />
          </Pressable>
        )}
      </View>

      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={[styles.avatarWrap, { backgroundColor: colors.backgroundSecondary }]}>
              <Pressable onPress={changeAvatar} disabled={!amAdmin || avatarBusy} hitSlop={8} style={styles.avatarBtn}>
                <Avatar name={group?.name ?? 'Group'} uri={group?.avatarUrl} size={92} />
                {amAdmin && (
                  <View style={[styles.avatarBadge, { backgroundColor: colors.brand }]}>
                    {avatarBusy ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons name="camera" size={18} color="#FFFFFF" />
                    )}
                  </View>
                )}
              </Pressable>
              <View style={styles.nameBlock}>
                {editName && amAdmin ? (
                  <View style={styles.editRow}>
                    <TextInput
                      value={nameDraft}
                      onChangeText={setNameDraft}
                      autoFocus
                      style={[styles.nameInput, { color: colors.text }]}
                    />
                    <Pressable hitSlop={8} onPress={() => void saveName()}>
                      <Ionicons name="checkmark" size={22} color={colors.brand} />
                    </Pressable>
                  </View>
                ) : (
                  <Text style={[styles.groupName, { color: colors.text }]} numberOfLines={2}>
                    {group?.name ?? 'Group'}
                  </Text>
                )}
                {amAdmin && !editName && (
                  <Pressable hitSlop={8} onPress={() => setEditName(true)} style={styles.editHint}>
                    <Ionicons name="create-outline" size={16} color={colors.brand} />
                    <Text style={{ color: colors.brand, fontSize: 13 }}>Rename group</Text>
                  </Pressable>
                )}
                {editDesc && amAdmin ? (
                  <View style={styles.descEditRow}>
                    <TextInput
                      value={descDraft}
                      onChangeText={setDescDraft}
                      multiline
                      placeholder="Add a group description"
                      placeholderTextColor={colors.textSecondary}
                      autoFocus
                      style={[styles.descInput, { color: colors.text, backgroundColor: colors.divider }]}
                    />
                    <View style={styles.descEditActions}>
                      <Pressable hitSlop={8} onPress={() => setEditDesc(false)}>
                        <Ionicons name="close" size={20} color={colors.textSecondary} />
                      </Pressable>
                      <Pressable hitSlop={8} onPress={() => void saveDescription()}>
                        <Ionicons name="checkmark" size={22} color={colors.brand} />
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <>
                    {group?.description ? (
                      <Text style={[styles.description, { color: colors.textSecondary }]}>
                        {group.description}
                      </Text>
                    ) : null}
                    {amAdmin && (
                      <Pressable
                        hitSlop={8}
                        onPress={() => {
                          setDescDraft(group?.description ?? '');
                          setEditDesc(true);
                        }}
                        style={styles.editHint}
                      >
                        <Ionicons name="document-text-outline" size={16} color={colors.brand} />
                        <Text style={{ color: colors.brand, fontSize: 13 }}>
                          {group?.description ? 'Edit description' : 'Add description'}
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {members.length} members
              </Text>
            </View>
          </>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              onPress={leaveGroup}
              style={({ pressed }) => [
                styles.exitBtn,
                { backgroundColor: pressed ? colors.divider : colors.backgroundSecondary },
              ]}
            >
              <Ionicons name="exit-outline" size={20} color="#E5423D" />
              <Text style={styles.exitBtnText}>Exit group</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => {
          const isAdmin = item.role === 'admin';
          const isSelf = item.id === myId;
          const canManage = amAdmin && !isSelf;
          return (
            <View style={[styles.memberRow, { backgroundColor: colors.background }]}>
              <Avatar name={item.name} uri={item.avatarUrl} size={46} />
              <View style={styles.memberInfo}>
                <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                  {item.name} {isSelf ? ' (you)' : ''}
                </Text>
                {isAdmin && <Text style={[styles.adminTag, { color: colors.brand }]}>Admin</Text>}
              </View>
              {canManage && (
                <View style={styles.memberActions}>
                  <Pressable
                    hitSlop={8}
                    style={styles.memberActionBtn}
                    onPress={() => void setRole(item.id, isAdmin ? 'member' : 'admin', item.name)}
                  >
                    <Ionicons name={isAdmin ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'} size={22} color={colors.brand} />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    style={styles.memberActionBtn}
                    onPress={() => removeMember(item.id, item.name)}
                  >
                    <Ionicons name="remove-circle-outline" size={22} color="#E5423D" />
                  </Pressable>
                </View>
              )}
            </View>
          );
        }}
      />

      <Modal transparent visible={addOpen} animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={[styles.addSheet, { backgroundColor: colors.incomingBubble }]}>
          <View style={styles.addHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Add members</Text>
            <Pressable hitSlop={8} onPress={() => setAddOpen(false)}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <FlatList
            data={candidates}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => void addMembers([item.id]).then(() => setAddOpen(false))}
                style={({ pressed }) => [styles.memberRow, pressed && { opacity: 0.6 }]}
              >
                <Avatar name={item.fullName} uri={item.avatarUrl} size={44} />
                <View style={styles.memberInfo}>
                  <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                    {item.fullName}
                  </Text>
                  <Text style={[styles.username, { color: colors.textSecondary }]}>@{item.username}</Text>
                </View>
                <Ionicons name="add-circle-outline" size={24} color={colors.brand} />
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={{ color: colors.textSecondary }}>No more users to add</Text>
              </View>
            }
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  headerBtn: { padding: 8 },
  headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '600', marginLeft: 4 },
  listContent: { paddingBottom: 24 },
  avatarWrap: {
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 20,
  },
  avatarBtn: { position: 'relative' },
  avatarBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  nameBlock: { alignItems: 'center', marginTop: 10, maxWidth: '90%' },
  groupName: { fontSize: 19, fontWeight: '700', textAlign: 'center' },
  nameInput: { fontSize: 18, fontWeight: '600', textAlign: 'center', minWidth: 120 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  description: { fontSize: 13, textAlign: 'center', marginTop: 8 },
  descEditRow: { width: '100%', alignItems: 'center', marginTop: 8 },
  descInput: {
    width: '100%',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  descEditActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  sectionHeader: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  memberInfo: { flex: 1, marginLeft: 12 },
  memberName: { fontSize: 15, fontWeight: '500' },
  adminTag: { fontSize: 12, marginTop: 1 },
  username: { fontSize: 13, marginTop: 1 },
  memberActions: { flexDirection: 'row', gap: 6 },
  memberActionBtn: { padding: 6 },
  footer: { paddingHorizontal: 16, paddingTop: 24 },
  exitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  exitBtnText: { color: '#E5423D', fontSize: 16, fontWeight: '600' },
  addSheet: {
    flex: 1,
    marginTop: '35%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
  },
  addHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
});