import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/auth-context';
import { useWaTheme } from '@/context/theme-context';
import { Avatar } from '@/components/avatar';
import { formatLastSeen } from '@/lib/format';
import { authApi } from '@/lib/api';

export default function SettingsScreen() {
  const { user, signOut, updateUser } = useAuth();
  const { colors } = useWaTheme();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const openEditor = () => {
    setName(user.name);
    setBio(user.bio ?? '');
    setEditing(true);
  };

  const saveProfile = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await authApi.updateMe({ name: name.trim(), bio: bio.trim() || null });
      updateUser(updated);
      setEditing(false);
    } catch {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.safe, { backgroundColor: colors.background }]}>
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

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit profile</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    padding: 16,
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