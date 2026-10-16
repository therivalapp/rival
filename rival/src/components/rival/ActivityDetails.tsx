import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { formatDurationClock } from '../../lib/format';
import { formatSpeedOrPace } from '../../lib/units';
import { EFFORT_DISTANCES, RUN_TYPES, effortDistance, type BestEffort, type FastestBest } from '../../lib/bestEfforts';
import { RivalColors, RivalFontFamily } from '../../constants/rivalTheme';
import { GreyLabel, GreyNote, GreyRow, GreyRows, GreySheet } from './RivalGreySheet';
import { RivalIcon } from './RivalIcon';

// The finer details of an activity (add_activity_details.sql): pace, heart
// rate, cadence, power, calories, shoes or bike, best efforts and splits.
// Kept behind a tap so cards stay at four numbers (Ricky, 2026-10-14): the
// feed opens them as a pop-up from the numbers card, the activity page folds
// them under Details.

const COLUMNS = 'id, provider, activity_type, distance_meters, duration_seconds, avg_heartrate, max_heartrate, avg_cadence, avg_watts, calories, avg_speed, max_speed, gear_name, best_efforts, splits, details_fetched_at';

export type ActivityDetailRow = {
  id: string;
  provider: string | null;
  activity_type: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_heartrate: number | null;
  max_heartrate: number | null;
  avg_cadence: number | null;
  avg_watts: number | null;
  calories: number | null;
  avg_speed: number | null;
  max_speed: number | null;
  gear_name: string | null;
  best_efforts: BestEffort[] | null;
  splits: Array<{ distance: number | null; seconds: number | null; elevation: number | null }> | null;
  details_fetched_at: string | null;
};

/** Reads one activity's details when `id` is set. */
export function useActivityDetails(id: string | null | undefined): ActivityDetailRow | null {
  const [row, setRow] = useState<ActivityDetailRow | null>(null);
  useEffect(() => {
    setRow(null);
    if (!id) return;
    let live = true;
    supabase.from('activities').select(COLUMNS).eq('id', id).maybeSingle()
      .then(({ data }) => { if (live && data) setRow(data as ActivityDetailRow); });
    return () => { live = false; };
  }, [id]);
  return row;
}

const isRun = (t: string) => RUN_TYPES.has(t);
const isRide = (t: string) => t === 'Ride' || t === 'VirtualRide' || t === 'EBikeRide' || t === 'MountainBikeRide' || t === 'GravelRide';

type Fact = { key: string; icon: 'timer' | 'pulse' | 'bolt' | 'fire' | 'run' | 'ride' | 'workout'; label: string; value: string };

function factsFor(d: ActivityDetailRow): Fact[] {
  const out: Fact[] = [];
  const dist = d.distance_meters ?? 0;
  const secs = d.duration_seconds ?? 0;
  if (dist >= 100 && secs > 0 && d.activity_type !== 'WeightTraining') {
    out.push({ key: 'pace', icon: 'timer', label: isRide(d.activity_type) ? 'Average speed' : 'Average pace', value: formatSpeedOrPace(dist, secs, d.activity_type) });
  }
  if (d.avg_heartrate) {
    out.push({ key: 'hr', icon: 'pulse', label: 'Heart rate', value: `${Math.round(d.avg_heartrate)} bpm${d.max_heartrate ? ` · max ${Math.round(d.max_heartrate)}` : ''}` });
  }
  if (d.avg_cadence) {
    // Strava counts one foot on runs; steps per minute counts both.
    out.push({ key: 'cad', icon: 'run', label: 'Cadence', value: isRun(d.activity_type) ? `${Math.round(d.avg_cadence * 2)} spm` : `${Math.round(d.avg_cadence)} rpm` });
  }
  if (d.avg_watts) out.push({ key: 'w', icon: 'bolt', label: 'Power', value: `${Math.round(d.avg_watts)} W` });
  if (d.calories) out.push({ key: 'cal', icon: 'fire', label: 'Calories', value: Math.round(d.calories).toLocaleString() });
  if (d.gear_name) {
    out.push({ key: 'gear', icon: isRide(d.activity_type) ? 'ride' : isRun(d.activity_type) ? 'run' : 'workout', label: isRide(d.activity_type) ? 'Bike' : isRun(d.activity_type) ? 'Shoes' : 'Gear', value: d.gear_name });
  }
  return out;
}

/** The set distances this activity has a time for, shortest first. */
function effortsFor(d: ActivityDetailRow): Array<{ meters: number; label: string; seconds: number }> {
  const best = new Map<number, number>();
  for (const b of d.best_efforts ?? []) {
    if (!b.distance || !b.seconds) continue;
    const e = effortDistance(b.distance);
    if (e && (!best.has(e.meters) || b.seconds < best.get(e.meters)!)) best.set(e.meters, b.seconds);
  }
  return EFFORT_DISTANCES.filter((e) => best.has(e.meters)).map((e) => ({ ...e, seconds: best.get(e.meters)! }));
}

/** One quiet line for the folded Details: pace, heart rate and shoes. */
export function detailsSummary(d: ActivityDetailRow | null): string | null {
  if (!d) return null;
  const facts = factsFor(d);
  const pick = ['pace', 'hr', 'gear'].map((k) => facts.find((f) => f.key === k)).filter(Boolean) as Fact[];
  const line = (pick.length ? pick : facts.slice(0, 3)).map((f) => (f.key === 'hr' ? f.value.split(' · ')[0] : f.value));
  return line.length ? line.join(' · ') : null;
}

/** Whether there is anything to show beyond the four numbers. */
export function hasDetails(d: ActivityDetailRow | null): boolean {
  return !!d && (factsFor(d).length > 0 || effortsFor(d).length > 0 || (d.splits?.length ?? 0) > 1);
}

export function DetailsBody({ details, bests }: { details: ActivityDetailRow; bests?: FastestBest[] | null }) {
  const facts = factsFor(details);
  const efforts = effortsFor(details);
  const newBest = new Set((bests ?? []).map((b) => b.meters));
  const splits = (details.splits ?? []).filter((s) => s.distance && s.seconds && s.distance >= 500);
  // Bar height by speed, so a quicker kilometre stands taller.
  const speeds = splits.map((s) => s.distance! / s.seconds!);
  const fastest = speeds.length ? Math.max(...speeds) : 0;
  const slowest = speeds.length ? Math.min(...speeds) : 0;
  const barHeight = (v: number) => (fastest === slowest ? 0.8 : 0.45 + 0.55 * ((v - slowest) / (fastest - slowest)));
  const nothingYet = !facts.length && !efforts.length && splits.length < 2;

  return (
    <View>
      {facts.length ? (
        <GreyRows>
          {facts.map((f) => <GreyRow key={f.key} icon={f.icon} label={f.label} value={f.value} />)}
        </GreyRows>
      ) : null}

      {efforts.length ? (
        <>
          <View style={s.gap} />
          <GreyLabel>BEST EFFORTS</GreyLabel>
          <GreyRows>
            {efforts.map((e) => {
              const best = newBest.has(e.meters);
              return (
                <View key={e.meters} style={s.effortRow}>
                  <Text style={s.effortLabel}>{e.label.charAt(0).toUpperCase() + e.label.slice(1)}</Text>
                  {best ? (
                    <View style={s.bestTag}>
                      <RivalIcon name="trophy" size={11} color="#ffd27a" />
                      <Text style={s.bestTagText}>Best</Text>
                    </View>
                  ) : null}
                  <Text style={[s.effortTime, best && s.effortTimeBest]}>{formatDurationClock(e.seconds)}</Text>
                </View>
              );
            })}
          </GreyRows>
        </>
      ) : null}

      {splits.length > 1 ? (
        <>
          <View style={s.gap} />
          <GreyLabel>SPLITS PER KM</GreyLabel>
          <View style={s.splitCard}>
            <View style={s.bars}>
              {splits.map((sp, i) => (
                <View key={i} style={s.barCol}>
                  <View style={[s.bar, speeds[i] === fastest && s.barFast, { height: `${Math.round(barHeight(speeds[i]) * 100)}%` as any }]} />
                </View>
              ))}
            </View>
            <View style={s.barLabels}>
              {splits.map((sp, i) => (
                <Text key={i} style={s.barLabel} numberOfLines={1}>
                  {splits.length <= 8 || i === 0 || (i + 1) % 5 === 0 || i === splits.length - 1 ? String(i + 1) : ''}
                </Text>
              ))}
            </View>
            <Text style={s.splitNote}>
              Fastest kilometre {formatDurationClock(Math.round(splits[speeds.indexOf(fastest)].seconds! * (1000 / splits[speeds.indexOf(fastest)].distance!)))}
            </Text>
          </View>
        </>
      ) : null}

      {nothingYet ? (
        <GreyNote>
          {details.provider === 'strava' && !details.details_fetched_at
            ? 'Further details appear after the next sync.'
            : 'No further details were recorded for this activity.'}
        </GreyNote>
      ) : null}
    </View>
  );
}

/** The feed's pop-up, opened by tapping a card's numbers. */
export function DetailsSheet({ activityId, title, bests, onClose }: {
  activityId: string | null;
  title: string;
  bests?: FastestBest[] | null;
  onClose: () => void;
}) {
  const details = useActivityDetails(activityId);
  return (
    <Modal visible={!!activityId} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <GreySheet
          kicker="DETAILS"
          title={title}
          onClose={onClose}
          // Strava's terms ask apps showing its data to say so; one small
          // line at the very bottom, nothing more (Ricky, 2026-10-14).
          footer={details?.provider === 'strava' ? <Text style={s.attribution}>Powered by Strava</Text> : null}
        >
          {details ? <DetailsBody details={details} bests={bests} /> : <GreyNote>Loading…</GreyNote>}
        </GreySheet>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  gap: { height: 16 },
  effortRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  effortLabel: { flex: 1, fontFamily: RivalFontFamily, fontSize: 14, color: RivalColors.onSurface },
  effortTime: { fontFamily: RivalFontFamily, fontSize: 15, fontWeight: '700', color: RivalColors.onSurface, fontVariant: ['tabular-nums'] },
  effortTimeBest: { color: '#ffd27a' },
  bestTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(255,201,77,0.12)' },
  bestTagText: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#ffd27a', textTransform: 'uppercase' },
  splitCard: { borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', padding: 14 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 64, gap: 4 },
  barCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: 'rgba(232,131,95,0.75)' },
  barFast: { backgroundColor: '#ffc94d' },
  barLabels: { flexDirection: 'row', gap: 4, marginTop: 5 },
  barLabel: { flex: 1, textAlign: 'center', fontFamily: RivalFontFamily, fontSize: 10, color: RivalColors.textSecondary },
  splitNote: { marginTop: 10, fontFamily: RivalFontFamily, fontSize: 12.5, color: RivalColors.textSecondary },
  attribution: { textAlign: 'center', fontFamily: RivalFontFamily, fontSize: 11, color: 'rgba(255,255,255,0.35)', paddingVertical: 4 },
});
