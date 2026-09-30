import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { RivalColors, RivalFontFamily } from '../../constants/rivalTheme';
import { effortBreakdown, loadScoringConfig, type EffortBreakdown, type ScoringConfig } from '../../lib/effort';
import { formatActivityDistance, formatElevation } from '../../lib/units';
import { formatDuration } from '../../lib/format';
import { GreyLabel, GreyNote, GreyRow, GreyRows, GreySheet } from './RivalGreySheet';

// What an activity's Effort is made of: time, distance and climbing, each with
// the Effort it earned. Opened by tapping an Effort figure. Uses the same
// formula and live rates as scoring (lib/effort.ts), so the parts add up to
// the figure the activity carries.

export type EffortSource = {
  activity_type: string;
  duration_seconds: number;
  distance_meters: number | null;
  elevation_meters: number | null;
  effort_score: number;
};

/** "VirtualRun" → "Virtual run", with the brand spellings kept. */
export function activityTypeLabel(type: string): string {
  const named: Record<string, string> = { Hyrox: 'HYROX', Crossfit: 'CrossFit', CrossFit: 'CrossFit', HIIT: 'HIIT', WeightTraining: 'Weights', EBikeRide: 'E-bike ride' };
  if (named[type]) return named[type];
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const fmt = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString();

export function EffortBreakdownSheet({ activity, onClose }: { activity: EffortSource | null; onClose: () => void }) {
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  useEffect(() => {
    if (activity && !config) loadScoringConfig().then(setConfig);
  }, [activity, config]);

  const b: EffortBreakdown | null = activity && config
    ? effortBreakdown(activity.activity_type, activity.duration_seconds, activity.elevation_meters ?? 0, config, activity.distance_meters ?? 0)
    : null;

  const label = activity ? activityTypeLabel(activity.activity_type) : '';
  const hasDistanceRate = !!activity && (config?.distanceRates?.[activity.activity_type] ?? 0) > 0;
  const enteredKm = (activity?.distance_meters ?? 0) > 0;
  const enteredClimb = (activity?.elevation_meters ?? 0) > 0;

  const basisNote = !b ? '' : b.basis === 'distance'
    ? 'Scored mostly on distance, with time and climbing added.'
    : hasDistanceRate
      ? 'No distance was recorded, so this activity was scored on time.'
      : `${label} is scored on time. Mixed and gym activities are scored this way.`;

  const notes: string[] = [];
  if (b && activity) {
    if (b.basis === 'distance' && b.creditedKm < b.km - 0.01) {
      notes.push('Distance is counted up to the fastest believable pace for this activity.');
    }
    if (b.climb < (activity.elevation_meters ?? 0) - 1 && b.climbRate > 0) {
      notes.push('Climbing is counted up to 2,500 m an hour.');
    }
    if (enteredKm && b.basis === 'time' && !hasDistanceRate) notes.push('Distance is saved, but does not add Effort for this activity.');
    if (enteredClimb && b.climbRate === 0) notes.push('Elevation is saved, but does not add Effort for this activity.');
    // Shared copies and older rows can carry a figure the current rates would
    // not give. The figure shown is always the one the activity counts for.
    if (Math.abs(b.total - activity.effort_score) >= 1) notes.push('This activity was scored under earlier rates.');
  }

  return (
    <Modal visible={!!activity} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <GreySheet
          kicker="EFFORT"
          title={activity ? `${fmt(activity.effort_score)} Effort` : 'Effort'}
          onClose={onClose}
          footer={
            <TouchableOpacity style={s.linkRow} onPress={() => { onClose(); router.push('/effort'); }}>
              <Text style={s.link}>How Effort works →</Text>
            </TouchableOpacity>
          }
        >
          {b && activity ? (
            <>
              <GreyNote>{basisNote}</GreyNote>
              <View style={{ height: 14 }} />
              <GreyLabel>{label.toUpperCase()}</GreyLabel>
              <GreyRows>
                <GreyRow icon="timer" label="Time">
                  <Part detail={formatDuration(activity.duration_seconds)} value={b.timeScore} />
                </GreyRow>
                {b.basis === 'distance' ? (
                  <GreyRow icon="distance" label="Distance">
                    <Part detail={formatActivityDistance(activity.distance_meters, activity.activity_type) ?? ''} value={b.distanceScore} />
                  </GreyRow>
                ) : null}
                {b.climbRate > 0 && b.climb > 0 ? (
                  <GreyRow icon="elevation" label="Climbing">
                    <Part detail={formatElevation(b.climb)} value={b.climbScore} />
                  </GreyRow>
                ) : null}
                <GreyRow icon="bolt" label="Total">
                  <Text style={s.total}>{fmt(activity.effort_score)}</Text>
                </GreyRow>
              </GreyRows>
              {notes.map((n) => <GreyNote key={n}>{n}</GreyNote>)}
            </>
          ) : (
            <GreyNote>Loading…</GreyNote>
          )}
        </GreySheet>
      </View>
    </Modal>
  );
}

function Part({ detail, value }: { detail: string; value: number }) {
  return (
    <View style={s.part}>
      <Text style={s.detail} numberOfLines={1}>{detail}</Text>
      <Text style={s.value}>{fmt(value)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  linkRow: { alignItems: 'center', paddingVertical: 6 },
  link: { fontFamily: RivalFontFamily, fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText, marginTop: 8 },
  part: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end', gap: 12 },
  detail: { fontFamily: RivalFontFamily, fontSize: 13, color: RivalColors.textSecondary, flexShrink: 1 },
  value: { fontFamily: RivalFontFamily, fontSize: 14.5, fontWeight: '700', color: RivalColors.onSurface, minWidth: 34, textAlign: 'right' },
  total: { fontFamily: RivalFontFamily, fontSize: 15.5, fontWeight: '800', color: RivalColors.accentText, textAlign: 'right' },
});
