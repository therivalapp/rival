// The Teams rail shows only three or four teams before a swipe, so the ones
// opened most recently come first; the rest keep their usual order behind
// them. A team moves forward only when it's opened, never because of others'
// activity, so the rail doesn't shuffle while it's being used (Ricky,
// 2026-10-23: no See all, no pinning). Remembered on this phone.

const KEY = 'rival.recentTeams';

function read(): Record<string, number> {
  try { return JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function markTeamOpened(id: string) {
  const all = read();
  all[id] = Date.now();
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(all)); } catch {}
}

/** Teams opened before, latest first, then the rest in their given order. */
export function byRecentlyOpened<T extends { id: string }>(teams: T[]): T[] {
  const opened = read();
  const seen = teams.filter((t) => opened[t.id]).sort((a, b) => opened[b.id] - opened[a.id]);
  return [...seen, ...teams.filter((t) => !opened[t.id])];
}
