import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Per-style lighting/mood grade. The rest of the prompt (route projection,
// stats, RIVAL branding, likeness preservation) is universal.
// Recipe that worked for cinematic: strong core aesthetic + saturation/contrast/
// clarity to fight mud (NOT by removing the core colour) + a people-vibrancy clause.
const STYLE_MOOD: Record<string, string> = {
  cinematic: 'bright, brilliant cinematic GOLDEN-HOUR lighting — strong warm radiant golden glow with rich amber sunset light flooding the scene, deeply saturated vivid colours, punchy high contrast and crisp sparkling highlights, like a premium sports advertisement. Keep the golden warmth rich, luminous and glowing, but CRISP and CLEAN — high clarity and high definition, with no dusty haze, smog, murk or low-contrast fog. The gold must look vivid, radiant and sharp, never dull, flat, brown, washed-out or muddy. Keep the people luminous and vibrant with warm, healthy, glowing skin tones and rich vivid colour.',
  cyberpunk: 'a bold cyberpunk neon-night grade — deep blue-and-purple darkness lit by vivid electric neon, rain-slicked reflections and Blade Runner mood. The environment, ground, background and reflections should be intensely neon-lit with cyan and magenta. Keep it CRISP, high-contrast and richly saturated with punchy glowing neon — never muddy, murky or hazy. Keep the person\'s face and skin tones natural and healthy — a subtle warm glow, not red or ruddy, just a gentle neutral warmth that looks like soft natural fill light. Keep the skin low-contrast and soft — avoid deep shadows or harsh dark areas on the face. Neon may create subtle colourful rim lighting on the outer edges of the figure but must NOT paint the face or skin cyan, magenta or purple. Render the person\'s skin SMOOTH and naturally textured — do not apply clarity, HDR texture enhancement or over-sharpening to the skin or face.',
  vintage_poster: 'a bold 1970s vintage race-poster grade — apply a STRONG warm retro palette to the entire scene: rich orange-amber tones, punchy graphic contrast, halftone/silkscreen texture across the sky, ground, trees and environment. Make the background and environment look intensely vintage and retro. HOWEVER: keep the people\'s faces and skin tones natural and warm — do not let the orange or sepia tint wash over their actual skin. Their skin should look like real warm human skin against the vintage environment, not orange-tinted. Apply a subtle film grain and halftone texture over the people too so they blend seamlessly into the vintage scene.',
  comic: 'a dynamic comic-book grade — bold ink outlines, high contrast, halftone Ben-Day shading, explosive saturated colour and speed-line energy. Apply the full comic treatment strongly to the environment, background and the people\'s clothing. On the people themselves, apply the comic treatment at about 80% strength compared to the environment — slightly softer ink outlines, slightly reduced halftone on their skin and faces, and gentler contrast on them specifically, so they feel integrated but slightly more photographic than the background. Keep the skin notably lower contrast than the environment — reduce skin contrast by about 20% so the faces look soft and natural. Avoid harsh shadows, heavy clarity or HDR sharpening on the faces. The yellow accent colour is ONLY for the ground AR elements (route, stats, RIVAL branding) — do NOT apply any yellow tint to the people\'s skin or faces. Skin must look like natural realistic human skin tones with no yellow cast whatsoever.',
  watercolour: 'a soft watercolour fine-art grade — loose painterly washes, gentle colour bleeds and paper texture in the sky and background. Keep it luminous and richly coloured with real clarity — never grey, dull or washed-out. The watercolour washes apply to the environment and background — do NOT bleed painterly colour over the people\'s faces or skin. Keep the people\'s skin tones natural, warm and clearly rendered, not colour-tinted or painted over.',
  olympic: 'a dramatic cinematic grade with a deep-blue late-afternoon sky and sweeping warm golden god-rays and light beams breaking through billowing clouds, bathing the whole scene in radiant gold and amber light with bold punchy contrast and crisp clarity. Keep it bright, rich and premium — never muddy or flat. The golden light and blue sky apply to the environment — do NOT tint the people\'s faces or skin gold or blue. Keep the people\'s skin tones natural, warm and realistically lit. Keep skin smooth and naturally textured.',
  fantasy: 'an epic fantasy-film grade — dramatic magical sky, sweeping clouds, enchanted golden-violet light and Lord of the Rings colour. Keep it rich, vivid and high-contrast — never dull or hazy. The magical violet and golden light applies to the environment and sky — do NOT apply it to the people\'s faces or skin. Keep the people\'s skin tones natural, warm and human-looking, not fantasy-tinted or colour-graded. Keep skin smooth and naturally textured.',
  anime: 'a vibrant sports-anime key-visual grade — saturated skies, dramatic rim light, cel-style colour and kinetic energy. Keep it bold, bright, crisp and high-contrast — never muddy. The anime cel-style treatment applies to the environment — do NOT apply flat anime colours or cel-shading to the people\'s actual faces or skin. Keep the people\'s skin tones natural and realistic, with only subtle rim lighting on the edges. Keep facial skin smooth and naturally textured.',
  cherry_blossom: 'a cherry-blossom grade — a dreamy soft pink spring sky with drifting pink blossom petals filling the air; the ground must be dusted with soft drifting petals with gentle spring light washing across the terrain, luminous and delicate yet vivid. Clean and crisp, never washed-out. Apply the grade at FULL strength to the environment, sky, ground, water and clothing — but only a LIGHT touch to the people themselves. The people\'s faces and skin must keep natural, realistic human skin tones — absolutely no pink cast on skin. Petal-light may create subtle rim lighting on the outer edges of the figure but must NOT paint or tint the skin itself. Keep skin soft, low-contrast, smooth and naturally textured — no harsh shadows, no clarity or HDR sharpening on faces or skin.',
}

// Route + stats accent colour per style, so the glowing AR elements match the grade.
const STYLE_ACCENT: Record<string, string> = {
  cinematic: 'warm amber-orange',
  cyberpunk: 'electric cyan and magenta neon',
  vintage_poster: 'bold retro orange',
  comic: 'bright electric yellow',
  watercolour: 'luminous teal-blue ink',
  olympic: 'radiant gold',
  fantasy: 'magical violet and gold',
  anime: 'electric blue',
  cherry_blossom: 'soft blossom pink',
}

// "Surprise me" rotates through dramatic grades, each with a matching accent.
// Each keeps the people naturally lit with real skin tones (the strong colour
// grades tint the environment, never the faces — same lesson as the named styles).
const SURPRISE_VARIANTS: { mood: string; accent: string }[] = [
  { mood: 'a dramatic thunderstorm grade — dark storm clouds and lightning dominating the sky, moody high-contrast cinematic light; vivid and punchy, never muddy. The ground and terrain must be dramatically storm-lit with deep wet reflections and strong light contrast. Keep the people boldly lit and alive with natural skin tones.', accent: 'electric white-blue' },
  { mood: 'a cosmic night grade — deep starry sky with glowing purple-blue nebula above; the ground below must glow with reflected cosmic light, luminous and surreal as if lit by the nebula. Rich, saturated and crisp. Keep the people vividly lit and alive with natural skin tones.', accent: 'glowing purple and cyan' },
  { mood: 'a volcanic dusk grade — scorched warm tones and glowing embers in a dramatic heat-lit sky; the ground must glow with radiant heat, warm embers and molten light as if the terrain itself is superheated. Intense, saturated and high-contrast, never dull. Keep the people warm, luminous and alive with natural skin tones.', accent: 'molten orange-red' },
  { mood: 'a bioluminescent night grade — the sky is deep dark night; the ground and terrain must glow brilliantly with bioluminescent cyan and magenta light as if lit from within, magical and vivid. Rich, saturated and crisp, never murky. Keep the people clearly lit and alive with natural skin tones.', accent: 'glowing cyan-green' },
  { mood: 'an aurora borealis grade — a dark northern night sky filled with sweeping green and teal ribbons of northern lights above; the ground below must reflect and glow with aurora light, luminous and surreal. Rich, saturated and crisp, never murky. Keep the people clearly lit and alive with natural skin tones, not green-tinted.', accent: 'glowing aurora green' },
  { mood: 'an arctic ice grade — crisp frozen daylight with icy blue tones, frost and snow; the ground must be rendered as frozen, icy and crystalline with cold clean reflections. Razor-sharp clarity and cold clean contrast; bright and vivid, never flat or grey. Keep the people warmly and naturally lit with real skin tones, not blue-tinted.', accent: 'icy cyan-white' },
  { mood: 'a tropical sunset grade — a vivid vaporwave sky of hot pink, magenta, purple and orange gradients above; the ground must glow and reflect with warm tropical sunset colours, dreamy and radiant. Deeply saturated and crisp, never muddy. Keep the people naturally lit and alive with real skin tones, not pink-tinted.', accent: 'hot pink and orange' },
  { mood: 'a solar eclipse grade — an eerie darkened sky with a brilliant glowing corona ring above; the ground must be dramatically underlit by the eclipse corona, high-contrast and otherworldly. Crisp and vivid, never flat. Keep the people boldly rim-lit and alive with natural skin tones.', accent: 'radiant white-gold' },
  { mood: 'a misty rainforest grade — lush deep-green jungle canopy with soft god-rays breaking through mist above; the ground must be rich with mossy texture, soft dappled light and luminous mist rolling across the terrain. Saturated and crisp, never dull or grey. Keep the people clearly lit and alive with natural skin tones, not green-tinted.', accent: 'emerald green' },
  { mood: 'a cherry-blossom grade — a dreamy soft sky with drifting pink blossom petals above; the ground must be covered in soft drifting petals with gentle spring light washing across the terrain, luminous and delicate yet vivid. Clean and crisp, never washed-out. Keep the people naturally lit and alive with real skin tones, not pink-tinted.', accent: 'soft blossom pink' },
]

// Decode a Google-encoded polyline into [lat, lng] points.
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, b: number
      do {
        b = encoded.charCodeAt(index++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const delta = (result & 1) ? ~(result >> 1) : (result >> 1)
      if (which === 0) lat += delta
      else lng += delta
    }
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

// Whether the route closes into a loop or is an open A-to-B path. Stated in
// words in the prompt as a verification check — the most common way the AI
// mangles the shape is drawing an open squiggle where the real route is a
// circuit (or vice versa), and a topology statement is harder to ignore than
// "trace it faithfully".
function routeTopology(encoded: string | null | undefined): 'loop' | 'path' | null {
  if (!encoded) return null
  try {
    const pts = decodePolyline(encoded)
    if (pts.length < 4) return null
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    for (const [la, ln] of pts) {
      if (la < minLat) minLat = la
      if (la > maxLat) maxLat = la
      if (ln < minLng) minLng = ln
      if (ln > maxLng) maxLng = ln
    }
    const diag = Math.hypot(maxLat - minLat, maxLng - minLng)
    if (diag === 0) return null
    const endGap = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1])
    return endGap / diag < 0.15 ? 'loop' : 'path'
  } catch {
    return null
  }
}

function buildPrompt(style: string, statsLine: string | null, hasRoute: boolean, activityNoun: string, surpriseIndex: number | null, topology: 'loop' | 'path' | null, perspectiveRef: boolean): string {
  let mood: string
  let accent: string
  if (style === 'surprise') {
    // Variant is chosen by the caller (handler) so it can avoid repeating the last one.
    // Every variant gets the full skin guard appended: their inline one-line "natural
    // skin tones" nudge is too weak against the strongest grades (tropical sunset
    // turned the whole person pink). Same pattern that fixed the named styles:
    // environment full strength, skin light touch, no cast, no sharpening.
    const pick = SURPRISE_VARIANTS[surpriseIndex ?? 0] ?? SURPRISE_VARIANTS[0]
    mood = pick.mood + ' Apply the colour grade at FULL strength to the environment, sky, ground, water and clothing — but only a LIGHT touch to the people themselves. The people\'s faces and skin must keep natural, realistic human skin tones — absolutely no pink, green, blue, orange or purple colour cast on skin. Scene colours may create subtle rim lighting on the outer edges of the figure but must NOT paint or tint the skin itself. Keep skin soft, low-contrast, smooth and naturally textured — no harsh shadows, no clarity or HDR sharpening on faces or skin.'
    accent = pick.accent
  } else {
    mood = STYLE_MOOD[style] ?? STYLE_MOOD.cinematic
    accent = STYLE_ACCENT[style] ?? STYLE_ACCENT.cinematic
  }

  const routeBlock = hasRoute
    ? perspectiveRef
      ? `Render the traced route line from image 2 glowing ${accent} like illuminated neon physically burned into the surface, with realistic light spill and reflections on the surrounding terrain, like a massive AR hologram embedded into the ground. Add sweeping glowing topographic contour lines spreading outward from the route across the entire surface to reinforce the AR-map feel and the sense of scale.`
      : `The SECOND image is the EXACT GPS route map for this ${activityNoun}. Project this full route shape onto the ground as a LARGE, SWEEPING ground-plane projection in strong perspective — it must START at the very bottom edge of the frame in the near foreground and RECEDE in perspective toward the horizon beneath and around the people, filling the majority of the visible ground surface. Do NOT render it as a small compact icon, a floating map shape, or a loop clustered at the person's feet — it must span the FULL depth of the ground from foreground to far distance, like a massive AR hologram embedded into the ground surface and seen from a low camera angle. Render it glowing ${accent} like illuminated neon physically burned into the ground surface. Add sweeping glowing topographic contour lines spreading outward from the route across the entire ground to reinforce the AR-map feel and the sense of scale. Preserve the GPS route shape faithfully.`
    : ''

  const statsBlock = statsLine
    ? `Integrate ONLY these exact stats into the ground in the foreground, glowing ${accent}, burned into the surface with premium sports-ad styling — clean, bold and legible: ${statsLine}. CRITICAL: these are the ONLY stats that exist for this activity. Do NOT add, invent or hallucinate any other metrics, numbers, labels or data — no heart rate, no elevation, no distance, no pace, no speed, no calories, no cadence, nothing beyond what is listed above. If only one stat is listed, show only one stat. Burn in exactly what is provided and nothing else. Also integrate the bold brand word "RIVAL" into the ground as the hero branding, in the same ${accent} glow.`
    : `Integrate the bold brand word "RIVAL" into the ground as the hero branding, glowing ${accent}.`

  const topologyNote =
    topology === 'loop'
      ? 'Verification check: this route is a CLOSED LOOP — the real track returns to its starting point, so your traced line must visibly close back on itself. If the line you drew does not close into a loop, it is WRONG. '
      : topology === 'path'
      ? 'Verification check: this route is an OPEN point-to-point path — it does NOT return to its start, so do NOT close it into a loop. '
      : ''

  const routeConstraint = hasRoute
    ? perspectiveRef
      ? `CRITICAL CONSTRAINT — READ FIRST: The SECOND image is a TRACING TEMPLATE in the same portrait framing as the final image: it shows the athlete's EXACT GPS route already projected in perspective onto the ground plane, exactly where and how the glowing line must appear in the final image. Reproduce that line EXACTLY — same position in the frame, same scale, same shape, every bend and turn copied precisely, including the width taper from thick in the foreground to thin near the horizon. Never invent, simplify, straighten, reroute or reposition the line, even when the scene's atmosphere and colour change dramatically. ${topologyNote}The line lies FLAT on the scene's main receding surface (road, trail, grass, sand or WATER — whatever stretches into the distance), passing beneath and around the people. `
      : ''
    : ''

  return `${routeConstraint}Use the FIRST image as the base photo. Keep the people's exact likeness, faces, expressions and pose, and keep the same location, signage, banners, bibs and background unchanged and legible. Re-light and grade the whole scene with ${mood} Enhance the ground/terrain the people are standing on so the glowing route and stats sit naturally embedded in it. ${routeBlock} ${statsBlock} Use realistic depth, shadows and perspective so the route, stats and branding all look physically embedded in the ground like an augmented-reality projection, not flat overlays. Do not add any other text, captions, numbers or logos beyond the stats and the word RIVAL.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { activityId, style, photoBase64, photoUrl: providedPhotoUrl, routeImageBase64, routePerspective, exerciseIndex, surpriseExclude } = await req.json()
    if (!photoBase64 && !providedPhotoUrl) return new Response(JSON.stringify({ error: 'photo required' }), { status: 400, headers: corsHeaders })

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // ── Daily quota check (2 per rolling 24h, free tier — a shot + a mulligan) ──
    // BYPASS_USER_IDS is a comma-separated list of user IDs exempt from the quota
    // (admins, devs, testers). Set it in Supabase edge function secrets.
    const bypassIds = (Deno.env.get('BYPASS_USER_IDS') ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const quotaBypassed = bypassIds.includes(user.id)

    const DAILY_LIMIT = 2
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('ai_generations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', dayAgo)
    const used = count ?? 0
    if (!quotaBypassed && used >= DAILY_LIMIT) {
      // Tell the client when the oldest generation in the window ages out
      const { data: oldest } = await supabase
        .from('ai_generations')
        .select('created_at')
        .eq('user_id', user.id)
        .gte('created_at', dayAgo)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()
      const resetAt = oldest
        ? new Date(new Date(oldest.created_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
        : null
      return new Response(
        JSON.stringify({ error: 'Daily limit reached', remaining: 0, resetAt }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const [{ data: activity }, { data: routeRow }] = await Promise.all([
      supabase.from('activities')
        .select('activity_type, distance_meters, duration_seconds, elevation_meters, exercises')
        .eq('id', activityId)
        .single(),
      // Routes are private: only the owner's own route is ever used.
      supabase.from('activity_routes').select('polyline').eq('activity_id', activityId).eq('user_id', user.id).maybeSingle(),
    ])

    // Lift breakdown lives on the activity as a JSON column: { name, sets?, reps?, weight? }[]
    const exercises: any[] = Array.isArray(activity?.exercises) ? activity.exercises : []

    // ── Activity-aware stats ──────────────────────────────────────────────
    // The headline metric differs by sport: runners/hikers use pace (min/km),
    // cyclists use speed (km/h), swimmers use pace (min/100m), and strength/
    // studio workouts have no distance so they show time only.
    const type = (activity?.activity_type ?? '').toString()
    const t = type.toLowerCase()
    const category: 'foot' | 'cycle' | 'swim' | 'water' | 'strength' =
      t.includes('swim') ? 'swim'
      : (t.includes('ride') || t.includes('cycl') || t.includes('bike') || t.includes('handcycle')) ? 'cycle'
      : (t.includes('row') || t.includes('kayak') || t.includes('canoe') || t.includes('paddl') || t.includes('surf')) ? 'water'
      : (t.includes('weight') || t.includes('strength') || t.includes('workout') || t.includes('yoga') || t.includes('crossfit') || t.includes('pilates') || t.includes('elliptical') || t.includes('stair') || t.includes('hiit')) ? 'strength'
      : 'foot'

    // Readable noun for the prompt, e.g. "MountainBikeRide" -> "mountain bike ride"
    const activityNoun = type.replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase() || 'workout'

    const distanceM = activity?.distance_meters ?? null
    const distanceKm = distanceM ? (distanceM / 1000).toFixed(2) : null
    const durationSec = activity?.duration_seconds ?? null
    const durationMin = durationSec ? Math.round(durationSec / 60) : null
    const elevationM = activity?.elevation_meters ? Math.round(activity.elevation_meters) : null
    // Clock format ("39:24", "1:23:45") — a bare "39m" under a Time label reads as metres
    const durationFormatted = durationSec != null
      ? (durationSec >= 3600
          ? `${Math.floor(durationSec / 3600)}:${String(Math.floor((durationSec % 3600) / 60)).padStart(2, '0')}:${String(Math.round(durationSec % 60)).padStart(2, '0')}`
          : `${Math.floor(durationSec / 60)}:${String(Math.round(durationSec % 60)).padStart(2, '0')}`)
      : null

    const mmss = (totalMin: number, unit: string) =>
      `${Math.floor(totalMin)}:${String(Math.round((totalMin % 1) * 60)).padStart(2, '0')}${unit}`
    const paceMinKm = distanceKm && durationMin ? mmss(durationMin / parseFloat(distanceKm), '/km') : null
    const speedKmh = distanceM && durationSec ? `${(distanceM / 1000 / (durationSec / 3600)).toFixed(1)} km/h` : null
    const pace100m = distanceM && durationSec ? mmss((durationSec / (distanceM / 100)) / 60, '/100m') : null

    // Real stats injected into the prompt so the AI burns in the CORRECT numbers.
    // For strength activities, feature the lift the user picked (exerciseIndex into
    // the activity's exercises array); fall back to the heaviest lift by weight.
    const topLift = (typeof exerciseIndex === 'number' ? exercises[exerciseIndex] : null)
      ?? [...exercises].sort((a, b) => Number(b?.weight ?? 0) - Number(a?.weight ?? 0))[0]
      ?? null
    const strengthStats: (string | null)[] = topLift
      ? [
          topLift.name ?? null,
          topLift.weight ? `${topLift.weight} kg` : null,
          topLift.reps ? `${topLift.reps} ${topLift.reps === 1 ? 'rep' : 'reps'}` : null,
          durationFormatted ? `Time ${durationFormatted}` : null,
        ]
      : [durationFormatted ? `Time ${durationFormatted}` : null]

    const parts: (string | null | undefined)[] =
      category === 'strength' ? strengthStats
      : category === 'swim' ? [distanceM && `Distance ${distanceM} m`, pace100m && `Pace ${pace100m}`, durationFormatted && `Time ${durationFormatted}`]
      : category === 'water' ? [distanceKm && `Distance ${distanceKm} km`, speedKmh && `Speed ${speedKmh}`, durationFormatted && `Time ${durationFormatted}`]
      : category === 'cycle' ? [distanceKm && `Distance ${distanceKm} km`, speedKmh && `Speed ${speedKmh}`, durationFormatted && `Time ${durationFormatted}`, elevationM && `Elevation ${elevationM} m`]
      : [distanceKm && `Distance ${distanceKm} km`, paceMinKm && `Pace ${paceMinKm}`, durationFormatted && `Time ${durationFormatted}`, elevationM && `Elevation ${elevationM} m`]
    const filteredParts = parts.filter(Boolean)
    const statsLine = filteredParts.length > 0
      ? `${activityNoun.toUpperCase()}   ${filteredParts.join('   ')}`
      : null

    // The base photo can arrive two ways: an existing activity photo (photoUrl, already
    // in storage — use it directly, no re-upload) or a freshly uploaded one (photoBase64).
    const ts = Date.now()
    let photoFileName: string | null = null
    let photoBytes: Uint8Array | null = null
    let photoMime = 'image/jpeg'
    if (!providedPhotoUrl) {
      const mimeMatch = photoBase64.match(/^data:([^;]+);base64,/)
      photoMime = mimeMatch?.[1] ?? 'image/jpeg'
      const ext = photoMime.includes('png') ? 'png' : photoMime.includes('webp') ? 'webp' : 'jpg'
      const base64Data = photoBase64.includes(',') ? photoBase64.split(',')[1] : photoBase64
      photoBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
      photoFileName = `${user.id}/share-input-${ts}.${ext}`
    }

    const routeFileName = routeImageBase64 ? `${user.id}/share-route-${ts}.png` : null
    const routeBytes = routeImageBase64
      ? Uint8Array.from(atob(routeImageBase64.includes(',') ? routeImageBase64.split(',')[1] : routeImageBase64), c => c.charCodeAt(0))
      : null

    await Promise.all([
      photoFileName && photoBytes
        ? supabase.storage.from('activity-photos').upload(photoFileName, photoBytes, { contentType: photoMime, upsert: true })
        : Promise.resolve(),
      routeFileName && routeBytes
        ? supabase.storage.from('activity-photos').upload(routeFileName, routeBytes, { contentType: 'image/png', upsert: true })
        : Promise.resolve(),
    ])

    // Everything this function writes to storage is transit, not content: the
    // base photo and route map exist only so OpenAI can fetch them by URL, and
    // the raw output only lives long enough for the client to upscale it. None
    // of it is ever referenced again, so sweep this user's leftovers from past
    // runs before adding more. Best-effort — a failed sweep must not block the
    // generation the user is waiting on.
    const sweepTemps = async () => {
      try {
        const { data: old } = await supabase.storage.from('activity-photos').list(user.id, { limit: 1000 })
        const cutoff = Date.now() - 24 * 60 * 60 * 1000
        const stale = (old ?? [])
          .filter((f) => /share-input-|share-route-|-raw-/.test(f.name))
          .filter((f) => new Date(f.created_at ?? 0).getTime() < cutoff)
          .map((f) => `${user.id}/${f.name}`)
        if (stale.length) await supabase.storage.from('activity-photos').remove(stale)
      } catch { /* sweeping is housekeeping, never fatal */ }
    }
    sweepTemps()

    const photoUrl = providedPhotoUrl
      ?? supabase.storage.from('activity-photos').getPublicUrl(photoFileName!).data.publicUrl
    const routeImageUrl = routeFileName
      ? supabase.storage.from('activity-photos').getPublicUrl(routeFileName).data.publicUrl
      : null

    // For "surprise", roll a variant that differs from the caller's last one so every
    // regenerate changes the look. The function is stateless — the client passes the
    // variant it got last time as surpriseExclude. We return the picked index so the
    // client can exclude it on the next roll.
    let surpriseIndex: number | null = null
    if ((style ?? 'cinematic') === 'surprise') {
      const exclude = typeof surpriseExclude === 'number' ? surpriseExclude : -1
      const candidates = SURPRISE_VARIANTS.map((_, i) => i).filter((i) => i !== exclude)
      surpriseIndex = candidates[Math.floor(Math.random() * candidates.length)]
    }

    const prompt = buildPrompt(style ?? 'cinematic', statsLine, !!routeImageUrl, activityNoun, surpriseIndex, routeTopology(routeRow?.polyline), routePerspective === true)

    // Two-image input: base photo first, route map second.
    const content: any[] = [{ type: 'input_image', image_url: photoUrl }]
    if (routeImageUrl) content.push({ type: 'input_image', image_url: routeImageUrl })
    content.push({ type: 'input_text', text: prompt })

    const openaiPayload = JSON.stringify({
      model: 'gpt-4o',
      input: [{ role: 'user', content }],
      tools: [{ type: 'image_generation', quality: 'medium', size: '1024x1536', moderation: 'low' }],
    })
    const openaiHeaders = { 'Authorization': `Bearer ${Deno.env.get('OPENAI_KEY')}`, 'Content-Type': 'application/json' }

    let generatedB64: string | null = null
    let lastError: string | null = null
    let refused = false

    for (let attempt = 0; attempt < 2; attempt++) {
      const openaiRes = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: openaiHeaders, body: openaiPayload })
      if (!openaiRes.ok) { lastError = await openaiRes.text(); continue }
      const openaiData = await openaiRes.json()
      const imageCall = openaiData?.output?.find((o: any) => o.type === 'image_generation_call')
      if (imageCall?.result) { generatedB64 = imageCall.result; break }
      // gpt-4o declining to call the image tool at all (upstream moderation, not our
      // code) shows up as a plain "message" output instead of an image_generation_call.
      // Surface this distinctly so the client can show a clean message instead of the
      // raw OpenAI payload — this is far more common on photos with multiple real
      // people, or heavily body/skin-transforming styles, but is probabilistic either way.
      const refusalMsg = openaiData?.output?.find((o: any) => o.type === 'message')
      if (refusalMsg) refused = true
      lastError = JSON.stringify(openaiData?.output ?? 'no output')
    }

    // OpenAI has fetched them by now, so the base photo and route map have served
    // their whole purpose. Drop them here rather than leaving them for the sweep,
    // on the failure path too — a refused generation still uploaded its inputs.
    // (When the caller passed an existing activity photo by URL, photoFileName is
    // null and that photo is left alone — it is real content, not transit.)
    const transit = [photoFileName, routeFileName].filter(Boolean) as string[]
    if (transit.length) {
      try { await supabase.storage.from('activity-photos').remove(transit) } catch { /* housekeeping */ }
    }

    if (!generatedB64) {
      return new Response(
        JSON.stringify({
          error: refused
            ? "This image couldn't be generated due to AI privacy policies — try a different style or photo."
            : 'Generation failed — please try again.',
          refused,
          debug: lastError,
        }),
        { status: 500, headers: corsHeaders }
      )
    }
    const rawBytes = Uint8Array.from(atob(generatedB64), c => c.charCodeAt(0))

    const rawFileName = `${user.id}/${activityId}-raw-${Date.now()}.jpg`
    await Promise.all([
      supabase.storage.from('activity-photos').upload(rawFileName, rawBytes, { contentType: 'image/jpeg', upsert: true }),
      quotaBypassed ? Promise.resolve() : supabase.from('ai_generations').insert({ user_id: user.id, style: style ?? 'cinematic' }),
    ])
    const { data: rawUrlData } = supabase.storage.from('activity-photos').getPublicUrl(rawFileName)

    return new Response(JSON.stringify({
      rawUrl: rawUrlData.publicUrl,
      stats: { distanceKm, durationMin, elevationM, statsLine },
      surpriseIndex,
      remaining: DAILY_LIMIT - used - 1,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
