import { getLevel, type Level } from './xp';

// Where this year's training is heading. Pure, so it can be tested.
//
// Rank itself is only ever what has been earned this calendar year — nobody is
// given a rank early. This adds two projections alongside it:
//
//  * yearEnd — keep training at the same pace and this is the rank on
//    31 December. Shown to everyone.
//  * fullYear — only for someone whose training here started after 1 January
//    (a latecomer): the rank a full year at their pace would reach. Something
//    to aim at next year, never awarded.
//
// Pace is measured from when their training began this year: 1 January for
// anyone with activities from earlier years, otherwise their first activity.
// Too little time and the projection is noise, so nothing is shown until
// MIN_DAYS have passed.

export const MIN_DAYS = 14;
const DAY = 86400000;

export type RankPace = {
  start: Date;
  latecomer: boolean;
  yearEnd: { effort: number; level: Level };
  fullYear: { effort: number; level: Level } | null;
};

export function rankPace(opts: {
  yearEffort: number;
  firstActivityEver: Date | null;
  now?: Date;
}): RankPace | null {
  const now = opts.now ?? new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  if (!opts.firstActivityEver) return null;

  const first = opts.firstActivityEver;
  const firstDay = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  const start = firstDay > yearStart ? firstDay : yearStart;
  const elapsedDays = (now.getTime() - start.getTime()) / DAY;
  if (elapsedDays < MIN_DAYS) return null;

  const perDay = opts.yearEffort / elapsedDays;
  const remainingDays = Math.max(0, (yearEnd.getTime() - now.getTime()) / DAY);
  const projected = Math.round(opts.yearEffort + perDay * remainingDays);

  // A late start by more than a fortnight counts; a first activity on
  // 3 January is not someone who missed the year.
  const latecomer = (start.getTime() - yearStart.getTime()) / DAY > MIN_DAYS;
  const daysInYear = (yearEnd.getTime() - yearStart.getTime()) / DAY;
  const full = Math.round(perDay * daysInYear);

  return {
    start,
    latecomer,
    yearEnd: { effort: projected, level: getLevel(projected) },
    fullYear: latecomer ? { effort: full, level: getLevel(full) } : null,
  };
}

/** The next round lifetime total: 1,000s under 5,000, 2,500s under 25,000,
 *  then 5,000s, so there is always one within reach. */
export function nextLifetimeMark(lifetime: number): number {
  const step = lifetime < 5000 ? 1000 : lifetime < 25000 ? 2500 : 5000;
  return (Math.floor(lifetime / step) + 1) * step;
}

// Legacy's "On pace for 20,000 by 8 November": the next round lifetime total
// and when this year's pace reaches it. Same pace as rankPace, so Legacy and
// Ranks always agree. `by` is null when there is no pace yet (too early in
// the year, or nothing logged), or when it is more than a year away; the line
// then just says how far the next mark is.
export function lifetimePace(opts: {
  lifetime: number;
  yearEffort: number;
  firstActivityEver: Date | null;
  now?: Date;
}): { target: number; toGo: number; by: Date | null } {
  const now = opts.now ?? new Date();
  const target = nextLifetimeMark(opts.lifetime);
  const toGo = Math.ceil(target - opts.lifetime);
  if (!opts.firstActivityEver || opts.yearEffort <= 0) return { target, toGo, by: null };
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const first = opts.firstActivityEver;
  const firstDay = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  const start = firstDay > yearStart ? firstDay : yearStart;
  const elapsedDays = (now.getTime() - start.getTime()) / DAY;
  if (elapsedDays < MIN_DAYS) return { target, toGo, by: null };
  const perDay = opts.yearEffort / elapsedDays;
  const days = Math.ceil(toGo / perDay);
  if (days > 365) return { target, toGo, by: null };
  return { target, toGo, by: new Date(now.getTime() + days * DAY) };
}
