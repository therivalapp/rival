import { supabase, getAuthUser } from './supabase';
import { TAG_WINDOW_HOURS, withinTagWindow } from './tagWindow';

// Saying who else was on a session.
//
// The database holds the rules — who may tag whom, and the copy that accepting
// creates (see supabase/add_activity_sharing.sql and its functions file). This
// module only asks and reports. In particular there is no "create the other
// person's activity" call here on purpose: accepting goes through an RPC so the
// numbers are copied inside the database rather than assembled by the app.

// Re-exported so callers have one import for the whole feature; the values
// live in tagWindow.ts because that module is testable and this one is not.
export { TAG_WINDOW_HOURS, withinTagWindow };

export type Teammate = {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Activities shared with this person, either way round (declined ones aside). */
  together: number;
};

export type ParticipantStatus = 'pending' | 'accepted' | 'declined';

export type Participant = {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  status: ParticipantStatus;
};

// Everyone you share an active team with. Ordered by who you train with most
// (activities you tagged them on, or they tagged you on), then most recently,
// then alphabetically — training partners repeat, so the picker can open on
// the few people you usually train with (Ricky, 2026-10-14).
export async function fetchTeammates(): Promise<Teammate[]> {
  const { data: { user } } = await getAuthUser();
  if (!user) return [];

  const { data: myTeams } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('user_id', user.id)
    .eq('status', 'active');

  const teamIds = (myTeams ?? []).map((m: any) => m.league_id);
  if (teamIds.length === 0) return [];

  const [{ data: members }, { data: recent }] = await Promise.all([
    supabase
      .from('league_members')
      .select('user_id, users(display_name, avatar_url)')
      .in('league_id', teamIds)
      .eq('status', 'active')
      .neq('user_id', user.id),
    supabase
      .from('activity_participants')
      .select('user_id, added_by, status, created_at')
      .or(`added_by.eq.${user.id},user_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  // The other person on each tag, whichever side tagged. First appearance
  // wins for recency, as the list is newest-first.
  const lastTagged = new Map<string, string>();
  const together = new Map<string, number>();
  (recent ?? []).forEach((r: any) => {
    if (r.status === 'declined') return;
    const other = r.added_by === user.id ? r.user_id : r.added_by;
    if (!other || other === user.id) return;
    if (!lastTagged.has(other)) lastTagged.set(other, r.created_at);
    together.set(other, (together.get(other) ?? 0) + 1);
  });

  // The same person appears once per shared team.
  const byId = new Map<string, Teammate>();
  (members ?? []).forEach((m: any) => {
    if (byId.has(m.user_id)) return;
    byId.set(m.user_id, {
      id: m.user_id,
      name: m.users?.display_name || 'A teammate',
      avatarUrl: m.users?.avatar_url ?? null,
      together: together.get(m.user_id) ?? 0,
    });
  });

  return [...byId.values()].sort((a, b) => {
    if (a.together !== b.together) return b.together - a.together;
    const aWhen = lastTagged.get(a.id);
    const bWhen = lastTagged.get(b.id);
    if (aWhen && bWhen) return bWhen.localeCompare(aWhen);
    if (aWhen) return -1;
    if (bWhen) return 1;
    return a.name.localeCompare(b.name);
  });
}

// Asked for together: a feed draws a card per activity and each card asks for
// its own partners, which was one request per card. Asks made within a few
// milliseconds of each other go out as one (2026-10-21).
let batch: Map<string, Array<(rows: Participant[]) => void>> | null = null;

export function fetchParticipants(activityId: string): Promise<Participant[]> {
  return new Promise((resolve) => {
    if (!batch) {
      batch = new Map();
      setTimeout(sendParticipantBatch, 10);
    }
    const waiting = batch.get(activityId);
    if (waiting) waiting.push(resolve); else batch.set(activityId, [resolve]);
  });
}

async function sendParticipantBatch() {
  const asked = batch!;
  batch = null;
  const ids = [...asked.keys()];
  const byActivity = new Map<string, Participant[]>();
  // A dropped connection throws rather than returning an error; every card
  // waiting must still hear back (with no partners) instead of waiting forever.
  try { for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from('activity_participants')
      .select('id, activity_id, user_id, status, users:user_id(display_name, avatar_url)')
      .in('activity_id', ids.slice(i, i + 100))
      .order('created_at');
    if (error) continue;
    (data ?? []).forEach((r: any) => {
      const list = byActivity.get(r.activity_id) ?? [];
      list.push({
        id: r.id,
        userId: r.user_id,
        name: r.users?.display_name || 'A teammate',
        avatarUrl: r.users?.avatar_url ?? null,
        status: r.status as ParticipantStatus,
      });
      byActivity.set(r.activity_id, list);
    });
  } } catch { /* answered below with what arrived */ }
  asked.forEach((resolvers, id) => resolvers.forEach((r) => r(byActivity.get(id) ?? [])));
}

// Tagging asks; it does not grant. Nothing about the tagged person's Effort,
// feed or leaderboard changes until they answer.
export async function tagTeammates(
  activityId: string,
  userIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (userIds.length === 0) return { ok: true };
  const { data: { user } } = await getAuthUser();
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const { error } = await supabase.from('activity_participants').insert(
    userIds.map((id) => ({ activity_id: activityId, user_id: id, added_by: user.id })),
  );
  if (!error) return { ok: true };

  // The insert policy is the real guard, so its refusals surface here as a
  // generic RLS error. Say what the rule is rather than passing that through.
  if (error.code === '42501') {
    return { ok: false, error: `Only teammates can be added, within ${TAG_WINDOW_HOURS} hours of the activity.` };
  }
  if (error.code === '23505') {
    return { ok: false, error: 'This person has already been added.' };
  }
  return { ok: false, error: error.message };
}

// Undoing a tag also removes the activity it created for the other person —
// that part happens in the database, because leaving the Effort behind would
// make "remove" cosmetic.
export async function removeTag(tagId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('activity_participants').delete().eq('id', tagId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
