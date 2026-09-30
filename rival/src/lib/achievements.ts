import { LEVELS } from './xp';
export type Achievement = {
  id: string;
  name: string;
  desc: string;
  icon: string;
  category: 'activities' | 'distance' | 'elevation' | 'rank' | 'firsts' | 'league' | 'streak';
};

export const ACHIEVEMENTS: Achievement[] = [
  // First-timers
  { id: 'first_activity',  name: 'First Step',       desc: 'Log your first activity',         icon: '👟', category: 'firsts' },
  { id: 'first_run',       name: 'On The Run',        desc: 'Log your first run',              icon: '🏃', category: 'firsts' },
  { id: 'first_ride',      name: 'On The Bike',       desc: 'Log your first ride',             icon: '🚴', category: 'firsts' },
  { id: 'first_swim',      name: 'In The Deep End',   desc: 'Log your first swim',             icon: '🏊', category: 'firsts' },
  { id: 'first_hike',      name: 'Trail Blazer',      desc: 'Log your first hike',             icon: '🥾', category: 'firsts' },

  // Activity count
  { id: 'activities_10',   name: 'Just Warming Up',   desc: 'Log 10 activities',               icon: '🔟', category: 'activities' },
  { id: 'activities_25',   name: 'In The Zone',       desc: 'Log 25 activities',               icon: '💪', category: 'activities' },
  { id: 'activities_50',   name: 'On Fire',           desc: 'Log 50 activities',               icon: '🔥', category: 'activities' },
  { id: 'activities_100',  name: 'Century',           desc: 'Log 100 activities',              icon: '💯', category: 'activities' },
  { id: 'activities_250',  name: 'Machine',           desc: 'Log 250 activities',              icon: '🤖', category: 'activities' },
  { id: 'activities_500',  name: 'Unstoppable',       desc: 'Log 500 activities',              icon: '⚡', category: 'activities' },

  // Distance
  { id: 'distance_100',    name: '100km Club',        desc: 'Cover 100km total distance',      icon: '🛣️', category: 'distance' },
  { id: 'distance_500',    name: 'Halfway There',     desc: 'Cover 500km total distance',      icon: '🗺️', category: 'distance' },
  { id: 'distance_1000',   name: 'Thousand K',        desc: 'Cover 1,000km total distance',    icon: '🌍', category: 'distance' },
  { id: 'distance_5000',   name: 'Distance Demon',    desc: 'Cover 5,000km total distance',    icon: '🌐', category: 'distance' },

  // Elevation
  { id: 'elevation_1000',  name: 'Hill Climber',      desc: 'Gain 1,000m elevation',           icon: '⛰️', category: 'elevation' },
  { id: 'elevation_8849',  name: 'Everest',           desc: 'Gain 8,849m — one Everest',       icon: '🏔️', category: 'elevation' },
  { id: 'elevation_50000', name: 'Summit Seeker',     desc: 'Gain 50,000m elevation total',    icon: '🌋', category: 'elevation' },

  // Streaks
  { id: 'streak_2',   name: 'Back To Back',    desc: '2 weeks in a row',           icon: '🔥', category: 'streak' },
  { id: 'streak_4',   name: 'Monthly Momentum', desc: '4 weeks in a row',           icon: '📅', category: 'streak' },
  { id: 'streak_8',   name: 'Habit Formed',    desc: '8 weeks in a row',           icon: '💪', category: 'streak' },
  { id: 'streak_12',  name: '3 Month Run',     desc: '12 weeks in a row',          icon: '🏃', category: 'streak' },
  { id: 'streak_26',  name: 'Half Year Hero',  desc: '26 weeks in a row',          icon: '⚡', category: 'streak' },
  { id: 'streak_52',  name: 'Full Year',       desc: '52 weeks in a row',          icon: '🏆', category: 'streak' },

  // Rank milestones
  { id: 'rank_hustler',    name: 'Hustler',           desc: 'Reach Hustler rank',              icon: '🔥', category: 'rank' },
  { id: 'rank_warrior',    name: 'Warrior',           desc: 'Reach Warrior rank',              icon: '⚔️', category: 'rank' },
  { id: 'rank_elite',      name: 'Elite',             desc: 'Reach Elite rank',                icon: '💎', category: 'rank' },
  { id: 'rank_champion',   name: 'Champion',          desc: 'Reach Champion rank',             icon: '🏅', category: 'rank' },
  { id: 'rank_legend',     name: 'Legend',            desc: 'Reach Legend rank',               icon: '👑', category: 'rank' },
  { id: 'rank_mythic',     name: 'Mythic',            desc: 'Reach Mythic rank',               icon: '🌟', category: 'rank' },
  { id: 'rank_immortal',   name: 'Immortal',          desc: 'Reach Immortal rank',             icon: '♾️', category: 'rank' },
  { id: 'rank_god',        name: 'God',               desc: 'Reach God rank',                  icon: '⚡', category: 'rank' },
  { id: 'rank_unrivaled',  name: 'Unrivaled',         desc: 'Reach the pinnacle. Unrivaled.',  icon: '🏆', category: 'rank' },
];

export type ActivityData = {
  activity_type: string;
  distance_meters: number;
  elevation_meters: number;
  effort_score: number;
  started_at?: string;
};

export function checkAchievements(activities: ActivityData[], totalXp: number, longestStreak = 0): string[] {
  const earned: string[] = [];
  const count = activities.length;
  const totalDistance = activities.reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000;
  const totalElevation = activities.reduce((s, a) => s + (a.elevation_meters || 0), 0);
  const types = new Set(activities.map((a) => a.activity_type));

  // Firsts
  if (count >= 1) earned.push('first_activity');
  if (types.has('Run') || types.has('VirtualRun') || types.has('TrailRun')) earned.push('first_run');
  if (types.has('Ride') || types.has('VirtualRide') || types.has('MountainBikeRide') || types.has('GravelRide')) earned.push('first_ride');
  if (types.has('Swim') || types.has('IndoorSwim') || types.has('OpenWaterSwim')) earned.push('first_swim');
  if (types.has('Hike')) earned.push('first_hike');

  // Activity count
  if (count >= 10)  earned.push('activities_10');
  if (count >= 25)  earned.push('activities_25');
  if (count >= 50)  earned.push('activities_50');
  if (count >= 100) earned.push('activities_100');
  if (count >= 250) earned.push('activities_250');
  if (count >= 500) earned.push('activities_500');

  // Distance
  if (totalDistance >= 100)  earned.push('distance_100');
  if (totalDistance >= 500)  earned.push('distance_500');
  if (totalDistance >= 1000) earned.push('distance_1000');
  if (totalDistance >= 5000) earned.push('distance_5000');

  // Elevation
  if (totalElevation >= 1000)  earned.push('elevation_1000');
  if (totalElevation >= 8849)  earned.push('elevation_8849');
  if (totalElevation >= 50000) earned.push('elevation_50000');

  // Streaks
  if (longestStreak >= 2)  earned.push('streak_2');
  if (longestStreak >= 4)  earned.push('streak_4');
  if (longestStreak >= 8)  earned.push('streak_8');
  if (longestStreak >= 12) earned.push('streak_12');
  if (longestStreak >= 26) earned.push('streak_26');
  if (longestStreak >= 52) earned.push('streak_52');

  // Rank
  // From the rank table itself, so the badges can't drift from the ranks.
  for (const lvl of LEVELS) {
    if (lvl.level > 1 && totalXp >= lvl.minXp) earned.push(`rank_${lvl.name.toLowerCase()}`);
  }

  return earned;
}

export const CATEGORY_LABELS: Record<string, string> = {
  firsts:     'First Times',
  streak:     'Consistency Streaks',
  activities: 'Activity Milestones',
  distance:   'Distance',
  elevation:  'Elevation',
  rank:       'Rank',
  league:     'League',
};
