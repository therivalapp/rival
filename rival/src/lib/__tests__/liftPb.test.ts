import { describe, it, expect } from 'vitest';
import { liftPbChecker, loggedLifts } from '../liftPb';

const U = 'u1';
function act(id: string, day: number, exercises: any[]) {
  return { id, user_id: U, started_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`, exercises };
}

describe('liftPbChecker', () => {
  it('does not call a first lift a PB unless it was marked', () => {
    const a = act('a', 1, [{ name: 'Bench', weight: 300 }]);
    const check = liftPbChecker(loggedLifts([a]));
    expect(check(U, 'a', a.started_at, a.exercises)).toBeNull();
  });

  it('calls a marked first lift a PB, with nothing to compare against', () => {
    const a = act('a', 1, [{ name: 'Bench', weight: 300, markedPb: true }]);
    const check = liftPbChecker(loggedLifts([a]));
    expect(check(U, 'a', a.started_at, a.exercises)).toEqual({ lift: 'Bench Press', weightKg: 300, prevKg: null });
  });

  it('calls a lift a PB only when it beats the heaviest earlier one', () => {
    const a = act('a', 1, [{ name: 'Bench Press', weight: 100 }]);
    const b = act('b', 2, [{ name: 'bench', weight: 100 }]);
    const c = act('c', 3, [{ name: 'Bench Press', weight: 105 }]);
    const check = liftPbChecker(loggedLifts([a, b, c]));
    expect(check(U, 'b', b.started_at, b.exercises)).toBeNull();
    expect(check(U, 'c', c.started_at, c.exercises)).toEqual({ lift: 'Bench Press', weightKg: 105, prevKg: 100 });
  });

  it('ignores a mark once the lift has been logged before', () => {
    const a = act('a', 1, [{ name: 'Deadlift', weight: 200 }]);
    const b = act('b', 2, [{ name: 'Deadlift', weight: 150, markedPb: true }]);
    const check = liftPbChecker(loggedLifts([a, b]));
    expect(check(U, 'b', b.started_at, b.exercises)).toBeNull();
  });

  it('does not let a later, heavier lift take an earlier PB away', () => {
    const a = act('a', 1, [{ name: 'Squat', weight: 100 }]);
    const b = act('b', 2, [{ name: 'Squat', weight: 120 }]);
    const c = act('c', 3, [{ name: 'Squat', weight: 140 }]);
    const check = liftPbChecker(loggedLifts([a, b, c]));
    expect(check(U, 'b', b.started_at, b.exercises)?.weightKg).toBe(120);
  });
});
