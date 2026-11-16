import { describe, expect, it } from 'vitest';
import { challengeResult, daysSinceEnd, teamRecords, type ChallengeActivity } from '../teamChallengeResults';

const act = (user_id: string, day: string, elev: number): ChallengeActivity => ({
  user_id, started_at: `${day}T08:00:00`, effort_score: 10, distance_meters: 1000, elevation_meters: elev, duration_seconds: 3600,
});
const members = new Set(['a', 'b', 'c']);

describe('team challenge results', () => {
  it('counts only the challenge dates and members, most first', () => {
    const r = challengeResult({ key: 'x', metric: 'elevation', target: 1000, start: '2026-07-23', end: '2026-10-09' }, [
      act('a', '2026-07-22', 500), act('a', '2026-08-01', 300), act('b', '2026-09-01', 400), act('b', '2026-10-10', 999), act('z', '2026-08-01', 50),
    ], members);
    expect(r.total).toBe(700);
    expect(r.activityCount).toBe(2);
    expect(r.people.map((p) => p.userId)).toEqual(['b', 'a']);
  });
  it('days since end', () => {
    expect(daysSinceEnd('2026-10-09', new Date(2026, 9, 23, 12))).toBe(14);
    expect(daysSinceEnd('2026-10-09', new Date(2026, 9, 1, 12))).toBe(-8);
  });
  it('records per type, by year', () => {
    const r1 = challengeResult({ key: '1', metric: 'elevation', target: 1, start: '2025-08-01', end: '2025-08-31' }, [act('c', '2025-08-10', 1600)], members);
    const r2 = challengeResult({ key: '2', metric: 'elevation', target: 1, start: '2026-08-01', end: '2026-08-31' }, [act('a', '2026-08-10', 1200)], members);
    expect(teamRecords([r1, r2])[0].userId).toBe('c');
    expect(teamRecords([r1, r2], 2026)[0].userId).toBe('a');
  });
});
