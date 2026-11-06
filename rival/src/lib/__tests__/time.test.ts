import { describe, expect, it } from 'vitest';
import { formatTime, maskTime, parseTime, showFinish } from '../time';

describe('the time box', () => {
  it('fills like a stopwatch, showing every unit', () => {
    expect(maskTime('153')).toBe('00:01:53');
    expect(maskTime('15300')).toBe('01:53:00');
    expect(maskTime('01:53:00')).toBe('01:53:00');
    expect(maskTime('445', 'ms')).toBe('04:45');
    expect(maskTime('')).toBe('');
  });
});

describe('reading a time', () => {
  it('reads three parts as hours, minutes, seconds', () => {
    expect(parseTime('01:53:00')).toBe(6780);
    expect(parseTime('00:01:53')).toBe(113);
  });
  it('reads two parts as the place says', () => {
    expect(parseTime('1:53', 'hours')).toBe(6780);
    expect(parseTime('45:30', 'minutes')).toBe(2730);
  });
  it('gives null for anything that is not a time', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('00:00:00')).toBeNull();
  });
});

describe('showing a time', () => {
  it('shows finish times with hours, always', () => {
    expect(formatTime(6780, 'finish')).toBe('1:53:00');
    expect(formatTime(1361, 'finish')).toBe('0:22:41');
    expect(showFinish('1:53')).toBe('1:53:00');
  });
  it('shows clocks, paces and fields', () => {
    expect(formatTime(1361, 'clock')).toBe('22:41');
    expect(formatTime(285, 'pace')).toBe('4:45');
    expect(formatTime(6780, 'field')).toBe('01:53:00');
    expect(formatTime(285, 'field', 'ms')).toBe('04:45');
  });
});
