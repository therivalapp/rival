// Finished team challenges: their results, the trophy case and the team
// records (Mockups 57 v5 and 59 v4, Ricky 2026-11-14). A challenge counts the
// activities between its start and end dates. Records are the most one person
// added in a single challenge of each type, for the year (resets 1 January)
// and all time.

export type ChallengeMetric = 'xp' | 'distance' | 'elevation' | 'duration' | 'activities';

export type ChallengeDef = {
  key: string; // history row id, or 'current'
  metric: ChallengeMetric;
  target: number;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
};

export type ChallengeActivity = {
  user_id: string;
  started_at: string;
  effort_score: number | null;
  distance_meters: number | null;
  elevation_meters: number | null;
  duration_seconds: number | null;
};

export type Contribution = { userId: string; value: number; activities: number };

export type ChallengeResult = ChallengeDef & {
  total: number;
  activityCount: number;
  days: number;
  people: Contribution[]; // most first
};

export const ENDED_SHOWN_DAYS = 14;

export function metricValue(a: ChallengeActivity, metric: ChallengeMetric): number {
  if (metric === 'xp') return a.effort_score || 0;
  if (metric === 'distance') return (a.distance_meters || 0) / 1000;
  if (metric === 'elevation') return a.elevation_meters || 0;
  if (metric === 'duration') return (a.duration_seconds || 0) / 3600;
  return 1;
}

const dayOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function inWindow(a: ChallengeActivity, start: string, end: string): boolean {
  const day = dayOf(a.started_at);
  return day >= start && day <= end;
}

export function challengeResult(def: ChallengeDef, activities: ChallengeActivity[], memberIds: Set<string>): ChallengeResult {
  const by: Record<string, Contribution> = {};
  let total = 0;
  let activityCount = 0;
  for (const a of activities) {
    if (!memberIds.has(a.user_id) || !inWindow(a, def.start, def.end)) continue;
    const v = metricValue(a, def.metric);
    if (v <= 0) continue;
    total += v;
    activityCount += 1;
    const c = (by[a.user_id] ??= { userId: a.user_id, value: 0, activities: 0 });
    c.value += v;
    c.activities += 1;
  }
  const people = Object.values(by).sort((x, y) => y.value - x.value);
  const days = Math.max(1, Math.round((Date.parse(def.end + 'T12:00:00') - Date.parse(def.start + 'T12:00:00')) / 86400000) + 1);
  return { ...def, total, activityCount, days, people };
}

/** Days since a challenge ended (0 on its last day, negative while it runs). */
export function daysSinceEnd(end: string, today = new Date()): number {
  const t = Date.parse(dayOf(today.toISOString()) + 'T12:00:00');
  return Math.round((t - Date.parse(end + 'T12:00:00')) / 86400000);
}

export type TeamRecord = { metric: ChallengeMetric; userId: string; value: number; end: string };

/** The most one person added in a single challenge, per type. `year` limits
 *  it to challenges that ended that year. */
export function teamRecords(results: ChallengeResult[], year?: number): TeamRecord[] {
  const best: Partial<Record<ChallengeMetric, TeamRecord>> = {};
  for (const r of results) {
    if (year != null && Number(r.end.slice(0, 4)) !== year) continue;
    const top = r.people[0];
    if (!top) continue;
    const cur = best[r.metric];
    if (!cur || top.value > cur.value) best[r.metric] = { metric: r.metric, userId: top.userId, value: top.value, end: r.end };
  }
  const order: ChallengeMetric[] = ['elevation', 'distance', 'activities', 'duration', 'xp'];
  return order.map((m) => best[m]).filter(Boolean) as TeamRecord[];
}
