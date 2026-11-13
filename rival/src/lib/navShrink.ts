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

/** Call with a page's vertical scroll offset on every scroll event. */
export function reportNavScroll(y: number) {
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
