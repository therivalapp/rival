import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { saveActivityRoute } from '../_shared/activityRoute.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCanonicalActivityId, linkNewActivitySource } from '../_shared/activityDedup.ts'
import { findMatchingRaceId } from '../_shared/raceMatch.ts'
import { calculateEffortScore, loadScoringConfig } from '../_shared/effortScore.ts'
import { normaliseActivityType } from '../_shared/activityType.ts'
import { getFreshStravaToken } from '../_shared/stravaAuth.ts'
import { sendPushMessages } from '../_shared/push.ts'
import { formatDisplayName } from '../_shared/formatName.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// A teammate logging something is the nudge that gets other people moving —
// but a team of eight all training daily would carpet-bomb everyone's lock
// screen and get RIVAL muted inside a week. One teammate-activity push per
// person per this window, no matter how many teammates trained.
const TEAMMATE_PUSH_COOLDOWN_HOURS = 4

// Fires after a Strava activity lands via webhook — the whole point of the
// webhook path is that it reaches people who haven't opened the app, so the
// activity being saved silently would waste it.
//
// Deliberately wrapped by its caller in try/catch: Strava disables a
// subscription that keeps returning non-2xx, so a push failure must never
// cost us the webhook itself. The activity is already saved by this point.
async function notifyActivityLanded(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  activityName: string,
  effortScore: number,
  startedAt: string | null,
) {
  const effort = Math.round(effortScore)

  // --- 1. The athlete's own confirmation -----------------------------------
  // Strava already told them the activity exists; what it can't tell them is
  // what it was worth here, which is the number RIVAL actually competes on.
  const { data: ownToken } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)
    .maybeSingle()

  const messages: { to: string; title: string; body: string; data: Record<string, unknown>; sound: string }[] = []

  if (ownToken?.token) {
    messages.push({
      to: ownToken.token,
      title: `+${effort} Effort`,
      body: `${activityName} synced from Strava.`,
      data: { screen: 'home' },
      sound: 'default',
    })
  }

  // --- 2. Their teammates ---------------------------------------------------
  // Only for something that actually just happened. Strava fires `create` for
  // backdated uploads too, and telling a team "Sandy just trained" about a
  // session from three weeks ago is both wrong and the kind of thing that
  // teaches people to ignore the notification.
  const activityAgeHours = startedAt
    ? (Date.now() - new Date(startedAt).getTime()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY
  const isRecent = activityAgeHours <= 24

  const { data: myLeagues } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('user_id', userId)
    .eq('status', 'active')

  const leagueIds = (myLeagues ?? []).map((m: { league_id: string }) => m.league_id)
  if (isRecent && leagueIds.length > 0) {
    const { data: teammates } = await supabase
      .from('league_members')
      .select('user_id')
      .in('league_id', leagueIds)
      .eq('status', 'active')
      .neq('user_id', userId)

    // Someone sharing two teams with the athlete is still one person — dedupe
    // before we start counting pushes against them.
    const teammateIds = [...new Set((teammates ?? []).map((m: { user_id: string }) => m.user_id))] as string[]

    if (teammateIds.length > 0) {
      const cutoff = new Date(Date.now() - TEAMMATE_PUSH_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()
      const { data: recent } = await supabase
        .from('notifications')
        .select('user_id')
        .eq('type', 'teammate_activity')
        .in('user_id', teammateIds)
        .gt('sent_at', cutoff)
      const onCooldown = new Set((recent ?? []).map((n: { user_id: string }) => n.user_id))

      const eligibleIds = teammateIds.filter((id) => !onCooldown.has(id))

      if (eligibleIds.length > 0) {
        const { data: athlete } = await supabase
          .from('users')
          .select('display_name, email')
          .eq('id', userId)
          .maybeSingle()
        // First name only — a lock screen is not the place for "Ricky
        // Jackson-Lewis just trained". Splitting the FALLBACK would leave the
        // bare article ("A just trained"), so only trim a real name.
        const fullName = formatDisplayName(athlete, '')
        const firstName = fullName ? fullName.split(' ')[0] : 'A teammate'

        const { data: tokens } = await supabase
          .from('push_tokens')
          .select('user_id, token')
          .in('user_id', eligibleIds)

        const notified: string[] = []
        for (const t of tokens ?? []) {
          if (!t.token) continue
          messages.push({
            to: t.token,
            title: `${firstName} logged an activity`,
            body: `${activityName} — ${effort} Effort`,
            data: { screen: 'team-feed' },
            sound: 'default',
          })
          notified.push(t.user_id)
        }

        // Log against the people we actually pushed to, so the cooldown is
        // measured from a real notification rather than from every teammate
        // activity that happened to pass through here.
        // Deduped: someone with two devices gets two pushes but is still one
        // person as far as the cooldown is concerned.
        const notifiedOnce = [...new Set(notified)]
        if (notifiedOnce.length > 0) {
          await supabase.from('notifications').insert(
            notifiedOnce.map((id) => ({ user_id: id, type: 'teammate_activity', sent_at: new Date().toISOString() })),
          )
        }
      }
    }
  }

  if (messages.length > 0) {
    const { sent, errors } = await sendPushMessages(messages)
    console.log(`Activity push: sent ${sent}, errors ${errors.length}`)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Strava webhook verification (GET request)
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    const verifyToken = Deno.env.get('STRAVA_WEBHOOK_VERIFY_TOKEN')

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Webhook verified')
      return new Response(
        JSON.stringify({ 'hub.challenge': challenge }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    return new Response('Forbidden', { status: 403 })
  }

  // Handle incoming webhook event (POST)
  if (req.method === 'POST') {
    const event = await req.json()
    console.log('Webhook event:', JSON.stringify(event))

    // Creates, updates and deletes. Deletes were ignored until 2026-09-23,
    // which made RIVAL a one-way accumulator: a junk activity removed in
    // Strava lived here forever, still counting toward Effort. Strava is the
    // source of truth for anything it sent us, so tidying up there has to
    // tidy up here.
    if (event.object_type !== 'activity' || !['create', 'update', 'delete'].includes(event.aspect_type)) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const stravaAthleteId = String(event.owner_id)
    const stravaActivityId = String(event.object_id)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Find the user by strava athlete ID
    const { data: connection, error: connError } = await supabase
      .from('fitness_connections')
      .select('user_id, access_token, refresh_token, token_expires_at')
      .eq('provider', 'strava')
      .eq('provider_user_id', stravaAthleteId)
      .single()

    if (connError || !connection) {
      console.log('No connection found for athlete:', stravaAthleteId)
      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Handled before the token refresh and the detail fetch, because a deleted
    // activity no longer exists to fetch — asking Strava for it returns 404 and
    // the event would be dropped. Scoped to this user and to strava-provided
    // rows so it can never reach a manual entry or another account's data.
    if (event.aspect_type === 'delete') {
      // Resolved through activity_sources, not by matching
      // activities.provider_activity_id directly. Two overlapping recordings
      // of one session are merged into a single activities row, which keeps
      // whichever provider_activity_id arrived first — so deleting the OTHER
      // one in Strava would match nothing and the row would survive.
      const { data: sourceRow } = await supabase
        .from('activity_sources')
        .select('activity_id')
        .eq('user_id', connection.user_id)
        .eq('provider', 'strava')
        .eq('provider_activity_id', stravaActivityId)
        .maybeSingle()

      await supabase
        .from('activity_sources')
        .delete()
        .eq('user_id', connection.user_id)
        .eq('provider', 'strava')
        .eq('provider_activity_id', stravaActivityId)

      // Fall back to the direct match for rows imported before provenance was
      // captured, which have no activity_sources entry at all.
      const activityId = sourceRow?.activity_id ?? null
      let removed = 0
      if (activityId) {
        // Only delete the activity once nothing else points at it. A merged
        // row can legitimately have another source still standing, and that
        // session genuinely still happened — dropping it would lose real
        // training because a duplicate was tidied up.
        const { count: remaining } = await supabase
          .from('activity_sources')
          .select('id', { count: 'exact', head: true })
          .eq('activity_id', activityId)
        if ((remaining ?? 0) === 0) {
          const { count } = await supabase
            .from('activities')
            .delete({ count: 'exact' })
            .eq('id', activityId)
            .eq('user_id', connection.user_id)
          removed = count ?? 0
        } else {
          console.log('Strava delete for', stravaActivityId, '— activity kept,', remaining, 'other source(s) still reference it')
        }
      } else {
        const { count } = await supabase
          .from('activities')
          .delete({ count: 'exact' })
          .eq('user_id', connection.user_id)
          .eq('provider', 'strava')
          .eq('provider_activity_id', stravaActivityId)
        removed = count ?? 0
      }

      // RLS failures delete nothing and raise nothing, so the count is the
      // only honest signal that this did what it claims.
      console.log('Strava delete for', stravaActivityId, '— activities removed:', removed)
      return new Response(JSON.stringify({ received: true, deleted: removed }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const tokenResult = await getFreshStravaToken(supabase, connection, connection.user_id)
    if ('error' in tokenResult) {
      // Do NOT fall through with the stale token — every event would 401 at
      // the activity fetch and sync would die silently, forever. Ack the
      // webhook (Strava retries/disables the subscription on non-2xx) but
      // skip the event; the user's next manual sync/import will tell them to
      // reconnect Strava.
      console.log('Token refresh FAILED for user', connection.user_id, '— skipping event. User must reconnect Strava.')
      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }
    const accessToken = tokenResult.token

    const scoringConfig = await loadScoringConfig(supabase)

    // Fetch activity details from Strava
    const activityRes = await fetch(
      `https://www.strava.com/api/v3/activities/${stravaActivityId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const activity = await activityRes.json()
    console.log('Activity type:', activity.type, 'Duration:', activity.moving_time)

    // Strava spells it "Crossfit"; RIVAL stores "CrossFit". Without this the
    // same sport gets two scoring_config rows and two tuning knobs.
    // sport_type, not type: the legacy `type` field collapses the granular
    // sports (Strava's own docs show type:"Ride" alongside
    // sport_type:"MountainBikeRide"), so reading `type` made the TrailRun /
    // MountainBikeRide / GravelRide / VirtualRow config rows unreachable.
    const canonicalType = normaliseActivityType(activity.sport_type ?? activity.type)
    const effortScore = calculateEffortScore(canonicalType, activity.moving_time, activity.total_elevation_gain, scoringConfig, activity.distance)
    console.log('Effort score:', effortScore)

    // Resolves same-source re-syncs AND cross-source duplicates (e.g. a Garmin watch
    // that also auto-exports to Strava) to one canonical activities row — see
    // supabase/functions/_shared/activityDedup.ts.
    // external_id/device_name reveal the ORIGINAL source of a Strava activity
    // (e.g. "garmin_ping_123.fit" from a Garmin watch) — kept on activity_sources
    // so a future direct Garmin/Health integration can match exactly, not fuzzily.
    const sourceProvenance = {
      external_id: activity.external_id ?? null,
      upload_id: activity.upload_id ?? null,
      device_name: activity.device_name ?? null,
    }

    const resolved = await resolveCanonicalActivityId(supabase, {
      userId: connection.user_id,
      provider: 'strava',
      providerActivityId: stravaActivityId,
      activityType: canonicalType,
      startedAt: activity.start_date,
      durationSeconds: activity.moving_time,
      distanceMeters: activity.distance,
      rawPayload: sourceProvenance,
    })

    // Overlaps an activity already recorded and saw less of the session —
    // writing it would double-count one workout. The source is already
    // linked, so this won't be reconsidered on the next sync.
    if (resolved.discard) {
      return new Response(JSON.stringify({ received: true, skipped: 'overlapping duplicate' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }
    const canonicalId = resolved.canonicalId

    const fields = {
      activity_type: canonicalType,
      distance_meters: activity.distance,
      duration_seconds: activity.moving_time,
      elevation_meters: activity.total_elevation_gain,
      started_at: activity.start_date,
      effort_score: effortScore,
      raw_effort_score: effortScore,
      // start_date_local (not start_date) — races.race_date is a bare calendar
      // date, so matching needs the athlete's local day, not the UTC one.
      race_id: await findMatchingRaceId(supabase, connection.user_id, activity.start_date_local),
    }

    if (canonicalId) {
      const { data: existingRow } = await supabase
        .from('activities')
        .select('name_locked, provider')
        .eq('id', canonicalId)
        .maybeSingle()
      const updateFields: Record<string, unknown> = { ...fields }
      if (existingRow?.provider === 'strava' && !existingRow?.name_locked) updateFields.name = activity.name

      const { error: activityError } = await supabase.from('activities').update(updateFields).eq('id', canonicalId)
      if (activityError) console.log('Activity update error:', JSON.stringify(activityError))
      else {
        await saveActivityRoute(supabase, canonicalId, connection.user_id, activity.map?.summary_polyline)
        console.log('Activity saved successfully with effort score:', effortScore)
      }
    } else {
      const { data: inserted, error: activityError } = await supabase
        .from('activities')
        .insert({ user_id: connection.user_id, provider: 'strava', provider_activity_id: stravaActivityId, name: activity.name, ...fields })
        .select('id')
        .single()
      if (activityError) {
        console.log('Activity insert error:', JSON.stringify(activityError))
      } else {
        if (inserted) {
          await linkNewActivitySource(supabase, connection.user_id, inserted.id, 'strava', stravaActivityId, sourceProvenance)
          await saveActivityRoute(supabase, inserted.id, connection.user_id, activity.map?.summary_polyline)
        }
        console.log('Activity saved successfully with effort score:', effortScore)

        // Only a genuine first-time insert is news. The update branch above
        // covers re-syncs and edits of activities everyone already heard
        // about, and `create` events for something already logged manually
        // resolve to a canonical row and land there too.
        if (event.aspect_type === 'create') {
          try {
            await notifyActivityLanded(supabase, connection.user_id, activity.name || 'An activity', effortScore, activity.start_date ?? null)
          } catch (pushErr) {
            // Never let this reach the response — Strava disables a
            // subscription that stops returning 2xx, which would kill every
            // future sync over a notification that failed to send.
            console.log('Activity push failed (activity itself saved):', String(pushErr))
          }
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  return new Response('Method not allowed', { status: 405 })
})
