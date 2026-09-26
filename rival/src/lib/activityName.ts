// A name for an activity nobody named, the way Strava does it: the time of
// day it started plus the activity, "Morning Run", "Evening Weight Training".
// Used wherever an activity is saved, so a blank name never blocks saving.

const NOUN: Record<string, string> = {
  Rowing: 'Row',
  WeightTraining: 'Weight Training',
};

export function partOfDay(at: Date): string {
  const h = at.getHours();
  if (h < 5) return 'Night';
  if (h < 11) return 'Morning';
  if (h < 14) return 'Lunch';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Night';
}

export function defaultActivityName(type: string | null | undefined, at: Date): string {
  const t = type || 'Activity';
  const noun = NOUN[t] ?? t.replace(/([a-z])([A-Z])/g, '$1 $2');
  return `${partOfDay(at)} ${noun}`;
}
