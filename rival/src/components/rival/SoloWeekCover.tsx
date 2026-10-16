import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalColors, RivalFontFamily, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, activityIconName } from './RivalIcon';
import { CoverImage } from './CoverImage';
import { SkyBackdrop } from './SkyBackdrop';
import { activityTypeLabel } from './EffortBreakdownSheet';
import { formatDuration } from '../../lib/format';
import { formatActivityDistance, formatElevation, formatSpeedOrPace } from '../../lib/units';

export type SoloActivity = {
  id: string;
  name: string | null;
  activity_type: string;
  started_at: string;
  utc_offset_seconds?: number | null;
  duration_seconds: number;
  distance_meters: number | null;
  elevation_meters?: number | null;
  effort_score: number;
  photo_url?: string | null;
  photo_focal_x?: number | null;
  photo_focal_y?: number | null;
};

/** A past week as a cover (Ricky, 2026-10-16, past weeks option B): the
 *  week's photo, or the sky its biggest activity started under, with the
 *  numbers set over the fade at the bottom. Tall (4:5) with a photo,
 *  shorter with the sky. */
export function WeekCover({ kicker, event, effort, photo, sky, line, lineEvent, huge, chip, stats, onPress, tall }: {
  kicker: string;
  /** An event week: the kicker in ivory. */
  event?: boolean;
  effort: number;
  photo?: { uri: string; focalX?: number | null; focalY?: number | null } | null;
  sky: { startedAt: string; utcOffsetSeconds?: number | null; type: string };
  /** A short line over the big figure, e.g. "Saturday · Run" or the event name. */
  line?: string | null;
  lineEvent?: boolean;
  huge: { value: string; unit?: string }[];
  chip: { text: string; best?: boolean; up?: boolean } | null;
  stats: { label: string; value: string }[];
  onPress?: () => void;
  /** Keep the tall shape even without a photo. */
  tall?: boolean;
}) {
  const body = (
    <>
      {photo ? (
        <CoverImage uri={photo.uri} focalX={photo.focalX} focalY={photo.focalY} style={s.fill} />
      ) : (
        <View style={[s.fill, s.art]}>
          <SkyBackdrop startedAt={sky.startedAt} utcOffsetSeconds={sky.utcOffsetSeconds} />
          <RivalIcon name={activityIconName(sky.type)} size={150} color="rgba(255,255,255,0.15)" style={{ marginTop: -60 }} />
        </View>
      )}
      <View pointerEvents="none" style={[s.fill, s.scrim]} />
      <View style={s.top}>
        <Text style={[s.kicker, event && { color: RivalColors.event }]} numberOfLines={1}>{kicker}</Text>
        <View style={s.effort}>
          <Text style={s.effortNum}>{Math.round(effort * 10) / 10}</Text>
          <Text style={s.effortLabel}>Effort</Text>
        </View>
      </View>
      <View style={s.bottom}>
        {line ? <Text style={[s.line, lineEvent && s.lineEvent]} numberOfLines={1}>{line}</Text> : null}
        <Text style={s.huge} numberOfLines={1}>
          {huge.map((h, i) => (
            <Text key={i}>{i > 0 ? ' ' : ''}{h.value}{h.unit ? <Text style={s.unit}>{h.unit}</Text> : null}</Text>
          ))}
        </Text>
        {chip ? (
          <View style={[s.chip, chip.best && s.chipBest, chip.up && s.chipUp]}>
            <RivalIcon name={chip.best ? 'trophy' : 'trendUp'} size={13} color={chip.best ? '#ffe6a8' : chip.up ? '#7fe0a4' : '#ffd3c2'} />
            <Text style={[s.chipText, chip.best && { color: '#ffe6a8' }, chip.up && { color: '#7fe0a4' }]}>{chip.text}</Text>
          </View>
        ) : null}
        {stats.length ? (
          <View style={s.stats}>
            {stats.map((st) => (
              <View key={st.label}>
                <Text style={s.statValue}>{st.value}</Text>
                <Text style={s.statLabel}>{st.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </>
  );
  const shape = [s.card, !photo && !tall && s.cardSky];
  return onPress
    ? <TouchableOpacity style={shape} activeOpacity={0.9} onPress={onPress} accessibilityLabel={kicker}>{body}</TouchableOpacity>
    : <View style={shape}>{body}</View>;
}

/** A past week with a single activity: the activity is the week (Ricky,
 *  2026-10-16, quiet weeks "One A"). Tapping it opens the activity. */
export function SoloWeekCover({ kicker, activity, chip, onPress }: {
  kicker: string;
  activity: SoloActivity;
  /** A best (gold) or a note such as "First run after a week off". */
  chip: { text: string; best?: boolean } | null;
  onPress: () => void;
}) {
  const a = activity;
  const day = new Date(a.started_at).toLocaleDateString(undefined, { weekday: 'long' });
  const name = a.name?.trim() || activityTypeLabel(a.activity_type);
  const dist = formatActivityDistance(a.distance_meters, a.activity_type);
  const [value, unit] = dist ? dist.split(' ') : [formatDuration(a.duration_seconds), ''];
  const stats: { label: string; value: string }[] = [];
  if (dist) stats.push({ label: 'Time', value: formatDuration(a.duration_seconds) });
  if (dist && a.duration_seconds > 0) {
    const pace = formatSpeedOrPace(a.distance_meters || 0, a.duration_seconds, a.activity_type);
    if (pace) stats.push({ label: /\/(km|mi)/.test(pace) ? 'Pace' : 'Speed', value: pace });
  }
  if ((a.elevation_meters ?? 0) > 0) stats.push({ label: 'Climb', value: formatElevation(a.elevation_meters || 0) });
  return (
    <WeekCover
      kicker={kicker}
      effort={a.effort_score}
      photo={a.photo_url ? { uri: a.photo_url, focalX: a.photo_focal_x, focalY: a.photo_focal_y } : null}
      sky={{ startedAt: a.started_at, utcOffsetSeconds: a.utc_offset_seconds, type: a.activity_type }}
      line={`${day} · ${name}`}
      huge={[{ value, unit: unit ? ` ${unit}` : undefined }]}
      chip={chip}
      stats={stats}
      onPress={onPress}
      tall
    />
  );
}

const s = StyleSheet.create({
  card: {
    width: '100%', aspectRatio: 4 / 5, borderRadius: 22, overflow: 'hidden', backgroundColor: '#211c19',
    justifyContent: 'space-between', padding: 16,
    // Keeps Safari clipping the rounded corners.
    ...(Platform.OS === 'web' ? { WebkitMaskImage: '-webkit-radial-gradient(white, black)', isolation: 'isolate' } as any : {}),
  },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  // Without a photo the sky card is shorter (the solo card stays tall).
  cardSky: { aspectRatio: 4 / 3.4 },
  art: { alignItems: 'center', justifyContent: 'center' },
  scrim: Platform.OS === 'web'
    ? { backgroundImage: 'linear-gradient(180deg, rgba(14,12,11,0.5) 0%, rgba(14,12,11,0) 26%, rgba(14,12,11,0.25) 52%, rgba(20,17,16,0.96) 100%)' } as any
    : { backgroundColor: 'rgba(14,12,11,0.35)' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  kicker: { flex: 1, fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: '#ffd3c2', marginTop: 3 },
  effort: { alignItems: 'center' },
  effortNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, lineHeight: 27, color: '#fff' },
  effortLabel: { fontFamily: RivalFontFamily, fontSize: 9, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: RivalColors.accentText },
  bottom: { gap: 8 },
  line: { fontFamily: RivalFontFamily, fontSize: 13, fontWeight: '600', color: RivalColors.accentText },
  huge: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 46, lineHeight: 50, color: '#fff', marginTop: -6 },
  unit: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontSize: 17, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(232,131,95,0.22)' },
  chipBest: { backgroundColor: 'rgba(255,201,77,0.18)' },
  chipUp: { backgroundColor: 'rgba(20,40,28,0.6)' },
  lineEvent: { color: RivalColors.event, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18 },
  chipText: { fontFamily: RivalFontFamily, fontSize: 11.5, fontWeight: '700', color: '#ffd3c2' },
  stats: { flexDirection: 'row', gap: 22, marginTop: 2 },
  statValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, lineHeight: 22, color: '#fff' },
  statLabel: { fontFamily: RivalFontFamily, fontSize: 9, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' },
});
