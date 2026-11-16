import { describe, expect, it } from 'vitest';
import { inkNudge } from '../inkCentre';

describe('inkNudge', () => {
  it('leaves plain numbers where they are', () => {
    expect(inkNudge('0', 60)).toBe(0);
    expect(Math.abs(inkNudge('12', 60))).toBeLessThan(1);
  });
  it('moves a dropping 7 up and a rising 6 down', () => {
    expect(inkNudge('7', 60)).toBeLessThan(-4);
    expect(inkNudge('6', 60)).toBeGreaterThan(4);
  });
  it('treats a number with both as full height', () => {
    expect(Math.abs(inkNudge('998', 60))).toBeLessThan(1);
  });
  it('ignores words', () => {
    expect(inkNudge('Final', 60)).toBe(0);
  });
});
