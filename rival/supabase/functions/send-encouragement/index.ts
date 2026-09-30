import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { formatDisplayName } from '../_shared/formatName.ts'
import { sendPushMessages } from '../_shared/push.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_MESSAGE_LENGTH = 200

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
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { toUserId, message } = await req.json()
    const trimmed = (message ?? '').toString().trim()
    if (!toUserId || !trimmed) {
      return new Response(JSON.stringify({ error: 'toUserId and message are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (toUserId === user.id) {
      return new Response(JSON.stringify({ error: "You can't encourage yourself" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return new Response(JSON.stringify({ error: 'Message is too long' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // Must share at least one team — can't encourage a stranger.
    const { data: myLeagues } = await supabase.from('league_members').select('league_id').eq('user_id', user.id).eq('status', 'active')
    const myLeagueIds = (myLeagues || []).map((m: any) => m.league_id)
    if (myLeagueIds.length === 0) {
      return new Response(JSON.stringify({ error: 'You need to share a team with this person' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const { data: sharedMembership } = await supabase
      .from('league_members')
      .select('league_id')
      .eq('user_id', toUserId)
      .in('league_id', myLeagueIds)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
    if (!sharedMembership) {
      return new Response(JSON.stringify({ error: 'You need to share a team with this person' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // One per person per day — friendly check before the DB constraint catches it.
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
    const { data: existing } = await supabase
      .from('encouragements')
      .select('id')
      .eq('from_user_id', user.id)
      .eq('to_user_id', toUserId)
      .gte('created_at', todayStart.toISOString())
      .maybeSingle()
    if (existing) {
      return new Response(JSON.stringify({ error: "You've already sent them one today — let it land." }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { error: insertError } = await supabase.from('encouragements').insert({ from_user_id: user.id, to_user_id: toUserId, message: trimmed })
    if (insertError) {
      const alreadySentToday = insertError.code === '23505'
      return new Response(
        JSON.stringify({ error: alreadySentToday ? "You've already sent them one today — let it land." : 'Could not send' }),
        { status: alreadySentToday ? 429 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: sender } = await supabase.from('users').select('display_name, email').eq('id', user.id).maybeSingle()
    const senderName = formatDisplayName(sender, 'A teammate')

    const { data: tokens } = await supabase.from('push_tokens').select('token').eq('user_id', toUserId)
    if (tokens && tokens.length > 0) {
      await sendPushMessages(tokens.map((t: any) => ({
        to: t.token,
        title: `${senderName} sent encouragement`,
        body: trimmed,
        data: { screen: 'league' },
        sound: 'default',
      })))
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
