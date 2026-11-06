import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_STATS, readProfileStats } from '../profileStats';

describe('readProfileStats', () => {
  it('keeps a valid choice', () => {
    expect(readProfileStats(['distance', 'streak'])).toEqual(['distance', 'streak']);
  });
  it('falls back to the defaults', () => {
    for (const bad of [null, undefined, [], ['distance'], ['streak', 'streak'], ['distance', 'gone']]) {
      expect(readProfileStats(bad)).toEqual(DEFAULT_PROFILE_STATS);
    }
  });
});
