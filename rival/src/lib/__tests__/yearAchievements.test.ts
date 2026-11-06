import { describe, expect, it } from 'vitest';
import { achievementTitle, earnedBy, yearAchievements, type YearActivity } from '../yearAchievements';

let id = 0;
const act = (started_at: string, extra: Partial<YearActivity> = {}): YearActivity => ({
  id: `a${++id}`, activity_type: 'Run', started_at, distance_meters: 10000, elevation_meters: 100, effort_score: 50, ...extra,
});

describe('yearAchievements', () => {
  it('counts only that year, so everything starts again in January', () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => act(`2025-12-${String(i + 10).padStart(2, '0')}T12:00:00Z`)),
      ...Array.from({ length: 9 }, (_, i) => act(`2026-01-${String(i + 5).padStart(2, '0')}T12:00:00Z`)),
    ];
    expect(yearAchievements(rows, 2026).earned).toEqual([]);
    expect(yearAchievements(rows, 2025).earned).toEqual([]);
  });

  it('credits the activity that crossed the line', () => {
    const rows = Array.from({ length: 12 }, (_, i) => act(`2026-02-${String(i + 1).padStart(2, '0')}T12:00:00Z`));
    const r = yearAchievements(rows, 2026);
    expect(r.earned.find((e) => e.key === 'distance:100')?.activity.id).toBe(rows[9].id);
    expect(r.earned.find((e) => e.key === 'activities:10')?.activity.id).toBe(rows[9].id);
  });

  it('builds a streak only from weeks with three activities in a row', () => {
    const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-23', '2026-03-24', '2026-03-25'];
    const r = yearAchievements(days.map((d) => act(`${d}T12:00:00Z`)), 2026);
    expect(r.earned.some((e) => e.key === 'streak:4')).toBe(true);
    expect(r.next.find((n) => n.ladder === 'streak')?.progress).toBe('4 of 8 weeks');
  });

  it('lists the next step on each ladder', () => {
    const r = yearAchievements([act('2026-04-01T12:00:00Z')], 2026);
    expect(r.next.find((n) => n.ladder === 'distance')?.progress).toBe('10 of 100 km');
    expect(r.next.find((n) => n.ladder === 'rank')?.value).toBe('Hustler');
  });

  it('names what one activity earned', () => {
    const rows = Array.from({ length: 10 }, (_, i) => act(`2026-05-${String(i + 1).padStart(2, '0')}T12:00:00Z`));
    expect(earnedBy(rows, rows[9].id).map(achievementTitle)).toEqual(['10 activities', '100 km', '1,000 m elevation']);
    expect(earnedBy(rows, rows[0].id)).toEqual([]);
    expect(earnedBy(rows, rows[4].id)).toEqual([]);
  });

  it('counts time for every kind of activity', () => {
    const rows = Array.from({ length: 13 }, (_, i) => act(`2026-08-${String(i + 1).padStart(2, '0')}T12:00:00Z`, { activity_type: 'Yoga', distance_meters: 0, duration_seconds: 7200 }));
    const r = yearAchievements(rows, 2026);
    expect(r.earned.find((e) => e.key === 'time:25')?.activity.id).toBe(rows[12].id);
    expect(r.next.find((n) => n.ladder === 'time')?.progress).toBe('26 of 50 hours');
    expect(r.total).toBe(34);
  });
});
