// Run with TZ=Pacific/Auckland (see package.json test script) — streak math is
// local-time based and RIVAL's users are in NZ, where DST transitions
// (late Sep spring-forward, early Apr fall-back) are exactly what these
// regression tests exercise.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculateStreak } from '../streak';

// 3 activities in the week starting at the given Monday (streak minimum).
function activeWeek(mondayIso: string): { started_at: string }[] {
  const monday = new Date(mondayIso);
  return [1, 3, 5].map((offsetDays) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + offsetDays);
    d.setHours(9, 0, 0, 0);
    return { started_at: d.toISOString() };
  });
}

describe('calculateStreak', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('requires 3 activities in a week to count', () => {
    vi.setSystemTime(new Date('2025-06-11T10:00:00')); // Wed, week of Mon 9 Jun
    const twoOnly = activeWeek('2025-06-09T00:00:00').slice(0, 2);
    expect(calculateStreak(twoOnly).current).toBe(0);
    expect(calculateStreak(activeWeek('2025-06-09T00:00:00')).current).toBe(1);
  });

  it('counts consecutive weeks and keeps streak alive if this week is not yet active', () => {
    vi.setSystemTime(new Date('2025-06-17T10:00:00')); // Tue, week of Mon 16 Jun
    const activities = [
      ...activeWeek('2025-06-02T00:00:00'),
      ...activeWeek('2025-06-09T00:00:00'),
    ];
    const r = calculateStreak(activities);
    expect(r.current).toBe(2); // last week active, this week pending — streak holds
    expect(r.activeThisWeek).toBe(false);
  });

  it('resets across a missed week', () => {
    vi.setSystemTime(new Date('2025-06-18T10:00:00'));
    const activities = [
      ...activeWeek('2025-06-02T00:00:00'),
      // week of 9 Jun missed
      ...activeWeek('2025-06-16T00:00:00'),
    ];
    const r = calculateStreak(activities);
    expect(r.current).toBe(1);
    expect(r.longestEver).toBe(1);
  });

  // REGRESSION: the walk-back used to step by fixed 7*24h ms, which lands on
  // Sunday 23:00 across the NZ spring-forward (28 Sep 2025) and skips a week —
  // a fully active 5-week streak reported 4.
  it('survives the NZ spring-forward DST transition (Sep 2025)', () => {
    vi.setSystemTime(new Date('2025-10-01T10:00:00')); // Wed, week of Mon 29 Sep (NZDT)
    const activities = [
      ...activeWeek('2025-09-01T00:00:00'),
      ...activeWeek('2025-09-08T00:00:00'),
      ...activeWeek('2025-09-15T00:00:00'),
      ...activeWeek('2025-09-22T00:00:00'), // DST starts Sun 28 Sep inside this week
      ...activeWeek('2025-09-29T00:00:00'),
    ];
    const r = calculateStreak(activities);
    expect(r.current).toBe(5);
    expect(r.longestEver).toBe(5);
  });

  it('does not double-count across the NZ fall-back DST transition (Apr 2025)', () => {
    vi.setSystemTime(new Date('2025-04-16T10:00:00')); // Wed, week of Mon 14 Apr (NZST)
    const activities = [
      ...activeWeek('2025-03-31T00:00:00'), // DST ends Sun 6 Apr inside this week
      ...activeWeek('2025-04-07T00:00:00'),
      ...activeWeek('2025-04-14T00:00:00'),
    ];
    const r = calculateStreak(activities);
    expect(r.current).toBe(3);
    expect(r.longestEver).toBe(3);
  });

  it('handles empty and malformed input', () => {
    vi.setSystemTime(new Date('2025-06-18T10:00:00'));
    expect(calculateStreak([])).toEqual({ current: 0, activeThisWeek: false, longestEver: 0, thisWeek: 0 });
    expect(calculateStreak([{ started_at: 'not-a-date' }, { started_at: '' }]).current).toBe(0);
  });
});
