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

export type GoalRow = {
  goal_type: 'distance' | 'elevation' | 'gym_sessions';
  activity_filter: string | null;
  start_date: string;
  end_date: string;
};

type ActivityRow = {
  activity_type: string;
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

  if (goal.activity_filter) {
    const group = new Set(ACTIVITY_TYPE_GROUPS[goal.activity_filter] ?? [goal.activity_filter]);
    relevant = relevant.filter((a) => group.has(a.activity_type));
  }

  let progress = 0;
  if (goal.goal_type === 'distance') {
    progress = relevant.reduce((sum, a) => sum + (a.distance_meters || 0), 0) / 1000;
  } else if (goal.goal_type === 'elevation') {
    progress = relevant.reduce((sum, a) => sum + (a.elevation_meters || 0), 0);
  } else if (goal.goal_type === 'gym_sessions') {
    progress = relevant.filter((a) => GYM_TYPES.has(a.activity_type)).length;
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
