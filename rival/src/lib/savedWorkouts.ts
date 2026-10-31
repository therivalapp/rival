import { supabase } from './supabase';
import { orderSaved, type LiftLine, type SavedWorkout } from './liftHistory';

export { orderSaved, todaysWorkout, exerciseCount, lastDoneText } from './liftHistory';

// Saved workouts (Ricky, 2026-10-25, mockups approved): a routine saved once,
// from a scan or typed in, then logged again in one tap from Add an activity.
// The table is saved_workouts.sql; the photo and usual day are
// saved_workouts_photos.sql. Photos are private (workout-photos bucket), so
// they are shown through short-lived signed links.

/** A saved workout with its photo and usual day. */
export type SavedWorkoutRow = SavedWorkout & {
  imagePath: string | null;
  /** 0 Sunday to 6 Saturday, as Date.getDay(). */
  usualDay: number | null;
  createdAt: string;
};

/** Each person's limit, also enforced by the database. */
export const SAVED_WORKOUT_LIMIT = 30;

const COLUMNS = 'id, name, activity_type, exercises, last_used_at, image_path, usual_day, created_at';
const BUCKET = 'workout-photos';

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function fromRow(r: any): SavedWorkoutRow {
  return {
    id: r.id,
    name: r.name,
    activityType: r.activity_type,
    exercises: Array.isArray(r.exercises) ? r.exercises : [],
    lastUsedAt: r.last_used_at,
    imagePath: r.image_path ?? null,
    usualDay: r.usual_day ?? null,
    createdAt: r.created_at,
  };
}

// Before saved_workouts_photos.sql is run the photo and day columns don't
// exist yet; the rest still works without them.
const COLUMNS_BEFORE_PHOTOS = 'id, name, activity_type, exercises, last_used_at, created_at';
const missingColumn = (e: any) => e?.code === '42703' || e?.code === 'PGRST204';

export async function loadSavedWorkouts(): Promise<SavedWorkoutRow[]> {
  let { data, error }: { data: any[] | null; error: any } = await supabase.from('saved_workouts').select(COLUMNS).order('last_used_at', { ascending: false });
  if (error && error.code === '42703') {
    ({ data, error } = await supabase.from('saved_workouts').select(COLUMNS_BEFORE_PHOTOS).order('last_used_at', { ascending: false }));
  }
  if (error) throw error;
  return orderSaved((data ?? []).map(fromRow));
}

export async function loadSavedWorkout(id: string): Promise<SavedWorkoutRow | null> {
  let { data, error }: { data: any; error: any } = await supabase.from('saved_workouts').select(COLUMNS).eq('id', id).maybeSingle();
  if (error && error.code === '42703') ({ data } = await supabase.from('saved_workouts').select(COLUMNS_BEFORE_PHOTOS).eq('id', id).maybeSingle());
  return data ? fromRow(data) : null;
}

/** Signed links for the photos, an hour long, keyed by path. */
export async function photoUrls(paths: (string | null)[]): Promise<Record<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => !!p))];
  if (!wanted.length) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(wanted, 3600);
  const out: Record<string, string> = {};
  (data ?? []).forEach((d: any) => { if (d.signedUrl && d.path) out[d.path] = d.signedUrl; });
  return out;
}

/** Stores a saved workout's photo and returns its path. Null before
 *  saved_workouts_photos.sql has made the bucket: it saves without one. */
export async function uploadWorkoutPhoto(userId: string, blob: Blob, mimeType: string, ext: string): Promise<string | null> {
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mimeType, upsert: false });
  if (error && /bucket not found/i.test(error.message)) return null;
  if (error) throw error;
  return path;
}

export type SavedWorkoutInput = {
  name: string;
  activityType: string | null;
  exercises: LiftLine[];
  usualDay?: number | null;
  imagePath?: string | null;
};

export async function createSavedWorkout(input: SavedWorkoutInput): Promise<SavedWorkoutRow> {
  const base = { name: input.name.trim().slice(0, 60), activity_type: input.activityType, exercises: input.exercises };
  let { data, error }: { data: any; error: any } = await supabase.from('saved_workouts')
    .insert({ ...base, usual_day: input.usualDay ?? null, image_path: input.imagePath ?? null }).select(COLUMNS).single();
  // Before saved_workouts_photos.sql: saved without the photo and day.
  if (missingColumn(error)) ({ data, error } = await supabase.from('saved_workouts').insert(base).select(COLUMNS_BEFORE_PHOTOS).single());
  if (error || !data) throw error ?? new Error('The activity could not be saved.');
  return fromRow(data);
}

export async function updateSavedWorkout(id: string, patch: Partial<SavedWorkoutInput> & { touch?: boolean }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim().slice(0, 60);
  if (patch.activityType !== undefined) row.activity_type = patch.activityType;
  if (patch.exercises !== undefined) row.exercises = patch.exercises;
  if (patch.usualDay !== undefined) row.usual_day = patch.usualDay;
  if (patch.imagePath !== undefined) row.image_path = patch.imagePath;
  if (patch.touch) row.last_used_at = new Date().toISOString();
  let { error, count } = await supabase.from('saved_workouts').update(row, { count: 'exact' }).eq('id', id);
  // Before saved_workouts_photos.sql: the rest is saved without the photo and day.
  if (missingColumn(error)) {
    delete row.usual_day; delete row.image_path;
    if (!Object.keys(row).length) return;
    ({ error, count } = await supabase.from('saved_workouts').update(row, { count: 'exact' }).eq('id', id));
  }
  if (error) throw error;
  if (!count) throw new Error('The saved activity was not found.');
}

/** Deletes the workout and its photo. Activities already logged are not changed. */
export async function deleteSavedWorkout(w: { id: string; imagePath: string | null }): Promise<void> {
  const { error, count } = await supabase.from('saved_workouts').delete({ count: 'exact' }).eq('id', w.id);
  if (error) throw error;
  if (!count) throw new Error('The saved activity was not found.');
  if (w.imagePath) await supabase.storage.from(BUCKET).remove([w.imagePath]);
}

/** The database's limit message, in the app's words. */
export function savedWorkoutError(e: any): string {
  const msg = String(e?.message ?? e ?? '');
  if (/limited to 30/i.test(msg)) return `Saved activities are limited to ${SAVED_WORKOUT_LIMIT}. Delete one to save another.`;
  return msg || 'Something went wrong. Try again.';
}
