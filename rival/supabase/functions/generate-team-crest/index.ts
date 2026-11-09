import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Ricky's own account — exempt from the regen cooldown so he can iterate on
// crest quality/prompt changes without waiting 3 months between tries. Every
// other account still gets the real limit.
const UNLIMITED_REGEN_USER_ID = '09b2e197-8257-4d7c-a0e6-12dc0429eeff'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const t0 = Date.now()
    const authHeader = req.headers.get('Authorization')
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { leagueId, cleanup } = await req.json()
    if (!leagueId) return new Response(JSON.stringify({ error: 'leagueId required' }), { status: 400, headers: corsHeaders })

    const { data: membership } = await userClient
      .from('league_members')
      .select('role')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()
    if (membership?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only team admins can generate a crest' }), { status: 403, headers: corsHeaders })
    }

    const { data: league } = await userClient
      .from('leagues')
      .select('name, crest_generated_at, logo_url')
      .eq('id', leagueId)
      .single()
    if (!league) return new Response(JSON.stringify({ error: 'Team not found' }), { status: 404, headers: corsHeaders })

    const adminClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const folder = `leagues/${leagueId}`

    // Deletes this team's crest candidates except the files named in keep.
    // Only crest-* files are touched: crest.png and logo.* from older teams
    // stay. The team's current crest (logo_url) is always kept, so this can
    // never remove the crest a team is showing. Admins can't delete team
    // files from the app (storage policy), so it happens here.
    const removeCrests = async (keep: string[]) => {
      const current = (league.logo_url ?? '').split('/avatars/')[1]?.split('?')[0]
      const { data: files } = await adminClient.storage.from('avatars').list(folder, { limit: 100 })
      const doomed = (files ?? [])
        .map((f) => `${folder}/${f.name}`)
        .filter((path) => path.startsWith(`${folder}/crest-`) && path !== current && !keep.includes(path))
      if (doomed.length) await adminClient.storage.from('avatars').remove(doomed)
      return doomed.length
    }

    // Called once a crest is picked (logo_url already saved): the two not
    // picked are removed. No cooldown check, since nothing is generated.
    if (cleanup) {
      const removed = await removeCrests([])
      return new Response(JSON.stringify({ removed }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Regeneration is allowed, but only once every 3 months (Ricky, 2026-11-09; was 6) — frequent
    // changes would cheapen the crest as a team identity rather than a
    // disposable cosmetic, even though the per-image cost is trivial.
    if (league.crest_generated_at && user.id !== UNLIMITED_REGEN_USER_ID) {
      const nextEligible = new Date(league.crest_generated_at)
      nextEligible.setMonth(nextEligible.getMonth() + 3)
      if (Date.now() < nextEligible.getTime()) {
        return new Response(JSON.stringify({ error: `This team can regenerate its crest starting ${nextEligible.toISOString().slice(0, 10)}` }), { status: 409, headers: corsHeaders })
      }
    }

    // Ask a cheap text model what the team name actually evokes — without
    // this, every crest converges on the same mountain/badge template because
    // the image prompt itself never varied. Same model already used for AI
    // Share captions (generate-share-caption, scan-workout), so no new secret.
    let concept = 'a mountain landscape, rust orange and olive green palette, adventurous mood'
    try {
      const briefRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 60,
          messages: [{
            role: 'user',
            content: `A sports team is called "${league.name}". In one line (under 20 words, no preamble), describe a crest concept for it: a specific icon/motif suggested by the name, a 2-3 color palette, and a mood. If the name has no obvious theme, invent something fitting a fitness/sports team.`,
          }],
        }),
      })
      if (briefRes.ok) {
        const briefData = await briefRes.json()
        const text = briefData?.content?.[0]?.text?.trim()
        if (text) concept = text
      }
    } catch {
      // Fall back to the generic concept above — a crest still generates.
    }

    // The team name text is the single most important element — flux/schnell
    // sometimes drops baked-in text entirely, so this is stated up front and
    // repeated at the end rather than mentioned once in the middle, and
    // "MUST" language is used deliberately (soft phrasing like "bold clean
    // title text" got skipped more often in practice).
    const prompt = `A sports/fitness team crest that MUST include the team's name "${league.name}" as bold, legible text on a title banner across the bottom of the badge — this text is the most important part of the image and must not be omitted. Emblem crest badge logo, concept: ${concept}. Vector illustration style, layered papercut scene, badge/shield border, symmetrical, high detail, no photorealism, plain flat light background so the badge silhouette is easy to cut out. Remember: the banner text "${league.name}" must be clearly rendered and readable.`

    // fal-ai/flux/schnell — cheap, fast text-to-image (~$0.003/image), chosen
    // over the higher-quality GPT Image model specifically for per-team cost.
    // Three candidates give the admin a real choice.
    //
    // Each candidate runs its own chain — draw, cut out, save — side by side
    // (2026-11-06, Ricky: crests took 10-20 s). It used to draw all three in
    // one call, then cut out and save them, so every crest waited for the
    // slowest drawing before any cut-out began. Same model, prompt and size,
    // so the crests look the same; only the waiting overlaps.
    const falHeaders = { 'Authorization': `Key ${Deno.env.get('FAL_KEY')}`, 'Content-Type': 'application/json' }
    const tBrief = Date.now() - t0
    const stage: Record<string, number[]> = { draw: [], cutout: [], save: [] }

    // Each batch gets its own file names. Reusing one set of names meant a
    // new batch overwrote the file the team's current crest points at.
    const batch = Date.now()
    // The image model often misspells the banner ("NORTHSIDE TRENTT",
    // "STRENGITH"; about one crest in three, 2026-11-08). Each drawing is read
    // back by a vision model and redrawn if the name isn't spelled exactly.
    const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const wanted = norm(league.name)
    const spelledRight = async (url: string): Promise<boolean> => {
      if (!wanted) return true
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 40,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'url', url } },
                { type: 'text', text: 'Copy out the words written on this crest exactly as they are spelled, letter for letter, including any spelling mistakes. Reply with the words only, or NONE if there are none.' },
              ],
            }],
          }),
        })
        // A failed check never blocks a crest; it just isn't checked.
        if (!res.ok) return true
        const read = (await res.json())?.content?.[0]?.text ?? ''
        return norm(read).includes(wanted)
      } catch {
        return true
      }
    }
    const MAX_DRAWS = 3
    const stageCheck: number[] = []

    // The image services are usually quick (draw ~1 s, cut-out 2-4 s) but now
    // and then one request stalls: a cut-out once took 44 s (2026-11-08). A
    // stalled request gets a second, identical one alongside it after a short
    // wait, and whichever finishes first is used, so one slow request can't
    // hold up the crests. Costs a fraction of a cent, only when it happens.
    const hedged = <T,>(run: (signal: AbortSignal) => Promise<T>, afterMs: number, limitMs: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const controllers: AbortController[] = []
        let finished = false
        let failures = 0
        let lastErr: unknown
        const finish = (ok: boolean, value: unknown) => {
          if (finished) return
          finished = true
          clearTimeout(backup)
          clearTimeout(limit)
          controllers.forEach((c) => c.abort())
          if (ok) resolve(value as T)
          else reject(value)
        }
        const launch = () => {
          const c = new AbortController()
          controllers.push(c)
          run(c.signal).then((v) => finish(true, v), (e) => {
            lastErr = e
            failures++
            // A first try that fails outright starts the second at once.
            if (controllers.length < 2) launch()
            else if (failures >= controllers.length) finish(false, lastErr)
          })
        }
        const backup = setTimeout(() => { if (!finished && controllers.length < 2) launch() }, afterMs)
        const limit = setTimeout(() => finish(false, new Error('Timed out')), limitMs)
        launch()
      })

    const drawOnce = async (): Promise<string> => {
      const t = Date.now()
      const imageUrl = await hedged(async (signal) => {
        const genRes = await fetch('https://fal.run/fal-ai/flux/schnell', {
          method: 'POST',
          headers: falHeaders,
          body: JSON.stringify({ prompt, image_size: 'square_hd', num_images: 1 }),
          signal,
        })
        if (!genRes.ok) throw new Error(`Crest generator ${genRes.status}: ${(await genRes.text()).slice(0, 300)}`)
        const url = (await genRes.json())?.images?.[0]?.url
        if (!url) throw new Error('Crest generator returned no images')
        return url as string
      }, 4_000, 30_000)
      stage.draw.push(Date.now() - t)
      return imageUrl
    }

    const cutOut = (imageUrl: string): Promise<string> => hedged(async (signal) => {
      const res = await fetch('https://fal.run/fal-ai/imageutils/rembg', {
        method: 'POST',
        headers: falHeaders,
        body: JSON.stringify({ image_url: imageUrl }),
        signal,
      })
      if (!res.ok) throw new Error(`Bg removal ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const url = (await res.json())?.image?.url
      if (!url) throw new Error('Bg removal returned no image')
      return url as string
    }, 6_000, 25_000)

    const makeCandidate = async (i: number): Promise<{ url: string; spelled: boolean }> => {
      // Draw, read back the name, redraw if it's misspelled (up to three
      // drawings). If none is right, the last one is kept so a crest still
      // comes back, marked as misspelled.
      let imageUrl = ''
      let spelled = false
      for (let n = 0; n < MAX_DRAWS && !spelled; n++) {
        imageUrl = await drawOnce()
        const tc = Date.now()
        // A check that hasn't answered in 6 s is skipped, never waited on.
        spelled = await Promise.race([spelledRight(imageUrl), new Promise<boolean>((r) => setTimeout(() => r(true), 6_000))])
        stageCheck.push(Date.now() - tc)
      }
      // Cut the flat generator background out so the crest sits directly on
      // the app's dark UI. Best-effort: if it fails, the candidate ships opaque.
      let t = Date.now()
      let finalUrl = imageUrl
      try {
        finalUrl = await cutOut(imageUrl)
      } catch (e) {
        console.error('Bg removal failed:', String(e).slice(0, 200))
        errors.push(`cutout: ${String(e).slice(0, 120)}`)
      }
      stage.cutout.push(Date.now() - t)

      t = Date.now()
      const imgRes = await fetch(finalUrl)
      const imgBytes = new Uint8Array(await imgRes.arrayBuffer())
      const path = `${folder}/crest-${batch}-${i}.png`
      const { error: storageErr } = await adminClient.storage
        .from('avatars')
        .upload(path, imgBytes, { contentType: 'image/png', upsert: true })
      if (storageErr) throw new Error(`Storage upload failed: ${storageErr.message}`)
      stage.save.push(Date.now() - t)

      const { data: urlData } = adminClient.storage.from('avatars').getPublicUrl(path)
      return { url: urlData.publicUrl, spelled }
    }

    // One failed candidate doesn't sink the others; only all three failing does.
    // A candidate that fails outright (a service error) is tried once more.
    const errors: string[] = []
    const withRetry = async (i: number) => {
      try {
        return await makeCandidate(i)
      } catch (e) {
        errors.push(`candidate ${i}: ${String(e).slice(0, 160)}`)
        return await makeCandidate(i)
      }
    }
    const settled = await Promise.allSettled([0, 1, 2].map(withRetry))
    const made = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    // Only correctly spelled crests are offered; if every one is misspelled
    // (rare: three drawings each), they're all offered rather than none.
    const right = made.filter((c) => c.spelled)
    const candidateUrls = (right.length ? right : made).map((c) => c.url)
    if (candidateUrls.length === 0) {
      const reason = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
      console.error('Crest gen failed:', String(reason?.reason).slice(0, 300))
      return new Response(JSON.stringify({ error: String(reason?.reason ?? 'Crest generator returned no images').slice(0, 300) }), { status: 502, headers: corsHeaders })
    }
    // Candidates from an earlier batch that was never picked go now, so a
    // team only ever holds its current crest plus the three being offered.
    const newPaths = candidateUrls.map((u) => u.split('/avatars/')[1])
    const tidy = removeCrests(newPaths).catch(() => 0)
    ;(globalThis as any).EdgeRuntime?.waitUntil?.(tidy)
    console.log('crest timings ms', JSON.stringify({ brief: tBrief, ...stage, check: stageCheck, spelled: made.map((c) => c.spelled), total: Date.now() - t0 }))

    // Deliberately not writing logo_url/crest_generated_at here — the admin
    // hasn't chosen one yet. The cooldown starts only once a pick is
    // confirmed (client writes those two columns directly; RLS's "admins can
    // update league" policy already gates that write to the same admins this
    // function just checked).
    return new Response(JSON.stringify({ urls: candidateUrls, timings: { brief: tBrief, ...stage, check: stageCheck, spelled: made.map((c) => c.spelled), errors, total: Date.now() - t0 } }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
