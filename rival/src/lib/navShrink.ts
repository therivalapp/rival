// The bottom bar shrinks while you scroll down a page and comes back on the
// way up, as on the web. The web bar watches every scroll itself (a capturing
// window listener in RivalTopNav); the iPhone app has no window, so pages
// report their scroll here through usePullToRefresh's scroll props, and
// NativeTabBar listens (2026-11-13).
type Listener = (shrunk: boolean) => void;

const listeners = new Set<Listener>();
let shrunk = false;
let lastY = 0;

function set(next: boolean) {
  if (next === shrunk) return;
  shrunk = next;
  listeners.forEach((l) => l(next));
}

// Anything that waits to be on screen (lib/onScreen.ts) re-checks on scroll.
const scrollWatchers = new Set<() => void>();
export function onAnyScroll(fn: () => void): () => void {
  scrollWatchers.add(fn);
  return () => { scrollWatchers.delete(fn); };
}

/** Call with a page's vertical scroll offset on every scroll event. */
export function reportNavScroll(y: number) {
  scrollWatchers.forEach((fn) => fn());
  const delta = y - lastY;
  lastY = y;
  if (y <= 4) set(false);
  else if (delta > 6) set(true);
  else if (delta < -6) set(false);
}

/** A new page starts with the bar full size. */
export function resetNavShrink() {
  lastY = 0;
  set(false);
}

export function subscribeNavShrink(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// Full-screen layers (the activity page) cover the bottom bar on the web by
// sitting above it; on the iPhone the bar is drawn over every tab, so those
// layers say they're open and NativeTabBar steps aside (2026-11-14).
let covers = 0;
const coverListeners = new Set<(covered: boolean) => void>();
export function coverNav(): () => void {
  covers += 1;
  coverListeners.forEach((l) => l(covers > 0));
  return () => {
    covers = Math.max(0, covers - 1);
    coverListeners.forEach((l) => l(covers > 0));
  };
}
export function subscribeNavCover(fn: (covered: boolean) => void): () => void {
  coverListeners.add(fn);
  fn(covers > 0);
  return () => { coverListeners.delete(fn); };
}
