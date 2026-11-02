// Capture The Moment (Ricky, 2026-10-31): the pop-up asking for a photo when
// an activity arrived on its own. Never on one logged by hand, only within a
// day of it, once per activity, and only ever the latest, so they can't stack up.

const LOGGED_BY_HAND = new Set(['manual', 'rival_manual', 'rival_scan']);
const DAY_MS = 86_400_000;
const SEEN_KEY = 'rival.photoPromptSeen';

export type PromptActivity = {
  id: string; name: string | null; started_at: string; provider: string | null;
  photo_url: string | null; duration_seconds: number | null; distance_meters: number | null; effort_score: number | null;
};

/** The activity to ask about, given newest first; null when there is none. */
export function activityToPrompt<T extends PromptActivity>(rows: T[], seen: string[], now = Date.now()): T | null {
  const latest = rows.find((r) => r.provider && !LOGGED_BY_HAND.has(r.provider));
  if (!latest || latest.photo_url || seen.includes(latest.id)) return null;
  const age = now - new Date(latest.started_at).getTime();
  return age >= 0 && age <= DAY_MS ? latest : null;
}

export function seenPrompts(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
  } catch { return []; }
}

export function markPromptSeen(id: string) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([id, ...seenPrompts()].slice(0, 30)));
  } catch { /* it may ask once more */ }
}

// Asked to look again (a sync finished, the daily quote closed).
const listeners = new Set<() => void>();
export function onPromptCheck(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function requestPromptCheck() {
  listeners.forEach((fn) => fn());
}

// The daily quote goes first.
let quoteUp = false;
export function isQuoteUp() { return quoteUp; }
export function setQuoteUp(up: boolean) {
  quoteUp = up;
  if (!up) requestPromptCheck();
}
