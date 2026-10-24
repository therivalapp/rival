// Activity titles on phone feed cards are never cut off with "…" (Ricky,
// 2026-10-08). Titles typed in RIVAL stop at 30 characters, which fit one line
// at full size; a longer name from Strava is set smaller so it still fits.
// react-native-web has no shrink-to-fit, so this goes by length. Anything too
// long even at the smallest size wraps rather than being cut.
const FULL_SIZE = 16;
const MIN_SIZE = 11;
const FITS_AT_FULL = 30;

export function titleFit(title: string): { fontSize: number; lineHeight: number } | null {
  const len = (title || '').length;
  if (len <= FITS_AT_FULL) return null;
  const size = Math.max(MIN_SIZE, Math.floor((FULL_SIZE * FITS_AT_FULL) / len * 2) / 2);
  return { fontSize: size, lineHeight: Math.round(size * 1.25) };
}

// The one-line band across the top of a numbers card ("Farthest ride · up from
// 40.0 km", "4th run this month"): always one line, never "…" (Ricky,
// 2026-10-14). A longer line is set a little smaller, by length.
export function bandFit(text: string): { fontSize: number } {
  const len = (text || '').length;
  if (len <= 34) return { fontSize: 12.5 };
  if (len <= 40) return { fontSize: 11.5 };
  if (len <= 46) return { fontSize: 10.5 };
  return { fontSize: 9.5 };
}
