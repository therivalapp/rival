import { supabase } from './supabase';

// The scoring_config table is the single source of truth for multipliers and
// elevation rates — the Strava edge functions read it on every import. Client
// entry paths (scan-workout, weekly-scan, manual-entry) MUST score from the
// same table, or the same workout earns different Effort depending on how it
// entered the app.
//
// This snapshot is only the offline/failed-fetch fallback (matches the live
// table as of 2026-09-05); the fetched values always win.
// Multipliers are the time-only rate. Raised 25% on 2026-10 so an hour in the
// gym keeps level with an hour of running under the distance formula.
const FALLBACK_MULTIPLIERS: Record<string, number> = {
  AlpineSki: 1.0, CrossFit: 1.625, EBikeRide: 0.875, Elliptical: 1.125,
  Bootcamp: 1.5625, GravelRide: 1.375, HIIT: 1.625, Hike: 1.125, Hyrox: 1.625, Kayaking: 1.0,
  MountainBikeRide: 1.375, NordicSki: 1.5625, Pilates: 1.0, Ride: 1.25,
  Rowing: 1.5, Run: 1.5, Snowboard: 1.0, StandUpPaddling: 0.875, Surfing: 1.0,
  Swim: 1.5, TrailRun: 1.5625, VirtualRide: 1.25, VirtualRow: 1.5, VirtualRun: 1.5,
  Walk: 0.75, WeightTraining: 1.25, Workout: 1.125, Yoga: 0.8125,
};

// Distance sports: [Effort per minute when a distance is recorded, Effort per
// km, fastest credited pace in min/km]. Mirrors scoring_config.
const FALLBACK_DISTANCE: Record<string, [number, number, number]> = {
  Run: [0.3, 8.0, 2.5], TrailRun: [0.3, 8.0, 2.5], Walk: [0.15, 7.3, 5], Hike: [0.23, 14.0, 5],
  Ride: [0.25, 2.7, 1.0], MountainBikeRide: [0.28, 4.3, 1.2], GravelRide: [0.28, 3.7, 1.0],
  EBikeRide: [0.18, 1.9, 1.0], Swim: [0.3, 47.0, 10],
  VirtualRun: [0.3, 8.0, 2.5], VirtualRide: [0.25, 2.7, 1.0], Rowing: [0.3, 6.7, 2.8], VirtualRow: [0.3, 6.7, 2.8],
  NordicSki: [0.31, 8.3, 2.0], Snowshoe: [0.25, 16.7, 5.0], Kayaking: [0.2, 7.1, 3.0], Canoeing: [0.2, 8.0, 3.0],
  StandUpPaddling: [0.18, 7.8, 4.0], InlineSkate: [0.23, 3.0, 1.2],
};
const fallbackPart = (i: 0 | 1 | 2) =>
  Object.fromEntries(Object.entries(FALLBACK_DISTANCE).map(([k, v]) => [k, v[i]]));

// Effort per metre climbed. Anything absent is 0 — elevation is only credited
// where it represents work done against gravity under your own power. See the
// note in supabase/functions/_shared/effortScore.ts for why swimming, downhill
// skiing and anything virtual are deliberately excluded.
const FALLBACK_ELEVATION_RATES: Record<string, number> = {
  Run: 0.05, TrailRun: 0.05, Hike: 0.05, Walk: 0.05,
  Ride: 0.05, MountainBikeRide: 0.05, GravelRide: 0.05,
  NordicSki: 0.05,
  EBikeRide: 0.02, // assisted, but the rider still contributes on a climb
  VirtualRun: 0.05, VirtualRide: 0.05, // treadmill incline, Zwift climbs (2026-10)
};

// Same unknown-type default the edge functions use.
export const DEFAULT_MULTIPLIER = 1.0; // was 0.8; +25% with the rest (2026-10)

// Keep in lockstep with the edge functions. See the note there: the rate sits
// above the Vertical Kilometre world record (~2075 m/hour), and the floor
// stops a short steep effort being clipped by the rate alone.
const MAX_CLIMB_METRES_PER_HOUR = 2500;
const MIN_CLIMB_ALLOWANCE_METRES = 1500;

export type ScoringConfig = {
  multipliers: Record<string, number>;
  elevationRates: Record<string, number>;
  /** Distance sports: Effort per minute when a distance is recorded. */
  distanceTimeRates?: Record<string, number>;
  /** Distance sports: Effort per km. Absent = scored on time alone. */
  distanceRates?: Record<string, number>;
  /** Distance sports: fastest credited pace, minutes per km. */
  minPaces?: Record<string, number>;
};

let cached: ScoringConfig | null = null;

export async function loadScoringConfig(): Promise<ScoringConfig> {
  if (cached) return cached;
  // select('*'), not a named column list — PostgREST fails the whole query on
  // an unknown column, so naming elevation_rate would drop the app to
  // FALLBACK_MULTIPLIERS everywhere until the migration is run.
  const { data } = await supabase.from('scoring_config').select('*');
  if (!data || data.length === 0) {
    return {
      multipliers: FALLBACK_MULTIPLIERS, elevationRates: FALLBACK_ELEVATION_RATES,
      distanceTimeRates: fallbackPart(0), distanceRates: fallbackPart(1), minPaces: fallbackPart(2),
    };
  }
  const multipliers: Record<string, number> = {};
  const elevationRates: Record<string, number> = {};
  const distanceTimeRates: Record<string, number> = {};
  const distanceRates: Record<string, number> = {};
  const minPaces: Record<string, number> = {};
  for (const row of data) {
    multipliers[row.activity_type] = Number(row.multiplier);
    elevationRates[row.activity_type] = Number(row.elevation_rate ?? 0);
    distanceTimeRates[row.activity_type] = Number(row.distance_time_rate ?? 0);
    distanceRates[row.activity_type] = Number(row.distance_rate ?? 0);
    minPaces[row.activity_type] = Number(row.min_pace ?? 0);
  }
  cached = { multipliers, elevationRates, distanceTimeRates, distanceRates, minPaces };
  return cached;
}

// Must stay in lockstep with calculateEffortScore in the Strava edge functions
// (strava-webhook / strava-full-import / strava-backfill):
//   Effort = minutes x multiplier + metres climbed x elevation rate, capped;
//   distance sports with a distance add km x distance rate (see the server).
//
// There used to be an extra `intensity` percentage here, applied only on the
// client paths. It broke the one invariant this file exists to protect: a
// 60-minute run typed in by hand scored 36 while the SAME run synced from
// Strava scored 72, because manual-entry hardcoded intensity=50 and the
// server formula has no intensity concept at all. Verified in the data —
// hand-entered runs sat at 0.60 Effort/minute against Strava's 1.22.
//
// Removed rather than defaulted to 100, because the only real source of an
// intensity value was a guess the AI made from a photo, and no photo-derived
// guess should be able to halve or double what an activity is worth.
export type EffortBreakdown = {
  /** 'distance' when the sport's distance formula applied, else 'time'. */
  basis: 'distance' | 'time';
  minutes: number;
  timeRate: number;
  timeScore: number;
  km: number;
  /** Km counted after the fastest-pace cap. */
  creditedKm: number;
  distanceRate: number;
  distanceScore: number;
  /** Metres credited after the climb allowance. */
  climb: number;
  climbRate: number;
  climbScore: number;
  total: number;
  /** Metres climbed as recorded, before the allowance. */
  recordedClimb: number;
  /** The sport's fastest credited pace, minutes per km (0 = none). */
  minPace: number;
  /** True when the distance or the climbing went past what's realistic, so
   *  less was counted. The athlete is asked to review it; once they confirm
   *  it (`uncapped`), nothing is held back. */
  capped: boolean;
  cappedDistance: boolean;
  cappedClimb: boolean;
};

// The parts behind an Effort figure, for the breakdown sheet. The total is
// exactly calculateEffortScore's result.
export function effortBreakdown(
  activityType: string,
  durationSeconds: number,
  elevationMeters: number,
  config: ScoringConfig,
  distanceMeters = 0,
  /** The athlete confirmed the activity is correct: count it all. */
  uncapped = false,
): EffortBreakdown {
  const multiplier = config.multipliers[activityType] ?? DEFAULT_MULTIPLIER;
  const minutes = Math.max(0, durationSeconds || 0) / 60;

  // Distance sports with a distance: mostly distance, credited up to the
  // sport's fastest believable pace. No distance: time alone, as before.
  const distanceRate = config.distanceRates?.[activityType] ?? 0;
  const km = Math.max(0, distanceMeters || 0) / 1000;
  const basis = distanceRate > 0 && km > 0 ? 'distance' : 'time';
  let timeRate = multiplier;
  let creditedKm = 0;
  let minPace = 0;
  let cappedDistance = false;
  if (basis === 'distance') {
    timeRate = config.distanceTimeRates?.[activityType] ?? 0;
    minPace = config.minPaces?.[activityType] ?? 0;
    const realistic = minPace > 0 && minutes > 0 ? minutes / minPace : km;
    cappedDistance = km > realistic + 0.005;
    creditedKm = uncapped ? km : Math.min(km, realistic);
  }
  const timeScore = minutes * timeRate;
  const distanceScore = creditedKm * distanceRate;

  const climbRate = config.elevationRates[activityType] ?? 0;
  const hours = minutes / 60;
  const allowance = hours > 0
    ? Math.max(hours * MAX_CLIMB_METRES_PER_HOUR, MIN_CLIMB_ALLOWANCE_METRES)
    : 0;
  const recordedClimb = Math.max(0, elevationMeters || 0);
  // Only "too fast" counts as a cap to review: with no time logged there is
  // no allowance at all, which is a missing duration, not a glitch.
  const cappedClimb = hours > 0 && climbRate > 0 && recordedClimb > allowance + 0.5;
  const climb = uncapped && hours > 0 ? recordedClimb : Math.min(recordedClimb, allowance);
  const climbScore = climb * climbRate;

  return {
    basis, minutes, timeRate, timeScore,
    km, creditedKm, distanceRate: basis === 'distance' ? distanceRate : 0, distanceScore,
    climb, climbRate, climbScore,
    total: Math.round((timeScore + distanceScore + climbScore) * 10) / 10,
    recordedClimb, minPace,
    capped: cappedDistance || cappedClimb, cappedDistance, cappedClimb,
  };
}

export function calculateEffortScore(
  activityType: string,
  durationSeconds: number,
  elevationMeters: number,
  config: ScoringConfig,
  distanceMeters = 0,
  uncapped = false,
): number {
  return effortBreakdown(activityType, durationSeconds, elevationMeters, config, distanceMeters, uncapped).total;
}
