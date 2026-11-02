import { describe, expect, it, vi } from 'vitest';
vi.mock('../prefs', () => ({ getPrefs: () => ({}) }));
import { celebrationFor, type CelebrationActivity } from '../celebration';

let id = 0;
const act = (started_at: string, extra: Partial<CelebrationActivity> = {}): CelebrationActivity => ({
  id: `c${++id}`, activity_type: 'Run', started_at, distance_meters: 10000, duration_seconds: 3000, elevation_meters: 0, effort_score: 10, ...extra,
});
// Twelve runs the year before: past the first lifetime steps.
const history = () => Array.from({ length: 12 }, (_, i) => act(`2025-03-${String(i + 1).padStart(2, '0')}T12:00:00Z`));

describe('celebrationFor', () => {
  it('leads with a lifetime milestone and lists the rest under it', () => {
    const rows = Array.from({ length: 9 }, (_, i) => act(`2026-05-${String(i + 1).padStart(2, '0')}T12:00:00Z`));
    rows.push(act('2026-05-20T12:00:00Z', { distance_meters: 21400 }));
    const c = celebrationFor(rows, rows[9].id, 'u')!;
    expect(c).toMatchObject({ kind: 'milestone', big: '100', unit: 'km', countFrom: 0, countTo: 100, title: 'Distance, all time' });
    expect(c.steps).toEqual({ done: 1, of: 5, next: '500 km' });
    expect(c.also.map((t) => `${t.value} ${t.label}`)).toEqual(['10 Activities, all time', '21.4 km Farthest', '100 km 2026', '10 Activities, 2026']);
  });

  it("puts a personal best ahead of the year's achievements", () => {
    const rows = [...history(), act('2026-01-04T12:00:00Z', { distance_meters: 21400 })];
    const c = celebrationFor(rows, rows[12].id, 'u')!;
    expect(c).toMatchObject({ kind: 'pb', title: 'Farthest run.', delta: '11.4 km farther', also: [] });
  });

  it("counts the year's distance up from the step before", () => {
    const rows = [...history(), ...Array.from({ length: 10 }, (_, i) => act(`2026-06-${String(i + 1).padStart(2, '0')}T12:00:00Z`))];
    const c = celebrationFor(rows, rows[21].id, 'u')!;
    expect(c).toMatchObject({ kind: 'achievement', big: '100', countFrom: 0, countTo: 100, unit: 'km', title: 'Distance, 2026' });
    expect(c.steps).toEqual({ done: 1, of: 5, next: '500 km' });
  });

  it('has nothing for an ordinary activity', () => {
    const rows = [...history(), ...Array.from({ length: 4 }, (_, i) => act(`2026-07-${String(i + 1).padStart(2, '0')}T12:00:00Z`))];
    expect(celebrationFor(rows, rows[14].id, 'u')).toBeNull();
  });

  it('leads with an event once its last leg is in, with the legs and the goal', () => {
    const race = { id: 'r1', name: 'T100 Vancouver', race_date: '2026-08-15', distance_km: 51.5, goal_finish_time: '02:45:00', actual_finish_time: null,
      disciplines: [{ name: 'Swim' }, { name: 'Bike' }, { name: 'Run' }] };
    const swim = act('2026-08-15T14:00:00Z', { activity_type: 'Swim', duration_seconds: 1452, distance_meters: 1500, race_id: 'r1' });
    const ride = act('2026-08-15T14:30:00Z', { activity_type: 'Ride', duration_seconds: 4360, distance_meters: 40000, race_id: 'r1' });
    const rows = [...history(), swim, ride];
    expect(celebrationFor(rows, ride.id, 'u', race)?.kind).not.toBe('event');
    const run = act('2026-08-15T16:00:00Z', { duration_seconds: 3855, race_id: 'r1' });
    const c = celebrationFor([...rows, run], run.id, 'u', race)!;
    expect(c).toMatchObject({ kind: 'event', big: '2:41:07', cap: 'Total time', pill: 'Beat the 2:45 goal by 3:53', title: 'T100 Vancouver.' });
    expect(c.legs?.map((l) => `${l.label} ${l.time}`)).toEqual(['Swim 24:12', 'Bike 1:12:40', 'Run 1:04:15']);
  });

  it('says Finisher when there is no goal or it was missed', () => {
    const race = { id: 'r2', name: 'Squamish 50', race_date: null, distance_km: 50, goal_finish_time: '06:00:00', actual_finish_time: null, disciplines: null };
    const ultra = act('2026-08-20T12:00:00Z', { duration_seconds: 24490, race_id: 'r2' });
    expect(celebrationFor([...history(), ultra], ultra.id, 'u', race)).toMatchObject({ kind: 'event', pill: 'Finisher', cap: 'Finish time' });
  });
});
