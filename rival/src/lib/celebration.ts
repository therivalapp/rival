import { parseTime } from './time';
import { activityPbs, DISTANCE_SPORTS, type PbActivity } from './activityPbs';
import { tileLabel } from './activityTypes';
import { formatRaceName } from './identity';
import { liveClock } from './liveActivity';
import { distanceUnit, toDisplayDistance, toDisplayWeight, weightUnit } from './units';
import { MILESTONE_LADDERS, profileMilestones, type Milestone } from './profilePage';
import { earnedBy, ladderPlace, type EarnedAchievement, type Ladder, type YearActivity } from './yearAchievements';

// The full-screen celebration for an activity that finished an event, set a
// personal best or earned a milestone or one of the year's achievements
// (Ricky, 2026-11-02, mock B: design/achievement-celebration-mockup.png and
// design/event-celebration-mockup.png). One screen per activity: the biggest
// moment leads and the rest are tiles under it.

export type CelebrationActivity = YearActivity & PbActivity & { race_id?: string | null };

export type CelebrationRace = {
  id: string;
  name: string;
  race_date: string | null;
  distance_km: number | null;
  goal_finish_time: string | null;
  actual_finish_time: string | null;
  disciplines: { name: string; distance_km?: number }[] | null;
};

/** One thing it also earned, as a tile: a milestone, a PB or an achievement. */
export type AlsoTile = { kind: 'milestone' | 'pb' | 'achievement'; icon: string; value: string; label: string };

export type Celebration = {
  kind: 'achievement' | 'pb' | 'milestone' | 'event';
  kicker: string;
  /** The number as it finally reads ("500", "21.4", "First", "Elite"). */
  big: string;
  /** Distance and elevation count up from here to `countTo`. */
  countFrom?: number;
  countTo?: number;
  decimals?: number;
  unit?: string;
  title: string;
  /** A personal best: how much better, and what it beat. */
  delta?: string;
  was?: string;
  steps?: { done: number; of: number; next: string | null };
  /** An event: the word under the time, the goal pill, and each leg. */
  cap?: string;
  pill?: string;
  legs?: { icon: string; time: string; label: string }[];
  also: AlsoTile[];
};

// Which achievement leads when one activity earned several.
const LEAD: Ladder[] = ['rank', 'elevation', 'distance', 'time', 'streak', 'activities'];

const METRE_SPORTS = new Set(['Swim', 'Rowing']);
const fmt = (v: number, decimals = 0) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function fromAchievement(e: EarnedAchievement, also: AlsoTile[]): Celebration {
  const year = new Date(e.activity.started_at).getFullYear();
  const place = ladderPlace(e);
  const target = Number(e.value.replace(/,/g, ''));
  const counts = e.ladder === 'distance' || e.ladder === 'elevation';
  const titles: Record<Ladder, string> = {
    activities: 'Activities', distance: 'Distance',
    elevation: e.label === 'One Everest' ? 'One Everest' : 'Elevation', time: 'Time earned', streak: 'Streak', rank: 'Rank',
  };
  return {
    kind: 'achievement',
    kicker: 'Achievement earned',
    big: e.value,
    ...(counts ? { countFrom: place?.prev ?? 0, countTo: target } : {}),
    unit: e.ladder === 'distance' ? 'km' : e.ladder === 'elevation' ? 'm' : e.ladder === 'time' ? 'hours' : e.ladder === 'streak' ? 'weeks' : undefined,
    title: `${titles[e.ladder]}, ${year}`,
    steps: place ? { done: place.step, of: place.of, next: place.next } : undefined,
    also,
  };
}

// Lifetime milestones (Profile's Milestones), the rarest of the three.
const MILESTONE_LEAD: Milestone['kind'][] = ['hours', 'elevation', 'km', 'activities'];
const MILESTONE_UNIT: Record<Milestone['kind'], string | undefined> = { activities: undefined, km: 'km', elevation: 'm', hours: 'hours' };
const MILESTONE_TITLE: Record<Milestone['kind'], string> = { activities: 'Activities', km: 'Distance', elevation: 'Elevation', hours: 'Time earned' };

function fromMilestone(m: Milestone, also: AlsoTile[]): Celebration {
  const ladder = MILESTONE_LADDERS[m.kind];
  const i = ladder.indexOf(m.target);
  const counts = m.kind === 'km' || m.kind === 'elevation';
  const next = ladder[i + 1];
  const unit = MILESTONE_UNIT[m.kind];
  return {
    kind: 'milestone',
    kicker: 'Milestone',
    big: fmt(m.target),
    ...(counts ? { countFrom: i > 0 ? ladder[i - 1] : 0, countTo: m.target } : {}),
    unit,
    title: m.target === 8849 && m.kind === 'elevation' ? 'One Everest, all time' : `${MILESTONE_TITLE[m.kind]}, all time`,
    steps: { done: i + 1, of: ladder.length, next: next != null ? `${fmt(next)}${unit ? ` ${unit}` : ' activities'}` : null },
    also,
  };
}

function fromPb(a: CelebrationActivity, prev: number | undefined, lift: { lift: string; weightKg: number; prevKg: number | null } | undefined, also: AlsoTile[]): Celebration {
  const type = tileLabel(a.activity_type);
  if (lift) {
    const unit = weightUnit();
    const now = Math.round(toDisplayWeight(lift.weightKg));
    const before = lift.prevKg != null ? Math.round(toDisplayWeight(lift.prevKg)) : null;
    return {
      kind: 'pb', kicker: `Personal best · ${lift.lift}`, big: fmt(now), unit, title: `Heaviest ${lift.lift.toLowerCase()}.`,
      delta: before != null && now > before ? `${fmt(now - before)} ${unit} heavier` : undefined,
      was: before != null ? `Previous best ${fmt(before)} ${unit}` : undefined, also,
    };
  }
  // Swims and rows read in metres everywhere else in the app.
  if (METRE_SPORTS.has(a.activity_type)) {
    const now = Math.round(a.distance_meters || 0);
    return {
      kind: 'pb', kicker: `Personal best · ${type}`, big: fmt(now), countFrom: prev ?? 0, countTo: now, unit: 'm',
      title: `Farthest ${type.toLowerCase()}.`,
      delta: prev != null ? `${fmt(now - prev)} m farther` : undefined,
      was: prev != null ? `Previous best ${fmt(prev)} m` : undefined, also,
    };
  }
  if (DISTANCE_SPORTS.has(a.activity_type)) {
    const unit = distanceUnit();
    const now = toDisplayDistance((a.distance_meters || 0) / 1000);
    const before = prev != null ? toDisplayDistance(prev / 1000) : null;
    return {
      kind: 'pb', kicker: `Personal best · ${type}`, big: fmt(now, 1), countFrom: before ?? 0, countTo: now, decimals: 1, unit,
      title: `Farthest ${type.toLowerCase()}.`,
      delta: before != null ? `${fmt(now - before, 1)} ${unit} farther` : undefined,
      was: before != null ? `Previous best ${fmt(before, 1)} ${unit}` : undefined, also,
    };
  }
  const secs = a.duration_seconds || 0;
  const mins = prev != null ? Math.round((secs - prev) / 60) : null;
  return {
    kind: 'pb', kicker: `Personal best · ${type}`, big: liveClock(secs), title: `Longest ${type.toLowerCase()}.`,
    delta: mins != null && mins > 0 ? `${mins} ${mins === 1 ? 'minute' : 'minutes'} longer` : undefined,
    was: prev != null ? `Previous best ${liveClock(prev)}` : undefined, also,
  };
}

const ACHIEVEMENT_ICON: Record<Ladder, string> = { activities: 'checkCircle', distance: 'distance', elevation: 'elevation', time: 'timer', streak: 'fire', rank: 'crown' };

function achievementTile(e: EarnedAchievement): AlsoTile {
  const year = new Date(e.activity.started_at).getFullYear();
  const unit = e.ladder === 'distance' ? ' km' : e.ladder === 'elevation' ? ' m' : e.ladder === 'time' ? ' h' : e.ladder === 'streak' ? ' wk' : '';
  const label = e.ladder === 'activities' ? `Activities, ${year}` : e.ladder === 'streak' ? `Streak, ${year}` : e.ladder === 'rank' ? `Rank, ${year}` : String(year);
  return { kind: 'achievement', icon: ACHIEVEMENT_ICON[e.ladder], value: `${e.value}${unit}`, label };
}

function milestoneTile(m: Milestone): AlsoTile {
  const unit = m.kind === 'km' ? ' km' : m.kind === 'elevation' ? ' m' : m.kind === 'hours' ? ' h' : '';
  return { kind: 'milestone', icon: 'trophy', value: `${fmt(m.target)}${unit}`, label: m.kind === 'activities' ? 'Activities, all time' : 'All time' };
}

function pbTile(a: CelebrationActivity, lift: { lift: string; weightKg: number } | undefined): AlsoTile {
  if (lift) return { kind: 'pb', icon: 'medal', value: `${fmt(Math.round(toDisplayWeight(lift.weightKg)))} ${weightUnit()}`, label: `Heaviest ${lift.lift}` };
  if (METRE_SPORTS.has(a.activity_type)) return { kind: 'pb', icon: 'medal', value: `${fmt(Math.round(a.distance_meters || 0))} m`, label: 'Farthest' };
  if (DISTANCE_SPORTS.has(a.activity_type)) return { kind: 'pb', icon: 'medal', value: `${fmt(toDisplayDistance((a.distance_meters || 0) / 1000), 1)} ${distanceUnit()}`, label: 'Farthest' };
  return { kind: 'pb', icon: 'medal', value: liveClock(a.duration_seconds || 0), label: 'Longest' };
}

/** "06:00:00" or "3:30" (h:mm[:ss]) as seconds; null when it isn't one. */
/** A saved finish or goal time as seconds; the one reader (lib/time.ts). */
export function parseFinishTime(t: string | null | undefined): number | null {
  return parseTime(t, 'hours');
}

// "3:30" for a whole-minute goal, "3:30:15" otherwise.
const goalLabel = (secs: number) => (secs % 60 === 0 ? `${Math.floor(secs / 3600)}:${String(Math.floor(secs % 3600 / 60)).padStart(2, '0')}` : liveClock(secs));

function fromEvent(race: CelebrationRace, legs: CelebrationActivity[], also: AlsoTile[]): Celebration {
  const total = parseFinishTime(race.actual_finish_time) ?? legs.reduce((t, l) => t + (l.duration_seconds || 0), 0);
  const goal = parseFinishTime(race.goal_finish_time);
  const multi = legs.length > 1;
  const ordered = [...legs].sort((x, y) => x.started_at.localeCompare(y.started_at));
  const date = race.race_date ?? ordered[0]?.started_at;
  const when = date ? new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : '';
  const distance = race.distance_km ? `${fmt(toDisplayDistance(race.distance_km), race.distance_km % 1 ? 1 : 0)} ${distanceUnit()}` : null;
  return {
    kind: 'event',
    kicker: 'Event finished',
    big: liveClock(total),
    cap: multi ? 'Total time' : 'Finish time',
    // Only a goal beaten is mentioned; otherwise the finish is the thing.
    pill: goal != null && total > 0 && total < goal ? `Beat the ${goalLabel(goal)} goal by ${liveClock(goal - total)}` : 'Finisher',
    title: `${formatRaceName(race.name)}.`,
    // The date and distance; the screen adds nothing else under the title.
    was: [distance, when].filter(Boolean).join(', '),
    legs: multi ? ordered.map((l, i) => ({
      icon: l.activity_type,
      time: liveClock(l.duration_seconds || 0),
      label: (race.disciplines?.[i]?.name ?? tileLabel(l.activity_type)),
    })) : undefined,
    also,
  };
}

/** What this activity is celebrated for, or null when it set nothing. `race`
 *  is the event it is linked to, if any. */
export function celebrationFor(all: CelebrationActivity[], activityId: string, userId: string, race?: CelebrationRace | null): Celebration | null {
  const a = all.find((r) => r.id === activityId);
  if (!a) return null;
  const earned = earnedBy(all, activityId).sort((x, y) => LEAD.indexOf(x.ladder) - LEAD.indexOf(y.ladder));
  const { pbs, prev, lifts } = activityPbs(all, userId);
  const milestones = profileMilestones(all).earned.filter((m) => m.activity.id === activityId)
    .sort((x, y) => MILESTONE_LEAD.indexOf(x.kind) - MILESTONE_LEAD.indexOf(y.kind));
  const pb = pbs[activityId] ? [pbTile(a, lifts[activityId])] : [];
  const mTiles = milestones.map(milestoneTile);
  const aTiles = earned.map(achievementTile);

  // Finishing an event leads everything. A multisport event waits for its
  // last leg, so it is celebrated once, with every leg.
  if (race && a.race_id === race.id) {
    const legs = all.filter((r) => r.race_id === race.id);
    const needed = race.disciplines?.length ?? 1;
    if (legs.length >= needed) return fromEvent(race, legs, [...mTiles, ...pb, ...aTiles]);
  }
  // A lifetime milestone leads, then a personal best (this person against
  // their own past), then the year's achievements.
  if (milestones.length) return fromMilestone(milestones[0], [...mTiles.slice(1), ...pb, ...aTiles]);
  if (pbs[activityId]) return fromPb(a, prev[activityId], lifts[activityId], aTiles);
  if (earned.length) return fromAchievement(earned[0], aTiles.slice(1));
  return null;
}
