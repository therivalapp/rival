import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendPushMessages } from '../_shared/push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const HOUR_MILESTONES = [
  { type: 'hours_100', hours: 100, title: '100 Hours Earned', body: '100 hours of training logged.' },
  { type: 'hours_500', hours: 500, title: '500 Hours Earned', body: '500 hours of training logged.' },
  { type: 'hours_1000', hours: 1000, title: '1,000 Hours Earned', body: '1,000 hours of training logged.' },
  { type: 'hours_5000', hours: 5000, title: '5,000 Hours Earned', body: '5,000 hours of training logged. Unrivaled consistency.' },
]

serve(async (req) => {
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

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // Total lifetime minutes
    const { data: activities } = await supabase
      .from('activities')
      .select('duration_seconds')
      .eq('user_id', user.id)

    const totalMinutes = (activities || []).reduce((s: number, a: any) => s + (a.duration_seconds || 0), 0) / 60
    const totalHours = totalMinutes / 60

    // Which milestones already achieved
    const { data: existing } = await supabase
      .from('milestones')
      .select('type')
      .eq('user_id', user.id)
    const achieved = new Set((existing || []).map((m: any) => m.type))

    const newMilestones = HOUR_MILESTONES.filter(m => totalHours >= m.hours && !achieved.has(m.type))
    if (newMilestones.length === 0) {
      return new Response(JSON.stringify({ newMilestones: 0 }), { status: 200, headers: corsHeaders })
    }

    // Insert new milestones
    await supabase.from('milestones').insert(
      newMilestones.map(m => ({ user_id: user.id, type: m.type }))
    )

    // Push notification for each new milestone
    const { data: tokenRow } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', user.id)
      .maybeSingle()

    if (tokenRow?.token) {
      const messages = newMilestones.map(m => ({
        to: tokenRow.token,
        title: m.title,
        body: m.body,
        data: { screen: 'profile' },
        sound: 'default',
      }))
      await sendPushMessages(messages)
    }

    return new Response(JSON.stringify({ newMilestones: newMilestones.length, unlocked: newMilestones.map(m => m.type) }), {
      status: 200, headers: corsHeaders,
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
