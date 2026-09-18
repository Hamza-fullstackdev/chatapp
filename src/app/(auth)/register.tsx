import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWaTheme } from '@/context/theme-context';
import { authApi } from '@/lib/api';
import { setAuthToken } from '@/lib/api-client';
import { pickAvatarImage, uploadAvatar, type LocalUploadSource } from '@/lib/media';

export default function RegisterScreen() {
  const { colors, dark } = useWaTheme();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('1234');
  const [avatarDraft, setAvatarDraft] = useState<LocalUploadSource | null>(null);
  const [busy, setBusy] = useState(false);

  const pickAvatar = async () => {
    const source = await pickAvatarImage();
    if (source) setAvatarDraft(source);
  };

  const submit = async () => {
    if (busy) return;
    if (!name.trim() || !/^[a-z0-9_.-]{3,32}$/i.test(username.trim())) {
      Alert.alert('Invalid details', 'Enter your name and a username (3-32 chars, a-z 0-9 _ . -).');
      return;
    }
    setBusy(true);
    try {
      const result = await authApi.register({
        name: name.trim(),
        username: username.trim(),
        code: code.trim() || '1234',
        email: email.trim() || undefined,
      });
      // The upload needs an authenticated token; the account now exists so we
      // can push the photo to the avatars bucket and patch the profile. This
      // must never block account creation if transiently fails.
      if (avatarDraft) {
        setAuthToken(result.token);
        try {
          const avatarUrl = await uploadAvatar(avatarDraft);
          await authApi.updateMe({ avatarUrl });
        } catch {
          Alert.alert(
            'Photo upload failed',
            'Your account was created. You can add a profile photo later from Settings.',
          );
        }
      }
      router.replace('/login');
    } catch (e) {
      Alert.alert('Registration failed', e instanceof Error ? e.message : 'Could not create account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? colors.background : colors.brandDark }]}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable hitSlop={10} onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
            </Pressable>
            <View style={styles.logoWrap}>
              <Image source={require('@/assets/images/launcher.png')} style={styles.logo} contentFit="cover" />
            </View>
            <Text style={styles.title}>Create your profile</Text>
            <Text style={styles.subtitle}>You will use your username + code to sign in.</Text>
            <Pressable onPress={pickAvatar} style={styles.avatarPicker} hitSlop={10}>
              {avatarDraft ? (
                <Image source={{ uri: avatarDraft.uri }} style={styles.avatarPick} contentFit="cover" />
              ) : (
                <View style={[styles.avatarPick, styles.avatarPlaceholder]}>
                  <Ionicons name="person-add-outline" size={34} color="rgba(255,255,255,0.9)" />
                </View>
              )}
              <View style={[styles.avatarBadge, { backgroundColor: colors.brand, borderColor: dark ? colors.background : '#0A6C5B' }]}>
                <Ionicons name="camera" size={15} color="#FFFFFF" />
              </View>
            </Pressable>
            <Text style={styles.avatarHint}>Add a profile photo (optional)</Text>
          </View>

          <View style={[styles.card, { backgroundColor: dark ? colors.backgroundSecondary : '#FFFFFF' }]}>
            <View style={[styles.field, { backgroundColor: dark ? colors.incomingBubble : colors.backgroundSecondary }]}>
              <Ionicons name="person-outline" size={20} color={colors.textSecondary} style={styles.fieldIcon} />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Full name"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.text }]}
              />
            </View>

            <View style={[styles.field, { backgroundColor: dark ? colors.incomingBubble : colors.backgroundSecondary }]}>
              <Ionicons name="at-outline" size={20} color={colors.textSecondary} style={styles.fieldIcon} />
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Username"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: colors.text }]}
              />
            </View>

            <View style={[styles.field, { backgroundColor: dark ? colors.incomingBubble : colors.backgroundSecondary }]}>
              <Ionicons name="mail-outline" size={20} color={colors.textSecondary} style={styles.fieldIcon} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email (optional)"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={[styles.input, { color: colors.text }]}
              />
            </View>

            <View style={[styles.field, { backgroundColor: dark ? colors.incomingBubble : colors.backgroundSecondary }]}>
              <Ionicons name="keypad-outline" size={20} color={colors.textSecondary} style={styles.fieldIcon} />
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="Verification code"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                secureTextEntry
                style={[styles.input, { color: colors.text }]}
              />
            </View>

            <Pressable
              onPress={submit}
              disabled={busy}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: pressed ? '#00806b' : colors.brand },
                busy && styles.buttonBusy,
              ]}
            >
              <Text style={styles.buttonText}>{busy ? 'Creating…' : 'Create account'}</Text>
            </Pressable>

            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Dev hint: the default code is 1234 (SMS delivery comes later).
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  backBtn: {
    position: 'absolute',
    top: 0,
    left: 0,
    padding: 4,
  },
  logoWrap: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  logo: {
    width: '100%',
    height: '100%',
    borderRadius: 52,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 6,
    textAlign: 'center',
  },
  avatarPicker: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  avatarPick: {
    width: '100%',
    height: '100%',
    borderRadius: 46,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#0A6C5B',
  },
  avatarHint: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  card: {
    borderRadius: 16,
    padding: 20,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  fieldIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 13,
    fontSize: 16,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 14,
  },
});