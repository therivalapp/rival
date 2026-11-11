import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getLive, updateLive, subscribeLive } from './liveActivityStore';
import { liveSeconds } from './liveActivity';
import { metresBetween, type TrackPoint } from './liveTrack';

// GPS for Start (2026-11-10): records the route of a run, walk, ride or day
// on the snow into the live activity, so the run screen's distance, pace,
// splits and map (lib/liveTrack.ts) and the save (lib/saveLiveActivity.ts)
// have real points.
//
// iPhone app: expo-location's background updates, so the route keeps
// recording with the screen locked and the phone in a pocket (the blue
// location pill shows while it runs). Only "While using" permission is
// needed: updates started in the app carry on in the background.
// Web: the browser's watchPosition, which records while the page is open.
//
// Points taken while paused are dropped; each resume starts a new segment,
// so the gap walked while paused isn't added to the distance.

export const ROUTE_TYPES = new Set([
  'Run', 'TrailRun', 'Walk', 'Hike', 'Snowshoe',
  'Ride', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide',
  'AlpineSki', 'Snowboard', 'BackcountrySki', 'NordicSki',
  'Kayaking', 'StandUpPaddling', 'Sail', 'InlineSkate', 'Wheelchair', 'Golf',
]);

const TASK = 'rival-live-route';
// Fixes worse than this (in metres) are left out: indoors, under trees,
// or the first seconds before the phone locks on.
const MAX_ACCURACY = 30;
// Closer than this to the last point is standing still, not moving.
const MIN_STEP = 3;

type Fix = { latitude: number; longitude: number; altitude?: number | null; accuracy?: number | null; timestamp: number };

export type GpsState = 'off' | 'searching' | 'on' | 'denied' | 'unavailable';
let state: GpsState = 'off';
const listeners = new Set<() => void>();
function setState(next: GpsState) {
  if (next === state) return;
  state = next;
  listeners.forEach((fn) => fn());
}

/** Whether the route is recording, for a note on the run screen. */
export function useGpsState(): GpsState {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state, () => state);
}

function addFixes(fixes: Fix[]) {
  const live = getLive();
  if (!live || live.pausedAt != null || !ROUTE_TYPES.has(live.activityType)) return;
  const track = live.track ?? [];
  const seg = live.trackSeg ?? 0;
  const added: TrackPoint[] = [];
  for (const f of fixes) {
    if (f.accuracy != null && f.accuracy > MAX_ACCURACY) continue;
    if (f.timestamp < live.startedAt) continue;
    const p: TrackPoint = { lat: f.latitude, lon: f.longitude, s: liveSeconds(live, f.timestamp), alt: f.altitude ?? null, seg };
    const prev = added[added.length - 1] ?? track[track.length - 1];
    if (prev && (prev.seg ?? 0) === seg && metresBetween(prev, p) < MIN_STEP) continue;
    added.push(p);
  }
  if (state === 'searching' && added.length) setState('on');
  if (added.length) updateLive({ track: [...track, ...added] });
}

// Must be defined when the app loads, so iOS can hand it points even after
// it has woken the app in the background (imported in app/_layout.tsx).
if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    if (error || !data?.locations) return;
    addFixes(data.locations.map((l) => ({ ...l.coords, timestamp: l.timestamp })));
  });
}

let webWatch: number | null = null;

/** Starts recording the route, asking for location the first time. */
export async function startRoute(): Promise<GpsState> {
  setState('searching');
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setState('unavailable'); return state; }
    if (webWatch != null) return state;
    webWatch = navigator.geolocation.watchPosition(
      (pos) => addFixes([{ ...pos.coords, timestamp: pos.timestamp }]),
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'searching'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    return state;
  }
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) { setState('denied'); return state; }
    if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) return state;
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      activityType: Location.ActivityType.Fitness,
      distanceInterval: 5,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'RIVAL',
        notificationBody: 'Recording the route.',
        notificationColor: '#ffb59e',
      },
    });
  } catch {
    setState('unavailable');
  }
  return state;
}

/** Stops recording: at Save or Discard. */
export async function stopRoute() {
  setState('off');
  if (Platform.OS === 'web') {
    if (webWatch != null && typeof navigator !== 'undefined') navigator.geolocation.clearWatch(webWatch);
    webWatch = null;
    return;
  }
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  } catch { /* already stopped */ }
}

// Follows the activity being recorded: starts with a route activity
// (including after the app reopens mid-run) and stops at Save or Discard.
function follow() {
  const live = getLive();
  const wanted = !!live && ROUTE_TYPES.has(live.activityType);
  if (wanted && state === 'off') startRoute();
  else if (!wanted && state !== 'off') stopRoute();
}
subscribeLive(follow);
follow();
