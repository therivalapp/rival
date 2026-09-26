import { supabase, getAuthUser } from './supabase';
import { getPrefs, onPrefsChanged } from './prefs';

// The in-app inbox. Items are created by database triggers, never by the app —
// see supabase/add_inbox_triggers.sql — so everything here reads, marks read,
// or resolves. Nothing inserts.

export type InboxKind =
  | 'reaction'
  | 'comment'
  | 'join_request'
  | 'short_activity'
  | 'team_joined'
  | 'activity_tag'
  | 'tag_accepted';

export type InboxItem = {
  id: string;
  kind: InboxKind;
  actor_id: string | null;
  league_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  title: string;
  body: string | null;
  read_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  created_at: string;
};

const COLUMNS =
  'id, kind, actor_id, league_id, subject_type, subject_id, title, body, read_at, resolved_at, resolution, created_at';

// Kinds that ask a question. An informational item is done the moment it has
// been seen; one of these stays open until it is actually answered, which is
// why `resolved_at` is tracked separately from `read_at`.
const ACTIONABLE: InboxKind[] = ['join_request', 'short_activity', 'activity_tag'];

export function isActionable(item: InboxItem): boolean {
  return ACTIONABLE.includes(item.kind) && !item.resolved_at;
}

// Profile → Notifications. A switched-off kind, or anything from a muted team,
// is left out of the bell — except questions still waiting for an answer,
// which always show so nobody is left waiting on a reply.
function wanted(item: Pick<InboxItem, 'kind' | 'league_id' | 'resolved_at'>): boolean {
  if (ACTIONABLE.includes(item.kind) && !item.resolved_at) return true;
  const p = getPrefs();
  if ((p.notify as Record<string, boolean>)[item.kind] === false) return false;
  if (item.league_id && p.mutedTeams.includes(item.league_id)) return false;
  return true;
}

// The bell lives in the top nav on every screen and refreshes its count on
// navigation, which is the cheapest signal that something changed — but acting
// on an item does not navigate, so the badge would sit there claiming work that
// has just been done. Anything that changes the count says so here.
type InboxListener = () => void;
const listeners = new Set<InboxListener>();

export function onInboxChanged(listener: InboxListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function inboxChanged() {
  badgeCache = null;
  listeners.forEach((l) => { try { l(); } catch { /* a bad listener must not break the action */ } });
}

// A change in Profile → Notifications changes what counts.
onPrefsChanged(() => inboxChanged());

export async function fetchInbox(limit = 50): Promise<InboxItem[]> {
  const { data: { user } } = await getAuthUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('inbox_items')
    .select(COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    // Room for items the settings hide, so the list still fills.
    .limit(limit * 2);
  if (error) return [];
  return ((data ?? []) as InboxItem[]).filter(wanted).slice(0, limit);
}

// Drives the bell's badge. Counts unread, plus anything still waiting for an
// answer — an unanswered question you have already glanced at is still
// outstanding, and the badge should say so.
// The bar asks on every screen change; a few seconds of reuse stops a burst
// of navigation re-counting a number that hasn't moved. Anything that changes
// the count clears it through inboxChanged().
const BADGE_CACHE_MS = 15_000;
let badgeCache: { at: number; userId: string; count: number } | null = null;

export async function fetchInboxBadgeCount(): Promise<number> {
  const { data: { user } } = await getAuthUser();
  if (!user) return 0;
  if (badgeCache && badgeCache.userId === user.id && Date.now() - badgeCache.at < BADGE_CACHE_MS) return badgeCache.count;
  // The rows themselves rather than a server count, so the settings in
  // Profile → Notifications can be applied. Outstanding items are few.
  const { data, error } = await supabase
    .from('inbox_items')
    .select('kind, league_id, resolved_at')
    .eq('user_id', user.id)
    .or(`read_at.is.null,and(kind.in.(${ACTIONABLE.join(',')}),resolved_at.is.null)`)
    .limit(500);
  if (error) return 0;
  const count = (data ?? []).filter((r: any) => wanted(r)).length;
  badgeCache = { at: Date.now(), userId: user.id, count };
  return count;
}

export async function markRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  // RLS failures update nothing and raise nothing, so there is no honest way to
  // report this beyond the caller re-reading — which it does on next open.
  await supabase
    .from('inbox_items')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null);
  inboxChanged();
}

export async function resolveItem(
  id: string,
  resolution: 'acted' | 'dismissed',
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('inbox_items')
    .update({ resolved_at: new Date().toISOString(), resolution, read_at: new Date().toISOString() })
    .eq('id', id);
  if (!error) inboxChanged();
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Approving a join request flips the membership row; the trigger on that table
// closes this item and tells the new member. Declining removes the request, so
// there is nothing left to point at and the item is resolved here instead.
export async function respondToJoinRequest(
  item: InboxItem,
  accept: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!item.subject_id) return { ok: false, error: 'This request is no longer available.' };

  if (accept) {
    const { error, count } = await supabase
      .from('league_members')
      .update({ status: 'active' }, { count: 'exact' })
      .eq('id', item.subject_id)
      .eq('status', 'pending');
    if (error) return { ok: false, error: error.message };
    // Zero rows means it was already handled elsewhere, or RLS refused — either
    // way the item should stop offering a decision.
    if (!count) {
      await resolveItem(item.id, 'dismissed');
      return { ok: false, error: 'That request has already been handled.' };
    }
    inboxChanged();
    return { ok: true };
  }

  const { error } = await supabase.from('league_members').delete().eq('id', item.subject_id).eq('status', 'pending');
  if (error) return { ok: false, error: error.message };
  return resolveItem(item.id, 'acted');
}

// Keep or remove an activity the app flagged as suspiciously short. The record
// of the decision lives on the activity itself, so the same question is never
// asked twice even if the inbox item is deleted.
export async function respondToShortActivity(
  item: InboxItem,
  keep: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!item.subject_id) return { ok: false, error: 'That activity is no longer available.' };

  if (keep) {
    const { error } = await supabase
      .from('activities')
      .update({ short_review_dismissed_at: new Date().toISOString() })
      .eq('id', item.subject_id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from('activities').delete().eq('id', item.subject_id);
    if (error) return { ok: false, error: error.message };
  }
  return resolveItem(item.id, 'acted');
}

// Confirm or refuse that you were on somebody else's session.
//
// Accepting goes through an RPC rather than an insert: the activity it creates
// carries real Effort, so its numbers are copied from the original inside the
// database. If the app built that row, "I was there too" would mean "here is an
// activity worth whatever I claim".
//
// Declining is silent by design — the person who tagged you is told nothing.
// Anything else turns a question into an obligation.
export async function respondToActivityTag(
  item: InboxItem,
  accept: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!item.subject_id) return { ok: false, error: 'That activity is no longer available.' };

  if (accept) {
    const { error } = await supabase.rpc('accept_activity_tag', { p_id: item.subject_id });
    if (error) return { ok: false, error: error.message };
    inboxChanged();
    return resolveItem(item.id, 'acted');
  }

  const { error } = await supabase
    .from('activity_participants')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', item.subject_id)
    .eq('status', 'pending');
  if (error) return { ok: false, error: error.message };
  return resolveItem(item.id, 'acted');
}
