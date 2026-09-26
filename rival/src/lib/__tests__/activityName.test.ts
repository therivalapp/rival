import { describe, expect, it } from 'vitest';
import { defaultActivityName, partOfDay } from '../activityName';

const at = (h: number) => new Date(2026, 8, 26, h, 30);

describe('defaultActivityName', () => {
  it('names by time of day', () => {
    expect(defaultActivityName('Run', at(7))).toBe('Morning Run');
    expect(defaultActivityName('Ride', at(12))).toBe('Lunch Ride');
    expect(defaultActivityName('Swim', at(15))).toBe('Afternoon Swim');
    expect(defaultActivityName('Run', at(19))).toBe('Evening Run');
    expect(defaultActivityName('Run', at(23))).toBe('Night Run');
    expect(partOfDay(at(3))).toBe('Night');
  });

  it('reads the stored type as words', () => {
    expect(defaultActivityName('WeightTraining', at(18))).toBe('Evening Weight Training');
    expect(defaultActivityName('Rowing', at(6))).toBe('Morning Row');
    expect(defaultActivityName('TrailRun', at(8))).toBe('Morning Trail Run');
    expect(defaultActivityName(null, at(8))).toBe('Morning Activity');
  });
});
