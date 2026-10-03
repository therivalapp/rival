import { describe, it, expect } from 'vitest';
import { leaderRuns, pastWeekStarts, weekIndexOf } from '../leaderRun';

describe('leaderRuns', () => {
  const ids = ['a', 'b', 'c'];

  it('counts weeks in a row finished first, newest first', () => {
    const weeks: Record<string, number>[] = [{ a: 50, b: 20 }, { a: 40, b: 30 }, { b: 60, a: 10 }, { a: 90 }];
    expect(leaderRuns(weeks, ids)).toEqual({ a: 2 });
  });

  it('counts a tie for first for everyone tied', () => {
    const weeks: Record<string, number>[] = [{ a: 50, b: 50 }, { a: 30, b: 10 }];
    expect(leaderRuns(weeks, ids)).toEqual({ a: 2, b: 1 });
  });

  it('ends every run at a week nobody scored in', () => {
    const weeks: Record<string, number>[] = [{ a: 50 }, {}, { a: 50 }];
    expect(leaderRuns(weeks, ids)).toEqual({ a: 1 });
  });

  it('ignores people outside the team', () => {
    const weeks: Record<string, number>[] = [{ a: 10, z: 99 }, { a: 10, z: 99 }];
    expect(leaderRuns(weeks, ids)).toEqual({ a: 2 });
  });

  it('gives nothing when last week was empty', () => {
    expect(leaderRuns([{}, { a: 10 }] as Record<string, number>[], ids)).toEqual({});
  });
});

describe('weekIndexOf', () => {
  const now = new Date(2026, 9, 1, 12); // Thursday 1 October 2026
  const starts = pastWeekStarts(now, 3);
  const thisWeek = new Date(2026, 8, 28);

  it('starts last week on the Monday before this one', () => {
    expect(starts[0].getDate()).toBe(21);
    expect(starts[0].getMonth()).toBe(8);
  });

  it('places activities in finished weeks only', () => {
    expect(weekIndexOf(new Date(2026, 8, 29, 8).toISOString(), starts, thisWeek)).toBe(-1);
    expect(weekIndexOf(new Date(2026, 8, 27, 23).toISOString(), starts, thisWeek)).toBe(0);
    expect(weekIndexOf(new Date(2026, 8, 21, 0, 30).toISOString(), starts, thisWeek)).toBe(0);
    expect(weekIndexOf(new Date(2026, 8, 20, 23).toISOString(), starts, thisWeek)).toBe(1);
    expect(weekIndexOf(new Date(2026, 7, 1).toISOString(), starts, thisWeek)).toBe(-1);
  });
});
