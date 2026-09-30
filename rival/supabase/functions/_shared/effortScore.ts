// Single server-side Effort formula. Must stay in lockstep with the client
// copy in rival/src/lib/effort.ts — the same activity must score the same no
// matter which entry path (Strava sync, scan, manual) created it.
//
//   Effort = minutes x sport multiplier + metres climbed x sport elevation rate
//
// For distance sports with a distance recorded (2026-10, "mostly distance"):
//   Effort = minutes x distance time rate + km x distance rate
//            + metres climbed x sport elevation rate
// km is credited only up to the sport's fastest believable pace, so a typed
// 20km in 30 minutes earns no more than the pace allows. A distance sport
// with NO distance (spin bike, treadmill without data, a pool session with
// no length count) falls back to minutes x multiplier, so indoor sessions are
// never worse off. Covering more ground in the same time now earns clearly
// more; that is deliberate (Ricky, 2026-09-30, after a board review).
//
// There used to be a "+0.5 per km past 5km" DISTANCE bonus instead. It was
// sport-blind, which made it quietly unfair: 5km is unreachable for a swimmer
// (a 5km swim is an event), trivial for a cyclist (~15 minutes), and a
// rounding error for a runner. Worse, distance isn't effort — you coast
// downhill and it still counts. Removed 2026-09-05.
//
// Elevation replaces it and is a genuinely better proxy, because you cannot
// gain altitude for free. But it is only fair when rated PER SPORT, which is
// why the rate lives in scoring_config alongside the multiplier rather than
// being a constant here. Two cases that must stay at zero:
//   - Swimming: open-water GPS bobbing records ~6m of phantom "gain".
//   - AlpineSki/Snowboard: Strava logs CHAIRLIFT ascent as elevation gain,
//     so a lift-served day would out-earn a mountain run, for sitting down.
// Indoor/virtual used to be a third. Since distance is scored (2026-10), a
// climb slows you down and costs distance, so treadmill incline and Zwift
// climbs are credited like outdoor climbing, to stay even with the outdoors.

export const DEFAULT_MULTIPLIER = 1.0 // was 0.8; +25% with the rest (2026-10)

// Climb allowance. This is a data-integrity guard against altimeter drift and
// typos, NOT a judgement about steep days, so it has to sit above what the
// best humans actually do: the Vertical Kilometre world record is ~1000m in
// 28:53, i.e. ~2075 m/hour, and elite skimo racers hold 1600-1900.
//
// Two earlier versions of this were wrong in the same direction. Capping at a
// FRACTION of the time score clipped a real 1179m hike; then a flat 1500 m/h
// would have clipped a VK racer outright.
//
// The floor exists because a rate alone punishes SHORT steep efforts — a
// 20-minute VK earns only a 833m allowance at 2500 m/h despite genuinely
// climbing 1000m. Anyone can be credited at least FLOOR metres regardless of
// how brief the activity was.
export const MAX_CLIMB_METRES_PER_HOUR = 2500
export const MIN_CLIMB_ALLOWANCE_METRES = 1500

export type ScoringConfig = {
  multipliers: Record<string, number>
  /** Effort per metre climbed, per activity type. Absent = 0 = not credited. */
  elevationRates: Record<string, number>
  /** Distance sports: Effort per minute when a distance is recorded. */
  distanceTimeRates?: Record<string, number>
  /** Distance sports: Effort per km. Absent = 0 = scored on time alone. */
  distanceRates?: Record<string, number>
  /** Distance sports: fastest credited pace, minutes per km. */
  minPaces?: Record<string, number>
}

export function calculateEffortScore(
  activityType: string,
  movingTimeSeconds: number,
  elevationMeters: number,
  config: ScoringConfig,
  distanceMeters = 0,
): number {
  const multiplier = config.multipliers[activityType] ?? DEFAULT_MULTIPLIER
  const minutes = movingTimeSeconds / 60

  const distanceRate = config.distanceRates?.[activityType] ?? 0
  let timeScore = minutes * multiplier
  let distanceScore = 0
  const km = Math.max(0, distanceMeters || 0) / 1000
  if (distanceRate > 0 && km > 0) {
    timeScore = minutes * (config.distanceTimeRates?.[activityType] ?? 0)
    const minPace = config.minPaces?.[activityType] ?? 0
    const creditedKm = minPace > 0 && minutes > 0 ? Math.min(km, minutes / minPace) : km
    distanceScore = creditedKm * distanceRate
  }

  const rate = config.elevationRates[activityType] ?? 0
  const hours = movingTimeSeconds / 3600
  // No duration means no allowance at all, so an activity can never score on
  // elevation alone — the floor only applies once there's some time logged.
  const allowance = hours > 0
    ? Math.max(hours * MAX_CLIMB_METRES_PER_HOUR, MIN_CLIMB_ALLOWANCE_METRES)
    : 0
  const climb = Math.min(Math.max(0, elevationMeters || 0), allowance)
  const elevationScore = climb * rate

  return Math.round((timeScore + distanceScore + elevationScore) * 10) / 10
}

// deno-lint-ignore no-explicit-any
export async function loadScoringConfig(supabase: any): Promise<ScoringConfig> {
  // select('*') rather than naming elevation_rate: PostgREST rejects the
  // WHOLE query if a named column doesn't exist, which would leave every
  // multiplier empty and silently score every activity at DEFAULT_MULTIPLIER.
  // With '*' the function keeps working before the elevation migration has
  // been run, just without elevation credit.
  const { data: configRows } = await supabase
    .from('scoring_config')
    .select('*')
  const multipliers: Record<string, number> = {}
  const elevationRates: Record<string, number> = {}
  const distanceTimeRates: Record<string, number> = {}
  const distanceRates: Record<string, number> = {}
  const minPaces: Record<string, number> = {}
  for (const row of configRows ?? []) {
    multipliers[row.activity_type] = Number(row.multiplier)
    elevationRates[row.activity_type] = Number(row.elevation_rate ?? 0)
    distanceTimeRates[row.activity_type] = Number(row.distance_time_rate ?? 0)
    distanceRates[row.activity_type] = Number(row.distance_rate ?? 0)
    minPaces[row.activity_type] = Number(row.min_pace ?? 0)
  }
  return { multipliers, elevationRates, distanceTimeRates, distanceRates, minPaces }
}
