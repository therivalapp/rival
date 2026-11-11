import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCanonicalActivityId, linkNewActivitySource } from '../_shared/activityDedup.ts'
import { calculateEffortScore, loadScoringConfig } from '../_shared/effortScore.ts'
import { normaliseActivityType } from '../_shared/activityType.ts'
import { saveActivityRoute } from '../_shared/activityRoute.ts'
import { garminType, samplesToPolyline } from '../_shared/garmin.ts'

// Garmin push endpoint (Activity API, push mode), set per summary type in
// Garmin's API Configuration Tool as
//   .../functions/v1/garmin-webhook/<GARMIN_WEBHOOK_TOKEN>
// Deployed with --no-verify-jwt. Garmin sends no signature, so the token in
// the address and a known Garmin user id are both required.
//
// Handles:
//   activities            summaries: create or link the activity
//   manuallyUpdatedActivities  edited in Garmin Connect: same as activities
//   activityDetails       summary plus samples: same, and the route
//   deregistrations       the member disconnected in Garmin Connect
//   userPermissionsChange the member turned off activity sharing
// Every activity goes through the shared matcher, so one already in RIVAL
// (recorded with Start, from Apple Health or a Garmin data download) is
// linked, not copied. Garmin expects a quick 200; failures are logged.

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null)

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  // The token is the last part of the address (Garmin's tool drops anything
  // after a "?"); ?k= still works for manual tests.
  const token = Deno.env.get('GARMIN_WEBHOOK_TOKEN') ?? ''
  const u = new URL(req.url)
  const given = u.searchParams.get('k') ?? u.pathname.split('/').filter(Boolean).pop() ?? ''
  if (!token || given !== token) return new Response('Forbidden', { status: 403 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const body = await req.json().catch(() => ({}))

  // Garmin user id → RIVAL member, looked up once per push.
  const members = new Map<string, string | null>()
  const memberFor = async (garminUserId: unknown): Promise<string | null> => {
    const id = String(garminUserId ?? '')
    if (!id) return null
    if (!members.has(id)) {
      const { data } = await supabase.from('garmin_connections').select('user_id').eq('garmin_user_id', id).maybeSingle()
      members.set(id, data?.user_id ?? null)
    }
    return members.get(id) ?? null
  }

  for (const d of Array.isArray(body?.deregistrations) ? body.deregistrations : []) {
    await supabase.from('garmin_connections').delete().eq('garmin_user_id', String(d?.userId ?? ''))
  }
  for (const p of Array.isArray(body?.userPermissionsChange) ? body.userPermissionsChange : []) {
    const perms: string[] = Array.isArray(p?.permissions) ? p.permissions : []
    if (!perms.includes('ACTIVITY_EXPORT')) {
      await supabase.from('garmin_connections').delete().eq('garmin_user_id', String(p?.userId ?? ''))
    }
  }

  // deno-lint-ignore no-explicit-any
  const items: { userId: unknown; s: any; polyline: string | null }[] = []
  for (const key of ['activities', 'manuallyUpdatedActivities']) {
    for (const a of Array.isArray(body?.[key]) ? body[key] : []) items.push({ userId: a?.userId, s: a, polyline: null })
  }
  for (const d of Array.isArray(body?.activityDetails) ? body.activityDetails : []) {
    items.push({ userId: d?.userId, s: { ...(d?.summary ?? {}), activityId: d?.activityId ?? d?.summary?.activityId, summaryId: d?.summaryId }, polyline: samplesToPolyline(d?.samples) })
  }
  if (!items.length) return new Response('ok')

  const config = await loadScoringConfig(supabase)
  for (const { userId, s, polyline } of items) {
    try {
      const memberId = await memberFor(userId)
      if (!memberId) continue
      // A multisport activity (triathlon) arrives as a parent plus one
      // activity per leg; the legs are kept, as from any other device.
      if (s.isParent === true) continue
      const providerId = String(s.activityId ?? s.summaryId ?? '')
      const startSec = Number(s.startTimeInSeconds)
      const duration = Math.round(Number(s.durationInSeconds ?? 0))
      if (!providerId || !Number.isFinite(startSec) || duration <= 0) continue

      const type = normaliseActivityType(garminType(s.activityType))
      const startedAt = new Date(startSec * 1000).toISOString()
      const distance = num(s.distanceInMeters)
      const elevation = num(s.totalElevationGainInMeters)
      const payload = { imported_from: 'garmin', device_name: s.deviceName ?? null, manual: !!s.manual, route: !!polyline }

      const resolved = await resolveCanonicalActivityId(supabase, {
        userId: memberId,
        provider: 'garmin',
        providerActivityId: providerId,
        activityType: type,
        startedAt,
        durationSeconds: duration,
        distanceMeters: distance,
        rawPayload: payload,
      })
      if (resolved.discard) continue
      let activityId = resolved.canonicalId
      if (!activityId) {
        const effort = calculateEffortScore(type, duration, elevation ?? 0, config, distance ?? 0)
        const { data: row, error } = await supabase.from('activities').insert({
          user_id: memberId,
          provider: 'garmin',
          provider_activity_id: providerId,
          name: s.activityName ?? null,
          activity_type: type,
          started_at: startedAt,
          utc_offset_seconds: Number.isFinite(Number(s.startTimeOffsetInSeconds)) ? Number(s.startTimeOffsetInSeconds) : null,
          duration_seconds: duration,
          distance_meters: distance,
          elevation_meters: elevation,
          effort_score: effort,
          raw_effort_score: effort,
          avg_heartrate: num(s.averageHeartRateInBeatsPerMinute),
          max_heartrate: num(s.maxHeartRateInBeatsPerMinute),
          avg_speed: num(s.averageSpeedInMetersPerSecond),
          max_speed: num(s.maxSpeedInMetersPerSecond),
          calories: num(s.activeKilocalories),
        }).select('id').single()
        if (error || !row) { console.log('Garmin insert error', providerId, JSON.stringify(error)); continue }
        activityId = row.id
      }
      await linkNewActivitySource(supabase, memberId, activityId, 'garmin', providerId, payload)
      await saveActivityRoute(supabase, activityId, memberId, polyline)
      await supabase.from('garmin_connections').update({ last_activity_at: new Date().toISOString() }).eq('user_id', memberId)
    } catch (e) {
      console.log('Garmin item error', String(e))
    }
  }
  return new Response('ok')
})
