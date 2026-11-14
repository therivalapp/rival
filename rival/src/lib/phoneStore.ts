// Small things kept on this device: the browser's localStorage on the web,
// AsyncStorage on the iPhone (which has no localStorage). Reads are
// immediate, like localStorage: the iPhone copy is read into memory once when
// the app opens (loadPhoneStore in the root layout) and every write goes
// through to AsyncStorage as well (2026-11-14).

// No react-native import here: tests (and the web) load this file directly.
const native = typeof navigator !== 'undefined' && (navigator as any).product === 'ReactNative';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AsyncStorage: typeof import('@react-native-async-storage/async-storage').default = native ? require('@react-native-async-storage/async-storage').default : (null as any);
const PREFIX = 'phone:';
const memory = new Map<string, string>();
let ready: Promise<void> | null = null;

/** Reads the iPhone copy into memory. Safe to call more than once. */
export function loadPhoneStore(): Promise<void> {
  if (!native) return Promise.resolve();
  if (!ready) {
    ready = (async () => {
      try {
        const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
        const pairs = await AsyncStorage.multiGet(keys);
        // Anything written while loading stays: it is newer.
        for (const [k, v] of pairs) if (v != null && !memory.has(k.slice(PREFIX.length))) memory.set(k.slice(PREFIX.length), v);
      } catch { /* starts empty */ }
    })();
  }
  return ready;
}

export function getItem(key: string): string | null {
  if (!native) {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  return memory.get(key) ?? null;
}

export function setItem(key: string, value: string) {
  if (!native) {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* private mode */ }
    return;
  }
  memory.set(key, value);
  AsyncStorage.setItem(PREFIX + key, value).catch(() => {});
}

export function removeItem(key: string) {
  if (!native) {
    try { globalThis.localStorage?.removeItem(key); } catch { /* private mode */ }
    return;
  }
  memory.delete(key);
  AsyncStorage.removeItem(PREFIX + key).catch(() => {});
}
