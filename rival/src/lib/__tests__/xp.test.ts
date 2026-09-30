import { describe, it, expect } from 'vitest';
import { LEVELS, getLevel, xpProgressInLevel } from '../xp';

describe('LEVELS ladder', () => {
  it('is contiguous — each level starts where the previous ends', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].minXp).toBe(LEVELS[i - 1].maxXp);
    }
  });

  it('starts at 0 and tops out at Unrivaled/Infinity', () => {
    expect(LEVELS[0].minXp).toBe(0);
    expect(LEVELS[LEVELS.length - 1].name).toBe('Unrivaled');
    expect(LEVELS[LEVELS.length - 1].maxXp).toBe(Infinity);
  });
});

describe('getLevel', () => {
  it('returns the right level at exact boundaries (min is inclusive)', () => {
    expect(getLevel(0).name).toBe('Rookie');
    expect(getLevel(1999).name).toBe('Rookie');
    expect(getLevel(2000).name).toBe('Hustler'); // boundary belongs to the higher level
    expect(getLevel(38999).name).toBe('God');
    expect(getLevel(39000).name).toBe('Unrivaled');
    expect(getLevel(1_000_000).name).toBe('Unrivaled');
  });

  it('clamps negatives to Rookie', () => {
    expect(getLevel(-5).name).toBe('Rookie');
  });
});

describe('xpProgressInLevel', () => {
  it('reports progress within the current level', () => {
    const p = xpProgressInLevel(2812.5); // Hustler: 2,000–5,250
    expect(p.current).toBe(812.5);
    expect(p.needed).toBe(3250);
    expect(p.pct).toBeCloseTo(0.25);
  });

  it('caps at pct 1 with nothing needed at max level', () => {
    const p = xpProgressInLevel(80000);
    expect(p.needed).toBe(0);
    expect(p.pct).toBe(1);
  });
});
