import { supabase } from './supabase';
import { fetchAllActivities } from './fetchAllActivities';
import { fetchYearEffort } from './archive';
import type { RevealActivity } from '../components/rival/HistoryReveal';

// What the reveal shows after connecting Strava: every activity now in RIVAL,
// photos from the strongest ones, routes for the farthest runs, and this
// year's Effort for the rank.
export async function loadHistoryReveal(userId: string): Promise<{ activities: RevealActivity[]; photoUrls: string[]; yearEffort: number }> {
  const rows = await fetchAllActivities(
    userId,
    'id, name, activity_type, started_at, utc_offset_seconds, duration_seconds, distance_meters, effort_score, photo_url',
  );
  const activities: RevealActivity[] = (rows ?? []).map((a: any) => ({
    key: a.id, name: a.name, type: a.activity_type, startedAt: a.started_at,
    utcOffsetSeconds: a.utc_offset_seconds, durationSeconds: a.duration_seconds || 0,
    distanceMeters: a.distance_meters, effort: a.effort_score || 0,
  }));
  const photoUrls = (rows ?? [])
    .filter((a: any) => a.photo_url)
    .sort((a: any, b: any) => (b.effort_score || 0) - (a.effort_score || 0))
    .slice(0, 6)
    .map((a: any) => a.photo_url as string);
  // Routes only for the few farthest runs, one of which leads the bests.
  const runIds = activities
    .filter((a) => /run/i.test(a.type) && (a.distanceMeters || 0) > 0)
    .sort((a, b) => (b.distanceMeters || 0) - (a.distanceMeters || 0))
    .slice(0, 5)
    .map((a) => a.key);
  if (runIds.length) {
    const { data } = await supabase.from('activity_routes').select('activity_id, polyline').in('activity_id', runIds);
    const byId = new Map((data ?? []).map((r: any) => [r.activity_id, r.polyline]));
    activities.forEach((a) => { if (byId.has(a.key)) a.polyline = byId.get(a.key); });
  }
  return { activities, photoUrls, yearEffort: await fetchYearEffort(userId) };
}

/** The latest few activities saved, for the live arrival screen. */
export async function latestArrivals(userId: string): Promise<{ list: { id: string; name: string | null; type: string; startedAt: string; distanceMeters: number | null }[]; photos: string[] }> {
  const [{ data: list }, { data: photos }] = await Promise.all([
    supabase.from('activities').select('id, name, activity_type, started_at, distance_meters')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(3),
    supabase.from('activities').select('photo_url')
      .eq('user_id', userId).not('photo_url', 'is', null).order('created_at', { ascending: false }).limit(6),
  ]);
  return {
    list: (list ?? []).map((a: any) => ({ id: a.id, name: a.name, type: a.activity_type, startedAt: a.started_at, distanceMeters: a.distance_meters })),
    photos: (photos ?? []).map((p: any) => p.photo_url),
  };
}
