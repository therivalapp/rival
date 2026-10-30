import { describe, expect, it } from 'vitest';
import { isPrivateOnStrava, removeAllStravaData, removeStravaActivity } from '../../../supabase/functions/_shared/stravaRemoval';

// A small stand-in for the Supabase client: enough to follow the filters.
function fakeDb(tables: Record<string, Record<string, any>[]>) {
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = [];
    let mode: 'select' | 'delete' = 'select';
    let page: [number, number] | null = null;
    const rows = () => tables[table].filter((r) => filters.every((f) => f(r)));
    const run = () => {
      const hit = rows();
      if (mode === 'delete') {
        tables[table] = tables[table].filter((r) => !hit.includes(r));
        return { data: null, count: hit.length, error: null };
      }
      return { data: page ? hit.slice(page[0], page[1] + 1) : hit, count: hit.length, error: null };
    };
    const q: any = {
      select: () => q,
      delete: () => { mode = 'delete'; return q; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
      range: (a: number, b: number) => { page = [a, b]; return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (done: (v: unknown) => void) => done(run()),
    };
    return q;
  };
  return { from, tables };
}

const seed = () => fakeDb({
  activity_sources: [
    { id: 's1', user_id: 'u', provider: 'strava', provider_activity_id: '1', activity_id: 'a1' },
    { id: 's2', user_id: 'u', provider: 'strava', provider_activity_id: '2', activity_id: 'a2' },
    { id: 's3', user_id: 'u', provider: 'strava_archive', provider_activity_id: '2', activity_id: 'a2' },
    { id: 's4', user_id: 'other', provider: 'strava', provider_activity_id: '1', activity_id: 'b1' },
  ],
  activities: [
    { id: 'a1', user_id: 'u', provider: 'strava', provider_activity_id: '1' },
    { id: 'a2', user_id: 'u', provider: 'strava', provider_activity_id: '2' },
    { id: 'a3', user_id: 'u', provider: 'strava', provider_activity_id: '3' },
    { id: 'm1', user_id: 'u', provider: 'manual', provider_activity_id: null },
    { id: 'b1', user_id: 'other', provider: 'strava', provider_activity_id: '1' },
  ],
  fitness_connections: [{ user_id: 'u', provider: 'strava' }, { user_id: 'other', provider: 'strava' }],
});

describe('isPrivateOnStrava', () => {
  it('reads either field', () => {
    expect(isPrivateOnStrava({ visibility: 'only_me' })).toBe(true);
    expect(isPrivateOnStrava({ private: true })).toBe(true);
  });
  it('leaves shared activities alone', () => {
    expect(isPrivateOnStrava({ visibility: 'followers_only', private: false })).toBe(false);
    expect(isPrivateOnStrava({ visibility: 'everyone' })).toBe(false);
    expect(isPrivateOnStrava(null)).toBe(false);
  });
});

describe('removeStravaActivity', () => {
  it('removes an activity with no other source', async () => {
    const db = seed();
    expect(await removeStravaActivity(db, 'u', '1')).toBe(1);
    expect(db.tables.activities.map((a) => a.id)).not.toContain('a1');
  });
  it('keeps an activity another source still points at', async () => {
    const db = seed();
    expect(await removeStravaActivity(db, 'u', '2')).toBe(0);
    expect(db.tables.activities.map((a) => a.id)).toContain('a2');
  });
  it('falls back to the id on rows with no source record', async () => {
    const db = seed();
    expect(await removeStravaActivity(db, 'u', '3')).toBe(1);
  });
  it('never reaches another person', async () => {
    const db = seed();
    await removeStravaActivity(db, 'u', '1');
    expect(db.tables.activities.map((a) => a.id)).toContain('b1');
  });
});

describe('removeAllStravaData', () => {
  it('clears Strava data and the connection, keeping manual and archived activities', async () => {
    const db = seed();
    expect(await removeAllStravaData(db, 'u')).toBe(2);
    expect(db.tables.activities.map((a) => a.id).sort()).toEqual(['a2', 'b1', 'm1']);
    expect(db.tables.fitness_connections).toEqual([{ user_id: 'other', provider: 'strava' }]);
    expect(db.tables.activity_sources.filter((s) => s.user_id === 'u').map((s) => s.provider)).toEqual(['strava_archive']);
  });
});
