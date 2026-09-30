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
