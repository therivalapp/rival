import { getMondayOfWeek, STREAK_MIN_ACTIVITIES } from './streak';
import { LEVELS } from './xp';

// Achievements, one year at a time (Ricky, 2026-11-02; design/achievements-mockup.png, B).
// No Firsts: a first run of the year is just turning up in January (Ricky,
// 2026-11-02), so every achievement here is something worked towards.
// Everything starts again on 1 January. Each one is earned by a real activity,
// the one that crossed the line, which is what its tile shows.

export type YearActivity = {
  id: string;
  name?: string | null;
  activity_type: string;
  started_at: string;
  distance_meters: number | null;
  /** Time earned counts every kind of activity, lifts and yoga included. */
  duration_seconds?: number | null;
  elevation_meters: number | null;
  effort_score: number | null;
  photo_url?: string | null;
  photo_focal_x?: number | null;
  photo_focal_y?: number | null;
};

export type Ladder = 'activities' | 'distance' | 'elevation' | 'time' | 'streak' | 'rank';

export type EarnedAchievement<A extends YearActivity = YearActivity> = {
  key: string;
  ladder: Ladder;
  value: string;
  unit: string;
  label: string;
  activity: A;
};

export type NextAchievement = { key: string; ladder: Ladder; value: string; unit: string; label: string; current: number; target: number; progress: string };

const ACTIVITY_STEPS = [10, 25, 50, 100, 250];
const KM_STEPS = [100, 500, 1000, 2500, 5000];
const ELEVATION_STEPS = [1000, 5000, 8849, 20000, 50000];
// Hours, the one ladder every kind of activity climbs (Ricky, 2026-11-02).
const TIME_STEPS = [25, 50, 100, 250, 500];
const STREAK_STEPS = [4, 8, 12, 26, 52];
// Rookie is where everyone starts, so it isn't one.
const RANKS = LEVELS.filter((l) => l.minXp > 0);

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const elevationLabel = (m: number) => (m === 8849 ? 'One Everest' : 'Elevation');

/** Everything in that year, in the order it was earned, and what comes next. */
export function yearAchievements<A extends YearActivity>(all: A[], year: number): { earned: EarnedAchievement<A>[]; next: NextAchievement[]; total: number } {
  const rows = all
    .filter((a) => new Date(a.started_at).getFullYear() === year)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const earned: EarnedAchievement<A>[] = [];
  let count = 0, km = 0, elevation = 0, effort = 0, hours = 0;
  const weekCounts = new Map<number, number>();
  let streak = 0, bestStreak = 0;
  const qualifiedWeeks = new Set<number>();
  const crossed = (steps: number[], before: number, after: number) => steps.filter((s) => before < s && after >= s);

  for (const a of rows) {
    const was = { count, km, elevation, effort, hours, bestStreak };
    count += 1;
    km += (a.distance_meters || 0) / 1000;
    elevation += a.elevation_meters || 0;
    effort += a.effort_score || 0;
    hours += (a.duration_seconds || 0) / 3600;

    // A week counts once it has STREAK_MIN_ACTIVITIES, as on Today.
    const week = getMondayOfWeek(new Date(a.started_at)).getTime();
    const inWeek = (weekCounts.get(week) ?? 0) + 1;
    weekCounts.set(week, inWeek);
    if (inWeek === STREAK_MIN_ACTIVITIES && !qualifiedWeeks.has(week)) {
      const prev = getMondayOfWeek(new Date(week - 3 * 86_400_000)).getTime();
      streak = qualifiedWeeks.has(prev) ? streak + 1 : 1;
      qualifiedWeeks.add(week);
      bestStreak = Math.max(bestStreak, streak);
    }

    for (const s of crossed(ACTIVITY_STEPS, was.count, count)) earned.push({ key: `activities:${s}`, ladder: 'activities', value: n(s), unit: '', label: 'Activities', activity: a });
    for (const s of crossed(KM_STEPS, was.km, km)) earned.push({ key: `distance:${s}`, ladder: 'distance', value: n(s), unit: 'km', label: 'Distance', activity: a });
    for (const s of crossed(ELEVATION_STEPS, was.elevation, elevation)) earned.push({ key: `elevation:${s}`, ladder: 'elevation', value: n(s), unit: 'm', label: elevationLabel(s), activity: a });
    for (const s of crossed(TIME_STEPS, was.hours, hours)) earned.push({ key: `time:${s}`, ladder: 'time', value: n(s), unit: 'h', label: 'Time earned', activity: a });
    for (const s of crossed(STREAK_STEPS, was.bestStreak, bestStreak)) earned.push({ key: `streak:${s}`, ladder: 'streak', value: String(s), unit: 'wk', label: 'Streak', activity: a });
    for (const r of RANKS.filter((r) => was.effort < r.minXp && effort >= r.minXp)) earned.push({ key: `rank:${r.name}`, ladder: 'rank', value: r.name, unit: '', label: 'Rank', activity: a });
  }

  const next: NextAchievement[] = [];
  const step = (ladder: Ladder, steps: number[], current: number, unit: string, label: (s: number) => string, unitWord: string) => {
    const target = steps.find((s) => s > current);
    if (target) next.push({ key: `${ladder}:${target}`, ladder, value: n(target), unit, label: label(target), current, target, progress: `${n(current)} of ${n(target)}${unitWord}` });
  };
  step('distance', KM_STEPS, km, 'km', () => 'Distance', ' km');
  step('streak', STREAK_STEPS, bestStreak, 'wk', () => 'Streak', ' weeks');
  step('elevation', ELEVATION_STEPS, elevation, 'm', elevationLabel, ' m');
  step('time', TIME_STEPS, hours, 'h', () => 'Time earned', ' hours');
  step('activities', ACTIVITY_STEPS, count, '', () => 'Activities', '');
  const rank = RANKS.find((r) => r.minXp > effort);
  if (rank) next.push({ key: `rank:${rank.name}`, ladder: 'rank', value: rank.name, unit: '', label: 'Rank', current: effort, target: rank.minXp, progress: `${n(effort)} of ${n(rank.minXp)} Effort` });

  const total = TIME_STEPS.length + ACTIVITY_STEPS.length + KM_STEPS.length + ELEVATION_STEPS.length + STREAK_STEPS.length + RANKS.length;
  return { earned, next, total };
}

/** Where an achievement sits on its ladder, for the celebration's steps:
 *  "2 of 5", the step before it (where a count-up starts) and the next one. */
export function ladderPlace(e: Pick<EarnedAchievement, 'ladder' | 'value'>): { step: number; of: number; prev: number; next: string | null } | null {
  const steps: Partial<Record<Ladder, number[]>> = { activities: ACTIVITY_STEPS, distance: KM_STEPS, elevation: ELEVATION_STEPS, time: TIME_STEPS, streak: STREAK_STEPS };
  if (e.ladder === 'rank') {
    const i = RANKS.findIndex((r) => r.name === e.value);
    return i < 0 ? null : { step: i + 1, of: RANKS.length, prev: 0, next: RANKS[i + 1]?.name ?? null };
  }
  const list = steps[e.ladder];
  if (!list) return null;
  const i = list.findIndex((v) => n(v) === e.value);
  if (i < 0) return null;
  const unit = e.ladder === 'distance' ? ' km' : e.ladder === 'elevation' ? ' m' : e.ladder === 'time' ? ' hours' : e.ladder === 'streak' ? ' weeks' : ' activities';
  return { step: i + 1, of: list.length, prev: i > 0 ? list[i - 1] : 0, next: list[i + 1] != null ? `${n(list[i + 1])}${unit}` : null };
}

/** How an achievement reads in a sentence or a title: "500 km", "First swim". */
export function achievementTitle(e: Pick<EarnedAchievement, 'ladder' | 'value' | 'label'>): string {
  switch (e.ladder) {
    case 'activities': return `${e.value} activities`;
    case 'distance': return `${e.value} km`;
    case 'elevation': return e.label === 'One Everest' ? 'One Everest' : `${e.value} m elevation`;
    case 'time': return `${e.value} hours`;
    case 'streak': return `${e.value}-week streak`;
    case 'rank': return `${e.value} rank`;
  }
}

/** What this activity earned in its own year, for the photo pop-ups. */
export function earnedBy<A extends YearActivity>(all: A[], activityId: string): EarnedAchievement<A>[] {
  const a = all.find((r) => r.id === activityId);
  if (!a) return [];
  return yearAchievements(all, new Date(a.started_at).getFullYear()).earned.filter((e) => e.activity.id === activityId);
}
