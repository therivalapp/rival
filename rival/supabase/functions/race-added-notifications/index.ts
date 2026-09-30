import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { formatDisplayName } from '../_shared/formatName.ts'
import { sendPushMessages } from '../_shared/push.ts';

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

    const { raceId } = await req.json()
    if (!raceId) {
      return new Response(JSON.stringify({ error: 'raceId is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: race } = await supabase
      .from('races')
      .select('id, name, race_type, user_id, users(display_name, email)')
      .eq('id', raceId)
      .single()

    if (!race || race.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Race not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }

    const { data: memberships } = await supabase
      .from('league_members')
      .select('league_id')
      .eq('user_id', user.id)
      .eq('status', 'active')

    const leagueIds = (memberships || []).map((m: any) => m.league_id)
    if (leagueIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No leagues' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const { data: leagueMembers } = await supabase
      .from('league_members')
      .select('user_id')
      .in('league_id', leagueIds)
      .neq('user_id', user.id)
      .eq('status', 'active')

    const mateIds = [...new Set((leagueMembers || []).map((m: any) => m.user_id))]
    if (mateIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No league mates' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('user_id, token')
      .in('user_id', mateIds)

    const racerName = formatDisplayName(race.users as any, 'A teammate')

    const messages = (tokens || []).map((t: any) => ({
      to: t.token,
      title: `${racerName} signed up for an event`,
      body: `${race.name} is on the calendar.`,
      data: { screen: 'races', tab: 'mine' },
      sound: 'default',
    }))

    if (messages.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No push tokens' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const pushResult = await sendPushMessages(messages)

    return new Response(JSON.stringify(pushResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
