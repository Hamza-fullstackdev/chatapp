import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/auth-context';
import { useWaTheme } from '@/context/theme-context';
import { Avatar } from '@/components/avatar';
import { formatLastSeen } from '@/lib/format';
import { authApi } from '@/lib/api';
import { pickAvatarImage, uploadAvatar, type LocalUploadSource } from '@/lib/media';
import { clearMediaCache, getMediaCacheStats } from '@/lib/media-cache';
import { useLocalDb } from '@/lib/local-db-events';
import { purgeDatabase } from '@/db/database';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function SettingsScreen() {
  const { user, signOut, updateUser } = useAuth();
  const { colors } = useWaTheme();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarDraft, setAvatarDraft] = useState<LocalUploadSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [mediaStats, setMediaStats] = useState<{ entries: number; bytes: number }>({ entries: 0, bytes: 0 });

  const reloadMediaStats = async () => {
    setMediaStats(await getMediaCacheStats().catch(() => ({ entries: 0, bytes: 0 })));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadMediaStats();
  }, []);

  useLocalDb(() => {
    void reloadMediaStats();
  });

  const confirmClearMedia = () => {
    Alert.alert('Clear downloaded media', 'Delete media saved on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () =>
          void clearMediaCache()
            .then(() => void reloadMediaStats())
            .catch(() => undefined),
      },
    ]);
  };

  if (!user) return null;

  const openEditor = () => {
    setName(user.name);
    setBio(user.bio ?? '');
    setAvatarDraft(null);
    setEditing(true);
  };

  const pickAvatar = async () => {
    const source = await pickAvatarImage();
    if (source) setAvatarDraft(source);
  };

  const saveProfile = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      let avatarUrl: string | undefined;
      if (avatarDraft) {
        avatarUrl = await uploadAvatar(avatarDraft);
      }
      const updated = await authApi.updateMe({
        name: name.trim(),
        bio: bio.trim() || null,
        avatarUrl,
      });
      updateUser(updated);
      setEditing(false);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteText.trim().toUpperCase() !== 'DELETE' || deleting) return;
    setDeleting(true);
    try {
      await authApi.deleteAccount();
    } catch (e) {
      setDeleting(false);
      setConfirmingDelete(false);
      setDeleteText('');
      Alert.alert('Delete failed', e instanceof Error ? e.message : 'Could not delete your account');
      return;
    }
    // Sign out first (disconnects the old user's socket, so nothing can write
    // into the DB mid-wipe), then delete downloaded media files plus every
    // SQLite table (chats, conversations, messages, attachments, contacts,
    // call history, pending sync queue, profiles, cached media).
    await signOut();
    await clearMediaCache().catch(() => undefined);
    await purgeDatabase().catch(() => undefined);
  };

  return (
    <View style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.profile, { backgroundColor: colors.brandDark }]}>
        <Avatar name={user.name} uri={user.avatarUrl} size={84} />
        <Text style={styles.name}>{user.name}</Text>
        <Text style={styles.username}>@{user.username}</Text>
        <Text style={styles.status}>{user.bio ?? 'Hey there! I am using chat-app.'}</Text>
        <Text style={styles.subStatus}>{formatLastSeen(user.lastSeenAt)}</Text>
      </View>

      <Pressable
        onPress={openEditor}
        style={({ pressed }) => [styles.editBtn, { backgroundColor: pressed ? colors.divider : colors.backgroundSecondary }]}
      >
        <Ionicons name="create-outline" size={20} color={colors.brand} />
        <Text style={[styles.editBtnText, { color: colors.brand }]}>Edit profile</Text>
      </Pressable>

      <View style={styles.section}>
        <View style={[styles.item, { backgroundColor: colors.backgroundSecondary }]}>
          <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.itemLabel, { color: colors.text }]}>Email</Text>
          <Text style={[styles.itemValue, { color: colors.textSecondary }]} numberOfLines={1}>
            {user.email ?? 'Not set'}
          </Text>
        </View>
        <View style={[styles.item, { backgroundColor: colors.backgroundSecondary }]}>
          <Ionicons name="call-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.itemLabel, { color: colors.text }]}>Phone</Text>
          <Text style={[styles.itemValue, { color: colors.textSecondary }]} numberOfLines={1}>
            {user.phone ?? 'Not set'}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={() => signOut()}
        style={({ pressed }) => [
          styles.logout,
          { backgroundColor: pressed ? colors.divider : colors.backgroundSecondary },
        ]}
      >
        <Ionicons name="log-out-outline" size={20} color="#E5423D" />
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>

      <View style={styles.storageWrap}>
        <View style={[styles.item, { backgroundColor: colors.backgroundSecondary }]}>
          <Ionicons name="download-outline" size={20} color={colors.brand} />
          <Text style={[styles.itemLabel, { color: colors.text }]}>Media</Text>
          <Text style={[styles.itemValue, { color: colors.textSecondary }]} numberOfLines={1}>
            {mediaStats.entries > 0
              ? `${formatBytes(mediaStats.bytes)} · ${mediaStats.entries} item${mediaStats.entries === 1 ? '' : 's'}`
              : 'Nothing saved yet'}
          </Text>
        </View>
        <Pressable
          onPress={confirmClearMedia}
          disabled={mediaStats.entries === 0}
          style={({ pressed }) => [
            styles.clearMedia,
            { backgroundColor: pressed ? colors.divider : colors.backgroundSecondary },
            mediaStats.entries === 0 && styles.buttonBusy,
          ]}
        >
          <Ionicons name="trash-outline" size={20} color="#E5423D" />
          <Text style={styles.logoutText}>Clear downloaded media</Text>
        </Pressable>
        <Text style={[styles.deleteHint, { color: colors.textSecondary }]}>
          Media you received is cached for offline viewing with your activity feed and chats.
        </Text>
      </View>

      <Pressable
        onPress={() => {
          setDeleteText('');
          setConfirmingDelete(true);
        }}
        style={({ pressed }) => [
          styles.deleteAccount,
          { backgroundColor: pressed ? colors.divider : colors.backgroundSecondary },
        ]}
      >
        <Ionicons name="trash-outline" size={20} color="#E5423D" />
        <Text style={styles.logoutText}>Delete account</Text>
      </Pressable>
      <Text style={[styles.deleteHint, { color: colors.textSecondary }]}>
        Permanently deletes your account, profile, chats, calls, media and everything saved on this device.
      </Text>
      </ScrollView>

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit profile</Text>
            <Pressable onPress={pickAvatar} style={styles.avatarPicker}>
              <Avatar name={user.name} uri={avatarDraft?.uri ?? user.avatarUrl} size={84} />
              <View style={[styles.avatarBadge, { backgroundColor: colors.brand }]}>
                <Ionicons name="camera" size={16} color="#FFFFFF" />
              </View>
            </Pressable>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={colors.textSecondary}
              style={[styles.modalInput, { color: colors.text, backgroundColor: colors.divider }]}
            />
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Bio"
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[styles.modalInput, styles.modalBio, { color: colors.text, backgroundColor: colors.divider }]}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setEditing(false)}
                style={({ pressed }) => [styles.modalBtn, { backgroundColor: pressed ? colors.divider : colors.incomingBubble }]}
              >
                <Text style={{ color: colors.text }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveProfile}
                disabled={saving}
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: pressed ? '#00806b' : colors.brand },
                  saving && styles.buttonBusy,
                ]}
              >
                <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={confirmingDelete}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deleting) setConfirmingDelete(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Delete account?</Text>
            <Text style={[styles.deleteBody, { color: colors.textSecondary }]}>
              This permanently deletes your account, profile, chats, conversations, messages, call
              history, media and everything saved on this device. This cannot be undone. Type DELETE
              to confirm.
            </Text>
            <TextInput
              value={deleteText}
              onChangeText={setDeleteText}
              editable={!deleting}
              placeholder="DELETE"
              autoCapitalize="characters"
              placeholderTextColor={colors.textSecondary}
              style={[styles.modalInput, { color: colors.text, backgroundColor: colors.divider }]}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setConfirmingDelete(false)}
                disabled={deleting}
                style={({ pressed }) => [styles.modalBtn, { backgroundColor: pressed ? colors.divider : colors.incomingBubble }]}
              >
                <Text style={{ color: colors.text }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={deleteAccount}
                disabled={deleteText.trim().toUpperCase() !== 'DELETE' || deleting}
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: pressed ? '#D32F2F' : '#E5423D' },
                  (deleteText.trim().toUpperCase() !== 'DELETE' || deleting) && styles.buttonBusy,
                ]}
              >
                <Text style={styles.deleteAction}>{deleting ? 'Deleting…' : 'Delete'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  profile: {
    alignItems: 'center',
    paddingVertical: 28,
    borderRadius: 16,
    marginBottom: 16,
  },
  name: {
    marginTop: 12,
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  username: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    marginTop: 2,
  },
  status: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  subStatus: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 4,
  },
  section: {
    gap: 10,
    marginBottom: 16,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  itemLabel: {
    fontSize: 15,
    fontWeight: '600',
    width: 60,
  },
  itemValue: {
    flex: 1,
    fontSize: 14,
    textAlign: 'right',
  },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
    marginTop: 4,
  },
  deleteAccount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
    marginTop: 10,
  },
  deleteHint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  deleteBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  deleteAction: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  logoutText: {
    color: '#E5423D',
    fontSize: 16,
    fontWeight: '600',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 8,
  },
  editBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  storageWrap: {
    gap: 10,
    marginTop: 14,
  },
  clearMedia: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
  },
  avatarPicker: {
    alignSelf: 'center',
    marginBottom: 14,
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  modalInput: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  modalBio: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalBtn: {
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  saveText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  buttonBusy: {
    opacity: 0.7,
  },
});