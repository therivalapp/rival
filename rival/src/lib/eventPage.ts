// The event page's numbers (Ricky, 2026-11-04, design/event-placings-mockup.png):
// which layout an event gets, its placings, a race's halves, pace per km and
// fastest efforts, HYROX rows and a multi-day event's days. Pure functions;
// the page is components/rival/EventSheet.tsx.

import { HYROX_STATIONS, hyroxParts, roundTimes } from './activityStats';

// ---- Placings -------------------------------------------------------------------

/** One placing: "Open Men, 86th of 1,240". `of` is the field size. */
export type PlacingRow = { key: string; category?: string | null; place: number | null; of?: number | null };

/** races.placings (supabase/add_race_placings.sql). `parts` holds a rank for
 *  each HYROX run (run1..run8) and station (st1..st8), or for each event of
 *  a multi-day event by its activity id. */
export type Placings = { rows?: PlacingRow[]; parts?: Record<string, number | null> };

export const PLACING_KEYS = ['division', 'overall', 'age'] as const;

/** The row's caption on the card: its category, or what the row is. */
export function placingCaption(r: PlacingRow): string {
  const c = (r.category ?? '').trim();
  if (c) return c;
  if (r.key === 'overall') return 'Overall';
  if (r.key === 'age') return 'Age group';
  if (r.key === 'division') return 'Division';
  return r.key;
}

/** Rows with a place, in the order they were entered. */
export function shownPlacings(p: Placings | null | undefined): PlacingRow[] {
  return (p?.rows ?? []).filter((r) => r.place != null && r.place > 0);
}

/** 1 → st, 2 → nd, 3 → rd, 11-13 → th. */
export function ordinalSuffix(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
}

export function ordinal(n: number): string {
  return `${n.toLocaleString()}${ordinalSuffix(n)}`;
}

/** Placings worth keeping: blank rows and ranks dropped. Null when empty. */
export function cleanPlacings(p: Placings): Placings | null {
  const rows = (p.rows ?? []).filter((r) => r.place != null && r.place > 0)
    .map((r) => ({ key: r.key, category: r.category?.trim() || null, place: r.place, of: r.of && r.of > 0 ? r.of : null }));
  const parts = Object.fromEntries(Object.entries(p.parts ?? {}).filter(([, v]) => v != null && v > 0));
  if (!rows.length && !Object.keys(parts).length) return null;
  return { ...(rows.length ? { rows } : {}), ...(Object.keys(parts).length ? { parts } : {}) };
}

// ---- Which layout ----------------------------------------------------------------

export type EventLegLike = {
  id: string;
  activity_type: string;
  started_at: string;
  duration_seconds: number | null;
  distance_meters: number | null;
  stats?: { laps?: number[]; wod?: { format?: string; roxzone?: boolean } | null } | null;
};

export type EventKind = 'hyrox' | 'days' | 'race' | 'legs';

/** HYROX when the race or its one activity is HYROX; several days when the
 *  activities fall on more than one date; one distance activity is a race
 *  (a marathon); anything else is the leg-by-leg page (a triathlon). */
export function eventKind(raceType: string | null | undefined, legs: EventLegLike[], dayOf: (iso: string) => string): EventKind {
  if (new Set(legs.map((a) => dayOf(a.started_at))).size > 1) return 'days';
  const hyroxLeg = legs.find((a) => a.activity_type === 'Hyrox' || a.stats?.wod?.format === 'race');
  if ((raceType === 'HYROX' || hyroxLeg) && legs.length === 1) return 'hyrox';
  if (legs.length === 1 && (legs[0].distance_meters ?? 0) > 0) return 'race';
  return 'legs';
}

// ---- A race: halves, pace per km, fastest efforts ---------------------------------------

export type Split = { seconds: number; distance: number; elevation?: number | null };

/** Time for the first and second half, from the km splits. Null without
 *  splits that cover the distance. */
export function halves(splits: Split[] | null | undefined): { first: number; second: number; firstM: number; secondM: number } | null {
  const s = (splits ?? []).filter((x) => x.distance > 0 && x.seconds > 0);
  if (s.length < 2) return null;
  const total = s.reduce((t, x) => t + x.distance, 0);
  const half = total / 2;
  let d = 0;
  let t = 0;
  for (const x of s) {
    if (d + x.distance >= half) {
      const at = t + x.seconds * ((half - d) / x.distance);
      const all = s.reduce((a, y) => a + y.seconds, 0);
      return { first: Math.round(at), second: Math.round(all - at), firstM: half, secondM: total - half };
    }
    d += x.distance;
    t += x.seconds;
  }
  return null;
}

/** Seconds per km for each full kilometre (a short last split is left off). */
export function paceBars(splits: Split[] | null | undefined): number[] {
  return (splits ?? []).filter((x) => x.distance >= 900 && x.seconds > 0).map((x) => Math.round((x.seconds / x.distance) * 1000));
}

export type BestEffort = { name: string; seconds: number; distance: number };

const EFFORT_NAMES: Record<string, string> = {
  '1K': '1 km', '1 mile': '1 mile', '5K': '5 km', '10K': '10 km', '15K': '15 km', '10 mile': '10 miles',
  '20K': '20 km', 'Half-Marathon': 'Half', '30K': '30 km',
};

/** Up to three fastest efforts inside the race, the longest first, never
 *  the whole race itself. */
export function raceEfforts(best: BestEffort[] | null | undefined, raceMetres: number): { label: string; seconds: number; name: string }[] {
  const inside = (best ?? []).filter((b) => EFFORT_NAMES[b.name] && b.distance < raceMetres * 0.95 && b.seconds > 0);
  return inside.sort((a, b) => b.distance - a.distance).slice(0, 3).reverse()
    .map((b) => ({ label: EFFORT_NAMES[b.name], seconds: b.seconds, name: b.name }));
}

// ---- HYROX -----------------------------------------------------------------------

export type HyroxRow = { n: number; station: string; metres: string | null; run: number | null; time: number | null; rox: number | null };

/** "SkiErg 1,000 m" → name and distance, for the table. */
function splitStation(s: string): { name: string; metres: string | null } {
  const m = s.match(/^(.*?)\s([\d,]+ m)$/);
  return m ? { name: m[1], metres: m[2] } : { name: s, metres: null };
}

/** Each run, its station and the Roxzone time around that station. */
export function hyroxRows(laps: number[] | null | undefined, rox = false): HyroxRow[] {
  if (!laps?.length) return [];
  const t = roundTimes(laps);
  const parts = hyroxParts(rox);
  return HYROX_STATIONS.map((station, k) => {
    const n = k + 1;
    const of = (kind: 'run' | 'station' | 'rox') => parts.map((p, i) => (p.kind === kind && p.n === n ? t[i] : undefined)).filter((x): x is number => x != null);
    const run = of('run');
    const st = of('station');
    const rx = of('rox');
    const sp = splitStation(station);
    return { n, station: sp.name, metres: sp.metres, run: run[0] ?? null, time: st[0] ?? null, rox: rox && rx.length ? rx.reduce((a, b) => a + b, 0) : null };
  }).filter((r) => r.run != null);
}

// ---- Several days ---------------------------------------------------------------

export type DayGroup<T> = { day: string; legs: T[]; seconds: number };

/** The activities grouped by day, in order. */
export function byDay<T extends EventLegLike>(legs: T[], dayOf: (iso: string) => string): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const a of [...legs].sort((x, y) => x.started_at.localeCompare(y.started_at))) {
    const day = dayOf(a.started_at);
    let g = out.find((x) => x.day === day);
    if (!g) out.push((g = { day, legs: [], seconds: 0 }));
    g.legs.push(a);
    g.seconds += a.duration_seconds || 0;
  }
  return out;
}
