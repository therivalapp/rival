import { liftPbChecker, loggedLifts, type LiftPb, type LiftExercise } from './liftPb';

// Sports measured by how far; the rest by how long.
export const DISTANCE_SPORTS = new Set([
  'Run', 'Ride', 'Swim', 'Walk', 'Hike', 'Rowing',
  'VirtualRun', 'VirtualRide', 'NordicSki', 'AlpineSki',
  'Kayaking', 'StandUpPaddling', 'Surfing',
]);

export type PbActivity = {
  id: string;
  activity_type: string;
  started_at: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  exercises?: LiftExercise[] | null;
};

/** Which activities were personal bests. Every PB stays a PB (Ricky,
 *  2026-10-24): each activity that went further (or longer) than every earlier
 *  one of its type was a PB that day, and keeps it after it is beaten, the way
 *  lifts and fastest times already did. The first of a type has nothing to
 *  beat. A lift PB is the activity's best: it takes the place of "longest". */
export function activityPbs(data: PbActivity[], userId: string) {
  const byType = new Map<string, PbActivity[]>();
  for (const activity of data) {
    if (!byType.has(activity.activity_type)) byType.set(activity.activity_type, []);
    byType.get(activity.activity_type)!.push(activity);
  }

  const pbs: Record<string, string> = {};
  const prev: Record<string, number> = {};
  for (const [type, acts] of byType) {
    const useDistance = DISTANCE_SPORTS.has(type);
    const metricOf = (a: PbActivity) => (useDistance ? (a.distance_meters || 0) : (a.duration_seconds || 0));
    const inOrder = acts.slice().sort((x, y) => new Date(x.started_at).getTime() - new Date(y.started_at).getTime());
    let best = -1;
    for (const a of inOrder) {
      const v = metricOf(a);
      if (best >= 0 && v > best && v > 0) {
        pbs[a.id] = useDistance ? `Farthest ${type}` : `Longest ${type}`;
        prev[a.id] = best;
      }
      if (v > best) best = v;
    }
  }
  const liftCheck = liftPbChecker(loggedLifts(data.map((a) => ({ ...a, user_id: userId }))));
  const lifts: Record<string, LiftPb> = {};
  for (const a of data) {
    const lp = liftCheck(userId, a.id, a.started_at, a.exercises);
    if (!lp) continue;
    lifts[a.id] = lp;
    pbs[a.id] = `Heaviest ${lp.lift}`;
    delete prev[a.id];
  }
  return { pbs, prev, lifts };
}
