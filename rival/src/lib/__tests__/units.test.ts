import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}));

import { formatDistance, formatElevation, formatWeight, fromDisplayDistance, toDisplayDistance } from '../units';

describe('units', () => {
  it('shows metric as stored', () => {
    expect(formatDistance(11, 1, 'metric')).toBe('11.0 km');
    expect(formatElevation(1240, 'metric')).toBe('1,240 m');
    expect(formatWeight(100, 'metric')).toBe('100 kg');
  });

  it('converts to imperial for display', () => {
    expect(formatDistance(10, 1, 'imperial')).toBe('6.2 mi');
    expect(formatElevation(1000, 'imperial')).toBe('3,281 ft');
    expect(formatWeight(100, 'imperial')).toBe('220.5 lb');
  });

  it('round-trips a typed distance', () => {
    expect(fromDisplayDistance(toDisplayDistance(21.1, 'imperial'), 'imperial')).toBeCloseTo(21.1, 6);
    expect(fromDisplayDistance(5, 'metric')).toBe(5);
  });
});
