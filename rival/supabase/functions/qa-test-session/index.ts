import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Dev/QA-only: mints a fresh session for a dedicated fake test account so
// Claude can authenticate into the app's browser preview and verify UI
// changes visually, without ever touching a real user's credentials or the
// production data set. Reseeds a small, realistic spread of test activities
// on every call (mix of months/types, one PB pair, one race-linked, one with
// a photo) so verification always starts from a known state.
//
// Gated by a hardcoded shared secret (x-qa-secret header) — low stakes since
// this only ever touches the fake QA account, but the endpoint shouldn't be
// wide open. Not meant to be discoverable/public; if this becomes a longer-
// lived tool, move the secret to `supabase secrets set` instead.
const QA_SECRET = 'rival-qa-9f3a7c2e1b6d4f80'
const QA_EMAIL = 'claude-qa-test@rival.internal'
const QA_PASSWORD = 'ClaudeQaTest_9f3a7c2e!'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-qa-secret',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.headers.get('x-qa-secret') !== QA_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Find or create the QA test user.
    let userId: string | null = null
    const created = await admin.auth.admin.createUser({
      email: QA_EMAIL, password: QA_PASSWORD, email_confirm: true,
    })
    if (created.data?.user) {
      userId = created.data.user.id
    } else {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      userId = list?.users.find((u) => u.email === QA_EMAIL)?.id ?? null
    }
    if (!userId) throw new Error('Could not find or create QA test user')

    // The race-linked sample run belongs to the QA account's own test event,
    // never someone else's (2026-11-05: it had been picking the first event in
    // the database, which was a real member's).
    const TEST_RACE = 'City 10K (test)'
    let { data: own } = await admin.from('races').select('id').eq('user_id', userId).eq('name', TEST_RACE).limit(1)
    if (!own?.length) {
      const day = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      ;({ data: own } = await admin.from('races').insert({
        user_id: userId, name: TEST_RACE, race_type: 'Run', distance_km: 10, race_date: day, is_public: false,
      }).select('id'))
    }
    const raceId = own?.[0]?.id ?? null

    // Reseed: wipe this user's old test activities, insert a fresh known set.
    await admin.from('activities').delete().eq('user_id', userId)

    const now = new Date()
    const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString()
    const SAMPLE_PHOTO = 'https://picsum.photos/id/1015/900/1400'

    const rows = [
      // This week
      { user_id: userId, provider: 'manual', activity_type: 'Run', name: 'Morning Run', started_at: daysAgo(1), duration_seconds: 1800, distance_meters: 5200, effort_score: 41 },
      { user_id: userId, provider: 'manual', activity_type: 'Ride', name: 'Evening Ride', started_at: daysAgo(3), duration_seconds: 3300, distance_meters: 21000, effort_score: 58, photo_url: SAMPLE_PHOTO },
      // PB pair — longer run set as the record
      { user_id: userId, provider: 'manual', activity_type: 'Run', name: 'Tempo Run', started_at: daysAgo(6), duration_seconds: 1500, distance_meters: 4000, effort_score: 33 },
      { user_id: userId, provider: 'manual', activity_type: 'Run', name: 'Long Run', started_at: daysAgo(9), duration_seconds: 5400, distance_meters: 15100, effort_score: 102 },
      // Race-linked
      { user_id: userId, provider: 'manual', activity_type: 'Run', name: 'City 10K', started_at: daysAgo(14), duration_seconds: 2700, distance_meters: 10000, effort_score: 97, race_id: raceId },
      // Previous month spread
      { user_id: userId, provider: 'manual', activity_type: 'Swim', name: 'Pool Swim', started_at: daysAgo(35), duration_seconds: 1800, distance_meters: 1500, effort_score: 47 },
      { user_id: userId, provider: 'manual', activity_type: 'Hike', name: 'Ridge Hike', started_at: daysAgo(38), duration_seconds: 7200, distance_meters: 12000, elevation_meters: 620, effort_score: 84 },
      { user_id: userId, provider: 'manual', activity_type: 'WeightTraining', name: 'Strength', started_at: daysAgo(42), duration_seconds: 3000, distance_meters: 0, effort_score: 40 },
      { user_id: userId, provider: 'manual', activity_type: 'Ride', name: 'Weekend Ride', started_at: daysAgo(45), duration_seconds: 6000, distance_meters: 38000, effort_score: 76 },
    ]
    const { error: insertErr } = await admin.from('activities').insert(rows)
    if (insertErr) throw insertErr

    // Sign in as the QA user (anon-key client, normal auth flow) to get a
    // real session — never exposes the service role key to the caller.
    const anon = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email: QA_EMAIL, password: QA_PASSWORD })
    if (signInErr || !signIn.session) throw signInErr ?? new Error('Sign-in failed')

    return new Response(JSON.stringify({ session: signIn.session, user_id: userId, activities_seeded: rows.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
