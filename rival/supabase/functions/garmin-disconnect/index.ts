import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GARMIN_REGISTRATION_URL, liveAccessToken } from '../_shared/garmin.ts'

// Disconnects Garmin: removes RIVAL's registration at Garmin (so Garmin stops
// sending this member's data and the access is revoked), then deletes the
// connection row. Activities already in RIVAL stay; they are the member's.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  try {
    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not authenticated' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    const { data: conn } = await supabase.from('garmin_connections').select('*').eq('user_id', user.id).maybeSingle()
    if (!conn) return json({ ok: true })
    try {
      const token = await liveAccessToken(supabase, conn)
      if (token) {
        const res = await fetch(GARMIN_REGISTRATION_URL, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok && res.status !== 404) console.log('Garmin deregistration', res.status, (await res.text()).slice(0, 200))
      }
    } catch (e) {
      // Tokens already revoked at Garmin's end: removing the row is enough.
      console.log('Garmin deregistration error', String(e))
    }
    const { error } = await supabase.from('garmin_connections').delete().eq('user_id', user.id)
    if (error) return json({ error: 'Could not disconnect' }, 500)
    return json({ ok: true })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
