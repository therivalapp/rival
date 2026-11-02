// Every activity type a person can pick, in the groups shown wherever the
// full list appears (Log an activity, Choose activities), and the short
// label each tile uses.

export const TYPE_GROUPS: [string, string[]][] = [
  ['Run and walk', ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike', 'TrackAndField']],
  ['Ride', ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide', 'Handcycle', 'Velomobile']],
  ['Gym and classes', ['WeightTraining', 'Calisthenics', 'Gymnastics', 'Workout', 'CrossFit', 'Hyrox', 'HIIT', 'Bootcamp', 'Yoga', 'Pilates', 'Elliptical', 'StairStepper', 'VirtualRow']],
  ['Water', ['Swim', 'Rowing', 'Kayaking', 'Canoeing', 'StandUpPaddling', 'Surfing', 'Kitesurf', 'Windsurf', 'Sail']],
  ['Racket sports', ['Tennis', 'Squash', 'Pickleball', 'Badminton', 'TableTennis', 'Racquetball']],
  ['Team sports', ['Basketball', 'Football', 'Soccer', 'Rugby', 'Cricket', 'Volleyball', 'Handball', 'FieldHockey', 'IceHockey', 'Lacrosse', 'Frisbee']],
  ['Winter', ['AlpineSki', 'BackcountrySki', 'NordicSki', 'Snowboard', 'Snowshoe', 'IceSkate']],
  ['Other', ['Golf', 'MartialArts', 'Fencing', 'RockClimbing', 'InlineSkate', 'RollerSki', 'Skateboard', 'Wheelchair']],
];

const TILE_NAMES: Record<string, string> = {
  WeightTraining: 'Weights', Hyrox: 'HYROX', TrailRun: 'Trail run', HIIT: 'HIIT', CrossFit: 'CrossFit', VirtualRun: 'Treadmill', VirtualRide: 'Indoor ride',
  VirtualRow: 'Indoor row', MountainBikeRide: 'Mountain bike', EBikeRide: 'E-bike', EMountainBikeRide: 'E-MTB', StandUpPaddling: 'Paddle board',
  BackcountrySki: 'Ski touring', Sail: 'Sailing', TrackAndField: 'Track and field',
};

export function tileLabel(t: string): string {
  if (TILE_NAMES[t]) return TILE_NAMES[t];
  const words = t.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
