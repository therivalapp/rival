// Georgia draws old-style numbers: 6 and 8 rise above the others, while
// 3, 4, 5, 7 and 9 drop below the line. A "6" alone looked high in a ring and
// a "7" looked low (Ricky, 2026-11-15). This moves a serif number so its ink,
// not its line box, sits where a plain "0" would. Measured from Georgia bold
// italic at 100px: [ascent, descent] in em.
const GLYPH: Record<string, [number, number]> = {
  '0': [0.542, 0.017], '1': [0.541, 0], '2': [0.542, 0], '3': [0.542, 0.18], '4': [0.539, 0.18],
  '5': [0.526, 0.18], '6': [0.712, 0.017], '7': [0.526, 0.18], '8': [0.713, 0.018], '9': [0.542, 0.183],
};
const REF = (GLYPH['0'][0] - GLYPH['0'][1]) / 2;

/** translateY (px) that centres a Georgia number's ink, or 0 for text with
 *  no digits. Commas, points and colons are left out: the digits lead. */
export function inkNudge(text: string, fontSize: number): number {
  let up = 0, down = 0, any = false;
  for (const ch of text) {
    const g = GLYPH[ch];
    if (!g) continue;
    any = true;
    up = Math.max(up, g[0]);
    down = Math.max(down, g[1]);
  }
  if (!any) return 0;
  return Math.round(((up - down) / 2 - REF) * fontSize * 10) / 10;
}
