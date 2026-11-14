import { describe, expect, it } from 'vitest';
import { looksAustralian } from '../minimumAge';

describe('looksAustralian', () => {
  it('reads an Australian time zone', () => {
    expect(looksAustralian('Australia/Sydney', 'en-CA')).toBe(true);
    expect(looksAustralian('Australia/Perth')).toBe(true);
  });
  it('reads an Australian region setting', () => {
    expect(looksAustralian('America/Vancouver', 'en-AU')).toBe(true);
    expect(looksAustralian(undefined, 'zh-Hans-AU')).toBe(true);
  });
  it('leaves everyone else at 13', () => {
    expect(looksAustralian('Pacific/Auckland', 'en-NZ')).toBe(false);
    expect(looksAustralian('America/Vancouver', 'en-CA')).toBe(false);
    expect(looksAustralian(undefined, 'en-AUTO')).toBe(false);
  });
});
