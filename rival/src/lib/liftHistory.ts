import { matchCanonicalLift } from './lifts';

// Logging lifts quicker (Ricky, 2026-10-24, mockup approved):
// - last time's sets, reps and weight for a lift, shown faded;
// - your best for a lift, so a percentage turns into a weight to load;
// - the workouts worth repeating today, from past activities and saved ones.
// Pure functions over what the app already has, so they are tested here.

/** One lift as an activity stores it; weight in kg. */
export type LiftLine = { name: string; sets?: number; reps?: number; weight?: number; pct?: number };

/** A past activity with lifts, as read for this. */
export type LiftActivity = { id: string; startedAt: string; activityType: string; exercises: LiftLine[] };

/** A named workout (saved_workouts.sql). */
export type SavedWorkout = { id: string; name: string; activityType: string | null; exercises: LiftLine[]; lastUsedAt: string; usualDay?: number | null };

/** The same lift whatever it was typed as: the canonical name, else the words. */
export function liftKey(name: string): string {
  return (matchCanonicalLift(name) ?? name).trim().toLowerCase();
}

/** The most recent time this lift had any numbers, before `beforeMs`. */
export function lastTimeFor(history: LiftActivity[], name: string, beforeMs = Infinity): (LiftLine & { at: string }) | null {
  const key = liftKey(name);
  if (!key) return null;
  let best: (LiftLine & { at: string }) | null = null;
  for (const a of history) {
    const t = new Date(a.startedAt).getTime();
    if (!(t < beforeMs)) continue;
    if (best && t <= new Date(best.at).getTime()) continue;
    const line = a.exercises.find((e) => e?.name && liftKey(e.name) === key && (e.sets || e.reps || e.weight));
    if (line) best = { ...line, at: a.startedAt };
  }
  return best;
}

/** One logged lift, for working out a best: weight in kg. */
export type LiftEntry = { name: string; weightKg: number; reps?: number | null; at: string };

/**
 * Your best for a lift: a single at the heaviest weight, or, when only sets
 * of several reps are logged, an estimate (Epley: weight × (1 + reps / 30)).
 * A heavy single always wins over an estimate of the same size or less.
 */
export function bestFor(entries: LiftEntry[], name: string): { kg: number; from: LiftEntry; estimated: boolean } | null {
  const key = liftKey(name);
  let out: { kg: number; from: LiftEntry; estimated: boolean } | null = null;
  for (const e of entries) {
    if (!e.weightKg || e.weightKg <= 0 || liftKey(e.name) !== key) continue;
    const reps = e.reps && e.reps > 1 ? Math.min(e.reps, 12) : 1;
    const kg = reps > 1 ? e.weightKg * (1 + reps / 30) : e.weightKg;
    if (!out || kg > out.kg + 1e-9 || (Math.abs(kg - out.kg) < 1e-9 && reps === 1 && out.estimated)) {
      out = { kg, from: e, estimated: reps > 1 };
    }
  }
  return out;
}

const KG_PER_LB = 0.453592;

/** A percentage of a best, as a weight you can put on the bar: to 2.5 kg, or 5 lb. In kg. */
export function percentWeight(bestKg: number, pct: number, unit: 'kg' | 'lb'): number {
  const kg = (bestKg * pct) / 100;
  if (unit === 'lb') return (Math.round(kg / KG_PER_LB / 5) * 5) * KG_PER_LB;
  return Math.round(kg / 2.5) * 2.5;
}

export type RepeatOption = { key: string; title: string; detail: string; exercises: LiftLine[]; savedId?: string };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const signature = (ex: LiftLine[]) => ex.map((e) => liftKey(e.name)).filter(Boolean).join('|');
const names = (ex: LiftLine[]) => ex.map((e) => e.name).filter(Boolean).join(', ');
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * What to offer under "Repeat a workout", most likely first, at most `max`:
 * the workout from the same weekday within the last three weeks ("Same as
 * last Friday"), saved workouts whose usual day is today, other saved
 * workouts (latest used first), then other recent workouts. Anything done
 * today or yesterday goes last: a routine is rarely repeated the next day
 * (Ricky, 2026-10-28). The same set of lifts is offered once.
 */
export function repeatOptions(history: LiftActivity[], saved: SavedWorkout[], now: Date, max = 3): RepeatOption[] {
  const all: (RepeatOption & { at: string })[] = [];
  const recent = history
    .filter((a) => a.exercises.some((e) => e?.name?.trim()) && new Date(a.startedAt).getTime() < now.getTime())
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const day = now.getDay();
  const weekAgo = recent.find((a) => {
    const d = new Date(a.startedAt);
    return d.getDay() === day && now.getTime() - d.getTime() <= 21 * 86400000 && now.toDateString() !== d.toDateString();
  });
  if (weekAgo) all.push({ key: `a${weekAgo.id}`, title: `Same as last ${WEEKDAYS[day]}`, detail: `${names(weekAgo.exercises)} · ${shortDate(weekAgo.startedAt)}`, exercises: weekAgo.exercises, at: weekAgo.startedAt });
  [...saved]
    .sort((a, b) => ((b.usualDay === day ? 1 : 0) - (a.usualDay === day ? 1 : 0)) || new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())
    .forEach((s) => all.push({ key: `s${s.id}`, title: s.name, detail: names(s.exercises), exercises: s.exercises, savedId: s.id, at: s.lastUsedAt }));
  recent.forEach((a) => all.push({ key: `a${a.id}`, title: shortDate(a.startedAt), detail: names(a.exercises), exercises: a.exercises, at: a.startedAt }));

  const yesterday = startOfDay(now) - 86_400_000;
  const fresh = (o: { at: string }) => new Date(o.at).getTime() >= yesterday;
  const out: RepeatOption[] = [];
  const seen = new Set<string>();
  [...all.filter((o) => !fresh(o)), ...all.filter(fresh)].forEach(({ at, ...o }) => {
    const sig = signature(o.exercises);
    if (!sig || seen.has(sig) || out.length >= max) return;
    seen.add(sig);
    out.push(o);
  });
  return out;
}

// Saved workouts in Add an activity (lib/savedWorkouts.ts).

/**
 * The order they are offered in: today's first (its usual day is today), then
 * the most recently used.
 */
export function orderSaved<T extends { usualDay: number | null; lastUsedAt: string }>(list: T[], now = new Date()): T[] {
  const today = now.getDay();
  return [...list].sort((a, b) => {
    const at = a.usualDay === today ? 1 : 0;
    const bt = b.usualDay === today ? 1 : 0;
    if (at !== bt) return bt - at;
    return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
  });
}

/** The one for today, if a saved workout's usual day is today. */
export function todaysWorkout<T extends { usualDay: number | null; lastUsedAt: string }>(list: T[], now = new Date()): T | null {
  return orderSaved(list, now).find((w) => w.usualDay === now.getDay()) ?? null;
}

export function exerciseCount(w: { exercises: LiftLine[] }): string {
  const n = w.exercises.filter((e) => e?.name?.trim()).length;
  return `${n} ${n === 1 ? 'exercise' : 'exercises'}`;
}

/** "last done 7 days ago" from when it was last used. */
export function lastDoneText(lastUsedAt: string, createdAt: string, now = new Date()): string {
  // Saving one sets last_used_at too; one never logged since reads as new.
  if (Math.abs(new Date(lastUsedAt).getTime() - new Date(createdAt).getTime()) < 60_000) return 'not done yet';
  const days = Math.floor((startOfDay(now) - startOfDay(new Date(lastUsedAt))) / 86_400_000);
  if (days <= 0) return 'last done today';
  if (days === 1) return 'last done yesterday';
  return `last done ${days} days ago`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

