import { describe, expect, it } from 'vitest';
import { highestPoint, hyroxPart, hyroxParts, hyroxSplits, hyroxTotals, roundTimes, scoreText, skiRuns, speedNow, statFamily, topSpeed, waves } from '../activityStats';
import type { TrackPoint } from '../liveTrack';

const DEG = 1 / 111195;
// One point a second, moving north `step` metres each time, at these altitudes.
const path = (alts: number[], step = 10): TrackPoint[] => alts.map((alt, i) => ({ lat: i * step * DEG, lon: 0, s: i, alt }));

describe('activityStats', () => {
  it('groups activity types', () => {
    expect(statFamily('TrailRun')).toBe('run');
    expect(statFamily('Hike')).toBe('walk');
    expect(statFamily('Snowboard')).toBe('downhill');
    expect(statFamily('Hyrox')).toBe('classes');
    expect(statFamily('Unknown')).toBe('other');
  });

  it('finds each ski run and leaves the lifts out', () => {
    // Up 400 m on a lift, down 300 m, up 200 m, down 350 m. A 10 m bump mid-run is ignored.
    const alts = [1600, 1800, 2000, 1900, 1810, 1820, 1700, 1800, 1900, 1750, 1550];
    const day = skiRuns(path(alts));
    expect(day.runs.map((r) => r.descent)).toEqual([300, 350]);
    expect(day.descent).toBe(650);
    expect(day.ascent).toBe(600);
    expect(day.liftSeconds).toBe(4);
    expect(day.skiSeconds).toBe(6);
    expect(day.highest).toBe(2000);
    expect(day.runs[0].topKmh).toBeCloseTo(36, 0);
    // The last leg is the 350 m run, so not on a lift.
    expect(day.lift).toBe(false);
    expect(skiRuns(path([1600, 1700, 1800, 1750, 1700, 1760, 1820])).lift).toBe(true);
  });

  it('reads speed now over the last few seconds', () => {
    expect(speedNow(path([0, 0, 0, 0, 0], 5))).toBeCloseTo(18, 0);
    expect(speedNow(path([0]))).toBeNull();
  });

  it('reads top speed and the highest point', () => {
    expect(topSpeed(path([0, 0, 0], 5))).toBeCloseTo(18, 0);
    expect(highestPoint(path([10, 40, 20]))).toBe(40);
    expect(highestPoint([{ lat: 0, lon: 0, s: 0 }])).toBeNull();
  });

  it('counts waves as bursts of speed', () => {
    // Paddling at 1 m/s, a 6 s ride at 5 m/s, paddling, a 2 s burst (too short).
    const steps = [1, 1, 5, 5, 5, 5, 5, 5, 1, 1, 5, 5, 1];
    let lat = 0;
    const pts: TrackPoint[] = [{ lat: 0, lon: 0, s: 0 }, ...steps.map((m, i) => ({ lat: (lat += m * DEG), lon: 0, s: i + 1 }))];
    expect(waves(pts)).toEqual({ count: 1, longest: 30 });
  });

  it('times rounds from the taps', () => {
    expect(roundTimes([91, 187, 286])).toEqual([91, 96, 99]);
  });

  it('pairs each HYROX station with the run before it', () => {
    expect(hyroxPart(0).name).toBe('Run 1');
    expect(hyroxPart(3).name).toBe('Sled push 50 m');
    const laps = [300, 560, 860];
    expect(hyroxSplits(laps)).toEqual([
      { station: 'SkiErg 1,000 m', n: 1, run: 300, time: 260 },
      { station: 'Sled push 50 m', n: 2, run: 300, time: null },
    ]);
    expect(hyroxTotals(laps)).toEqual({ running: 600, stations: 260, roxzone: 0 });
  });

  it('times the Roxzone when asked, 31 parts in all', () => {
    expect(hyroxParts(true)).toHaveLength(31);
    expect(hyroxParts(false)).toHaveLength(16);
    expect(hyroxPart(1, true).name).toBe('Roxzone');
    // Run 300, in 30, SkiErg 260, out 20, run 310.
    const laps = [300, 330, 590, 610, 920];
    expect(hyroxTotals(laps, true)).toEqual({ running: 610, stations: 260, roxzone: 50 });
    expect(hyroxSplits(laps, true)[0]).toEqual({ station: 'SkiErg 1,000 m', n: 1, run: 300, time: 260 });
  });

  it('writes a score', () => {
    const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const kg = (n: number) => `${n} kg`;
    expect(scoreText({ kind: 'rounds', rounds: 12, reps: 8 }, clock, kg)).toBe('12 rounds + 8');
    expect(scoreText({ kind: 'rounds', rounds: 1 }, clock, kg)).toBe('1 round');
    expect(scoreText({ kind: 'time', seconds: 1122 }, clock, kg)).toBe('18:42');
    expect(scoreText({ kind: 'weight', kg: 100 }, clock, kg)).toBe('100 kg');
  });
});
