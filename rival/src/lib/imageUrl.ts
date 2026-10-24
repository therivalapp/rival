// Every stored photo, profile picture and team logo is shown through here, at
// the size it is drawn rather than the size it was uploaded.
//
// An old upload could be a camera original (one profile picture was 24
// megapixels): drawn in a 36px circle on every post, it froze the team page on
// iPhones for half a minute while each copy was decoded (2026-10-21). Uploads
// are shrunk today (lib/imageResize.ts), but this is the guarantee: Supabase
// resizes the stored file on its side and the phone only ever receives a
// small one, whatever was uploaded.
//
// Only Supabase storage URLs change. Photos still on the phone (a picker
// preview, a blob) and other hosts pass through untouched, as do videos.

const PUBLIC = '/storage/v1/object/public/';
const RENDER = '/storage/v1/render/image/public/';

// A few fixed widths, so the same picture is resized (and cached) once per
// step rather than once per pixel size it happens to be drawn at.
const STEPS = [96, 192, 384, 768, 1080, 1600, 2048];

function step(px: number): number {
  return STEPS.find((s) => s >= px) ?? STEPS[STEPS.length - 1];
}

function isVideo(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url);
}

/** A stored image at least `width` pixels wide (enough for 3x screens when
 *  given the drawn width times 3). Pass `square` for avatars and logos. */
export function sizedImage<T extends string | null | undefined>(url: T, width: number, square = false, quality = 75): T {
  if (!url || !url.includes(PUBLIC) || isVideo(url)) return url;
  const [base, query] = url.split('?');
  const params = new URLSearchParams(query ?? '');
  const w = step(width);
  params.set('width', String(w));
  // Width alone keeps the original height (a 4032x3024 photo came back
  // 1080x3024), so both are always given: cropped to a square for avatars,
  // fitted inside the square, shape kept, for photos.
  params.set('height', String(w));
  params.set('resize', square ? 'cover' : 'contain');
  params.set('quality', String(quality));
  return `${base.replace(PUBLIC, RENDER)}?${params.toString()}` as T;
}

/** A profile picture or team logo drawn `size` points across. */
export function avatarImage<T extends string | null | undefined>(url: T, size: number): T {
  return sizedImage(url, size * 3, true);
}

/** A photo drawn across a card (the feed, the activity grid). */
export function cardPhoto<T extends string | null | undefined>(url: T): T {
  return sizedImage(url, 1080);
}

/** A photo filling the screen, or being zoomed: full size and a lighter
 *  squeeze, since it's re-compressed on top of the upload's own. */
export function fullPhoto<T extends string | null | undefined>(url: T): T {
  return sizedImage(url, 2048, false, 88);
}
