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

export function goToTab(href: TabRoute) {
  if (TAB_ROUTES.has(currentPath)) router.navigate(href);
  else if (router.canDismiss()) router.dismissTo(href);
  else router.replace(href);
}
