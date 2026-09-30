import { getMondayOfWeek } from './streak';

// Everything the Year in review screen shows, worked out from one person's
// activities. Pure, so it can be tested without a database.
//
// A year is the person's local calendar year (the same boundaries as their
// rank), and every kind of training counts: nothing here assumes distance, so
// a lifter or a yoga regular sees their year as fully as a runner does. Stats
// that are zero are left for the screen to hide rather than shown as "0 km".

export type YearActivity = {
  started_at: string;
  activity_type: string | null;
  effort_score: number | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  elevation_meters: number | null;
};

export type ActivityBreakdown = { type: string; count: number; minutes: number; km: number };

export type YearReview = {
  year: number;
  count: number;
  effort: number;
  minutes: number;
  km: number;
  elevM: number;
  activeDays: number;
  byActivity: ActivityBreakdown[];
  topActivity: ActivityBreakdown | null;
  bestWeek: { start: Date; effort: number } | null;
  longestWeekStreak: number;
  longestSession: { type: string; minutes: number; date: Date } | null;
  farthest: { type: string; km: number; date: Date } | null;
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function inLocalYear(iso: string, year: number): boolean {
  const t = new Date(iso).getTime();
  return t >= new Date(year, 0, 1).getTime() && t < new Date(year + 1, 0, 1).getTime();
}

export function buildYearReview(all: YearActivity[], year: number): YearReview {
  const acts = all.filter((a) => inLocalYear(a.started_at, year));

  const byType = new Map<string, ActivityBreakdown>();
  const days = new Set<string>();
  const weekEffort = new Map<number, number>();
  let effort = 0, minutes = 0, km = 0, elevM = 0;
  let longestSession: YearReview['longestSession'] = null;
  let farthest: YearReview['farthest'] = null;

  for (const a of acts) {
    const date = new Date(a.started_at);
    const type = a.activity_type || 'Workout';
    const mins = (a.duration_seconds || 0) / 60;
    const dist = (a.distance_meters || 0) / 1000;
    effort += a.effort_score || 0;
    minutes += mins;
    km += dist;
    elevM += a.elevation_meters || 0;
    days.add(dayKey(date));

    const row = byType.get(type) ?? { type, count: 0, minutes: 0, km: 0 };
    row.count += 1; row.minutes += mins; row.km += dist;
    byType.set(type, row);

    const monday = getMondayOfWeek(date).getTime();
    weekEffort.set(monday, (weekEffort.get(monday) || 0) + (a.effort_score || 0));

    if (mins > 0 && (!longestSession || mins > longestSession.minutes)) longestSession = { type, minutes: mins, date };
    if (dist > 0 && (!farthest || dist > farthest.km)) farthest = { type, km: dist, date };
  }

  const byActivity = [...byType.values()]
    .map((r) => ({ ...r, minutes: Math.round(r.minutes), km: Math.round(r.km * 10) / 10 }))
    // Most sessions first; time breaks a tie, so the thing done longest wins.
    .sort((x, y) => y.count - x.count || y.minutes - x.minutes);

  let bestWeek: YearReview['bestWeek'] = null;
  for (const [start, e] of weekEffort) {
    if (!bestWeek || e > bestWeek.effort) bestWeek = { start: new Date(start), effort: Math.round(e) };
  }

  // Longest run of consecutive weeks with at least one session. Steps a week
  // at a time by calendar date rather than adding 7 days of milliseconds, so a
  // daylight-saving change can't break a run in two.
  const mondays = [...weekEffort.keys()].sort((x, y) => x - y);
  let longestWeekStreak = 0, run = 0, prev: Date | null = null;
  for (const t of mondays) {
    const cur = new Date(t);
    if (prev) {
      const expected = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7);
      run = dayKey(expected) === dayKey(cur) ? run + 1 : 1;
    } else {
      run = 1;
    }
    longestWeekStreak = Math.max(longestWeekStreak, run);
    prev = cur;
  }

  return {
    year,
    count: acts.length,
    effort: Math.round(effort),
    minutes: Math.round(minutes),
    km: Math.round(km),
    elevM: Math.round(elevM),
    activeDays: days.size,
    byActivity,
    topActivity: byActivity[0] ?? null,
    bestWeek,
    longestWeekStreak,
    longestSession: longestSession ? { ...longestSession, minutes: Math.round(longestSession.minutes) } : null,
    farthest: farthest ? { ...farthest, km: Math.round(farthest.km * 10) / 10 } : null,
  };
}

// "Run", "Weight training" — Strava's CamelCase type as a short display name.
export function activityDisplayName(type: string | null | undefined): string {
  if (!type) return 'Activity';
  if (type === 'WeightTraining') return 'Weight training';
  if (/^[A-Z]{2,}$/.test(type) || type === 'CrossFit') return type;
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0) + words.slice(1).toLowerCase();
}

// "212h 40m", "45m".
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return h > 0 ? `${h.toLocaleString()}h ${m}m` : `${m}m`;
}
