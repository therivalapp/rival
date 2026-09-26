import { supabase } from './supabase';
import { onDataChanged } from './dataEvents';

// The teams the signed-in person is an active member of, with the basics every
// screen shows. Home, the team feed, Chat, the unread badge, Races and Profile
// each looked this up themselves, one after another, on every visit. They now
// share one lookup, kept for a minute and dropped the moment a membership or
// team changes (lib/supabase.ts raises that on every write).

export type MyTeamRow = {
  league_id: string;
  leagues: { id: string; name: string; invite_code: string | null; logo_url: string | null } | null;
};

const FRESH_MS = 60_000;
let cache: { userId: string; at: number; rows: Promise<MyTeamRow[]> } | null = null;
onDataChanged('teams', () => { cache = null; });

export function getMyTeamRows(userId: string): Promise<MyTeamRow[]> {
  if (cache && cache.userId === userId && Date.now() - cache.at < FRESH_MS) return cache.rows;
  const rows = Promise.resolve(
    supabase
      .from('league_members')
      .select('league_id, leagues(id, name, invite_code, logo_url)')
      .eq('user_id', userId)
      .eq('status', 'active'),
  ).then(({ data, error }) => {
    if (error) throw error;
    return (data ?? []) as unknown as MyTeamRow[];
  });
  cache = { userId, at: Date.now(), rows };
  rows.catch(() => { if (cache?.rows === rows) cache = null; });
  return rows;
}

export async function getMyTeamIds(userId: string): Promise<string[]> {
  return (await getMyTeamRows(userId)).map((r) => r.league_id);
}
