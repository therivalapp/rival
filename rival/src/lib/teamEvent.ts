// Team event results (Mockups 80 v3 and 85 v2, Ricky 2026-11-15). Everyone
// taking part has one result from the event day: a finish time, the laps of a
// laps event (its distance is the lap), or the km of a set-time event. Anyone who stopped short keeps
// their km in the same list, never a DNF. The top three get podium colours.

export type EventFormat = 'finish' | 'laps' | 'timed';

export type EventAct = {
  id: string; user_id: string; started_at: string; activity_type: string;
  duration_seconds: number | null; distance_meters: number | null; race_id: string | null;
};

export type EventResult = {
  userId: string;
  activityId: string;
  /** Finished a finish-time event (or any laps / set-time result). */
  finished: boolean;
  seconds: number;
  km: number;
  /** Laps completed (laps events). */
  laps: number;
  pb: boolean;
};

/** A backyard ultra loop, 4.167 miles: the lap when none is set. */
export const YARD_KM = 6.7056;

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The activity that stands for the event: one linked to an event, else the
 *  day's longest. */
function eventActivity(acts: EventAct[]): EventAct | null {
  if (!acts.length) return null;
  const linked = acts.filter((a) => a.race_id);
  const pool = linked.length ? linked : acts;
  return pool.reduce((best, a) => ((a.distance_meters || 0) > (best.distance_meters || 0) || ((a.distance_meters || 0) === (best.distance_meters || 0) && (a.duration_seconds || 0) > (best.duration_seconds || 0)) ? a : best));
}

/** Each participant's result, in the order the list shows them. `history` is
 *  each person's earlier activities, for PBs: a finish beats every earlier
 *  time over about the same distance; laps or a set time goes further
 *  than any earlier activity of its type. */
export function eventResults(args: {
  format: EventFormat;
  date: string;
  distanceKm: number | null;
  participants: string[];
  activities: EventAct[];
}): EventResult[] {
  const { format, date, distanceKm, participants, activities } = args;
  const out: EventResult[] = [];
  for (const userId of participants) {
    const mine = activities.filter((a) => a.user_id === userId);
    const act = eventActivity(mine.filter((a) => localDay(a.started_at) === date));
    if (!act) continue;
    const km = (act.distance_meters || 0) / 1000;
    const seconds = act.duration_seconds || 0;
    const finished = format !== 'finish' || !distanceKm || km >= distanceKm * 0.9;
    const before = mine.filter((a) => a.started_at < act.started_at && a.activity_type === act.activity_type);
    let pb = false;
    if (format === 'finish') {
      if (finished && distanceKm && seconds > 0) {
        const same = before.filter((a) => {
          const k = (a.distance_meters || 0) / 1000;
          return k >= distanceKm * 0.97 && k <= distanceKm * 1.03 && (a.duration_seconds || 0) > 0;
        });
        pb = same.length > 0 && same.every((a) => (a.duration_seconds || 0) > seconds);
      }
    } else {
      pb = km > 0 && before.length > 0 && before.every((a) => (a.distance_meters || 0) < act.distance_meters!);
    }
    out.push({ userId, activityId: act.id, finished, seconds, km, laps: format === 'laps' ? Math.floor(km / (distanceKm || YARD_KM) + 1e-6) : 0, pb });
  }
  return out.sort((a, b) => {
    if (format === 'finish') {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return a.finished ? a.seconds - b.seconds : b.km - a.km;
    }
    return b.km - a.km;
  });
}

/** Whole days from today to the event (0 on the day, negative after). */
export function daysUntilEvent(date: string, today = new Date()): number {
  const a = new Date(`${date}T12:00:00`).getTime();
  const t = new Date(today); t.setHours(12, 0, 0, 0);
  return Math.round((a - t.getTime()) / 86_400_000);
}
