import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { saveActivityRoute } from '../_shared/activityRoute.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCanonicalActivityId, linkNewActivitySource } from '../_shared/activityDedup.ts'
import { calculateEffortScore, loadScoringConfig } from '../_shared/effortScore.ts'
import { normaliseActivityType } from '../_shared/activityType.ts'
import { getFreshStravaToken } from '../_shared/stravaAuth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Sized against the edge function's hard 150s request timeout, which a
// 200-activity page blew straight through (observed: HTTP 504 IDLE_TIMEOUT).
// Each activity costs ~4 DB round-trips (dedup lookup, provenance upsert,
// name check, update/insert) at roughly 150ms each. Processing CONCURRENCY
// activities at a time makes a page's cost ≈ (PAGE_SIZE / CONCURRENCY) * 4
// round-trips deep: 75/8 * 4 ≈ 38 ≈ 6s, well inside the ceiling, and ~3x
// fewer HTTP round-trips from the client than a 25-activity page.
const PAGE_SIZE = 75
const CONCURRENCY = 8
const MAX_PAGE = 54 // hard stop — 54 * 75 ≈ 4,000 historical activities
const HOUR_MILESTONES = [
  { type: 'hours_100', hours: 100, title: '100 Hours Earned', body: '100 hours of training logged.' },
  { type: 'hours_500', hours: 500, title: '500 Hours Earned', body: '500 hours of training logged.' },
  { type: 'hours_1000', hours: 1000, title: '1,000 Hours Earned', body: '1,000 hours of training logged.' },
  { type: 'hours_5000', hours: 5000, title: '5,000 Hours Earned', body: '5,000 hours of training logged. Unrivaled consistency.' },
]

// One PAGE per invocation, not the whole history in one loop. The old
// version processed every page of a user's Strava history (each activity
// doing 2-4 sequential DB round-trips) inside a single function call —
// for an account with real depth that blew straight through the edge
// function's memory/CPU budget (WORKER_RESOURCE_LIMIT, HTTP 546), killing
// the import silently partway through with no usable error, which is why
// "didn't pull my full history" had no visible cause. The client
// (src/lib/strava.ts's runFullStravaImport) now calls this once per page
// and keeps calling while `hasMore` is true, accumulating totals itself —
// bounding each invocation's work regardless of how much history exists.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      })
    }

    let page = 1
    try {
      const body = await req.json()
      if (body?.page && Number.isInteger(body.page) && body.page > 0) page = body.page
    } catch {
      // no body / not JSON — default to page 1, same as before this change
    }
    if (page > MAX_PAGE) {
      return new Response(JSON.stringify({ error: `Reached the ${MAX_PAGE * PAGE_SIZE}-activity import cap.` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    const { data: connection } = await supabase
      .from('fitness_connections')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', user.id).eq('provider', 'strava').single()

    if (!connection) {
      return new Response(JSON.stringify({ error: 'No Strava connection found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
      })
    }

    const tokenResult = await getFreshStravaToken(supabase, connection, user.id)
    if ('error' in tokenResult) {
      return new Response(JSON.stringify({ error: tokenResult.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      })
    }
    const accessToken = tokenResult.token

    const scoringConfig = await loadScoringConfig(supabase)

    // Every race for this user, fetched ONCE — findMatchingRaceId() (the
    // shared helper the other importers use) hits the races table per
    // activity, which on a 50-activity page is 50 queries to answer a
    // question a single fetch answers for the whole page. Same matching
    // rule as that helper: exactly one race on the activity's LOCAL date.
    const { data: userRaces } = await supabase
      .from('races')
      .select('id, race_date')
      .eq('user_id', user.id)
    const racesByDate = new Map<string, string[]>()
    for (const r of userRaces ?? []) {
      const list = racesByDate.get(r.race_date) ?? []
      list.push(r.id)
      racesByDate.set(r.race_date, list)
    }
    const raceIdForLocalDate = (startedAtLocalIso: string): string | null => {
      const onThatDay = racesByDate.get((startedAtLocalIso ?? '').slice(0, 10))
      return onThatDay && onThatDay.length === 1 ? onThatDay[0] : null
    }

    const activitiesRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=${PAGE_SIZE}&page=${page}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!activitiesRes.ok) {
      const rateLimited = activitiesRes.status === 429
      return new Response(JSON.stringify({
        error: rateLimited
          ? "Strava's rate limit kicked in — wait 15 minutes and run the import again to get the rest."
          : `Strava API error (status ${activitiesRes.status}) on page ${page}`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 })
    }
    const activities = await activitiesRes.json()
    if (!Array.isArray(activities)) {
      return new Response(JSON.stringify({ error: 'Unexpected response from Strava.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502,
      })
    }

    let saved = 0
    let importedSeconds = 0
    let importedEffort = 0

    // deno-lint-ignore no-explicit-any
    async function processActivity(activity: any): Promise<{ seconds: number; effort: number } | null> {
      // Strava spells it "Crossfit"; RIVAL stores "CrossFit". Without this the
      // same sport gets two scoring_config rows and two tuning knobs.
      // sport_type, not type: the legacy `type` field collapses the granular
    // sports (Strava's own docs show type:"Ride" alongside
    // sport_type:"MountainBikeRide"), so reading `type` made the TrailRun /
    // MountainBikeRide / GravelRide / VirtualRow config rows unreachable.
    const canonicalType = normaliseActivityType(activity.sport_type ?? activity.type)
      const effortScore = calculateEffortScore(canonicalType, activity.moving_time, activity.total_elevation_gain, scoringConfig)
      const providerActivityId = String(activity.id)

      // Resolves same-source re-syncs AND cross-source duplicates (e.g. a Garmin
      // watch that also auto-exports to Strava) to one canonical activities row —
      // see supabase/functions/_shared/activityDedup.ts.
      // external_id reveals the ORIGINAL source of a Strava activity (e.g.
      // "garmin_ping_123.fit" from a Garmin watch) — kept on activity_sources so
      // a future direct Garmin/Health integration can match exactly, not fuzzily.
      // (device_name isn't present on list-endpoint summary activities.)
      const sourceProvenance = {
        external_id: activity.external_id ?? null,
        upload_id: activity.upload_id ?? null,
      }

      const resolved = await resolveCanonicalActivityId(supabase, {
        userId: user.id,
        provider: 'strava',
        providerActivityId,
        activityType: canonicalType,
        startedAt: activity.start_date,
        durationSeconds: activity.moving_time,
        distanceMeters: activity.distance,
        rawPayload: sourceProvenance,
      })

      // Overlaps an activity already recorded and saw less of the session —
      // writing it would double-count one workout. The source is already
      // linked, so this won't be reconsidered on the next sync.
      if (resolved.discard) return null
      const canonicalId = resolved.canonicalId

      const fields: Record<string, unknown> = {
        activity_type: canonicalType,
        distance_meters: activity.distance,
        duration_seconds: activity.moving_time,
        elevation_meters: activity.total_elevation_gain,
        started_at: activity.start_date,
        effort_score: effortScore,
        raw_effort_score: effortScore,
        // start_date_local (not start_date) — races.race_date is a bare calendar
        // date, so matching needs the athlete's local day, not the UTC one.
        race_id: raceIdForLocalDate(activity.start_date_local),
      }

      if (canonicalId) {
        // Known row — update in place. Only touch `name` when Strava itself is the
        // row's origin and it isn't locked; a cross-source fuzzy match shouldn't let
        // a later Strava sync clobber a name/details set by whichever source created it.
        const { data: existingRow } = await supabase
          .from('activities')
          .select('name_locked, provider')
          .eq('id', canonicalId)
          .maybeSingle()
        if (existingRow?.provider === 'strava' && !existingRow?.name_locked) fields.name = activity.name

        const { error } = await supabase.from('activities').update(fields).eq('id', canonicalId)
        if (error) return null
        await saveActivityRoute(supabase, canonicalId, user.id, activity.map?.summary_polyline)
        return { seconds: activity.moving_time || 0, effort: effortScore }
      }

      const { data: inserted, error } = await supabase
        .from('activities')
        .insert({ user_id: user.id, provider: 'strava', provider_activity_id: providerActivityId, name: activity.name, ...fields })
        .select('id')
        .single()
      if (error || !inserted) return null
      await linkNewActivitySource(supabase, user.id, inserted.id, 'strava', providerActivityId, sourceProvenance)
      await saveActivityRoute(supabase, inserted.id, user.id, activity.map?.summary_polyline)
      return { seconds: activity.moving_time || 0, effort: effortScore }
    }

    // Activities were processed strictly one at a time, so the page's runtime
    // was the SUM of every activity's ~4 sequential DB round-trips. They're
    // independent of each other, so running a handful concurrently cuts the
    // wall time by roughly the concurrency factor. Kept modest (not "all at
    // once") to avoid swamping the connection pool — the point is to shorten
    // the dependency chain, not to maximise in-flight queries.
    for (let i = 0; i < activities.length; i += CONCURRENCY) {
      const results = await Promise.all(activities.slice(i, i + CONCURRENCY).map(processActivity))
      for (const r of results) {
        if (!r) continue
        saved++
        importedSeconds += r.seconds
        importedEffort += r.effort
      }
    }

    // Keep going until a page comes back genuinely empty, rather than until
    // one comes back short. Strava does not guarantee a full page: activities
    // hidden from the feed, deleted, or belonging to another athlete on a
    // shared upload are filtered out server-side AFTER the page is cut, so a
    // partial page in the middle of a history is normal. Treating that as the
    // end silently truncated imports at whatever date the first short page
    // happened to land on, which is why some accounts imported only a few
    // months and no error was ever shown — the import believed it had
    // finished. Costs one extra request that returns nothing.
    const hasMore = activities.length > 0 && page < MAX_PAGE

    // Milestone/push-notification pass only runs once the caller has reached
    // the last page — cheap either way, but no reason to spam a push per page.
    let newMilestoneTypes: string[] = []
    if (!hasMore) {
      const { data: allActivities } = await supabase
        .from('activities')
        .select('duration_seconds')
        .eq('user_id', user.id)
      const totalHours = (allActivities || []).reduce((s: number, a: any) => s + (a.duration_seconds || 0), 0) / 3600

      const { data: existingMilestones } = await supabase.from('milestones').select('type').eq('user_id', user.id)
      const achieved = new Set((existingMilestones || []).map((m: any) => m.type))
      const newMilestones = HOUR_MILESTONES.filter(m => totalHours >= m.hours && !achieved.has(m.type))
      newMilestoneTypes = newMilestones.map(m => m.type)

      if (newMilestones.length > 0) {
        await supabase.from('milestones').insert(newMilestones.map(m => ({ user_id: user.id, type: m.type })))
      }

      const { data: tokenRow } = await supabase.from('push_tokens').select('token').eq('user_id', user.id).maybeSingle()
      if (tokenRow?.token) {
        const importedHours = Math.round(totalHours)
        const messages = [{
          to: tokenRow.token,
          title: `Training history imported`,
          body: `${importedHours} hours of training history imported from connected device.`,
          data: { screen: 'profile' },
          sound: 'default',
        }]
        newMilestones.forEach(m => messages.push({
          to: tokenRow.token, title: m.title, body: m.body, data: { screen: 'profile' }, sound: 'default',
        }))
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(messages),
        }).catch(() => {})
      }
    }

    return new Response(JSON.stringify({
      saved,
      page,
      hasMore,
      importedSeconds,
      importedEffort: Math.round(importedEffort * 10) / 10,
      newMilestones: newMilestoneTypes,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    })
  }
})
