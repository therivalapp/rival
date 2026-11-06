import { defaultActivityName } from './activityName';
import { saveArrangement } from './activityMedia';
import { calculateEffortScore, loadScoringConfig } from './effort';
import { matchCanonicalLift } from './lifts';
import { liftsToSave, type LiveActivity } from './liveActivity';
import type { ActivityStats } from './activityStats';
import { elevationGain, trackDistance } from './liveTrack';
import { encodePolyline } from './polyline';
import { findMatchingRaceId } from './raceMatch';
import { createSavedWorkout } from './savedWorkouts';
import { tagTeammates } from './sharedActivities';
import { getAuthUser, supabase } from './supabase';
import type { MediaItem } from '../components/rival/MediaPicker';

// Save straight from the Finish pop-up (Ricky, 2026-11-02): no form in
// between. The same rows Log an activity writes for a live activity: the
// activity, its lifts for the PR tracker, its photos and its route (owner
// only, activity_routes). The name is the time of day plus the activity,
// "Morning Run", and can be changed on the activity afterwards.

export type LiveSaved = { activityId: string; userId: string; name: string; hasPhoto: boolean; warning: string | null };

// The extra numbers go in the stats column (supabase/add_activity_stats.sql,
// run 2026-11-02).
const STATS_COLUMN = true;

export async function saveLiveActivity(live: LiveActivity, seconds: number, photos: MediaItem[], keep: boolean, stats: ActivityStats = {}): Promise<LiveSaved | { error: string }> {
  const { data: { user } } = await getAuthUser();
  if (!user) return { error: 'Sign in again to save this activity.' };
  const startedAt = new Date(live.startedAt);
  const name = (live.name ?? '').trim() || defaultActivityName(live.activityType, startedAt);
  const track = live.track ?? [];
  // A pool swim has no route: its distance comes from the watch.
  const distance = trackDistance(track) || stats.distanceM || 0;
  const elevation = elevationGain(track);
  const effort = calculateEffortScore(live.activityType, seconds, elevation, await loadScoringConfig(), distance);
  const lifts = liftsToSave(live.lifts);
  const exercises = lifts.length ? lifts.map((l) => {
    const canonical = matchCanonicalLift(l.name);
    return canonical ? { ...l, prLift: canonical } : l;
  }) : null;

  const { data: inserted, error } = await supabase.from('activities').insert({
    user_id: user.id,
    name,
    activity_type: live.activityType,
    distance_meters: distance,
    duration_seconds: seconds,
    elevation_meters: elevation,
    started_at: startedAt.toISOString(),
    utc_offset_seconds: -startedAt.getTimezoneOffset() * 60,
    effort_score: effort,
    raw_effort_score: effort,
    exercises,
    provider: 'rival_manual',
    provider_activity_id: `manual-${Date.now()}`,
    race_id: await findMatchingRaceId(user.id, startedAt.toISOString()),
    // From a watch or sensor, in the columns Strava imports already fill.
    avg_heartrate: live.avgBpm ?? null,
    max_heartrate: live.maxBpm ?? null,
    avg_cadence: live.cadence ?? null,
    avg_watts: live.avgPower ?? null,
    calories: live.calories ?? null,
    avg_speed: distance > 0 && seconds > 0 ? distance / seconds : null,
    ...(STATS_COLUMN ? { stats } : {}),
  }).select('id').single();
  if (error || !inserted) return { error: 'The activity could not be saved. Try again.' };
  const activityId: string = inserted.id;
  let warning: string | null = null;

  const entries = lifts
    .map((l) => ({
      user_id: user.id,
      activity_id: activityId,
      exercise_name: matchCanonicalLift(l.name) || l.name.trim().replace(/\b\w/g, (c) => c.toUpperCase()),
      weight_kg: l.weight,
      reps: l.reps ?? null,
      performed_at: startedAt.toISOString(),
    }))
    .filter((e) => !!e.weight_kg && !!e.exercise_name);
  if (entries.length) {
    const { error: liftErr } = await supabase.from('exercise_entries').insert(entries);
    if (liftErr) warning = 'Activity saved, but the lifts did not attach.';
  }

  if (track.length >= 2) {
    const { error: routeErr } = await supabase.from('activity_routes')
      .insert({ activity_id: activityId, user_id: user.id, polyline: encodePolyline(track.map((p) => [p.lat, p.lon])) });
    if (routeErr) warning = warning ?? 'Activity saved, but the route did not attach.';
  }

  let hasPhoto = false;
  if (photos.length) {
    const result = await saveArrangement({ activityId, userId: user.id, items: photos, existing: [], currentCover: null });
    hasPhoto = !!result.cover;
    if (result.errors.length) warning = warning ?? `Activity saved, but: ${result.errors[0]}`;
  }

  // A teammate picked as the opponent is asked to confirm, like a training partner.
  const opponentId = stats.result?.opponentId;
  if (opponentId) {
    const tagged = await tagTeammates(activityId, [opponentId]);
    if (!tagged.ok) warning = warning ?? `Activity saved, but ${stats.result?.opponent ?? 'the opponent'} could not be added: ${tagged.error}`;
  }

  if (keep && lifts.length) createSavedWorkout({ name, activityType: live.activityType, exercises: lifts }).catch(() => {});

  // Milestones are earned off total hours; rechecked in the background.
  const { data: { session } } = await supabase.auth.getSession();
  if (session) fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-milestones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
  }).catch(() => {});

  return { activityId, userId: user.id, name, hasPhoto, warning };
}
