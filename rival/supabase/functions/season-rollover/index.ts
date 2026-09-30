import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Must match LEVELS in src/lib/xp.ts.
const LEVELS = [
  { level: 1,  name: 'Rookie',    minXp: 0 },
  { level: 2,  name: 'Hustler',   minXp: 2000 },
  { level: 3,  name: 'Warrior',   minXp: 5250 },
  { level: 4,  name: 'Elite',     minXp: 9000 },
  { level: 5,  name: 'Champion',  minXp: 13000 },
  { level: 6,  name: 'Legend',    minXp: 17500 },
  { level: 7,  name: 'Mythic',    minXp: 22750 },
  { level: 8,  name: 'Immortal',  minXp: 28000 },
  { level: 9,  name: 'God',       minXp: 33250 },
  { level: 10, name: 'Unrivaled', minXp: 39000 },
];

function getLevel(xp: number) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].minXp) return LEVELS[i];
  }
  return LEVELS[0];
}

// Offset of a time zone from UTC at a given instant, in milliseconds.
function zoneOffsetMs(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - at;
}

// Midnight on 1 January in the person's own time zone. A season is theirs:
// the app shows it from local midnight to local midnight, so the archived
// total must be cut at the same instants. Anyone with no recorded zone (or an
// unusable one) falls back to UTC, which was the rule for everyone before.
function seasonBoundary(year: number, tz: string | null): string {
  const utcMidnight = Date.UTC(year, 0, 1);
  if (!tz) return new Date(utcMidnight).toISOString();
  try {
    // Two passes: the first guess can sit on the wrong side of a DST change.
    let t = utcMidnight - zoneOffsetMs(utcMidnight, tz);
    t = utcMidnight - zoneOffsetMs(t, tz);
    return new Date(t).toISOString();
  } catch {
    return new Date(utcMidnight).toISOString();
  }
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const previousYear = currentYear - 1;

  // Find the season that just ended (last year) and hasn't been closed yet
  const { data: prevSeason } = await supabase
    .from('seasons')
    .select('id, year')
    .eq('year', previousYear)
    .is('closed_at', null)
    .maybeSingle();

  if (!prevSeason) {
    return new Response(JSON.stringify({ message: 'No season pending rollover' }), { status: 200 });
  }

  // The last places on Earth reach 1 January at 12:00 UTC (UTC-12). Closing
  // the season before then would snapshot people whose season is still
  // running. The job runs daily at 01:00 UTC, so in practice this closes the
  // season on 2 January.
  if (now.getTime() < Date.UTC(currentYear, 0, 1, 14)) {
    return new Response(JSON.stringify({ message: 'Season still running somewhere' }), { status: 200 });
  }

  const seasonStart = new Date(Date.UTC(previousYear, 0, 1)).toISOString();
  const seasonEnd = new Date(Date.UTC(currentYear, 0, 1)).toISOString();

  // Each person's own season window, from their recorded time zone.
  const { data: allUsers } = await supabase.from('users').select('id, timezone');
  const windowFor = new Map<string, { start: string; end: string }>();
  for (const u of allUsers || []) {
    windowFor.set(u.id, {
      start: seasonBoundary(previousYear, u.timezone),
      end: seasonBoundary(currentYear, u.timezone),
    });
  }
  const windowOf = (id: string) => windowFor.get(id) ?? { start: seasonStart, end: seasonEnd };

  // Snapshot per-user final XP for the season
  let userResultsSaved = 0;

  for (const u of allUsers || []) {
    const { data: acts } = await supabase
      .from('activities')
      .select('effort_score')
      .eq('user_id', u.id)
      .gte('started_at', windowOf(u.id).start)
      .lt('started_at', windowOf(u.id).end);

    const finalXp = (acts || []).reduce((s, a) => s + (a.effort_score || 0), 0);
    if (finalXp <= 0) continue;

    const lvl = getLevel(finalXp);
    const { error } = await supabase.from('season_results').upsert({
      season_id: prevSeason.id,
      user_id: u.id,
      final_xp: Math.round(finalXp * 10) / 10,
      final_level: lvl.level,
      final_rank_name: lvl.name,
    }, { onConflict: 'season_id,user_id' });

    if (!error) userResultsSaved++;
  }

  // Snapshot per-league final standings for the season
  const { data: leagues } = await supabase.from('leagues').select('id');
  let leagueResultsSaved = 0;

  for (const league of leagues || []) {
    const { data: members } = await supabase
      .from('league_members')
      .select('user_id')
      .eq('league_id', league.id)
      .eq('status', 'active');

    const scored = await Promise.all(
      (members || []).map(async (m: any) => {
        const { data: acts } = await supabase
          .from('activities')
          .select('effort_score')
          .eq('user_id', m.user_id)
          .gte('started_at', windowOf(m.user_id).start)
          .lt('started_at', windowOf(m.user_id).end);
        const score = (acts || []).reduce((s, a) => s + (a.effort_score || 0), 0);
        return { user_id: m.user_id, score };
      })
    );

    scored.sort((a, b) => b.score - a.score);

    for (let i = 0; i < scored.length; i++) {
      if (scored[i].score <= 0) continue;
      const { error } = await supabase.from('league_season_results').insert({
        season_id: prevSeason.id,
        league_id: league.id,
        user_id: scored[i].user_id,
        final_score: Math.round(scored[i].score * 10) / 10,
        final_position: i + 1,
      });
      if (!error) leagueResultsSaved++;
    }
  }

  // Close the old season
  await supabase.from('seasons').update({ closed_at: now.toISOString() }).eq('id', prevSeason.id);

  // Open the new season (idempotent)
  await supabase.from('seasons').upsert({
    year: currentYear,
    start_date: seasonEnd,
    end_date: new Date(Date.UTC(currentYear + 1, 0, 1)).toISOString(),
  }, { onConflict: 'year' });

  return new Response(JSON.stringify({
    message: `Season ${previousYear} closed`,
    userResultsSaved,
    leagueResultsSaved,
  }), { status: 200 });
});
