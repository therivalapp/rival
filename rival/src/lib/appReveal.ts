// Opening the app gently (Ricky, 2026-10-24): only the RIVAL wordmark shows
// while the app loads, then the app (bottom bar included) fades in over it
// once Today has drawn, instead of everything appearing at once. Today calls
// revealApp(); the root layout, the bottom bar and Today's own animations
// wait for it.

let done = false;
const listeners = new Set<() => void>();
// Shown comes two frames after the reveal: Today does its own work at the
// reveal (the podium and rings starting over), and the fade only starts once
// that has drawn. Starting both together made the fade jump straight to the
// finished page (Ricky, 2026-10-24: "it flickers as it transitions"). The fade
// itself is CSS, set off by the rival-shown class on <html> (+html.tsx), so a
// busy moment can't hold it up or make the app re-render to start it.
// Native has no wordmark and no fade: shown from the start.
let shown = typeof document === 'undefined';
const shownListeners = new Set<() => void>();

let pending = false;
export function revealApp() {
  if (done || pending) return;
  pending = true;
  const fire = () => {
    if (done) return;
    done = true;
    listeners.forEach((fn) => fn());
    listeners.clear();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      shown = true;
      document.getElementById('rival-boot')?.remove();
      document.documentElement.classList.add('rival-shown');
      shownListeners.forEach((fn) => fn());
      shownListeners.clear();
      // Once the fade is over (+html.tsx drops the fade's transition).
      setTimeout(() => document.documentElement.classList.add('rival-ready'), 800);
    }));
  };
  // The fonts first, or the text changes shape mid-fade as Manrope arrives
  // (Ricky, 2026-10-24: "a little jumpy"). Never more than a second.
  // The stylesheet first (+html.tsx adds it without blocking the page), then
  // the weights the app uses, asked for outright rather than waiting for the
  // page to lay out with them.
  const fonts = typeof document !== 'undefined' ? (document as any).fonts : null;
  const sheet: Promise<unknown> = (typeof window !== 'undefined' && (window as any).__rivalFonts) || Promise.resolve();
  if (fonts?.load) {
    const files = () => Promise.all(['300', '400', '500', '600', '700', '800'].map((w) => fonts.load(`${w} 16px Manrope`)));
    Promise.race([sheet.then(files), new Promise((r) => setTimeout(r, 1000))]).then(fire, fire);
  } else fire();
}

export function isAppRevealed(): boolean {
  return done;
}

/** Runs `fn` once the app is revealed (now, if it already is). */
export function onAppReveal(fn: () => void): () => void {
  if (done) { fn(); return () => {}; }
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isAppShown(): boolean {
  return shown;
}

/** Runs `fn` once the app has started fading in (now, if it has). */
export function onAppShown(fn: () => void): () => void {
  if (shown) { fn(); return () => {}; }
  shownListeners.add(fn);
  return () => { shownListeners.delete(fn); };
}
