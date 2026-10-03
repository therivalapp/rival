import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { RivalColors, RivalFontFamily } from '../../constants/rivalTheme';
import { effortBreakdown, loadScoringConfig, type EffortBreakdown, type ScoringConfig } from '../../lib/effort';
import { formatActivityDistance, formatElevation } from '../../lib/units';
import { formatDuration } from '../../lib/format';
import { GreyLabel, GreyNote, GreyRow, GreyRows, GreySheet } from './RivalGreySheet';
import { confirmActivityEffort } from '../../lib/inbox';

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
  /** For the review: the activity's id, and whether its owner confirmed it. */
  id?: string;
  effort_confirmed?: boolean;
  /** The viewer's own activity (not a shared copy), so they can review it. */
  canReview?: boolean;
};

/** "VirtualRun" → "Virtual run", with the brand spellings kept. */
export function activityTypeLabel(type: string): string {
  const named: Record<string, string> = { Hyrox: 'HYROX', Crossfit: 'CrossFit', CrossFit: 'CrossFit', HIIT: 'HIIT', WeightTraining: 'Weights', EBikeRide: 'E-bike ride' };
  if (named[type]) return named[type];
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const fmt = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString();

export function EffortBreakdownSheet({ activity, onClose, onConfirmed }: {
  activity: EffortSource | null;
  onClose: () => void;
  /** Called with the new Effort once the owner confirms an activity. */
  onConfirmed?: (id: string, effort: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  useEffect(() => {
    if (activity && !config) loadScoringConfig().then(setConfig);
  }, [activity, config]);

  const b: EffortBreakdown | null = activity && config
    ? effortBreakdown(activity.activity_type, activity.duration_seconds, activity.elevation_meters ?? 0, config, activity.distance_meters ?? 0, !!activity.effort_confirmed)
    : null;
  // Over a realistic pace or climb rate and not yet vouched for: less is
  // counted until the owner edits it or confirms it.
  const needsReview = !!b && b.capped && !activity?.effort_confirmed;

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
    if (activity.effort_confirmed && b.capped) notes.push('Confirmed as correct, so all of it counts.');
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
              {needsReview ? (
                <View style={s.review}>
                  <Text style={s.reviewTitle}>Check this activity</Text>
                  <Text style={s.reviewBody}>
                    {b.cappedDistance
                      ? `${formatActivityDistance(activity.distance_meters, activity.activity_type)} in ${formatDuration(activity.duration_seconds)} is faster than ${realisticSpeed(b.minPace)}, the fastest realistic pace for ${label.toLowerCase()}. ${formatActivityDistance(b.creditedKm * 1000, activity.activity_type)} counts for now.`
                      : `${formatElevation(b.recordedClimb)} in ${formatDuration(activity.duration_seconds)} is faster than 2,500 m an hour. ${formatElevation(b.climb)} counts for now.`}
                    {' '}If it is right, confirm it and all of it counts.
                  </Text>
                  {activity.canReview && activity.id ? (
                    <View style={s.reviewActions}>
                      <TouchableOpacity
                        style={s.reviewGhost}
                        onPress={() => { onClose(); router.push({ pathname: '/manual-entry', params: { editId: activity.id! } }); }}
                        accessibilityRole="button"
                      >
                        <Text style={s.reviewGhostText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.reviewPrimary}
                        disabled={confirming}
                        accessibilityRole="button"
                        onPress={async () => {
                          setConfirming(true);
                          setConfirmError(null);
                          const res = await confirmActivityEffort(activity.id!);
                          setConfirming(false);
                          if (!res.ok) { setConfirmError(res.error ?? 'Could not confirm. Try again.'); return; }
                          onConfirmed?.(activity.id!, res.effort ?? activity.effort_score);
                        }}
                      >
                        <Text style={s.reviewPrimaryText}>{confirming ? 'Saving…' : "It's correct"}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  {confirmError ? <Text style={s.reviewError}>{confirmError}</Text> : null}
                </View>
              ) : null}
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

// "24 km/h" from a pace in minutes per km.
function realisticSpeed(minPace: number): string {
  return minPace > 0 ? `${Math.round(60 / minPace)} km/h` : 'a realistic pace';
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
  review: { marginTop: 14, padding: 14, borderRadius: 14, gap: 8, backgroundColor: 'rgba(217,119,87,0.10)', borderWidth: 1, borderColor: 'rgba(255,181,158,0.25)' },
  reviewTitle: { fontFamily: RivalFontFamily, fontSize: 14.5, fontWeight: '800', color: RivalColors.onSurface },
  reviewBody: { fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 18, color: RivalColors.textSecondary },
  reviewActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  reviewGhost: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)' },
  reviewGhostText: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', color: RivalColors.accentText },
  reviewPrimary: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999, backgroundColor: RivalColors.accentText },
  reviewPrimaryText: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '800', color: '#2a1408' },
  reviewError: { fontFamily: RivalFontFamily, fontSize: 12.5, color: RivalColors.error },
  total: { fontFamily: RivalFontFamily, fontSize: 15.5, fontWeight: '800', color: RivalColors.accentText, textAlign: 'right' },
});
