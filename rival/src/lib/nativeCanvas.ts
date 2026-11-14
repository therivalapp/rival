// A stand-in for the browser canvas on iPhone, so the share pictures
// (lib/shareCard.ts, lib/shareStamp.ts) are drawn by the same code on both.
//
// It records what the drawing code asks for (rectangles, text, gradients,
// photos, rounded frames, shadows), measures text from the font files' own
// widths (lib/fontMetrics.ts), and NativeCanvasHost draws the record as SVG
// off screen and saves it as a picture with react-native-view-shot.
//
// On the web, makeCanvas hands back a real canvas and none of this runs.

import { Image as RNImage, Platform } from 'react-native';
import { FACE_METRICS, type FaceMetrics } from './fontMetrics';
import { simLog } from './simLog';

export type NGradient = {
  kind: 'linear' | 'radial';
  coords: number[];
  stops: { offset: number; color: string }[];
  addColorStop(offset: number, color: string): void;
};

export type NImage = { __nimage: true; uri: string; naturalWidth: number; naturalHeight: number; width: number; height: number };

export type NFont = { family: 'serif' | 'sans'; size: number; weight: number; italic: boolean };

type Paint = string | NGradient;
type Matrix = [number, number, number, number, number, number];
type Shadow = { blur: number; color: string } | null;

export type NOp =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill: Paint; m: Matrix; alpha: number; shadow: Shadow }
  | { k: 'text'; text: string; x: number; y: number; align: 'left' | 'center' | 'right'; font: NFont; width: number; fill: Paint; m: Matrix; alpha: number; shadow: Shadow }
  | { k: 'path'; d: string; fill?: Paint; stroke?: Paint; lineWidth: number; m: Matrix; alpha: number; shadow: Shadow }
  | { k: 'image'; src: NImage | NCanvas; sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number; m: Matrix; alpha: number };

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** "italic 700 45px Georgia, serif" → the face it names. */
export function parseFont(spec: string): NFont {
  const size = Number(spec.match(/([\d.]+)px/)?.[1] ?? 10);
  const italic = /\bitalic\b/.test(spec);
  const weight = Number(spec.match(/\b([1-9]00)\b/)?.[1] ?? (/\bbold\b/.test(spec) ? 700 : 400));
  const family = /georgia|serif/i.test(spec.split('px')[1] ?? '') && !/manrope/i.test(spec) ? 'serif' : 'sans';
  return { family, size, weight, italic };
}

function faceFor(f: NFont): FaceMetrics {
  if (f.family === 'serif') return FACE_METRICS['serif-bi'];
  if (f.weight >= 800) return FACE_METRICS.m800;
  if (f.weight >= 700) return FACE_METRICS.m700;
  if (f.weight >= 600) return FACE_METRICS.m600;
  return FACE_METRICS.m500;
}

export function measure(text: string, f: NFont): number {
  const face = faceFor(f);
  let units = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    units += c >= 32 && c <= 126 ? face.ascii[c - 32] : face.extra[ch] ?? face.ascii['n'.charCodeAt(0) - 32];
  }
  return (units / 1000) * f.size;
}

class NContext {
  canvas: NCanvas;
  fillStyle: Paint = '#000';
  strokeStyle: Paint = '#000';
  lineWidth = 1;
  font = '10px sans-serif';
  textAlign: 'left' | 'center' | 'right' | 'start' | 'end' = 'left';
  textBaseline = 'alphabetic';
  shadowBlur = 0;
  shadowColor = 'rgba(0,0,0,0)';
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  globalAlpha = 1;
  filter = 'none';
  private m: Matrix = IDENTITY;
  private stack: { m: Matrix; fillStyle: Paint; strokeStyle: Paint; lineWidth: number; font: string; textAlign: any; shadowBlur: number; shadowColor: string; globalAlpha: number }[] = [];
  private path = '';

  constructor(canvas: NCanvas) { this.canvas = canvas; }

  private get shadow(): Shadow {
    if (this.shadowBlur <= 0 || /rgba\([^)]*,\s*0\)$/.test(this.shadowColor) || this.shadowColor === 'transparent') return null;
    return { blur: this.shadowBlur, color: this.shadowColor };
  }

  save() { this.stack.push({ m: this.m, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, textAlign: this.textAlign, shadowBlur: this.shadowBlur, shadowColor: this.shadowColor, globalAlpha: this.globalAlpha }); }
  restore() { const s = this.stack.pop(); if (s) Object.assign(this, s); }
  translate(x: number, y: number) { this.m = multiply(this.m, [1, 0, 0, 1, x, y]); }
  rotate(a: number) { const c = Math.cos(a), s = Math.sin(a); this.m = multiply(this.m, [c, s, -s, c, 0, 0]); }
  scale(x: number, y: number) { this.m = multiply(this.m, [x, 0, 0, y, 0, 0]); }
  setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { this.m = [a, b, c, d, e, f]; }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): NGradient {
    return { kind: 'linear', coords: [x0, y0, x1, y1], stops: [], addColorStop(o, c) { this.stops.push({ offset: o, color: c }); } };
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): NGradient {
    return { kind: 'radial', coords: [x0, y0, r0, x1, y1, r1], stops: [], addColorStop(o, c) { this.stops.push({ offset: o, color: c }); } };
  }

  fillRect(x: number, y: number, w: number, h: number) {
    this.canvas.ops.push({ k: 'rect', x, y, w, h, fill: this.fillStyle, m: this.m, alpha: this.globalAlpha, shadow: this.shadow });
  }
  clearRect() { /* every picture starts clear */ }

  measureText(text: string) {
    const f = parseFont(this.font);
    const face = faceFor(f);
    return { width: measure(text, f), actualBoundingBoxAscent: face.asc * f.size * 0.75, actualBoundingBoxDescent: face.desc * f.size * 0.5 };
  }
  fillText(text: string, x: number, y: number) {
    const f = parseFont(this.font);
    const a = this.textAlign === 'start' ? 'left' : this.textAlign === 'end' ? 'right' : this.textAlign;
    this.canvas.ops.push({ k: 'text', text, x, y, align: a, font: f, width: measure(text, f), fill: this.fillStyle, m: this.m, alpha: this.globalAlpha, shadow: this.shadow });
  }

  beginPath() { this.path = ''; }
  closePath() { this.path += 'Z'; }
  moveTo(x: number, y: number) { this.path += `M${x} ${y}`; }
  lineTo(x: number, y: number) { this.path += `L${x} ${y}`; }
  rect(x: number, y: number, w: number, h: number) { this.path += `M${x} ${y}h${w}v${h}h${-w}Z`; }
  roundRect(x: number, y: number, w: number, h: number, r: number | number[] = 0) {
    const rr = Math.min(Array.isArray(r) ? r[0] ?? 0 : r, w / 2, h / 2);
    this.path += `M${x + rr} ${y}H${x + w - rr}A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}V${y + h - rr}A${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}H${x + rr}A${rr} ${rr} 0 0 1 ${x} ${y + h - rr}V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}Z`;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number) {
    const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
    if (full) { this.path += `M${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}`; return; }
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    this.path += `${this.path ? 'L' : 'M'}${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  }
  fill() { this.canvas.ops.push({ k: 'path', d: this.path, fill: this.fillStyle, lineWidth: 0, m: this.m, alpha: this.globalAlpha, shadow: this.shadow }); }
  stroke() { this.canvas.ops.push({ k: 'path', d: this.path, stroke: this.strokeStyle, lineWidth: this.lineWidth, m: this.m, alpha: this.globalAlpha, shadow: this.shadow }); }

  drawImage(src: NImage | NCanvas, ...a: number[]) {
    const nw = src instanceof NCanvas ? src.width : src.naturalWidth;
    const nh = src instanceof NCanvas ? src.height : src.naturalHeight;
    let sx = 0, sy = 0, sw = nw, sh = nh, dx: number, dy: number, dw = nw, dh = nh;
    if (a.length === 2) [dx, dy] = a;
    else if (a.length === 4) [dx, dy, dw, dh] = a;
    else [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    this.canvas.ops.push({ k: 'image', src, sx, sy, sw, sh, dx, dy, dw, dh, m: this.m, alpha: this.globalAlpha });
  }
}

export class NCanvas {
  width = 300;
  height = 150;
  ops: NOp[] = [];
  private ctx: NContext | null = null;
  getContext(_kind?: string, _opts?: unknown) { return (this.ctx ??= new NContext(this)) as unknown as CanvasRenderingContext2D; }
  /** Drawn and saved as a picture; the Blob stand-in carries the file. */
  toBlob(cb: (b: Blob | null) => void, type = 'image/png', quality = 0.92) {
    renderPicture(this, type, quality).then((p) => cb(p as unknown as Blob), () => cb(null));
  }
  /** Where the lettering sits, without shadows: the iPhone version of
   *  reading the pixels back (shareStamp inkMargins / centredStamp). */
  inkBox(withShadow = false): { l: number; t: number; r: number; b: number } | null {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    const add = (x: number, y: number, m: Matrix) => {
      const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5];
      l = Math.min(l, px); r = Math.max(r, px); t = Math.min(t, py); b = Math.max(b, py);
    };
    for (const op of this.ops) {
      const grow = withShadow && 'shadow' in op && op.shadow ? op.shadow.blur : 0;
      if (op.k === 'text') {
        const face = faceFor(op.font);
        const x0 = op.align === 'center' ? op.x - op.width / 2 : op.align === 'right' ? op.x - op.width : op.x;
        // Cap height and a little descent: closer to the ink than the full line box.
        add(x0 - grow, op.y - face.asc * op.font.size * 0.75 - grow, op.m);
        add(x0 + op.width + grow, op.y + face.desc * op.font.size * 0.35 + grow, op.m);
      } else if (op.k === 'rect') {
        add(op.x - grow, op.y - grow, op.m); add(op.x + op.w + grow, op.y + op.h + grow, op.m);
      } else if (op.k === 'image') {
        add(op.dx, op.dy, op.m); add(op.dx + op.dw, op.dy + op.dh, op.m);
      }
    }
    if (r < l) return null;
    return { l: Math.max(0, l), t: Math.max(0, t), r: Math.min(this.width, r), b: Math.min(this.height, b) };
  }
}

/** A finished picture on iPhone: a file, standing in for a browser Blob. */
export type NativePicture = { __nativeUri: string; uri: string; type: string; size: number; canvas: NCanvas };

export function isNativePicture(b: unknown): b is NativePicture {
  return !!b && typeof b === 'object' && '__nativeUri' in (b as any);
}

export const isNativeCanvas = Platform.OS !== 'web';

/** A blank canvas: the browser's on the web, the stand-in on iPhone. */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  if (!isNativeCanvas) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  const c = new NCanvas();
  c.width = w; c.height = h;
  return c as unknown as HTMLCanvasElement;
}

/** A photo by address, with its size, ready for drawImage. */
export async function loadNativeImage(uri: string): Promise<NImage> {
  simLog('photo size…');
  const [w, h] = await new Promise<[number, number]>((resolve, reject) => {
    RNImage.getSize(uri, (iw, ih) => resolve([iw, ih]), () => reject(new Error('The photo could not be loaded.')));
  });
  // Fetched now, so the off-screen drawing finds it ready (file addresses need no fetch).
  if (/^https?:/.test(uri)) { try { await RNImage.prefetch(uri); } catch {} }
  return { __nimage: true, uri, naturalWidth: w, naturalHeight: h, width: w, height: h };
}

// ── The queue NativeCanvasHost drains ────────────────────────────────────────

export type RenderJob = { canvas: NCanvas; type: string; quality: number; resolve: (p: NativePicture) => void; reject: (e: Error) => void };

const queue: RenderJob[] = [];
let wake: (() => void) | null = null;

export function setRenderListener(fn: (() => void) | null) { wake = fn; if (fn && queue.length) fn(); }
export function nextRenderJob(): RenderJob | undefined { return queue.shift(); }
export function pendingRenderJobs() { return queue.length; }

export function renderPicture(canvas: NCanvas, type = 'image/png', quality = 0.92): Promise<NativePicture> {
  return new Promise((resolve, reject) => {
    queue.push({ canvas, type, quality, resolve, reject });
    simLog(`queued, host ${wake ? 'on' : 'off'}`);
    if (wake) wake();
    else setTimeout(() => { if (!wake) reject(new Error('Pictures cannot be made here yet.')); }, 4000);
  });
}

// iPhone: pictures carry their file address, so URL.createObjectURL(picture)
// gives the file to show, and revoking it does nothing.
if (isNativeCanvas && typeof URL !== 'undefined') {
  const create = (URL as any).createObjectURL?.bind(URL);
  const revoke = (URL as any).revokeObjectURL?.bind(URL);
  (URL as any).createObjectURL = (b: unknown) => (isNativePicture(b) ? b.__nativeUri : create?.(b));
  (URL as any).revokeObjectURL = (u: unknown) => { if (typeof u === 'string' && u.startsWith('file:')) return; try { revoke?.(u); } catch {} };
}
