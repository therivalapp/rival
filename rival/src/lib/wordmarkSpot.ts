// Where the top bar's RIVAL sits, so the opening wordmark can glide into it
// (Mockup 48 · Opening v2 B). The focused page's top bar registers its
// wordmark; the opening asks for its place on screen, then hides it until the
// glide lands so the two never show at once.
type Spot = { x: number; y: number; w: number; h: number };
let node: any = null;
// Hidden from the start while an opening wordmark is on screen (the web's
// #rival-boot, or the iPhone's BootWordmark), shown when the glide lands.
let hidden = typeof document === 'undefined' ? true : !!document.getElementById('rival-boot');
const hideListeners = new Set<(h: boolean) => void>();

export function setWordmarkNode(n: any) {
  if (n) node = n;
}

export function measureWordmark(cb: (spot: Spot | null) => void) {
  if (!node) { cb(null); return; }
  if (typeof node.measureInWindow === 'function') {
    node.measureInWindow((x: number, y: number, w: number, h: number) => cb(w ? { x, y, w, h } : null));
    return;
  }
  if (typeof node.getBoundingClientRect === 'function') {
    const r = node.getBoundingClientRect();
    cb(r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
    return;
  }
  cb(null);
}

/** The top bar's own RIVAL stays hidden while the opening glides into it. */
export function setWordmarkHidden(h: boolean) {
  hidden = h;
  hideListeners.forEach((fn) => fn(h));
}
export function isWordmarkHidden() { return hidden; }
export function onWordmarkHidden(fn: (h: boolean) => void): () => void {
  hideListeners.add(fn);
  return () => { hideListeners.delete(fn); };
}
