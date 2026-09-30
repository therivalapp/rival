import { describe, expect, it } from 'vitest';
import { computeGoalProgress, goalActivityLabel } from '../goalProgress';

const acts = [
  { activity_type: 'Run', name: 'Morning run', distance_meters: 5000, elevation_meters: 20, started_at: '2026-09-10T07:00:00Z' },
  { activity_type: 'WeightTraining', name: 'Legs', distance_meters: 0, elevation_meters: 0, started_at: '2026-09-11T07:00:00Z' },
  { activity_type: 'Workout', name: 'Padel with Sam', distance_meters: 0, elevation_meters: 0, started_at: '2026-09-12T07:00:00Z' },
  { activity_type: 'TrailRun', name: 'Hills', distance_meters: 8000, elevation_meters: 300, started_at: '2026-09-13T07:00:00Z' },
];
const base = { start_date: '2026-09-01', end_date: '2026-09-30' };

describe('activities goals', () => {
  it('counts only gym activities for a goal saved before "All" existed', () => {
    expect(computeGoalProgress({ ...base, goal_type: 'gym_sessions', activity_filter: null }, acts)).toBe(2);
  });
  it('counts every activity for All', () => {
    expect(computeGoalProgress({ ...base, goal_type: 'gym_sessions', activity_filter: 'All' }, acts)).toBe(4);
  });
  it('matches a custom activity by name', () => {
    expect(computeGoalProgress({ ...base, goal_type: 'gym_sessions', activity_filter: 'padel' }, acts)).toBe(1);
  });
  it('keeps run groups for distance', () => {
    expect(computeGoalProgress({ ...base, goal_type: 'distance', activity_filter: 'Run' }, acts)).toBe(13);
  });
  it('labels goals', () => {
    expect(goalActivityLabel({ goal_type: 'gym_sessions', activity_filter: null })).toBe('Gym activities');
    expect(goalActivityLabel({ goal_type: 'gym_sessions', activity_filter: 'All' })).toBe('All activities');
    expect(goalActivityLabel({ goal_type: 'distance', activity_filter: 'TrailRun' })).toBe('Trail run');
  });
});
