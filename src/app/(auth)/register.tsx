import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWaTheme } from '@/context/theme-context';
import { authApi } from '@/lib/api';

export default function RegisterScreen() {
  const { colors, dark } = useWaTheme();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('1234');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!name.trim() || !/^[a-z0-9_.-]{3,32}$/i.test(username.trim())) {
      Alert.alert('Invalid details', 'Enter your name and a username (3-32 chars, a-z 0-9 _ . -).');
      return;
    }
    setBusy(true);
    try {
      await authApi.register({
        name: name.trim(),
        username: username.trim(),
        code: code.trim() || '1234',
        email: email.trim() || undefined,
      });
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
              <Ionicons name="person-add" size={56} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>Create your profile</Text>
            <Text style={styles.subtitle}>You will use your username + code to sign in.</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
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