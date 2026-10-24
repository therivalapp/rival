// The share card: one activity as a 9:16 picture, made on the phone in a
// moment (no AI, no server), for Instagram stories, Messages and the rest.
// The photo (or the sky for the hour it happened), RIVAL at the top, and the
// kicker, name and figures at the bottom (no date), Effort in gold.
// Design: rival/design/share-to-inspire.html, card 2 (Ricky, 2026-10-22).
//
// Web only: drawn on a canvas. Photos come from Supabase storage, which sends
// Access-Control-Allow-Origin: *, so the canvas stays exportable.

import { fullPhoto } from './imageUrl';
import { SKIES, skyFor } from '../components/rival/SkyBackdrop';

export type ShareFigure = { value: string; unit?: string; label: string; gold?: boolean };

/** A personal best: leads the card in gold inside a fine gold frame
 *  (rival/design/share-pb-types.html, Ricky 2026-10-22). */
export type ShareBest = {
  /** "Fastest 5K", "Farthest ride". */
  title: string;
  /** "Also fastest 5K and 1K", when one activity set several. */
  also?: string;
  value: string;
  unit?: string;
  /** "38 seconds faster", "up from 131 km". */
  note?: string;
};

export type ShareCardInput = {
  photoUrl: string | null;
  /** 0–1 crop centre saved for the cover; the middle when unset. */
  focalX?: number | null;
  focalY?: number | null;
  kicker: string;
  name: string;
  figures: ShareFigure[];
  startedAt: string;
  utcOffsetSeconds?: number | null;
  best?: ShareBest | null;
};

const W = 1080;
const H = 1920;
// The mockup is drawn at 375 wide; everything scales from it.
const S = W / 375;
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'Manrope, -apple-system, system-ui, sans-serif';

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The photo could not be loaded.'));
    img.src = url;
  });
}

export function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, fx: number, fy: number) {
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  // Keep the saved focal point in view, without showing past the edges.
  const x = Math.min(0, Math.max(W - dw, W / 2 - fx * dw));
  const y = Math.min(0, Math.max(H - dh, H / 2 - fy * dh));
  ctx.drawImage(img, x, y, dw, dh);
}

function drawSky(ctx: CanvasRenderingContext2D, startedAt: string, offset?: number | null) {
  const sky = SKIES[skyFor(startedAt, offset)].sky;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const m of sky.matchAll(/(#[0-9a-f]{6})\s+(\d+)%/gi)) g.addColorStop(Number(m[2]) / 100, m[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Letter-spaced caps, drawn a letter at a time (canvas letterSpacing is not
 *  in every Safari yet). `align` is where x sits: left edge or centre. */
export function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: 'left' | 'center') {
  const widths = [...text].map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let cx = align === 'center' ? x - total / 2 : x;
  ctx.textAlign = 'left';
  [...text].forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
}

/** Up to two lines; a longer name gets smaller rather than cut off. */
function fitName(ctx: CanvasRenderingContext2D, name: string, maxWidth: number): { lines: string[]; size: number } {
  for (let size = 32 * S; size >= 22 * S; size -= 2) {
    ctx.font = `italic 700 ${size}px ${SERIF}`;
    const words = name.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width <= maxWidth || !line) line = next;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { lines, size };
  }
  return { lines: [name], size: 22 * S };
}

export async function makeShareCard(input: ShareCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // The serif is a system face; Manrope is the app's webfont and has to be
  // loaded before it can be drawn.
  try { await Promise.all([document.fonts.load(`800 40px Manrope`), document.fonts.load(`600 40px Manrope`)]); } catch {}

  let drewPhoto = false;
  if (input.photoUrl) {
    try {
      drawCover(ctx, await loadImage(fullPhoto(input.photoUrl)), input.focalX ?? 0.5, input.focalY ?? 0.5);
      drewPhoto = true;
    } catch { /* the sky stands in */ }
  }
  if (!drewPhoto) drawSky(ctx, input.startedAt, input.utcOffsetSeconds);

  // Shade: a little at the top for RIVAL, a lot at the bottom for the words.
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0.35)');
  shade.addColorStop(0.22, 'rgba(0,0,0,0)');
  shade.addColorStop(0.46, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(10,8,7,0.9)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'alphabetic';
  // One colour per card (Ricky, 2026-10-22): gold, for Effort and any best.
  // RIVAL, the activity label and the lines are white.
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${15 * S}px ${SANS}`;
  spaced(ctx, 'RIVAL', W / 2, 22 * S + 15 * S, 6 * S, 'center');

  const best = input.best ?? null;
  if (best) {
    ctx.strokeStyle = 'rgba(255,215,0,0.55)';
    ctx.lineWidth = 1.5 * S;
    ctx.beginPath();
    const inset = 10 * S + ctx.lineWidth / 2;
    ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, 16 * S);
    ctx.stroke();
  }
  const goldFill = (top: number, bottom: number) => {
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, '#fff4d6');
    g.addColorStop(1, '#ffc94d');
    return g;
  };

  // The bottom block, laid out from the bottom edge up.
  const left = 22 * S;
  const right = W - 22 * S;
  let y = H - 24 * S;

  // Up to four: three chosen stats and Effort. Four sit a little smaller.
  const figs = input.figures.slice(0, 4);
  let figSize = (best ? 20 : 26) * (figs.length > 3 ? 0.82 : 1);
  let unitSize = 13;
  if (figs.length) {
    const colW = (right - left) / figs.length;
    // Every figure, unit and all, has to clear the next divider ("5:56 /km"
    // ran into it, Ricky 2026-10-22). One scale for the row keeps them even.
    const room = colW - 14 * S - 8 * S;
    let need = 0;
    for (const f of figs) {
      ctx.font = `italic 700 ${figSize * S}px ${SERIF}`;
      let w = ctx.measureText(f.value).width;
      if (f.unit) { ctx.font = `600 ${unitSize * S}px ${SANS}`; w += ctx.measureText(` ${f.unit}`).width; }
      need = Math.max(need, w);
    }
    if (need > room) { const k = room / need; figSize *= k; unitSize *= k; }
    const labelY = y - 2 * S;
    const valueY = labelY - 16 * S;
    figs.forEach((f, i) => {
      const x = left + i * colW + (i > 0 ? 14 * S : 0);
      if (i > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(left + i * colW, valueY - 26 * S, Math.max(1, S * 0.5), 44 * S);
      }
      ctx.font = `italic 700 ${figSize * S}px ${SERIF}`;
      ctx.fillStyle = f.gold ? goldFill(valueY - 24 * S, valueY) : '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(f.value, x, valueY);
      if (f.unit) {
        const vw = ctx.measureText(f.value).width;
        ctx.font = `600 ${unitSize * S}px ${SANS}`;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(` ${f.unit}`, x + vw, valueY);
      }
      ctx.font = `800 ${9.5 * S}px ${SANS}`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      spaced(ctx, f.label.toUpperCase(), x, labelY, 1.4 * S, 'left');
    });
    y = valueY - 26 * S - 14 * S;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(left, y, right - left, Math.max(1, S * 0.5));
    // Close over the figures so the name heads them (Ricky, 2026-10-22).
    y -= 12 * S;
  }

  ctx.textAlign = 'left';
  if (best) {
    // The best itself, large in gold, with how it compares beside it.
    ctx.font = `italic 700 ${52 * S}px ${SERIF}`;
    ctx.fillStyle = goldFill(y - 44 * S, y);
    ctx.fillText(best.value, left, y);
    let x = left + ctx.measureText(best.value).width;
    if (best.unit) {
      ctx.font = `italic 700 ${20 * S}px ${SERIF}`;
      ctx.fillText(` ${best.unit}`, x, y);
      x += ctx.measureText(` ${best.unit}`).width;
    }
    if (best.note) {
      ctx.font = `500 ${12.5 * S}px ${SANS}`;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText(best.note, x + 10 * S, y);
    }
    y -= 52 * S * 0.72 + 16 * S;
  }
  // No date on any shared card (Ricky, 2026-10-22): the name sits straight
  // over the figures.

  const { lines, size } = fitName(ctx, input.name, right - left);
  ctx.font = `italic 700 ${size}px ${SERIF}`;
  ctx.fillStyle = '#fff';
  for (let i = lines.length - 1; i >= 0; i--) {
    ctx.fillText(lines[i], left, y);
    y -= size * 1.12;
  }
  // Back to the first line's baseline, then above its capitals.
  y += size * 1.12 - size * 0.72 - 10 * S;

  if (best?.also) {
    ctx.font = `500 ${11.5 * S}px ${SANS}`;
    ctx.fillStyle = 'rgba(255,230,168,0.85)';
    ctx.fillText(best.also, left, y);
    y -= 11.5 * S + 6 * S;
  }
  ctx.font = `800 ${10.5 * S}px ${SANS}`;
  ctx.fillStyle = best ? '#ffd27a' : 'rgba(255,255,255,0.75)';
  spaced(ctx, (best ? `Personal best · ${best.title}` : input.kicker).toUpperCase(), left, y, 1.6 * S, 'left');

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/jpeg', 0.92);
  });
}

/** Opens the phone's share sheet with the card. Must run inside the tap that
 *  asked for it. Where sharing a file isn't possible (most desktops), the
 *  picture is saved instead. */
export async function shareCardFile(blob: Blob, fileName: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], fileName, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

// ── The rank card ────────────────────────────────────────────────────────────
// A rank shared from Ranks: the photo (or the rank's own material as a dark
// ground), a fine frame and the name in that material (no badge icon), then
// the year's figures with Effort in gold (rival/design/share-rank.html, Ricky
// 2026-10-22).

export type RankCardInput = {
  photoUrl: string | null;
  focalX?: number | null;
  focalY?: number | null;
  rankName: string;
  /** "2026 RANK · LEVEL 4 OF 10". */
  kicker: string;
  light: string;
  dark: string;
  figures: ShareFigure[];
};

export async function makeRankCard(input: RankCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  try { await Promise.all([document.fonts.load('800 40px Manrope'), document.fonts.load('600 40px Manrope')]); } catch {}

  let drewPhoto = false;
  if (input.photoUrl) {
    try {
      drawCover(ctx, await loadImage(fullPhoto(input.photoUrl)), input.focalX ?? 0.5, input.focalY ?? 0.5);
      drewPhoto = true;
    } catch { /* the material ground stands in */ }
  }
  if (!drewPhoto) {
    const g = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, H * 0.8);
    g.addColorStop(0, input.dark);
    g.addColorStop(1, '#0e0d0c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0.35)');
  shade.addColorStop(0.22, 'rgba(0,0,0,0)');
  shade.addColorStop(0.4, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(10,8,7,0.9)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // The frame, in the rank's material.
  ctx.strokeStyle = `${input.light}aa`;
  ctx.lineWidth = 1.5 * S;
  const inset = 10 * S + ctx.lineWidth / 2;
  ctx.beginPath();
  ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, 16 * S);
  ctx.stroke();

  // RIVAL in white; the rank's material is the card's one colour.
  ctx.font = `800 ${15 * S}px ${SANS}`;
  ctx.fillStyle = '#ffffff';
  spaced(ctx, 'RIVAL', W / 2, 37 * S, 6 * S, 'center');

  const left = 22 * S;
  const right = W - 22 * S;
  let y = H - 24 * S;

  // The year's figures, Effort in gold.
  const figs = input.figures.slice(0, 3);
  const colW = (right - left) / Math.max(1, figs.length);
  const labelY = y - 2 * S;
  const valueY = labelY - 16 * S;
  figs.forEach((f, i) => {
    const x = left + i * colW + (i > 0 ? 12 * S : 0);
    if (i > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(left + i * colW, valueY - 24 * S, Math.max(1, S * 0.5), 42 * S);
    }
    ctx.font = `italic 700 ${24 * S}px ${SERIF}`;
    if (f.gold) {
      const g = ctx.createLinearGradient(0, valueY - 22 * S, 0, valueY);
      g.addColorStop(0, '#fff4d6');
      g.addColorStop(1, '#ffc94d');
      ctx.fillStyle = g;
    } else ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(f.value, x, valueY);
    if (f.unit) {
      const vw = ctx.measureText(f.value).width;
      ctx.font = `600 ${12 * S}px ${SANS}`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(` ${f.unit}`, x + vw, valueY);
    }
    ctx.font = `800 ${9.5 * S}px ${SANS}`;
    ctx.fillStyle = f.gold ? '#ffd27a' : 'rgba(255,255,255,0.55)';
    spaced(ctx, f.label.toUpperCase(), x, labelY, 1.4 * S, 'left');
  });
  y = valueY - 24 * S - 14 * S;
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(left, y, right - left, Math.max(1, S * 0.5));
  // Close over the figures, so the rank reads as the heading of its numbers.
  y -= 13 * S;

  // The rank name, large, white into its material.
  const name = input.rankName.toUpperCase();
  // Present but not shouting (Ricky, 2026-10-22: the first cut was too loud).
  let size = name.length > 7 ? 32 * S : 44 * S;
  ctx.font = `italic 700 ${size}px ${SERIF}`;
  while (size > 30 * S && ctx.measureText(name).width + 2 * S * name.length > right - left) {
    size -= 2;
    ctx.font = `italic 700 ${size}px ${SERIF}`;
  }
  const ng = ctx.createLinearGradient(0, y - size, 0, y + size * 0.3);
  ng.addColorStop(0.1, '#ffffff');
  ng.addColorStop(1, input.light);
  ctx.fillStyle = ng;
  spaced(ctx, name, left, y, 2 * S, 'left');
  y -= size * 0.78 + 12 * S;

  ctx.font = `800 ${10.5 * S}px ${SANS}`;
  ctx.fillStyle = input.light;
  spaced(ctx, input.kicker.toUpperCase(), left, y, 1.6 * S, 'left');
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/jpeg', 0.92);
  });
}

// ── A stamp placed on the photo ──────────────────────────────────────────────
// The person drags and pinches a stamp on their own photo; this flattens it
// into one 9:16 picture exactly as placed (Ricky, 2026-10-22: every photo is
// different, so the stamp has to sit where they put it).

/** Where the stamp sits, as fractions of the 9:16 frame: its centre, its
 *  width against the frame's width, and its turn in radians. */
export type StampPlacement = { cx: number; cy: number; w: number; r?: number };

export async function composeStampOnPhoto(input: {
  photoUrl: string;
  focalX?: number | null;
  focalY?: number | null;
  stampUrl: string;
  placement: StampPlacement;
}): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  drawCover(ctx, await loadImage(fullPhoto(input.photoUrl)), input.focalX ?? 0.5, input.focalY ?? 0.5);
  const stamp = await loadImage(input.stampUrl);
  const dw = input.placement.w * W;
  const dh = dw * (stamp.naturalHeight / stamp.naturalWidth);
  ctx.save();
  ctx.translate(input.placement.cx * W, input.placement.cy * H);
  ctx.rotate(input.placement.r ?? 0);
  ctx.drawImage(stamp, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/jpeg', 0.92);
  });
}
