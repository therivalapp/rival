import { supabase } from './supabase';

/** When the team's current challenge started: its own start date, or the
 *  team's creation for challenges set before start dates existed. */
export function challengeStart(l: { created_at: string; goal_start_date?: string | null }): string {
  if (l.goal_start_date) return l.goal_start_date;
  const d = new Date(l.created_at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Keeps a team's current challenge in the trophy case before it is ended
 *  or replaced (team_challenge_history.sql). */
export async function archiveChallenge(l: { id: string; created_at: string; goal_metric: string | null; goal_target: number | null; goal_target_date: string | null; goal_start_date?: string | null }) {
  if (!l.goal_metric || !l.goal_target || !l.goal_target_date) return;
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const end = l.goal_target_date < today ? l.goal_target_date : today;
  const start = challengeStart(l);
  const { data: dup } = await supabase.from('team_challenge_history').select('id').eq('league_id', l.id).eq('start_date', start).eq('metric', l.goal_metric).limit(1);
  if (dup && dup.length) return;
  const { error } = await supabase.from('team_challenge_history').insert({ league_id: l.id, metric: l.goal_metric, target: l.goal_target, start_date: start, end_date: end });
  if (error) console.warn('Challenge not kept:', error.message);
}

