import { matchCanonicalLift } from './lifts';

// When a logged lift is a personal best, one rule for the feed, a team's
// page and the Activity page (Ricky, 2026-10-23):
//   - a lift logged before is a PB when it beats the heaviest earlier one;
//   - the first time a lift is logged it is a PB only if the person turned
//     on "Personal best" for it in Manual entry (`markedPb`), since they may
//     have lifted for years before RIVAL. Otherwise nothing shows.

export type LoggedLift = { userId: string; activityId: string; lift: string; weightKg: number; at: number };

export type LiftExercise = { name: string; weight?: number; prLift?: string; markedPb?: boolean };

/** The lift's canonical name, when it's one RIVAL tracks. */
export function liftName(ex: LiftExercise): string | null {
  return matchCanonicalLift(ex.name) || ex.prLift || null;
}

/** Every tracked, weighted lift in these activities, for liftPbChecker. */
export function loggedLifts(activities: { id: string; user_id: string; started_at: string; exercises?: LiftExercise[] | null }[]): LoggedLift[] {
  const out: LoggedLift[] = [];
  for (const a of activities) {
    const at = new Date(a.started_at).getTime();
    for (const ex of a.exercises || []) {
      const lift = liftName(ex);
      if (lift && ex.weight) out.push({ userId: a.user_id, activityId: a.id, lift, weightKg: Number(ex.weight), at });
    }
  }
  return out;
}

/** The same, from saved exercise_entries rows (the feed and team pages). */
export function liftsFromEntries(rows: { user_id: string; activity_id: string | null; exercise_name: string; weight_kg: number; performed_at: string }[]): LoggedLift[] {
  return rows
    // No activity: left behind by a deleted one, so it no longer counts.
    .filter((r) => r.weight_kg && r.exercise_name && r.activity_id)
    .map((r) => ({ userId: r.user_id, activityId: r.activity_id ?? '', lift: r.exercise_name, weightKg: Number(r.weight_kg), at: new Date(r.performed_at).getTime() }));
}

export type LiftPb = { lift: string; weightKg: number; prevKg: number | null };

/** Builds a check for one activity's lifts against the person's earlier ones:
 *  the first PB lift it finds (heaviest first), or null. */
export function liftPbChecker(history: LoggedLift[]) {
  const byKey = new Map<string, LoggedLift[]>();
  for (const h of history) {
    const key = `${h.userId}|${h.lift}`;
    const list = byKey.get(key);
    if (list) list.push(h);
    else byKey.set(key, [h]);
  }
  return (userId: string, activityId: string, startedAt: string, exercises: LiftExercise[] | null | undefined): LiftPb | null => {
    const at = new Date(startedAt).getTime();
    const lifts = (exercises || [])
      .map((ex) => ({ ex, lift: liftName(ex), kg: Number(ex.weight) || 0 }))
      .filter((l) => l.lift && l.kg > 0)
      .sort((a, b) => b.kg - a.kg);
    for (const { ex, lift, kg } of lifts) {
      const earlier = (byKey.get(`${userId}|${lift}`) || []).filter((h) => h.activityId !== activityId && h.at < at);
      if (!earlier.length) {
        if (ex.markedPb) return { lift: lift!, weightKg: kg, prevKg: null };
        continue;
      }
      const prev = Math.max(...earlier.map((h) => h.weightKg));
      if (kg > prev) return { lift: lift!, weightKg: kg, prevKg: prev };
    }
    return null;
  };
}
