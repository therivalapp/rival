// The route of an activity being recorded, and the numbers worked out from it
// (Ricky, 2026-11-02, design/live-run-mockup.png). Each point carries the
// seconds recorded when it was taken (pauses left out), so pace and splits
// ignore time spent stopped. Pure functions; nothing here records yet: points
// arrive once GPS is built.

export type TrackPoint = {
  lat: number;
  lon: number;
  /** Seconds recorded when the point was taken, pauses left out. */
  s: number;
  /** Metres above sea level, when the phone gives it. */
  alt?: number | null;
  /** Counts up on every resume, so the gap walked while paused isn't added. */
  seg?: number;
};

/** `gain` is metres climbed in the split; `net` its height change, up or
 *  down (Ricky, 2026-11-16: a downhill kilometre showed as a climb). */
export type Split = { n: number; seconds: number; gain: number; net: number };

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function metresBetween(a: Pick<TrackPoint, 'lat' | 'lon'>, b: Pick<TrackPoint, 'lat' | 'lon'>): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const joined = (a: TrackPoint, b: TrackPoint) => (a.seg ?? 0) === (b.seg ?? 0);

/** Metres covered, not counting the gap across a pause. */
export function trackDistance(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) if (joined(points[i - 1], points[i])) total += metresBetween(points[i - 1], points[i]);
  return total;
}

// Slower than this between two points is standing still (about 1.8 km/h).
const MOVING_SPEED = 0.5;

/** Seconds spent actually moving: the time between points that were covered
 *  faster than a slow walk. Sitting still adds nothing, though the clock runs
 *  (Ricky, 2026-11-16: 0:21 of moving time on the couch). */
export function movingSeconds(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!joined(a, b)) continue;
    const dt = b.s - a.s;
    if (dt > 0 && metresBetween(a, b) / dt >= MOVING_SPEED) total += dt;
  }
  return Math.round(total);
}

// Phone altitude wobbles by a few metres; climbs count once they pass this.
const CLIMB_NOISE = 3;
// Faster than this up or down is the phone correcting its height, not a hill:
// a steep hill run is well under 1 m a second (Ricky, 2026-11-16: +704 m in
// the first km of a flat-ish run).
const MAX_VERTICAL_SPEED = 1.5;
// Heights are averaged over this many seconds either side.
const ALT_SMOOTH_S = 15;

/** Each point's height with the phone's corrections taken out and its wobble
 *  averaged away; null where the phone gave none. Only the changes mean
 *  anything, not the level. */
export function smoothAltitudes(points: TrackPoint[]): (number | null)[] {
  const clean: (number | null)[] = [];
  let offset = 0;
  let prev: { alt: number; s: number } | null = null;
  for (const p of points) {
    if (p.alt == null) { clean.push(null); continue; }
    if (prev) {
      const dt = Math.max(1, p.s - prev.s);
      // A jump: carry on from the last good height.
      if (Math.abs(p.alt - prev.alt) > MAX_VERTICAL_SPEED * dt + 2) offset += prev.alt - p.alt;
    }
    prev = { alt: p.alt, s: p.s };
    clean.push(p.alt + offset);
  }
  const out: (number | null)[] = [];
  let lo = 0, hi = 0, sum = 0, n = 0;
  for (let i = 0; i < points.length; i++) {
    while (hi < points.length && points[hi].s <= points[i].s + ALT_SMOOTH_S) { const v = clean[hi]; if (v != null) { sum += v; n++; } hi++; }
    while (points[lo].s < points[i].s - ALT_SMOOTH_S) { const v = clean[lo]; if (v != null) { sum -= v; n--; } lo++; }
    out.push(clean[i] == null || n === 0 ? null : sum / n);
  }
  return out;
}

/** Adds each height to a running climb, ignoring wobbles under CLIMB_NOISE. */
function climbCounter() {
  let gain = 0;
  let base: number | null = null;
  return {
    add(alt: number | null) {
      if (alt == null) return;
      if (base == null) base = alt;
      else if (alt - base >= CLIMB_NOISE) { gain += alt - base; base = alt; } else if (alt < base) base = alt;
    },
    get gain() { return gain; },
  };
}

/** Metres climbed, ignoring small wobbles in the phone's altitude. */
export function elevationGain(points: TrackPoint[]): number {
  const c = climbCounter();
  for (const a of smoothAltitudes(points)) c.add(a);
  return Math.round(c.gain);
}

/** Every finished kilometre (or mile, with `unit` 1609.344): its time, climb
 *  and height change, plus how far into the next one you are. */
export function splits(points: TrackPoint[], unit = 1000): { done: Split[]; into: number; intoSeconds: number } {
  const done: Split[] = [];
  const alts = smoothAltitudes(points);
  const c = climbCounter();
  c.add(alts[0] ?? null);
  let dist = 0;
  let mark = 0;
  let markS = points[0]?.s ?? 0;
  let markGain = 0;
  let lastAlt: number | null = alts[0] ?? null;
  let markAlt: number | null = lastAlt;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    c.add(alts[i]);
    if (alts[i] != null) { lastAlt = alts[i]; if (markAlt == null) markAlt = lastAlt; }
    if (!joined(a, b)) continue;
    const step = metresBetween(a, b);
    // The moment a split line is crossed, found along this step.
    while (dist + step >= mark + unit) {
      const f = step ? (mark + unit - dist) / step : 1;
      const at = a.s + (b.s - a.s) * f;
      const net = lastAlt != null && markAlt != null ? lastAlt - markAlt : 0;
      done.push({ n: done.length + 1, seconds: Math.round(at - markS), gain: Math.round(c.gain - markGain), net: Math.round(net) });
      mark += unit;
      markS = at;
      markGain = c.gain;
      markAlt = lastAlt;
    }
    dist += step;
  }
  const last = points[points.length - 1];
  return { done, into: dist - mark, intoSeconds: last ? Math.max(0, Math.round(last.s - markS)) : 0 };
}

/** Seconds per kilometre over roughly the last `window` metres: what the
 *  runner is doing now. Null until there is enough to tell. */
export function currentPace(points: TrackPoint[]): number | null {
  // The last 20 seconds or 200 m, whichever comes first, and at least 30 m:
  // it waited for 400 m before, so the first few minutes of a walk showed
  // no pace at all (Ricky, 2026-11-16).
  let dist = 0;
  let first = points.length - 1;
  for (let i = points.length - 1; i > 0; i--) {
    if (!joined(points[i - 1], points[i])) break;
    dist += metresBetween(points[i - 1], points[i]);
    first = i - 1;
    const dt = points[points.length - 1].s - points[first].s;
    if (dist >= 200 || (dt >= 20 && dist >= 30)) return (dt / dist) * 1000;
  }
  if (dist >= 30) return ((points[points.length - 1].s - points[first].s) / dist) * 1000;
  return null;
}

/** "4:46", from seconds per kilometre, in the chosen unit's length. */
export function paceClock(secondsPerKm: number, unitKm = 1): string {
  const per = Math.round(secondsPerKm * unitKm);
  return `${Math.floor(per / 60)}:${String(per % 60).padStart(2, '0')}`;
}

export type SplitBar = {
  /** The label under the bar: the split number, or where the group ends. */
  label: string;
  /** Seconds per kilometre (or per `unit`) over this bar. */
  pace: number;
  /** How much of a whole bar it covers, 0 to 1; under 1 only for the last. */
  part: number;
};

/** Splits for the Finish chart (Ricky, 2026-11-02, design/finish-923-mockup-v5.png):
 *  every split up to 12; past that, groups of 5, then 20, so there are never
 *  more than 12 bars. A part-finished last split or group comes last, with
 *  how much of it was covered. */
export function splitBars(points: TrackPoint[], unit = 1000): { bars: SplitBar[]; group: number; fastest: number | null } {
  const { done, into, intoSeconds } = splits(points, unit);
  const total = done.length + into / unit;
  const group = total <= 12 ? 1 : total <= 60 ? 5 : 20;
  const bars: SplitBar[] = [];
  for (let i = 0; i < done.length; i += group) {
    const chunk = done.slice(i, i + group);
    const last = i + chunk.length;
    if (chunk.length < group) {
      // A short group at the end takes the part-kilometre with it.
      const seconds = chunk.reduce((n, d) => n + d.seconds, 0) + intoSeconds;
      const metres = chunk.length * unit + into;
      bars.push({ label: fmtKm((metres / unit) + i, group), pace: (seconds / metres) * 1000, part: metres / (group * unit) });
      return { bars, group, fastest: fastestOf(done) };
    }
    bars.push({ label: String(last), pace: (chunk.reduce((n, d) => n + d.seconds, 0) / (group * unit)) * 1000, part: 1 });
  }
  if (into >= 10) bars.push({ label: fmtKm(done.length + into / unit, group), pace: (intoSeconds / into) * 1000, part: into / (group * unit) });
  return { bars, group, fastest: fastestOf(done) };
}

const fastestOf = (done: Split[]) => (done.length ? Math.min(...done.map((d) => d.seconds)) : null);
// "0.23" for a part split on its own; "21.1" where a group ends part way.
const fmtKm = (km: number, group: number) => (group === 1 && km < 1 ? km.toFixed(2) : group === 1 ? (km % 1).toFixed(2) : String(Math.round(km * 10) / 10));

/** The quickest stretch of each distance inside the activity, in seconds:
 *  "1 km in 4:38" even when the run was 5.3 km. Null for distances it didn't
 *  cover. */
export function fastestEfforts(points: TrackPoint[], distances: number[]): (number | null)[] {
  const along: number[] = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + (joined(points[i - 1], points[i]) ? metresBetween(points[i - 1], points[i]) : 0));
  return distances.map((d) => {
    let best: number | null = null;
    let j = 0;
    for (let i = 0; i < points.length; i++) {
      while (j < points.length && along[j] - along[i] < d - 0.01) j++;
      if (j >= points.length) break;
      // Time across exactly d, by interpolating inside the last step.
      const over = along[j] - along[i] - d;
      const step = along[j] - along[j - 1] || 1;
      const t = points[j].s - (points[j].s - points[j - 1].s) * (over / step) - points[i].s;
      if (best == null || t < best) best = t;
    }
    return best == null ? null : Math.round(best);
  });
}
