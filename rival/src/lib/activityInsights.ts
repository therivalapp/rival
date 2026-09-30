// Per-activity "micro-insight" — a small, earned recognition line shown on each
// activity card ("Longest run in 3 months", "4th swim this week", "Fastest pace
// this year"). Pure RIVAL ethos: recognise progress and showing-up without
// needing likes or comments.
//
// Only ONE insight is returned per activity (the highest-priority one), and many
// activities get none — that's deliberate, so a line always means something.

export type InsightTone = 'record' | 'streak' | 'comeback';
export type ActivityInsight = { text: string; tone: InsightTone };

export type InsightActivity = {
  activity_type: string;
  started_at: string;
  duration_seconds: number;
  distance_meters: number;
  elevation_meters?: number | null;
};

// Round-number distance milestones (km) — crossing one for the first time
// is a bigger deal than a trailing-window record, so it's checked first.
const DISTANCE_MILESTONES_KM = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];

const DISTANCE_SPORTS = new Set([
  'Run', 'Ride', 'Swim', 'Walk', 'Hike', 'Rowing',
  'VirtualRun', 'VirtualRide', 'NordicSki', 'AlpineSki',
  'Kayaking', 'StandUpPaddling', 'Surfing',
]);

// activity_type → the noun used in insight copy.
const TYPE_NOUN: Record<string, string> = {
  Run: 'run', VirtualRun: 'run', Ride: 'ride', VirtualRide: 'ride',
  Swim: 'swim', Rowing: 'row', Walk: 'walk', Hike: 'hike',
  WeightTraining: 'lift', Workout: 'workout', CrossFit: 'CrossFit workout',
  Hyrox: 'Hyrox', HIIT: 'HIIT workout', Bootcamp: 'bootcamp', Yoga: 'yoga practice',
  AlpineSki: 'ski', NordicSki: 'ski',
};

function typeNoun(type: string): string {
  return TYPE_NOUN[type] ?? 'activity';
}

const DAY = 86400000;

function mondayStart(ts: number): number {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * @param activity   the activity to describe
 * @param all        the user's activities (any order); realistically the most
 *                   recent ~100 — enough for the short trailing windows below.
 * @param hasPbBadge whether this activity already shows an all-time PB badge; if
 *                   so we skip the record insight (the badge already says it) and
 *                   fall through to a frequency/comeback line instead.
 */
export function computeActivityInsight(
  activity: InsightActivity,
  all: InsightActivity[],
  hasPbBadge = false,
): ActivityInsight | null {
  const t = new Date(activity.started_at).getTime();
  if (isNaN(t)) return null;

  const sameType = all.filter(a => a.activity_type === activity.activity_type && !isNaN(new Date(a.started_at).getTime()));
  const noun = typeNoun(activity.activity_type);
  const isDistance = DISTANCE_SPORTS.has(activity.activity_type) && (activity.distance_meters || 0) > 0;

  // Prior same-type activities strictly before this one, within `days`.
  const priorWithin = (days: number) => sameType.filter(a => {
    const at = new Date(a.started_at).getTime();
    return at < t && at >= t - days * DAY;
  });

  // 1. A round-number distance milestone crossed for the first time
  //    ("First ride over 40 km") — bigger deal than a trailing-window record,
  //    so it's checked first.
  if (!hasPbBadge && isDistance) {
    const priorEverSameType = sameType.filter(a => new Date(a.started_at).getTime() < t);
    const priorMaxKm = Math.max(0, ...priorEverSameType.map(a => (a.distance_meters || 0) / 1000));
    const currentKm = activity.distance_meters / 1000;
    const crossed = DISTANCE_MILESTONES_KM.filter(km => priorMaxKm < km && currentKm >= km);
    if (priorEverSameType.length > 0 && crossed.length > 0) {
      const km = crossed[crossed.length - 1];
      return { text: `First ${noun} over ${km} km`, tone: 'record' };
    }
  }

  // 2. A sub-PB record inside a trailing window ("Longest run in 3 months").
  //    Skipped when the all-time PB badge is already showing it.
  if (!hasPbBadge) {
    const windows: Array<[number, string]> = [[90, '3 months'], [180, '6 months'], [365, 'a year']];
    for (const [days, label] of windows) {
      const prior = priorWithin(days);
      if (prior.length < 2) continue;
      if (isDistance) {
        if (prior.every(a => (a.distance_meters || 0) < activity.distance_meters)) {
          return { text: `Longest ${noun} in ${label}`, tone: 'record' };
        }
      } else if (activity.duration_seconds > 0) {
        if (prior.every(a => (a.duration_seconds || 0) < activity.duration_seconds)) {
          return { text: `Longest ${noun} in ${label}`, tone: 'record' };
        }
      }
    }

    // 3. Fastest average pace in a window (distance sports with a duration).
    if (isDistance && activity.duration_seconds > 0) {
      const speed = activity.distance_meters / activity.duration_seconds;
      const windowsSpeed: Array<[number, string]> = [[365, 'this year'], [180, '6 months']];
      for (const [days, label] of windowsSpeed) {
        const prior = priorWithin(days).filter(a => a.duration_seconds > 0 && a.distance_meters > 0);
        if (prior.length < 3) continue;
        if (prior.every(a => a.distance_meters / a.duration_seconds < speed)) {
          return { text: `Fastest pace ${label}`, tone: 'record' };
        }
      }
    }

    // 4. Highest elevation gain in a window ("Your highest elevation this month").
    if ((activity.elevation_meters || 0) > 0) {
      const windowsElev: Array<[number, string]> = [[30, 'this month'], [180, '6 months'], [365, 'this year']];
      for (const [days, label] of windowsElev) {
        const prior = priorWithin(days).filter(a => (a.elevation_meters || 0) > 0);
        if (prior.length < 2) continue;
        if (prior.every(a => (a.elevation_meters || 0) < activity.elevation_meters!)) {
          return { text: `Your highest elevation ${label}`, tone: 'record' };
        }
      }
    }
  }

  // 5. Frequency this week ("4th swim this week") — consistency recognition.
  const weekStart = mondayStart(t);
  const sameWeekUpTo = sameType.filter(a => {
    const at = new Date(a.started_at).getTime();
    return mondayStart(at) === weekStart && at <= t;
  }).length;
  if (sameWeekUpTo >= 2) {
    return { text: `${ordinal(sameWeekUpTo)} ${noun} this week`, tone: 'streak' };
  }

  // 6. Frequency this calendar month ("3rd ride this month").
  const d = new Date(t);
  const sameMonthUpTo = sameType.filter(a => {
    const ad = new Date(a.started_at);
    return ad.getFullYear() === d.getFullYear() && ad.getMonth() === d.getMonth() && ad.getTime() <= t;
  }).length;
  if (sameMonthUpTo >= 3) {
    return { text: `${ordinal(sameMonthUpTo)} ${noun} this month`, tone: 'streak' };
  }

  // 7. Comeback — first of this type in a while ("First swim in 6 weeks").
  const priorEver = sameType
    .map(a => new Date(a.started_at).getTime())
    .filter(at => at < t)
    .sort((a, b) => b - a);
  if (priorEver.length > 0) {
    const gapDays = Math.floor((t - priorEver[0]) / DAY);
    if (gapDays >= 28) {
      const weeks = Math.round(gapDays / 7);
      return { text: `First ${noun} in ${weeks} weeks`, tone: 'comeback' };
    }
  }

  return null;
}
