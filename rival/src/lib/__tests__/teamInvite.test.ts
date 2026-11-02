import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: {} }));
import { groupJoinNotices, memberLine } from '../teamInvite';

const notice = (actor: string, at: string, league = 'a') => ({ kind: 'team_joined', actor_id: actor, league_id: league, created_at: at, title: `${actor} joined The Hidden Leaf`, body: 'Invited by Sandy' });

describe('memberLine', () => {
  const base = { is_founder: false, is_admin: false, joined_at: '2026-03-14T12:00:00Z', year_effort: 0 };
  it('leads with the rank', () => expect(memberLine(base)).toMatch(/^Rookie · Joined /));
  it('says Founder for who started the team', () => expect(memberLine({ ...base, is_founder: true, is_admin: true })).toMatch(/^Rookie · Founder, /));
  it('says Admin for an admin added later', () => expect(memberLine({ ...base, is_admin: true })).toBe('Rookie · Admin'));
});

describe('groupJoinNotices', () => {
  it('leaves one join alone', () => {
    const one = notice('Jordan', '2026-11-01T10:00:00Z');
    expect(groupJoinNotices([one])).toEqual([one]);
  });
  it('merges a day of joins on one team', () => {
    const out = groupJoinNotices([notice('Jordan', '2026-11-01T10:00:00Z'), notice('Alex', '2026-11-01T09:00:00Z'), notice('Sam', '2026-11-01T08:00:00Z')]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('3 people joined The Hidden Leaf');
    expect(out[0].actor_id).toBeNull();
  });
  it('keeps teams and other kinds apart', () => {
    const other = { kind: 'reaction', actor_id: 'x', league_id: 'a', created_at: '2026-11-01T10:00:00Z', title: 'Respect', body: null };
    expect(groupJoinNotices([notice('Jordan', '2026-11-01T10:00:00Z'), notice('Alex', '2026-11-01T09:00:00Z', 'b'), other])).toHaveLength(3);
  });
});
