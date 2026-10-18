import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Permanent account deletion (App Store Guideline 5.1.1(v) requires this
// to exist in-app). Deletion order matters:
//
// 1. Teams the user CREATED: leagues.created_by is ON DELETE NO ACTION, so
//    the profile delete would fail while any owned league exists. Empty
//    teams are deleted; teams with other active members get ownership
//    transferred (an existing admin if there is one, else the longest-
//    standing member, who is promoted).
// 2. Other NO ACTION references that would block: feed_posts, matchups,
//    league_challenges.winner_id.
// 3. Storage files (best-effort — failures here never block the deletion).
// 4. public.users row — cascades activities, races, goals, league_members,
//    follows, fitness_connections, etc. (public.users has NO FK from
//    auth.users, so this must be explicit).
// 5. auth.users via admin API — cascades auth.* and the tables keyed
//    directly to auth.users (milestones, push_tokens, exercise_entries...).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader ?? '' } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      })
    }

    // Second factor: the client must send the typed confirmation, so a stray
    // API call with a valid session can't nuke an account by accident.
    const body = await req.json().catch(() => ({}))
    if (body?.confirm !== 'DELETE') {
      return new Response(JSON.stringify({ error: 'confirmation_required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const userId = user.id

    // From the emailed link: only while the request it answers is still
    // pending (deletion_requests.sql). A cancelled or expired request means
    // the link no longer deletes anything.
    if (body?.via === 'email') {
      const { data: request } = await supabase
        .from('deletion_requests')
        .select('expires_at')
        .eq('user_id', userId)
        .maybeSingle()
      if (!request || new Date(request.expires_at).getTime() < Date.now()) {
        return new Response(JSON.stringify({ error: 'request_expired' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
        })
      }
    }

    // 1. Owned teams: delete if otherwise empty, else hand over ownership.
    const { data: ownedLeagues } = await supabase.from('leagues').select('id').eq('created_by', userId)
    for (const lg of ownedLeagues ?? []) {
      const { data: others } = await supabase
        .from('league_members')
        .select('user_id, role')
        .eq('league_id', lg.id)
        .neq('user_id', userId)
        .eq('status', 'active')
        .order('joined_at', { ascending: true })
      if (!others || others.length === 0) {
        const { error } = await supabase.from('leagues').delete().eq('id', lg.id)
        if (error) throw new Error(`empty team delete failed: ${error.message}`)
      } else {
        const successor = others.find((m: { role: string }) => m.role === 'admin') ?? others[0]
        const { error: promoteErr } = await supabase
          .from('league_members').update({ role: 'admin' })
          .eq('league_id', lg.id).eq('user_id', successor.user_id)
        if (promoteErr) throw new Error(`successor promote failed: ${promoteErr.message}`)
        const { error: handoverErr } = await supabase
          .from('leagues').update({ created_by: successor.user_id }).eq('id', lg.id)
        if (handoverErr) throw new Error(`ownership handover failed: ${handoverErr.message}`)
      }
    }

    // 2. Remaining NO ACTION references that would block the deletes below.
    await supabase.from('feed_posts').delete().eq('user_id', userId)
    await supabase.from('matchups').delete().or(`user_a_id.eq.${userId},user_b_id.eq.${userId},winner_id.eq.${userId}`)
    await supabase.from('league_challenges').update({ winner_id: null }).eq('winner_id', userId)

    // 3. Storage cleanup — best effort, never blocks the account deletion.
    const prefixesByBucket: Record<string, string[]> = {
      'activity-photos': [userId, `strava/${userId}`],
      'avatars': [userId],
    }
    for (const [bucket, prefixes] of Object.entries(prefixesByBucket)) {
      for (const prefix of prefixes) {
        try {
          const { data: files } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
          if (files && files.length > 0) {
            await supabase.storage.from(bucket).remove(files.map((f: { name: string }) => `${prefix}/${f.name}`))
          }
        } catch (storageErr) {
          console.log(`Storage cleanup failed for ${bucket}/${prefix}:`, String(storageErr))
        }
      }
    }

    // 4. Profile row — cascades the bulk of the user's data.
    const { error: usersErr } = await supabase.from('users').delete().eq('id', userId)
    if (usersErr) throw new Error(`profile delete failed: ${usersErr.message}`)

    // 5. Auth user — cascades auth.* and auth-keyed public tables.
    const { error: authErr } = await supabase.auth.admin.deleteUser(userId)
    if (authErr) throw new Error(`auth delete failed: ${authErr.message}`)

    console.log('Account deleted:', userId)
    return new Response(JSON.stringify({ deleted: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    })
  } catch (err) {
    console.log('Account deletion error:', String(err))
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    })
  }
})
