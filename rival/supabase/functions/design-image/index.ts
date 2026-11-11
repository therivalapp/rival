// Design images for Rival's own pages (Ricky, 2026-11-11): backgrounds and
// photos for mockups, generated with fal.ai from Claude's laptop sessions.
// Not used by the app. The fal key stays on the server; callers need the
// DESIGN_IMAGE_SECRET (x-design-secret header), set with `supabase secrets set`
// and kept out of the repo. Deployed with --no-verify-jwt.
//
// POST { prompt, aspect_ratio?: '9:16' | '16:9' | '1:1' | '3:4' | '4:3', model?: 'ultra' | 'dev' }
// → { url } (fal's hosted image; download it, it does not last forever)

const MODELS: Record<string, string> = {
  ultra: 'fal-ai/flux-pro/v1.1-ultra', // photoreal, about US$0.06 an image
  dev: 'fal-ai/flux/dev',              // cheaper drafts
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('DESIGN_IMAGE_SECRET')
  if (!secret || req.headers.get('x-design-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Not allowed' }), { status: 401 })
  }
  let body: any
  try { body = await req.json() } catch { return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400 }) }
  const prompt = typeof body?.prompt === 'string' ? body.prompt.slice(0, 2000) : ''
  if (!prompt) return new Response(JSON.stringify({ error: 'prompt is required' }), { status: 400 })
  const model = MODELS[body?.model] ?? MODELS.ultra
  const aspect = ['9:16', '16:9', '1:1', '3:4', '4:3'].includes(body?.aspect_ratio) ? body.aspect_ratio : '9:16'

  const input = model === MODELS.ultra
    ? { prompt, aspect_ratio: aspect, num_images: 1, output_format: 'jpeg', safety_tolerance: '2', raw: true }
    : { prompt, image_size: aspect === '9:16' ? 'portrait_16_9' : aspect === '16:9' ? 'landscape_16_9' : 'square_hd', num_images: 1 }

  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${Deno.env.get('FAL_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const out = await res.json().catch(() => null)
  const url = out?.images?.[0]?.url
  if (!res.ok || !url) return new Response(JSON.stringify({ error: out?.detail ?? `fal ${res.status}` }), { status: 502 })
  return new Response(JSON.stringify({ url }), { headers: { 'Content-Type': 'application/json' } })
})
