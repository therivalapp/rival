import { describe, expect, it } from 'vitest';
import { activityDisplayName, buildYearReview, formatMinutes, type YearActivity } from '../yearReview';

function act(date: Date, type: string, opts: Partial<YearActivity> = {}): YearActivity {
  return {
    started_at: date.toISOString(),
    activity_type: type,
    effort_score: 10,
    duration_seconds: 3600,
    distance_meters: 0,
    elevation_meters: 0,
    ...opts,
  };
}

describe('buildYearReview', () => {
  it('counts only the local calendar year', () => {
    const r = buildYearReview([
      act(new Date(2025, 11, 31, 23, 30), 'Run'),
      act(new Date(2026, 0, 1, 0, 30), 'Run'),
      act(new Date(2026, 11, 31, 23, 30), 'Run'),
      act(new Date(2027, 0, 1, 0, 30), 'Run'),
    ], 2026);
    expect(r.count).toBe(2);
  });

  it('includes every kind of training, not only distance', () => {
    const r = buildYearReview([
      act(new Date(2026, 2, 2, 7), 'WeightTraining'),
      act(new Date(2026, 2, 3, 7), 'WeightTraining'),
      act(new Date(2026, 2, 4, 7), 'Yoga'),
    ], 2026);
    expect(r.km).toBe(0);
    expect(r.topActivity?.type).toBe('WeightTraining');
    expect(r.byActivity.map((b) => b.type)).toEqual(['WeightTraining', 'Yoga']);
    expect(r.farthest).toBeNull();
  });

  it('breaks a tie on sessions by time spent', () => {
    const r = buildYearReview([
      act(new Date(2026, 4, 4, 7), 'Run', { duration_seconds: 1800 }),
      act(new Date(2026, 4, 5, 7), 'Ride', { duration_seconds: 7200 }),
    ], 2026);
    expect(r.topActivity?.type).toBe('Ride');
  });

  it('finds the best week and counts active days once each', () => {
    const r = buildYearReview([
      act(new Date(2026, 5, 1, 7), 'Run', { effort_score: 20 }),
      act(new Date(2026, 5, 1, 18), 'Run', { effort_score: 20 }),
      act(new Date(2026, 5, 10, 7), 'Run', { effort_score: 30 }),
    ], 2026);
    expect(r.activeDays).toBe(2);
    expect(r.bestWeek?.effort).toBe(40);
    expect(r.bestWeek?.start.getDate()).toBe(1);
  });

  it('measures the longest run of consecutive weeks, across a DST change', () => {
    // NZ daylight saving ends on 5 April 2026 — the run must not split there.
    const r = buildYearReview([
      act(new Date(2026, 2, 24, 7), 'Run'),
      act(new Date(2026, 2, 31, 7), 'Run'),
      act(new Date(2026, 3, 7, 7), 'Run'),
      act(new Date(2026, 3, 14, 7), 'Run'),
      act(new Date(2026, 4, 26, 7), 'Run'),
    ], 2026);
    expect(r.longestWeekStreak).toBe(4);
  });

  it('returns an empty review for a year with no training', () => {
    const r = buildYearReview([], 2026);
    expect(r.count).toBe(0);
    expect(r.topActivity).toBeNull();
    expect(r.bestWeek).toBeNull();
    expect(r.longestWeekStreak).toBe(0);
  });
});

describe('display helpers', () => {
  it('names activity types for people', () => {
    expect(activityDisplayName('WeightTraining')).toBe('Weight training');
    expect(activityDisplayName('AlpineSki')).toBe('Alpine ski');
    expect(activityDisplayName('HIIT')).toBe('HIIT');
    expect(activityDisplayName('Run')).toBe('Run');
  });

  it('formats time', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(12760)).toBe('212h 40m');
  });
});
