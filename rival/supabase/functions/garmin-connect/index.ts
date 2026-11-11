import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GARMIN_AUTH_URL, garminClientId, garminRedirectUri, pkceChallenge, randomToken } from '../_shared/garmin.ts'

// Starts the Garmin connection: stores a PKCE verifier against a random
// state and returns Garmin's sign-in address for the app to open. Garmin then
// sends the member to garmin-callback, which finishes and returns them to
// `returnTo` (the web app or the iPhone app's rival:// address).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RETURN_OK = /^(https:\/\/(dist-ten-pi-90\.vercel\.app|therivalapp\.com)\/|http:\/\/localhost:8081\/|rival:\/\/)/

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  try {
    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not authenticated' }, 401)

    const body = await req.json().catch(() => ({}))
    const returnTo = typeof body?.returnTo === 'string' && RETURN_OK.test(body.returnTo)
      ? body.returnTo : 'https://dist-ten-pi-90.vercel.app/garmin'

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    // Clear this member's unfinished attempts and anything older than an hour.
    await supabase.from('garmin_oauth_states').delete().eq('user_id', user.id)
    await supabase.from('garmin_oauth_states').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString())

    const state = randomToken(24)
    const verifier = randomToken(48)
    const { error } = await supabase.from('garmin_oauth_states')
      .insert({ state, user_id: user.id, code_verifier: verifier, return_to: returnTo })
    if (error) return json({ error: 'Could not start the connection' }, 500)

    const url = new URL(GARMIN_AUTH_URL)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', garminClientId())
    url.searchParams.set('code_challenge', await pkceChallenge(verifier))
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('redirect_uri', garminRedirectUri())
    url.searchParams.set('state', state)
    return json({ url: url.toString() })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
