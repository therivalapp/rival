import { GYM_TYPES } from './goalProgress';
import type { LiftLine } from './liftHistory';
import type { TrackPoint } from './liveTrack';
import type { ActivityStats } from './activityStats';

// An activity being recorded as it happens (Ricky, 2026-10-31): press Start,
// the timer runs, lifts are added as you go. The time is worked out from when
// it started rather than counted, so it stays right when the phone locks or
// the app closes. Pure functions here; lib/liveActivityStore.ts keeps it.

// One line per exercise, logged once rather than set by set (Ricky,
// 2026-10-31: nobody taps a button between every set).
export type LiveLift = { name: string; sets?: number; reps?: number; weight?: number; logged?: boolean };

export type LiveActivity = {
  /** When Start was pressed, in milliseconds. */
  startedAt: number;
  activityType: string;
  /** The saved activity it came from, and its name. */
  savedId: string | null;
  name: string | null;
  lifts: LiveLift[];
  /** When Pause was pressed; null while running. */
  pausedAt?: number | null;
  /** Milliseconds spent paused so far. */
  pausedMs?: number;
  /** The route so far, once GPS records one (lib/liveTrack.ts). */
  track?: TrackPoint[];
  /** The route's current segment, counted up on every resume (lib/gpsRecorder.ts). */
  trackSeg?: number;
  /** From a watch through Apple Health, when one is connected. */
  bpm?: number | null;
  avgBpm?: number | null;
  maxBpm?: number | null;
  calories?: number | null;
  /** Steps per minute, from the phone's motion sensor (native). */
  cadence?: number | null;
  /** Seconds in each heart rate zone, 1 to 5, and the max they come from. */
  zoneSeconds?: number[] | null;
  hrMax?: number | null;
  /** Watts, from a power meter through a Garmin file or Apple Health. */
  avgPower?: number | null;
  /** The rest: steps, swim strokes, rounds, a score, a result (lib/activityStats.ts). */
  stats?: ActivityStats;
};

/** Gym activities log lifts as they go; the rest are a timer for now. */
export function logsLifts(activityType: string): boolean {
  return GYM_TYPES.has(activityType);
}

/** A saved routine as a list to work through, nothing logged yet. */
export function liftsFromSaved(lines: LiftLine[]): LiveLift[] {
  return lines.filter((l) => l?.name?.trim()).map((l) => ({ name: l.name, sets: l.sets, reps: l.reps, weight: l.weight }));
}

/** Whole seconds recorded, leaving out time spent paused. */
export function liveSeconds(live: Pick<LiveActivity, 'startedAt' | 'pausedAt' | 'pausedMs'>, now = Date.now()): number {
  return Math.max(0, Math.floor(((live.pausedAt ?? now) - live.startedAt - (live.pausedMs ?? 0)) / 1000));
}

/** The change that pauses or resumes. */
export function togglePause(live: LiveActivity, now = Date.now()): Partial<LiveActivity> {
  if (live.pausedAt == null) return { pausedAt: now };
  return { pausedAt: null, pausedMs: (live.pausedMs ?? 0) + now - live.pausedAt, trackSeg: (live.trackSeg ?? 0) + 1 };
}

/** "32:14", or "1:02:09" past the hour. */
export function liveClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The lifts to save. Anything logged means they were keeping track, so only
 *  those. Nothing logged means they lifted and forgot: the routine comes
 *  through to the review screen as planned. */
export function liftsToSave(lifts: LiveLift[]): { name: string; sets?: number; reps?: number; weight?: number }[] {
  const named = lifts.filter((l) => l.name.trim());
  const logged = named.filter((l) => l.logged);
  return (logged.length ? logged : named).map(({ name, sets, reps, weight }) => ({ name, sets, reps, weight }));
}

export function totalSets(lifts: LiveLift[]): number {
  return liftsToSave(lifts).reduce((sum, l) => sum + (l.sets ?? 0), 0);
}
