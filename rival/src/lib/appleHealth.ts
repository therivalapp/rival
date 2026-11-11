import { AppState, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { encodePolyline } from './polyline';
import { elevationGain } from './liveTrack';
import { invalidateActivityCache } from './fetchAllActivities';

// Apple Health (2026-11-10): workouts from an Apple Watch, or from any app
// that writes to Health (Garmin Connect, Strava, Nike Run Club and others),
// come into RIVAL. Connecting brings in every past workout once; after that,
// new ones arrive whenever the app opens. Each goes through the
// import-activities edge function, which links anything already in RIVAL
// (a run recorded with Start, an archive import) instead of copying it.
//
// iPhone app only: Health doesn't exist on the web. Health never says whether
// reading was allowed, so "connected" means the member went through the
// Health permission sheet; a workout list that stays empty is the only sign
// reading was turned off.

const CONNECTED = 'rival.health.connected';
const ANCHOR = 'rival.health.anchor';
const BATCH = 25;

export const healthAvailable = Platform.OS === 'ios';

// Health's workout types (HKWorkoutActivityType) to RIVAL's.
const TYPES: Record<number, string> = {
  1: 'Football', 3: 'Football', 4: 'Badminton', 5: 'Workout', 6: 'Basketball', 8: 'MartialArts',
  9: 'RockClimbing', 10: 'Cricket', 11: 'CrossFit', 13: 'Ride', 14: 'Workout', 15: 'Workout',
  16: 'Elliptical', 18: 'Fencing', 20: 'WeightTraining', 21: 'Golf', 22: 'Gymnastics', 23: 'Handball',
  24: 'Hike', 25: 'FieldHockey', 27: 'Lacrosse', 28: 'MartialArts', 29: 'Yoga', 30: 'HIIT',
  31: 'Kayaking', 34: 'Racquetball', 35: 'Rowing', 36: 'Rugby', 37: 'Run', 38: 'Sail',
  39: 'IceSkate', 40: 'AlpineSki', 41: 'Soccer', 43: 'Squash', 44: 'StairStepper', 45: 'Surfing',
  46: 'Swim', 47: 'TableTennis', 48: 'Tennis', 49: 'TrackAndField', 50: 'WeightTraining',
  51: 'Volleyball', 52: 'Walk', 56: 'MartialArts', 57: 'Yoga', 58: 'Pilates', 59: 'Workout',
  60: 'NordicSki', 61: 'AlpineSki', 62: 'Yoga', 63: 'HIIT', 64: 'Workout', 65: 'MartialArts',
  66: 'Pilates', 67: 'Snowboard', 68: 'StairStepper', 69: 'Workout', 70: 'Wheelchair', 71: 'Wheelchair',
  72: 'Yoga', 73: 'Workout', 74: 'Handcycle', 75: 'Frisbee', 77: 'Workout', 79: 'Pickleball',
};
// Breaks, cool-downs and the parts of a multisport, which arrive on their own.
const SKIP = new Set([33, 80, 82, 83, 2998, 2999]);

function rivalType(code: number, indoor: boolean): string | null {
  if (SKIP.has(code)) return null;
  const t = TYPES[code] ?? 'Workout';
  if (indoor && t === 'Run') return 'VirtualRun';
  if (indoor && t === 'Ride') return 'VirtualRide';
  return t;
}

const metres = (q?: { quantity: number; unit: string } | null) => {
  if (!q || !Number.isFinite(q.quantity)) return null;
  const u = q.unit.toLowerCase();
  const m = u === 'km' ? q.quantity * 1000 : u === 'mi' ? q.quantity * 1609.344 : u === 'yd' ? q.quantity * 0.9144 : u === 'ft' ? q.quantity * 0.3048 : q.quantity;
  return m > 0 ? Math.round(m) : null;
};
const kcal = (q?: { quantity: number; unit: string } | null) => {
  if (!q || !Number.isFinite(q.quantity)) return null;
  const u = q.unit.toLowerCase();
  const v = u === 'kj' ? q.quantity / 4.184 : u === 'cal' ? q.quantity / 1000 : q.quantity;
  return v > 0 ? Math.round(v) : null;
};

// ---- Status, for the Connected devices row ------------------------------------

export type HealthStatus =
  | { state: 'off' }
  | { state: 'syncing' }
  | { state: 'connected'; lastSync: number | null; imported: number }
  | { state: 'error'; message: string };

let status: HealthStatus = { state: 'off' };
const listeners = new Set<() => void>();
function setStatus(next: HealthStatus) {
  status = next;
  listeners.forEach((fn) => fn());
}

export function useHealthStatus(): HealthStatus {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => status, () => status);
}

// The connection belongs to the person who made it, not the phone.
async function key(name: string): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? `${name}.${session.user.id}` : null;
}

type Saved = { lastSync: number | null; imported: number };
async function readSaved(): Promise<Saved | null> {
  const k = await key(CONNECTED);
  if (!k) return null;
  const raw = await AsyncStorage.getItem(k).catch(() => null);
  try { return raw ? (JSON.parse(raw) as Saved) : null; } catch { return null; }
}

async function loadStatus() {
  if (!healthAvailable) return;
  const saved = await readSaved();
  if (!saved) { if (status.state !== 'syncing') setStatus({ state: 'off' }); return; }
  if (status.state !== 'syncing') setStatus({ state: 'connected', ...saved });
}

// ---- Reading Health ---------------------------------------------------------------

async function healthKit() {
  return await import('@kingstinct/react-native-healthkit');
}

export type HealthItem = {
  key: string;
  provider: 'apple_health';
  providerId: string;
  name: string | null;
  type: string;
  startedAt: string;
  utcOffsetSeconds: number;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationMeters: number | null;
  polyline: string | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  calories: number | null;
};

/** Apple's permission sheet. Health never says what was allowed. */
export async function askHealth(): Promise<boolean> {
  if (!healthAvailable) return false;
  try {
    const HK = await healthKit();
    await HK.requestAuthorization({
      toRead: [
        'HKWorkoutTypeIdentifier',
        'HKWorkoutRouteTypeIdentifier',
        'HKQuantityTypeIdentifierHeartRate',
        'HKQuantityTypeIdentifierActiveEnergyBurned',
        'HKQuantityTypeIdentifierDistanceWalkingRunning',
        'HKQuantityTypeIdentifierDistanceCycling',
        'HKQuantityTypeIdentifierDistanceSwimming',
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/** Workouts in Health since the last sync (all of them the first time),
 *  ready to send, and the anchor to save once they are in. */
export async function readHealth(onProgress?: (done: number, total: number) => void): Promise<{ items: HealthItem[]; found: number; anchor: string }> {
  const HK = await healthKit();
  const ak = await key(ANCHOR);
  const anchor = ak ? (await AsyncStorage.getItem(ak).catch(() => null)) ?? undefined : undefined;
  const res = await HK.queryWorkoutSamplesWithAnchor({ limit: 0, anchor });
  // RIVAL never writes to Health, so nothing comes back round.
  const workouts = res.workouts.filter((w) => w.sourceRevision?.source?.bundleIdentifier !== 'com.therivalapp.rival');
  const items: HealthItem[] = [];
  for (let n = 0; n < workouts.length; n++) {
    const w = workouts[n];
    onProgress?.(n, workouts.length);
    const type = rivalType(Number(w.workoutActivityType), !!w.metadata?.HKIndoorWorkout);
    if (!type) continue;
    const seconds = Math.round((w.endDate.getTime() - w.startDate.getTime()) / 1000);
    if (seconds < 60) continue;
    let avgHr: number | null = null;
    let maxHr: number | null = null;
    try {
      const hr = await w.getStatistic('HKQuantityTypeIdentifierHeartRate', 'count/min');
      avgHr = hr?.averageQuantity?.quantity ?? null;
      maxHr = hr?.maximumQuantity?.quantity ?? null;
    } catch { /* no heart rate */ }
    let polyline: string | null = null;
    let climb: number | null = null;
    try {
      const routes = await w.getWorkoutRoutes();
      const pts = routes.flatMap((r) => r.locations).filter((l) => l.horizontalAccuracy == null || l.horizontalAccuracy <= 50);
      if (pts.length >= 2) {
        polyline = encodePolyline(pts.map((l) => [l.latitude, l.longitude] as [number, number]));
        climb = elevationGain(pts.map((l, i) => ({ lat: l.latitude, lon: l.longitude, s: i, alt: l.altitude })));
      }
    } catch { /* no route */ }
    items.push({
      key: w.uuid, provider: 'apple_health', providerId: w.uuid, name: null, type,
      startedAt: w.startDate.toISOString(),
      utcOffsetSeconds: -w.startDate.getTimezoneOffset() * 60,
      durationSeconds: seconds,
      distanceMeters: metres(w.totalDistance),
      elevationMeters: climb,
      polyline,
      avgHeartrate: avgHr,
      maxHeartrate: maxHr,
      calories: kcal(w.totalEnergyBurned),
    });
  }
  onProgress?.(workouts.length, workouts.length);
  return { items, found: workouts.length, anchor: res.newAnchor };
}

/** Which workouts are new to RIVAL, without writing anything. */
export async function previewHealth(items: HealthItem[], onProgress?: (done: number) => void): Promise<Set<string>> {
  const fresh = new Set<string>();
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const { data, error } = await supabase.functions.invoke('import-activities', {
      body: { preview: true, items: chunk.map(({ key, provider, providerId, startedAt }) => ({ key, provider, providerId, startedAt })) },
    });
    if (error) throw error;
    ((data?.results ?? []) as { key: string; status: string }[]).forEach((r) => { if (r.status === 'new') fresh.add(r.key); });
    onProgress?.(Math.min(i + BATCH, items.length));
  }
  return fresh;
}

export type HealthResult = { key: string; status: string; id?: string; effort?: number };

/** Sends workouts to RIVAL. Anything already there is linked, not copied. */
export async function importHealth(items: HealthItem[], onProgress?: (done: number, routes: number) => void): Promise<HealthResult[]> {
  const results: HealthResult[] = [];
  let routes = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const { data, error } = await supabase.functions.invoke('import-activities', { body: { items: chunk } });
    if (error) throw error;
    const got = (data?.results ?? []) as HealthResult[];
    results.push(...got);
    routes += chunk.filter((c) => c.polyline && got.find((r) => r.key === c.key)?.status === 'imported').length;
    onProgress?.(Math.min(i + BATCH, items.length), routes);
  }
  if (results.some((r) => r.status === 'imported')) invalidateActivityCache();
  return results;
}

/** Saves the connection once the first import is in; from then on new
 *  workouts arrive on their own. */
export async function finishConnect(anchor: string, imported: number) {
  const [ck, ak] = await Promise.all([key(CONNECTED), key(ANCHOR)]);
  if (!ck || !ak) return;
  const saved: Saved = { lastSync: Date.now(), imported };
  await AsyncStorage.setItem(ak, anchor);
  await AsyncStorage.setItem(ck, JSON.stringify(saved));
  setStatus({ state: 'connected', ...saved });
}

/** Forgets the connection on this phone. Imported activities stay. */
export async function disconnectHealth() {
  const [c, a] = await Promise.all([key(CONNECTED), key(ANCHOR)]);
  if (c) await AsyncStorage.removeItem(c).catch(() => {});
  if (a) await AsyncStorage.removeItem(a).catch(() => {});
  setStatus({ state: 'off' });
}

// ---- Sync: new workouts, once connected -----------------------------------------

let running: Promise<HealthStatus> | null = null;
let lastRun = 0;

/** Brings in workouts added to Health since the last sync: the Sync button,
 *  opening the app, and pulling to refresh the Activity page. */
export function syncHealth(): Promise<HealthStatus> {
  if (!running) running = runSync().finally(() => { running = null; lastRun = Date.now(); });
  return running;
}

async function runSync(): Promise<HealthStatus> {
  if (!healthAvailable) return status;
  const saved = await readSaved();
  if (!saved) return status;
  setStatus({ state: 'syncing' });
  try {
    const { items, anchor } = await readHealth();
    const results = items.length ? await importHealth(items) : [];
    const imported = results.filter((r) => r.status === 'imported').length;
    const ck = await key(CONNECTED);
    const ak = await key(ANCHOR);
    const next: Saved = { lastSync: Date.now(), imported: saved.imported + imported };
    if (ak) await AsyncStorage.setItem(ak, anchor);
    if (ck) await AsyncStorage.setItem(ck, JSON.stringify(next));
    setStatus({ state: 'connected', ...next });
  } catch {
    setStatus({ state: 'error', message: 'Apple Health could not be synced. Try again.' });
  }
  return status;
}

// Automatic: when the app opens or comes back to the screen, at most once a
// minute, once connected.
function autoSync() {
  loadStatus().then(() => {
    if (status.state === 'connected' && Date.now() - lastRun > 60_000) syncHealth();
  });
}
if (healthAvailable) {
  autoSync();
  AppState.addEventListener('change', (s) => { if (s === 'active') autoSync(); });
  supabase.auth.onAuthStateChange(() => { loadStatus(); });
}
