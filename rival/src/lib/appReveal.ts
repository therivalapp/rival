// Opening the app gently (Ricky, 2026-10-24): only the RIVAL wordmark shows
// while the app loads, then the app (bottom bar included) fades in over it
// once Today has drawn, instead of everything appearing at once. Today calls
// revealApp(); the root layout, the bottom bar and Today's own animations
// wait for it.

import { getWordmarkElement, measureWordmark, setWordmarkHidden } from './wordmarkSpot';

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
      shownListeners.forEach((fn) => fn());
      shownListeners.clear();
      // The wordmark and fade are web only; the iPhone app has no document.
      if (typeof document === 'undefined') return;
      glideBoot();
      document.documentElement.classList.add('rival-shown');
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

// The loading RIVAL glides into the top bar's RIVAL as the app fades in
// (Mockup 48 · Opening v2 B, Ricky 2026-11-13), then hands over to it. With
// no top bar on the page (the welcome page), it simply goes.
const GLIDE_MS = 600;
function glideBoot() {
  const boot = document.getElementById('rival-boot');
  if (!boot) { setWordmarkHidden(false); return; }
  const finish = () => { boot.remove(); setWordmarkHidden(false); };
  measureWordmark((spot) => {
    const text = boot.firstChild;
    if (!spot || !text) { finish(); return; }
    const range = document.createRange();
    range.selectNodeContents(boot);
    const from = range.getBoundingClientRect();
    if (!from.width) { finish(); return; }
    // Pin it where it is, as a plain box at its text's own place.
    boot.style.left = `${from.left}px`;
    boot.style.top = `${from.top}px`;
    boot.style.right = 'auto';
    boot.style.textIndent = '0';
    boot.style.transform = 'none';
    boot.classList.add('rival-boot-glide');
    // Wear the top bar's own colours (its peach-to-gold gradient on phones)
    // from the start of the glide, so nothing changes colour at the landing.
    // The registered node is a wrapper; the colours are on the text inside it.
    const wrap = getWordmarkElement() as HTMLElement | null;
    const bar = wrap ? ([wrap, ...Array.from(wrap.querySelectorAll('*'))] as HTMLElement[])
      .find((el) => { const bg = getComputedStyle(el).backgroundImage; return !!bg && bg !== 'none'; })
      ?? (wrap.querySelector('*') as HTMLElement | null) ?? wrap : null;
    if (bar) {
      const cs = getComputedStyle(bar);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        boot.style.backgroundImage = cs.backgroundImage;
        (boot.style as any).webkitBackgroundClip = 'text';
        boot.style.backgroundClip = 'text';
        boot.style.color = 'transparent';
      } else if (cs.color) {
        boot.style.color = cs.color;
      }
    }
    // Line the letters up with the top bar's letters, not its box: the box
    // has padding and a taller line, so aiming at it landed RIVAL a little
    // off and it jumped into place at the hand-over (Ricky, 2026-11-14).
    // Pinning drops the centring transform, which moves the letters a pixel
    // or two; put them back exactly where they were before gliding.
    const p0 = range.getBoundingClientRect();
    const bx = from.left - (p0.left - from.left), by = from.top - (p0.top - from.top);
    boot.style.left = `${bx}px`;
    boot.style.top = `${by}px`;
    const g = range.getBoundingClientRect(); // the letters, now pinned
    const target = textRect(spot);
    const k = target.w / g.width;
    const tx = target.x - bx - k * (g.left - bx);
    const ty = target.y - by - k * (g.top - by);
    requestAnimationFrame(() => {
      boot.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    });
    // At the landing the bar's own RIVAL appears underneath, exactly in
    // place and fully solid, and only then does the gliding copy go: no
    // fade, so the word never dims or flashes (Ricky, 2026-11-14).
    setTimeout(() => {
      setWordmarkHidden(false);
      requestAnimationFrame(() => requestAnimationFrame(() => boot.remove()));
    }, GLIDE_MS + 20);
  });
}

// The top bar's RIVAL letters on screen (inside its padded box).
function textRect(spot: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number } {
  const el = getWordmarkElement();
  if (el && typeof document !== 'undefined') {
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    if (b.width) return { x: b.left, y: b.top, w: b.width };
  }
  return { x: spot.x, y: spot.y, w: spot.w };
}
