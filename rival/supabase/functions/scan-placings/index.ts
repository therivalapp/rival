// Reads an event's placings from a photo or screenshot of its results
// (Ricky, 2026-11-04, design/event-placings-mockup.png): overall, division and
// age group, each with the field size where shown, plus a rank for each HYROX
// run and station, or each event of a multi-day competition. Modelled on
// scan-workout. The page asks the member to check the numbers before saving;
// nothing is written here.
//
// With want: 'times' it reads the official finish and each transition
// instead (Ricky, 2026-11-05, design/event-transitions-mockup.png), for the
// Official finish time pop-up (EventTimesSheet.tsx). Times come back as
// whole seconds, so nothing here reads clock text.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status })

const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseInt(v.replace(/[^0-9]/g, ''), 10) : typeof v === 'number' ? Math.round(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** One request to Claude for JSON read from the images. */
async function askClaude(content: unknown[]): Promise<{ value: Record<string, unknown> } | { error: string; status: number }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, messages: [{ role: 'user', content }] }),
  })
  const data = await response.json()
  if (!response.ok) {
    console.log('Anthropic API error:', JSON.stringify(data))
    return { error: 'The results could not be read. Try again, or type them in.', status: 500 }
  }
  const text = data.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { error: 'No times were found in the photo. Try a clearer photo, or type them in.', status: 422 }
  return { value: JSON.parse(match[0]) }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not signed in.' }, 401)

    const body = await req.json()
    const images: Array<{ base64Image: string; mediaType: string }> = (body.images ?? []).slice(0, 4)
    if (!images.length) return json({ error: 'No photo was sent.' }, 400)
    const kind: string = body.kind === 'hyrox' || body.kind === 'days' ? body.kind : 'other'
    const events: string[] = Array.isArray(body.events) ? body.events.slice(0, 30).map(String) : []

    const imageBlocks = images.flatMap((img, i) => [
      { type: 'text', text: `Image ${i + 1}:` },
      { type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64Image } },
    ])

    if (body.want === 'times') {
      const gaps = Math.max(0, Math.min(6, Number(body.transitions) || 0))
      const read = await askClaude([
        ...imageBlocks,
        {
          type: 'text',
          text: `These images show one athlete's results from a race (a results website, an app screenshot, a printed sheet or a board). Read the athlete's official finish time${gaps ? ` and their ${gaps} transition times in race order (T1, T2${gaps > 2 ? ' and so on' : ''})` : ''}. Return JSON only, every time as a whole number of seconds:
{ "finish": 11660, "transitions": [168, 166] }
Use null for any time that is not shown. Never guess a number.`,
        },
      ])
      if ('error' in read) return json({ error: read.error }, read.status)
      const raw = read.value
      const secs = (v: unknown) => { const n = posInt(v); return n && n < 7 * 24 * 3600 ? n : null }
      const finish = secs(raw.finish)
      const transitions = Array.from({ length: gaps }, (_, i) => secs(Array.isArray(raw.transitions) ? raw.transitions[i] : null))
      if (!finish && !transitions.some(Boolean)) {
        return json({ error: 'No times were found in the photo. Try a clearer photo, or type them in.' }, 422)
      }
      return json({ success: true, times: { finish, transitions } })
    }

    const extra = kind === 'hyrox'
      ? `This is a HYROX result. Also return "parts": the athlete's rank for each 1 km run as "run1".."run8" and for each station as "st1".."st8", in race order (SkiErg, Sled push, Sled pull, Burpee broad jumps, Row, Farmers carry, Sandbag lunges, Wall balls). Use the rank within the athlete's division when both are shown. Leave out any part without a rank shown.`
      : kind === 'days' && events.length
      ? `This is a competition over several days with these events, in order: ${events.map((e, i) => `${i + 1}. ${e}`).join('; ')}. Also return "events": an array with the athlete's place in each of those events, in that order, null where not shown.`
      : ''

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: `These images show one athlete's results from a race or competition (a results website, an app screenshot, a printed sheet or a board). Read the athlete's placings and return JSON only:
{
  "rows": [
    { "key": "division", "category": "Open Men", "place": 86, "of": 1240 },
    { "key": "overall", "category": "Everyone", "place": 214, "of": 3100 },
    { "key": "age", "category": "M 35-39", "place": 19, "of": 262 }
  ]
}
key is "division" (a division, wave or class such as Open Men, RX Women, Pro), "overall" (the whole field), "age" (an age group) or "gender" (men or women only). category is the name shown for that group. place is the athlete's position. of is the number of finishers in that group, only when shown (for example "86 / 1240" or "of 1,240"), otherwise null. Leave out any row that is not shown. Never guess a number. ${extra}`,
            },
          ],
        }],
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      console.log('Anthropic API error:', JSON.stringify(data))
      return json({ error: 'The results could not be read. Try again, or type them in.' }, 500)
    }
    const text = data.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return json({ error: 'No placings were found in the photo. Try a clearer photo, or type them in.' }, 422)
    const raw = JSON.parse(match[0])

    // Only numbers that look like places reach the page.
    const rows = (Array.isArray(raw.rows) ? raw.rows : [])
      .map((r: Record<string, unknown>) => ({ key: String(r.key ?? ''), category: r.category ? String(r.category).slice(0, 40) : null, place: posInt(r.place), of: posInt(r.of) }))
      .filter((r: { key: string; place: number | null }) => r.key && r.place)
    const parts: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw.parts ?? {})) {
      const n = posInt(v)
      if (n && /^(run|st)[1-8]$/.test(k)) parts[k] = n
    }
    const placed = Array.isArray(raw.events) ? raw.events.slice(0, events.length).map(posInt) : []

    if (!rows.length && !Object.keys(parts).length && !placed.some(Boolean)) {
      return json({ error: 'No placings were found in the photo. Try a clearer photo, or type them in.' }, 422)
    }
    return json({ success: true, placings: { rows, parts, events: placed } })
  } catch (err) {
    console.log('Error:', (err as Error).message)
    return json({ error: 'The results could not be read. Try again, or type them in.' }, 500)
  }
})
