import { gzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../exportData', () => ({ buildDataExport: vi.fn() }));
import { routeFromFile } from '../archive';
import { fitPoints } from '../fitRoute';
import { decodePolyline } from '../polyline';

const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180);
const le32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, true); return [...b]; };
const be32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, false); return [...b]; };

function fitFile(body: number[]) {
  const header = [14, 16, 0, 0, ...le32(body.length), 0x2e, 0x46, 0x49, 0x54, 0, 0];
  return new Uint8Array([...header, ...body, 0, 0]);
}

// Local type 0: an unrelated message with one byte, as watches write first.
const otherDef = [0x40, 0, 0, 0, 0, 1, 3, 1, 0];
// Local type 1: records with a heart rate between latitude and longitude.
const recordDef = [0x41, 0, 0, 20, 0, 3, 0, 4, 0x85, 3, 1, 2, 1, 4, 0x85];
const record = (lat: number, lng: number) => [0x01, ...le32(semi(lat)), 150, ...le32(semi(lng))];

describe('fitPoints', () => {
  it('reads positions and steps over other messages', () => {
    const pts = fitPoints(fitFile([...otherDef, 0x00, 7, ...recordDef, ...record(49.7, -123.15), ...record(49.71, -123.16)]));
    expect(pts).toHaveLength(2);
    expect(pts[0][0]).toBeCloseTo(49.7, 5);
    expect(pts[1][1]).toBeCloseTo(-123.16, 5);
  });

  it('skips records with no GPS fix', () => {
    const noFix = [0x01, ...le32(0x7fffffff), 150, ...le32(0x7fffffff)];
    expect(fitPoints(fitFile([...recordDef, ...noFix, ...record(49.7, -123.15)]))).toHaveLength(1);
  });

  it('reads big-endian files', () => {
    const def = [0x40, 0, 1, 0, 20, 2, 0, 4, 0x85, 1, 4, 0x85];
    const pts = fitPoints(fitFile([...def, 0x00, ...be32(semi(-36.85)), ...be32(semi(174.76))]));
    expect(pts[0][0]).toBeCloseTo(-36.85, 5);
    expect(pts[0][1]).toBeCloseTo(174.76, 5);
  });

  it('reads compressed-timestamp records', () => {
    const def = [0x41, 0, 0, 20, 0, 2, 0, 4, 0x85, 1, 4, 0x85];
    const compressed = [0x80 | (1 << 5) | 3, ...le32(semi(49.7)), ...le32(semi(-123.15))];
    expect(fitPoints(fitFile([...def, ...compressed]))).toHaveLength(1);
  });

  it('skips developer fields', () => {
    const def = [0x60, 0, 0, 20, 0, 2, 0, 4, 0x85, 1, 4, 0x85, 1, 0, 2, 0];
    const rec = (lat: number) => [0x00, ...le32(semi(lat)), ...le32(semi(-123.15)), 9, 9];
    expect(fitPoints(fitFile([...def, ...rec(49.7), ...rec(49.8)])).map((p) => Math.round(p[0] * 10))).toEqual([497, 498]);
  });

  it('rejects anything else', () => {
    expect(() => fitPoints(new TextEncoder().encode('<gpx>not a fit file</gpx>'))).toThrow();
  });
});

describe('routeFromFile', () => {
  const file = fitFile([...recordDef, ...record(49.7, -123.15), ...record(49.71, -123.16)]);

  it('turns a gzipped FIT file into a stored route', () => {
    const route = routeFromFile('activities/123.fit.gz', gzipSync(file));
    expect(decodePolyline(route!)[1][0]).toBeCloseTo(49.71, 4);
  });

  it('still reads GPX', () => {
    const gpx = '<trkpt lat="49.7" lon="-123.15"></trkpt><trkpt lat="49.71" lon="-123.16"></trkpt>';
    expect(routeFromFile('activities/1.gpx', new TextEncoder().encode(gpx))).toBeTruthy();
  });

  it('gives no route for an indoor file', () => {
    expect(routeFromFile('activities/2.fit', fitFile([...otherDef, 0x00, 7]))).toBeNull();
  });
});
