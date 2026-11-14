import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { onAppReveal, revealApp } from '../../lib/appReveal';
import { measureWordmark, setWordmarkHidden } from '../../lib/wordmarkSpot';
import { RivalSerifFamily } from '../../constants/rivalTheme';
import { GradientText } from './GradientText';

// The top bar's RIVAL on phones (RivalTopNav logoNarrow): the same colours,
// so nothing changes colour at the landing.
const BAR_GRADIENT = 'linear-gradient(100deg, #D97757 0%, #ffb59e 45%, #F5B759 100%)';

// The iPhone app's opening (Mockup 48 · Opening v2 B, Ricky 2026-11-13), the
// same as the web's #rival-boot (+html.tsx): RIVAL tightens from wide
// spacing as it fades in, pulses while the app loads, then glides into the
// top bar's RIVAL as the page shows. The splash before it is the same plain
// #131313 (app.json), so the hand-over can't be seen. Web draws its own.
const SIZE = 22;
const OUT = Easing.bezier(0.22, 0.8, 0.24, 1);
const IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

export function BootWordmark() {
  const [gone, setGone] = useState(Platform.OS === 'web');
  const spacing = useRef(new Animated.Value(SIZE * 0.55)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const glide = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = useRef(new Animated.Value(1)).current;
  const ground = useRef(new Animated.Value(1)).current;
  // 0 → 1 over the glide: flat peach to the bar's gradient, and the pulse's
  // 0.9 up to full strength, so it lands exactly as the bar's RIVAL looks.
  const tint = useRef(new Animated.Value(0)).current;
  const markRef = useRef<View>(null);

  useEffect(() => {
    if (gone) return;
    Animated.parallel([
      Animated.timing(spacing, { toValue: SIZE * 0.2, duration: 900, easing: OUT, useNativeDriver: false }),
      Animated.timing(fadeIn, { toValue: 1, duration: 450, easing: OUT, useNativeDriver: true }),
    ]).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 825, easing: IN_OUT, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 825, easing: IN_OUT, useNativeDriver: true }),
    ]));
    const pulseStart = setTimeout(() => loop.start(), 900);
    // A page that never reveals itself still opens.
    const fallback = setTimeout(revealApp, 3000);

    const off = onAppReveal(() => {
      clearTimeout(fallback);
      // Let the page lay out its top bar first.
      setTimeout(() => {
        loop.stop();
        Animated.timing(pulse, { toValue: 0, duration: 150, useNativeDriver: true }).start();
        measureWordmark((spot) => {
          const node: any = markRef.current;
          const end = () => {
            setWordmarkHidden(false);
            setGone(true);
          };
          Animated.timing(ground, { toValue: 0, duration: 550, delay: 200, easing: IN_OUT, useNativeDriver: true }).start();
          if (!spot || !node?.measureInWindow) {
            Animated.timing(fadeIn, { toValue: 0, duration: 300, useNativeDriver: true }).start(end);
            return;
          }
          node.measureInWindow((x: number, y: number, w: number, h: number) => {
            if (!w) { end(); return; }
            // Line the letters up, not the boxes: this RIVAL has a left
            // padding the bar's has not (it balances the letter spacing), so
            // matching boxes landed it a little small and off, and it jumped
            // at the hand-over (Ricky, 2026-11-14).
            const pad = SIZE * 0.2;
            const k = spot.w / (w - pad);
            const cx = x + w / 2, cy = y + h / 2;
            // Scaled about its centre: put the letters' left edge on the bar's,
            // and the line's middle on the bar's middle.
            const dx = spot.x - cx - k * (x + pad - cx);
            const dy = spot.y + spot.h / 2 - cy;
            Animated.parallel([
              Animated.timing(glide, { toValue: { x: dx, y: dy }, duration: 600, easing: IN_OUT, useNativeDriver: true }),
              Animated.timing(scale, { toValue: k, duration: 600, easing: IN_OUT, useNativeDriver: true }),
              Animated.timing(tint, { toValue: 1, duration: 600, easing: IN_OUT, useNativeDriver: true }),
            ]).start(() => {
              // The bar's RIVAL appears underneath, solid and in place, and
              // only then does this one go: no fade, so nothing flashes.
              setWordmarkHidden(false);
              requestAnimationFrame(() => requestAnimationFrame(() => setGone(true)));
            });
          });
        });
      }, 60);
    });
    return () => { off(); clearTimeout(pulseStart); clearTimeout(fallback); loop.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.6] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.975] });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, s.ground, { opacity: ground }]} />
      <View style={s.centre}>
        <Animated.View style={{ transform: [...glide.getTranslateTransform(), { scale }] }}>
          <Animated.View ref={markRef as any} collapsable={false} style={{ opacity: Animated.multiply(fadeIn, Animated.add(pulseOpacity, tint.interpolate({ inputRange: [0, 1], outputRange: [0, 0.1] }))), transform: [{ scale: pulseScale }] }}>
            <Animated.Text style={[s.mark, { letterSpacing: spacing, paddingLeft: spacing, opacity: tint.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>RIVAL</Animated.Text>
            {/* The bar's gradient, laid over at the settled spacing, showing as the glide goes. */}
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: tint }]}>
              <GradientText gradient={BAR_GRADIENT} style={[s.mark, { letterSpacing: SIZE * 0.2, paddingLeft: SIZE * 0.2 }]}>RIVAL</GradientText>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  ground: { backgroundColor: '#131313' },
  centre: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  // The bar's line height for its size (rivalWordmark), so the line's middle sits
  // where the bar's does.
  mark: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: SIZE, lineHeight: Math.round(SIZE * 1.25), color: '#ffb59e' },
});
