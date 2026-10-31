import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { code } = body
    console.log('Received code:', code ? 'present' : 'missing')

    if (!code) {
      console.log('Error: no code provided')
      return new Response(
        JSON.stringify({ error: 'No code provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Get user from auth header
    const authHeader = req.headers.get('Authorization')
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )

    const { data: { user } } = await userClient.auth.getUser()
    console.log('User:', user ? user.id : 'not found')

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Use service role for DB write to bypass RLS
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Nobody new connects (RIVAL is separating from Strava, BETA_PLAN.md).
    // Checked before the code is spent, so Strava never records the link.
    const { data: existing } = await supabase
      .from('fitness_connections')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('provider', 'strava')
      .maybeSingle()
    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'New Strava connections are closed. Import a Strava archive instead.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    console.log('Calling Strava token exchange...')
    // Exchange code for token with Strava
    const stravaResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('STRAVA_CLIENT_ID'),
        client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
        code,
        grant_type: 'authorization_code',
      }),
    })

    const stravaData = await stravaResponse.json()
    console.log('Strava response status:', stravaResponse.status)
    console.log('Strava data keys:', Object.keys(stravaData))

    if (!stravaData.access_token) {
      console.log('Strava error:', JSON.stringify(stravaData))
      return new Response(
        JSON.stringify({ error: 'Failed to exchange token', details: stravaData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Save to fitness_connections
    const { error: dbError } = await supabase
      .from('fitness_connections')
      .upsert({
        user_id: user.id,
        provider: 'strava',
        provider_user_id: String(stravaData.athlete.id),
        access_token: stravaData.access_token,
        refresh_token: stravaData.refresh_token,
        token_expires_at: new Date(stravaData.expires_at * 1000).toISOString(),
        athlete_firstname: stravaData.athlete?.firstname ?? null,
        athlete_lastname: stravaData.athlete?.lastname ?? null,
      }, { onConflict: 'user_id,provider' })

    if (dbError) {
      console.log('DB error:', JSON.stringify(dbError))
      const alreadyLinkedElsewhere = dbError.code === '23505' && dbError.message?.includes('fitness_connections_provider_athlete_unique')
      return new Response(
        JSON.stringify({
          error: alreadyLinkedElsewhere
            ? 'This Strava account is already connected to another RIVAL profile. Disconnect it there first, or sign in with the right Strava account.'
            : 'Failed to save connection',
          details: dbError,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: alreadyLinkedElsewhere ? 409 : 500 }
      )
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
