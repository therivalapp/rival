import { describe, expect, it } from 'vitest';
import { activityToPrompt, type PromptActivity } from '../photoPrompt';

const now = new Date('2026-10-31T12:00:00Z').getTime();
const row = (over: Partial<PromptActivity>): PromptActivity => ({
  id: 'a', name: 'Morning Run', started_at: '2026-10-31T07:00:00Z', provider: 'strava',
  photo_url: null, duration_seconds: 2530, distance_meters: 7100, effort_score: 76, ...over,
});

describe('activityToPrompt', () => {
  it('asks about a new automatic activity with no photo', () => {
    expect(activityToPrompt([row({})], [], now)?.id).toBe('a');
  });
  it('asks once per activity', () => {
    expect(activityToPrompt([row({})], ['a'], now)).toBeNull();
  });
  it('leaves one with a photo alone', () => {
    expect(activityToPrompt([row({ photo_url: 'x' })], [], now)).toBeNull();
  });
  it('never asks about one logged by hand', () => {
    for (const provider of ['manual', 'rival_manual', 'rival_scan']) expect(activityToPrompt([row({ provider })], [], now)).toBeNull();
  });
  it('skips logged-by-hand ones to find the latest automatic one', () => {
    expect(activityToPrompt([row({ id: 'm', provider: 'manual' }), row({ id: 'b' })], [], now)?.id).toBe('b');
  });
  it('asks only about the latest, not an older one', () => {
    expect(activityToPrompt([row({ id: 'b' }), row({ id: 'a' })], ['b'], now)).toBeNull();
  });
  it('stops after a day', () => {
    expect(activityToPrompt([row({ started_at: '2026-10-30T11:59:00Z' })], [], now)).toBeNull();
  });
});
