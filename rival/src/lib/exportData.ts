import { Platform } from 'react-native';
import { supabase } from './supabase';

// "Download my data": everything RIVAL holds that belongs to the signed-in
// person, as one JSON file. Each table is read through the person's own
// session, so row-level security decides what is theirs — nothing here can
// reach anyone else's data. Connection secrets (Strava tokens, push tokens)
// are left out on purpose: they are keys, not data about the person.

const TABLES = [
  'activities',
  'activity_participants',
  'exercise_entries',
  'exercise_goals',
  'goals',
  'races',
  'race_interests',
  'milestones',
  'user_achievements',
  'weekly_scores',
  'season_results',
  'league_season_results',
  'league_members',
  'league_messages',
  'league_message_reactions',
  'league_session_rsvps',
  'feed_posts',
  'feed_comments',
  'feed_reactions',
  'inbox_items',
  'shared_images',
  'ai_generations',
] as const;

const PAGE = 1000;

async function allRows(table: string, userId: string): Promise<{ rows: any[]; error?: string }> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId).range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows };
  }
}

export async function buildDataExport(userId: string, email: string | null): Promise<{ json: string; problems: string[] }> {
  const problems: string[] = [];
  const [profile, strava] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
    supabase
      .from('fitness_connections')
      .select('provider, athlete_firstname, athlete_lastname, created_at')
      .eq('user_id', userId),
  ]);
  if (profile.error) problems.push(`profile: ${profile.error.message}`);

  const results = await Promise.all(TABLES.map((t) => allRows(t, userId)));
  const tables: Record<string, any[]> = {};
  TABLES.forEach((t, i) => {
    tables[t] = results[i].rows;
    if (results[i].error) problems.push(`${t}: ${results[i].error}`);
  });

  const out = {
    exported_at: new Date().toISOString(),
    account: { id: userId, email },
    profile: profile.data ?? null,
    connected_apps: strava.data ?? [],
    ...tables,
    ...(problems.length ? { incomplete: problems } : {}),
  };
  return { json: JSON.stringify(out, null, 2), problems };
}

/** Web: hands the file to the browser as a download. */
export function saveJsonFile(json: string, filename: string): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
