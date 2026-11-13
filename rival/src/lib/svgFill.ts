import { Platform } from 'react-native';

// An SVG gradient fill with a flat colour to fall back on. The web accepts
// the CSS form `url(#id) colour` (kept for iOS Safari, which once lost a
// gradient after a resize, Ricky 2026-10-11); the iPhone app's SVG library
// cannot read that form and drew nothing, so the podium pillars vanished
// (first TestFlight open, 2026-11-11). Native gets the plain `url(#id)`.
export const svgFill = (id: string, fallback: string) =>
  Platform.OS === 'web' ? `url(#${id}) ${fallback}` : `url(#${id})`;

// A gradient stop from a CSS colour. The web reads the alpha in rgba(), but
// the iPhone app's SVG library ignores it and drew the see-through glass
// podium pillars solid (2026-11-13), so the alpha moves into stopOpacity,
// multiplied with any opacity given. Same result on both.
export function svgStop(color: string, opacity = 1): { stopColor: string; stopOpacity: number } {
  const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(color);
  if (!m) return { stopColor: color, stopOpacity: opacity };
  return { stopColor: `rgb(${m[1]},${m[2]},${m[3]})`, stopOpacity: Number(m[4]) * opacity };
}
