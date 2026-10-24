import { router } from 'expo-router';

// Going to one of the four bottom-nav tabs (Today, Activity, Teams, Chat).
//
// The tabs live in one navigator (app/(tabs)) that is kept alive, so going to
// a tab must switch to it there rather than open a new copy on top: from a tab
// it switches tabs; from a page stacked above the tabs (a team, a form) it
// closes back down to them. A plain push/replace/navigate from a stacked page
// built a whole second set of tabs every time.

export type TabRoute = '/home' | '/my-activities' | '/team-feed' | '/messages';
const TAB_ROUTES = new Set<string>(['/home', '/my-activities', '/team-feed', '/messages']);

let currentPath = '';
/** Kept up to date by the root layout. */
export function setCurrentPath(path: string) {
  currentPath = path;
}
export function getCurrentPath() {
  return currentPath;
}

// Tapping the tab you're already on: the tab closes whatever it has open on
// top (an activity, a photo) and shows its main page, the usual phone-app
// second tap (Ricky, 2026-10-11).
const reselectListeners = new Map<string, Set<() => void>>();
export function onTabReselect(href: TabRoute, fn: () => void): () => void {
  const set = reselectListeners.get(href) ?? new Set();
  set.add(fn);
  reselectListeners.set(href, set);
  return () => { set.delete(fn); };
}

// The team page open above the tabs. Leaving it for another tab remembers it,
// so tapping Teams brings that team back; tapping Teams while on it goes to
// all teams, as the back arrow does (Ricky, 2026-10-11).
let openTeamId: string | null = null;
let returnTeamId: string | null = null;
/** Kept up to date by the team page. */
export function setOpenTeam(id: string | null) {
  openTeamId = id;
}

export function goToTab(href: TabRoute) {
  if (currentPath === href) { reselectListeners.get(href)?.forEach((fn) => fn()); return; }
  if (currentPath === '/team-hub') returnTeamId = href === '/team-feed' ? null : openTeamId;
  if (href === '/team-feed' && returnTeamId && TAB_ROUTES.has(currentPath)) {
    const id = returnTeamId;
    returnTeamId = null;
    router.navigate(href);
    router.push({ pathname: '/team-hub', params: { id } });
    return;
  }
  if (TAB_ROUTES.has(currentPath)) router.navigate(href);
  else if (router.canDismiss()) router.dismissTo(href);
  else router.replace(href);
}
