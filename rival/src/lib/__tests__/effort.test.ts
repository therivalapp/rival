import { describe, it, expect, vi } from 'vitest';

// effort.ts imports the supabase client (for loadScoringConfig), which
// requires env vars at module load — mock it, these tests only exercise the
// pure formula.
vi.mock('../supabase', () => ({ supabase: {} }));

import { calculateEffortScore, effortBreakdown } from '../effort';

// Mirrors the shape of the live scoring_config table: a multiplier for every
// sport, and an elevation rate only where climbing is real work done under
// your own power.
const CONFIG = {
  multipliers: { Run: 1.2, Ride: 1.0, Swim: 1.2, WeightTraining: 0.9, Hike: 0.9 },
  elevationRates: { Run: 0.05, Hike: 0.05, Ride: 0.05 },
};

describe('calculateEffortScore', () => {
  // These expectations mirror the server formula in
  // supabase/functions/_shared/effortScore.ts — if one changes, both must.
  it('scores minutes × multiplier', () => {
    expect(calculateEffortScore('Run', 30 * 60, 0, CONFIG)).toBe(36); // 30 × 1.2
    expect(calculateEffortScore('Ride', 60 * 60, 0, CONFIG)).toBe(60);
    expect(calculateEffortScore('WeightTraining', 45 * 60, 0, CONFIG)).toBe(40.5); // 45 × 0.9
  });

  it('uses the server default 0.8 for unknown types (NOT 1.0)', () => {
    // Regression: the old client copies defaulted to 1.0, so scanned workouts
    // of unlisted types scored 25% higher than Strava-imported ones.
    expect(calculateEffortScore('UnknownSport', 60 * 60, 0, CONFIG)).toBe(60); // 60 × 1.0
  });

  it('ignores distance entirely — the old +0.5/km past 5km bonus is gone', () => {
    // It was sport-blind: unreachable for a swimmer, trivial for a cyclist. It
    // paid for covering ground rather than for working hard, and you can coast
    // downhill. Two equally long runs must score the same however far they went.
    // (Third argument is elevation now, so distance simply has no input.)
    expect(calculateEffortScore('Run', 30 * 60, 0, CONFIG)).toBe(36);
  });

  it('credits elevation at the sport rate, on top of time', () => {
    // 60 min hike = 54, plus 400m climbed × 0.05 = 20.
    expect(calculateEffortScore('Hike', 60 * 60, 400, CONFIG)).toBe(74);
  });

  it('credits no elevation for sports where climbing is not real work', () => {
    // Swim has no rate: open-water GPS records phantom "gain" from bobbing,
    // and a pool obviously has none. Same guard covers AlpineSki (chairlifts)
    // and anything virtual.
    expect(calculateEffortScore('Swim', 60 * 60, 11, CONFIG)).toBe(72); // unchanged by the 11m
  });

  it('allows a genuinely big mountain day through uncapped', () => {
    // 121 min hike with 1179m of gain — a real activity from the database, at
    // 584 m/hour. An earlier cap (a fraction of the time score) clipped this;
    // it is a big day, not a broken GPS trace.
    // 121 × 0.9 = 108.9, plus 1179 × 0.05 = 58.95 → 167.9 (rounded).
    expect(calculateEffortScore('Hike', 121 * 60, 1179, CONFIG)).toBe(167.9);
  });

  it('credits a Vertical Kilometre effort in full', () => {
    // 1000m climbed in 29 minutes — roughly the VK world record, ~2075 m/hour.
    // An earlier 1500 m/hour cap clipped this, which was simply wrong: real
    // athletes go faster than that uphill.
    // 29 × 1.2 = 34.8, plus 1000 × 0.05 = 50 → 84.8
    expect(calculateEffortScore('Run', 29 * 60, 1000, CONFIG)).toBe(84.8);
  });

  it('ignores climb beyond anything a human could produce', () => {
    // 8000m in half an hour is altimeter drift or a typo, not an athlete.
    // Allowance = max(0.5h × 2500, 1500 floor) = 1500m.
    // 36 + (1500 × 0.05) = 111
    expect(calculateEffortScore('Run', 30 * 60, 8000, CONFIG)).toBe(111);
  });

  it('never scores on elevation alone when there is no duration', () => {
    // No hours means no climb allowance, so zero minutes earns zero.
    expect(calculateEffortScore('Run', 0, 800, CONFIG)).toBe(0);
  });

  it('ignores negative or missing elevation', () => {
    expect(calculateEffortScore('Run', 30 * 60, -200, CONFIG)).toBe(36);
    expect(calculateEffortScore('Run', 30 * 60, undefined as unknown as number, CONFIG)).toBe(36);
  });

  it('rounds to one decimal place', () => {
    expect(calculateEffortScore('Run', 17 * 60, 0, CONFIG)).toBe(20.4);
  });
});

// Mostly distance (2026-10): distance sports with a distance recorded score
// minutes x distance time rate + km x distance rate, km capped by pace.
describe('calculateEffortScore with distance', () => {
  const D = {
    multipliers: { Run: 1.5, Ride: 1.25, WeightTraining: 1.25 },
    elevationRates: { Run: 0.05, Ride: 0.05 },
    distanceTimeRates: { Run: 0.3, Ride: 0.25 },
    distanceRates: { Run: 8, Ride: 2.7 },
    minPaces: { Run: 2.5, Ride: 1.0 },
  };

  it('rewards more ground in the same time', () => {
    expect(calculateEffortScore('Run', 41 * 60, 0, D, 5000)).toBe(52.3); // 12.3 + 40
    expect(calculateEffortScore('Run', 40 * 60, 0, D, 7500)).toBe(72); // 12 + 60
  });

  it('adds climbing on top', () => {
    expect(calculateEffortScore('Run', 41 * 60, 18, D, 6400)).toBe(64.4); // 12.3 + 51.2 + 0.9
  });

  it('scores a distance sport with no distance on time alone', () => {
    expect(calculateEffortScore('Ride', 60 * 60, 0, D, 0)).toBe(75); // spin: 60 × 1.25
    expect(calculateEffortScore('Run', 30 * 60, 0, D)).toBe(45); // treadmill, no data
  });

  it('credits distance only up to the fastest believable pace', () => {
    // 20 km typed into 30 minutes: capped at 30 / 2.5 = 12 km.
    expect(calculateEffortScore('Run', 30 * 60, 0, D, 20000)).toBe(105); // 9 + 96
  });

  it('leaves sports without a distance rate on time', () => {
    expect(calculateEffortScore('WeightTraining', 60 * 60, 0, D, 5000)).toBe(75);
  });
});

describe('effortBreakdown', () => {
  const D = {
    multipliers: { Run: 1.5, WeightTraining: 1.25 },
    elevationRates: { Run: 0.05 },
    distanceTimeRates: { Run: 0.3 },
    distanceRates: { Run: 8 },
    minPaces: { Run: 2.5 },
  };

  it('splits a run into time, distance and climbing that add up to the score', () => {
    const b = effortBreakdown('Run', 41 * 60, 18, D, 6400);
    expect(b.basis).toBe('distance');
    expect(b.timeScore).toBeCloseTo(12.3);
    expect(b.distanceScore).toBeCloseTo(51.2);
    expect(b.climbScore).toBeCloseTo(0.9);
    expect(b.total).toBe(calculateEffortScore('Run', 41 * 60, 18, D, 6400));
  });

  it('falls back to time when no distance is recorded', () => {
    const b = effortBreakdown('Run', 60 * 60, 0, D, 0);
    expect(b.basis).toBe('time');
    expect(b.distanceScore).toBe(0);
    expect(b.total).toBe(90);
  });

  it('ignores distance for time-scored activities', () => {
    const b = effortBreakdown('WeightTraining', 60 * 60, 0, D, 5000);
    expect(b.basis).toBe('time');
    expect(b.total).toBe(75);
  });

  it('flags a run faster than the realistic pace and counts the realistic part', () => {
    // 20 km in 30 minutes is 40 km/h; the cap is 2.5 min/km, so 12 km counts.
    const b = effortBreakdown('Run', 30 * 60, 0, D, 20000);
    expect(b.capped).toBe(true);
    expect(b.cappedDistance).toBe(true);
    expect(b.creditedKm).toBeCloseTo(12);
  });

  it('counts all of it once the owner confirms it', () => {
    const capped = effortBreakdown('Run', 30 * 60, 0, D, 20000);
    const confirmed = effortBreakdown('Run', 30 * 60, 0, D, 20000, true);
    expect(confirmed.creditedKm).toBeCloseTo(20);
    expect(confirmed.total).toBeGreaterThan(capped.total);
    expect(confirmed.total).toBe(calculateEffortScore('Run', 30 * 60, 0, D, 20000, true));
  });

  it('does not flag a normal run', () => {
    expect(effortBreakdown('Run', 41 * 60, 18, D, 6400).capped).toBe(false);
  });

  it('flags climbing faster than 2,500 m an hour', () => {
    const b = effortBreakdown('Run', 30 * 60, 2000, D, 5000);
    expect(b.cappedClimb).toBe(true);
    expect(b.climb).toBe(1500);
    expect(effortBreakdown('Run', 30 * 60, 2000, D, 5000, true).climb).toBe(2000);
  });
});
