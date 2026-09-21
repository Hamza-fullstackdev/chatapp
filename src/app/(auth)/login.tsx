import { Alert, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth-context';
import { useWaTheme } from '@/context/theme-context';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { colors, dark } = useWaTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const user = username.trim().replace(/\s+/g, '');
    if (!user) {
      Alert.alert('Missing details', 'Enter your username.');
      return;
    }
    if (!password) {
      Alert.alert('Missing details', 'Enter your password.');
      return;
    }
    setBusy(true);
    try {
      await signIn(user, password);
    } catch (e) {
      Alert.alert('Login failed', e instanceof Error ? e.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? colors.background : colors.brandDark }]}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.header}>
          <View style={styles.logoWrap}>
            <Image source={require('@/assets/images/launcher.png')} style={styles.logo} contentFit="cover" />
          </View>
          <Text style={styles.title}>chat-app</Text>
          <Text style={styles.subtitle}>Sign in with your username</Text>
        </View>

        <View style={[styles.card, { backgroundColor: dark ? colors.backgroundSecondary : '#FFFFFF' }]}>
          <View style={[styles.field, { backgroundColor: dark ? colors.incomingBubble : colors.backgroundSecondary }]}>
            <Ionicons name="person-outline" size={20} color={colors.textSecondary} style={styles.fieldIcon} />
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
            <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={styles.fieldIcon} />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              style={[styles.input, { color: colors.text }]}
              onSubmitEditing={submit}
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
            <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
          </Pressable>

          <View style={styles.registerRow}>
            <Text style={[styles.registerHint, { color: colors.textSecondary }]}>New here?</Text>
            <Pressable onPress={() => router.push('/register')} hitSlop={8}>
              <Text style={[styles.registerLink, { color: colors.brand }]}>Create account</Text>
            </Pressable>
          </View>
        </View>
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
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  logo: {
    width: '100%',
    height: '100%',
    borderRadius: 56,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
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
  registerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    gap: 6,
  },
  registerHint: {
    fontSize: 13,
  },
  registerLink: {
    fontSize: 13,
    fontWeight: '600',
  },
});