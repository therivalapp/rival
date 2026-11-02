import { supabase } from './supabase';
import { getLevel } from './xp';

// Joining by invite: the new member names who invited them, that teammate
// confirms, and the admin keeps the final say (supabase/team_invites.sql).

export type InviteMember = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  is_admin: boolean;
  is_founder: boolean;
  joined_at: string;
  year_effort: number;
};

export type InviteTeam = {
  league_id: string;
  name: string;
  logo_url: string | null;
  status: 'active' | 'pending' | null;
  invited_by: string | null;
  members: InviteMember[];
};

export async function teamByCode(code: string): Promise<{ team?: InviteTeam; error?: string }> {
  const { data, error } = await supabase.rpc('team_by_code', { code });
  if (error) return { error: "Couldn't find the team. Try again." };
  if (data?.error === 'invalid_code') return { error: 'Invalid invite code. Check it and try again.' };
  if (data?.error) return { error: "Couldn't find the team. Try again." };
  return { team: data as InviteTeam };
}

export async function requestToJoin(code: string, inviter: string | null): Promise<{ alreadyMember?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('request_to_join', { code, p_inviter: inviter });
  if (error) return { error: "Couldn't send the request. Try again." };
  if (data?.error === 'declined_recently') return { error: 'This team reviewed a request recently. Try again in a week.' };
  if (data?.error) return { error: "Couldn't send the request. Try again." };
  return { alreadyMember: !!data?.already_member };
}

/** Under a teammate's name: their rank and when they joined. */
export function memberLine(m: Pick<InviteMember, 'is_founder' | 'is_admin' | 'joined_at' | 'year_effort'>): string {
  const rank = getLevel(m.year_effort).name;
  const when = new Date(m.joined_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  if (m.is_founder) return `${rank} · Founder, ${when}`;
  if (m.is_admin) return `${rank} · Admin`;
  return `${rank} · Joined ${when}`;
}

/** Several joins on one team in a day read as one notice. */
export function groupJoinNotices<T extends { kind: string; actor_id: string | null; league_id: string | null; created_at: string; title: string; body: string | null }>(items: T[]): T[] {
  const firsts = new Map<string, { item: T; n: number }>();
  const out: T[] = [];
  for (const item of items) {
    if (item.kind !== 'team_joined' || !item.actor_id) { out.push(item); continue; }
    const key = `${item.league_id}|${new Date(item.created_at).toDateString()}`;
    const seen = firsts.get(key);
    if (seen) { seen.n += 1; continue; }
    firsts.set(key, { item, n: 1 });
    out.push(item);
  }
  return out.map((item) => {
    const entry = item.kind === 'team_joined' && item.actor_id ? firsts.get(`${item.league_id}|${new Date(item.created_at).toDateString()}`) : undefined;
    if (!entry || entry.item !== item || entry.n < 2) return item;
    const team = item.title.split(' joined ').slice(1).join(' joined ');
    return { ...item, actor_id: null, title: `${entry.n} people joined ${team}`, body: null };
  });
}
