import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { isAppShown, onAppShown } from '../../lib/appReveal';

// A page filling in from the top down (Mockup 48 · Loading B, Ricky
// 2026-11-13): each section fades in and rises 10px, 120ms after the one
// above, once the page is showing. On the web it's CSS (rivalRiseIn in
// global.css) so a busy moment can't stall it; on iPhone the native driver.
const EASE = Easing.bezier(0.22, 0.8, 0.24, 1);

export function RiseIn({ index, children }: { index: number; children: ReactNode }) {
  const [go, setGo] = useState(isAppShown());
  useEffect(() => (go ? undefined : onAppShown(() => setGo(true))), [go]);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!go || Platform.OS === 'web') return;
    Animated.timing(v, { toValue: 1, duration: 450, delay: index * 120, easing: EASE, useNativeDriver: true }).start();
  }, [go, index, v]);
  if (Platform.OS === 'web') {
    return (
      <Animated.View style={go ? ({ animationName: 'rivalRiseIn', animationDuration: '450ms', animationTimingFunction: 'cubic-bezier(.22,.8,.24,1)', animationDelay: `${index * 120}ms`, animationFillMode: 'both' } as any) : { opacity: 0 }}>
        {children}
      </Animated.View>
    );
  }
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}
