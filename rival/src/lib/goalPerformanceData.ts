import { fetchAllActivities } from './fetchAllActivities';
import { selectAll } from './selectAll';
import { supabase } from './supabase';
import type { LiftEntry } from './liftHistory';
import type { PerformanceActivity } from './goalPerformance';

/** What Performance goals are measured from, whole history. */
export async function loadPerformanceData(userId: string): Promise<{ activities: PerformanceActivity[]; entries: LiftEntry[] }> {
  const [activities, rows] = await Promise.all([
    fetchAllActivities(userId, 'activity_type, started_at, distance_meters, duration_seconds, best_efforts'),
    selectAll<any>((from, to) => supabase.from('exercise_entries')
      .select('id, exercise_name, weight_kg, reps, performed_at').eq('user_id', userId).order('id').range(from, to)),
  ]);
  return {
    activities: (activities ?? []) as unknown as PerformanceActivity[],
    entries: rows.map((r) => ({ name: r.exercise_name, weightKg: Number(r.weight_kg) || 0, reps: r.reps, at: r.performed_at })),
  };
}
