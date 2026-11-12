import { goToTab } from './tabNav';

// Share from a post in the feed or a team. The share lives in the Activity
// page's viewer, so the request goes there: the Activity tab opens that
// activity with its share up, and closing the share comes back to Teams
// (Ricky, 2026-10-23; replaces the old Share page).

let pending: string | null = null;
let withShare = true;
const listeners = new Set<() => void>();

export function requestShare(activityId: string) {
  pending = activityId;
  withShare = true;
  goToTab('/my-activities');
  listeners.forEach((fn) => fn());
}

/** Saving a new activity: Activity opens it in the viewer, without the share
 *  (Ricky, 2026-11-12: saving means done with the page; show the post). */
export function requestOpen(activityId: string) {
  pending = activityId;
  withShare = false;
  goToTab('/my-activities');
  listeners.forEach((fn) => fn());
}

/** The activity waiting to be opened, if any; left in place until taken. */
export function pendingShare() {
  return pending;
}

/** Whether the waiting activity opens with its share up. */
export function pendingWantsShare() {
  return withShare;
}

export function clearShareRequest() {
  pending = null;
}

export function onShareRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
