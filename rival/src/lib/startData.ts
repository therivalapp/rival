import { onActivityDataChanged } from './dataEvents';
import { getAuthUser, supabase } from './supabase';
import { loadSavedWorkouts, type SavedWorkoutRow } from './savedWorkouts';

// What the Start pages read. Fetched ahead of the tap, once the app has
// settled, so pressing Start opens at once (Ricky, 2026-11-01: it was slow).

export type PastRow = {
  id: string; started_at: string; activity_type: string; duration_seconds: number | null;
  distance_meters: number | null; effort_score: number | null; exercises: any;
};
export type StartData = { past: PastRow[]; saved: SavedWorkoutRow[] };

const KEEP_MS = 60_000;
let held: { at: number; data: Promise<StartData>; ready: StartData | null } | null = null;
onActivityDataChanged(() => { held = null; lastReady = null; });

async function fetchData(): Promise<StartData> {
  const { data: { user } } = await getAuthUser();
  if (!user) return { past: [], saved: [] };
  const [{ data }, saved] = await Promise.all([
    supabase.from('activities').select('id, started_at, activity_type, duration_seconds, distance_meters, effort_score, exercises')
      .eq('user_id', user.id).order('started_at', { ascending: false }).limit(300),
    loadSavedWorkouts().catch(() => [] as SavedWorkoutRow[]),
  ]);
  return { past: (data ?? []) as PastRow[], saved };
}

export function loadStartData(): Promise<StartData> {
  if (held && Date.now() - held.at < KEEP_MS) return held.data;
  const entry = { at: Date.now(), data: fetchData(), ready: null as StartData | null };
  held = entry;
  entry.data.then((d) => { entry.ready = d; lastReady = d; }).catch(() => { if (held === entry) held = null; });
  return entry.data;
}

// The last answer, kept past KEEP_MS: Start draws from it straight away and
// refreshes behind it, so its pages don't reorder after opening (Ricky,
// 2026-11-02: everything jumped).
let lastReady: StartData | null = null;

/** Already fetched, for drawing the first frame without a wait. */
export function startDataNow(): StartData | null {
  return held?.ready ?? lastReady;
}
