import { StyleSheet, View, Text } from 'react-native';
import { Image } from 'expo-image';
import { initials } from '@/lib/format';

const AVATAR_COLORS = ['#00A884', '#128C7E', '#075E54', '#F3A132', '#E5423D', '#5F59C6', '#1E6FD9', '#0E8A3A'];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: number;
}

export function Avatar({ name, uri, size = 48 }: AvatarProps) {
  const dims = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} style={[styles.image, dims]} contentFit="cover" transition={150} />;
  }

  return (
    <View style={[styles.fallback, dims, { backgroundColor: colorFor(name) }]}>
      <Text style={[styles.initials, { fontSize: size * 0.35 }]} numberOfLines={1}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: '#D9DEE3',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});