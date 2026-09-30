import { describe, it, expect } from 'vitest';
import {
  buildDayRollups,
  mergeRollups,
  rollsUpIntoDayCard,
  localDayKey,
  type RollupRow,
} from '../dayRollup';

// Built from LOCAL components, because grouping is by the viewer's local day
// and this suite runs in TZ=Pacific/Auckland for the streak tests. A literal
// "…T06:00:00Z" and "…T18:00:00Z" are the same UTC day but different local
// days at UTC+12, so hard-coded Z-times would assert the wrong thing.
function atLocal(year: number, month: number, day: number, hour: number): string {
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

function walk(id: string, startedAt: string, seconds: number, xp: number, over: Partial<RollupRow> = {}): RollupRow {
  return {
    id,
    user_id: 'u1',
    activity_type: 'Walk',
    provider: 'strava',
    started_at: startedAt,
    duration_seconds: seconds,
    effort_score: xp,
    ...over,
  };
}

describe('rollsUpIntoDayCard', () => {
  it('gathers auto-synced walks', () => {
    expect(rollsUpIntoDayCard({ activity_type: 'Walk', provider: 'strava' })).toBe(true);
    expect(rollsUpIntoDayCard({ activity_type: 'walk', provider: 'garmin' })).toBe(true);
  });

  it('leaves a manually logged walk its own card', () => {
    // Someone who opened the app to record a walk decided it was worth
    // recording — that is the whole distinction.
    expect(rollsUpIntoDayCard({ activity_type: 'Walk', provider: 'manual' })).toBe(false);
    expect(rollsUpIntoDayCard({ activity_type: 'Walk', provider: 'rival_manual' })).toBe(false);
  });

  it('gathers a walk you were added to, the same as your own', () => {
    // The walk was just as incidental from this person's side — they confirmed
    // a question rather than deciding to log a session.
    expect(rollsUpIntoDayCard({ activity_type: 'Walk', provider: 'shared' })).toBe(true);
  });

  it('still leaves a shared RUN its own card', () => {
    expect(rollsUpIntoDayCard({ activity_type: 'Run', provider: 'shared' })).toBe(false);
  });

  it('never gathers anything that is not a walk, however short', () => {
    expect(rollsUpIntoDayCard({ activity_type: 'Run', provider: 'strava' })).toBe(false);
    expect(rollsUpIntoDayCard({ activity_type: 'Ride', provider: 'strava' })).toBe(false);
  });

  it('survives missing fields rather than throwing', () => {
    expect(rollsUpIntoDayCard({ activity_type: null, provider: null })).toBe(false);
  });
});

describe('buildDayRollups', () => {
  it('gathers one person\'s walks on one day into a single card', () => {
    const rolled = buildDayRollups([
      walk('a', atLocal(2026, 9, 23, 6), 600, 10),
      walk('b', atLocal(2026, 9, 23, 12), 900, 15),
      walk('c', atLocal(2026, 9, 23, 18), 300, 5),
    ]);
    expect(rolled).toHaveLength(1);
    expect(rolled[0].count).toBe(3);
    expect(rolled[0].totalSeconds).toBe(1800);
    expect(rolled[0].xp).toBe(30);
  });

  it('keeps different days apart', () => {
    const rolled = buildDayRollups([
      walk('a', atLocal(2026, 9, 23, 6), 600, 10),
      walk('b', atLocal(2026, 9, 24, 6), 600, 10),
    ]);
    expect(rolled).toHaveLength(2);
  });

  it('keeps different people apart on the same day', () => {
    const rolled = buildDayRollups([
      walk('a', atLocal(2026, 9, 23, 6), 600, 10),
      walk('b', atLocal(2026, 9, 23, 7), 600, 10, { user_id: 'u2' }),
    ]);
    expect(rolled).toHaveLength(2);
    expect(new Set(rolled.map((r) => r.userId))).toEqual(new Set(['u1', 'u2']));
  });

  it('settles at the day\'s FIRST walk so the card never jumps up the feed', () => {
    const rolled = buildDayRollups([
      walk('late', atLocal(2026, 9, 23, 18), 300, 5),
      walk('early', atLocal(2026, 9, 23, 6), 600, 10),
    ]);
    expect(rolled[0].ts).toBe(atLocal(2026, 9, 23, 6));
  });

  it('says "walk" for one and "walks" for several', () => {
    expect(buildDayRollups([walk('a', atLocal(2026, 9, 23, 6), 600, 10)])[0].typeLabel).toBe('walk');
    expect(buildDayRollups([
      walk('a', atLocal(2026, 9, 23, 6), 600, 10),
      walk('b', atLocal(2026, 9, 23, 7), 600, 10),
    ])[0].typeLabel).toBe('walks');
  });

  it('treats missing duration and effort as zero rather than NaN', () => {
    const rolled = buildDayRollups([walk('a', atLocal(2026, 9, 23, 6), 0, 0, { duration_seconds: null, effort_score: null })]);
    expect(rolled[0].totalSeconds).toBe(0);
    expect(rolled[0].xp).toBe(0);
  });

  it('gives the same person and day a stable id across rebuilds', () => {
    const a = buildDayRollups([walk('a', atLocal(2026, 9, 23, 6), 600, 10)])[0];
    const b = buildDayRollups([walk('b', atLocal(2026, 9, 23, 9), 600, 10)])[0];
    expect(a.id).toBe(b.id);
  });
});

describe('mergeRollups', () => {
  it('adds a later page\'s walks to a card already on screen', () => {
    const first = buildDayRollups([walk('a', atLocal(2026, 9, 23, 12), 600, 10)])[0];
    const second = buildDayRollups([walk('b', atLocal(2026, 9, 23, 6), 900, 15)])[0];
    const merged = mergeRollups(first, second);
    expect(merged.count).toBe(2);
    expect(merged.totalSeconds).toBe(1500);
    expect(merged.xp).toBe(25);
  });

  it('keeps the earliest start when a later page reveals an earlier walk', () => {
    const first = buildDayRollups([walk('a', atLocal(2026, 9, 23, 12), 600, 10)])[0];
    const second = buildDayRollups([walk('b', atLocal(2026, 9, 23, 6), 900, 15)])[0];
    expect(mergeRollups(first, second).ts).toBe(atLocal(2026, 9, 23, 6));
  });

  // The reason parts are kept at all. `loadingMore` is React state, so two
  // scroll events in one tick can both pass the guard and fold the same page
  // in twice; summing totals would silently double someone's walk count.
  it('is idempotent — folding the same page in twice changes nothing', () => {
    const page = buildDayRollups([
      walk('a', atLocal(2026, 9, 23, 6), 600, 10),
      walk('b', atLocal(2026, 9, 23, 12), 900, 15),
    ])[0];
    const once = mergeRollups(page, page);
    const twice = mergeRollups(once, page);
    expect(once.count).toBe(2);
    expect(twice.count).toBe(2);
    expect(twice.totalSeconds).toBe(1500);
    expect(twice.xp).toBe(25);
  });

  it('rounds Effort to one decimal rather than accumulating float noise', () => {
    const first = buildDayRollups([walk('a', atLocal(2026, 9, 23, 6), 60, 0.1)])[0];
    const second = buildDayRollups([walk('b', atLocal(2026, 9, 23, 7), 60, 0.2)])[0];
    expect(mergeRollups(first, second).xp).toBe(0.3);
  });
});

describe('localDayKey', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(localDayKey(atLocal(2026, 9, 23, 6))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('pads single-digit months and days', () => {
    expect(localDayKey(atLocal(2026, 1, 5, 12))).toBe('2026-01-05');
  });
});
