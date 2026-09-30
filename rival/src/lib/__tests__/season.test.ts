import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSeasonStartISO, getSeasonEndISO, getCurrentSeasonYear, daysUntilSeasonEnd } from '../season';

describe('season boundaries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('season runs from local midnight on 1 January to the next', () => {
    expect(getSeasonStartISO(2026)).toBe(new Date(2026, 0, 1).toISOString());
    expect(getSeasonEndISO(2026)).toBe(new Date(2027, 0, 1).toISOString());
  });

  it('an activity on the evening of 31 December local time belongs to the old season', () => {
    const evening = new Date(2026, 11, 31, 21, 0, 0);
    expect(evening < new Date(getSeasonEndISO(2026))).toBe(true);
    expect(new Date(2027, 0, 1, 0, 0, 1) >= new Date(getSeasonStartISO(2027))).toBe(true);
  });

  it('uses the local calendar year for the current season', () => {
    vi.setSystemTime(new Date(2026, 5, 15, 12));
    expect(getCurrentSeasonYear()).toBe(2026);
    expect(getSeasonStartISO()).toBe(new Date(2026, 0, 1).toISOString());
  });

  it('counts calendar days until season end', () => {
    vi.setSystemTime(new Date(2026, 11, 31, 23, 30));
    expect(daysUntilSeasonEnd()).toBe(1);
    vi.setSystemTime(new Date(2026, 0, 1, 0, 5));
    expect(daysUntilSeasonEnd()).toBe(365);
  });
});
