// Shared display formatting. formatDuration was previously forked 3 ways with
// diverging output — the same 2-hour ride showed "2h" in Team feed but
// "2h 0m" on My Activities and AI Share. This canonical version uses the
// cleaner form: no trailing "0m", and empty string for missing durations.
// (scan-workout's formatDurationHMS is clock-style "1:23:45" — a different
// format for a different purpose, intentionally not merged here.)

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Clock-style "43:09" / "1:23:45" — shows seconds, unlike formatDuration above.
export function formatDurationClock(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

