import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushMessages } from '../_shared/push.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const RACE_DAY_MESSAGES = [
  'Trust your training and enjoy every minute of your Effort.',
];

const POST_RACE_MESSAGES = [
  "You did it. Race day is done, go and celebrate because you've earned every bit of it.",
];

async function getTokenMap(userIds: string[]): Promise<Record<string, string>> {
  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('user_id, token')
    .in('user_id', userIds);
  const map: Record<string, string> = {};
  for (const t of (tokens || [])) map[t.user_id] = t.token;
  return map;
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'post-race';

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // ── Race day notification ──────────────────────────────────────
  if (type === 'race-day') {
    const { data: races } = await supabase
      .from('races')
      .select('id, name, user_id')
      .eq('race_date', today);

    if (!races || races.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No races today' }), { status: 200 });
    }

    const userIds = [...new Set(races.map((r: any) => r.user_id))];
    const tokenMap = await getTokenMap(userIds as string[]);

    const messages = races
      .filter((r: any) => tokenMap[r.user_id])
      .map((r: any, i: number) => ({
        to: tokenMap[r.user_id],
        title: `It's Race day!`,
        body: RACE_DAY_MESSAGES[i % RACE_DAY_MESSAGES.length],
        data: { screen: 'races', tab: 'mine' },
        sound: 'default',
      }));

    const result = await sendPushMessages(messages);
    return new Response(JSON.stringify(result), { status: 200 });
  }

  // ── Post-race: prompt to log finish time ───────────────────────
  const { data: races, error } = await supabase
    .from('races')
    .select('id, name, user_id, actual_finish_time')
    .eq('race_date', yesterdayStr);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!races || races.length === 0) {
    return new Response(JSON.stringify({ sent: 0, message: 'No races yesterday' }), { status: 200 });
  }

  const userIds = [...new Set(races.map((r: any) => r.user_id))];
  const tokenMap = await getTokenMap(userIds as string[]);

  const messages = races
    .filter((r: any) => !r.actual_finish_time && tokenMap[r.user_id])
    .map((r: any, i: number) => ({
      to: tokenMap[r.user_id],
      title: `${r.name} is done. Share the experience`,
      body: POST_RACE_MESSAGES[i % POST_RACE_MESSAGES.length],
      data: { screen: 'races', tab: 'completed' },
      sound: 'default',
    }));

  const result = await sendPushMessages(messages);
  return new Response(JSON.stringify(result), { status: 200 });
});
