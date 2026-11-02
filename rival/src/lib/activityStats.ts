import { metresBetween, type TrackPoint } from './liveTrack';

// Which numbers each activity shows at Finish, and the ones worked out from a
// recording (Ricky, 2026-11-02: design/activity-stats-map.png,
// design/finish-special-mockup.png, design/finish-ski-crossfit-mockup.png,
// design/crossfit-live-mockup.png). Pure functions; the screens are in
// app/start.tsx and components/rival/LiveFinishExtras.tsx.

export type StatFamily =
  | 'run' | 'walk' | 'ride' | 'swim' | 'row' | 'board' | 'weights' | 'classes' | 'mind' | 'machine'
  | 'racket' | 'team' | 'downhill' | 'touring' | 'wheels' | 'golf' | 'climb' | 'combat' | 'other';

const FAMILIES: [StatFamily, string[]][] = [
  ['run', ['Run', 'TrailRun', 'VirtualRun', 'TrackAndField']],
  ['walk', ['Walk', 'Hike', 'Snowshoe']],
  ['ride', ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide', 'Handcycle', 'Velomobile']],
  ['swim', ['Swim']],
  ['row', ['Rowing', 'VirtualRow', 'Kayaking', 'Canoeing', 'StandUpPaddling']],
  ['board', ['Surfing', 'Kitesurf', 'Windsurf', 'Sail']],
  ['weights', ['WeightTraining', 'Calisthenics', 'Gymnastics']],
  ['classes', ['CrossFit', 'Hyrox', 'HIIT', 'Bootcamp', 'Workout']],
  ['mind', ['Yoga', 'Pilates']],
  ['machine', ['Elliptical', 'StairStepper']],
  ['racket', ['Tennis', 'Squash', 'Pickleball', 'Badminton', 'TableTennis', 'Racquetball']],
  ['team', ['Basketball', 'Football', 'Soccer', 'Rugby', 'Cricket', 'Volleyball', 'Handball', 'FieldHockey', 'IceHockey', 'Lacrosse', 'Frisbee']],
  ['downhill', ['AlpineSki', 'Snowboard']],
  ['touring', ['BackcountrySki', 'NordicSki', 'RollerSki']],
  ['wheels', ['InlineSkate', 'Skateboard', 'IceSkate', 'Wheelchair']],
  ['golf', ['Golf']],
  ['climb', ['RockClimbing']],
  ['combat', ['MartialArts', 'Fencing']],
];
const FAMILY_OF = new Map(FAMILIES.flatMap(([f, types]) => types.map((t) => [t, f] as const)));

export function statFamily(activityType: string): StatFamily {
  return FAMILY_OF.get(activityType) ?? 'other';
}

/** The activities Start offers: the phone is on you and seeing it live adds
 *  something, a route, the lifts or the runs (Ricky, 2026-11-02). Everything
 *  else is logged afterwards in Log an activity, or arrives from a watch
 *  through Apple Health or Garmin: nobody presses Start before a rugby game
 *  or takes a phone into the pool. */
export const START_TYPES = new Set([
  'Run', 'TrailRun', 'Walk', 'Hike', 'Snowshoe',
  'Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide',
  'AlpineSki', 'Snowboard', 'BackcountrySki', 'NordicSki',
  'WeightTraining', 'Calisthenics', 'Workout', 'HIIT', 'Bootcamp', 'CrossFit', 'Hyrox',
]);

/** Speed in km/h rather than pace (Ricky: "speed, never pace" on a ride). */
export function showsSpeed(f: StatFamily): boolean {
  return f === 'ride' || f === 'board' || f === 'wheels' || f === 'downhill';
}

// ---- Numbers from a watch, a sensor or typed in --------------------------------

/** A CrossFit workout's shape, picked after Start. */
export type WodFormat = 'amrap' | 'fortime' | 'emom' | 'lifts' | 'race';
export type Wod = {
  format: WodFormat; minutes?: number | null; movements?: { name: string; reps?: number | null }[];
  /** HYROX: Open, Pro, Doubles or Relay. */
  division?: string | null;
  /** HYROX: a tap in and out of the Roxzone too, so transitions are timed. */
  roxzone?: boolean;
};

/** A CrossFit score: rounds plus reps, a time, a weight or a rep count. */
export type Score = { kind: 'rounds' | 'time' | 'weight' | 'reps'; rounds?: number; reps?: number; seconds?: number; kg?: number; rx?: boolean; workout?: string };

/** A match result, typed in at Finish. `sets` holds [you, them] per set, or
 *  one pair for a team score. A teammate picked as the opponent is tagged on
 *  save, like a training partner, and gets the result turned round on their
 *  own copy (supabase/mirror_match_result.sql). */
export type MatchResult = { outcome: 'won' | 'lost' | 'drawn'; opponent?: string; opponentId?: string | null; sets: [number, number][] };

/** Everything beyond the columns activities already has, kept in its stats
 *  column (supabase/add_activity_stats.sql). Device numbers arrive once
 *  Apple Health or a Garmin file feeds them; until then they are absent and
 *  their tiles are left out. */
export type ActivityStats = {
  elapsedSeconds?: number;
  steps?: number;
  floors?: number;
  distanceM?: number;
  maxPower?: number;
  weightedPower?: number;
  workKj?: number;
  cadenceRpm?: number;
  strokeRate?: number;
  strokes?: number;
  lengths?: number;
  poolM?: number;
  swolf?: number;
  restSeconds?: number;
  /** Seconds for each 100 m of a swim, and its main stroke and SWOLF. */
  laps100?: number[];
  laps100Strokes?: string[];
  laps100Swolf?: number[];
  strokeTypes?: { name: string; metres: number }[];
  lowestBpm?: number;
  pushes?: number;
  holes?: number;
  golfScore?: number;
  routes?: number;
  topGrade?: string;
  wod?: Wod;
  /** Recorded seconds at each Round (or HYROX Next) tap. */
  laps?: number[];
  score?: Score;
  result?: MatchResult;
};

// ---- Worked out from the route -----------------------------------------------

const RUN_DROP = 30; // metres before a change of direction counts as a new run or lift

export type SkiRun = { descent: number; seconds: number; topKmh: number; from: number; to: number };
export type SkiDay = {
  runs: SkiRun[]; descent: number; ascent: number; skiSeconds: number; liftSeconds: number; highest: number | null;
  /** Live: on a lift now, and for how long this lift or run has gone on. */
  lift: boolean; legSeconds: number;
};

/** Each descent on a ski day, from the altitude: a turn needs 30 m either way,
 *  so a bump in a run or a flat bit of a lift doesn't split it. */
export function skiRuns(track: TrackPoint[]): SkiDay {
  const pts = track.filter((p) => p.alt != null);
  const alt = (i: number) => pts[i].alt as number;
  const legs: { from: number; to: number; down: boolean }[] = [];
  let dir = 0, turn = 0, ext = 0, hi = 0, lo = 0;
  for (let i = 1; i < pts.length; i++) {
    if (dir === 0) {
      if (alt(i) > alt(hi)) hi = i;
      if (alt(i) < alt(lo)) lo = i;
      if (alt(hi) - alt(i) >= RUN_DROP) { dir = -1; turn = hi; ext = i; } else if (alt(i) - alt(lo) >= RUN_DROP) { dir = 1; turn = lo; ext = i; }
    } else if (dir === -1) {
      if (alt(i) < alt(ext)) ext = i;
      else if (alt(i) - alt(ext) >= RUN_DROP) { legs.push({ from: turn, to: ext, down: true }); turn = ext; ext = i; dir = 1; }
    } else {
      if (alt(i) > alt(ext)) ext = i;
      else if (alt(ext) - alt(i) >= RUN_DROP) { legs.push({ from: turn, to: ext, down: false }); turn = ext; ext = i; dir = -1; }
    }
  }
  if (dir !== 0 && Math.abs(alt(ext) - alt(turn)) >= RUN_DROP) legs.push({ from: turn, to: ext, down: dir === -1 });
  const runs: SkiRun[] = [];
  let ascent = 0, liftSeconds = 0;
  for (const l of legs) {
    const seconds = pts[l.to].s - pts[l.from].s;
    if (!l.down) { ascent += alt(l.to) - alt(l.from); liftSeconds += seconds; continue; }
    let top = 0;
    for (let i = l.from + 1; i <= l.to; i++) {
      const dt = pts[i].s - pts[i - 1].s;
      if (dt >= 1) top = Math.max(top, (metresBetween(pts[i - 1], pts[i]) / dt) * 3.6);
    }
    runs.push({ descent: Math.round(alt(l.from) - alt(l.to)), seconds: Math.round(seconds), topKmh: Math.round(top * 10) / 10, from: l.from, to: l.to });
  }
  return {
    runs,
    descent: runs.reduce((n, r) => n + r.descent, 0),
    ascent: Math.round(ascent),
    skiSeconds: Math.round(runs.reduce((n, r) => n + r.seconds, 0)),
    liftSeconds: Math.round(liftSeconds),
    highest: pts.length ? Math.round(Math.max(...pts.map((p) => p.alt as number))) : null,
    lift: dir === 1,
    legSeconds: pts.length ? Math.round(pts[pts.length - 1].s - pts[turn].s) : 0,
  };
}

/** Speed now, in km/h, over about the last `window` seconds. */
export function speedNow(track: TrackPoint[], window = 10): number | null {
  const last = track[track.length - 1];
  if (!last) return null;
  let d = 0, i = track.length - 1;
  while (i > 0 && last.s - track[i - 1].s <= window && (track[i - 1].seg ?? 0) === (last.seg ?? 0)) { d += metresBetween(track[i - 1], track[i]); i--; }
  const dt = last.s - track[i].s;
  return dt >= 3 ? Math.round((d / dt) * 3.6 * 10) / 10 : null;
}

/** The highest point reached, in metres. */
export function highestPoint(track: TrackPoint[]): number | null {
  const alts = track.map((p) => p.alt).filter((a): a is number => a != null);
  return alts.length ? Math.round(Math.max(...alts)) : null;
}

/** Fastest speed between two points a second or more apart, in km/h. */
export function topSpeed(track: TrackPoint[]): number | null {
  let top = 0;
  for (let i = 1; i < track.length; i++) {
    if ((track[i].seg ?? 0) !== (track[i - 1].seg ?? 0)) continue;
    const dt = track[i].s - track[i - 1].s;
    if (dt >= 1) top = Math.max(top, (metresBetween(track[i - 1], track[i]) / dt) * 3.6);
  }
  return top ? Math.round(top * 10) / 10 : null;
}

const WAVE_KMH = 10;
const WAVE_SECONDS = 4;

/** Waves caught on a surf: bursts above 10 km/h lasting 4 seconds or more,
 *  and the longest of them in metres. */
export function waves(track: TrackPoint[]): { count: number; longest: number } {
  let count = 0, longest = 0, start = -1, metres = 0;
  const close = (end: number) => {
    if (start >= 0 && track[end].s - track[start].s >= WAVE_SECONDS) { count++; longest = Math.max(longest, metres); }
    start = -1; metres = 0;
  };
  for (let i = 1; i < track.length; i++) {
    const dt = track[i].s - track[i - 1].s;
    const d = metresBetween(track[i - 1], track[i]);
    const fast = dt > 0 && (d / dt) * 3.6 >= WAVE_KMH && (track[i].seg ?? 0) === (track[i - 1].seg ?? 0);
    if (fast) { if (start < 0) start = i - 1; metres += d; } else if (start >= 0) close(i - 1);
  }
  if (start >= 0) close(track.length - 1);
  return { count, longest: Math.round(longest) };
}

// ---- Rounds and HYROX -----------------------------------------------------------

/** Seconds for each round, from the recorded seconds at each tap. */
export function roundTimes(laps: number[]): number[] {
  return laps.map((t, i) => Math.max(0, Math.round(t - (i ? laps[i - 1] : 0))));
}

export const HYROX_STATIONS = ['SkiErg 1,000 m', 'Sled push 50 m', 'Sled pull 50 m', 'Burpee broad jumps', 'Row 1,000 m', 'Farmers carry', 'Sandbag lunges', 'Wall balls'];

export type HyroxPart = { kind: 'run' | 'station' | 'rox'; n: number; name: string };

/** A HYROX race in order: a 1 km run, then a station, eight times. With the
 *  Roxzone timed, the walk into and out of each station is a part too. */
export function hyroxParts(rox = false): HyroxPart[] {
  const out: HyroxPart[] = [];
  HYROX_STATIONS.forEach((station, k) => {
    const n = k + 1;
    out.push({ kind: 'run', n, name: `Run ${n}` });
    if (rox) out.push({ kind: 'rox', n, name: 'Roxzone' });
    out.push({ kind: 'station', n, name: station });
    if (rox && n < HYROX_STATIONS.length) out.push({ kind: 'rox', n, name: 'Roxzone' });
  });
  return out;
}

export function hyroxPart(i: number, rox = false): HyroxPart {
  const parts = hyroxParts(rox);
  return parts[Math.min(i, parts.length - 1)];
}

/** Each station with the run before it, from the taps. */
export function hyroxSplits(laps: number[], rox = false): { station: string; n: number; run: number | null; time: number | null }[] {
  const t = roundTimes(laps);
  const parts = hyroxParts(rox);
  return HYROX_STATIONS.map((station, k) => {
    const at = (kind: HyroxPart['kind']) => t[parts.findIndex((p) => p.kind === kind && p.n === k + 1)] ?? null;
    return { station, n: k + 1, run: at('run'), time: at('station') };
  }).filter((r) => r.run != null);
}

export function hyroxTotals(laps: number[], rox = false): { running: number; stations: number; roxzone: number } {
  const t = roundTimes(laps);
  const parts = hyroxParts(rox);
  const sum = (kind: HyroxPart['kind']) => t.reduce((a, x, i) => a + (parts[i]?.kind === kind ? x : 0), 0);
  return { running: sum('run'), stations: sum('station'), roxzone: sum('rox') };
}

/** "12 rounds + 8", "18:42", "100 kg" or "150 reps". */
export function scoreText(sc: Score, clock: (s: number) => string, weight: (kg: number) => string): string {
  if (sc.kind === 'time') return clock(sc.seconds ?? 0);
  if (sc.kind === 'weight') return weight(sc.kg ?? 0);
  if (sc.kind === 'reps') return `${sc.reps ?? 0} reps`;
  const r = sc.rounds ?? 0;
  return `${r} ${r === 1 ? 'round' : 'rounds'}${sc.reps ? ` + ${sc.reps}` : ''}`;
}

export const WOD_LABEL: Record<WodFormat, string> = { amrap: 'AMRAP', fortime: 'For time', emom: 'EMOM', lifts: 'Lifts', race: 'Race' };
