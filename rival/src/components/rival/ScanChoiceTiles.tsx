import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalIcon, type RivalIconName } from './RivalIcon';
import { RivalButtonColors, RivalColors } from '../../constants/rivalTheme';
import { webFx } from '../../lib/webFx';

// Take photo and Upload, the same two tiles, words and icons as the Add an
// activity pop-up (src/app/add-workout.tsx). Used wherever a photo is read,
// so every scan reads the same (Ricky, 2026-11-04).

function TileArt({ icon, primary }: { icon: RivalIconName; primary?: boolean }) {
  return (
    <>
      <View style={[t.art, { pointerEvents: 'none' }]}>
        <RivalIcon name={icon} size={118} color={primary ? 'rgba(255,255,255,0.32)' : 'rgba(255,181,158,0.24)'} />
      </View>
      <View style={[t.fade, primary ? t.fadePrimary : t.fadeGhost, { pointerEvents: 'none' }]} />
    </>
  );
}

export function ScanChoiceTiles({ onPick, uploadSub = 'Screenshot or saved photo', compact }: {
  onPick: (source: 'camera' | 'gallery') => void;
  uploadSub?: string;
  /** Shorter tiles, for a pop-up with more under them. */
  compact?: boolean;
}) {
  const h = compact ? { minHeight: 106 } : null;
  return (
    <View style={t.tiles}>
      <TouchableOpacity style={[t.tile, t.primary, h]} onPress={() => onPick('camera')} activeOpacity={0.85} accessibilityRole="button">
        <TileArt icon="camera" primary />
        <Text style={[t.title, { color: t.primaryText.color }]}>Take photo</Text>
        <Text style={[t.sub, { color: t.primaryText.color, opacity: 0.75 }]}>Use the camera</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[t.tile, t.ghost, h]} onPress={() => onPick('gallery')} activeOpacity={0.85} accessibilityRole="button">
        <TileArt icon="upload" />
        <Text style={t.title}>Upload</Text>
        <Text style={t.sub} numberOfLines={1}>{uploadSub}</Text>
      </TouchableOpacity>
    </View>
  );
}

const t = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, minHeight: 132, borderRadius: 18, padding: 16, justifyContent: 'flex-end', gap: 3, overflow: 'hidden' },
  primary: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  ghost: { borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)', backgroundColor: 'rgba(255,209,190,0.05)' },
  primaryText: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  art: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  fade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  fadePrimary: webFx({ backgroundImage: 'linear-gradient(0deg, rgba(223,124,92,0.55), rgba(223,124,92,0) 55%)' }),
  fadeGhost: webFx({ backgroundImage: 'linear-gradient(0deg, rgba(35,33,32,0.75), rgba(35,33,32,0) 60%)' }),
  title: { fontSize: 17, fontWeight: '800', color: RivalColors.textPrimary },
  sub: { fontSize: 12, fontWeight: '500', color: RivalColors.textSecondary },
});
