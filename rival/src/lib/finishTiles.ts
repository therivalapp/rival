import { showsSpeed, type ActivityStats, type SkiDay, type StatFamily } from './activityStats';
import { paceClock } from './liveTrack';
import { distanceUnit, elevationUnit, toDisplayDistance, toDisplayElevation, toDisplayWeight, weightUnit } from './units';

// The six tiles on Finish, per activity (Ricky, 2026-11-02:
// design/activity-stats-map.png and the Finish mockups). Each activity lists
// its numbers in order; the ones with no data are skipped, Effort goes in
// third (first where there are only a couple, or where it is the point, as
// in racket and team sports), and six is the most.

export type FinishTile = { value: string; unit?: string | null; name: string; effort?: boolean };

export type FinishNumbers = {
  family: StatFamily;
  activityType: string;
  /** The hero above the tiles; its own number isn't repeated as a tile. */
  hero: 'distance' | 'time' | 'descent';
  metres: number;
  seconds: number;
  climb: number;
  highest: number | null;
  topKmh: number | null;
  ski: SkiDay | null;
  waveCount: number | null;
  longestWave: number | null;
  effort: number | null;
  avgBpm?: number | null;
  maxBpm?: number | null;
  calories?: number | null;
  cadence?: number | null;
  avgPower?: number | null;
  stats: ActivityStats;
  lifts: { exercises: number; sets: number; heaviest: number; volume: number };
  /** HYROX runs done, in km, and the division raced. */
  hyroxKm?: number | null;
  division?: string | null;
};

const n = (v: number) => Math.round(v).toLocaleString();

export function finishTiles(v: FinishNumbers): FinishTile[] {
  const unitKm = distanceUnit() === 'mi' ? 1.609344 : 1;
  const per = ` /${distanceUnit()}`;
  const elevU = ` ${elevationUnit()}`;
  const speedU = distanceUnit() === 'mi' ? ' mph' : ' km/h';
  const st = v.stats;
  const metres = v.metres || st.distanceM || 0;
  const t = (value: string | null | undefined | false, name: string, unit?: string): FinishTile | null => (value ? { value, name, unit: unit ?? null } : null);
  const speed = (kmh: number) => (Math.round(toDisplayDistance(kmh) * 10) / 10).toFixed(1);

  const tiles: Record<string, FinishTile | null> = {
    distance: v.hero !== 'distance' && metres > 50 ? t(toDisplayDistance(metres / 1000).toFixed(1), 'DISTANCE', ` ${distanceUnit()}`) : null,
    covered: metres > 50 ? t(toDisplayDistance(metres / 1000).toFixed(1), 'COVERED', ` ${distanceUnit()}`) : null,
    pace: metres > 50 ? t(paceClock((v.seconds / metres) * 1000, unitKm), 'AVG PACE', per) : null,
    speed: metres > 50 && v.seconds ? t(speed((metres / v.seconds) * 3.6), 'AVG SPEED', speedU) : null,
    topSpeed: v.topKmh ? t(speed(v.topKmh), 'TOP SPEED', speedU) : null,
    elevation: v.climb > 0 || v.metres > 50 ? t(n(toDisplayElevation(v.climb)), 'ELEVATION', elevU) : null,
    skiElevation: v.ski ? t(n(toDisplayElevation(v.ski.ascent)), 'ELEVATION', elevU) : null,
    highest: v.highest != null ? t(n(toDisplayElevation(v.highest)), 'HIGHEST', elevU) : null,
    runs: v.ski ? t(String(v.ski.runs.length), v.ski.runs.length === 1 ? 'RUN' : 'RUNS') : null,
    pace100: metres > 50 ? t(paceClock((v.seconds / metres) * 100), 'AVG PACE', ' /100m') : null,
    pace500: metres > 50 ? t(paceClock((v.seconds / metres) * 500), 'AVG PACE', ' /500m') : null,
    lengths: st.lengths ? t(String(st.lengths), 'LENGTHS') : null,
    pool: st.poolM ? t(String(st.poolM), 'POOL', ' m') : null,
    swolf: st.swolf ? t(String(st.swolf), 'SWOLF') : null,
    strokeRate: st.strokeRate ? t(String(st.strokeRate), 'STROKE RATE') : null,
    power: v.avgPower ? t(n(v.avgPower), 'AVG POWER', ' W') : null,
    cadence: v.cadence ? t(String(v.cadence), v.family === 'ride' ? 'CADENCE · RPM' : 'CADENCE · SPM') : null,
    steps: st.steps ? t(n(st.steps), 'STEPS') : null,
    floors: st.floors ? t(String(st.floors), 'FLOORS') : null,
    waves: v.waveCount ? t(String(v.waveCount), v.waveCount === 1 ? 'WAVE' : 'WAVES') : null,
    longestRide: v.longestWave ? t(n(v.longestWave), 'LONGEST RIDE', ' m') : null,
    exercises: v.lifts.exercises ? t(String(v.lifts.exercises), v.lifts.exercises === 1 ? 'EXERCISE' : 'EXERCISES') : null,
    sets: v.lifts.sets ? t(String(v.lifts.sets), v.lifts.sets === 1 ? 'SET' : 'SETS') : null,
    heaviest: v.lifts.heaviest ? t(String(Math.round(toDisplayWeight(v.lifts.heaviest) * 10) / 10), 'HEAVIEST', ` ${weightUnit()}`) : null,
    volume: v.lifts.volume ? t(n(toDisplayWeight(v.lifts.volume)), 'VOLUME', ` ${weightUnit()}`) : null,
    hyroxRun: v.hyroxKm ? t(String(v.hyroxKm), 'RUN', ' km') : null,
    division: v.division ? t(v.division, 'DIVISION') : null,
    avgBpm: v.avgBpm ? t(String(Math.round(v.avgBpm)), 'AVG BPM') : null,
    maxBpm: v.maxBpm ? t(String(Math.round(v.maxBpm)), 'MAX BPM') : null,
    lowestBpm: st.lowestBpm ? t(String(st.lowestBpm), 'LOWEST BPM') : null,
    calories: v.calories ? t(n(v.calories), 'CALORIES') : null,
    pushes: st.pushes ? t(n(st.pushes), 'PUSHES') : null,
    holes: st.holes ? t(String(st.holes), 'HOLES') : null,
    golfScore: st.golfScore ? t(String(st.golfScore), 'SCORE') : null,
    routes: st.routes ? t(String(st.routes), 'ROUTES') : null,
    topGrade: st.topGrade ? t(st.topGrade, 'TOP GRADE') : null,
  };

  const kayak = ['Kayaking', 'Canoeing', 'StandUpPaddling'].includes(v.activityType);
  const hyrox = v.activityType === 'Hyrox' && !!v.hyroxKm;
  const lifting = ['exercises', 'sets', 'heaviest', 'volume'];
  const order: Record<StatFamily, string[]> = {
    run: ['pace', 'elevation', 'avgBpm', 'calories', 'cadence'],
    walk: ['elevation', 'steps', 'pace', 'highest', 'avgBpm', 'calories'],
    ride: ['speed', 'elevation', 'power', 'avgBpm', 'calories', 'topSpeed'],
    swim: ['pace100', 'lengths', 'avgBpm', 'calories', 'pool', 'swolf'],
    row: [kayak ? 'speed' : 'pace500', 'strokeRate', 'avgBpm', 'calories', 'power'],
    board: ['distance', 'topSpeed', 'waves', 'longestRide', 'avgBpm', 'calories'],
    weights: [...lifting, 'avgBpm', 'calories'],
    classes: hyrox ? ['hyroxRun', 'avgBpm', 'maxBpm', 'calories', 'division'] : [...lifting, 'avgBpm', 'calories'],
    mind: ['avgBpm', 'calories', 'lowestBpm'],
    machine: ['distance', 'floors', 'avgBpm', 'calories', 'steps'],
    racket: ['covered', 'avgBpm', 'maxBpm', 'calories', 'steps'],
    team: ['covered', 'topSpeed', 'avgBpm', 'calories', 'maxBpm'],
    // Highest point rather than height climbed, which only repeats metres skied
    // (Ricky, 2026-11-02: what Epic shows and people compare).
    downhill: v.ski ? ['runs', 'highest', 'topSpeed', 'distance', 'avgBpm', 'calories'] : ['distance', 'topSpeed', 'avgBpm', 'calories'],
    touring: ['elevation', 'avgBpm', 'calories', 'highest', 'pace'],
    wheels: ['speed', 'topSpeed', 'elevation', 'avgBpm', 'calories', 'pushes'],
    golf: ['holes', 'golfScore', 'distance', 'steps', 'calories'],
    climb: ['routes', 'topGrade', 'avgBpm', 'calories'],
    combat: ['avgBpm', 'calories', 'maxBpm'],
    other: [...lifting, 'pace', 'elevation', 'avgBpm', 'calories'],
  };
  const out = order[v.family].map((k) => tiles[k]).filter((x): x is FinishTile => !!x);
  if (v.effort != null) {
    const first = ['racket', 'team', 'mind', 'combat'].includes(v.family) || out.length <= 2;
    out.splice(first ? 0 : 2, 0, { value: n(v.effort), name: 'EFFORT', effort: true });
  }
  return out.slice(0, 6);
}

/** What the More details row says it holds, per activity. */
export function moreDetailsLine(f: StatFamily): string {
  if (f === 'downhill') return 'Every run, highest point, map, heart rate';
  if (f === 'swim') return 'Strokes, SWOLF, fastest efforts, every 100 m';
  if (f === 'classes') return 'Heart rate zones, every run split';
  if (f === 'racket' || f === 'team') return 'Heart rate zones, steps';
  if (showsSpeed(f)) return 'Heart rate, every split, speed and elevation';
  return 'Heart rate, fastest efforts, every split, pace and elevation';
}
