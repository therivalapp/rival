import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalIcon } from './RivalIcon';
import { RivalColors } from '../../constants/rivalTheme';
import { RANK_SHEEN } from '../../constants/rankSheen';
import { DAY_SHORT, exerciseCount, type SavedWorkoutRow } from '../../lib/savedWorkouts';

// Saved workouts as portrait tiles in one row that swipes sideways, today's
// first (Ricky, 2026-10-25: "I like the swiping tiles"). Each shows the
// workout's photo; one tap logs it. The last tile saves a new one.

const TILE_W = 104;
const TILE_H = Math.round(TILE_W * 4 / 3);
const GAP = 8;

// Each workout takes the rank material of its usual day (constants/rankSheen.ts),
// so a colour always means the same day: Monday copper, Tuesday bronze,
// Wednesday sapphire, Thursday emerald, Friday ruby, Saturday amethyst, Sunday
// opal; no usual day is stone. Platinum and gold are left to the top ranks
// (Ricky, 2026-10-27: mockup B, filled in full, with white words).
export function workoutMaterial(usualDay: number | null | undefined): { light: string; dark: string } {
  if (usualDay == null) return RANK_SHEEN[0];
  return RANK_SHEEN[usualDay === 0 ? 7 : usualDay];
}

export function SavedWorkoutTiles({
  workouts, urls, onPick, onNew, today,
}: {
  workouts: SavedWorkoutRow[];
  urls: Record<string, string>;
  onPick: (w: SavedWorkoutRow) => void;
  onNew: () => void;
  /** Date.getDay() of today, to mark today's workout. */
  today: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={TILE_W + GAP}
      decelerationRate="fast"
      // Runs to the sheet's right edge, so the next tile peeks in.
      style={[s.strip, Platform.OS === 'web' && ({ scrollSnapType: 'x mandatory' } as any)]}
      contentContainerStyle={s.stripInner}
    >
      {workouts.map((w) => {
        const url = w.imagePath ? urls[w.imagePath] : undefined;
        const isToday = w.usualDay === today;
        const day = isToday ? 'TODAY' : w.usualDay != null ? DAY_SHORT[w.usualDay].toUpperCase() : null;
        const mat = workoutMaterial(w.usualDay);
        return (
          <TouchableOpacity
            key={w.id}
            style={[s.tile, { borderColor: isToday ? RivalColors.accentText : url ? `${mat.light}66` : mat.light }, isToday && s.tileToday, Platform.OS === 'web' && ({ scrollSnapAlign: 'start' } as any)]}
            onPress={() => onPick(w)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Log ${w.name}`}
          >
            {url ? (
              <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              // No photo: the workout's material, with the big faint icon
              // behind the words, as on Add an activity's tiles.
              <>
                <View style={[StyleSheet.absoluteFill, materialFill(mat), { pointerEvents: 'none' }]} />
                <View style={[StyleSheet.absoluteFill, s.art, { pointerEvents: 'none' }]}>
                  <RivalIcon name="bicep" size={92} color="rgba(255,255,255,0.18)" />
                </View>
              </>
            )}
            <View style={[StyleSheet.absoluteFill, url ? s.shade : s.shadeSoft, { pointerEvents: 'none' }]} />
            {day ? (
              <View style={s.day}><Text style={[s.dayText, !isToday && { color: '#fff' }]}>{day}</Text></View>
            ) : null}
            <Text style={s.name} numberOfLines={2}>{w.name}</Text>
            <Text style={s.sub}>{exerciseCount(w)}</Text>
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity
        style={[s.tile, s.tileNew, Platform.OS === 'web' && ({ scrollSnapAlign: 'start' } as any)]}
        onPress={onNew}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <View style={[StyleSheet.absoluteFill, s.art, { pointerEvents: 'none' }]}>
          <RivalIcon name="add" size={96} color="rgba(255,181,158,0.18)" />
        </View>
        <View style={[StyleSheet.absoluteFill, s.shadeGhost, { pointerEvents: 'none' }]} />
        <Text style={s.name}>Save activity</Text>
        <Text style={s.sub}>Scan or enter</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/** A tile in the same shape and look as Save activity, for a choice made from
 *  the Saved activities pop-up (Save activity: Scan a photo, Enter manually). */
export function SaveChoiceTile({ icon, title, sub, onPress }: {
  icon: 'camera' | 'manual'; title: string; sub?: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[s.tile, s.tileNew]} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={title}>
      <View style={[StyleSheet.absoluteFill, s.art, { pointerEvents: 'none' }]}>
        <RivalIcon name={icon} size={84} color="rgba(255,181,158,0.18)" />
      </View>
      <View style={[StyleSheet.absoluteFill, s.shadeGhost, { pointerEvents: 'none' }]} />
      <Text style={s.name}>{title}</Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  strip: { marginTop: 14, marginRight: -18, flexGrow: 0 },
  // Not stretched to the pop-up's height: every tile is 3:4.
  stripInner: { gap: GAP, paddingRight: 18, alignItems: 'flex-start' },
  tile: {
    width: TILE_W, height: TILE_H, borderRadius: 14, overflow: 'hidden',
    padding: 9, justifyContent: 'flex-end', gap: 1,
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)', backgroundColor: 'rgba(255,209,190,0.05)',
  },
  tileToday: { borderColor: RivalColors.accentText, borderWidth: 1.5 },
  tileNew: { borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.4)' },
  art: { alignItems: 'center', justifyContent: 'center', paddingBottom: 26 },
  // Neutral, so the photo keeps its own colours and the words stay readable.
  shade: Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(0deg, rgba(20,19,18,0.96) 22%, rgba(20,19,18,0.45) 60%, rgba(20,19,18,0) 100%)' } as any)
    : { backgroundColor: 'rgba(20,19,18,0.45)' },
  // Over a material: only along the bottom, for the white words.
  shadeSoft: Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(0deg, rgba(20,19,18,0.62) 0%, rgba(20,19,18,0.18) 42%, rgba(20,19,18,0) 62%)' } as any)
    : { backgroundColor: 'rgba(20,19,18,0.2)' },
  shadeGhost: Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(0deg, rgba(35,33,32,0.75), rgba(35,33,32,0) 60%)' } as any)
    : {},
  day: { position: 'absolute', top: 7, left: 7, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)' },
  dayText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: RivalColors.accentText },
  name: { fontSize: 13, fontWeight: '800', lineHeight: 15, color: '#fff' },
  sub: { fontSize: 10.5, color: 'rgba(255,255,255,0.6)' },
});

/** The material in full, light to dark, as an earned rank tile is. */
function materialFill(m: { light: string; dark: string }): object {
  return Platform.OS === 'web'
    ? { backgroundImage: `linear-gradient(160deg, ${m.light} 0%, ${m.dark} 100%)` }
    : { backgroundColor: m.dark };
}
