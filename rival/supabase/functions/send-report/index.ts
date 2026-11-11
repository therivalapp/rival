import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Report an activity, a chat message or a member (Apple guideline 1.2,
// 2026-11-10, Mockup 27 v8). Saves the report in public.reports
// (supabase/report_block.sql) and emails it to hello@therivalapp.com with
// what was reported, so it can be reviewed and acted on. When the member
// also chose Block, the block is saved here too, so both land together.
// The reported member is never told.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const KINDS: Record<string, string> = { activity: 'Activity', message: 'Message', member: 'Member' }
const REASONS: Record<string, string> = { spam: 'Spam', harassment: 'Harassment', inappropriate: 'Inappropriate', other: 'Other' }
const MAX_PER_HOUR = 20
const FROM = 'RIVAL <hello@therivalapp.com>'
const TO = 'hello@therivalapp.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n) : '')
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const uuid = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json(401, { error: 'Sign in to send a report.' })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid request' })
  }

  const kind = typeof body.target_kind === 'string' && body.target_kind in KINDS ? body.target_kind : ''
  const reason = typeof body.reason === 'string' && body.reason in REASONS ? body.reason : ''
  const targetId = uuid(body.target_id)
  const reportedUserId = uuid(body.reported_user_id)
  const details = clip(body.details, 2000) || null
  const alsoBlock = body.block === true
  if (!kind || !reason || !reportedUserId) return json(400, { error: 'Choose a reason.' })
  if (kind !== 'member' && !targetId) return json(400, { error: 'Invalid request' })
  if (reportedUserId === user.id) return json(400, { error: 'Invalid request' })

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await admin
    .from('reports').select('id', { count: 'exact', head: true })
    .eq('reporter_id', user.id).gte('created_at', since)
  if (countError) {
    console.error('send-report count', countError.message)
    return json(500, { error: 'The report could not be sent. Try again.' })
  }
  if ((count ?? 0) >= MAX_PER_HOUR) return json(429, { error: 'Too many reports in the last hour. Try again later.' })

  const { data: saved, error } = await admin.from('reports').insert({
    reporter_id: user.id, reported_user_id: reportedUserId, target_kind: kind,
    target_id: kind === 'member' ? null : targetId, reason, details, also_blocked: alsoBlock,
  }).select('id').single()
  if (error) {
    console.error('send-report insert', error.message)
    return json(500, { error: 'The report could not be sent. Try again.' })
  }

  if (alsoBlock) {
    const { error: blockError } = await admin.from('user_blocks')
      .upsert({ blocker_id: user.id, blocked_id: reportedUserId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })
    if (blockError) {
      console.error('send-report block', blockError.message)
      return json(500, { error: 'The report was sent, but the block could not be saved. Try Block again.', reported: true })
    }
  }

  const key = Deno.env.get('RESEND_API_KEY')
  if (key) {
    const names = await admin.from('users').select('id, display_name').in('id', [user.id, reportedUserId])
    const nameOf = (id: string) => ((names.data ?? []) as { id: string; display_name: string | null }[])
      .find((u) => u.id === id)?.display_name || id

    // What was reported, as it reads now, so the email can be acted on
    // without opening the database.
    let content = ''
    if (kind === 'message' && targetId) {
      const { data } = await admin.from('league_messages').select('body, kind, created_at').eq('id', targetId).maybeSingle()
      const m = data as { body: string | null; kind: string; created_at: string } | null
      content = m ? `${m.kind === 'session' ? 'Planned activity' : (m.body ?? '')}  (sent ${m.created_at})` : 'Message not found (deleted?)'
    } else if (kind === 'activity' && targetId) {
      const { data } = await admin.from('activities').select('name, activity_type, notes, started_at').eq('id', targetId).maybeSingle()
      const a = data as { name: string | null; activity_type: string | null; notes: string | null; started_at: string | null } | null
      content = a ? [a.name || a.activity_type, a.started_at, a.notes].filter(Boolean).join(' · ') : 'Activity not found (deleted?)'
    }

    const lines: [string, string][] = [
      ['Reported', `${KINDS[kind]} by ${nameOf(reportedUserId)} (${reportedUserId})`],
      ['Reason', REASONS[reason]],
      ...(content ? [['Content', content] as [string, string]] : []),
      ...(targetId && kind !== 'member' ? [['Id', targetId] as [string, string]] : []),
      ['Details', details ?? 'None'],
      ['Also blocked', alsoBlock ? 'Yes' : 'No'],
      ['From', `${nameOf(user.id)}${user.email ? ` (${user.email})` : ''}`],
      ['Report', (saved as { id: string }).id],
    ]
    const text = ['A report needs review within 24 hours.', '', ...lines.map(([k, v]) => `${k}: ${v}`)].join('\n')
    const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6">` +
      `<p style="margin:0 0 14px"><b>A report needs review within 24 hours.</b></p>` +
      `<p style="margin:0">${lines.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join('<br>')}</p></div>`
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: [TO], subject: `Report: ${REASONS[reason]}, ${KINDS[kind].toLowerCase()} by ${nameOf(reportedUserId)}`,
          text, html,
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) console.error('send-report email', res.status, await res.text())
    } catch (e) {
      console.error('send-report email', String(e))
    }
  }
  return json(200, { ok: true })
})
