import { describe, expect, it } from 'vitest';
import { bestFor, exerciseCount, lastDoneText, lastTimeFor, orderSaved, percentWeight, repeatOptions, todaysWorkout, type LiftActivity } from '../liftHistory';

const act = (id: string, iso: string, exercises: any[]): LiftActivity => ({ id, startedAt: iso, activityType: 'WeightTraining', exercises });

describe('lastTimeFor', () => {
  const history = [
    act('a', '2026-06-20T08:00:00Z', [{ name: 'Bench Press', sets: 3, reps: 5, weight: 130 }]),
    act('b', '2026-06-27T08:00:00Z', [{ name: 'bench', sets: 3, reps: 5, weight: 140 }]),
  ];
  it('finds the latest, whatever the lift was typed as', () => {
    expect(lastTimeFor(history, 'Bench press')?.weight).toBe(140);
  });
  it('ignores anything from the activity being logged or later', () => {
    expect(lastTimeFor(history, 'Bench press', new Date('2026-06-25').getTime())?.weight).toBe(130);
  });
  it('is null for a lift never logged', () => {
    expect(lastTimeFor(history, 'Squat')).toBeNull();
  });
});

describe('bestFor', () => {
  it('takes the heaviest single', () => {
    const b = bestFor([{ name: 'Bench Press', weightKg: 140, reps: 1, at: '' }, { name: 'Bench Press', weightKg: 120, reps: 1, at: '' }], 'bench press');
    expect(b?.kg).toBe(140);
    expect(b?.estimated).toBe(false);
  });
  it('estimates from a set of several reps', () => {
    const b = bestFor([{ name: 'Squat', weightKg: 90, reps: 5, at: '' }], 'Squat');
    expect(b?.kg).toBe(105);
    expect(b?.estimated).toBe(true);
  });
});

describe('percentWeight', () => {
  it('rounds to a weight you can load', () => {
    expect(percentWeight(140, 80, 'kg')).toBe(112.5);
    expect(percentWeight(160, 70, 'kg')).toBe(112.5);
  });
  it('rounds to 5 lb in pounds', () => {
    const lb = percentWeight(100, 80, 'lb') / 0.453592;
    expect(Math.round(lb)).toBe(175);
  });
});

describe('repeatOptions', () => {
  const friday = new Date('2026-07-03T09:00:00');
  const history = [
    act('fri', '2026-06-26T08:00:00', [{ name: 'Bench Press' }, { name: 'Clean and Jerk' }]),
    act('thu', '2026-07-02T08:00:00', [{ name: 'Squat' }]),
    act('wed', '2026-07-01T08:00:00', [{ name: 'Squat' }]),
  ];
  it('puts the same weekday first, then saved, then recent, each set once', () => {
    const o = repeatOptions(history, [{ id: 's1', name: 'Squat day', activityType: null, exercises: [{ name: 'Deadlift' }], lastUsedAt: '2026-06-01' }], friday);
    expect(o.map((x) => x.title)).toEqual(['Same as last Friday', 'Squat day', expect.any(String)]);
    expect(o[2].detail).toBe('Squat');
  });
  it("puts today's usual saved workout ahead, and yesterday's last", () => {
    const saved = [
      { id: 'leg', name: 'Leg day', activityType: null, exercises: [{ name: 'Squat' }], lastUsedAt: '2026-07-02T08:00:00', usualDay: null },
      { id: 'fri', name: 'Friday pull', activityType: null, exercises: [{ name: 'Row' }], lastUsedAt: '2026-06-01T08:00:00', usualDay: 5 },
    ];
    const o = repeatOptions([], saved, friday);
    expect(o.map((x) => x.title)).toEqual(['Friday pull', 'Leg day']);
  });
});

describe('saved workouts order', () => {
  const now = new Date(2026, 9, 26, 9, 0); // a Monday
  const list = [
    { id: 'legs', usualDay: 3, lastUsedAt: '2026-10-25T10:00:00Z', createdAt: '2026-10-01T10:00:00Z', exercises: [{ name: 'Squat' }] },
    { id: 'mon', usualDay: 1, lastUsedAt: '2026-10-19T10:00:00Z', createdAt: '2026-10-01T10:00:00Z', exercises: [{ name: 'Bench Press' }, { name: 'Dip' }] },
    { id: 'chest', usualDay: null, lastUsedAt: '2026-10-24T10:00:00Z', createdAt: '2026-10-24T10:00:00Z', exercises: [] },
  ];
  it("puts today's workout first, then the most recently used", () => {
    expect(orderSaved(list, now).map((w) => w.id)).toEqual(['mon', 'legs', 'chest']);
    expect(todaysWorkout(list, now)?.id).toBe('mon');
    expect(todaysWorkout(list, new Date(2026, 9, 27))).toBeNull();
  });
  it('counts exercises and says when it was last done', () => {
    expect(exerciseCount(list[1])).toBe('2 exercises');
    expect(exerciseCount(list[0])).toBe('1 exercise');
    expect(lastDoneText(list[1].lastUsedAt, list[1].createdAt, now)).toBe('last done 7 days ago');
    expect(lastDoneText(list[2].lastUsedAt, list[2].createdAt, now)).toBe('not done yet');
  });
});
