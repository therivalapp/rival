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

// When Team Beta reaches them: Canada outside Quebec, Australia and New
// Zealand are first (BETA_PLAN.md); everyone else waits for a later round.
function whenLine(country: string, region: string | null) {
  const first = OPEN_FIRST.includes(country) || (country === 'Canada' && region !== 'Quebec')
  return first
    ? 'Team Beta opens first in Canada, Australia and New Zealand. When it opens, we will email you an invite to install RIVAL on your iPhone.'
    : 'Team Beta opens first in Canada, Australia and New Zealand. We will email you an invite when it opens where you live.'
}

// The designed email layout (Mockup 18, 2026-11-10), the same as the sign-in
// emails built by scripts/build-emails.py. Tables and inline styles, since
// email apps ignore most CSS; the button falls back to solid salmon where
// gradients are not shown.
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const SERIF = "Georgia,'Times New Roman',serif"
function layout(title: string, lines: string[], note: string) {
  const body = lines.map((l) =>
    `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:#d4d1ce">${esc(l)}</p>`).join('')
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">' +
    `<title>${esc(title)}</title><style>body{margin:0}@media (max-width:480px){.card{padding-left:22px !important;padding-right:22px !important}` +
    '.title{font-size:26px !important}.outer{padding:28px 12px !important}}</style></head>' +
    '<body style="margin:0;background:#1b1a19">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1b1a19" style="background:#1b1a19"><tr>' +
    '<td class="outer" align="center" style="padding:40px 16px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">' +
    `<tr><td align="center" style="padding:0 0 22px;font-family:${SERIF};font-style:italic;font-size:18px;font-weight:700;letter-spacing:4px;padding-left:4px;color:#ffb59e">RIVAL</td></tr>` +
    '<tr><td class="card" align="center" bgcolor="#262626" style="background:#262626;border:1px solid #363636;border-radius:20px;padding:40px 40px 36px;text-align:center">' +
    `<h1 class="title" style="margin:0 0 16px;font-family:${SERIF};font-style:italic;font-weight:700;font-size:30px;line-height:1.2;color:#ffffff">${esc(title)}</h1>` +
    `${body}<p style="margin:18px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:#8a8682">${esc(note)}</p></td></tr>` +
    `<tr><td align="center" style="padding:22px 8px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:#8a8682">` +
    'RIVAL &middot; <a href="https://therivalapp.com" style="color:#8a8682;text-decoration:underline">therivalapp.com</a></td></tr>' +
    '</table></td></tr></table></body></html>'
}

const CONFIRM_SUBJECT = 'You are on the RIVAL Team Beta list'
function confirmation(firstName: string, country: string, region: string | null) {
  const lines = [`Hi ${firstName},`, whenLine(country, region)]
  const note = 'This is the only email you will receive until your invite. To be removed, reply to this email.'
  const text = ['You are on the list', ...lines, note, 'RIVAL\ntherivalapp.com'].join('\n\n')
  return { text, html: layout('You are on the list', lines, note) }
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
      sendEmail(email, CONFIRM_SUBJECT, c.text, c.html, NOTIFY),
      sendEmail(
        NOTIFY,
        `New Team Beta sign-up: ${name}`,
        notice.join('\n'),
        `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6">${notice.map(esc).join('<br>')}</div>`,
        email,
      ),
    ])
  }
  return reply(200, { ok: true })
})
