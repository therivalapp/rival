import { fetchAllActivities } from './fetchAllActivities';
import { supabase } from './supabase';
import { celebrationFor, type Celebration, type CelebrationActivity, type CelebrationRace } from './celebration';

const COLUMNS = 'id, name, activity_type, started_at, utc_offset_seconds, duration_seconds, distance_meters, elevation_meters, effort_score, exercises, race_id';

/** The celebration for one activity, with its event when it is linked to one;
 *  null when it set nothing, or on any failure (the photo prompt carries on). */
export async function loadCelebration(userId: string, activityId: string): Promise<{ c: Celebration; activity: CelebrationActivity } | null> {
  try {
    const rows = (await fetchAllActivities(userId, COLUMNS)) as CelebrationActivity[];
    const activity = rows.find((a) => a.id === activityId);
    if (!activity) return null;
    let race: CelebrationRace | null = null;
    if (activity.race_id) {
      const { data } = await supabase.from('races')
        .select('id, name, race_date, distance_km, goal_finish_time, actual_finish_time, disciplines')
        .eq('id', activity.race_id).maybeSingle();
      race = (data as CelebrationRace | null) ?? null;
    }
    const c = celebrationFor(rows, activityId, userId, race);
    return c ? { c, activity } : null;
  } catch {
    return null;
  }
}
