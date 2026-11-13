import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { webFx } from '../../lib/webFx';

// Rolling digits (Mockup 48 · More motion A, Ricky 2026-11-13): every count
// in the app rolls, each digit a column of 0-9 spinning to its place, the
// left digits first. Separators (, . : h m) stay still. The import screen is
// the one exception and keeps its count up from zero (CountUp.tsx).
//
// Each column is as wide as its final digit (an invisible copy sizes it), so
// the finished number sets exactly like plain text, and nothing shuffles
// sideways while it rolls. Runs on the native driver on iPhone.
//
// `from` rolls from another number of the same shape instead of zeros, as a
// personal best's old time rolling to the new one (Moments B).

export const ROLL_EASE = Easing.bezier(0.22, 1, 0.36, 1);
const LOOPS = 2; // full turns of the wheel before it lands
const DIGITS = Array.from({ length: (LOOPS + 1) * 10 }, (_, i) => String(i % 10));

// The last figure each remembered number showed, so a number that has
// changed since (a new activity's Effort) rolls on from the old one, with the
// difference shown beside it, instead of from zero (Moments A).
const lastShown = new Map<string, string>();

function reducedOnWeb(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function RollingNumber({
  text,
  from,
  style,
  gradient,
  run = true,
  delay = 0,
  duration = 1100,
  stagger = 90,
  waitForView = true,
  memory,
  onDone,
}: {
  /** The final figure exactly as it should read, e.g. "12,480" or "21:12". */
  text: string;
  /** Roll from this figure (same length) instead of zeros. */
  from?: string | null;
  style?: StyleProp<TextStyle>;
  /** A CSS linear-gradient for the digits (the number's gradient fill). */
  gradient?: string;
  /** Starts when true (once per mount and per new `text`). */
  run?: boolean;
  delay?: number;
  duration?: number;
  stagger?: number;
  /** Web: wait until the number is on screen before rolling. */
  waitForView?: boolean;
  /** Remember the figure under this name: when it next shows a different
   *  figure it rolls on from the old one and shows the gain ("+19"). */
  memory?: string;
  onDone?: () => void;
}) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle & { __gradientText?: string };
  const grad = gradient ?? flat.__gradientText;
  const fontSize = flat.fontSize ?? 16;
  const rowH = flat.lineHeight ?? Math.round(fontSize * 1.15);
  const chars = useMemo(() => text.split(''), [text]);
  const [remembered] = useState(() => (memory ? lastShown.get(memory) ?? null : null));
  const rollOn = remembered && remembered !== text && remembered.length === text.length ? remembered : null;
  const fromChars = from && from.length === text.length ? from.split('') : rollOn ? rollOn.split('') : null;
  // The gain beside the number while it rolls on from the old figure.
  const gain = useMemo(() => {
    if (!rollOn) return null;
    const a = Number(rollOn.replace(/[^\d.]/g, '')), b = Number(text.replace(/[^\d.]/g, ''));
    const d = Math.round((b - a) * 10) / 10;
    return d > 0 ? `+${d.toLocaleString()}` : null;
  }, [rollOn, text]);
  const gainFade = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (memory) lastShown.set(memory, text); }, [memory, text]);

  const [reduce, setReduce] = useState(reducedOnWeb());
  useEffect(() => {
    if (Platform.OS === 'web') return;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => on && setReduce(true)).catch(() => {});
  }, []);

  // One position per character (separators keep theirs at 0, unused).
  const pos = useRef<Animated.Value[]>([]);
  const fade = useRef(new Animated.Value(from || rollOn ? 1 : 0.35)).current;
  if (pos.current.length !== chars.length) {
    pos.current = chars.map((ch, i) => {
      // From another figure: one turn earlier, so each digit rolls forward.
      const start = fromChars && /\d/.test(fromChars[i]) ? 10 + Number(fromChars[i]) : 0;
      return new Animated.Value(/\d/.test(ch) ? -start * rowH : 0);
    });
  }

  const [inView, setInView] = useState(!waitForView || Platform.OS !== 'web');
  const boxRef = useRef<any>(null);
  useEffect(() => {
    if (inView) return;
    const node = boxRef.current;
    if (!(node instanceof Element) || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); setInView(true); }
    }, { threshold: 0.6, rootMargin: '0px 0px -15% 0px' });
    io.observe(node);
    return () => io.disconnect();
  }, [inView]);

  const played = useRef<string | null>(null);
  useEffect(() => {
    if (!run || !inView || reduce || played.current === text) return;
    played.current = text;
    const digitIdx = chars.map((ch, i) => (/\d/.test(ch) ? i : -1)).filter((i) => i >= 0);
    const anims = digitIdx.map((i, k) => {
      const d = Number(chars[i]);
      // Whole turns, then the digit: lands on the last loop of the strip.
      const target = -(LOOPS * 10 + d) * rowH;
      return Animated.timing(pos.current[i], {
        toValue: target,
        duration: duration + (digitIdx.length - 1 - k) * 60,
        delay: delay + k * stagger,
        easing: ROLL_EASE,
        useNativeDriver: Platform.OS !== 'web',
      });
    });
    const nd = Platform.OS !== 'web';
    if (gain) {
      Animated.sequence([
        Animated.timing(gainFade, { toValue: 1, duration: 250, delay, useNativeDriver: nd }),
        Animated.delay(duration + 600),
        Animated.timing(gainFade, { toValue: 0, duration: 400, useNativeDriver: nd }),
      ]).start();
    }
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 300, delay, useNativeDriver: nd }),
      ...anims,
    ]).start(({ finished }) => finished && onDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, inView, reduce, text]);

  const textStyle: TextStyle = { ...flat, lineHeight: rowH, margin: 0, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 };
  delete (textStyle as any).__gradientText;
  for (const k of ['position', 'top', 'left', 'right', 'bottom', 'alignSelf', 'padding', 'paddingHorizontal', 'paddingLeft', 'paddingRight', 'marginHorizontal', 'marginVertical']) delete (textStyle as any)[k];
  // An italic glyph leans past its own box: each column gets room either
  // side (cancelled by a negative margin) so its clip doesn't shave it.
  const lean = flat.fontStyle === 'italic' ? Math.round(fontSize * 0.12) : 0;
  const layout: any = {};
  for (const k of ['padding', 'paddingHorizontal', 'paddingLeft', 'paddingRight', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'alignSelf', 'position', 'top', 'left', 'right', 'bottom'] as const) {
    if ((flat as any)[k] !== undefined) layout[k] = (flat as any)[k];
  }

  // Plain text once reduced motion is on, or for an empty figure.
  if (reduce || !/\d/.test(text)) {
    if (grad && Platform.OS !== 'web') {
      return (
        <MaskedView style={layout} maskElement={<Text style={[textStyle, { color: '#000' }]}>{text}</Text>}>
          <View style={{ experimental_backgroundImage: grad } as any}><Text style={[textStyle, { opacity: 0 }]}>{text}</Text></View>
        </MaskedView>
      );
    }
    return <Text style={[textStyle, layout, grad ? webFx({ backgroundImage: grad, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' }) : null]}>{text}</Text>;
  }

  // On the web each glyph carries the gradient itself (background-clip:text);
  // the gradients used for rolling figures run top to bottom, so per-glyph
  // reads the same as across the whole number.
  const glyph: TextStyle = Platform.OS === 'web' && grad
    ? ({ ...textStyle, ...webFx({ backgroundImage: grad, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' }) } as any)
    : textStyle;

  const row = (ink?: string) => (
    <Animated.View style={[s.row, { height: rowH, opacity: fade }]}>
      {chars.map((ch, i) => {
        const g = ink ? { ...glyph, color: ink } : glyph;
        if (!/\d/.test(ch)) return <Text key={i} style={g}>{ch}</Text>;
        return (
          <View key={i} style={{ height: rowH, overflow: 'hidden', paddingHorizontal: lean, marginHorizontal: -lean }}>
            <Text style={[g, { opacity: 0 }]}>{ch}</Text>
            <Animated.View style={[s.strip, { left: lean, right: lean, transform: [{ translateY: pos.current[i] }] }]}>
              {DIGITS.map((d, j) => <Text key={j} style={[g, s.cell, { height: rowH }]}>{d}</Text>)}
            </Animated.View>
          </View>
        );
      })}
    </Animated.View>
  );

  const gainTag = gain ? (
    <Animated.Text pointerEvents="none" style={[s.gain, { fontFamily: flat.fontFamily, fontSize: Math.max(13, Math.round(fontSize * 0.45)), top: rowH * 0.18, opacity: gainFade }]}>{gain}</Animated.Text>
  ) : null;
  if (grad && Platform.OS !== 'web') {
    return (
      <View style={layout}>{gainTag}<MaskedView maskElement={row('#000')}>
        <View style={{ experimental_backgroundImage: grad } as any}>
          <Text style={[textStyle, { opacity: 0 }]}>{text}</Text>
        </View>
      </MaskedView></View>
    );
  }
  return <View ref={boxRef} style={layout} accessibilityLabel={text}>{gainTag}{row()}</View>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  strip: { position: 'absolute', top: 0, left: 0, right: 0 },
  cell: { textAlign: 'center' },
  gain: { position: 'absolute', right: '100%', marginRight: 6, fontStyle: 'italic', fontWeight: '700', color: '#ffb59e' },
});
