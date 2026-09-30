// "Data the app keeps in memory just changed." Caches listen for this so a
// screen never shows a list missing what was just logged, joined or left.
// Raised centrally by lib/supabase.ts on every write, so a new screen that
// edits data cannot forget to.

export type DataArea = 'activities' | 'teams';

type Listener = () => void;
const listeners: Record<DataArea, Set<Listener>> = { activities: new Set(), teams: new Set() };

export function onDataChanged(area: DataArea, listener: Listener): () => void {
  listeners[area].add(listener);
  return () => { listeners[area].delete(listener); };
}

export function dataChanged(area: DataArea) {
  listeners[area].forEach((l) => { try { l(); } catch { /* one bad listener must not stop the rest */ } });
}

// Kept for the activity cache's existing call.
export const onActivityDataChanged = (l: Listener) => onDataChanged('activities', l);
export const activityDataChanged = () => dataChanged('activities');
