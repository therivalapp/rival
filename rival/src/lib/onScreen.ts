import { useEffect, useState, type RefObject } from 'react';
import { Dimensions, Platform } from 'react-native';
import { onAnyScroll } from './navShrink';

// True once the view is mostly on screen, then stays true. The web watches
// with IntersectionObserver; the iPhone app measures the view when it mounts
// and again as pages scroll (pages report scrolls via usePullToRefresh).
// For motion that should play where it can be seen, not below the fold.
export function useOnScreen(ref: RefObject<any>, enabled = true, ratio = 0.4): boolean {
  const [seen, setSeen] = useState(!enabled);
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (Platform.OS === 'web') {
      if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
      const io = new IntersectionObserver(([entry]) => {
        if (entry.intersectionRatio >= ratio) { setSeen(true); io.disconnect(); }
      }, { threshold: [0, ratio] });
      io.observe(el);
      return () => io.disconnect();
    }
    let done = false;
    const check = () => {
      const node = ref.current;
      if (done || !node?.measureInWindow) return;
      node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        if (done || !h) return;
        const screenH = Dimensions.get('window').height;
        const visible = Math.min(y + h, screenH - 80) - Math.max(y, 0);
        if (visible >= h * ratio) { done = true; setSeen(true); }
      });
    };
    const first = setTimeout(check, 400);
    const off = onAnyScroll(check);
    return () => { done = true; clearTimeout(first); off(); };
  }, [seen, ref, ratio]);
  return seen;
}
