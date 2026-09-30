import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { formatDisplayName, formatTeamName } from '../_shared/formatName.ts'
import { sendPushMessages } from '../_shared/push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader ?? '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    const body = await req.json();
    const { type, challengeId } = body;

    // ── 1v1 challenge sent ─────────────────────────────────────────────────────
    if (type === '1v1_sent') {
      const { data: c } = await supabase.from('league_challenges').select('*, users!challenger_id(display_name, email)').eq('id', challengeId).single();
      if (!c) return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: corsHeaders });

      const senderName = formatDisplayName(c.users as any, 'Someone');
      const { data: tokens } = await supabase.from('push_tokens').select('token').eq('user_id', c.opponent_id);

      const messages = (tokens || []).map((t: any) => ({
        to: t.token,
        title: `YOU'VE BEEN CHALLENGED`,
        body: `${senderName} sent a challenge. Accept or decline in RIVAL.`,
        data: { screen: 'league', tab: 'challenges' },
        sound: 'default',
      }));
      await sendPushMessages(messages);
      return new Response(JSON.stringify({ sent: messages.length }), { status: 200, headers: corsHeaders });
    }

    // ── 1v1 challenge response ─────────────────────────────────────────────────
    if (type === '1v1_response') {
      const { accept } = body;
      const { data: c } = await supabase.from('league_challenges').select('*, users!opponent_id(display_name, email)').eq('id', challengeId).single();
      if (!c) return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: corsHeaders });

      const responderName = formatDisplayName(c.users as any, 'Your opponent');
      const { data: tokens } = await supabase.from('push_tokens').select('token').eq('user_id', c.challenger_id);

      const messages = (tokens || []).map((t: any) => ({
        to: t.token,
        title: accept ? `🔥 BRING IT ON!` : `😤 Challenge declined`,
        body: accept ? `${responderName} accepted. The race is on — don't let up.` : `${responderName} declined. More rivals coming.`,
        data: { screen: 'league', tab: 'challenges' },
        sound: 'default',
      }));
      await sendPushMessages(messages);
      return new Response(JSON.stringify({ sent: messages.length }), { status: 200, headers: corsHeaders });
    }

    // ── League vs league challenge sent ────────────────────────────────────────
    if (type === 'lvl_sent') {
      const { data: c } = await supabase.from('league_vs_league_challenges').select('*').eq('id', challengeId).single();
      if (!c) return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: corsHeaders });

      const { data: challengerLeague } = await supabase.from('leagues').select('name').eq('id', c.challenger_league_id).single();
      const challengerName = formatTeamName((challengerLeague as any)?.name) || 'Another team';

      // Notify ALL members of the opponent league
      const { data: opponentMembers } = await supabase.from('league_members').select('user_id').eq('league_id', c.opponent_league_id).eq('status', 'active');
      const opponentIds = (opponentMembers || []).map((m: any) => m.user_id).filter((uid: string) => uid !== user.id);

      if (opponentIds.length === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: corsHeaders });

      const { data: tokens } = await supabase.from('push_tokens').select('user_id, token').in('user_id', opponentIds);

      const messages = (tokens || []).map((t: any) => ({
        to: t.token,
        title: `YOUR TEAM HAS BEEN CHALLENGED`,
        body: `${challengerName} challenged the team. An admin can accept or decline.`,
        data: { screen: 'league', leagueId: c.opponent_league_id, tab: 'challenges' },
        sound: 'default',
      }));
      await sendPushMessages(messages);
      return new Response(JSON.stringify({ sent: messages.length }), { status: 200, headers: corsHeaders });
    }

    // ── League vs league response ──────────────────────────────────────────────
    if (type === 'lvl_response') {
      const { accept } = body;
      const { data: c } = await supabase.from('league_vs_league_challenges').select('*').eq('id', challengeId).single();
      if (!c) return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: corsHeaders });

      const { data: opponentLeague } = await supabase.from('leagues').select('name').eq('id', c.opponent_league_id).single();
      const opponentName = formatTeamName((opponentLeague as any)?.name) || 'The opponent';

      // Notify all challenger league members
      const { data: challengerMembers } = await supabase.from('league_members').select('user_id').eq('league_id', c.challenger_league_id).eq('status', 'active');
      const challengerIds = (challengerMembers || []).map((m: any) => m.user_id).filter((uid: string) => uid !== user.id);

      if (challengerIds.length === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: corsHeaders });

      const { data: tokens } = await supabase.from('push_tokens').select('user_id, token').in('user_id', challengerIds);

      const messages = (tokens || []).map((t: any) => ({
        to: t.token,
        title: accept ? `🔥 BRING IT ON!` : `😤 Challenge declined`,
        body: accept ? `${opponentName} accepted your team's challenge. Time to train.` : `${opponentName} declined. Keep looking for rivals.`,
        data: { screen: 'league', leagueId: c.challenger_league_id, tab: 'challenges' },
        sound: 'default',
      }));
      await sendPushMessages(messages);
      return new Response(JSON.stringify({ sent: messages.length }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: 'Unknown type' }), { status: 400, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
})
