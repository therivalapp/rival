import { describe, expect, it } from 'vitest';
import { liftsFromSaved, liftsToSave, liveClock, liveSeconds, logsLifts, togglePause, totalSets, type LiveActivity } from '../liveActivity';

const live = (over: Partial<LiveActivity> = {}): LiveActivity => ({ startedAt: 1_000, activityType: 'WeightTraining', savedId: null, name: null, lifts: [], ...over });

describe('liveActivity', () => {
  it('works the time out from the start, so a locked phone loses nothing', () => {
    expect(liveSeconds(live(), 1_000 + 3_725_900)).toBe(3725);
    expect(liveSeconds(live({ startedAt: 5_000 }), 1_000)).toBe(0);
  });

  it('holds the time while paused and leaves that time out after', () => {
    const paused = { ...live(), ...togglePause(live(), 61_000) };
    expect(liveSeconds(paused, 500_000)).toBe(60);
    const resumed = { ...paused, ...togglePause(paused, 121_000) };
    expect(resumed.pausedAt).toBeNull();
    expect(liveSeconds(resumed, 131_000)).toBe(70);
  });

  it('shows minutes, then hours past the hour', () => {
    expect(liveClock(0)).toBe('0:00');
    expect(liveClock(1934)).toBe('32:14');
    expect(liveClock(3729)).toBe('1:02:09');
  });

  it('keeps a routine\'s numbers and drops blank rows', () => {
    expect(liftsFromSaved([{ name: 'Squat', sets: 3, reps: 8, weight: 80 }, { name: ' ' }]))
      .toEqual([{ name: 'Squat', sets: 3, reps: 8, weight: 80 }]);
  });

  it('saves only what was logged, once anything was', () => {
    const lifts = [{ name: 'Squat', sets: 3, logged: true }, { name: 'Plank', sets: 3 }, { name: 'Dip', sets: 2, logged: true }];
    expect(liftsToSave(lifts).map((l) => l.name)).toEqual(['Squat', 'Dip']);
    expect(totalSets(lifts)).toBe(5);
  });

  it('brings the whole routine through when nothing was logged', () => {
    expect(liftsToSave([{ name: 'Squat', sets: 3 }, { name: 'Plank', sets: 3 }]).map((l) => l.name)).toEqual(['Squat', 'Plank']);
  });

  it('logs lifts for gym activities only', () => {
    expect(logsLifts('WeightTraining')).toBe(true);
    expect(logsLifts('Run')).toBe(false);
  });
});
