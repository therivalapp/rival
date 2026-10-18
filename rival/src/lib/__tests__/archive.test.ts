import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../exportData', () => ({ buildDataExport: vi.fn() }));
import { parseCsv, parseStravaDate } from '../archive';

describe('parseCsv', () => {
  it('handles quoted commas, quotes and newlines', () => {
    const rows = parseCsv('Activity ID,Activity Name,Distance\n1,"Run, easy","5.0"\n2,"Say ""hi""\nthen go",3\n');
    expect(rows).toEqual([['Activity ID', 'Activity Name', 'Distance'], ['1', 'Run, easy', '5.0'], ['2', 'Say "hi"\nthen go', '3']]);
  });
});

describe('parseStravaDate', () => {
  it('reads Strava export dates as UTC', () => {
    expect(parseStravaDate('Oct 17, 2026, 7:02:32 AM')).toBe('2026-10-17T07:02:32.000Z');
    expect(parseStravaDate('Jun 6, 2026, 2:49:31 PM')).toBe('2026-06-06T14:49:31.000Z');
    expect(parseStravaDate('Jan 1, 2025, 12:05:00 AM')).toBe('2025-01-01T00:05:00.000Z');
  });
  it('rejects anything else', () => { expect(parseStravaDate('yesterday')).toBeNull(); });
});
