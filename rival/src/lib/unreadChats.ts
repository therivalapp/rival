import { getMyTeamIds } from './myTeams';
import { supabase, getAuthUser } from './supabase';
import { getPrefs, onPrefsChanged } from './prefs';

// How many of your teams have chat you haven't read.
//
// Shared rather than copied because it now drives TWO things that must agree:
// the Chat tab's badge and the unread dots in messages.tsx. A badge that says
// 2 over a list showing 3 dots is worse than no badge at all.
//
// Counts TEAMS, not messages: the badge sits on a tab that opens a list of
// teams, so the number should match the number of rows you're about to see
// marked unread.

export type UnreadResult = {
  /** Teams with unread chat. */
  count: number;
  /** Per-team, for the messages list. */
  byLeague: Record<string, boolean>;
};

const EMPTY: UnreadResult = { count: 0, byLeague: {} };

// The nav bar re-checks on every route change, and this costs two queries, so
// without a floor a burst of navigation would fire them repeatedly for a
// number that can't have moved. 15s is short enough that a message arriving
// while you're on another screen still shows up almost immediately.
const CACHE_MS = 15_000;
let cache: { at: number; result: UnreadResult } | null = null;

/** Call after reading a thread, so the badge doesn't stay lit for 15s. */
export function invalidateUnreadChats() {
  cache = null;
}
onPrefsChanged(() => { cache = null; });

// The newest text message in each team, one small request per team, side by
// side. Each is a single row read straight off the (league_id, created_at)
// index. This used to download every message ever sent in every team just to
// keep the newest of each — a cost that grew with every message.
export async function latestMessageByLeague<T extends { league_id: string }>(
  leagueIds: string[],
  columns: string,
): Promise<Map<string, T>> {
  const rows = await Promise.all(leagueIds.map((id) => supabase
    .from('league_messages')
    .select(columns)
    .eq('league_id', id)
    .eq('kind', 'text')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()));
  const map = new Map<string, T>();
  rows.forEach((r) => { if (r.data) map.set((r.data as unknown as T).league_id, r.data as unknown as T); });
  return map;
}

export async function getUnreadChats(force = false): Promise<UnreadResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.result;

  const { data: { user } } = await getAuthUser();
  if (!user) return EMPTY;

  const leagueIds = await getMyTeamIds(user.id).catch(() => [] as string[]);
  if (leagueIds.length === 0) return EMPTY;

  const [lastByLeague, { data: reads }] = await Promise.all([
    latestMessageByLeague<{ league_id: string; user_id: string; created_at: string }>(leagueIds, 'league_id, user_id, created_at'),
    supabase
      .from('league_chat_reads')
      .select('league_id, last_read_at')
      .eq('user_id', user.id)
      .in('league_id', leagueIds),
  ]);

  const readByLeague = new Map((reads ?? []).map((r: any) => [r.league_id, r.last_read_at]));

  const byLeague: Record<string, boolean> = {};
  let count = 0;
  for (const leagueId of leagueIds) {
    const last = lastByLeague.get(leagueId);
    const lastReadAt = readByLeague.get(leagueId);
    // Your own message must never mark a thread unread. Without this the badge
    // lights up the moment YOU post — telling you that you have something to
    // read, about something you just wrote.
    // A muted team's chat never counts as unread (Profile → Notifications).
    const unread = !!last
      && !getPrefs().mutedTeams.includes(leagueId)
      && last.user_id !== user.id
      && (!lastReadAt || new Date(last.created_at) > new Date(lastReadAt));
    byLeague[leagueId] = unread;
    if (unread) count += 1;
  }

  const result = { count, byLeague };
  cache = { at: Date.now(), result };
  return result;
}
