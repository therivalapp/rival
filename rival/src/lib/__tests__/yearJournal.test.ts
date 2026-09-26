import { describe, expect, it } from 'vitest';
import { monthlyTotals, pbMoments, yearsWithActivity, yearWeeks } from '../yearJournal';

const act = (iso: string, type: string, effort: number, km = 0, mins = 30) => ({
  started_at: iso, activity_type: type, effort_score: effort, duration_seconds: mins * 60, distance_meters: km * 1000, elevation_meters: 0,
});

describe('yearJournal', () => {
  it('lists years with activity, newest first, always including this year', () => {
    expect(yearsWithActivity([act('2024-03-02T08:00:00', 'Run', 10)], new Date(2026, 5, 1))).toEqual([2026, 2024]);
  });

  it('totals each month', () => {
    const m = monthlyTotals([act('2026-01-05T08:00:00', 'Run', 40), act('2026-01-20T08:00:00', 'Run', 60), act('2026-03-01T08:00:00', 'Ride', 25)], 2026);
    expect(m[0]).toEqual({ month: 0, effort: 100, count: 2 });
    expect(m[2].effort).toBe(25);
    expect(m[1].count).toBe(0);
  });

  it('marks weeks that have not happened yet', () => {
    const w = yearWeeks([act('2026-01-06T08:00:00', 'Run', 40)], 2026, new Date(2026, 0, 20));
    expect(w[0].start.getDay()).toBe(1);
    expect(w.find((x) => x.count > 0)!.effort).toBe(40);
    expect(w.some((x) => x.future)).toBe(true);
    expect(w.length).toBeGreaterThanOrEqual(52);
  });

  it('finds personal bests, but not a first-ever activity', () => {
    const p = pbMoments([
      act('2025-12-01T08:00:00', 'Run', 10, 5),
      act('2026-02-01T08:00:00', 'Run', 10, 8),
      act('2026-03-01T08:00:00', 'Run', 10, 6),
      act('2026-04-01T08:00:00', 'Yoga', 10, 0, 60),
      act('2026-05-01T08:00:00', 'Yoga', 10, 0, 75),
    ], 2026);
    expect(p.map((x) => `${x.type}:${x.value}`)).toEqual(['Yoga:75', 'Run:8']);
    expect(p[1].previous).toBe(5);
  });
});
