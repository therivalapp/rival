import { describe, it, expect } from 'vitest';
import { isoToDisplayDate, displayToIsoDate, maskDateInput } from '../dateFormat';

describe('displayToIsoDate', () => {
  it('accepts DD/MM/YYYY', () => {
    expect(displayToIsoDate('25/12/2026')).toBe('2026-12-25');
    expect(displayToIsoDate('01/01/2026')).toBe('2026-01-01');
  });

  it('pads single-digit months and days', () => {
    expect(displayToIsoDate('1/1/2026')).toBe('2026-01-01');
  });

  it('rejects impossible dates', () => {
    expect(displayToIsoDate('31/02/2026')).toBeNull(); // Feb 31
    expect(displayToIsoDate('29/02/2026')).toBeNull(); // 2026 not a leap year
    expect(displayToIsoDate('00/06/2026')).toBeNull();
    expect(displayToIsoDate('32/01/2026')).toBeNull();
    expect(displayToIsoDate('15/13/2026')).toBeNull();
  });

  it('accepts leap-day on real leap years', () => {
    expect(displayToIsoDate('29/02/2028')).toBe('2028-02-29');
  });

  it('rejects malformed input', () => {
    expect(displayToIsoDate('2026-12-25')).toBeNull(); // year first
    expect(displayToIsoDate('')).toBeNull();
    expect(displayToIsoDate('banana')).toBeNull();
  });
});

describe('isoToDisplayDate', () => {
  it('shows a stored date day first', () => {
    expect(isoToDisplayDate('2026-12-25')).toBe('25/12/2026');
  });

  it('returns empty for an incomplete date', () => {
    expect(isoToDisplayDate('2026-12')).toBe('');
    expect(isoToDisplayDate('')).toBe('');
  });

  it('round-trips with displayToIsoDate', () => {
    for (const iso of ['2026-01-01', '2026-12-31', '2028-02-29']) {
      expect(displayToIsoDate(isoToDisplayDate(iso)!)).toBe(iso);
    }
  });
});

describe('maskDateInput', () => {
  it('inserts separators as digits are typed', () => {
    expect(maskDateInput('2')).toBe('2');
    expect(maskDateInput('25')).toBe('25');
    expect(maskDateInput('251')).toBe('25/1');
    expect(maskDateInput('25122')).toBe('25/12/2');
    expect(maskDateInput('25122026')).toBe('25/12/2026');
  });

  it('ignores separators the user types themselves', () => {
    expect(maskDateInput('25/12/2026')).toBe('25/12/2026');
    expect(maskDateInput('25-12-2026')).toBe('25/12/2026');
  });

  it('drops anything past eight digits', () => {
    expect(maskDateInput('251220269999')).toBe('25/12/2026');
  });

  it('collapses cleanly when backspacing onto a separator', () => {
    expect(maskDateInput('25/12/')).toBe('25/12');
    expect(maskDateInput('25/')).toBe('25');
  });

  it('produces something displayToIsoDate accepts', () => {
    expect(displayToIsoDate(maskDateInput('25122026'))).toBe('2026-12-25');
  });
});
