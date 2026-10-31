import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getFreshStravaToken } from '../_shared/stravaAuth.ts'
import { calculateEffortScore, loadScoringConfig } from '../_shared/effortScore.ts'
import { normaliseActivityType } from '../_shared/activityType.ts'

// An activity recorded on two devices (a phone and a watch, both uploaded to
// Strava) is one RIVAL activity showing the longer recording (activityDedup).
// This lets the athlete see both and pick the one shown (Ricky, 2026-10-28):
//   count — how many recordings the activity has (cheap, no Strava call)
//   list  — each recording's numbers, read from Strava
//   use   — show this recording: it is pinned, so a longer one arriving later
//           no longer replaces it, and the activity is re-synced from it
// activity_sources has no client policies, so this is the only way in.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not authenticated' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const body = await req.json().catch(() => ({}))
    const activityId = String(body?.activityId ?? '')
    const action = String(body?.action ?? 'count')

    const { data: activity } = await supabase
      .from('activities')
      .select('id, provider, provider_activity_id')
      .eq('id', activityId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!activity || activity.provider !== 'strava') return json({ count: 0, recordings: [] })

    const { data: sources } = await supabase
      .from('activity_sources')
      .select('provider_activity_id, raw_payload')
      .eq('user_id', user.id)
      .eq('activity_id', activityId)
      .eq('provider', 'strava')
    const ids = (sources ?? []).map((s: { provider_activity_id: string }) => String(s.provider_activity_id))
    const shownId = String(activity.provider_activity_id)

    if (action === 'count') return json({ count: ids.length })

    const { data: connection } = await supabase
      .from('fitness_connections')
      .select('access_token, refresh_token, token_expires_at, provider_user_id')
      .eq('user_id', user.id)
      .eq('provider', 'strava')
      .maybeSingle()
    if (!connection) return json({ error: 'Strava is not connected.' }, 400)

    if (action === 'use') {
      const chosen = String(body?.providerActivityId ?? '')
      if (!ids.includes(chosen)) return json({ error: 'That recording is not part of this activity.' }, 400)
      // The pin lives on the recording's source row; only one per activity.
      for (const s of sources ?? []) {
        const id = String(s.provider_activity_id)
        const { error } = await supabase
          .from('activity_sources')
          .update({ raw_payload: { ...(s.raw_payload ?? {}), chosen: id === chosen } })
          .eq('user_id', user.id)
          .eq('provider', 'strava')
          .eq('provider_activity_id', id)
        if (error) return json({ error: "Couldn't switch recordings. Try again." }, 500)
      }
      const { error: rowError } = await supabase
        .from('activities')
        .update({ provider_activity_id: chosen })
        .eq('id', activityId)
        .eq('user_id', user.id)
      if (rowError) return json({ error: "Couldn't switch recordings. Try again." }, 500)
      // The webhook's own update path rescores and rewrites the activity from
      // the chosen recording, exactly as a Strava edit would.
      const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/strava-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_type: 'activity', aspect_type: 'update', object_id: Number(chosen), owner_id: Number(connection.provider_user_id), updates: {} }),
      })
      if (!res.ok) return json({ error: "Couldn't load that recording from Strava. Try again." }, 502)
      return json({ ok: true })
    }

    // list
    const tokenResult = await getFreshStravaToken(supabase, connection, user.id)
    if ('error' in tokenResult) return json({ error: 'Reconnect Strava to see both recordings.' }, 400)
    const config = await loadScoringConfig(supabase)
    const recordings = []
    for (const s of sources ?? []) {
      const id = String(s.provider_activity_id)
      const r = await fetch(`https://www.strava.com/api/v3/activities/${id}`, { headers: { Authorization: `Bearer ${tokenResult.token}` } })
      if (!r.ok) continue
      const a = await r.json()
      const external = String(a.external_id ?? s.raw_payload?.external_id ?? '').toLowerCase()
      const type = normaliseActivityType(a.sport_type ?? a.type)
      recordings.push({
        id,
        source: a.device_name || (external.includes('garmin') ? 'Garmin' : 'Strava app'),
        watch: external.includes('garmin') || /garmin|watch|coros|suunto|polar|wahoo/i.test(String(a.device_name ?? '')),
        distanceMeters: a.distance ?? null,
        durationSeconds: a.moving_time ?? null,
        startedAt: a.start_date,
        effort: calculateEffortScore(type, a.moving_time ?? 0, a.total_elevation_gain ?? 0, config, a.distance ?? 0),
        shown: id === shownId,
      })
    }
    const longest = recordings.reduce((m, r) => Math.max(m, r.durationSeconds ?? 0), 0)
    return json({ recordings: recordings.map((r) => ({ ...r, longer: recordings.length > 1 && r.durationSeconds === longest })) })
  } catch (e) {
    console.log('activity-recordings error', String(e))
    return json({ error: 'Something went wrong. Try again.' }, 500)
  }
})
