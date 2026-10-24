import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

// Drag a pop-up down from anywhere on it to close it, not only from its top
// edge (Ricky, 2026-10-21). A downward drag moves the sheet when what's under
// the finger is already scrolled to its top; otherwise the content scrolls as
// usual, and once it reaches the top the next drag down moves the sheet.
//
// Web only (the app runs on the web): it listens to the sheet's own touches,
// so it never competes with React Native's gesture system. Pass the returned
// ref to the sheet's outer View. Anything marked data-nodrag (a slider, a
// photo being positioned) keeps its own vertical drags.

const CLOSE_DISTANCE = 90;
const CLOSE_SPEED = 0.6; // px per ms

export function useSheetDrag(onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback((node: any) => {
    cleanup.current?.();
    cleanup.current = null;
    if (Platform.OS !== 'web' || !node || typeof node.addEventListener !== 'function') return;
    const el = node as HTMLElement;

    let startX = 0, startY = 0, lastY = 0, lastT = 0, speed = 0;
    let state: 'idle' | 'maybe' | 'drag' | 'off' = 'idle';
    let atTop = true;

    const move = (y: number) => { el.style.transform = `translateY(${Math.max(0, y)}px)`; };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { state = 'off'; return; }
      const t = e.target as HTMLElement;
      if (t.closest?.('[data-nodrag]')) { state = 'off'; return; }
      // Every scrolling box between the finger and the sheet must be at its top.
      atTop = true;
      for (let n: HTMLElement | null = t; n && n !== el.parentElement; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) { atTop = false; break; }
      }
      startX = e.touches[0].clientX; startY = lastY = e.touches[0].clientY; lastT = e.timeStamp; speed = 0;
      el.style.transition = '';
      state = 'maybe';
    };

    const onMove = (e: TouchEvent) => {
      if (state === 'off' || state === 'idle') return;
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      const dy = y - startY, dx = x - startX;
      if (state === 'maybe') {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        state = atTop && dy > 0 && Math.abs(dy) > Math.abs(dx) ? 'drag' : 'off';
        if (state === 'off') return;
      }
      // Ours now: stop the page or the list from scrolling under it.
      e.preventDefault();
      const dt = Math.max(1, e.timeStamp - lastT);
      speed = (y - lastY) / dt;
      lastY = y; lastT = e.timeStamp;
      move(dy);
    };

    const onEnd = () => {
      if (state !== 'drag') { state = 'idle'; return; }
      state = 'idle';
      const dy = lastY - startY;
      if (dy > CLOSE_DISTANCE || speed > CLOSE_SPEED) {
        // Carry on down and close; the pop-up's own exit takes it from there.
        el.style.transition = 'transform 160ms ease-in';
        move(el.offsetHeight);
        window.setTimeout(() => { closeRef.current(); }, 140);
        window.setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, 600);
      } else {
        el.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        move(0);
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    // Not passive: a drag that moves the sheet has to stop the scroll.
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    cleanup.current = () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);
}
