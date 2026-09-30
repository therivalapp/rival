import { describe, expect, it } from 'vitest';
import { rankPace } from '../rankPace';

describe('rankPace', () => {
  it('shows nothing without any training', () => {
    expect(rankPace({ yearEffort: 0, firstActivityEver: null, now: new Date(2026, 5, 1) })).toBeNull();
  });

  it('waits until there is enough to go on', () => {
    expect(rankPace({ yearEffort: 500, firstActivityEver: new Date(2026, 5, 1), now: new Date(2026, 5, 10) })).toBeNull();
  });

  it('projects the year end from the pace since 1 January for someone training all year', () => {
    // Half the year gone, 7,000 earned: on pace for about 14,000.
    const now = new Date(2026, 6, 2, 12);
    const p = rankPace({ yearEffort: 7000, firstActivityEver: new Date(2024, 3, 1), now })!;
    expect(p.latecomer).toBe(false);
    expect(p.fullYear).toBeNull();
    expect(p.yearEnd.effort).toBeGreaterThan(13500);
    expect(p.yearEnd.effort).toBeLessThan(14500);
    expect(p.yearEnd.level.name).toBe('Champion'); // Champion from 13,000 (2026-10 ladder)
  });

  it('measures a latecomer from their first activity and shows a full-year projection', () => {
    // Started 1 July, 3,500 Effort by 1 October: ~38 a day.
    const now = new Date(2026, 9, 1, 12);
    const p = rankPace({ yearEffort: 3500, firstActivityEver: new Date(2026, 6, 1, 7), now })!;
    expect(p.latecomer).toBe(true);
    expect(p.start.getMonth()).toBe(6);
    expect(p.fullYear!.effort).toBeGreaterThan(13500);
    expect(p.fullYear!.level.name).toBe('Champion');
    // The rank actually reached this year stays far lower.
    expect(p.yearEnd.effort).toBeLessThan(p.fullYear!.effort);
  });

  it('does not treat a first activity in early January as a late start', () => {
    const p = rankPace({ yearEffort: 2000, firstActivityEver: new Date(2026, 0, 5), now: new Date(2026, 3, 1) })!;
    expect(p.latecomer).toBe(false);
  });
});
