import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Account approval for Team Beta (Mockup 30, 2026-11-11; supabase/account_approval.sql).
//
// POST { action: 'request' } (signed in, from the Waiting for approval page):
//   returns { approved }. The first time an account waits, emails
//   hello@therivalapp.com a "New sign-up" card with Approve and Decline.
// POST { action: 'approve' | 'decline', user_id, token } (no sign-in, from the
//   /approve page the email links to): the token is an HMAC of the action and
//   the account, signed with the service key, so only the email's links work.
//   Approve emails the member "You are in". Decline removes a waiting account.
// Deploy with --no-verify-jwt: the approve links are opened without a session.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const FROM = 'RIVAL <hello@therivalapp.com>'
const TO = 'hello@therivalapp.com'
const APP = 'https://dist-ten-pi-90.vercel.app'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const SERIF = "Georgia,'Times New Roman',serif"
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function sign(action: string, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`rival-approval:${action}:${userId}`))
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

async function sendEmail(to: string, subject: string, text: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error('approve-member email', res.status, await res.text())
  } catch (e) {
    console.error('approve-member email', String(e))
  }
}

// The RIVAL email layout (scripts/build-emails.py), with a kicker, an optional
// facts table, one button and an optional note.
function layout(kicker: string, title: string, inner: string, button: [string, string], note?: string) {
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
    `<div style="font-family:${SANS};font-size:11px;font-weight:800;letter-spacing:2.5px;color:#ffb59e;margin:0 0 10px">${esc(kicker)}</div>` +
    `<h1 class="title" style="margin:0 0 16px;font-family:${SERIF};font-style:italic;font-weight:700;font-size:32px;line-height:1.2;color:#ffffff">${esc(title)}</h1>` +
    inner +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:12px auto 4px"><tr>' +
    '<td align="center" bgcolor="#ec9a7f" style="border-radius:999px;background-color:#ec9a7f;background-image:linear-gradient(135deg,#D97757 0%,#ffb59e 100%)">' +
    `<a href="${button[1]}" style="display:inline-block;padding:15px 34px;font-family:${SANS};font-size:15px;font-weight:800;color:#5c1902;text-decoration:none;border-radius:999px">${esc(button[0])}</a></td></tr></table>` +
    (note ? `<p style="margin:18px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:#8a8682">${note}</p>` : '') +
    '</td></tr>' +
    `<tr><td align="center" style="padding:22px 8px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:#8a8682">` +
    'RIVAL &middot; <a href="https://therivalapp.com" style="color:#8a8682;text-decoration:underline">therivalapp.com</a></td></tr>' +
    '</table></td></tr></table></body></html>'
}
function facts(rows: [string, string][]) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#2c2b2a" style="background:#2c2b2a;border-radius:14px;margin:0 0 14px">' +
    rows.map(([k, v], i) => `<tr><td style="padding:11px 14px;font-family:${SANS};font-size:13px;color:#a8a49f;text-align:left${i ? ';border-top:1px solid #363534' : ''}">${esc(k)}</td>` +
      `<td style="padding:11px 14px;font-family:${SANS};font-size:13px;font-weight:600;color:#ffffff;text-align:right${i ? ';border-top:1px solid #363534' : ''}">${esc(v)}</td></tr>`).join('') +
    '</table>'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid request' })
  }
  const action = typeof body.action === 'string' ? body.action : ''
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  // ---- A waiting member asks where things stand -------------------------
  if (action === 'request') {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json(401, { error: 'Sign in first.' })

    const { data: row, error } = await admin.from('users')
      .select('display_name, email, approved_at, approval_requested_at, created_at').eq('id', user.id).maybeSingle()
    if (error || !row) return json(500, { error: 'Could not check the account. Try again.' })
    if (row.approved_at) return json(200, { approved: true })

    // On the website's Team Beta list after the account was made: approve now.
    const email = (row.email || user.email || '').toLowerCase()
    if (email) {
      const { data: listed } = await admin.from('beta_signups').select('id').ilike('email', email).limit(1)
      if (listed && listed.length) {
        await admin.from('users').update({ approved_at: new Date().toISOString() }).eq('id', user.id)
        return json(200, { approved: true })
      }
    }

    if (!row.approval_requested_at) {
      const { data: claimed } = await admin.from('users')
        .update({ approval_requested_at: new Date().toISOString() })
        .eq('id', user.id).is('approval_requested_at', null).select('id')
      if (claimed && claimed.length) {
        const name = row.display_name || 'New member'
        const link = async (a: string) => `${APP}/approve?a=${a}&u=${user.id}&t=${await sign(a, user.id)}`
        const signedUp = new Date(row.created_at || user.created_at).toLocaleString('en-CA', {
          timeZone: 'America/Vancouver', dateStyle: 'medium', timeStyle: 'short',
        })
        const declineUrl = await link('decline')
        const html = layout('NEW SIGN-UP', name, facts([['Email', email || 'Unknown'], ['Signed up', signedUp]]),
          ['Approve', await link('approve')],
          `Not someone you know? <a href="${declineUrl}" style="color:#ffb59e;text-decoration:underline">Decline</a> removes the account.`)
        const text = `New sign-up: ${name}\nEmail: ${email}\nSigned up: ${signedUp}\n\nApprove: ${await link('approve')}\nDecline: ${declineUrl}`
        await sendEmail(TO, `New sign-up: ${name}`, text, html)
      }
    }
    return json(200, { approved: false })
  }

  // ---- Approve or Decline from the email ----------------------------------
  if (action === 'approve' || action === 'decline') {
    const userId = typeof body.user_id === 'string' && UUID.test(body.user_id) ? body.user_id : ''
    const token = typeof body.token === 'string' ? body.token : ''
    if (!userId || !token || !sameText(token, await sign(action, userId))) {
      return json(403, { error: 'This link is not valid.' })
    }
    const { data: row } = await admin.from('users').select('display_name, email, approved_at').eq('id', userId).maybeSingle()
    if (!row) return json(200, { status: 'gone' })
    const name = row.display_name || 'The member'

    if (action === 'approve') {
      if (row.approved_at) return json(200, { status: 'already', name })
      const { error } = await admin.from('users').update({ approved_at: new Date().toISOString() }).eq('id', userId)
      if (error) return json(500, { error: 'Could not approve. Try again.' })
      const { data: authUser } = await admin.auth.admin.getUserById(userId)
      const to = authUser?.user?.email || row.email
      if (to) {
        const html = layout('TEAM BETA', 'You are in',
          `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:#d4d1ce">Your RIVAL account is approved. Open RIVAL to choose your activities and bring in your history.</p>`,
          ['Open RIVAL', APP])
        await sendEmail(to, 'You are in', 'Your RIVAL account is approved. Open RIVAL to choose your activities and bring in your history.\n\n' + APP, html)
      }
      return json(200, { status: 'approved', name })
    }

    // Decline: only an account that is still waiting can be removed this way.
    if (row.approved_at) return json(200, { status: 'already', name })
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return json(500, { error: 'Could not decline. Try again.' })
    return json(200, { status: 'declined', name })
  }

  return json(400, { error: 'Invalid request' })
})
