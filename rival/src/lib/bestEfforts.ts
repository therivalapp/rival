// Fastest times over set distances (Ricky, 2026-10-14): 400 m, 1 km, 1 mile,
// 5 km, 10 km, half marathon and marathon, across a person's whole RIVAL
// history. A run counts whether the distance was the whole run or part of a
// longer one: parts come from the run's best efforts (add_activity_details.sql),
// and a run without them still counts when its own distance is that distance.
//
// An activity is a new best when it beats every earlier run at that distance,
// so the mark stays with the activity that set it, like the band on the feed.

import { formatDurationClock } from './format';

export const RUN_TYPES = new Set(['Run', 'VirtualRun', 'TrailRun']);

export const EFFORT_DISTANCES: Array<{ meters: number; label: string }> = [
  { meters: 400, label: '400 m' },
  { meters: 1000, label: '1 km' },
  { meters: 1609.34, label: '1 mile' },
  { meters: 5000, label: '5 km' },
  { meters: 10000, label: '10 km' },
  { meters: 21097.5, label: 'half marathon' },
  { meters: 42195, label: 'marathon' },
];

// The bests celebrated with a gold band (Ricky, 2026-10-14). 400 m is left
// out: inside a longer run it is often a downhill or a GPS jump. 1 km and
// 1 mile are nearly the same effort, so only the one matching the person's
// units counts. Details still lists every distance.
export function celebrated(meters: number, imperial: boolean): boolean {
  if (meters === 400) return false;
  if (meters === 1000) return !imperial;
  if (meters === 1609.34) return imperial;
  return true;
}

export type BestEffort = { name?: string; distance: number | null; seconds: number | null };

export type EffortRow = {
  id: string;
  user_id?: string;
  activity_type: string;
  started_at: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  best_efforts?: BestEffort[] | null;
};

export type FastestBest = { meters: number; label: string; seconds: number; prevSeconds: number };

/** The set distance a measured one stands for, allowing for GPS rounding. */
export function effortDistance(meters: number): { meters: number; label: string } | null {
  return EFFORT_DISTANCES.find((d) => Math.abs(meters - d.meters) <= d.meters * 0.01) ?? null;
}

/** Seconds for each set distance in one run. */
function timesFor(row: EffortRow): Map<number, number> {
  const out = new Map<number, number>();
  for (const b of row.best_efforts ?? []) {
    if (!b.distance || !b.seconds) continue;
    const d = effortDistance(b.distance);
    if (d && (!out.has(d.meters) || b.seconds < out.get(d.meters)!)) out.set(d.meters, b.seconds);
  }
  // The whole run, when it is one of the distances (up to 3% over, as watches
  // rarely stop on the exact metre), scaled back to the distance itself.
  const dist = row.distance_meters ?? 0;
  const secs = row.duration_seconds ?? 0;
  if (dist > 0 && secs > 0) {
    for (const d of EFFORT_DISTANCES) {
      if (dist >= d.meters * 0.995 && dist <= d.meters * 1.03 && !out.has(d.meters)) {
        out.set(d.meters, Math.round(secs * Math.min(1, d.meters / dist)));
      }
    }
  }
  return out;
}

/** Every run that set a new fastest time, keyed by activity id. Each entry
 *  lists the distances it was a new best at, longest first. Rows may mix
 *  people; each person is compared only with their own runs. */
export function fastestBests(rows: EffortRow[], imperial = false): Record<string, FastestBest[]> {
  const byUser = new Map<string, EffortRow[]>();
  for (const r of rows) {
    if (!RUN_TYPES.has(r.activity_type)) continue;
    const k = r.user_id ?? '';
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k)!.push(r);
  }
  const out: Record<string, FastestBest[]> = {};
  for (const runs of byUser.values()) {
    runs.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    const best = new Map<number, number>();
    for (const r of runs) {
      const won: FastestBest[] = [];
      for (const [meters, seconds] of timesFor(r)) {
        const prev = best.get(meters);
        if (prev !== undefined && seconds < prev && celebrated(meters, imperial)) {
          won.push({ meters, label: EFFORT_DISTANCES.find((d) => d.meters === meters)!.label, seconds, prevSeconds: prev });
        }
        if (prev === undefined || seconds < prev) best.set(meters, seconds);
      }
      if (won.length) out[r.id] = won.sort((a, b) => b.meters - a.meters);
    }
  }
  return out;
}

/** "Fastest 5 km" / "Fastest half marathon". */
export function fastestTitle(b: FastestBest): string {
  return `Fastest ${b.label}`;
}

/** The quieter half of the line: " · 24:10, was 25:02". */
export function fastestRest(b: FastestBest): string {
  return ` · ${formatDurationClock(b.seconds)}, was ${formatDurationClock(b.prevSeconds)}`;
}

/** Bands stacked on a card when one run sets several bests (Ricky,
 *  2026-10-14/16, option A): the longest leads and two more stack under it.
 *  Any others are only in Details, marked gold there. */
export const STACKED_BESTS = 3;

/** How long a personal best stood before it was beaten: "9 days",
 *  "5 weeks", "7 months", "3 years" (Ricky, 2026-10-24: an old PB says
 *  "Farthest run for 7 months"). */
export function pbStoodText(ms: number): string {
  const days = Math.max(1, Math.round(ms / 86400000));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (days < 14) return plural(days, 'day');
  if (days < 60) return plural(Math.round(days / 7), 'week');
  if (days < 730) return plural(Math.round(days / 30.44), 'month');
  return plural(Math.round(days / 365.25), 'year');
}
