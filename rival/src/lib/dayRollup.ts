// Gathering a person's auto-synced walks into one card per day.
//
// Kept out of the feed screen so it can be tested: the merge in particular has
// a failure mode that is invisible by inspection (folding the same page in
// twice must not double a walk count) and impossible to check by eye once it
// is tangled up with React state.
//
// It decides PRESENTATION, never whether something counts — Effort is
// unaffected either way.

export type RollupPart = { seconds: number; xp: number };

export type RollupRow = {
  id: string;
  user_id: string;
  activity_type: string | null;
  provider: string | null;
  started_at: string;
  duration_seconds: number | null;
  effort_score: number | null;
};

export type DayRollup = {
  id: string;
  userId: string;
  dayIso: string;
  // The activities folded in, keyed by id, so merging pages is a union rather
  // than a sum and folding the same page twice changes nothing.
  parts: Record<string, RollupPart>;
  count: number;
  totalSeconds: number;
  xp: number;
  typeLabel: string;
  // The EARLIEST walk of the day, not the latest, so the card settles where
  // the day's walking began and stays there. Keyed on the newest it would jump
  // back up the feed every time another walk synced — noisier than the
  // separate rows it replaces.
  ts: string;
};

// Walks that arrived without anyone sitting down to log them: a watch
// uploaded it, or a training partner said you were there and you confirmed.
// 'shared' belongs here for the same reason the other two do — the walk itself
// was incidental. Confirming it was one tap on a question, not a decision to
// record a session, and a feed where your own walks gather but your walks with
// Sandy sit apart is inconsistent in a way nobody could explain.
const ROLLED_UP_PROVIDERS = new Set(['strava', 'garmin', 'shared']);

// The line is intent, not length. A walk that arrived on its own is something
// the day happened to contain; a walk someone opened the app and logged is
// something they decided was worth recording, so it keeps its own card.
// Duration was tried as the test and was the wrong one — it made a 19-minute
// walk and a 21-minute walk different kinds of thing, which is not how anyone
// experiences them.
//
// Only walks: a short auto-synced RUN is still a session someone set out to do.
export function rollsUpIntoDayCard(a: Pick<RollupRow, 'activity_type' | 'provider'>): boolean {
  return (a.activity_type || '').toLowerCase() === 'walk'
    && ROLLED_UP_PROVIDERS.has((a.provider || '').toLowerCase());
}

// LIMITATION: activities store started_at as UTC and the athlete's own timezone
// is not persisted (Strava's start_date_local is read at import but only used
// for race matching), so "their day" is the VIEWER's day. Correct while a team
// shares a timezone, which is true today. Teams spread across timezones need a
// stored local date on the activity — a migration plus every importer — and
// this should group on that instead.
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The single place derived totals are computed, so a merged rollup and a
// freshly built one can never disagree about what their parts add up to.
export function rollupFromParts(
  userId: string,
  dayIso: string,
  parts: Record<string, RollupPart>,
  ts: string,
): DayRollup {
  const values = Object.values(parts);
  return {
    id: `roll:${userId}:${dayIso}`,
    userId,
    dayIso,
    parts,
    count: values.length,
    totalSeconds: values.reduce((sum, v) => sum + v.seconds, 0),
    xp: Math.round(values.reduce((sum, v) => sum + v.xp, 0) * 10) / 10,
    typeLabel: values.length === 1 ? 'walk' : 'walks',
    ts,
  };
}

export function buildDayRollups(rows: RollupRow[]): DayRollup[] {
  const groups = new Map<string, RollupRow[]>();
  for (const a of rows) {
    if (!a.started_at) continue;
    const key = `${a.user_id}|${localDayKey(a.started_at)}`;
    const list = groups.get(key);
    if (list) list.push(a); else groups.set(key, [a]);
  }

  const out: DayRollup[] = [];
  for (const [key, list] of groups) {
    const [userId, dayIso] = key.split('|');
    const parts: Record<string, RollupPart> = {};
    for (const a of list) parts[a.id] = { seconds: a.duration_seconds || 0, xp: a.effort_score || 0 };
    const earliest = list.reduce((min, a) => (a.started_at < min ? a.started_at : min), list[0].started_at);
    out.push(rollupFromParts(userId, dayIso, parts, earliest));
  }
  return out;
}

// A day's walks can straddle a page boundary, so a rollup already on screen has
// to absorb a later page's rows rather than appear twice.
export function mergeRollups(existing: DayRollup, incoming: DayRollup): DayRollup {
  return rollupFromParts(
    existing.userId,
    existing.dayIso,
    { ...existing.parts, ...incoming.parts },
    incoming.ts < existing.ts ? incoming.ts : existing.ts,
  );
}
