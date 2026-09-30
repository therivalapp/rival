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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Get user's Strava connection
    const { data: connection } = await supabase
      .from('fitness_connections')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', user.id)
      .eq('provider', 'strava')
      .single()

    if (!connection) {
      return new Response(JSON.stringify({ error: 'No Strava connection found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }

    const tokenResult = await getFreshStravaToken(supabase, connection, user.id)
    if ('error' in tokenResult) {
      return new Response(JSON.stringify({ error: tokenResult.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }
    const accessToken = tokenResult.token

    // Keep athlete name fresh for the "Connected to X's Strava" label
    try {
      const athleteRes = await fetch('https://www.strava.com/api/v3/athlete', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (athleteRes.ok) {
        const athlete = await athleteRes.json()
        await supabase
          .from('fitness_connections')
          .update({ athlete_firstname: athlete.firstname ?? null, athlete_lastname: athlete.lastname ?? null })
          .eq('user_id', user.id)
          .eq('provider', 'strava')
      }
    } catch (athleteErr) {
      console.log('Athlete fetch failed:', athleteErr.message)
    }

    const scoringConfig = await loadScoringConfig(supabase)

    // Fetch last 30 activities from Strava
    const activitiesRes = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=30',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const activities = await activitiesRes.json()
    console.log('Backfill v3 - detail photo fetch enabled')

    if (!activitiesRes.ok || !Array.isArray(activities)) {
      const status = activitiesRes.status === 401 ? 401 : 400
      const error = status === 401 ? 'Strava authorization expired — please reconnect Strava' : 'Strava error'
      return new Response(JSON.stringify({ error, details: activities }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status,
      })
    }
    console.log(`Fetched ${activities.length} activities`)


    // Every race for this user, fetched ONCE. findMatchingRaceId() (the shared
    // helper) queries the races table per activity — 30 queries to answer a
    // question one fetch answers for the whole batch. Same rule as that
    // helper: exactly one race on the activity's LOCAL calendar date.
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

    let saved = 0
    let inserted = 0

    // deno-lint-ignore no-explicit-any
    async function processActivity(activity: any): Promise<{ wasInsert: boolean } | null> {
      // Strava spells it "Crossfit"; RIVAL stores "CrossFit". Without this the
      // same sport gets two scoring_config rows and two tuning knobs.
      // sport_type, not type: the legacy `type` field collapses the granular
    // sports (Strava's own docs show type:"Ride" alongside
    // sport_type:"MountainBikeRide"), so reading `type` made the TrailRun /
    // MountainBikeRide / GravelRide / VirtualRow config rows unreachable.
    const canonicalType = normaliseActivityType(activity.sport_type ?? activity.type)
      const effortScore = calculateEffortScore(canonicalType, activity.moving_time, activity.total_elevation_gain, scoringConfig, activity.distance)
      const providerActivityId = String(activity.id)
      // external_id reveals the ORIGINAL source of a Strava activity (e.g.
      // "garmin_ping_123.fit" from a Garmin watch) — kept on activity_sources so
      // a future direct Garmin/Health integration can match exactly, not fuzzily.
      const sourceProvenance = {
        external_id: activity.external_id ?? null,
        upload_id: activity.upload_id ?? null,
      }

      // Resolves same-source re-syncs AND cross-source duplicates to one canonical
      // activities row — every importer must go through this, never a bespoke
      // upsert keyed on provider_activity_id (see _shared/activityDedup.ts).
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
      if (resolved.discard) continue
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

      let activityId: string
      let wasInsert = false
      // Whether this row ALREADY has a photo, learned without a dedicated
      // query: the update path selects it alongside the name check it was
      // already doing, and a freshly-inserted row can't have one by definition.
      let existingPhotoUrl: string | null = null

      if (canonicalId) {
        // Only touch `name` when Strava itself is the row's origin and it isn't
        // locked — a cross-source match shouldn't let a Strava sync clobber a
        // name set by whichever source created the row.
        const { data: existingRow } = await supabase
          .from('activities')
          .select('name_locked, provider, photo_url')
          .eq('id', canonicalId)
          .maybeSingle()
        const updateFields: Record<string, unknown> = { ...fields }
        if (existingRow?.provider === 'strava' && !existingRow?.name_locked) updateFields.name = activity.name

        const { error } = await supabase.from('activities').update(updateFields).eq('id', canonicalId)
        if (error) {
          console.log(`Update error for ${activity.id}:`, JSON.stringify(error))
          return null
        }
        activityId = canonicalId
        existingPhotoUrl = existingRow?.photo_url ?? null
      } else {
        const { data: insertedRow, error } = await supabase
          .from('activities')
          .insert({ user_id: user.id, provider: 'strava', provider_activity_id: providerActivityId, name: activity.name, ...fields })
          .select('id')
          .single()
        if (error || !insertedRow) {
          console.log(`Insert error for ${activity.id}:`, JSON.stringify(error))
          return null
        }
        await linkNewActivitySource(supabase, user.id, insertedRow.id, 'strava', providerActivityId, sourceProvenance)
        activityId = insertedRow.id
        wasInsert = true
      }

      await saveActivityRoute(supabase, activityId, user.id, activity.map?.summary_polyline)

      // Fetch a photo only when this activity doesn't already have one
      // (total_photo_count on the list endpoint is unreliable, so the photos
      // endpoint is the source of truth for whether one exists at all).
      if (!existingPhotoUrl) {
        try {
          const photosRes = await fetch(
            `https://www.strava.com/api/v3/activities/${activity.id}/photos?photo_sources=true&size=1900`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          )
          const photos = await photosRes.json()

          const cdnUrl: string | null = Array.isArray(photos) && photos.length > 0
            ? (photos[0].urls?.['1900'] ?? photos[0].urls?.['600'] ?? photos[0].urls?.['100'] ?? null)
            : null

          if (cdnUrl) {
            // Download from Strava CDN and re-upload to Supabase Storage
            // (Strava CDN URLs expire — storing in Supabase keeps them permanent)
            const imgRes = await fetch(cdnUrl)
            if (imgRes.ok) {
              const imgBytes = await imgRes.arrayBuffer()
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
              const ext = contentType.includes('png') ? 'png' : 'jpg'
              const storagePath = `strava/${user.id}/${activity.id}.${ext}`

              const { error: storageErr } = await supabase.storage
                .from('activity-photos')
                .upload(storagePath, imgBytes, { contentType, upsert: true })

              if (!storageErr) {
                const { data: urlData } = supabase.storage
                  .from('activity-photos')
                  .getPublicUrl(storagePath)

                await supabase
                  .from('activities')
                  .update({ photo_url: urlData.publicUrl })
                  .eq('id', activityId)
              } else {
                console.log(`Storage error for ${activity.id}:`, storageErr.message)
              }
            }
          }
        } catch (photoErr) {
          console.log(`Photo fetch failed for activity ${activity.id}:`, photoErr.message)
        }
      }

      return { wasInsert }
    }

    // Activities were processed strictly one at a time, so a sync's runtime was
    // the SUM of every activity's DB round-trips AND its photo download/upload.
    // They're independent, so a handful run concurrently. Held lower than the
    // full-import's batch size because each activity here can hold a full-size
    // image in memory while it's being re-uploaded to storage.
    const CONCURRENCY = 5
    for (let i = 0; i < activities.length; i += CONCURRENCY) {
      const results = await Promise.all(activities.slice(i, i + CONCURRENCY).map(processActivity))
      for (const r of results) {
        if (!r) continue
        saved++
        if (r.wasInsert) inserted++
      }
    }

    return new Response(JSON.stringify({ success: true, saved, inserted, total: activities.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (err) {
    console.log('Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
