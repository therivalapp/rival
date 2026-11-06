// Click and drag to scroll a sideways row with a mouse (web only).
//
// The web app is the phone app at every width (2026-11-06), and its sideways
// rows (week cards, Weekly leader cards, photo strips) are swiped on a phone.
// A mouse can't swipe, and a mouse wheel only scrolls up and down, so on a
// computer those rows were stuck. This lets a mouse drag them. Touch is left
// to the browser, and a drag that moved never also counts as a click.

const MOVE_PX = 6;

function sidewaysScroller(el: Element | null): HTMLElement | null {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return n;
    }
  }
  return null;
}

export function startMouseDragScroll(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  let box: HTMLElement | null = null;
  let startX = 0;
  let startLeft = 0;
  let moved = false;
  let snap = '';

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    box = sidewaysScroller(t);
    if (!box) return;
    startX = e.clientX;
    startLeft = box.scrollLeft;
    moved = false;
  };

  const onMove = (e: PointerEvent) => {
    if (!box) return;
    const dx = e.clientX - startX;
    if (!moved) {
      if (Math.abs(dx) < MOVE_PX) return;
      moved = true;
      // Snapping fights a drag; hand it back when the drag ends.
      snap = box.style.scrollSnapType;
      box.style.scrollSnapType = 'none';
      box.style.cursor = 'grabbing';
      document.documentElement.style.userSelect = 'none';
    }
    box.scrollLeft = startLeft - dx;
    e.preventDefault();
  };

  const onUp = () => {
    if (!box) return;
    const b = box;
    box = null;
    if (!moved) return;
    b.style.cursor = '';
    document.documentElement.style.userSelect = '';
    // Restoring snap lets the row settle on the nearest card, as a swipe does.
    b.style.scrollSnapType = snap;
    // The click that follows a drag is swallowed, so letting go over a card
    // doesn't also open it.
    const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true } as any), 0);
  };

  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  return () => {
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
  };
}
