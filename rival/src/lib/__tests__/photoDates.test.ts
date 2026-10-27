import { describe, expect, it } from 'vitest';
import { dayKey, exifDate, groupByDay, parseExifStamp } from '../photoDates';

// A minimal JPEG: SOI, an APP1 Exif segment with IFD0 → Exif IFD →
// DateTimeOriginal, then SOS.
function jpegWithDate(stamp: string, little = true): Uint8Array {
  const tiff: number[] = [];
  const w16 = (v: number) => (little ? tiff.push(v & 0xff, v >> 8) : tiff.push(v >> 8, v & 0xff));
  const w32 = (v: number) => (little
    ? tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff)
    : tiff.push((v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff));
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]));
  w16(42); w32(8);
  // IFD0 at 8: one entry, the Exif pointer.
  w16(1); w16(0x8769); w16(4); w32(1); w32(26); w32(0);
  // Exif IFD at 26: one entry, DateTimeOriginal (ASCII, 20 bytes at 44).
  w16(1); w16(0x9003); w16(2); w32(20); w32(44); w32(0);
  for (const ch of stamp) tiff.push(ch.charCodeAt(0));
  tiff.push(0);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xda, 0, 2]);
}

describe('photo dates', () => {
  it('reads DateTimeOriginal, either byte order', () => {
    expect(exifDate(jpegWithDate('2026:10:20 18:04:31'))?.getTime()).toBe(new Date(2026, 9, 20, 18, 4, 31).getTime());
    expect(exifDate(jpegWithDate('2026:10:22 07:15:00', false))?.getTime()).toBe(new Date(2026, 9, 22, 7, 15, 0).getTime());
  });

  it('gives null for files without one', () => {
    expect(exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // a PNG
    expect(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(parseExifStamp('0000:00:00 00:00:00')).toBeNull();
  });

  it('groups photos by the day they were taken, oldest first', () => {
    const photos = [
      { id: 'a', at: new Date(2026, 9, 25, 9, 0) },
      { id: 'b', at: new Date(2026, 9, 20, 18, 0) },
      { id: 'c', at: new Date(2026, 9, 25, 9, 30) },
    ];
    const groups = groupByDay(photos, (p) => p.at);
    expect(groups.map((g) => g.day)).toEqual(['2026-10-20', '2026-10-25']);
    expect(groups[1].items.map((p) => p.id)).toEqual(['a', 'c']);
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
