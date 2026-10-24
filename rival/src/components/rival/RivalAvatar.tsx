import { Image, StyleSheet, Text, View } from 'react-native';
import { RivalColors, RivalType } from '../../constants/rivalTheme';
import { avatarImage } from '../../lib/imageUrl';

function initials(name: string): string {
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

// Photo avatar with initials fallback + optional online dot — reused across
// Home, Team Hub, Feed, Standings, Friends. Currently every screen re-derives
// initials/fallback logic inline; this is the single place to fix that.
export function RivalAvatar({
  uri,
  name,
  size = 40,
  online,
}: {
  uri?: string | null;
  name: string;
  size?: number;
  online?: boolean;
}) {
  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <Image source={{ uri: avatarImage(uri, size) }} style={[styles.img, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials(name)}</Text>
        </View>
      )}
      {online ? <View style={[styles.dot, { width: size * 0.28, height: size * 0.28, borderRadius: size * 0.14 }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: RivalColors.surfaceContainerHigh },
  fallback: {
    backgroundColor: RivalColors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { ...RivalType.labelCaps, color: RivalColors.textPrimary },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    backgroundColor: RivalColors.success,
    borderWidth: 2,
    borderColor: RivalColors.surfaceLow,
  },
});
