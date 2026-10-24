// Cross-source duplicate detection for activities. Different providers assign their
// own IDs to the same physical workout (e.g. a Garmin watch auto-exports to Strava,
// and RIVAL might also import from Garmin/WodUp/Apple Health directly some day) — so
// matching by provider_activity_id alone only catches re-syncs from the SAME source.
// This module is the shared entry point every importer should call before inserting.
//
// Everything here is scoped PER USER — the same physical Strava activity ID can
// legitimately exist under two different RIVAL accounts (e.g. a Strava account
// connected to profile A, disconnected, then connected to profile B). Both
// `activities.provider_activity_id` and `activity_sources` carry a per-user unique
// constraint (see supabase/fix_cross_account_dedup.sql) for exactly this reason.

export type ActivityCandidate = {
  userId: string
  provider: string
  providerActivityId: string
  activityType: string
  startedAt: string // ISO
  durationSeconds: number | null
  distanceMeters: number | null
  // Provenance details stored on the activity_sources row (raw_payload column).
  // For Strava this should carry external_id/upload_id/device_name — external_id
  // reveals when a Strava activity was itself uploaded FROM another device/service
  // (e.g. "garmin_ping_123.fit"), which is what will let a future direct Garmin
  // integration match deterministically instead of via the fuzzy time window.
  rawPayload?: Record<string, unknown> | null
}

// Buckets raw provider "type" strings into broad categories so a run never fuzzy-
// matches a lift just because their timestamps happen to overlap.
function activityCategory(activityType: string): string {
  const t = (activityType || '').toLowerCase()
  if (t.includes('swim')) return 'swim'
  if (t.includes('ride') || t.includes('cycl') || t.includes('bike') || t.includes('handcycle')) return 'cycle'
  if (t.includes('row') || t.includes('kayak') || t.includes('canoe') || t.includes('paddl') || t.includes('surf')) return 'water'
  if (t.includes('weight') || t.includes('strength') || t.includes('workout') || t.includes('yoga') || t.includes('crossfit') || t.includes('pilates') || t.includes('elliptical') || t.includes('stair') || t.includes('hiit')) return 'strength'
  return 'foot'
}

const START_WINDOW_MS = 10 * 60 * 1000 // ±10 min — GPS-lock delay / manual-start drift between devices
const DURATION_TOLERANCE_FRAC = 0.10
const DURATION_TOLERANCE_FLOOR_SEC = 180 // short workouts need an absolute floor, not just a %
const DISTANCE_TOLERANCE_FRAC = 0.10

// Resolves which `activities` row (if any) this incoming external activity belongs to,
// for THIS user. Returns the canonical activity id to update, or null if this is
// genuinely new for this user — callers should INSERT a new activities row and then
// call linkNewActivitySource().
// `discard: true` means this activity should not be written at all — it
// overlaps one already recorded and saw less of the session. Callers must skip
// it rather than falling back to an insert.
export type ResolveResult = { canonicalId: string | null; discard: boolean }

export async function resolveCanonicalActivityId(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  candidate: ActivityCandidate,
): Promise<ResolveResult> {
  // Deleted in RIVAL: never import it again (remember_deleted_imports.sql).
  const { data: deleted } = await supabase
    .from('deleted_activity_sources')
    .select('user_id')
    .eq('user_id', candidate.userId)
    .eq('provider', candidate.provider)
    .eq('provider_activity_id', candidate.providerActivityId)
    .maybeSingle()
  if (deleted) return { canonicalId: null, discard: true }

  // Fast path: this exact (user, provider, provider_activity_id) has been seen
  // before — no fuzzy matching needed, just report back which activity it belongs to.
  const { data: existingSource } = await supabase
    .from('activity_sources')
    .select('activity_id')
    .eq('user_id', candidate.userId)
    .eq('provider', candidate.provider)
    .eq('provider_activity_id', candidate.providerActivityId)
    .maybeSingle()
  if (existingSource?.activity_id) {
    // Refresh provenance on re-sync — also backfills raw_payload for source rows
    // created before it was captured (a full-import re-run heals old rows).
    if (candidate.rawPayload) {
      await linkNewActivitySource(supabase, candidate.userId, existingSource.activity_id, candidate.provider, candidate.providerActivityId, candidate.rawPayload)
    }
    return { canonicalId: existingSource.activity_id, discard: false }
  }

  // Slow path: has some OTHER source already recorded the same physical workout
  // for this same user?
  const startedAtMs = new Date(candidate.startedAt).getTime()
  const windowStart = new Date(startedAtMs - START_WINDOW_MS).toISOString()
  const windowEnd = new Date(startedAtMs + START_WINDOW_MS).toISOString()

  const { data: nearby } = await supabase
    .from('activities')
    .select('id, activity_type, distance_meters, duration_seconds, started_at')
    .eq('user_id', candidate.userId)
    .gte('started_at', windowStart)
    .lte('started_at', windowEnd)

  const category = activityCategory(candidate.activityType)
  // deno-lint-ignore no-explicit-any
  const match = (nearby ?? []).find((a: any) => {
    if (activityCategory(a.activity_type) !== category) return false
    if (candidate.durationSeconds != null && a.duration_seconds != null) {
      const tol = Math.max(DURATION_TOLERANCE_FLOOR_SEC, a.duration_seconds * DURATION_TOLERANCE_FRAC)
      if (Math.abs(a.duration_seconds - candidate.durationSeconds) > tol) return false
    }
    if (candidate.distanceMeters != null && a.distance_meters != null && a.distance_meters > 0) {
      const tol = a.distance_meters * DISTANCE_TOLERANCE_FRAC
      if (Math.abs(a.distance_meters - candidate.distanceMeters) > tol) return false
    }
    return true
  })

  // No fuzzy match — but a person cannot be doing two activities of the same
  // kind at the same time. A watch that restarts mid-session, or a phone
  // recording alongside the watch, produces genuinely different Strava
  // activities: different ids, starts tens of minutes apart, different
  // distances. The matcher above correctly says they are not the same
  // recording, and they still can't both have happened. Left unguarded, one
  // 40-minute run arrived as five overlapping runs worth 2.5x the Effort
  // actually earned, which distorts the leaderboard rather than merely
  // cluttering the feed.
  //
  // Resolved in favour of the LONGEST recording — the one that saw most of the
  // session. This function does not rewrite the row itself: callers overwrite
  // the canonical row with the incoming activity's freshly scored fields, so
  // returning the clash id is already how a longer recording wins. A shorter
  // one has to be refused outright, which is what `discard` is for.
  if (!match && candidate.durationSeconds) {
    const candStart = startedAtMs
    const candEnd = candStart + candidate.durationSeconds * 1000
    // Wider than the fuzzy window: an overlapping recording can start well
    // outside ±10 min and still overlap, so look back by the longest plausible
    // session instead.
    const lookback = new Date(candStart - 6 * 60 * 60 * 1000).toISOString()
    const lookahead = new Date(candEnd + 6 * 60 * 60 * 1000).toISOString()
    const { data: nearbyDay } = await supabase
      .from('activities')
      .select('id, activity_type, duration_seconds, started_at')
      .eq('user_id', candidate.userId)
      .gte('started_at', lookback)
      .lte('started_at', lookahead)

    // deno-lint-ignore no-explicit-any
    const clash = (nearbyDay ?? []).find((a: any) => {
      if (activityCategory(a.activity_type) !== category) return false
      if (!a.duration_seconds) return false
      const aStart = new Date(a.started_at).getTime()
      const aEnd = aStart + a.duration_seconds * 1000
      return candStart < aEnd && aStart < candEnd
    })

    if (clash) {
      // Either way the source is recorded, so a re-sync takes the fast path
      // instead of re-deciding this every time.
      await linkNewActivitySource(supabase, candidate.userId, clash.id, candidate.provider, candidate.providerActivityId, candidate.rawPayload)
      return candidate.durationSeconds > (clash.duration_seconds as number)
        ? { canonicalId: clash.id, discard: false }
        : { canonicalId: null, discard: true }
    }
  }

  if (match) {
    // Link this source to the existing activity so future syncs from it take the fast path.
    await linkNewActivitySource(supabase, candidate.userId, match.id, candidate.provider, candidate.providerActivityId, candidate.rawPayload)

    // The canonical row is whichever source arrived first, which isn't necessarily the
    // more complete one (e.g. a Garmin-derived Strava activity with no distance beats a
    // manually-entered Strava activity that has it, purely by sync timing). Backfill any
    // field the canonical row is missing rather than silently losing data a later source did have.
    const backfill: Record<string, unknown> = {}
    if (!match.distance_meters && candidate.distanceMeters) backfill.distance_meters = candidate.distanceMeters
    if (!match.duration_seconds && candidate.durationSeconds) backfill.duration_seconds = candidate.durationSeconds
    if (Object.keys(backfill).length > 0) {
      await supabase.from('activities').update(backfill).eq('id', match.id)
    }

    return { canonicalId: match.id, discard: false }
  }

  return { canonicalId: null, discard: false }
}

// Records which source an activity came from. Call once right after inserting a
// brand-new activities row, and also from resolveCanonicalActivityId() when a fuzzy
// match links a new source to an existing activity.
export async function linkNewActivitySource(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  activityId: string,
  provider: string,
  providerActivityId: string,
  rawPayload?: Record<string, unknown> | null,
): Promise<void> {
  const row: Record<string, unknown> = { user_id: userId, activity_id: activityId, provider, provider_activity_id: providerActivityId }
  if (rawPayload) row.raw_payload = rawPayload
  await supabase.from('activity_sources').upsert(row, { onConflict: 'user_id,provider,provider_activity_id' })
}
