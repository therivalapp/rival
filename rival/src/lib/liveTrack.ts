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

export type Split = { n: number; seconds: number; gain: number };

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

// Phone altitude wobbles by a few metres; climbs count once they pass this.
const CLIMB_NOISE = 3;

/** Metres climbed, ignoring small wobbles in the phone's altitude. */
export function elevationGain(points: TrackPoint[]): number {
  let gain = 0;
  let base: number | null = null;
  for (const p of points) {
    if (p.alt == null) continue;
    if (base == null) { base = p.alt; continue; }
    if (p.alt - base >= CLIMB_NOISE) { gain += p.alt - base; base = p.alt; } else if (p.alt < base) base = p.alt;
  }
  return Math.round(gain);
}

/** Every finished kilometre (or mile, with `unit` 1609.344): its time and
 *  climb, plus how far into the next one you are. */
export function splits(points: TrackPoint[], unit = 1000): { done: Split[]; into: number; intoSeconds: number } {
  const done: Split[] = [];
  let dist = 0;
  let mark = 0;
  let markS = points[0]?.s ?? 0;
  let markGain = 0;
  let gain = 0;
  let base: number | null = points[0]?.alt ?? null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (b.alt != null) {
      if (base == null) base = b.alt;
      else if (b.alt - base >= CLIMB_NOISE) { gain += b.alt - base; base = b.alt; } else if (b.alt < base) base = b.alt;
    }
    if (!joined(a, b)) continue;
    const step = metresBetween(a, b);
    // The moment a split line is crossed, found along this step.
    while (dist + step >= mark + unit) {
      const f = step ? (mark + unit - dist) / step : 1;
      const at = a.s + (b.s - a.s) * f;
      done.push({ n: done.length + 1, seconds: Math.round(at - markS), gain: Math.round(gain - markGain) });
      mark += unit;
      markS = at;
      markGain = gain;
    }
    dist += step;
  }
  const last = points[points.length - 1];
  return { done, into: dist - mark, intoSeconds: last ? Math.max(0, Math.round(last.s - markS)) : 0 };
}

/** Seconds per kilometre over roughly the last `window` metres: what the
 *  runner is doing now. Null until there is enough to tell. */
export function currentPace(points: TrackPoint[], window = 400): number | null {
  let dist = 0;
  for (let i = points.length - 1; i > 0; i--) {
    if (!joined(points[i - 1], points[i])) break;
    dist += metresBetween(points[i - 1], points[i]);
    if (dist >= window) return ((points[points.length - 1].s - points[i - 1].s) / dist) * 1000;
  }
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
