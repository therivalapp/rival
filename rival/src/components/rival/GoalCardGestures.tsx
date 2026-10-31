import { useCallback, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalColors, RivalGhost } from '../../constants/rivalTheme';
import { RivalIcon } from './RivalIcon';

// Two touch gestures on a Goals card (Ricky, 2026-10-28):
// - Swipe left to show a Delete button behind the card; tap it to delete.
//   Swipe back right, or tap the card, to close it.
// - Hold, then drag the card up onto Main focus to make it the focus.
//
// Web only, like useSheetDrag: it listens to the card's own touches, so it
// never competes with React Native's gesture system. A tap that ends a swipe
// or a drag must not also open the card, so the card's onPress goes through
// `guard`, which swallows the press that follows a gesture.

const DELETE_WIDTH = 88;
const HOLD_MS = 380;
const SLOP = 8;

export function GoalCardGestures({
  onDelete, focusTarget, onHoverFocus, onDropOnFocus, onUsed, radius = 16, children,
}: {
  onDelete: () => void;
  /** Main focus card; leave out for a card that can't be dragged there. */
  focusTarget?: () => HTMLElement | null;
  onHoverFocus?: (over: boolean) => void;
  onDropOnFocus?: () => void;
  /** Called when a swipe or a drag ends (not during: the page would reflow under the card). */
  onUsed?: () => void;
  radius?: number;
  children: (guard: (fn: () => void) => () => void) => ReactNode;
}) {
  const consumed = useRef(false);
  const openRef = useRef(false);
  const closeRef = useRef<() => void>(() => {});
  const cb = useRef({ onHoverFocus, onDropOnFocus, focusTarget, onUsed });
  cb.current = { onHoverFocus, onDropOnFocus, focusTarget, onUsed };
  const cleanup = useRef<(() => void) | null>(null);

  const guard = useCallback((fn: () => void) => () => {
    if (consumed.current) { consumed.current = false; return; }
    if (openRef.current) { closeRef.current(); return; }
    fn();
  }, []);

  const attach = useCallback((node: any) => {
    cleanup.current?.();
    cleanup.current = null;
    if (Platform.OS !== 'web' || !node || typeof node.addEventListener !== 'function') return;
    const el = node as HTMLElement;

    let startX = 0, startY = 0, dx = 0, dy = 0, base = 0;
    let state: 'idle' | 'maybe' | 'swipe' | 'drag' | 'off' = 'idle';
    let hold: number | undefined;
    let over = false;

    // The red Delete layer shows only while the card is slid aside, so it
    // never peeks round the card's rounded corners or under a lifted card.
    const behind = el.previousElementSibling as HTMLElement | null;
    let hideBehind: number | undefined;
    const slide = (x: number, animate: boolean) => {
      window.clearTimeout(hideBehind);
      if (x < 0 && behind) behind.style.opacity = '1';
      else if (behind) hideBehind = window.setTimeout(() => { behind.style.opacity = '0'; }, animate ? 220 : 0);
      el.style.transition = animate ? 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)' : '';
      el.style.transform = x ? `translateX(${x}px)` : '';
    };
    const close = () => { openRef.current = false; slide(0, true); };
    closeRef.current = close;

    const lift = (y: number) => {
      el.style.transform = `translateY(${y}px) scale(1.03)`;
    };
    const overFocus = () => {
      const target = cb.current.focusTarget?.();
      if (!target) return false;
      const t = target.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      const mid = c.top + c.height / 2;
      return mid < t.bottom && mid > t.top - 40;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { state = 'off'; return; }
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; dx = 0; dy = 0;
      base = openRef.current ? -DELETE_WIDTH : 0;
      consumed.current = false;
      state = 'maybe';
      window.clearTimeout(hold);
      if (cb.current.focusTarget && !openRef.current) {
        hold = window.setTimeout(() => {
          if (state !== 'maybe') return;
          state = 'drag';
          consumed.current = true;
          el.style.transition = 'transform 140ms ease-out, box-shadow 140ms ease-out';
          if (el.parentElement) el.parentElement.style.zIndex = '20';
          el.style.boxShadow = '0 14px 30px rgba(0,0,0,0.45)';
          lift(0);
          (navigator as any).vibrate?.(10);
        }, HOLD_MS);
      }
    };

    const onMove = (e: TouchEvent) => {
      if (state === 'off' || state === 'idle') return;
      dx = e.touches[0].clientX - startX;
      dy = e.touches[0].clientY - startY;
      if (state === 'maybe') {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        window.clearTimeout(hold);
        // Sideways wins only when clearly sideways; anything else scrolls.
        state = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'swipe' : 'off';
        if (state === 'off') return;
        consumed.current = true;
      }
      e.preventDefault();
      if (state === 'swipe') {
        const x = Math.min(0, Math.max(-DELETE_WIDTH - 24, base + dx));
        slide(x, false);
      } else if (state === 'drag') {
        el.style.transition = 'box-shadow 140ms ease-out';
        lift(dy);
        const now = overFocus();
        if (now !== over) { over = now; cb.current.onHoverFocus?.(now); }
      }
    };

    const onEnd = () => {
      window.clearTimeout(hold);
      if (state === 'swipe') {
        const x = base + dx;
        openRef.current = x < -DELETE_WIDTH / 2;
        slide(openRef.current ? -DELETE_WIDTH : 0, true);
      } else if (state === 'drag') {
        const drop = overFocus();
        if (over) cb.current.onHoverFocus?.(false);
        over = false;
        if (drop) {
          // The card moves to Main focus, so this one is about to be removed.
          // Settle it at once and remove it only after a painted frame: on
          // iPhone, removing it mid-animation left a stale lifted copy of it
          // drawn behind Main focus (Ricky, 2026-10-28).
          el.style.transition = '';
          el.style.transform = '';
          el.style.boxShadow = '';
          if (el.parentElement) el.parentElement.style.zIndex = '';
          requestAnimationFrame(() => requestAnimationFrame(() => cb.current.onDropOnFocus?.()));
        } else {
          el.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 220ms ease-out';
          el.style.transform = '';
          el.style.boxShadow = '';
          window.setTimeout(() => { if (el.parentElement) el.parentElement.style.zIndex = ''; el.style.transition = ''; }, 240);
        }
      }
      if (state === 'swipe' || state === 'drag') cb.current.onUsed?.();
      state = 'idle';
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    // Not passive: a swipe or a drag has to stop the page scrolling under it.
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    cleanup.current = () => {
      window.clearTimeout(hold);
      window.clearTimeout(hideBehind);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <View style={[g.wrap, { borderRadius: radius }]}>
      <View style={[g.behind, { borderRadius: radius }]}>
        <TouchableOpacity style={g.deleteBtn} onPress={() => { closeRef.current(); onDelete(); }} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Delete goal">
          <RivalIcon name="delete" size={20} color="#fff" />
          <Text style={g.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
      {/* The page colour under the card: the cards are see-through, so without
          it the red layer would show through a card slid over it. */}
      <View ref={attach} style={{ borderRadius: radius, backgroundColor: RivalGhost.ground }}>{children(guard)}</View>
    </View>
  );
}

const g = StyleSheet.create({
  wrap: { position: 'relative' },
  behind: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0, backgroundColor: RivalColors.danger, flexDirection: 'row', justifyContent: 'flex-end', overflow: 'hidden' },
  deleteBtn: { width: DELETE_WIDTH, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', gap: 4 },
  deleteText: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
});
