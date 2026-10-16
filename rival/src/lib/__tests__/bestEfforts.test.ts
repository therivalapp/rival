import { describe, expect, it } from 'vitest';
import { fastestBests } from '../bestEfforts';

const run = (id: string, day: number, dist: number, secs: number, efforts: Array<[number, number]> | null = null) => ({
  id, user_id: 'u', activity_type: 'Run', started_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`,
  distance_meters: dist, duration_seconds: secs,
  best_efforts: efforts ? efforts.map(([distance, seconds]) => ({ distance, seconds })) : null,
});

describe('fastestBests', () => {
  it('needs an earlier time to beat', () => {
    expect(fastestBests([run('a', 1, 5000, 1500)])).toEqual({});
  });

  it('counts a whole run and part of a longer one', () => {
    const out = fastestBests([
      run('a', 1, 5010, 1502),                         // whole 5 km, no best efforts
      run('b', 2, 10000, 2900, [[5000, 1450], [1000, 280]]),
    ]);
    expect(out.b.map((x) => x.label)).toEqual(['5 km']);
    expect(out.b[0].prevSeconds).toBe(1499);
  });

  it('lists every distance beaten, longest first', () => {
    const out = fastestBests([
      run('a', 1, 10000, 3000, [[1000, 290], [5000, 1500], [10000, 3000]]),
      run('b', 2, 10000, 2950, [[1000, 285], [5000, 1490], [10000, 2950]]),
    ]);
    expect(out.b.map((x) => x.label)).toEqual(['10 km', '5 km', '1 km']);
  });

  it('keeps people apart and ignores rides', () => {
    const other = { ...run('c', 2, 5000, 1000), user_id: 'v' };
    const ride = { ...run('d', 3, 5000, 600), activity_type: 'Ride' };
    expect(fastestBests([run('a', 1, 5000, 1500), other, ride])).toEqual({});
  });

  it('celebrates 1 km or 1 mile by units, never 400 m', () => {
    const rows = [
      run('a', 1, 5000, 1500, [[400, 90], [1000, 290], [1609.34, 470]]),
      run('b', 2, 5000, 1490, [[400, 85], [1000, 285], [1609.34, 460]]),
    ];
    expect(fastestBests(rows).b.map((x) => x.label)).toEqual(['5 km', '1 km']);
    expect(fastestBests(rows, true).b.map((x) => x.label)).toEqual(['5 km', '1 mile']);
  });
});
