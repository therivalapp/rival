import { useEffect } from 'react';
import { supabase, getAuthUser } from './supabase';
import { useSnapState } from './snapState';

// The person's own activity types first, wherever a type is picked (Log an
// activity, Plan an activity, Scan): their activity is a tap away rather than
// behind See all (Ricky, 2026-10-23).

/** Picks for a grid of `defaults.length` tiles: the types logged lately, most
 *  used first (most recent breaks a tie), then the defaults to fill. Workout
 *  is kept off Weights' side in a row of `perRow`: two dumbbells side by side. */
export function tilesFor(recent: string[], defaults: string[], perRow = 4): string[] {
  const count = new Map<string, number>();
  recent.forEach((t, i) => { if (t) count.set(t, (count.get(t) ?? 0) + 1 + (recent.length - i) / 1e6); });
  const mine = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
  const tiles = [...mine, ...defaults.filter((t) => !mine.includes(t))].slice(0, defaults.length);
  for (let i = 0; i < tiles.length - 1; i++) {
    const pair = new Set([tiles[i], tiles[i + 1]]);
    if (i % perRow !== perRow - 1 && pair.has('Workout') && pair.has('WeightTraining')) {
      const j = i + 2 < tiles.length ? i + 2 : i - 1;
      if (j >= 0) [tiles[i + 1], tiles[j]] = [tiles[j], tiles[i + 1]];
    }
  }
  return tiles;
}

/** The person's last 30 activity types, newest first. Kept between visits, so
 *  the tiles don't shuffle as a page opens. */
export function useRecentTypes(): string[] {
  const [recent, setRecent] = useSnapState<string[]>('recentTypes', []);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      const { data } = await supabase.from('activities').select('activity_type')
        .eq('user_id', user.id).order('started_at', { ascending: false }).limit(30);
      if (data) setRecent(data.map((r: any) => r.activity_type).filter(Boolean));
    })();
  }, []);
  return recent;
}
