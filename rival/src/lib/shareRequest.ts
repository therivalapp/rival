import { goToTab } from './tabNav';

// Share from a post in the feed or a team. The share lives in the Activity
// page's viewer, so the request goes there: the Activity tab opens that
// activity with its share up, and closing the share comes back to Teams
// (Ricky, 2026-10-23; replaces the old Share page).

let pending: string | null = null;
const listeners = new Set<() => void>();

export function requestShare(activityId: string) {
  pending = activityId;
  goToTab('/my-activities');
  listeners.forEach((fn) => fn());
}

/** The activity waiting to be shared, if any; left in place until taken. */
export function pendingShare() {
  return pending;
}

export function clearShareRequest() {
  pending = null;
}

export function onShareRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
