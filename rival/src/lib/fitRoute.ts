// Reads the GPS points out of a FIT file (what Garmin and most watches record).
// Only the record messages matter here, so everything else is stepped over
// using the file's own definitions.

const RECORD_MESSAGE = 20;
const FIELD_LAT = 0;
const FIELD_LNG = 1;
const NO_POSITION = 0x7fffffff;
const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;

type FieldDef = { num: number; size: number };
type MessageDef = { global: number; littleEndian: boolean; fields: FieldDef[]; devBytes: number };

/** [[lat, lng], ...] from a FIT file. Throws if the file isn't one. */
export function fitPoints(bytes: Uint8Array): [number, number][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const points: [number, number][] = [];
  let start = 0;
  // A file can hold several FIT files one after another.
  while (start + 12 <= bytes.length) {
    const headerSize = bytes[start];
    if (String.fromCharCode(...bytes.subarray(start + 8, start + 12)) !== '.FIT') {
      if (start === 0) throw new Error('not_a_fit_file');
      break;
    }
    const dataEnd = Math.min(bytes.length, start + headerSize + view.getUint32(start + 4, true));
    const defs = new Map<number, MessageDef>();
    let i = start + headerSize;
    while (i < dataEnd) {
      const head = bytes[i++];
      const compressedTime = (head & 0x80) !== 0;
      if (!compressedTime && (head & 0x40)) {
        // Definition: says how later messages of this local type are laid out.
        const littleEndian = bytes[i + 1] === 0;
        const global = view.getUint16(i + 2, littleEndian);
        const count = bytes[i + 4];
        i += 5;
        const fields: FieldDef[] = [];
        for (let f = 0; f < count; f++) fields.push({ num: bytes[i + f * 3], size: bytes[i + f * 3 + 1] });
        i += count * 3;
        let devBytes = 0;
        if (head & 0x20) {
          const devCount = bytes[i++];
          for (let f = 0; f < devCount; f++) devBytes += bytes[i + f * 3 + 1];
          i += devCount * 3;
        }
        defs.set(head & 0x0f, { global, littleEndian, fields, devBytes });
        continue;
      }
      const def = defs.get(compressedTime ? (head >> 5) & 0x03 : head & 0x0f);
      if (!def) throw new Error('bad_fit_file');
      let lat: number | null = null;
      let lng: number | null = null;
      for (const field of def.fields) {
        if (def.global === RECORD_MESSAGE && field.size === 4 && (field.num === FIELD_LAT || field.num === FIELD_LNG) && i + 4 <= bytes.length) {
          const raw = view.getInt32(i, def.littleEndian);
          if (raw !== NO_POSITION) {
            if (field.num === FIELD_LAT) lat = raw * SEMICIRCLES_TO_DEGREES;
            else lng = raw * SEMICIRCLES_TO_DEGREES;
          }
        }
        i += field.size;
      }
      i += def.devBytes;
      if (lat !== null && lng !== null) points.push([lat, lng]);
    }
    start = dataEnd + 2; // past the file's checksum
  }
  return points;
}
