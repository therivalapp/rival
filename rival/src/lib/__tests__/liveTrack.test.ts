import { describe, expect, it } from 'vitest';
import { currentPace, elevationGain, fastestEfforts, metresBetween, paceClock, splitBars, splits, trackDistance, type TrackPoint } from '../liveTrack';

// Due north along a meridian: 0.001 degrees of latitude is about 111.2 m.
const DEG = 1 / 111195;
const line = (metres: number[], secsPerKm = 300, alts?: number[]): TrackPoint[] =>
  metres.map((m, i) => ({ lat: m * DEG, lon: 0, s: (m / 1000) * secsPerKm, alt: alts?.[i] ?? null }));

describe('liveTrack', () => {
  it('measures straight-line steps', () => {
    expect(metresBetween({ lat: 0, lon: 0 }, { lat: 1000 * DEG, lon: 0 })).toBeCloseTo(1000, 0);
  });

  it('adds the steps up, but not the gap across a pause', () => {
    const pts = line([0, 500, 1000]);
    expect(trackDistance(pts)).toBeCloseTo(1000, 0);
    const paused = [...pts, { lat: 1500 * DEG, lon: 0, s: 400, seg: 1 }, { lat: 2000 * DEG, lon: 0, s: 550, seg: 1 }];
    expect(trackDistance(paused)).toBeCloseTo(1500, 0);
  });

  it('counts climbs past the noise and ignores small wobbles', () => {
    expect(elevationGain(line([0, 1, 2, 3, 4], 300, [10, 12, 11, 13, 20]))).toBe(10);
    expect(elevationGain(line([0, 1, 2], 300, [10, 12, 10]))).toBe(0);
  });

  it('splits each kilometre with its time and climb', () => {
    const pts = line([0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2300], 300, [0, 0, 5, 5, 5, 5, 5, 5, 9, 9]);
    const r = splits(pts);
    expect(r.done.map((d) => d.seconds)).toEqual([300, 300]);
    expect(r.done.map((d) => d.gain)).toEqual([5, 4]);
    expect(r.into).toBeCloseTo(300, 0);
    expect(r.intoSeconds).toBe(90);
  });

  it('splits by the mile when asked', () => {
    expect(splits(line([0, 1000, 2000], 300), 1609.344).done).toHaveLength(1);
  });

  it('gives pace over the last stretch only', () => {
    const pts = [...line([0, 500], 360), ...line([1000], 360).map((p) => ({ ...p, s: 180 + 120 }))];
    expect(currentPace(pts)).toBeCloseTo(240, 0);
    expect(currentPace(line([0, 100]))).toBeNull();
  });

  it('prints pace as a clock', () => {
    expect(paceClock(286)).toBe('4:46');
    expect(paceClock(300, 1.609344)).toBe('8:03');
  });

  it('draws every split up to 12, with the part-kilometre last', () => {
    const metres = Array.from({ length: 93 }, (_, i) => i * 100).concat([9230]);
    const r = splitBars(line(metres, 300));
    expect(r.group).toBe(1);
    expect(r.bars).toHaveLength(10);
    expect(r.bars[9].label).toBe('0.23');
    expect(r.bars[9].part).toBeCloseTo(0.23, 2);
    expect(r.bars[0].pace).toBeCloseTo(300, 0);
  });

  it('groups long runs so there are never more than 12 bars', () => {
    const half = splitBars(line(Array.from({ length: 212 }, (_, i) => i * 100).concat([21100]), 300));
    expect(half.group).toBe(5);
    expect(half.bars.map((b) => b.label)).toEqual(['5', '10', '15', '20', '21.1']);
    expect(half.bars[4].part).toBeCloseTo(0.22, 2);
    const ultra = splitBars(line(Array.from({ length: 1001 }, (_, i) => i * 100), 360));
    expect(ultra.group).toBe(20);
    expect(ultra.bars).toHaveLength(5);
  });

  it('finds the quickest stretch of each distance inside the run', () => {
    // 2 km: the first at 5:00/km, the second at 4:00/km.
    const pts = [...line([0, 500, 1000], 300), ...line([1500, 2000], 240).map((p) => ({ ...p, s: 300 + (p.s - 240) }))];
    const [k1, k2, k5] = fastestEfforts(pts, [1000, 2000, 5000]);
    expect(k1).toBe(240);
    expect(k2).toBe(540);
    expect(k5).toBeNull();
  });
});
