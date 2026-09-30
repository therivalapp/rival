import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAG_WINDOW_HOURS, withinTagWindow } from '../tagWindow';

// The window is enforced by the database's insert policy; this is the copy the
// UI uses to avoid offering an option it knows will be refused. The two have to
// agree, so the edges are worth pinning down.

const HOUR = 60 * 60 * 1000;

function agedHours(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

afterEach(() => { vi.useRealTimers(); });

describe('withinTagWindow', () => {
  it('accepts a session from this morning', () => {
    expect(withinTagWindow(agedHours(3))).toBe(true);
  });

  it('accepts one just inside the window', () => {
    expect(withinTagWindow(agedHours(TAG_WINDOW_HOURS - 0.5))).toBe(true);
  });

  it('refuses one just outside it', () => {
    expect(withinTagWindow(agedHours(TAG_WINDOW_HOURS + 0.5))).toBe(false);
  });

  it('refuses last month', () => {
    expect(withinTagWindow(agedHours(24 * 30))).toBe(false);
  });

  // A watch with a wrong clock, or a timezone mishandled upstream, can land an
  // activity slightly in the future. Treating that as "0 hours old" would be
  // fine; treating it as eligible forever would not, so the check is a range
  // rather than a maximum.
  it('refuses a session dated in the future', () => {
    expect(withinTagWindow(new Date(Date.now() + 2 * HOUR).toISOString())).toBe(false);
  });
});
