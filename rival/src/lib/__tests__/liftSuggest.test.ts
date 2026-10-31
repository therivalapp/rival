import { describe, expect, it } from 'vitest';
import { CANONICAL_LIFTS } from '../lifts';
import { focusFromName, suggestLifts } from '../liftSuggest';

const base = { mine: [] as string[], activities: [] as string[][], added: [] as string[], activityName: '', fallback: ['Squat', 'Deadlift', 'Lunge', 'Leg Press'], count: 4 };

describe('suggestLifts', () => {
  it('with nothing to go on, keeps own lifts then the usual ones', () => {
    expect(suggestLifts({ ...base, mine: ['Sled Push', 'Squat'] })).toEqual(['Sled Push', 'Squat', 'Deadlift', 'Lunge']);
  });

  it('favours what goes with an added lift, taking turns across muscles', () => {
    expect(suggestLifts({ ...base, added: ['Bench Press'] })).toEqual(['Incline Bench Press', 'Dip', 'Overhead Press', 'Dumbbell Bench Press']);
  });

  it('pairs back with biceps', () => {
    expect(suggestLifts({ ...base, added: ['Barbell Row'] }).slice(0, 2)).toEqual(['Pull-up', 'Bicep Curl']);
  });

  it('puts own pairings first, including exercises of their own', () => {
    const activities = [['Bench Press', 'Sled Push'], ['Bench Press', 'Sled Push', 'Dip'], ['Bench Press', 'Lat Pulldown']];
    expect(suggestLifts({ ...base, added: ['Bench Press'], activities })[0]).toBe('Sled Push');
  });

  it('needs a pairing twice before it counts', () => {
    const activities = [['Bench Press', 'Calf Raise']];
    expect(suggestLifts({ ...base, added: ['Bench Press'], activities })).not.toContain('Calf Raise');
  });

  it('puts own lifts for the muscle ahead of the general ones', () => {
    expect(suggestLifts({ ...base, added: ['Bench Press'], mine: ['Squat', 'Skullcrusher'] })[0]).toBe('Skullcrusher');
  });

  it('reads the activity name', () => {
    expect(suggestLifts({ ...base, activityName: 'Chest day' })[0]).toBe('Bench Press');
    expect(suggestLifts({ ...base, activityName: 'Leg day' }).slice(0, 2)).toEqual(['Squat', 'Leg Press']);
  });

  it('never offers an added lift, however it was typed', () => {
    expect(suggestLifts({ ...base, added: ['bench', 'ohp'], mine: ['Bench Press', 'Overhead Press'] })).not.toContain('Bench Press');
    expect(suggestLifts({ ...base, added: ['bench', 'ohp'], mine: ['Bench Press', 'Overhead Press'] })).not.toContain('Overhead Press');
  });

  it('a lift it has no muscle for changes nothing', () => {
    expect(suggestLifts({ ...base, added: ['Sled Push'] })).toEqual(['Squat', 'Deadlift', 'Lunge', 'Leg Press']);
  });

  it('has a muscle for every canonical lift', () => {
    CANONICAL_LIFTS.forEach((lift) => {
      expect(suggestLifts({ ...base, added: [lift], fallback: [], count: 1 }).length, lift).toBe(1);
    });
  });
});

describe('focusFromName', () => {
  it('reads training-split words', () => {
    expect(focusFromName('Push')[0]).toBe('chest');
    expect(focusFromName('Pull day')[0]).toBe('back');
    expect(focusFromName('Upper body')).toContain('back');
  });

  it('is not fooled by lift names', () => {
    expect(focusFromName('Push press')).toEqual([]);
    expect(focusFromName('Pull-ups')).toEqual([]);
    expect(focusFromName('Back squat')).toEqual([]);
    expect(focusFromName('Evening Workout')).toEqual([]);
  });
});
