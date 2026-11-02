import { describe, expect, it, vi } from 'vitest';

vi.mock('../prefs', () => ({ getPrefs: () => ({}) }));
import { finishTiles, type FinishNumbers } from '../finishTiles';

const base: FinishNumbers = {
  family: 'run', activityType: 'Run', hero: 'distance', metres: 0, seconds: 0, climb: 0, highest: null, topKmh: null, ski: null,
  waveCount: null, longestWave: null, effort: 100, stats: {}, lifts: { exercises: 0, sets: 0, heaviest: 0, volume: 0 },
};
const names = (v: Partial<FinishNumbers>) => finishTiles({ ...base, ...v }).map((t) => t.name);

describe('finishTiles', () => {
  it('lays out a hike as mocked: climb first, Effort third', () => {
    expect(names({ family: 'walk', activityType: 'Hike', metres: 11400, seconds: 11560, climb: 1086, highest: 1642, avgBpm: 118, calories: 1480 }))
      .toEqual(['ELEVATION', 'AVG PACE', 'EFFORT', 'HIGHEST', 'AVG BPM', 'CALORIES']);
  });

  it('puts Effort first on a short timed activity', () => {
    expect(names({ family: 'mind', activityType: 'Yoga', hero: 'time', avgBpm: 96, calories: 180 })).toEqual(['EFFORT', 'AVG BPM', 'CALORIES']);
  });

  it('puts Effort first in racket sports', () => {
    expect(names({ family: 'racket', activityType: 'Tennis', hero: 'time', metres: 4100, avgBpm: 146, maxBpm: 178, calories: 980, stats: { steps: 9420 } }))
      .toEqual(['EFFORT', 'COVERED', 'AVG BPM', 'MAX BPM', 'CALORIES', 'STEPS']);
  });

  it('shows weights as lifts', () => {
    expect(names({ family: 'weights', activityType: 'WeightTraining', hero: 'time', avgBpm: 121, lifts: { exercises: 5, sets: 18, heaviest: 100, volume: 6420 } }))
      .toEqual(['EXERCISES', 'SETS', 'EFFORT', 'HEAVIEST', 'VOLUME', 'AVG BPM']);
  });

  it('shows a ride in speed and leaves out what it has no data for', () => {
    const t = finishTiles({ ...base, family: 'ride', activityType: 'Ride', metres: 42600, seconds: 5480, climb: 612, topKmh: 54.2 });
    expect(t.map((x) => x.name)).toEqual(['AVG SPEED', 'ELEVATION', 'EFFORT', 'TOP SPEED']);
    expect(t[0].value).toBe('28.0');
  });
});
