import { supabase } from './supabase';
import { onActivityDataChanged } from './dataEvents';

const PAGE = 1000;

// Every column any screen asks for. Home, Activity, Goals, Stats, the year
// page and Achievements each used to download the whole history separately,
// with slightly different columns, every time they opened. They now share one
// download of this set, kept for a minute and dropped the moment anything
// about activities changes (see lib/supabase.ts), so moving between screens
// reuses it instead of fetching the same rows again.
const SHARED_COLUMNS = [
  'id', 'name', 'activity_type', 'started_at', 'duration_seconds', 'distance_meters', 'elevation_meters',
  'effort_score', 'photo_url', 'photo_focal_x', 'photo_focal_y', 'exercises', 'race_id', 'notes', 'location',
  'companions', 'shared_from_activity_id', 'pinned',
];
const SHARED = new Set(SHARED_COLUMNS);
const FRESH_MS = 60_000;

const cache = new Map<string, { at: number; rows: Promise<any[]> }>();
onActivityDataChanged(() => cache.clear());

/** Drop the shared copy, e.g. after a Strava sync added activities server-side. */
export function invalidateActivityCache() {
  cache.clear();
}

async function fetchPaged(userId: string, columns: string): Promise<any[]> {
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('activities')
      .select(columns)
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    all.push(...(data as any[]));
    if (data.length < PAGE) break;
  }
  return all;
}

// PostgREST silently caps un-ranged selects at 1000 rows. A user who imports a
// full multi-year Strava history has more than that, and every lifetime stat,
// streak, or achievement computed from a capped result is silently wrong.
// Pages through the complete set; ordering makes the pages stable.
export async function fetchAllActivities(userId: string, columns: string): Promise<any[]> {
  const wanted = columns.split(',').map((c) => c.trim()).filter(Boolean);
  if (!wanted.every((c) => SHARED.has(c))) return fetchPaged(userId, columns);

  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.rows;
  const rows = fetchPaged(userId, SHARED_COLUMNS.join(', '));
  cache.set(userId, { at: Date.now(), rows });
  // A failed or partial fetch must not be served to the next screen.
  rows.then((r) => { if (!r.length) cache.delete(userId); }, () => cache.delete(userId));
  return rows;
}
