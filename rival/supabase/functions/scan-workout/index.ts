import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )

    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    const body = await req.json()

    // Support both a single image (legacy) and multiple images for one workout
    const images: Array<{ base64Image: string; mediaType: string }> = body.images
      ?? (body.base64Image ? [{ base64Image: body.base64Image, mediaType: body.mediaType }] : [])

    if (images.length === 0) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Each image numbered, so imageRoles below can say which is which.
    const imageBlocks = images.flatMap((img, i) => [
      { type: 'text', text: `Image ${i + 1}:` },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType || 'image/jpeg',
          data: img.base64Image,
        },
      },
    ])

    const multiPhotoNote = images.length > 1
      ? `These ${images.length} photos all belong to the SAME workout (e.g. multiple pages of a workout card, or a whiteboard plus a results sheet). Combine information across all of them into ONE single workout JSON object — merge exercises, don't duplicate, and use whichever photo has the most complete data for each field.\n\n`
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
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              ...imageBlocks,
              {
                type: 'text',
                text: `${multiPhotoNote}Analyze ${images.length > 1 ? 'these workout screenshots/images' : 'this workout screenshot/image'} and extract the following in JSON format:
{
  "workoutType": "Run/Ride/Swim/CrossFit/Workout/etc",
  "duration": 3600,
  "distance": 10.2,
  "elevation": 120,
  "exercises": [
    {
      "name": "Exercise Name",
      "reps": 15, "sets": 3, "weight": 70, "distanceMeters": null,
      "prescribedReps": 15, "prescribedSets": 3, "prescribedWeight": 70, "prescribedDistanceMeters": null
    }
  ],
  "intensity": 75,
  "notes": "Any additional details",
  "imageRoles": ["details"]
}

imageRoles has one entry per image, in order (Image 1 first): "details" when the image shows workout information to read (an app or watch screenshot, a whiteboard, a workout card or sheet, written sets and reps), or "moment" when it is a photo or video still of the session itself (people training, the gym, a view, a selfie) with no workout information to read. Read workout details only from "details" images. If no image has workout information, return the other fields as null and exercises as [].

duration is in seconds, and only when a time is actually shown (a timer, a "Time" or "Duration" line, a moving or elapsed time, a watch or app summary); never estimate it from the exercises, sets, intervals or rest periods, and use null when no time is shown. distance is in km (null if not applicable). elevation is total elevation gain in meters (null if not applicable, e.g. "Elev Gain" on a Garmin/Strava card). intensity is 0-100. For distance-based exercises like Run/Row/Ski/Bike within a workout (e.g. "400m Run"), set distanceMeters to the distance in meters and leave reps/sets/weight null. weight is in kg and represents what the athlete actually did.

Only fill in a "prescribed*" field when the image EXPLICITLY and LITERALLY shows a separate prescribed/Rx standard next to the actual result — e.g. the text "Rx:" or "Prescribed:" or "Target:" followed by a number that differs from what the athlete actually logged. Do NOT infer a prescribed value from a workout's name or title (e.g. a workout named "40km Benchmark" does NOT mean the prescribed distance is 40km — that is just the workout's name, not a stated target). If there is no explicit Rx/Prescribed/Target label visible in the image, leave all "prescribed*" fields null. Be strict with JSON format. If a field is unknown use null.`,
              },
            ],
          },
        ],
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.log('Anthropic API error:', JSON.stringify(data))
      return new Response(JSON.stringify({ error: 'AI analysis failed', details: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    const textContent = data.content?.find((c: any) => c.type === 'text')
    const jsonMatch = textContent?.text?.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: 'Could not parse workout from image' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 422,
      })
    }

    const workout = JSON.parse(jsonMatch[0])

    return new Response(JSON.stringify({ success: true, workout }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (err) {
    console.log('Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
