import { describe, expect, it } from 'vitest';
import { eventResults, type EventAct } from '../teamEvent';

const act = (id: string, user: string, day: string, km: number, secs: number, type = 'Run'): EventAct => ({
  id, user_id: user, started_at: `${day}T09:00:00`, activity_type: type,
  duration_seconds: secs, distance_meters: km * 1000, race_id: null,
});

describe('eventResults', () => {
  it('ranks finishers by time, then anyone who stopped by km', () => {
    const r = eventResults({
      format: 'finish', date: '2026-11-21', distanceKm: 21.1, participants: ['a', 'b', 'c', 'd'],
      activities: [act('1', 'a', '2026-11-21', 21.1, 6000), act('2', 'b', '2026-11-21', 21.2, 5500), act('3', 'c', '2026-11-21', 14.2, 5000)],
    });
    expect(r.map((x) => x.userId)).toEqual(['b', 'a', 'c']);
    expect(r[2].finished).toBe(false);
  });

  it('marks a PB when the time beats every earlier one over the distance', () => {
    const r = eventResults({
      format: 'finish', date: '2026-11-21', distanceKm: 21.1, participants: ['a'],
      activities: [act('0', 'a', '2026-06-01', 21.1, 6300), act('1', 'a', '2026-11-21', 21.1, 6000)],
    });
    expect(r[0].pb).toBe(true);
  });

  it('counts laps of the set lap and ranks furthest first', () => {
    const r = eventResults({
      format: 'laps', date: '2026-12-06', distanceKm: 6.7056, participants: ['a', 'b'],
      activities: [act('1', 'a', '2026-12-06', 80.5, 43000), act('2', 'b', '2026-12-06', 207.9, 111000)],
    });
    expect(r.map((x) => [x.userId, x.laps])).toEqual([['b', 31], ['a', 12]]);
  });

  it('leaves out anyone with nothing on the day', () => {
    const r = eventResults({ format: 'timed', date: '2026-12-14', distanceKm: null, participants: ['a'], activities: [act('1', 'a', '2026-12-13', 10, 3600)] });
    expect(r).toEqual([]);
  });
});
