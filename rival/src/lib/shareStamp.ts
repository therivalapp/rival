// Transparent stamps: an activity's figures and RIVAL on a see-through PNG,
// to lay over your own photo in Instagram and the like. Seven layouts, so
// people can pick one that suits the photo (Ricky, 2026-10-22). Designs:
// rival/design/share-stamps-final.html. Serif figures, Effort always last and
// in gold, RIVAL in the Today wordmark's gradient started a little lighter so
// the R holds on bright photos, and a soft shadow under everything.
//
// One colour per share: gold Effort; RIVAL and everything else white.
//
// Web only: drawn on a canvas.

import { distanceUnit, elevationUnit, toDisplayDistance, toDisplayElevation } from './units';
import { formatDurationClock } from './format';

export type StampStyle = 'A' | 'A2' | 'E' | 'E2' | 'F' | 'F2' | 'G';

/** In the order the picker shows them. */
// A1 (RIVAL centred over a left-set name) dropped, Ricky 2026-10-22.
export const STAMP_STYLES: StampStyle[] = ['A2', 'G', 'A', 'E2', 'E', 'F2', 'F'];

export type StampFigure = { value: string; unit?: string; label: string; gold?: boolean };

export type StampActivity = {
  name?: string | null;
  activity_type: string;
  distance_meters: number;
  duration_seconds: number;
  elevation_meters: number | null;
  effort_score: number;
};

/** The extra figures Strava gives for some activities (ActivityDetails). */
export type StampDetails = {
  avg_heartrate?: number | null;
  max_heartrate?: number | null;
  avg_cadence?: number | null;
  avg_watts?: number | null;
  calories?: number | null;
  max_speed?: number | null;
} | null | undefined;

export type StatKey = 'lift' | 'reps' | 'distance' | 'time' | 'pace' | 'speed' | 'climb' | 'avgHr' | 'maxHr' | 'cadence' | 'power' | 'calories' | 'maxSpeed';

/** One stat a person can put on a stamp or card. `extra` ones sit in a second
 *  row of choices, after the everyday ones. */
export type StatOption = { key: StatKey; label: string; figure: StampFigure; extra?: boolean };

/** Most a stamp or card holds besides Effort, which is always on. */
export const MAX_STATS = 3;

function kindOf(type: string): 'swim' | 'ride' | 'hike' | 'run' | 'other' {
  const t = type.toLowerCase();
  return t.includes('swim') ? 'swim'
    : /ride|cycl|bike/.test(t) ? 'ride'
    : /hike|walk/.test(t) ? 'hike'
    : /run|jog/.test(t) ? 'run'
    : 'other';
}

/** Every stat this activity has, in the order the choices show them. Only
 *  what exists is offered: no heart rate without a heart rate. */
export function statOptions(a: StampActivity, d?: StampDetails): StatOption[] {
  const kind = kindOf(a.activity_type);
  const km = (a.distance_meters || 0) / 1000;
  const secs = a.duration_seconds || 0;
  const climb = a.elevation_meters || 0;
  const unit = distanceUnit();
  const speedUnit = unit === 'mi' ? 'mph' : 'km/h';
  const out: StatOption[] = [];
  if (km > 0) out.push({ key: 'distance', label: 'Distance', figure: { value: toDisplayDistance(km).toFixed(toDisplayDistance(km) >= 100 ? 0 : 1), unit, label: 'Distance' } });
  if (secs > 0) out.push({ key: 'time', label: 'Time', figure: { value: formatDurationClock(secs), label: 'Time' } });
  if (km > 0 && secs > 0) {
    const pace = kind === 'swim'
      ? { value: formatDurationClock(secs / (a.distance_meters / 100)), unit: '/100m', label: 'Pace' }
      : { value: formatDurationClock(secs / toDisplayDistance(km)), unit: `/${unit}`, label: 'Pace' };
    const speed = { value: (toDisplayDistance(km) / (secs / 3600)).toFixed(1), unit: speedUnit, label: 'Speed' };
    // Riders think in speed, everyone else in pace; both are offered.
    if (kind === 'ride') out.push({ key: 'speed', label: 'Speed', figure: speed }, { key: 'pace', label: 'Pace', figure: pace });
    else out.push({ key: 'pace', label: 'Pace', figure: pace }, ...(kind === 'swim' ? [] : [{ key: 'speed' as const, label: 'Speed', figure: speed }]));
  }
  if (climb > 0) out.push({ key: 'climb', label: 'Elevation', figure: { value: Math.round(toDisplayElevation(climb)).toLocaleString(), unit: elevationUnit(), label: 'Elevation' } });
  if (d?.avg_heartrate) out.push({ key: 'avgHr', label: 'Heart rate', extra: true, figure: { value: String(Math.round(d.avg_heartrate)), unit: 'bpm', label: 'Heart rate' } });
  if (d?.max_heartrate) out.push({ key: 'maxHr', label: 'Max heart rate', extra: true, figure: { value: String(Math.round(d.max_heartrate)), unit: 'bpm', label: 'Max HR' } });
  if (d?.avg_cadence) {
    // Strava counts one foot on runs; steps per minute counts both.
    const run = kind === 'run' || kind === 'hike';
    out.push({ key: 'cadence', label: 'Cadence', extra: true, figure: { value: String(Math.round(d.avg_cadence * (run ? 2 : 1))), unit: run ? 'spm' : 'rpm', label: 'Cadence' } });
  }
  if (d?.avg_watts) out.push({ key: 'power', label: 'Power', extra: true, figure: { value: String(Math.round(d.avg_watts)), unit: 'W', label: 'Power' } });
  if (d?.calories) out.push({ key: 'calories', label: 'Calories', extra: true, figure: { value: Math.round(d.calories).toLocaleString(), label: 'Calories' } });
  if (d?.max_speed && kind !== 'swim') {
    const v = d.max_speed * 3.6; // m/s from Strava
    out.push({ key: 'maxSpeed', label: 'Max speed', extra: true, figure: { value: toDisplayDistance(v).toFixed(1), unit: speedUnit, label: 'Max speed' } });
  }
  return out;
}

/** The stats shown before anyone chooses: what suits the activity. */
export function defaultStats(a: StampActivity, options: StatOption[]): StatKey[] {
  const kind = kindOf(a.activity_type);
  const want: StatKey[] =
    kind === 'ride' ? ['distance', 'time', 'speed']
    : kind === 'hike' ? ['distance', 'time', 'climb']
    : ['distance', 'time', 'pace', 'climb'];
  const has = new Set(options.map((o) => o.key));
  return want.filter((k) => has.has(k)).slice(0, MAX_STATS);
}

/** The chosen stats in the order the choices list them, then Effort. */
// `withEffort` false: a lift activity can leave Effort off, since a short,
// heavy activity scores low beside a big lift (Ricky, 2026-10-23).
export function chosenFigures(options: StatOption[], keys: StatKey[], effortScore: number, withEffort = true): StampFigure[] {
  const on = new Set(keys);
  return [
    ...options.filter((o) => on.has(o.key)).slice(0, MAX_STATS).map((o) => o.figure),
    ...(withEffort ? [{ value: String(Math.round(effortScore * 10) / 10), label: 'Effort', gold: true }] : []),
  ];
}

/** The usual figures for an activity, then Effort. */
export function stampFigures(a: StampActivity, d?: StampDetails): StampFigure[] {
  const options = statOptions(a, d);
  return chosenFigures(options, defaultStats(a, options), a.effort_score);
}

// Drawn at 3x the design size, so it stays sharp when enlarged in a story.
const S = 3;
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'Manrope, -apple-system, system-ui, sans-serif';
const CW = 80 * S;
const L0 = 14 * S;

type Ctx = CanvasRenderingContext2D;

/** Light: white with gold for Effort and the countdown. Dark, for bright
 *  photos: all near-black with a soft light shadow; gold can't be dark, so
 *  there's no accent (Ricky, 2026-10-23). */
export type StampMode = 'light' | 'dark';

const PALETTES = {
  light: { ink: '#ffffff', soft: 'rgba(255,255,255,0.78)', rule: 'rgba(255,255,255,0.6)', shadow: 'rgba(0,0,0,0.6)', accent: true },
  dark: { ink: '#1b1714', soft: 'rgba(27,23,20,0.75)', rule: 'rgba(27,23,20,0.5)', shadow: 'rgba(255,255,255,0.55)', accent: false },
};
// The palette for the stamp being drawn; each draw function sets it first.
let P = PALETTES.light;
// Drawing without the shadow, to find where the lettering itself ends.
let bare = false;

/** How far in from each side a stamp's lettering starts, as fractions of its
 *  size. Drawn again without its shadow: round big figures the shadows build
 *  up nearly solid and read as lettering, which held the stamp back from the
 *  photo's edge (Ricky, 2026-10-23). */
export type InkMargins = { l: number; t: number; r: number; b: number };
export function inkMargins(draw: () => HTMLCanvasElement): InkMargins {
  bare = true;
  let c: HTMLCanvasElement;
  try { c = draw(); } finally { bare = false; }
  const w = c.width, h = c.height;
  const a = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let l = w, t = h, r = -1, b = -1;
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < w; i++) {
      if (a[(y * w + i) * 4 + 3] < 100) continue;
      if (i < l) l = i;
      if (i > r) r = i;
      if (y < t) t = y;
      if (y > b) b = y;
    }
  }
  if (r < 0) return { l: 0, t: 0, r: 0, b: 0 };
  return { l: l / w, t: t / h, r: (w - 1 - r) / w, b: (h - 1 - b) / h };
}

function spaced(x: Ctx, text: string, px: number, py: number, spacing: number, center = false) {
  const ws = [...text].map((c) => x.measureText(c).width);
  const total = ws.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let cx = center ? px - total / 2 : px;
  x.textAlign = 'left';
  [...text].forEach((c, i) => { x.fillText(c, cx, py); cx += ws[i] + spacing; });
}

const goldLabel = () => (P.accent ? '#ffd27a' : P.soft);

function gold(x: Ctx, top: number, bottom: number): string | CanvasGradient {
  if (!P.accent) return P.ink;
  const g = x.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#fff4d6');
  g.addColorStop(1, '#ffc94d');
  return g;
}

/** RIVAL in white: each share keeps one colour (gold Effort here), and the
 *  wordmark isn't it (Ricky, 2026-10-22). */
function rival(x: Ctx, px: number, y: number, size: number, center = false) {
  x.font = `800 ${size * S}px ${SANS}`;
  x.fillStyle = P.ink;
  spaced(x, 'RIVAL', px, y, size * 0.4 * S, center);
}

/** A figure with its small unit, and its label underneath. */
function figure(x: Ctx, f: StampFigure, fx: number, y: number, size: number, center: boolean) {
  x.font = `italic 700 ${size * S}px ${SERIF}`;
  const vw = x.measureText(f.value).width;
  x.font = `600 ${size * 0.45 * S}px ${SANS}`;
  const uw = f.unit ? x.measureText(` ${f.unit}`).width : 0;
  const start = center ? fx - (vw + uw) / 2 : fx;
  x.font = `italic 700 ${size * S}px ${SERIF}`;
  x.fillStyle = f.gold ? gold(x, y - size * S, y) : P.ink;
  x.textAlign = 'left';
  x.fillText(f.value, start, y);
  if (f.unit) {
    x.font = `600 ${size * 0.45 * S}px ${SANS}`;
    x.fillStyle = P.soft;
    x.fillText(` ${f.unit}`, start + vw, y);
  }
  x.font = `800 ${8.5 * S}px ${SANS}`;
  x.fillStyle = f.gold ? goldLabel() : P.soft;
  spaced(x, f.label.toUpperCase(), fx, y + 14 * S, 1.3 * S, center);
}

function divider(x: Ctx, px: number, py: number, h: number) {
  const blur = x.shadowBlur;
  if (bare) { x.fillStyle = P.rule; x.fillRect(px, py, Math.max(2, S * 0.75), h); return; }
  // Strong enough to hold on a busy photo; a light shadow lifts it off a
  // bright one (it vanished between the first two figures, Ricky 2026-10-22).
  x.shadowBlur = 4 * S;
  x.fillStyle = P.rule;
  x.fillRect(px, py, Math.max(2, S * 0.75), h);
  x.shadowBlur = blur;
}

/** The figures in a row from the left edge. */
function rowLeft(x: Ctx, figs: StampFigure[], y: number) {
  figs.forEach((f, i) => {
    const fx = L0 + i * CW;
    if (i) divider(x, fx - 9 * S, y - 19 * S, 19 * 1.55 * S);
    figure(x, f, fx, y, 19, false);
  });
}

/** The name, smaller when it would run past the stamp. */
function title(x: Ctx, name: string, y: number, maxWidth: number) {
  let size = 28;
  x.font = `italic 700 ${size * S}px ${SERIF}`;
  while (size > 18 && x.measureText(name).width > maxWidth) {
    size -= 1;
    x.font = `italic 700 ${size * S}px ${SERIF}`;
  }
  x.fillStyle = P.ink;
  x.textAlign = 'left';
  x.fillText(name, L0, y);
}

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.round(w * S);
  c.height = Math.round(h * S);
  const x = c.getContext('2d')!;
  x.shadowColor = P.shadow;
  x.shadowBlur = bare ? 0 : 9 * S;
  x.textBaseline = 'alphabetic';
  return [c, x];
}

export function drawStamp(style: StampStyle, name: string, figs: StampFigure[], mode: StampMode = 'light'): HTMLCanvasElement {
  P = PALETTES[mode];
  const n = figs.length;
  // Width of a left-aligned row in design units: the edge, the columns, and
  // a little room for the last figure's unit.
  const leftW = Math.max(200, 14 + n * 80 + 6);
  switch (style) {
    case 'A': {
      // RIVAL as a small, softer kicker set in to meet the italic name's
      // slope, with a little air (Ricky, 2026-10-22: a full-size RIVAL never
      // lined up over the sloping serif).
      const w = Math.max(leftW, 340);
      const [c, x] = canvas(w, 120);
      let y = 22 * S;
      x.font = `800 ${10.5 * S}px ${SANS}`;
      x.fillStyle = P.accent ? 'rgba(255,255,255,0.85)' : P.soft;
      spaced(x, 'RIVAL', L0 + 3 * S, y, 4.2 * S);
      y += 30 * S;
      title(x, name, y, (w - 28) * S);
      y += 31 * S;
      rowLeft(x, figs, y);
      return c;
    }
    case 'A2': {
      const cw = 82;
      const w = Math.max(200, n * cw + 30);
      const [c, x] = canvas(w, 86);
      const C = (w / 2) * S;
      let y = 24 * S;
      rival(x, C, y, 13, true);
      y += 26 * S;
      figs.forEach((f, i) => {
        const fx = C + (i - (n - 1) / 2) * cw * S;
        if (i) divider(x, fx - (cw / 2) * S, y - 19 * S, 19 * 1.55 * S);
        figure(x, f, fx, y, 19, true);
      });
      return c;
    }
    case 'E':
    case 'E2': {
      const [c, x] = canvas(leftW, style === 'E' ? 94 : 86);
      if (style === 'E') {
        rowLeft(x, figs, 40 * S);
        rival(x, L0, 71 * S, 13);
      } else {
        rival(x, L0, 24 * S, 13);
        rowLeft(x, figs, 50 * S);
      }
      return c;
    }
    case 'F':
    case 'F2': {
      // One serif line ending in Effort in gold, RIVAL centred below it (F)
      // or above it (F2, Ricky 2026-10-22).
      const top = style === 'F2';
      const plain = figs.filter((f) => !f.gold);
      const effort = figs.find((f) => f.gold);
      const probe = document.createElement('canvas').getContext('2d')!;
      probe.font = `italic 700 ${16 * S}px ${SERIF}`;
      const sep = '  ·  ';
      const text = plain.map((f) => (f.unit ? `${f.value} ${f.unit}` : f.value)).join(sep) + (effort && plain.length ? sep : '');
      const w1 = probe.measureText(text).width;
      const w2 = effort ? probe.measureText(effort.value).width : 0;
      probe.font = `800 ${9 * S}px ${SANS}`;
      const w3 = effort ? probe.measureText(' EFFORT').width + 6 * S : 0;
      const w = Math.max(200, (w1 + w2 + w3) / S + 40);
      const [c, x] = canvas(w, top ? 66 : 72);
      const C = (w / 2) * S;
      const y = (top ? 46 : 34) * S;
      let cx = C - (w1 + w2 + w3) / 2;
      x.font = `italic 700 ${16 * S}px ${SERIF}`;
      x.fillStyle = P.ink;
      x.textAlign = 'left';
      x.fillText(text, cx, y);
      cx += w1;
      if (effort) {
        x.fillStyle = gold(x, y - 15 * S, y);
        x.fillText(effort.value, cx, y);
        cx += w2 + 5 * S;
        x.font = `800 ${9 * S}px ${SANS}`;
        x.fillStyle = goldLabel();
        spaced(x, 'EFFORT', cx, y - 1 * S, 1.3 * S);
      }
      rival(x, C, top ? y - 23 * S : y + 23 * S, 12, true);
      return c;
    }
    case 'G': {
      // RIVAL on top, then the numbers stacked on one centre line; units hang
      // to the right, outside the centring.
      const [c, x] = canvas(170, 56 + n * 68);
      const C = 85 * S;
      let y = 24 * S;
      rival(x, C, y, 14, true);
      y += 24 * S;
      figs.forEach((f) => {
        x.font = `800 ${9 * S}px ${SANS}`;
        x.fillStyle = f.gold ? goldLabel() : P.accent ? 'rgba(255,255,255,0.8)' : P.soft;
        spaced(x, f.label.toUpperCase(), C, y, 1.6 * S, true);
        y += 30 * S;
        x.font = `italic 700 ${28 * S}px ${SERIF}`;
        const vw = x.measureText(f.value).width;
        const cx = C - vw / 2;
        x.fillStyle = f.gold ? gold(x, y - 26 * S, y) : P.ink;
        x.textAlign = 'left';
        x.fillText(f.value, cx, y);
        if (f.unit) {
          x.font = `600 ${12.5 * S}px ${SANS}`;
          x.fillStyle = P.soft;
          x.fillText(` ${f.unit}`, cx + vw, y);
        }
        y += 38 * S;
      });
      return c;
    }
  }
}

/** A rank as a see-through stamp: RIVAL in white (the rank's material and
 *  the gold Effort are colour enough, Ricky 2026-10-22), the rank name large
 *  in its material, then the year's figures centred under it. */
export function drawRankStamp(rankName: string, light: string, figs: StampFigure[]): HTMLCanvasElement {
  P = PALETTES.light;
  const n = figs.length;
  const cw = 86;
  const w = Math.max(240, n * cw + 30);
  const [c, x] = canvas(w, 130);
  const C = (w / 2) * S;
  let y = 24 * S;
  x.font = `800 ${13 * S}px ${SANS}`;
  x.fillStyle = '#ffffff';
  spaced(x, 'RIVAL', C, y, 5.2 * S, true);
  const name = rankName.toUpperCase();
  let size = name.length > 7 ? 24 : 30;
  x.font = `italic 700 ${size * S}px ${SERIF}`;
  while (size > 22 && x.measureText(name).width > (w - 20) * S) {
    size -= 1;
    x.font = `italic 700 ${size * S}px ${SERIF}`;
  }
  y += (size + 6) * S;
  const g = x.createLinearGradient(0, y - size * S, 0, y + size * 0.3 * S);
  g.addColorStop(0.1, '#ffffff');
  g.addColorStop(1, light);
  x.fillStyle = g;
  spaced(x, name, C, y, 2 * S, true);
  y += 25 * S;
  figs.forEach((f, i) => {
    const fx = C + (i - (n - 1) / 2) * cw * S;
    if (i) divider(x, fx - (cw / 2) * S, y - 19 * S, 19 * 1.55 * S);
    figure(x, f, fx, y, 19, true);
  });
  return c;
}

export type CountdownEvent = { name: string; race_type: string | null; race_date: string };

/** Whole days from today to a YYYY-MM-DD date, in the person's own time zone. */
export function daysUntil(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
}

/** An upcoming event as a see-through stamp: RIVAL, the days to go large in
 *  gold (the share's one colour, as Effort), then the event and its date
 *  (Ricky, 2026-10-23; replaces the old Share page's countdown). */
export function drawCountdownStamp(ev: CountdownEvent, mode: StampMode = 'light'): HTMLCanvasElement {
  P = PALETTES[mode];
  const days = daysUntil(ev.race_date);
  // Noon, so the date never slips a day across time zones.
  const date = new Date(`${ev.race_date.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const meta = [ev.race_type?.trim(), date].filter(Boolean).join('  ·  ').toUpperCase();
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `italic 700 ${22 * S}px ${SERIF}`;
  const w = Math.min(340, Math.max(240, probe.measureText(ev.name).width / S + 40));
  const [c, x] = canvas(w, 172);
  const C = (w / 2) * S;
  let y = 24 * S;
  rival(x, C, y, 13, true);
  if (days > 0) {
    y += 62 * S;
    x.font = `italic 700 ${58 * S}px ${SERIF}`;
    x.fillStyle = gold(x, y - 52 * S, y);
    x.textAlign = 'center';
    x.fillText(String(days), C, y);
    y += 20 * S;
    x.font = `800 ${9 * S}px ${SANS}`;
    x.fillStyle = goldLabel();
    spaced(x, days === 1 ? 'DAY TO' : 'DAYS TO', C, y, 1.6 * S, true);
  } else {
    y += 52 * S;
    x.font = `italic 700 ${40 * S}px ${SERIF}`;
    x.fillStyle = gold(x, y - 36 * S, y);
    x.textAlign = 'center';
    x.fillText('Event day', C, y);
    y += 30 * S;
  }
  y += 30 * S;
  let size = 22;
  x.font = `italic 700 ${size * S}px ${SERIF}`;
  while (size > 15 && x.measureText(ev.name).width > (w - 28) * S) {
    size -= 1;
    x.font = `italic 700 ${size * S}px ${SERIF}`;
  }
  x.fillStyle = P.ink;
  x.textAlign = 'center';
  x.fillText(ev.name, C, y);
  y += 20 * S;
  x.font = `800 ${8.5 * S}px ${SANS}`;
  x.fillStyle = P.soft;
  spaced(x, meta, C, y, 1.3 * S, true);
  return c;
}

/** Manrope is a webfont; it has to be loaded before a canvas can draw it. */
export async function stampFontsReady() {
  try { await Promise.all([document.fonts.load('800 40px Manrope'), document.fonts.load('600 40px Manrope')]); } catch {}
}

export function stampBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('The stamp could not be made.'))), 'image/png');
  });
}
