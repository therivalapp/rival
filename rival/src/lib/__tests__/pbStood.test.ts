import { describe, expect, it } from 'vitest';
import { pbStoodText } from '../bestEfforts';

const day = 86400000;

describe('pbStoodText', () => {
  it('counts days, then weeks, months and years', () => {
    expect(pbStoodText(1 * day)).toBe('1 day');
    expect(pbStoodText(9 * day)).toBe('9 days');
    expect(pbStoodText(35 * day)).toBe('5 weeks');
    expect(pbStoodText(220 * day)).toBe('7 months');
    expect(pbStoodText(3 * 365 * day)).toBe('3 years');
  });
  it('never says zero', () => {
    expect(pbStoodText(2 * 3600000)).toBe('1 day');
  });
});
