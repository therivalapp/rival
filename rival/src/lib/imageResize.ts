// Shrinks picked photos to a sensible size before they're uploaded (web):
// squareImage for avatars and logos, fitPhoto for activity photos.
//
// Phone photos arrive at 4000+ pixels. Stored as they are, every screen that
// shows one as a 50px avatar has the browser shrink it ~100x on the fly, which
// browsers do poorly (and iOS Safari decodes huge images at reduced quality),
// so the picture looks soft. Resizing once here, in halving steps with
// high-quality smoothing, keeps it crisp at every size it's shown.

import { simLog } from './simLog';
import { isNativeCanvas, loadNativeImage, makeCanvas, renderPicture, NCanvas } from './nativeCanvas';

const DEFAULT_SIZE = 640; // covers the largest avatar shown, at 3x pixel density

/** Crops the centre square (nudged up on tall photos, where faces usually are)
 *  and resizes it to `size` px. Falls back to the original file if the browser
 *  can't read it. */
export async function squareImage(file: File, size = DEFAULT_SIZE): Promise<Blob> {
  if (isNativeCanvas) {
    try {
      return await nativeResize(file, (w, h) => {
        const side = Math.min(w, h);
        return { sx: (w - side) / 2, sy: h > w ? (h - side) * 0.3 : (h - side) / 2, sw: side, sh: side, maxEdge: size };
      }, 0.9) ?? file;
    } catch (e: any) { simLog(`photo shrink failed: ${String(e?.message ?? e).slice(0, 60)}`); return file; }
  }
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode(); // browsers apply the photo's EXIF rotation here
    URL.revokeObjectURL(url);

    const w = img.naturalWidth, h = img.naturalHeight;
    const side = Math.min(w, h);
    const sx = (w - side) / 2;
    const sy = h > w ? (h - side) * 0.3 : (h - side) / 2;

    const canvas = steppedDraw(img, sx, sy, side, side, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Draws the (sx, sy, sw, sh) part of `img` so its longer side is at most
 *  `maxEdge`, halving in steps first: one big jump down looks soft. */
function steppedDraw(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, maxEdge: number): HTMLCanvasElement {
  let src: CanvasImageSource = img;
  let x = sx, y = sy, w = sw, h = sh;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const outW = Math.round(sw * scale), outH = Math.round(sh * scale);
  while (w / 2 >= outW * 2) {
    const c = document.createElement('canvas');
    c.width = Math.round(w / 2); c.height = Math.round(h / 2);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    src = c; x = 0; y = 0; w = c.width; h = c.height;
  }
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, w, h, 0, 0, outW, outH);
  return canvas;
}

// 2048 at 0.92: 1600 at 0.88 looked soft full-screen on a 3x phone (Ricky, 2026-10-23).
const PHOTO_MAX_EDGE = 2048; // sharp in the feed and full-screen, ~4x smaller than a phone original

export type UploadFile = { blob: Blob; mimeType: string; ext: string };

/** For activity photos: longest side down to 2048px as a JPEG. Videos, GIFs,
 *  photos already that small, and anything the browser can't read (e.g. HEIC
 *  outside Safari) are returned untouched. */
export async function fitPhoto(file: UploadFile): Promise<UploadFile> {
  if (isNativeCanvas && file.mimeType.startsWith('image/') && !/gif|svg/.test(file.mimeType)) {
    try {
      const blob = await nativeResize(file.blob, (w, h) => (Math.max(w, h) <= PHOTO_MAX_EDGE ? null : { sx: 0, sy: 0, sw: w, sh: h, maxEdge: PHOTO_MAX_EDGE }), 0.92);
      return blob ? { blob, mimeType: 'image/jpeg', ext: 'jpg' } : file;
    } catch (e: any) { simLog(`photo shrink failed: ${String(e?.message ?? e).slice(0, 60)}`); return file; }
  }
  if (typeof document === 'undefined' || !file.mimeType.startsWith('image/') || /gif|svg/.test(file.mimeType)) return file;
  try {
    const url = URL.createObjectURL(file.blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) <= PHOTO_MAX_EDGE) return file;
    const canvas = steppedDraw(img, 0, 0, w, h, PHOTO_MAX_EDGE);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    return blob ? { blob, mimeType: 'image/jpeg', ext: 'jpg' } : file;
  } catch {
    return file;
  }
}

/** iPhone: the same crop and shrink, drawn off screen by NativeCanvasHost
 *  (lib/nativeCanvas.ts) and saved as a JPEG. `plan` returns null when the
 *  photo is already small enough. iOS draws photos the right way up itself. */
async function nativeResize(
  blob: Blob,
  plan: (w: number, h: number) => { sx: number; sy: number; sw: number; sh: number; maxEdge: number } | null,
  quality: number,
): Promise<Blob | null> {
  // The iPhone app can't make blob: addresses, so the photo goes in as a data address.
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The photo could not be read.'));
    r.readAsDataURL(blob);
  });
  try {
    const img = await loadNativeImage(url);
    const p = plan(img.naturalWidth, img.naturalHeight);
    if (!p) return null;
    const scale = Math.min(1, p.maxEdge / Math.max(p.sw, p.sh));
    const outW = Math.round(p.sw * scale), outH = Math.round(p.sh * scale);
    const canvas = makeCanvas(outW, outH) as unknown as NCanvas;
    canvas.getContext('2d').drawImage(img as unknown as HTMLImageElement, p.sx, p.sy, p.sw, p.sh, 0, 0, outW, outH);
    const pic = await renderPicture(canvas, 'image/jpeg', quality);
    return await (await fetch(pic.uri)).blob();
  } finally { /* nothing to release */ }
}
