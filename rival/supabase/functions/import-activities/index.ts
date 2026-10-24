import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCanonicalActivityId, linkNewActivitySource } from '../_shared/activityDedup.ts'
import { calculateEffortScore, loadScoringConfig } from '../_shared/effortScore.ts'
import { normaliseActivityType } from '../_shared/activityType.ts'
import { saveActivityRoute } from '../_shared/activityRoute.ts'

// Imports activities from an archive (Ricky, 2026-10-17): a Strava archive
// (activities.csv) or a RIVAL archive, both read in the app and sent here in
// small batches. Every item goes through the same matching as the Strava
// sync (resolveCanonicalActivityId), so anything already in RIVAL is linked
// rather than copied, and Strava ids line up with a later Strava connection.
//
// `preview: true` only reports which items are new, without writing.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Item = {
  key: string
  provider: 'strava' | 'rival_import'
  providerId: string
  name: string | null
  type: string
  startedAt: string
  utcOffsetSeconds?: number | null
  durationSeconds: number
  distanceMeters?: number | null
  elevationMeters?: number | null
  notes?: string | null
  polyline?: string | null
  photoPath?: string | null
}

const START_WINDOW_MS = 10 * 60 * 1000

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
    const items: Item[] = Array.isArray(body?.items) ? body.items.slice(0, 50) : []
    if (!items.length) return json({ results: [] })

    // Read-only check for the preview receipt: already linked to this source,
    // or an activity of this user starting within the matching window.
    if (body?.preview) {
      const results = []
      for (const it of items) {
        const { data: src } = await supabase.from('activity_sources').select('activity_id')
          .eq('user_id', user.id).eq('provider', it.provider).eq('provider_activity_id', it.providerId).maybeSingle()
        if (src) { results.push({ key: it.key, status: 'linked' }); continue }
        const t = new Date(it.startedAt).getTime()
        const { data: near } = await supabase.from('activities').select('id')
          .eq('user_id', user.id)
          .gte('started_at', new Date(t - START_WINDOW_MS).toISOString())
          .lte('started_at', new Date(t + START_WINDOW_MS).toISOString())
          .limit(1)
        results.push({ key: it.key, status: near && near.length ? 'linked' : 'new' })
      }
      return json({ results })
    }

    const config = await loadScoringConfig(supabase)
    const results = []
    for (const it of items) {
      try {
        const type = normaliseActivityType(it.type)
        const resolved = await resolveCanonicalActivityId(supabase, {
          userId: user.id,
          provider: it.provider,
          providerActivityId: it.providerId,
          activityType: type,
          startedAt: it.startedAt,
          durationSeconds: it.durationSeconds,
          distanceMeters: it.distanceMeters ?? null,
          rawPayload: { imported_from: 'archive' },
        })
        if (resolved.discard) { results.push({ key: it.key, status: 'skipped' }); continue }
        if (resolved.canonicalId) {
          // Already in RIVAL: keep what is there, only add a missing route.
          await saveActivityRoute(supabase, resolved.canonicalId, user.id, it.polyline)
          results.push({ key: it.key, status: 'linked' })
          continue
        }
        const effort = calculateEffortScore(type, it.durationSeconds, it.elevationMeters ?? 0, config, it.distanceMeters ?? 0)
        const photoUrl = it.photoPath && it.photoPath.startsWith(`${user.id}/`)
          ? supabase.storage.from('activity-photos').getPublicUrl(it.photoPath).data.publicUrl
          : null
        const { data: row, error } = await supabase.from('activities').insert({
          user_id: user.id,
          provider: it.provider,
          provider_activity_id: it.providerId,
          name: it.name,
          activity_type: type,
          started_at: it.startedAt,
          utc_offset_seconds: it.utcOffsetSeconds ?? null,
          duration_seconds: it.durationSeconds,
          distance_meters: it.distanceMeters ?? null,
          elevation_meters: it.elevationMeters ?? null,
          notes: it.notes ?? null,
          effort_score: effort,
          raw_effort_score: effort,
          photo_url: photoUrl,
        }).select('id').single()
        if (error || !row) {
          console.log('Import insert error', it.providerId, JSON.stringify(error))
          results.push({ key: it.key, status: 'failed' })
          continue
        }
        await linkNewActivitySource(supabase, user.id, row.id, it.provider, it.providerId, { imported_from: 'archive' })
        await saveActivityRoute(supabase, row.id, user.id, it.polyline)
        results.push({ key: it.key, status: 'imported', id: row.id, effort })
      } catch (e) {
        console.log('Import item error', it.providerId, String(e))
        results.push({ key: it.key, status: 'failed' })
      }
    }
    return json({ results })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
