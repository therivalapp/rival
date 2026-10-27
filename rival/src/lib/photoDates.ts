// When each picked photo was taken, so Upload can tell photos from several
// days apart and offer to scan them as separate activities (Ricky,
// 2026-10-25, mockups approved). The camera's own date (EXIF
// DateTimeOriginal) is used when the photo has one; screenshots and photos
// without it fall back to the file's date. Pure byte parsing, so tested.

/** The EXIF DateTimeOriginal of a JPEG, as a local date, or null. */
export function exifDate(bytes: Uint8Array): Date | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1 && i + 10 <= bytes.length
      && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
      return tiffDate(bytes, i + 10, Math.min(bytes.length, i + 2 + len));
    }
    if (marker === 0xda) return null; // image data starts: no EXIF before it
    i += 2 + len;
  }
  return null;
}

function tiffDate(b: Uint8Array, start: number, end: number): Date | null {
  if (start + 8 > end) return null;
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  const u16 = (o: number) => (o + 2 > end ? -1 : little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (o + 4 > end ? -1
    : little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const readIfd = (offset: number, want: number): number => {
    const at = start + offset;
    const n = u16(at);
    if (n < 0 || n > 500) return -1;
    for (let k = 0; k < n; k++) {
      const e = at + 2 + k * 12;
      if (u16(e) === want) return e;
    }
    return -1;
  };
  const ifd0 = u32(start + 4);
  if (ifd0 < 0) return null;
  // The Exif sub-IFD holds DateTimeOriginal (0x9003); IFD0's DateTime
  // (0x0132) is the fallback.
  const exifPtr = readIfd(ifd0, 0x8769);
  let entry = -1;
  if (exifPtr >= 0) {
    const sub = u32(exifPtr + 8);
    if (sub >= 0) entry = readIfd(sub, 0x9003);
  }
  if (entry < 0) entry = readIfd(ifd0, 0x0132);
  if (entry < 0) return null;
  const count = u32(entry + 4);
  const valueAt = start + u32(entry + 8);
  if (count < 19 || valueAt + 19 > end) return null;
  return parseExifStamp(String.fromCharCode(...b.slice(valueAt, valueAt + 19)));
}

/** "2026:10:20 18:04:31" as a local date. */
export function parseExifStamp(s: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) || +m[1] < 1990 ? null : d;
}

/** The local day of a date, as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Photos grouped by the day they were taken, oldest day first. */
export function groupByDay<T>(items: T[], dateOf: (item: T) => Date): { day: string; date: Date; items: T[] }[] {
  const groups = new Map<string, { day: string; date: Date; items: T[] }>();
  for (const item of items) {
    const date = dateOf(item);
    const day = dayKey(date);
    const g = groups.get(day);
    if (g) g.items.push(item);
    else groups.set(day, { day, date: new Date(date.getFullYear(), date.getMonth(), date.getDate()), items: [item] });
  }
  return [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** When a picked file was taken: its EXIF date, else the file's own date. */
export async function takenAt(file: Blob & { lastModified?: number }): Promise<Date> {
  try {
    const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    const d = exifDate(head);
    if (d) return d;
  } catch {}
  return new Date(file.lastModified ?? Date.now());
}
