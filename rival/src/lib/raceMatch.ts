import { supabase } from './supabase';

// races.race_date is a bare 'YYYY-MM-DD' column — compare it against the
// activity's LOCAL calendar date, built via getFullYear/Month/Date rather
// than new Date(iso).toISOString(), which would shift the date across a
// UTC day boundary for anyone (Ricky included, NZ is UTC+12/13) logging near
// midnight local time.
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The activity types that can be a race of each single-sport race type.
// Triathlon, HYROX and other types aren't filtered: a triathlon's legs are
// a swim, a ride and a run, and HYROX is logged in more than one way.
const RACE_FAMILIES: Record<string, string[]> = {
  Run: ['Run', 'TrailRun', 'VirtualRun', 'TrackAndField', 'Wheelchair'],
  Ride: ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide', 'Handcycle', 'Velomobile'],
  Swim: ['Swim'],
};

// How far an activity's distance can sit from a single-sport race's and
// still be that race (a GPS watch reads a 21.1 km half as 20.8 to 21.6).
const DISTANCE_TOLERANCE = 0.15;

// Only auto-links when exactly one of the user's races on that date fits —
// with two there's no way to guess which one this activity belongs to, so
// it's left unlinked rather than picked arbitrarily. A race only fits an
// activity of its own sport and roughly its distance: a 10 km run on the
// day of a half marathon is not the half (Ricky, 2026-11-12).
export async function findMatchingRaceId(
  userId: string,
  startedAtIso: string,
  activity: { type?: string | null; distanceMeters?: number | null } = {},
): Promise<string | null> {
  const dateStr = localDateStr(new Date(startedAtIso));
  const { data, error } = await supabase
    .from('races')
    .select('id, race_type, distance_km')
    .eq('user_id', userId)
    .eq('race_date', dateStr);
  if (error || !data) return null;
  const fits = data.filter((r: any) => {
    const family = RACE_FAMILIES[r.race_type ?? ''];
    if (!family) return true;
    if (activity.type && !family.includes(activity.type)) return false;
    const raceKm = Number(r.distance_km) || 0;
    const km = (activity.distanceMeters ?? 0) / 1000;
    if (raceKm > 0 && km > 0 && Math.abs(km - raceKm) > raceKm * DISTANCE_TOLERANCE) return false;
    return true;
  });
  return fits.length === 1 ? fits[0].id : null;
}
