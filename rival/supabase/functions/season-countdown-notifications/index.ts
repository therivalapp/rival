import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushMessages } from '../_shared/push.ts';
import { formatTeamName } from '../_shared/formatName.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Days-before-reset milestones to notify on
const MILESTONES = [30, 14, 7, 3, 1];

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const seasonEnd = new Date(Date.UTC(currentYear + 1, 0, 1));
  const daysLeft = Math.ceil((seasonEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (!MILESTONES.includes(daysLeft)) {
    return new Response(JSON.stringify({ message: `No milestone today (${daysLeft} days left)`, daysLeft }), { status: 200 });
  }

  // Get every user with a push token
  const { data: tokens } = await supabase.from('push_tokens').select('user_id, token');
  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ sent: 0, message: 'No push tokens registered' }), { status: 200 });
  }

  // Figure out which of those users are in a league (for a more specific message)
  const userIds = tokens.map((t: any) => t.user_id);
  const { data: leagueMemberships } = await supabase
    .from('league_members')
    .select('user_id, leagues(name)')
    .in('user_id', userIds)
    .eq('status', 'active');

  const leagueNameByUser: Record<string, string> = {};
  (leagueMemberships || []).forEach((m: any) => {
    if (m.leagues?.name && !leagueNameByUser[m.user_id]) {
      leagueNameByUser[m.user_id] = formatTeamName(m.leagues.name);
    }
  });

  const messages = tokens.map((t: any) => {
    const leagueName = leagueNameByUser[t.user_id];
    // "Year", not "season", and no pressure: the reset is information, and
    // lifetime totals are untouched by it.
    const body = leagueName
      ? `Ranks reset on 1 January. Every activity until then still counts with ${leagueName}.`
      : 'Ranks reset on 1 January. Lifetime totals never reset.';

    return {
      to: t.token,
      title: daysLeft === 1 ? `The last day of ${currentYear}` : `${daysLeft} days left in ${currentYear}`,
      body,
      data: { screen: 'ranks' },
      sound: 'default',
    };
  });

  const result = await sendPushMessages(messages);
  return new Response(JSON.stringify({ daysLeft, ...result }), { status: 200 });
});
