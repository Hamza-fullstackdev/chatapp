import { Stack, DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { SocketProvider } from '@/context/socket-context';
import { SyncProvider } from '@/context/sync-context';
import { CallProvider } from '@/context/call-context';
import { WaThemeProvider, useWaTheme } from '@/context/theme-context';
import { NotificationsBridge } from '@/components/notifications-bridge';

function RootNavigator() {
  const { status } = useAuth();
  const { colors, dark } = useWaTheme();

  const navTheme = dark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, primary: colors.brand, background: colors.background, card: colors.background, text: colors.text } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: colors.brand, background: colors.background, card: colors.background, text: colors.text } };

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <NotificationsBridge />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="chat/[id]/group-info" />
          <Stack.Screen name="group/new" />
          <Stack.Screen name="call" />
          <Stack.Screen name="status/[id]" />
          <Stack.Screen name="status/create" />
          <Stack.Screen name="status/audience" />
          <Stack.Screen name="status/viewers" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SocketProvider>
        <SyncProvider>
          <CallProvider>
            <WaThemeProvider>
              <RootNavigator />
            </WaThemeProvider>
          </CallProvider>
        </SyncProvider>
      </SocketProvider>
    </AuthProvider>
  );
}