import { describe, expect, it } from 'vitest';
import { monthDays, monthsSince, profileBests, profileMilestones, yearTotals, type ProfileActivity } from '../profilePage';

const act = (id: string, started_at: string, extra: Partial<ProfileActivity> = {}): ProfileActivity => ({
  id, activity_type: 'Run', started_at, duration_seconds: 3600, distance_meters: 10000, elevation_meters: 100, effort_score: 10, ...extra,
});

describe('yearTotals', () => {
  it('counts only that year', () => {
    const t = yearTotals([act('a', '2025-12-30T12:00:00Z'), act('b', '2026-03-01T12:00:00Z'), act('c', '2026-04-01T12:00:00Z')], 2026);
    expect(t).toEqual({ activities: 2, effort: 20, hours: 2 });
  });
});

describe('profileBests', () => {
  it('keeps the fastest time, heaviest lift and farthest of a sport', () => {
    const activities = [
      act('a', '2026-01-01T12:00:00Z', { exercises: [{ name: 'Deadlift', weight: 100 }] }),
      act('b', '2026-02-01T12:00:00Z', { distance_meters: 21100, exercises: [{ name: 'Deadlift', weight: 140 }] }),
    ];
    const runs = [
      { id: 'a', activity_type: 'Run', started_at: '2026-01-01T12:00:00Z', best_efforts: [{ distance: 10000, seconds: 3000 }] },
      { id: 'b', activity_type: 'Run', started_at: '2026-02-01T12:00:00Z', best_efforts: [{ distance: 10000, seconds: 2976 }] },
    ];
    const bests = profileBests(activities, runs);
    expect(bests.find((b) => b.key === 'time:10000')).toMatchObject({ value: 2976, activityId: 'b' });
    expect(bests.find((b) => b.key === 'lift:Deadlift')).toMatchObject({ value: 140, activityId: 'b' });
    expect(bests.find((b) => b.key === 'far:Run')).toMatchObject({ value: 21100, activityId: 'b' });
  });
});

describe('profileMilestones', () => {
  it('credits the activity that crossed the line, newest first', () => {
    const rows = Array.from({ length: 12 }, (_, i) => act(`a${i}`, `2026-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`));
    const { earned } = profileMilestones(rows);
    expect(earned.find((m) => m.key === 'activities:10')?.activity.id).toBe('a9');
    expect(earned.find((m) => m.key === 'km:100')?.activity.id).toBe('a9');
    expect(earned.find((m) => m.key === 'elevation:1000')?.activity.id).toBe('a9');
    expect(earned.some((m) => m.key === 'activities:25')).toBe(false);
  });

  it('awards every line one huge activity crosses, and picks the closest next', () => {
    const { earned, next } = profileMilestones([act('a', '2026-01-01T12:00:00Z', { distance_meters: 600000, duration_seconds: 0, elevation_meters: 0 })]);
    expect(earned.map((m) => m.key).filter((k) => k.startsWith('km'))).toEqual(['km:500', 'km:100']);
    expect(next).toMatchObject({ key: 'km:1000', current: 600 });
  });

  it('has nothing for an empty history', () => {
    const { earned, next } = profileMilestones([]);
    expect(earned).toEqual([]);
    expect(next?.current).toBe(0);
  });
});

describe('months', () => {
  it('runs from the first activity to now', () => {
    expect(monthsSince('2026-08-15T12:00:00Z', new Date(2026, 9, 30))).toEqual([{ year: 2026, month: 7 }, { year: 2026, month: 8 }, { year: 2026, month: 9 }]);
  });
  it('groups a month by day', () => {
    const m = monthDays([act('a', '2026-10-02T12:00:00'), act('b', '2026-10-02T15:00:00'), act('c', '2026-11-02T12:00:00')], 2026, 9);
    expect(m.get(2)?.map((a) => a.id)).toEqual(['a', 'b']);
    expect(m.size).toBe(1);
  });
});
