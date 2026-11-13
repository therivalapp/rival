import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import type { Celebration } from '../../lib/celebration';
import { GreyPrimary } from './RivalGreySheet';
import { activityIconName, RivalIcon, type RivalIconName } from './RivalIcon';
import { SkyBackdrop } from './SkyBackdrop';
import { webFx } from '../../lib/webFx';

// A personal best or one of the year's achievements, full screen (Ricky,
// 2026-11-02, mock B: design/achievement-celebration-mockup.png). The
// activity's sky behind one big number; distance and elevation count up to
// it, then confetti. A pop-up sheet was too easy to dismiss without reading.

const PB_GOLD = RivalColors.rankAnchors.unrivaled;
const EVENT = RivalColors.event;
const GROUND = '#131313';
const COUNT_MS = 1400;
const CONFETTI_MS = 1700;

const reducedMotion = () => Platform.OS === 'web' && typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Props = {
  celebration: Celebration;
  activity: { name?: string | null; started_at: string; activity_type: string; utc_offset_seconds?: number | null };
  busy?: boolean;
  error?: string | null;
  onAddPhoto: () => void;
  onClose: () => void;
  /** Shown over it, such as the photo picker. */
  children?: ReactNode;
};

export function CelebrationScreen({ celebration: c, activity, busy, error, onAddPhoto, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  const pb = c.kind === 'pb';
  const event = c.kind === 'event';
  const counts = c.countTo != null && !reducedMotion();
  const [shown, setShown] = useState(counts ? fmt(c.countFrom ?? 0, c.decimals) : c.big);
  const fade = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const stepIn = useRef(new Animated.Value(counts ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    let raf = 0;
    let timer: ReturnType<typeof setTimeout>;
    const celebrate = () => {
      if (reducedMotion()) return;
      Animated.timing(burst, { toValue: 1, duration: CONFETTI_MS, easing: Easing.linear, useNativeDriver: false }).start();
      Animated.timing(stepIn, { toValue: 1, duration: 500, useNativeDriver: false }).start();
    };
    if (counts) {
      const from = c.countFrom ?? 0;
      const to = c.countTo!;
      timer = setTimeout(() => {
        const start = Date.now();
        const tick = () => {
          const t = Math.min(1, (Date.now() - start) / COUNT_MS);
          const eased = 1 - Math.pow(1 - t, 3);
          setShown(t < 1 ? fmt(from + (to - from) * eased, c.decimals) : c.big);
          if (t < 1) raf = requestAnimationFrame(tick); else celebrate();
        };
        raf = requestAnimationFrame(tick);
      }, 350);
    } else {
      timer = setTimeout(celebrate, 400);
    }
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pieces = useMemo(() => confetti(c.kind), [c.kind]);
  const date = new Date(activity.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const on = activity.name ? `${activity.name}, ${date}` : date;
  const bigSize = c.big.length <= 3 ? 150 : c.big.length <= 5 ? 112 : event ? 82 : 84;
  // Up to three tiles; past that, two and a "+N more".
  const tiles = c.also.length > 3 ? c.also.slice(0, 2) : c.also;
  const more = c.also.length > 3 ? c.also.length - 2 : 0;

  const screen = (
    <Animated.View style={[s.screen, { opacity: fade }]}>
      <SkyBackdrop startedAt={activity.started_at} utcOffsetSeconds={activity.utc_offset_seconds} />
      <View style={[s.ghost, { pointerEvents: 'none' }]}><RivalIcon name={activityIconName(activity.activity_type)} size={300} color="rgba(255,255,255,0.08)" /></View>
      <View style={[s.fade, { pointerEvents: 'none' }]} />

      <View style={[s.body, { paddingTop: insets.top + 24, paddingBottom: Math.max(30, insets.bottom + 8) }]}>
        {/* The moment sits in the middle of the screen, the buttons at the bottom
            (Ricky, 2026-11-02: no dead space under it). */}
        <View style={{ flex: 1 }} />
        {event ? <RivalIcon name="flag" size={28} color={EVENT} style={{ marginBottom: 10 }} /> : null}
        <Text style={[s.kicker, pb && { color: PB_GOLD, opacity: 1 }, event && { color: EVENT, opacity: 1 }]}>{c.kicker}</Text>
        <View style={s.bigWrap}>
          <Text style={[s.big, { fontSize: bigSize, lineHeight: bigSize * 1.05 }]} numberOfLines={1} adjustsFontSizeToFit>{shown}</Text>
          <View style={[s.burst, { pointerEvents: 'none' }]}>
            {pieces.map((p, i) => (
              <Animated.View
                key={i}
                style={[s.piece, {
                  width: p.w, height: p.h, backgroundColor: p.color, borderRadius: p.round ? p.w / 2 : 1,
                  opacity: burst.interpolate({ inputRange: [0, 0.02, 0.75, 1], outputRange: [0, 1, 1, 0] }),
                  transform: [
                    { translateX: burst.interpolate({ inputRange: [0, 0.25, 0.5, 1], outputRange: [0, p.dx * 0.55, p.dx * 0.82, p.dx] }) },
                    { translateY: burst.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, p.dy * 0.55, p.dy * 0.7 + p.fall * 0.25, p.dy * 0.75 + p.fall * 0.56, p.dy * 0.78 + p.fall] }) },
                    { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] }) },
                  ],
                }]}
              />
            ))}
          </View>
        </View>
        {c.unit ? <Text style={s.unit}>{c.unit}</Text> : null}
        {c.cap ? <Text style={s.cap}>{c.cap}</Text> : null}
        {c.pill ? <View style={[s.delta, s.eventPill]}><Text style={[s.deltaText, { color: EVENT }]}>{c.pill}</Text></View> : null}
        {c.delta ? <View style={s.delta}><Text style={s.deltaText}>{c.delta}</Text></View> : null}
        {c.was && !event ? <Text style={s.was}>{c.was}</Text> : null}
        <View style={s.rule} />
        <Text style={s.title}>{c.title}</Text>
        <Text style={s.sub}>{event ? `${c.was}.` : `${pb ? 'Set on ' : 'Reached on '}${on}.`}</Text>
        {c.legs ? (
          <View style={s.tiles}>
            {c.legs.map((l, i) => (
              <View key={i} style={[s.tile, s.legTile]}>
                <RivalIcon name={activityIconName(l.icon)} size={18} color={EVENT} />
                <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit>{l.time}</Text>
                <Text style={s.tileLabel}>{l.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {tiles.length ? (
          <>
            <Text style={s.alsoLabel}>Also earned</Text>
            <View style={[s.tiles, { marginTop: 8 }]}>
              {tiles.map((t, i) => (
                <View key={i} style={[s.tile, t.kind === 'pb' && s.pbTile]}>
                  <RivalIcon name={t.icon as RivalIconName} size={18} color={t.kind === 'pb' ? PB_GOLD : '#fff'} />
                  <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit>{t.value}</Text>
                  <Text style={s.tileLabel}>{t.label}</Text>
                </View>
              ))}
              {more ? (
                <View style={s.tile}>
                  <Text style={s.tileValue}>+{more}</Text>
                  <Text style={s.tileLabel}>More</Text>
                </View>
              ) : null}
            </View>
          </>
        ) : null}
        {c.steps ? (
          <>
            <View style={s.steps}>
              {Array.from({ length: c.steps.of }, (_, i) => {
                const done = i < c.steps!.done;
                const last = i === c.steps!.done - 1;
                return (
                  <View key={i} style={s.step}>
                    {done ? <Animated.View style={[StyleSheet.absoluteFill, s.stepOn, last && { opacity: stepIn }]} /> : null}
                  </View>
                );
              })}
            </View>
            <Text style={s.stepLabel}>{c.steps.done} of {c.steps.of}{c.steps.next ? ` · Next ${c.steps.next}` : ''}</Text>
          </>
        ) : null}

        <View style={{ flex: 1 }} />
        <View style={{ height: 24 }} />
        {error ? <Text style={s.error}>{error}</Text> : null}
        <View style={{ alignSelf: 'stretch' }}><GreyPrimary label="Add photo" busy={busy} onPress={onAddPhoto} /></View>
        <TouchableOpacity onPress={onClose} disabled={busy} style={s.later} accessibilityRole="button"><Text style={s.laterText}>Not now</Text></TouchableOpacity>
      </View>
      {children}
    </Animated.View>
  );
  // Above the bottom bar, which lives under <body>.
  return Platform.OS === 'web' ? createPortal(screen, document.body) : screen;
}

function fmt(v: number, decimals = 0): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// The same burst every time for the same kind, so a re-render never reshuffles it.
function confetti(kind: Celebration['kind']) {
  const pb = kind === 'pb';
  let seed = pb ? 7 : kind === 'event' ? 5 : 3;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const colors = kind === 'event' ? [EVENT, '#ffffff', '#e8dcc4', RivalColors.accentText] : pb ? [PB_GOLD, '#fff3b0', '#ffffff', RivalColors.accentText] : [RivalColors.accentFill, RivalColors.accentText, '#ffd1be', '#ffffff'];
  return Array.from({ length: 56 }, () => {
    // Mostly up and out, a few straight to the sides.
    const angle = (-90 + (rand() - 0.5) * 200) * (Math.PI / 180);
    const dist = 130 + rand() * 210;
    const round = rand() < 0.3;
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      fall: 260 + rand() * 220,
      spin: (rand() - 0.5) * 900,
      w: round ? 7 : 5 + rand() * 4,
      h: round ? 7 : 9 + rand() * 6,
      round,
      color: colors[Math.floor(rand() * colors.length)],
    };
  });
}

const s = StyleSheet.create({
  screen: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute', top: 0, left: 0, right: 0, zIndex: 400, backgroundColor: GROUND, overflow: 'hidden',
    // 100vh is the true screen on an iPhone home-screen app (see RivalTopNav).
    ...(Platform.OS === 'web' ? { height: '100vh' } as any : { bottom: 0 }),
  },
  ghost: { position: 'absolute', right: -40, top: 150 },
  fade: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 420,
    ...(Platform.OS === 'web' ? { backgroundImage: `linear-gradient(180deg, rgba(19,19,19,0), ${GROUND} 70%)` } as any : ({ ...webFx({ backgroundImage: `linear-gradient(180deg, rgba(19,19,19,0), ${GROUND} 70%)` } as any) } as any)),
  },
  body: { flex: 1, alignItems: 'center', paddingHorizontal: 26 },
  kicker: { fontSize: 10.5, fontWeight: '800', letterSpacing: 2.2, textTransform: 'uppercase', color: '#fff', opacity: 0.85, textAlign: 'center' },
  bigWrap: { marginTop: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  big: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', color: '#fff', letterSpacing: -3, textAlign: 'center' },
  burst: { position: 'absolute', left: '50%', top: '45%', width: 0, height: 0 },
  piece: { position: 'absolute' },
  unit: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 26, color: 'rgba(255,255,255,0.85)', marginTop: -6 },
  delta: { marginTop: 12, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,215,0,0.45)' },
  deltaText: { fontSize: 13, fontWeight: '800', color: PB_GOLD },
  was: { fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 10 },
  rule: { width: 46, height: 1, backgroundColor: 'rgba(255,255,255,0.5)', marginVertical: 22 },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 26, lineHeight: 32, color: '#fff', textAlign: 'center' },
  sub: { fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginTop: 8 },
  steps: { flexDirection: 'row', gap: 6, marginTop: 22 },
  step: { width: 30, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  stepOn: Platform.OS === 'web' ? ({ backgroundImage: `linear-gradient(90deg, ${RivalColors.accentFill}, ${RivalColors.accentText})` } as any) : ({ ...webFx(({ backgroundImage: `linear-gradient(90deg, ${RivalColors.accentFill}, ${RivalColors.accentText})` } as any)) } as any),
  cap: { fontSize: 12, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  eventPill: { borderColor: 'rgba(244,234,216,0.5)' },
  alsoLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginTop: 20 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 20, alignSelf: 'stretch' },
  tile: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 9, paddingHorizontal: 6, borderWidth: 1, borderColor: 'rgba(255,209,190,0.22)', backgroundColor: 'rgba(19,19,19,0.35)' },
  legTile: { borderColor: 'rgba(244,234,216,0.22)' },
  pbTile: { borderColor: 'rgba(255,215,0,0.45)' },
  tileValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: '#fff', marginTop: 3 },
  tileLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 1 },
  stepLabel: { fontSize: 11.5, color: 'rgba(255,255,255,0.5)', marginTop: 8 },
  error: { fontSize: 13, color: RivalColors.error, textAlign: 'center', marginBottom: 10 },
  later: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, marginTop: 7 },
  laterText: { fontSize: 13.5, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
});
