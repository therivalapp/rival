// Shrinks picked photos to a sensible size before they're uploaded (web):
// squareImage for avatars and logos, fitPhoto for activity photos.
//
// Phone photos arrive at 4000+ pixels. Stored as they are, every screen that
// shows one as a 50px avatar has the browser shrink it ~100x on the fly, which
// browsers do poorly (and iOS Safari decodes huge images at reduced quality),
// so the picture looks soft. Resizing once here, in halving steps with
// high-quality smoothing, keeps it crisp at every size it's shown.

const DEFAULT_SIZE = 640; // covers the largest avatar shown, at 3x pixel density

/** Crops the centre square (nudged up on tall photos, where faces usually are)
 *  and resizes it to `size` px. Falls back to the original file if the browser
 *  can't read it. */
export async function squareImage(file: File, size = DEFAULT_SIZE): Promise<Blob> {
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

const PHOTO_MAX_EDGE = 1600; // sharp in the feed and full-screen, ~8x smaller than a phone original

export type UploadFile = { blob: Blob; mimeType: string; ext: string };

/** For activity photos: longest side down to 1600px as a JPEG. Videos, GIFs,
 *  photos already that small, and anything the browser can't read (e.g. HEIC
 *  outside Safari) are returned untouched. */
export async function fitPhoto(file: UploadFile): Promise<UploadFile> {
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
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    return blob ? { blob, mimeType: 'image/jpeg', ext: 'jpg' } : file;
  } catch {
    return file;
  }
}
