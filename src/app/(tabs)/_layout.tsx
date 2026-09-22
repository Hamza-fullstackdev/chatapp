import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWaTheme } from '@/context/theme-context';

export default function TabsLayout() {
  const { colors, dark } = useWaTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const onChat = pathname.startsWith('/chat');

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: onChat ? colors.brandDark : dark ? colors.background : colors.brandDark },
        headerTintColor: onChat || dark ? colors.text : '#FFFFFF',
        headerTitleAlign: 'left',
        headerTitleStyle: { fontWeight: '600' },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: dark ? colors.textSecondary : '#54656F',
        tabBarStyle: {
          backgroundColor: dark ? colors.background : '#FFFFFF',
          height: 64 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
          borderTopWidth: 0.5,
          borderTopColor: dark ? colors.divider : '#DADDE1',
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        sceneStyle: { backgroundColor: colors.backgroundSecondary },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={pathname === '/' ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} color={color} size={size - 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={pathname === '/contacts' ? 'person' : 'person-outline'} color={color} size={size - 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: 'Calls',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={pathname === '/calls' ? 'call' : 'call-outline'} color={color} size={size - 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={pathname === '/settings' ? 'settings' : 'settings-outline'} color={color} size={size - 2} />
          ),
        }}
      />
    </Tabs>
  );
}