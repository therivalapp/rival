import { celebrated, effortDistance, RUN_TYPES, type BestEffort } from './bestEfforts';
import { liftName, type LiftExercise } from './liftPb';
import { DISTANCE_SPORTS } from './activityPbs';

// The numbers on a person's profile, worked out from their activities. Pure, so
// they can be tested, and shared by every section of the page.

export type ProfileActivity = {
  id: string;
  activity_type: string;
  started_at: string;
  name?: string | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  elevation_meters: number | null;
  effort_score: number | null;
  photo_url?: string | null;
  photo_focal_x?: number | null;
  photo_focal_y?: number | null;
  exercises?: LiftExercise[] | null;
  race_id?: string | null;
};

const byDate = <T extends { started_at: string }>(rows: T[]) =>
  rows.slice().sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

/** One calendar year's totals: the three numbers at the top of the page. */
export function yearTotals(activities: ProfileActivity[], year: number) {
  const rows = activities.filter((a) => new Date(a.started_at).getFullYear() === year);
  return {
    activities: rows.length,
    effort: Math.round(rows.reduce((t, a) => t + (a.effort_score || 0), 0)),
    hours: Math.floor(rows.reduce((t, a) => t + (a.duration_seconds || 0), 0) / 3600),
  };
}

export type ProfileBest = {
  key: string;
  title: string;
  kind: 'time' | 'weight' | 'distance';
  /** Seconds, kilograms or metres. */
  value: number;
  activityId: string;
  date: string;
};

/** The standing best of each kind: fastest times over the set distances,
 *  heaviest lifts, and the farthest of each sport. Newest first. */
export function profileBests(activities: ProfileActivity[], runs: { id: string; activity_type: string; started_at: string; best_efforts?: BestEffort[] | null }[], imperial = false): ProfileBest[] {
  const out = new Map<string, ProfileBest>();

  for (const r of runs) {
    if (!RUN_TYPES.has(r.activity_type)) continue;
    for (const b of r.best_efforts ?? []) {
      if (!b.distance || !b.seconds) continue;
      const d = effortDistance(b.distance);
      if (!d || !celebrated(d.meters, imperial)) continue;
      const key = `time:${d.meters}`;
      const cur = out.get(key);
      if (!cur || b.seconds < cur.value) out.set(key, { key, title: d.label, kind: 'time', value: b.seconds, activityId: r.id, date: r.started_at });
    }
  }

  for (const a of activities) {
    for (const ex of a.exercises ?? []) {
      const lift = liftName(ex);
      const kg = Number(ex.weight);
      if (!lift || !(kg > 0)) continue;
      const key = `lift:${lift}`;
      const cur = out.get(key);
      if (!cur || kg > cur.value) out.set(key, { key, title: lift, kind: 'weight', value: kg, activityId: a.id, date: a.started_at });
    }
    const m = a.distance_meters || 0;
    if (DISTANCE_SPORTS.has(a.activity_type) && m > 0) {
      const key = `far:${a.activity_type}`;
      const cur = out.get(key);
      if (!cur || m > cur.value) out.set(key, { key, title: `Farthest ${a.activity_type}`, kind: 'distance', value: m, activityId: a.id, date: a.started_at });
    }
  }

  return [...out.values()].sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
}

export type MilestoneKind = 'activities' | 'km' | 'elevation' | 'hours';

const LADDERS: Record<MilestoneKind, number[]> = {
  activities: [10, 25, 50, 100, 250, 500, 1000, 2500],
  km: [100, 500, 1000, 5000, 10000],
  elevation: [1000, 8849, 50000, 100000],
  hours: [100, 500, 1000, 5000],
};

export type Milestone = {
  key: string;
  kind: MilestoneKind;
  target: number;
  /** The activity that reached it, for its photo and to open it. */
  activity: ProfileActivity;
};

export function milestoneWords(kind: MilestoneKind): string {
  return kind === 'activities' ? 'activities' : kind === 'km' ? 'km' : kind === 'elevation' ? 'metres climbed' : 'hours';
}

export type NextMilestone = { key: string; kind: MilestoneKind; target: number; current: number };

/** Every milestone reached, newest first, each with the activity that crossed
 *  it, plus the unreached one closest to done. */
export function profileMilestones(activities: ProfileActivity[]): { earned: Milestone[]; next: NextMilestone | null } {
  const totals: Record<MilestoneKind, number> = { activities: 0, km: 0, elevation: 0, hours: 0 };
  const earned: Milestone[] = [];
  const reached = (kind: MilestoneKind) => LADDERS[kind].filter((t) => t <= totals[kind]).length;

  for (const a of byDate(activities)) {
    const before = { activities: reached('activities'), km: reached('km'), elevation: reached('elevation'), hours: reached('hours') };
    totals.activities += 1;
    totals.km += (a.distance_meters || 0) / 1000;
    totals.elevation += a.elevation_meters || 0;
    totals.hours += (a.duration_seconds || 0) / 3600;
    for (const kind of Object.keys(LADDERS) as MilestoneKind[]) {
      const now = reached(kind);
      for (let i = before[kind]; i < now; i++) {
        const target = LADDERS[kind][i];
        earned.push({ key: `${kind}:${target}`, kind, target, activity: a });
      }
    }
  }

  let next: NextMilestone | null = null;
  let closest = -1;
  for (const kind of Object.keys(LADDERS) as MilestoneKind[]) {
    const target = LADDERS[kind].find((t) => t > totals[kind]);
    if (!target) continue;
    const pct = totals[kind] / target;
    if (pct > closest) { closest = pct; next = { key: `${kind}:${target}`, kind, target, current: Math.floor(totals[kind]) }; }
  }
  return { earned: earned.reverse(), next };
}

/** Each month from the first activity to now, oldest first. */
export function monthsSince(firstIso: string | null, now = new Date()): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  const first = firstIso ? new Date(firstIso) : now;
  const d = new Date(first.getFullYear(), first.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  while (d.getTime() <= end.getTime()) {
    out.push({ year: d.getFullYear(), month: d.getMonth() });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/** The activities of each day of a month, by day number, oldest first. */
export function monthDays(activities: ProfileActivity[], year: number, month: number): Map<number, ProfileActivity[]> {
  const out = new Map<number, ProfileActivity[]>();
  for (const a of byDate(activities)) {
    const d = new Date(a.started_at);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    if (!out.has(d.getDate())) out.set(d.getDate(), []);
    out.get(d.getDate())!.push(a);
  }
  return out;
}
