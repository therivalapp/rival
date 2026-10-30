// Which lifts the quick tiles offer next on Log an activity: lifts that go
// with what's already there, the person's own habits first (Ricky, 2026-10-30).
import { matchCanonicalLift } from './lifts';

type Muscle = 'chest' | 'triceps' | 'shoulders' | 'back' | 'biceps' | 'legs' | 'olympic';

// Each list runs most common first; a lift sits under its main muscle.
const LIFTS_BY_MUSCLE: Record<Muscle, string[]> = {
  chest: ['Bench Press', 'Incline Bench Press', 'Dumbbell Bench Press', 'Incline Dumbbell Press', 'Push-up', 'Pause Bench Press'],
  triceps: ['Dip', 'Tricep Extension', 'Close Grip Bench Press', 'Skullcrusher'],
  shoulders: ['Overhead Press', 'Push Press', 'Strict Press', 'Face Pull'],
  back: ['Pull-up', 'Barbell Row', 'Lat Pulldown', 'Deadlift', 'Cable Row', 'Dumbbell Row', 'Shrug', 'Rack Pull', 'Deficit Deadlift'],
  biceps: ['Bicep Curl', 'Hammer Curl'],
  legs: [
    'Squat', 'Leg Press', 'Lunge', 'Romanian Deadlift', 'Hip Thrust', 'Front Squat', 'Leg Curl', 'Leg Extension', 'Calf Raise',
    'Bulgarian Split Squat', 'Split Squat', 'Box Squat', 'Pause Squat', 'Air Squat', 'Sumo Deadlift', 'Stiff Leg Deadlift', 'Trap Bar Deadlift', 'Good Morning',
  ],
  olympic: [
    'Clean', 'Snatch', 'Clean and Jerk', 'Power Clean', 'Power Snatch', 'Hang Clean', 'Hang Snatch',
    'Jerk', 'Push Jerk', 'Split Jerk', 'Overhead Squat',
  ],
};

// What's usually trained alongside each muscle, closest first.
const TRAINED_WITH: Record<Muscle, Muscle[]> = {
  chest: ['chest', 'triceps', 'shoulders'],
  triceps: ['triceps', 'chest', 'shoulders'],
  shoulders: ['shoulders', 'triceps', 'chest'],
  back: ['back', 'biceps'],
  biceps: ['biceps', 'back'],
  legs: ['legs'],
  olympic: ['olympic'],
};

const MUSCLE_OF = new Map<string, Muscle>(
  (Object.keys(LIFTS_BY_MUSCLE) as Muscle[]).flatMap((m) => LIFTS_BY_MUSCLE[m].map((l) => [l, m] as [string, Muscle])),
);

// Words in an activity's name. Lift names are left out, so a "Push press"
// or "Back squat" doesn't read as a push or back day.
const NAME_FOCUS: [RegExp, Muscle[]][] = [
  [/\b(chest|pecs?)\b/, ['chest', 'triceps', 'shoulders']],
  [/\bpush\b(?![- ]?(press|ups?|jerk))/, ['chest', 'shoulders', 'triceps']],
  [/\bpull\b(?![- ]?ups?)/, ['back', 'biceps']],
  [/\bback\b(?! squat)/, ['back', 'biceps']],
  [/\b(legs?|lower|quads?|hamstrings?|glutes?)\b/, ['legs']],
  [/\bupper\b/, ['chest', 'back', 'shoulders']],
  [/\b(arms?|biceps?|triceps?)\b/, ['biceps', 'triceps']],
  [/\b(shoulders?|delts?)\b/, ['shoulders', 'triceps']],
];

export function focusFromName(name: string): Muscle[] {
  const n = name.toLowerCase();
  return NAME_FOCUS.find(([re]) => re.test(n))?.[1] ?? [];
}

const canonical = (name: string) => matchCanonicalLift(name) || name.trim();
const keyOf = (name: string) => canonical(name).toLowerCase();

/**
 * `mine` is the person's lifts, most used first. `activities` is the lifts of
 * each recent activity, for what they tend to do together. Order: their own
 * pairings, their own lifts for the muscles in play, the usual lifts for those
 * muscles (taking turns, so it isn't four chest lifts), then `mine`, `fallback`.
 */
export function suggestLifts({ mine, activities, added, activityName, fallback, count }: {
  mine: string[];
  activities: string[][];
  added: string[];
  activityName: string;
  fallback: string[];
  count: number;
}): string[] {
  const addedNames = added.filter((n) => n.trim()).map(canonical);
  const addedKeys = new Set(addedNames.map((n) => n.toLowerCase()));

  // Done together at least twice, so one odd day doesn't become a habit.
  const together = new Map<string, { name: string; n: number }>();
  activities.forEach((lifts) => {
    const names = [...new Map(lifts.map((l) => [keyOf(l), canonical(l)])).entries()];
    if (!names.some(([k]) => addedKeys.has(k))) return;
    names.forEach(([k, name]) => {
      if (addedKeys.has(k)) return;
      together.set(k, { name, n: (together.get(k)?.n ?? 0) + 1 });
    });
  });
  const pairings = [...together.values()].filter((v) => v.n >= 2).sort((a, b) => b.n - a.n).map((v) => v.name);

  // The name first, as it says what the day is; then the latest lift back.
  const focus: Muscle[] = [...focusFromName(activityName)];
  [...addedNames].reverse().forEach((n) => {
    const m = MUSCLE_OF.get(n);
    if (m) TRAINED_WITH[m].forEach((t) => { if (!focus.includes(t)) focus.push(t); });
  });

  const ownInFocus = mine.filter((n) => {
    const m = MUSCLE_OF.get(canonical(n));
    return !!m && focus.includes(m);
  });
  const usual: string[] = [];
  const open = focus.map((m) => LIFTS_BY_MUSCLE[m].filter((l) => !addedKeys.has(l.toLowerCase())));
  const longest = Math.max(0, ...open.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    open.forEach((list) => { if (list[i]) usual.push(list[i]); });
  }

  const seen = new Set<string>();
  return [...pairings, ...ownInFocus, ...usual, ...mine, ...fallback].filter((n) => {
    const k = n.toLowerCase();
    if (addedKeys.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, count);
}
