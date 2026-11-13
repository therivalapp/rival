import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, RefreshControl, StyleSheet, View } from 'react-native';
import { reportNavScroll, resetNavShrink } from '../../lib/navShrink';
import { RivalColors } from '@/constants/rivalTheme';

// react-native-web's RefreshControl is a no-op: it strips onRefresh and
// renders a plain View (see react-native-web/dist/exports/RefreshControl).
// Every page that passed `refreshControl` to a ScrollView therefore had a
// pull-to-refresh that never fired. RIVAL runs as an installed PWA, where iOS
// also disables the browser's own pull-to-refresh, so the gesture has to be
// implemented against the scrolling element directly.
//
// Usage:
//   const { scrollProps, indicator } = usePullToRefresh(loadEverything);
//   <ScrollView {...scrollProps}>{indicator}{/* page content */}</ScrollView>

const THRESHOLD = 64;     // px of pull needed to commit to a refresh
const MAX_PULL = 96;      // px the indicator can travel
const DECIDE_PX = 10;     // movement before a gesture counts as a pull or a swipe
const RESISTANCE = 0.5;   // drag feels weighted rather than 1:1 with the finger

export function usePullToRefresh(onRefresh: () => void | Promise<void>) {
  // A callback ref into state, not a plain ref: most pages render a loading
  // screen first and only mount the ScrollView once data arrives. A plain ref
  // with a mount-time effect binds to nothing on those pages and never retries,
  // which silently left the gesture dead everywhere except the one page with no
  // loading gate. Storing the node in state re-runs the effect the moment it
  // actually appears — and again if the page swaps scrollers later.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const setScrollRef = useCallback((instance: any) => {
    setNode(instance?.getScrollableNode?.() ?? null);
  }, []);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // The listeners are attached once, so they would close over the first
  // render's values forever. Refs give them the live ones.
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (Platform.OS !== 'web' || !node) return;

    let startY = 0;
    let startX = 0;
    let decided = false;
    let tracking = false;
    // Tracked here rather than read back from state at touchend: setPull only
    // reaches a ref on the next render, so a quick flick released right at the
    // threshold could be judged on a stale value and silently not refresh.
    let distance = 0;

    const onTouchStart = (e: TouchEvent) => {
      // Only start tracking from the very top. Anywhere else the gesture
      // belongs to the scroller, and stealing it would break normal scrolling.
      if (refreshingRef.current || node.scrollTop > 0 || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      decided = false;
      distance = 0;
      tracking = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking) return;
      const delta = e.touches[0].clientY - startY;
      // A sideways swipe (the Today team cards) is never a pull: once the
      // finger has moved a little, whichever way is greater decides
      // (Ricky, 2026-11-02).
      if (!decided) {
        const across = Math.abs(e.touches[0].clientX - startX);
        if (across < DECIDE_PX && Math.abs(delta) < DECIDE_PX) return;
        decided = true;
        if (across > Math.abs(delta)) { tracking = false; distance = 0; return; }
      }
      if (delta <= 0) {
        // Pulling back up: hand the gesture back rather than fighting it.
        tracking = false;
        distance = 0;
        setPull(0);
        return;
      }
      // Needs { passive: false } to be allowed to preventDefault — without it
      // the page rubber-bands instead of showing the indicator.
      e.preventDefault();
      distance = Math.min(delta * RESISTANCE, MAX_PULL);
      setPull(distance);
    };

    const finish = async () => {
      if (!tracking) return;
      tracking = false;
      if (distance < THRESHOLD) { distance = 0; setPull(0); return; }
      distance = 0;

      refreshingRef.current = true;
      setRefreshing(true);
      setPull(THRESHOLD); // hold the indicator in place while the work happens
      try {
        await onRefreshRef.current();
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', finish, { passive: true });
    node.addEventListener('touchcancel', finish, { passive: true });
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', finish);
      node.removeEventListener('touchcancel', finish);
    };
  }, [node]);

  // Rendered as null — not as a zero-height View — while idle. A zero-height
  // child still counts as a flex child, so it collected the scroll content's
  // `gap` and pushed the first card down by that gap, opening a dark band
  // between the top nav and the hero image that bleeds up behind it.
  // A hairline, not a spinner (Mockup 48 · More motion B, Ricky 2026-11-13):
  // it grows with the pull, then runs while the page reloads.
  const indicator = pull === 0 && !refreshing ? null : (
    <View style={[styles.wrap, { height: refreshing ? Math.max(pull, 28) : pull }, { pointerEvents: 'none' }]}>
      <View
        style={[
          styles.hair,
          refreshing
            ? ({ width: 72, animationName: 'rivalHairRun', animationDuration: '1.1s', animationIterationCount: 'infinite', animationTimingFunction: 'cubic-bezier(.65,0,.35,1)' } as any)
            : { width: Math.round(72 * Math.min(pull / THRESHOLD, 1)), opacity: pull >= THRESHOLD ? 1 : 0.6 },
        ]}
      />
    </View>
  );

  // Leaving a page (say Stats, back to Today) brings the bar back full size.
  useEffect(() => (Platform.OS === 'web' ? undefined : () => resetNavShrink()), []);

  if (Platform.OS !== 'web') {
    // The iPhone app has the real pull to refresh (it only did nothing on the
    // web, see the top of this file), and its scroll drives the bottom bar's
    // shrink (lib/navShrink.ts). Before this, neither worked on iPhone.
    const nativeRefresh = async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      setRefreshing(true);
      try { await onRefreshRef.current(); } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    };
    return {
      scrollProps: {
        ref: setScrollRef,
        refreshControl: <RefreshControl refreshing={refreshing} onRefresh={nativeRefresh} tintColor={RivalColors.accentText} />,
        scrollEventThrottle: 16,
        onScroll: (e: any) => reportNavScroll(e?.nativeEvent?.contentOffset?.y ?? 0),
      } as any,
      indicator: null,
      refreshing,
    };
  }
  return { scrollProps: { ref: setScrollRef }, indicator, refreshing };
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  hair: { height: 1, borderRadius: 1, backgroundColor: RivalColors.accentText },
});
