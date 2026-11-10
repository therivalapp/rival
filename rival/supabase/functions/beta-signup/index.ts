import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// The Join Team Beta pop-up on therivalapp.com posts here (2026-11-09).
// Public: deployed with --no-verify-jwt, since visitors have no account.
// Stores name, email and country (province for Canada) in beta_signups,
// which only the service role can reach (supabase/beta_signups.sql).
//
// A new sign-up sends two emails through Resend (RESEND_API_KEY secret): a
// confirmation to the person, and a notice to hello@therivalapp.com. Repeats
// and bots send nothing. If the key is missing or Resend fails, the sign-up
// still counts; the emails are a courtesy, the table is the list.
//
// The answer is the same whether the address is new, already on the list, or
// caught by the bot checks, so the form never reveals who has signed up.

const ORIGINS = new Set([
  'https://therivalapp.com',
  'https://www.therivalapp.com',
  'https://therivalapp.vercel.app',
])
// A flood guard, far above what a friends beta brings in an hour.
const MAX_PER_HOUR = 200
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const COUNTRIES = ['Canada', 'Australia', 'New Zealand', 'United Kingdom', 'United States', 'Another country']
const PROVINCES = [
  'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador',
  'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island',
  'Quebec', 'Saskatchewan', 'Yukon',
]
// A name: control characters and angle brackets removed, at most 60 long.
const cleanName = (v: unknown) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60) : ''

const FROM = 'RIVAL <hello@therivalapp.com>'
const NOTIFY = 'hello@therivalapp.com'
const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const OPEN_FIRST = ['Australia', 'New Zealand']

async function sendEmail(to: string, subject: string, text: string, html: string, replyTo?: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error('beta-signup email', res.status, await res.text())
  } catch (e) {
    console.error('beta-signup email', String(e))
  }
}

// When the beta reaches them: Canada outside Quebec, Australia and New
// Zealand are first (BETA_PLAN.md); everyone else waits for a later round.
function whenLine(country: string, region: string | null) {
  const first = OPEN_FIRST.includes(country) || (country === 'Canada' && region !== 'Quebec')
  return first
    ? 'The beta opens first in Canada, Australia and New Zealand. When it opens, we will email you an invite to install RIVAL on your iPhone through TestFlight.'
    : 'The beta opens first in Canada, Australia and New Zealand. We will email you an invite when it opens where you live.'
}

function confirmation(firstName: string, country: string, region: string | null) {
  const lines = [
    `Hi ${firstName},`,
    'You are on the RIVAL beta list.',
    whenLine(country, region),
    'This is the only email you will receive until your invite. To be removed from the list, reply to this email.',
  ]
  const text = [...lines, 'RIVAL\ntherivalapp.com'].join('\n\n')
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:520px">${
    lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join('')
  }<p style="margin:22px 0 0;color:#777;font-size:13px">RIVAL &middot; <a href="https://therivalapp.com" style="color:#777">therivalapp.com</a></p></div>`
  return { text, html }
}

function headers(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && ORIGINS.has(origin) ? origin : 'https://therivalapp.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  }
}

serve(async (req) => {
  const h = headers(req.headers.get('origin'))
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: h })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })
  if (Number(req.headers.get('content-length') ?? 0) > 2000) return reply(413, { error: 'Too large' })

  let body: {
    email?: unknown; first_name?: unknown; last_name?: unknown; country?: unknown; region?: unknown
    company?: unknown; ms?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request' })
  }

  // Bots: the hidden "company" box is filled, or the form was sent faster
  // than a person can type. Answer as if it worked and store nothing.
  if (typeof body.company === 'string' && body.company.trim() !== '') return reply(200, { ok: true })
  if (typeof body.ms === 'number' && body.ms < 1200) return reply(200, { ok: true })

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (email.length < 6 || email.length > 254 || !EMAIL.test(email)) {
    return reply(400, { error: 'Enter a valid email address.' })
  }
  const firstName = cleanName(body.first_name)
  const lastName = cleanName(body.last_name)
  if (!firstName || !lastName) return reply(400, { error: 'Enter a first and last name.' })
  const country = typeof body.country === 'string' && COUNTRIES.includes(body.country) ? body.country : ''
  if (!country) return reply(400, { error: 'Choose a country.' })
  const region = country === 'Canada' && typeof body.region === 'string' && PROVINCES.includes(body.region) ? body.region : null
  if (country === 'Canada' && !region) return reply(400, { error: 'Choose a province or territory.' })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await admin
    .from('beta_signups')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
  if (countError) {
    console.error('beta-signup count', countError.message)
    return reply(500, { error: 'Could not join' })
  }
  if ((count ?? 0) >= MAX_PER_HOUR) return reply(429, { error: 'Too many sign-ups. Try again later.' })

  const { error } = await admin
    .from('beta_signups')
    .insert({ email, first_name: firstName, last_name: lastName, country, region })
  // 23505: already on the list, which counts as done.
  if (error && error.code !== '23505') {
    console.error('beta-signup insert', error.message)
    return reply(500, { error: 'Could not join' })
  }

  // Emails only for a new sign-up, so a repeat cannot be used to send mail.
  if (!error) {
    const { count: total } = await admin.from('beta_signups').select('id', { count: 'exact', head: true })
    const place = region ? `${region}, ${country}` : country
    const c = confirmation(firstName, country, region)
    const name = `${firstName} ${lastName}`
    const notice = [`${name}`, email, place, `${total ?? '?'} on the list`]
    await Promise.all([
      sendEmail(email, 'You are on the RIVAL beta list', c.text, c.html, NOTIFY),
      sendEmail(
        NOTIFY,
        `New beta sign-up: ${name}`,
        notice.join('\n'),
        `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6">${notice.map(esc).join('<br>')}</div>`,
        email,
      ),
    ])
  }
  return reply(200, { ok: true })
})
