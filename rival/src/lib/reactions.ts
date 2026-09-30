import { supabase } from './supabase';

// Respect and Inspired given to a person's activities. Reactions don't record
// whose activity they're on, so they're found by activity id — in batches,
// because a long training history is thousands of ids and one request with
// all of them in the URL is refused outright (PostgREST reads the filter from
// the query string).

export type ReactionRow = { target_id: string; user_id: string; emoji: string; created_at: string };

const BATCH = 120;

export async function fetchReactionsOn(
  activityIds: string[],
  opts: { since?: string } = {},
): Promise<ReactionRow[]> {
  if (activityIds.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < activityIds.length; i += BATCH) batches.push(activityIds.slice(i, i + BATCH));
  const results = await Promise.all(batches.map((ids) => {
    let q = supabase
      .from('feed_reactions')
      .select('target_id, user_id, emoji, created_at')
      .eq('target_type', 'activity')
      .in('target_id', ids);
    if (opts.since) q = q.gte('created_at', opts.since);
    return q;
  }));
  return results.flatMap((r) => (r.data as ReactionRow[] | null) ?? []);
}

export type ImpactTotals = { respect: number; inspired: number; people: number };

// Recognition from other people only — reacting to your own activity isn't
// someone showing up for you.
export function impactTotals(rows: ReactionRow[], ownerId: string): ImpactTotals {
  const people = new Set<string>();
  let respect = 0;
  let inspired = 0;
  for (const r of rows) {
    if (r.user_id === ownerId) continue;
    people.add(r.user_id);
    if (r.emoji === 'inspired') inspired += 1;
    else respect += 1;
  }
  return { respect, inspired, people: people.size };
}
