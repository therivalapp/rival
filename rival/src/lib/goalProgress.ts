// Shared goal-progress computation — used by the Goals screen and the Home
// dashboard's featured-goal card. Extracted from goals.tsx so the dashboard
// doesn't fork the math (same rule as effort.ts / activityIcons.ts).

export const GYM_TYPES = new Set(['WeightTraining', 'CrossFit', 'Hyrox', 'HIIT', 'Bootcamp', 'Workout']);

// Groups indoor + outdoor variants of the same sport together
export const ACTIVITY_TYPE_GROUPS: Record<string, string[]> = {
  Run:  ['Run', 'VirtualRun', 'TrailRun'],
  Ride: ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'Handcycle'],
  Swim: ['Swim', 'IndoorSwim', 'OpenWaterSwim'],
  Walk: ['Walk'],
  Hike: ['Hike'],
};

// Every activity type a goal can be set for, with its display name. The first
// few are the quick picks; the rest sit behind "More". `distance` marks types
// that record a distance (for Distance and Elevation goals).
export const GOAL_ACTIVITY_TYPES: { value: string; label: string; distance: boolean }[] = [
  { value: 'Run', label: 'Run', distance: true },
  { value: 'Ride', label: 'Ride', distance: true },
  { value: 'Swim', label: 'Swim', distance: true },
  { value: 'Walk', label: 'Walk', distance: true },
  { value: 'Hike', label: 'Hike', distance: true },
  { value: 'Gym', label: 'Gym', distance: false },
  { value: 'TrailRun', label: 'Trail run', distance: true },
  { value: 'MountainBikeRide', label: 'Mountain bike', distance: true },
  { value: 'GravelRide', label: 'Gravel ride', distance: true },
  { value: 'VirtualRide', label: 'Indoor ride', distance: true },
  { value: 'VirtualRun', label: 'Treadmill run', distance: true },
  { value: 'Rowing', label: 'Rowing', distance: true },
  { value: 'Kayaking', label: 'Kayaking', distance: true },
  { value: 'Canoeing', label: 'Canoeing', distance: true },
  { value: 'StandUpPaddling', label: 'Stand up paddling', distance: true },
  { value: 'Surfing', label: 'Surfing', distance: false },
  { value: 'AlpineSki', label: 'Alpine ski', distance: true },
  { value: 'BackcountrySki', label: 'Backcountry ski', distance: true },
  { value: 'NordicSki', label: 'Nordic ski', distance: true },
  { value: 'Snowboard', label: 'Snowboard', distance: true },
  { value: 'InlineSkate', label: 'Inline skate', distance: true },
  { value: 'IceSkate', label: 'Ice skate', distance: true },
  { value: 'RockClimbing', label: 'Rock climbing', distance: false },
  { value: 'WeightTraining', label: 'Weight training', distance: false },
  { value: 'CrossFit', label: 'CrossFit', distance: false },
  { value: 'Hyrox', label: 'Hyrox', distance: false },
  { value: 'HIIT', label: 'HIIT', distance: false },
  { value: 'Yoga', label: 'Yoga', distance: false },
  { value: 'Pilates', label: 'Pilates', distance: false },
  { value: 'Elliptical', label: 'Elliptical', distance: false },
  { value: 'StairStepper', label: 'Stair stepper', distance: false },
  { value: 'Golf', label: 'Golf', distance: false },
  { value: 'Tennis', label: 'Tennis', distance: false },
  { value: 'Soccer', label: 'Football', distance: false },
  { value: 'Workout', label: 'Workout', distance: false },
];

// An Activities goal (goal_type 'gym_sessions') counts activities. Its
// activity_filter: 'All' = every activity, a type or group = those, any other
// text = a custom activity (matched by type or by activity name). Null is how
// goals made before this change were stored, when the type only counted gym
// activities, so null still means gym.
export const ALL_ACTIVITIES = 'All';

export function goalActivityLabel(goal: { goal_type: string; activity_filter: string | null }): string {
  const f = goal.activity_filter;
  if (goal.goal_type === 'gym_sessions') {
    if (!f || f === 'Gym') return 'Gym activities';
    if (f === ALL_ACTIVITIES) return 'All activities';
  } else if (!f) return 'All activities';
  return GOAL_ACTIVITY_TYPES.find((t) => t.value === f)?.label ?? f!;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function matchesFilter(goal: GoalRow, a: ActivityRow): boolean {
  const f = goal.activity_filter ?? (goal.goal_type === 'gym_sessions' ? 'Gym' : null);
  if (!f || f === ALL_ACTIVITIES) return true;
  if (f === 'Gym') return GYM_TYPES.has(a.activity_type);
  if (ACTIVITY_TYPE_GROUPS[f]) return ACTIVITY_TYPE_GROUPS[f].includes(a.activity_type);
  if (norm(a.activity_type) === norm(f)) return true;
  // A custom activity also matches by the activity's own name ("Padel").
  return !GOAL_ACTIVITY_TYPES.some((t) => t.value === f) && !!a.name && a.name.toLowerCase().includes(f.toLowerCase());
}

export type GoalRow = {
  goal_type: 'distance' | 'elevation' | 'gym_sessions';
  activity_filter: string | null;
  start_date: string;
  end_date: string;
};

type ActivityRow = {
  activity_type: string;
  name?: string | null;
  distance_meters: number | null;
  elevation_meters: number | null;
  started_at: string;
};

export function computeGoalProgress(goal: GoalRow, activities: ActivityRow[]): number {
  const start = new Date(goal.start_date);
  const end = new Date(goal.end_date);
  end.setHours(23, 59, 59, 999);

  let relevant = activities.filter((a) => {
    const d = new Date(a.started_at);
    return d >= start && d <= end;
  });

  relevant = relevant.filter((a) => matchesFilter(goal, a));

  let progress = 0;
  if (goal.goal_type === 'distance') {
    progress = relevant.reduce((sum, a) => sum + (a.distance_meters || 0), 0) / 1000;
  } else if (goal.goal_type === 'elevation') {
    progress = relevant.reduce((sum, a) => sum + (a.elevation_meters || 0), 0);
  } else if (goal.goal_type === 'gym_sessions') {
    progress = relevant.length;
  }

  return Math.round(progress * 10) / 10;
}

export function goalUnit(goalType: GoalRow['goal_type']): string {
  return goalType === 'distance' ? 'km' : goalType === 'elevation' ? 'm' : 'activities';
}

export function goalTitle(goal: GoalRow): string {
  const scope = goal.activity_filter ?? 'All activities';
  if (goal.goal_type === 'distance') return `${scope} · Distance`;
  if (goal.goal_type === 'elevation') return `${scope} · Elevation`;
  return 'Gym activities';
}

/** The activities that counted toward a goal, newest first, each with the
 *  amount it added (km, metres, or 1 for a gym activity). */
export function goalContributions(goal: GoalRow, activities: ActivityRow[]): { startedAt: string; amount: number }[] {
  const start = new Date(goal.start_date);
  const end = new Date(goal.end_date);
  end.setHours(23, 59, 59, 999);
  return activities
    .filter((a) => {
      const d = new Date(a.started_at);
      return d >= start && d <= end && matchesFilter(goal, a);
    })
    .map((a) => ({
      startedAt: a.started_at,
      amount: goal.goal_type === 'distance' ? (a.distance_meters || 0) / 1000
        : goal.goal_type === 'elevation' ? (a.elevation_meters || 0) : 1,
    }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
