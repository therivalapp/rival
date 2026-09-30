import { getMondayOfWeek } from './streak';
import { inLocalYear, type YearActivity } from './yearReview';

// The Activity Journal's Year tab: the month-by-month shape of a year, which
// weeks were trained, and the personal bests set along the way. Pure, so it can
// be tested without a database. Totals and highlights come from buildYearReview.

const DISTANCE_SPORTS = new Set([
  'Run', 'Ride', 'Swim', 'Walk', 'Hike', 'Rowing', 'VirtualRun', 'VirtualRide', 'NordicSki', 'AlpineSki', 'TrailRun',
]);

/** Years with at least one activity, newest first; always includes this year. */
export function yearsWithActivity(all: Array<Pick<YearActivity, 'started_at'>>, now = new Date()): number[] {
  const years = new Set<number>([now.getFullYear()]);
  all.forEach((a) => years.add(new Date(a.started_at).getFullYear()));
  return [...years].sort((a, b) => b - a);
}

export type MonthTotal = { month: number; effort: number; count: number };

export function monthlyTotals(all: YearActivity[], year: number): MonthTotal[] {
  const months: MonthTotal[] = Array.from({ length: 12 }, (_, month) => ({ month, effort: 0, count: 0 }));
  all.forEach((a) => {
    if (!inLocalYear(a.started_at, year)) return;
    const m = months[new Date(a.started_at).getMonth()];
    m.effort += a.effort_score || 0;
    m.count += 1;
  });
  months.forEach((m) => { m.effort = Math.round(m.effort); });
  return months;
}

export type WeekCell = { start: Date; effort: number; count: number; future: boolean };

/** Every week that starts in the year (Monday-start), in order. Weeks that
 *  haven't happened yet are marked, so the strip can show them as empty
 *  rather than as missed. */
export function yearWeeks(all: YearActivity[], year: number, now = new Date()): WeekCell[] {
  const byWeek = new Map<number, { effort: number; count: number }>();
  all.forEach((a) => {
    if (!inLocalYear(a.started_at, year)) return;
    const k = getMondayOfWeek(new Date(a.started_at)).getTime();
    const w = byWeek.get(k) ?? { effort: 0, count: 0 };
    w.effort += a.effort_score || 0;
    w.count += 1;
    byWeek.set(k, w);
  });
  const weeks: WeekCell[] = [];
  // The first week can start in late December of the year before; it still
  // holds 1 January, so it belongs to this year.
  let d = getMondayOfWeek(new Date(year, 0, 1));
  const thisWeek = getMondayOfWeek(now).getTime();
  while (d.getFullYear() <= year) {
    const k = d.getTime();
    const w = byWeek.get(k) ?? { effort: 0, count: 0 };
    weeks.push({ start: new Date(d), effort: Math.round(w.effort), count: w.count, future: k > thisWeek });
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  }
  return weeks;
}

export type PbMoment = { date: Date; type: string; kind: 'distance' | 'time'; value: number; previous: number };

/** Each time an activity beat everything of its kind before it — farther for
 *  distance sports, longer for everything else — within the year, newest
 *  first. A first-ever activity of a kind isn't a personal best; there was
 *  nothing to beat. */
export function pbMoments(all: YearActivity[], year: number, limit = 8): PbMoment[] {
  const sorted = [...all].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  const best = new Map<string, number>();
  const out: PbMoment[] = [];
  for (const a of sorted) {
    const type = a.activity_type || 'Workout';
    const kind: PbMoment['kind'] = DISTANCE_SPORTS.has(type) ? 'distance' : 'time';
    const value = kind === 'distance' ? (a.distance_meters || 0) / 1000 : (a.duration_seconds || 0) / 60;
    if (value <= 0) continue;
    const prev = best.get(type);
    if (prev !== undefined && value > prev && inLocalYear(a.started_at, year)) {
      out.push({ date: new Date(a.started_at), type, kind, value, previous: prev });
    }
    if (prev === undefined || value > prev) best.set(type, value);
  }
  return out.reverse().slice(0, limit);
}
