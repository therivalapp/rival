import { describe, expect, it } from 'vitest';
import { averageSteps, mondayOf, stepsProgress } from '../steps';

// Sunday 15 November 2026.
const SUN = new Date(2026, 10, 15, 15, 0);

describe('steps', () => {
  it('finds Monday', () => {
    expect(mondayOf(SUN).getDate()).toBe(9);
  });
  it('averages days with steps only', () => {
    expect(averageSteps({ '2026-11-14': 8000, '2026-11-13': 6000, '2026-11-12': 0 }, 30, SUN)).toBe(7000);
  });
  it('daily goal: today, days hit, to go', () => {
    const s = { '2026-11-09': 11000, '2026-11-10': 12000, '2026-11-11': 3000, '2026-11-15': 7412 };
    const p = stepsProgress(s, 10000, 'day', SUN);
    expect(p.current).toBe(7412);
    expect(p.toGo).toBe(2588);
    expect(p.daysHit).toBe(2);
    expect(p.daysSoFar).toBe(7);
    expect(Math.round(p.pct * 100)).toBe(74);
  });
  it('weekly goal sums the week', () => {
    const p = stepsProgress({ '2026-11-09': 20000, '2026-11-15': 5000 }, 70000, 'week', SUN);
    expect(p.current).toBe(25000);
    expect(p.daysHit).toBe(1);
  });
});
