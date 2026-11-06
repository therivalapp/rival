import { router } from 'expo-router';
import { supabase, getAuthUser } from './supabase';
import { connectStrava } from './strava';
import { inboxChanged } from './inbox';
import { getMyTeamIds } from './myTeams';

// Consent for showing someone's Strava data to their teams.
//
// Strava's API Agreement only allows one person's Strava data to be shown to
// other people with that person's explicit consent. Connecting Strava goes
// through /connect-strava, which records when the person agreed. Route maps
// are a separate choice that starts off; the database only lets teammates
// read a route when share_routes is on (supabase/strava_sharing.sql).

export type StravaSharing = { agreedAt: string | null; shareRoutes: boolean };

// RIVAL is separating from Strava (Ricky, 2026-10-30; BETA_PLAN.md). Nobody new
// connects, and people bring their history in as an archive instead. Existing
// connections carry on until the switch-off. strava-token-exchange enforces it.
export const STRAVA_CONNECTIONS_OPEN = false;

// Whether the signed-in person has already agreed, remembered once known so a
// Connect button can decide instantly (opening Strava's window has to happen
// inside the tap itself, with no waiting first).
let agreedCache: boolean | null = null;
// The answer to "does this still need a reply", kept a minute and shared by
// everyone who asks at once: every copy of the top bar asked on every tab
// switch, eight requests for one fact (2026-10-21).
let answerCache: { at: number; value: Promise<boolean> } | null = null;
const ANSWER_TTL_MS = 60_000;
supabase.auth.onAuthStateChange(() => { agreedCache = null; answerCache = null; });

/** Connect (or reconnect) Strava. The sharing screen is shown only until the
 *  person has agreed once; after that it goes straight to Strava. */
export function startStravaConnect(onComplete?: () => void) {
  if (!STRAVA_CONNECTIONS_OPEN) return;
  if (agreedCache) connectStrava(onComplete);
  else router.push('/connect-strava');
}

/** True when Strava is connected but sharing hasn't been agreed yet (people
 *  who connected before the consent step). Shown as a notification that needs
 *  a reply, at the top of the bell and the Notifications page. */
export function stravaSharingNeedsAnswer(): Promise<boolean> {
  if (agreedCache === true) return Promise.resolve(false);
  if (answerCache && Date.now() - answerCache.at < ANSWER_TTL_MS) return answerCache.value;
  const value = askStravaSharingNeedsAnswer().catch(() => { answerCache = null; return false; });
  answerCache = { at: Date.now(), value };
  return value;
}

// Everyone in a team who hasn't agreed is asked once (since 2026-11-02 the
// agreement covers all activities, not only Strava's).
async function askStravaSharingNeedsAnswer(): Promise<boolean> {
  const { data: { user } } = await getAuthUser();
  if (!user) return false;
  const [teamIds, sharing] = await Promise.all([getMyTeamIds(user.id).catch(() => [] as string[]), loadStravaSharing()]);
  return teamIds.length > 0 && !!sharing && !sharing.agreedAt;
}

export const STRAVA_SHARING_NOTICE = {
  title: 'Sharing with teams',
  body: 'Confirm what teammates can see of your activities.',
  open: () => router.push('/team-sharing'),
};

// What to carry on with once Sharing with teams is agreed: the create, join
// or request that opened it. "Agree and continue" used to drop people back on
// the form to tap again (found 2026-11-06 signed in as a new user).
let afterAgree: (() => void) | null = null;

/** Before joining or creating a team: true once sharing is agreed. Otherwise
 *  opens Sharing with teams and returns false; `then` runs once they agree. */
export async function teamSharingAgreed(then?: () => void): Promise<boolean> {
  if (agreedCache === true) return true;
  const sharing = await loadStravaSharing();
  if (sharing?.agreedAt) return true;
  afterAgree = then ?? null;
  router.push('/team-sharing');
  return false;
}

/** The action waiting on the agreement, once (and forgets it). */
export function takeAfterAgree(): (() => void) | null {
  const next = afterAgree;
  afterAgree = null;
  return next;
}

export async function loadStravaSharing(): Promise<StravaSharing | null> {
  // The consent date isn't readable from the users table (only its owner may
  // see it), so it comes through this function, which returns only your own.
  const { data, error } = await supabase.rpc('my_strava_sharing');
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return null;
  agreedCache = !!row.agreed_at;
  return { agreedAt: row.agreed_at ?? null, shareRoutes: !!row.share_routes };
}

/** Records agreement to activity sharing, with the route choice made at the same time. */
export async function agreeToStravaSharing(shareRoutes: boolean): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await getAuthUser();
  if (!user) return { ok: false, error: 'Sign in again, then try once more.' };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('users')
    .update({ strava_sharing_agreed_at: now, share_routes: shareRoutes, share_routes_changed_at: now })
    .eq('id', user.id)
    .select('id');
  if (error || !data?.length) return { ok: false, error: 'The choice could not be saved. Try again.' };
  agreedCache = true;
  answerCache = null;
  inboxChanged();
  return { ok: true };
}

export async function setShareRoutes(shareRoutes: boolean): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await getAuthUser();
  if (!user) return { ok: false, error: 'Sign in again, then try once more.' };
  const { data, error } = await supabase
    .from('users')
    .update({ share_routes: shareRoutes, share_routes_changed_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('id');
  if (error || !data?.length) return { ok: false, error: 'The setting could not be saved. Try again.' };
  return { ok: true };
}
