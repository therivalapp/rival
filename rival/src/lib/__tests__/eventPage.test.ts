import { describe, expect, it } from 'vitest';
import { byDay, cleanPlacings, eventKind, halves, hyroxRows, ordinal, paceBars, raceEfforts, shownPlacings, transitionTimes } from '../eventPage';

const day = (iso: string) => iso.slice(0, 10);
const leg = (id: string, at: string, extra: Record<string, unknown> = {}) =>
  ({ id, activity_type: 'Run', started_at: at, duration_seconds: 600, distance_meters: 0, ...extra });

describe('ordinal', () => {
  it('reads like a place', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 112, 1240].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th', '1,240th']);
  });
});

describe('eventKind', () => {
  it('picks the layout from the activities', () => {
    expect(eventKind('Run', [leg('a', '2026-11-01T08:00', { distance_meters: 42195 })], day)).toBe('race');
    expect(eventKind('HYROX', [leg('a', '2026-10-24T08:00', { activity_type: 'Hyrox' })], day)).toBe('hyrox');
    expect(eventKind('CrossFit', [leg('a', '2026-08-14T08:00'), leg('b', '2026-08-15T08:00')], day)).toBe('days');
    expect(eventKind('Triathlon', [leg('a', '2026-03-01T08:00', { distance_meters: 1500 }), leg('b', '2026-03-01T09:00', { distance_meters: 40000 })], day)).toBe('legs');
  });
});

describe('placings', () => {
  it('keeps rows with a place and drops blank ranks', () => {
    const p = cleanPlacings({ rows: [{ key: 'overall', category: ' ', place: 214, of: 3100 }, { key: 'age', place: null }], parts: { st1: 45, st2: null } });
    expect(p).toEqual({ rows: [{ key: 'overall', category: null, place: 214, of: 3100 }], parts: { st1: 45 } });
    expect(cleanPlacings({ rows: [{ key: 'age', place: null }] })).toBeNull();
    expect(shownPlacings(p)).toHaveLength(1);
  });
});

describe('a race', () => {
  const splits = [300, 290, 280, 270].map((s) => ({ seconds: s, distance: 1000 }));
  it('splits the time into halves', () => {
    expect(halves(splits)).toEqual({ first: 590, second: 550, firstM: 2000, secondM: 2000 });
  });
  it('gives pace per full km only', () => {
    expect(paceBars([...splits, { seconds: 30, distance: 195 }])).toEqual([300, 290, 280, 270]);
  });
  it('lists efforts inside the race, never the whole race', () => {
    const best = [
      { name: '5K', seconds: 1300, distance: 5000 }, { name: '10K', seconds: 2700, distance: 10000 },
      { name: 'Half-Marathon', seconds: 5900, distance: 21097 }, { name: 'Marathon', seconds: 12025, distance: 42195 },
    ];
    expect(raceEfforts(best, 42195).map((e) => e.label)).toEqual(['5 km', '10 km', 'Half']);
  });
});

describe('HYROX rows', () => {
  it('pairs each run with its station and adds up the Roxzone around it', () => {
    // Run 1, into Roxzone, SkiErg, out of Roxzone, Run 2 ...
    const laps = [300, 330, 590, 610, 900, 925, 1105];
    const rows = hyroxRows(laps, true);
    expect(rows[0]).toEqual({ n: 1, station: 'SkiErg', metres: '1,000 m', run: 300, time: 260, rox: 50 });
    expect(rows[1]).toMatchObject({ n: 2, station: 'Sled push', run: 290, time: 180 });
  });
});

describe('byDay', () => {
  it('groups activities by day in order', () => {
    const g = byDay([leg('b', '2026-08-15T09:00'), leg('a', '2026-08-14T09:00'), leg('c', '2026-08-15T14:00')], day);
    expect(g.map((d) => [d.day, d.legs.map((l) => l.id), d.seconds])).toEqual([['2026-08-14', ['a'], 600], ['2026-08-15', ['b', 'c'], 1200]]);
  });
});

describe('transitionTimes', () => {
  // 39:50 swim, 1:37:28 bike, 51:28 run = 3:08:46 of legs; finish 3:14:20.
  const legs = 2390 + 5848 + 3088;

  it('totals the transitions from the finish and fills the last one in', () => {
    const t = transitionTimes([168, null], 2, 11660, legs);
    expect(t.total).toBe(334);
    expect(t.list).toEqual([{ seconds: 168, filled: false }, { seconds: 166, filled: true }]);
  });

  it('fills whichever one is missing', () => {
    expect(transitionTimes([null, 166], 2, 11660, legs).list[0]).toEqual({ seconds: 168, filled: true });
  });

  it('gives only the total when neither was entered', () => {
    const t = transitionTimes(null, 2, 11660, legs);
    expect(t.total).toBe(334);
    expect(t.list.every((x) => x.seconds == null)).toBe(true);
  });

  it('adds up entered transitions when there is no official finish', () => {
    expect(transitionTimes([168, 166], 2, null, legs).total).toBe(334);
    expect(transitionTimes([168, null], 2, null, legs).total).toBeNull();
  });

  it('has none for a single leg', () => {
    expect(transitionTimes([1], 0, 100, 50)).toEqual({ list: [], total: null });
  });
});
