// Single source of truth for activity-type → emoji icons. This map was
// previously copy-pasted into 5 screens and had already drifted: plan/league
// had the ski + virtual types, home/my-activities/recap didn't — so an
// AlpineSki activity rendered ⛷️ in Plan but the generic 🏅 on Home.
// (Emoji are a stand-in until a real icon set is adopted for the redesign —
// swap them here, once, when that happens.)

export const ACTIVITY_ICONS: Record<string, string> = {
  Run: '🏃', Ride: '🚴', Swim: '🏊', WeightTraining: '🏋️',
  Workout: '💪', Hike: '🥾', Walk: '🚶', Yoga: '🧘',
  CrossFit: '🤸', Calisthenics: '🤸', Gymnastics: '🤸', Rowing: '🚣', Hyrox: '🔥', HIIT: '⚡',
  AlpineSki: '⛷️', NordicSki: '🎿', VirtualRide: '🚴', VirtualRun: '🏃',
};

export function activityIcon(type: string | null | undefined): string {
  return ACTIVITY_ICONS[type ?? ''] ?? '🏅';
}
