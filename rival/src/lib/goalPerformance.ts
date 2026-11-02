import { ACTIVITY_TYPE_GROUPS, localDay } from './goalProgress';
import { liftKey, type LiftEntry } from './liftHistory';

// Performance goals (Ricky, 2026-10-31, board 8/10): getting better at
// something rather than adding up. Each has a starting best, a target and the
// distance between them, and only ever moves forward. Volume goals stay in
// goalProgress.ts. Stored: seconds for fastest_time, seconds per 100 m (swim)
// or per km for pace, kg for lift.

export const PERFORMANCE_TYPES = new Set(['fastest_time', 'pace', 'lift']);
export const isPerformance = (goalType: string) => PERFORMANCE_TYPES.has(goalType);

/** Each group holds this many goals at once. */
export const GOAL_GROUP_LIMIT = 3;
/** Stored as the end date of a goal with none chosen; screens read open_ended. */
export const OPEN_END_DATE = '2099-12-31';

export type PerformanceGoal = {
  goal_type: string; target_value: number; activity_filter: string | null; start_date: string;
  distance_m?: number | null; lift_name?: string | null; lift_reps?: number | null; start_value?: number | null;
};
export type PerformanceActivity = {
  activity_type: string; started_at: string; distance_meters: number | null; duration_seconds: number | null;
  best_efforts?: { distance: number | null; seconds: number | null }[] | null;
};

const paceMeters = (sport: string | null) => (sport === 'Swim' ? 100 : 1000);
const inSport = (a: PerformanceActivity, sport: string | null) => !sport || (ACTIVITY_TYPE_GROUPS[sport] ?? [sport]).includes(a.activity_type);

/** Seconds for a distance in one activity: a split inside it, or the whole
 *  activity when it was that distance (up to 3% over, scaled back). */
function secondsOver(a: PerformanceActivity, meters: number): number | null {
  let best: number | null = null;
  for (const b of a.best_efforts ?? []) {
    if (b.distance && b.seconds && Math.abs(b.distance - meters) <= meters * 0.01 && (best == null || b.seconds < best)) best = b.seconds;
  }
  const dist = a.distance_meters ?? 0;
  const secs = a.duration_seconds ?? 0;
  if (best == null && secs > 0 && dist >= meters * 0.995 && dist <= meters * 1.03) best = Math.round(secs * Math.min(1, meters / dist));
  return best;
}

/** The best so far from `fromMs` on, in the goal's stored unit. Null if none. */
export function bestSince(goal: PerformanceGoal, activities: PerformanceActivity[], entries: LiftEntry[], fromMs = -Infinity): number | null {
  if (goal.goal_type === 'lift') {
    const key = liftKey(goal.lift_name ?? '');
    const reps = goal.lift_reps ?? 1;
    const hits = entries.filter((e) => liftKey(e.name) === key && e.weightKg > 0 && (e.reps ?? 1) >= reps && new Date(e.at).getTime() >= fromMs);
    return hits.length ? Math.max(...hits.map((e) => e.weightKg)) : null;
  }
  const meters = goal.distance_m ?? 0;
  if (!meters) return null;
  const times: number[] = [];
  for (const a of activities) {
    if (!inSport(a, goal.activity_filter) || new Date(a.started_at).getTime() < fromMs) continue;
    if (goal.goal_type === 'fastest_time') {
      const s = secondsOver(a, meters);
      if (s) times.push(s);
    } else if ((a.distance_meters ?? 0) >= meters * 0.995 && (a.duration_seconds ?? 0) > 0) {
      times.push((a.duration_seconds as number) / ((a.distance_meters as number) / paceMeters(goal.activity_filter)));
    }
  }
  return times.length ? Math.min(...times) : null;
}

export type PerformanceState = { start: number | null; current: number | null; pct: number; done: boolean };

/** Where a goal stands. Progress runs from the starting best to the target
 *  and never goes back: a slower day changes nothing. */
export function performanceState(goal: PerformanceGoal, activities: PerformanceActivity[], entries: LiftEntry[]): PerformanceState {
  const higher = goal.goal_type === 'lift';
  const since = bestSince(goal, activities, entries, localDay(goal.start_date).getTime());
  const start = goal.start_value ?? since;
  const current = start == null ? since : since == null ? start : higher ? Math.max(start, since) : Math.min(start, since);
  if (current == null || start == null) return { start, current, pct: 0, done: false };
  const done = higher ? current >= goal.target_value : current <= goal.target_value;
  const span = goal.target_value - start;
  const pct = done ? 1 : span === 0 ? 0 : Math.max(0, Math.min(0.99, (current - start) / span));
  return { start, current, pct, done };
}

export function clock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "19:59", "1:02:30" or "90" as seconds; null if it isn't a time. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(':').map((p) => p.trim());
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const secs = parts.reduce((sum, p) => sum * 60 + Number(p), 0);
  return secs > 0 ? secs : null;
}

export const distanceName = (meters: number) => (meters === 21097.5 ? 'half marathon' : meters === 42195 ? 'marathon' : meters >= 1000 ? `${(meters / 1000).toLocaleString()} km` : `${meters} m`);
const paceUnit = (sport: string | null) => (sport === 'Swim' ? '/ 100 m' : '/ km');

// Screens pass formatWeight from lib/units, which this pure file can't import.
export type KgText = (kg: number) => string;
const plainKg: KgText = (kg) => `${kg} kg`;

/** A value in the goal's own terms, short: "21:14", "82.5 kg". */
export function formatValue(goal: PerformanceGoal, value: number | null, kg: KgText = plainKg): string {
  if (value == null) return '-';
  return goal.goal_type === 'lift' ? kg(value) : clock(value);
}

export function performanceTitle(goal: PerformanceGoal, kg: KgText = plainKg): string {
  if (goal.goal_type === 'lift') {
    const reps = goal.lift_reps ?? 1;
    return `${goal.lift_name} ${formatValue(goal, goal.target_value, kg)}${reps > 1 ? ` × ${reps}` : ''}`;
  }
  const sport = goal.activity_filter ?? 'Run';
  if (goal.goal_type === 'pace') return `${sport} ${clock(goal.target_value)} ${paceUnit(goal.activity_filter)}`;
  return `${distanceName(goal.distance_m ?? 0)} ${sport.toLowerCase()} in ${clock(goal.target_value)}`;
}

export function performanceKind(goal: PerformanceGoal): string {
  if (goal.goal_type === 'lift') return 'Lift';
  return goal.goal_type === 'pace' ? `Pace over ${distanceName(goal.distance_m ?? 0)}` : 'Best time';
}

/** "1:15 to go". Null once reached, or with no best yet. */
export function toGoText(goal: PerformanceGoal, s: PerformanceState, kg: KgText = plainKg): string | null {
  if (s.done || s.current == null) return null;
  const gap = Math.abs(s.current - goal.target_value);
  return `${goal.goal_type === 'lift' ? kg(gap) : clock(gap)} to go`;
}

/** "29 seconds faster since the start". Encouragement only: null with nothing gained. */
export function gainedText(goal: PerformanceGoal, s: PerformanceState, kg: KgText = plainKg): string | null {
  if (s.start == null || s.current == null || s.current === s.start) return null;
  const gap = Math.abs(s.current - s.start);
  if (goal.goal_type === 'lift') return `Up ${kg(gap)} since the start`;
  return gap < 60 ? `${Math.round(gap)} seconds faster since the start` : `${clock(gap)} faster since the start`;
}
