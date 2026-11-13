import { Platform, StyleSheet, View } from 'react-native';
import { RivalColors, RivalRadius } from '../../constants/rivalTheme';
import { webFx } from '../../lib/webFx';

// Shared progress bar for Goals/Streaks/Levels — terracotta fill on a charcoal
// track, with optional milestone ticks (e.g. 25/50/75% checkpoints on Goals).
// `gradientColors`/`radius` are optional additions for the Today mobile
// redesign's coral-to-gold bar — omitted, both default to prior behavior
// (flat accentFill, pill radius), so every existing call site is unaffected.
export function RivalProgressBar({
  pct,
  milestones,
  height = 8,
  gradientColors,
  radius = RivalRadius.full,
}: {
  pct: number; // 0-1
  milestones?: number[]; // e.g. [0.25, 0.5, 0.75]
  height?: number;
  gradientColors?: [string, string];
  radius?: number;
}) {
  const clamped = Math.max(0, Math.min(1, pct));
  // Web can express a real linear-gradient fill via backgroundImage; native
  // has no equivalent without adding expo-linear-gradient (not currently a
  // dependency), so it falls back to a flat fill using the gradient's first
  // color — acceptable given this app runs primarily on web.
  const fillColorStyle = !gradientColors
    ? { backgroundColor: RivalColors.accentFill }
    : Platform.OS === 'web'
      ? ({ backgroundImage: `linear-gradient(90deg, ${gradientColors[0]}, ${gradientColors[1]})` } as any)
      // iPhone draws the same gradient (experimental_backgroundImage).
      : ({ backgroundColor: gradientColors[0], ...webFx({ backgroundImage: `linear-gradient(90deg, ${gradientColors[0]}, ${gradientColors[1]})` }) } as any);
  return (
    <View style={[styles.track, { height, borderRadius: radius }]}>
      <View style={[styles.fill, { width: `${clamped * 100}%`, height, borderRadius: radius }, fillColorStyle]} />
      {(milestones ?? []).map((m) => (
        <View key={m} style={[styles.tick, { left: `${m * 100}%` }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderRadius: RivalRadius.full,
    backgroundColor: RivalColors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: RivalRadius.full,
    backgroundColor: RivalColors.accentFill,
  },
  tick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: RivalColors.surfaceLow,
    opacity: 0.6,
  },
});
