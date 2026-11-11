import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { exchangeCode, GARMIN_USER_ID_URL, tokenRow } from '../_shared/garmin.ts'

// Garmin's return after sign-in (registered as the app's OAuth redirect URL).
// Deployed with --no-verify-jwt: Garmin calls it without a Supabase session,
// and the random state ties it to the member who pressed Connect. Swaps the
// code for tokens, reads the member's Garmin user id, saves the connection,
// then sends the member back to the app with ?garmin=connected or =failed.

const back = (returnTo: string, result: string) => {
  const u = new URL(returnTo)
  u.searchParams.set('garmin', result)
  return new Response(null, { status: 302, headers: { Location: u.toString() } })
}

serve(async (req) => {
  const params = new URL(req.url).searchParams
  const state = params.get('state') ?? ''
  const code = params.get('code')
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const { data: pending } = await supabase.from('garmin_oauth_states')
    .select('user_id, code_verifier, return_to, created_at').eq('state', state).maybeSingle()
  if (!pending) return new Response('This Garmin sign-in has expired. Return to RIVAL and press Connect again.', { status: 400 })
  await supabase.from('garmin_oauth_states').delete().eq('state', state)
  if (!code || Date.now() - new Date(pending.created_at).getTime() > 3600_000) return back(pending.return_to, 'cancelled')

  try {
    const tokens = await exchangeCode(code, pending.code_verifier)
    const idRes = await fetch(GARMIN_USER_ID_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
    const idBody = await idRes.json().catch(() => ({}))
    const garminUserId = idBody?.userId
    if (!idRes.ok || !garminUserId) throw new Error(`Garmin user id ${idRes.status}`)

    // One Garmin account belongs to one RIVAL member at a time: a reconnect
    // from another RIVAL account moves it.
    await supabase.from('garmin_connections').delete().eq('garmin_user_id', garminUserId).neq('user_id', pending.user_id)
    const { error } = await supabase.from('garmin_connections').upsert({
      user_id: pending.user_id,
      garmin_user_id: String(garminUserId),
      ...tokenRow(tokens),
      connected_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) throw new Error(JSON.stringify(error))
    return back(pending.return_to, 'connected')
  } catch (e) {
    console.log('Garmin callback error', String(e))
    return back(pending.return_to, 'failed')
  }
})
