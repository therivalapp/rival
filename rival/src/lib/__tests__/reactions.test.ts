import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: {} }));
import { impactTotals, type ReactionRow } from '../reactions';

const row = (user_id: string, emoji: string): ReactionRow => ({ target_id: 'a1', user_id, emoji, created_at: '2026-09-01T00:00:00Z' });

describe('impactTotals', () => {
  it('counts Respect and Inspired from other people, and each person once', () => {
    const t = impactTotals([row('sandy', 'respect'), row('sandy', 'inspired'), row('emma', 'respect'), row('me', 'respect')], 'me');
    expect(t).toEqual({ respect: 2, inspired: 1, people: 2 });
  });
  it('is zero with no reactions', () => {
    expect(impactTotals([], 'me')).toEqual({ respect: 0, inspired: 0, people: 0 });
  });
});
