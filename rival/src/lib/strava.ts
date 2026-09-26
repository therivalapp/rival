import { invalidateActivityCache } from './fetchAllActivities';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Extracted from home.tsx (the only place this was previously wired up —
// profile.tsx's own "Connect" button was a stub that just navigated to
// /home instead of starting OAuth at all). Opens Strava's authorize popup
// and calls `onComplete` once the popup closes, so the caller can reload
// whatever connection state it displays.
export async function connectStrava(onComplete?: () => void) {
  if (Platform.OS !== 'web') return;

  // Safari (what the iOS simulator's WebKit runs) only allows window.open to
  // actually open a popup when it's called SYNCHRONOUSLY inside the click
  // handler — any `await` before it breaks the user-gesture chain and Safari
  // silently blocks the popup with no error. Opening a blank tab immediately,
  // then navigating it once the async URL-building is done, keeps the
  // gesture chain intact. Chrome is more lenient but this works there too.
  const popup = window.open('', 'strava-auth', 'width=600,height=700');

  const clientId = process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID;
  const redirectUri = `${window.location.origin}/strava-callback`;
  const { data: { session } } = await supabase.auth.getSession();
  // approval_prompt=force — without it, Strava silently re-authorizes with
  // whatever account is already logged into strava.com in that browser
  // session and skips the consent screen entirely, which is what made
  // reconnecting feel like it "just loads the same account" with no way to
  // pick a different one. This forces the screen back up every time.
  const stravaUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&approval_prompt=force&scope=read,activity:read_all&state=${session?.access_token ?? ''}`;

  if (!popup) return; // still blocked (e.g. non-click-triggered call) — nothing more we can do
  popup.location.href = stravaUrl;

  const interval = setInterval(() => {
    try {
      if (popup.closed) { clearInterval(interval); onComplete?.(); }
    } catch { clearInterval(interval); }
  }, 500);
}

export type FullImportProgress = { savedSoFar: number; page: number };
export type FullImportResult =
  | { ok: true; saved: number; importedSeconds: number; importedEffort: number; newMilestones: string[] }
  | { ok: false; error: string; saved: number; importedSeconds: number; importedEffort: number };

// Drives strava-full-import ONE PAGE PER CALL instead of asking the edge
// function to loop through a user's whole history in one invocation — a
// deep account (500+ activities, each needing several sequential DB calls)
// blew straight through the function's memory/CPU budget server-side
// (WORKER_RESOURCE_LIMIT / HTTP 546), silently truncating the import with
// no usable error. Looping here bounds each call's work regardless of how
// much history exists, and lets the caller show live progress instead of a
// single opaque "Importing…" state with no sense of whether it's stuck.
export async function runFullStravaImport(
  accessToken: string,
  onProgress?: (p: FullImportProgress) => void,
): Promise<FullImportResult> {
  let saved = 0;
  let importedSeconds = 0;
  let importedEffort = 0;
  let newMilestones: string[] = [];
  let page = 1;

  while (true) {
    let res: Response;
    try {
      res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/strava-full-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ page }),
      });
    } catch {
      return { ok: false, error: 'Could not reach the server. Try again.', saved, importedSeconds, importedEffort };
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // `data.message` covers Supabase's own gateway errors (IDLE_TIMEOUT,
      // WORKER_RESOURCE_LIMIT), which use a different shape to our functions'
      // `error` field. Falling straight through to a generic message here is
      // what hid the real cause for several rounds of debugging.
      const detail = data.error || data.message || `HTTP ${res.status}`;
      return { ok: false, error: detail, saved, importedSeconds, importedEffort };
    }

    saved += data.saved ?? 0;
    importedSeconds += data.importedSeconds ?? 0;
    importedEffort += data.importedEffort ?? 0;
    if (data.newMilestones?.length) newMilestones = newMilestones.concat(data.newMilestones);
    onProgress?.({ savedSoFar: saved, page });

    if (!data.hasMore) {
      invalidateActivityCache();
      return { ok: true, saved, importedSeconds, importedEffort, newMilestones };
    }
    page++;
  }
}
