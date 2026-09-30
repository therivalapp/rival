// A season is a calendar year in the person's own time zone: it starts at
// midnight on 1 January where they are, the same way weeks start at their own
// Monday midnight. The server's end-of-season snapshot (season-rollover) uses
// the time zone the app records on users.timezone, so the archived total
// matches what the person saw on their last evening of the season.

export function getCurrentSeasonYear(): number {
  return new Date().getFullYear();
}

export function getSeasonStartISO(year: number = getCurrentSeasonYear()): string {
  return new Date(year, 0, 1, 0, 0, 0).toISOString();
}

export function getSeasonEndISO(year: number = getCurrentSeasonYear()): string {
  return new Date(year + 1, 0, 1, 0, 0, 0).toISOString();
}

// Counted in calendar days rather than raw hours, so a daylight-saving change
// between now and New Year cannot tip the count by one.
export function daysUntilSeasonEnd(): number {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const end = Date.UTC(now.getFullYear() + 1, 0, 1);
  return Math.round((end - today) / (1000 * 60 * 60 * 24));
}

// The device's IANA zone ("America/Toronto"), or null where the platform does
// not report one.
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
