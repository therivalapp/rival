import { router } from 'expo-router';
import { supabase, getAuthUser } from './supabase';
import { connectStrava } from './strava';
import { inboxChanged } from './inbox';

// Consent for showing someone's Strava data to their teams.
//
// Strava's API Agreement only allows one person's Strava data to be shown to
// other people with that person's explicit consent. Connecting Strava goes
// through /connect-strava, which records when the person agreed. Route maps
// are a separate choice that starts off; the database only lets teammates
// read a route when share_routes is on (supabase/strava_sharing.sql).

export type StravaSharing = { agreedAt: string | null; shareRoutes: boolean };

// Whether the signed-in person has already agreed, remembered once known so a
// Connect button can decide instantly (opening Strava's window has to happen
// inside the tap itself, with no waiting first).
let agreedCache: boolean | null = null;
supabase.auth.onAuthStateChange(() => { agreedCache = null; });

/** Connect (or reconnect) Strava. The sharing screen is shown only until the
 *  person has agreed once; after that it goes straight to Strava. */
export function startStravaConnect(onComplete?: () => void) {
  if (agreedCache) connectStrava(onComplete);
  else router.push('/connect-strava');
}

/** True when Strava is connected but sharing hasn't been agreed yet (people
 *  who connected before the consent step). Shown as a notification that needs
 *  a reply, at the top of the bell and the Notifications page. */
export async function stravaSharingNeedsAnswer(): Promise<boolean> {
  if (agreedCache === true) return false;
  const { data: { user } } = await getAuthUser();
  if (!user) return false;
  const [{ data: conn }, sharing] = await Promise.all([
    supabase.from('fitness_connections').select('user_id').eq('user_id', user.id).eq('provider', 'strava').maybeSingle(),
    loadStravaSharing(),
  ]);
  return !!conn && !!sharing && !sharing.agreedAt;
}

export const STRAVA_SHARING_NOTICE = {
  title: 'Confirm Strava sharing',
  body: 'Strava asks for agreement before your activities are shown to your teams.',
  open: () => router.push({ pathname: '/connect-strava', params: { review: '1' } }),
};

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
