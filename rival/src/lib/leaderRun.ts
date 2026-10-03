import { getMondayOfWeek } from './streak';

// Weeks in a row as a team's weekly leader, shown as a small laurel on the
// first-place pillar (Ricky, 2026-10-01: first place only, from 2 weeks up).
// Only finished weeks count; the week in progress never adds to a run or
// ends one. A tie for first counts for everyone tied.

/** How far back to look first. A team whose run reaches it looks twice as
 *  far, and so on, up to LEADER_RUN_MAX_WEEKS (about ten years). */
export const LEADER_RUN_WEEKS = 26;
export const LEADER_RUN_MAX_WEEKS = 26 * 16;

/** The Monday that starts each finished week, newest first: [last week, the
 *  week before, ...]. Stepped by calendar day so a clock change never shifts
 *  a boundary. */
export function pastWeekStarts(now: Date, count = LEADER_RUN_WEEKS): Date[] {
  const thisWeek = getMondayOfWeek(now);
  const starts: Date[] = [];
  for (let k = 1; k <= count; k++) {
    const d = new Date(thisWeek);
    d.setDate(d.getDate() - 7 * k);
    starts.push(d);
  }
  return starts;
}

/** Which finished week (0 = last week) an activity falls in, or -1. */
export function weekIndexOf(startedAt: string, weekStarts: Date[], thisWeek: Date): number {
  const t = new Date(startedAt).getTime();
  if (t >= thisWeek.getTime()) return -1;
  for (let i = 0; i < weekStarts.length; i++) {
    if (t >= weekStarts[i].getTime()) return i;
  }
  return -1;
}

/** Each member's run of weeks finished first, counting back from last week.
 *  `weeks[0]` is last week's Effort by person. A week nobody scored in ends
 *  every run. Members with no run are left out. */
export function leaderRuns(weeks: Record<string, number>[], memberIds: string[]): Record<string, number> {
  const runs: Record<string, number> = {};
  let alive = new Set(memberIds);
  for (const points of weeks) {
    const top = Math.max(0, ...memberIds.map((id) => points[id] || 0));
    if (top <= 0) break;
    const leaders = new Set(memberIds.filter((id) => (points[id] || 0) === top));
    alive = new Set([...alive].filter((id) => leaders.has(id)));
    if (alive.size === 0) break;
    alive.forEach((id) => { runs[id] = (runs[id] || 0) + 1; });
  }
  return runs;
}
