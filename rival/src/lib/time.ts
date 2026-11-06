// Times, one way everywhere (Ricky, 2026-11-05: "1:53" read as 1 min 53 on
// one screen and 1 h 53 on another). Every typed time goes through the time
// box (timeFieldProps): number pad, filled like a stopwatch, always showing
// every unit as you type (00:01:53 vs 01:53:00), and is read with parseTime
// and shown with formatTime. New screens use these; see "Times" in AGENTS.md.

/** 'hms': a duration or finish time, HH:MM:SS. 'ms': a pace or short split, MM:SS. */
export type TimeKind = 'hms' | 'ms';

/** Digits typed into the time box, filled from the right like a stopwatch:
 *  153 → "00:01:53" (hms) or "01:53" (ms). Empty stays empty. */
export function maskTime(raw: string, kind: TimeKind = 'hms'): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const n = kind === 'hms' ? 6 : 4;
  const p = digits.slice(-n).padStart(n, '0');
  return kind === 'hms' ? `${p.slice(0, 2)}:${p.slice(2, 4)}:${p.slice(4, 6)}` : `${p.slice(0, 2)}:${p.slice(2, 4)}`;
}

/** Seconds from a time as typed or saved. Three parts are always
 *  hours:minutes:seconds. Two parts are read as `twoParts` says:
 *  'hours' for saved finish and goal times ("1:53" is 1 h 53, as older
 *  events were saved), 'minutes' for a pace, a split or a scanned workout
 *  ("45:30" is 45 min 30). One plain number is minutes. Null when it isn't
 *  a time. */
export function parseTime(text: string | null | undefined, twoParts: 'hours' | 'minutes' = 'hours'): number | null {
  if (!text) return null;
  const parts = text.trim().split(':').map((p) => p.trim());
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  let secs: number;
  if (n.length === 3) secs = n[0] * 3600 + n[1] * 60 + n[2];
  else if (n.length === 2) secs = twoParts === 'hours' ? n[0] * 3600 + n[1] * 60 : n[0] * 60 + n[1];
  else secs = n[0] * 60;
  return secs > 0 ? secs : null;
}

/** How a time is shown:
 *  'finish' — a race or goal finish, always with hours: "1:53:00", "0:22:41".
 *  'clock'  — a duration or split, hours only when there are any: "1:53:00", "22:41".
 *  'pace'   — minutes and seconds: "4:45".
 *  'field'  — what the time box holds for it: "01:53:00" (hms) or "04:45" (ms). */
export function formatTime(seconds: number | null | undefined, style: 'finish' | 'clock' | 'pace' | 'field', kind: TimeKind = 'hms'): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const two = (v: number) => String(v).padStart(2, '0');
  if (style === 'field') return kind === 'hms' ? `${two(h)}:${two(m)}:${two(x)}` : `${two(Math.floor(s / 60))}:${two(x)}`;
  if (style === 'pace') return `${Math.floor(s / 60)}:${two(x)}`;
  if (style === 'finish' || h > 0) return `${h}:${two(m)}:${two(x)}`;
  return `${m}:${two(x)}`;
}

/** A saved finish or goal time shown in full: "1:53" → "1:53:00". */
export function showFinish(text: string | null | undefined): string {
  return formatTime(parseTime(text, 'hours'), 'finish') || (text ?? '');
}

/** Spread onto any text box to make it the time box. */
export function timeFieldProps(kind: TimeKind, value: string, onChange: (v: string) => void) {
  return {
    value,
    onChangeText: (v: string) => onChange(maskTime(v, kind)),
    keyboardType: 'number-pad' as const,
    inputMode: 'numeric' as const,
    autoComplete: 'off' as const,
    autoCorrect: false,
    autoCapitalize: 'none' as const,
    placeholder: kind === 'hms' ? '00:00:00' : '00:00',
  };
}
