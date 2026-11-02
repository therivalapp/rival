import { describe, expect, it } from 'vitest';
import { bestSince, clock, gainedText, parseClock, performanceState, performanceTitle, toGoText, type PerformanceActivity, type PerformanceGoal } from '../goalPerformance';

const run = (at: string, meters: number, seconds: number, extra: Partial<PerformanceActivity> = {}): PerformanceActivity => ({ activity_type: 'Run', started_at: at, distance_meters: meters, duration_seconds: seconds, ...extra });
const five: PerformanceGoal = { goal_type: 'fastest_time', target_value: 1199, activity_filter: 'Run', start_date: '2026-10-01', distance_m: 5000, start_value: 1323 };

describe('Performance goals', () => {
  it('finds a best from a whole run or a split inside a longer one', () => {
    expect(bestSince(five, [run('2026-10-05T08:00:00', 5000, 1300)], [])).toBe(1300);
    expect(bestSince(five, [run('2026-10-05T08:00:00', 10000, 2800, { best_efforts: [{ distance: 5000, seconds: 1274 }] })], [])).toBe(1274);
  });
  it('ignores a run that is not the distance, or another sport', () => {
    expect(bestSince(five, [run('2026-10-05T08:00:00', 7000, 1500)], [])).toBeNull();
    expect(bestSince(five, [{ ...run('2026-10-05T08:00:00', 5000, 900), activity_type: 'Ride' }], [])).toBeNull();
  });
  it('fills from the starting best to the target', () => {
    const s = performanceState(five, [run('2026-10-05T08:00:00', 5000, 1274)], []);
    expect(s.current).toBe(1274);
    expect(s.pct).toBeCloseTo(49 / 124);
    expect(toGoText(five, s)).toBe('1:15 to go');
    expect(gainedText(five, s)).toBe('49 seconds faster since the start');
  });
  it('never goes backwards on a slower day', () => {
    expect(performanceState(five, [run('2026-10-05T08:00:00', 5000, 1400)], []).current).toBe(1323);
  });
  it('completes on reaching the target', () => {
    const s = performanceState(five, [run('2026-10-05T08:00:00', 5000, 1195)], []);
    expect(s.done).toBe(true);
    expect(s.pct).toBe(1);
  });
  it('needs the pace held over the set distance', () => {
    const swim: PerformanceGoal = { goal_type: 'pace', target_value: 120, activity_filter: 'Swim', start_date: '2026-10-01', distance_m: 1000 };
    const at = (m: number, s: number) => ({ ...run('2026-10-05T08:00:00', m, s), activity_type: 'Swim' });
    expect(bestSince(swim, [at(100, 100)], [])).toBeNull();
    expect(bestSince(swim, [at(1000, 1450)], [])).toBe(145);
  });
  it('counts a lift only at the target reps or more', () => {
    const lift: PerformanceGoal = { goal_type: 'lift', target_value: 100, activity_filter: null, start_date: '2026-10-01', lift_name: 'Bench Press', lift_reps: 5, start_value: 80 };
    const entries = [{ name: 'bench', weightKg: 95, reps: 1, at: '2026-10-05T08:00:00' }, { name: 'Bench Press', weightKg: 85, reps: 5, at: '2026-10-06T08:00:00' }];
    expect(performanceState(lift, [], entries).current).toBe(85);
    expect(performanceState(lift, [], entries).pct).toBeCloseTo(0.25);
  });
  it('reads and writes times', () => {
    expect(parseClock('19:59')).toBe(1199);
    expect(parseClock('1:02:30')).toBe(3750);
    expect(parseClock('abc')).toBeNull();
    expect(clock(3750)).toBe('1:02:30');
  });
  it('titles goals plainly', () => {
    expect(performanceTitle(five)).toBe('5 km run in 19:59');
  });
});
