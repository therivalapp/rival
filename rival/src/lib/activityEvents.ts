// An activity deleted from a page stacked above the tabs (Manual entry):
// the Activity tab closes its open card and drops the activity at once,
// rather than showing it again until the back arrow (Ricky, 2026-10-23).

const listeners = new Set<(id: string) => void>();

export function activityDeleted(id: string) {
  listeners.forEach((fn) => fn(id));
}

export function onActivityDeleted(fn: (id: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
