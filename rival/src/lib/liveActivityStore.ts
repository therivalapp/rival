import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { LiveActivity } from './liveActivity';
import type { MediaItem } from '../components/rival/MediaPicker';

// Keeps the activity being recorded on this phone until it is saved. The
// details sit in localStorage (AsyncStorage on the iPhone app) and the photos
// in IndexedDB, because a locked phone can close the app in the middle of a
// workout.

const KEY = 'rival.liveActivity';
const DB = 'rival-live';
const PHOTOS = 'photos';

let current: LiveActivity | null = read();
let photos: MediaItem[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

function read(): LiveActivity | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LiveActivity) : null;
  } catch { return null; }
}

// The iPhone app has no localStorage. Its copy is written at most every few
// seconds, since GPS changes the activity every few metres.
let nativeTimer: ReturnType<typeof setTimeout> | null = null;
function writeNative() {
  if (nativeTimer) return;
  nativeTimer = setTimeout(() => {
    nativeTimer = null;
    const value = current;
    (value ? AsyncStorage.setItem(KEY, JSON.stringify(value)) : AsyncStorage.removeItem(KEY)).catch(() => {});
  }, 3000);
}

function write(next: LiveActivity | null) {
  current = next;
  try {
    if (typeof localStorage !== 'undefined') {
      if (next) localStorage.setItem(KEY, JSON.stringify(next));
      else localStorage.removeItem(KEY);
    }
  } catch { /* still runs for as long as the app stays open */ }
  if (Platform.OS !== 'web') {
    if (next) writeNative();
    else {
      if (nativeTimer) { clearTimeout(nativeTimer); nativeTimer = null; }
      AsyncStorage.removeItem(KEY).catch(() => {});
    }
  }
  changed();
}

// The iPhone app reads its copy back once, on opening.
if (Platform.OS !== 'web' && !current) {
  AsyncStorage.getItem(KEY).then((raw) => {
    if (!raw || current) return;
    try { current = JSON.parse(raw) as LiveActivity; changed(); } catch { /* unreadable; start fresh */ }
  }).catch(() => {});
}

function openDb(): Promise<IDBDatabase | null> {
  if (Platform.OS !== 'web' || typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(PHOTOS);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function writePhotos(items: MediaItem[]) {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(PHOTOS, 'readwrite');
  tx.objectStore(PHOTOS).put(items.map(({ blob, type, mimeType, ext }) => ({ blob, type, mimeType, ext })), 'items');
  tx.oncomplete = () => db.close();
}

async function readPhotos(): Promise<MediaItem[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(PHOTOS).objectStore(PHOTOS).get('items');
    req.onsuccess = () => {
      db.close();
      const rows: Omit<MediaItem, 'uri'>[] = req.result ?? [];
      resolve(rows.filter((r) => r.blob).map((r) => ({ ...r, uri: URL.createObjectURL(r.blob as Blob) })));
    };
    req.onerror = () => { db.close(); resolve([]); };
  });
}

// After a reopen the photos are read back once.
if (current) readPhotos().then((items) => { if (items.length) { photos = items; changed(); } }).catch(() => {});

// Signing out ends it: the next person on this phone must not inherit it.
supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') clearLive(); });

export function getLive(): LiveActivity | null { return current; }
export function getLivePhotos(): MediaItem[] { return photos; }

export function startLive(activity: Omit<LiveActivity, 'startedAt'>) {
  write({ ...activity, startedAt: Date.now() });
}

export function updateLive(patch: Partial<LiveActivity>) {
  if (current) write({ ...current, ...patch });
}

export function addLivePhotos(items: MediaItem[]) {
  photos = [...photos, ...items];
  changed();
  writePhotos(photos).catch(() => {});
}

/** The photos chosen to keep, after looking through them at Finish. */
export function setLivePhotos(items: MediaItem[]) {
  photos = items;
  changed();
  writePhotos(photos).catch(() => {});
}

/** Saved or discarded. */
export function clearLive() {
  photos = [];
  write(null);
  writePhotos([]).catch(() => {});
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/** Called on every change to the activity being recorded (lib/gpsRecorder.ts). */
export const subscribeLive = subscribe;

/** The activity being recorded, redrawn as it changes. */
export function useLive(): { live: LiveActivity | null; photos: MediaItem[] } {
  return { live: useSyncExternalStore(subscribe, getLive), photos: useSyncExternalStore(subscribe, getLivePhotos) };
}

/** The current time, once a second, while `on`. */
export function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
