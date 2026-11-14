import { describe, expect, it } from 'vitest';
import { passwordOk, passwordRules } from '../passwordRules';

describe('passwordRules', () => {
  it('ticks only length and number for 12345678', () => {
    expect(passwordRules('12345678').map((r) => r.met)).toEqual([true, false, true, false]);
  });
  it('needs both upper and lowercase letters', () => {
    expect(passwordRules('ABCDEFG1!')[1].met).toBe(false);
    expect(passwordRules('abcdefg1!')[1].met).toBe(false);
    expect(passwordRules('Abcdefg1!')[1].met).toBe(true);
  });
  it('uses Supabase symbols only', () => {
    expect(passwordRules('Abcdefg1]')[3].met).toBe(true);
    expect(passwordRules('Abcdefg1\\')[3].met).toBe(true);
    expect(passwordRules('Abcdefg1 ')[3].met).toBe(false);
    expect(passwordRules('Abcdefg1£')[3].met).toBe(false);
  });
  it('passes only when all are met', () => {
    expect(passwordOk('Abcdef1!')).toBe(true);
    expect(passwordOk('Abcde1!')).toBe(false);
    expect(passwordOk('ABCDEF1!')).toBe(false);
  });
});
