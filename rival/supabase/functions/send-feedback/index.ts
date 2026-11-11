import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Feedback from the app (Team Beta, 2026-11-10, Mockups 25 and 26): the BETA
// pill in the top bar and the Send feedback row in Settings post here. Saves
// the report in public.feedback (supabase/feedback.sql) and emails it to
// hello@therivalapp.com through Resend, with any screenshots attached (up to
// five; the iPhone app attaches the page itself) and the member's address as
// the reply-to. Screenshots are not stored. If the email fails the report still counts: the table is the
// record.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const KINDS: Record<string, string> = { problem: 'Problem', idea: 'Idea', dislike: 'Dislike', quote: 'Quote' }
const MAX_PER_HOUR = 20
const MAX_SHOTS = 5
// About 9 MB of images once decoded, all together; phone screenshots at the
// app's 0.6 quality are well under 1 MB each.
const MAX_SHOT_CHARS = 12_000_000
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
const FROM = 'RIVAL <hello@therivalapp.com>'
const TO = 'hello@therivalapp.com'

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n) : '')
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json(401, { error: 'Sign in to send feedback.' })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid request' })
  }

  const kind = typeof body.kind === 'string' && body.kind in KINDS ? body.kind : ''
  const message = clip(body.message, 4000)
  if (!kind) return json(400, { error: 'Choose a type.' })
  if (!message) return json(400, { error: 'Add some details.' })
  const page = clip(body.page, 200) || null
  const appVersion = clip(body.app_version, 40) || null
  const device = clip(body.device, 120) || null

  const rawShots = Array.isArray(body.screenshots) ? body.screenshots.slice(0, MAX_SHOTS) : []
  const shots = rawShots
    .map((p: { base64?: unknown; type?: unknown }) => ({
      data: typeof p?.base64 === 'string' ? p.base64 : '',
      type: typeof p?.type === 'string' && IMAGE_TYPES.has(p.type) ? p.type : 'image/jpeg',
    }))
    .filter((p: { data: string }) => /^[A-Za-z0-9+/=]+$/.test(p.data))
  if (shots.reduce((n: number, p: { data: string }) => n + p.data.length, 0) > MAX_SHOT_CHARS) {
    return json(413, { error: 'The screenshots are too large. Remove one and try again.' })
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await admin
    .from('feedback').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).gte('created_at', since)
  if (countError) {
    console.error('send-feedback count', countError.message)
    return json(500, { error: 'Feedback could not be sent. Try again.' })
  }
  if ((count ?? 0) >= MAX_PER_HOUR) return json(429, { error: 'Too much feedback in the last hour. Try again later.' })

  const { error } = await admin.from('feedback').insert({
    user_id: user.id, kind, message, page, app_version: appVersion, device, screenshot_count: shots.length,
  })
  if (error) {
    console.error('send-feedback insert', error.message)
    return json(500, { error: 'Feedback could not be sent. Try again.' })
  }

  const key = Deno.env.get('RESEND_API_KEY')
  if (key) {
    const { data: profile } = await admin.from('users').select('display_name').eq('id', user.id).maybeSingle()
    const name = (profile as { display_name?: string } | null)?.display_name || user.email || 'A member'
    const details = [
      ['From', `${name}${user.email ? ` (${user.email})` : ''}`],
      ['Page', page ?? 'Unknown'],
      ['App', appVersion ?? 'Unknown'],
      ['Phone', device ?? 'Unknown'],
    ]
    const text = [message, '', ...details.map(([k, v]) => `${k}: ${v}`)].join('\n')
    const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6">` +
      `<p style="white-space:pre-wrap;margin:0 0 16px">${esc(message)}</p>` +
      `<p style="margin:0;color:#666;font-size:13px">${details.map(([k, v]) => `${k}: ${esc(v)}`).join('<br>')}</p></div>`
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: [TO], subject: `${KINDS[kind]}: ${message.split('\n')[0].slice(0, 70)}`,
          text, html, ...(user.email ? { reply_to: user.email } : {}),
          ...(shots.length ? {
            attachments: shots.map((p: { data: string; type: string }, i: number) => ({
              filename: `screenshot-${i + 1}.${p.type.split('/')[1].replace('jpeg', 'jpg')}`, content: p.data,
            })),
          } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) console.error('send-feedback email', res.status, await res.text())
    } catch (e) {
      console.error('send-feedback email', String(e))
    }
  }
  return json(200, { ok: true })
})
