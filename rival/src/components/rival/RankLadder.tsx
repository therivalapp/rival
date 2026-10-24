import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { RivalColors, RivalFontFamily, RivalSerifFamily } from '../../constants/rivalTheme';
import { rankSheen, rankTextSheen } from '../../constants/rankSheen';
import { LEVELS, getLevel, xpProgressInLevel } from '../../lib/xp';
import Svg, { Path } from 'react-native-svg';
import { RivalIcon, type RivalIconName } from './RivalIcon';

// The rank as a ladder of ten coins (Ricky, 2026-10-18, "W3"): ranks passed
// filled in their materials, the current one large with its icon, the rest
// outlined, and Unrivaled at the end edged in gold with the podium's
// sparkles, empty, so it draws the eye without saying what it is.
//
// `climb`: the rank counts up from Rookie, each rank passed lifting away as
// the next rises in with a small pop (no glow). Every rank stays at least
// 0.45 s; a long climb takes 4 s at most.
// `next`: the Today card's form, with the next rank ringed in its colour and
// "Champion next · 449 Effort to go" instead of the rank's own line.

const iconFor = (name: string) => `rank${name}` as RivalIconName;
const fmt = (n: number) => Math.round(n).toLocaleString();

// The podium's four-point star, drawn so it reads as a sparkle at any size.
const Spark = ({ size, style }: { size: number; style: object }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" style={[{ position: 'absolute' }, style]}>
    <Path fill="#ffd27a" d="M12 0c.6 6.5 5.5 11.4 12 12-6.5.6-11.4 5.5-12 12-.6-6.5-5.5-11.4-12-12C6.5 11.4 11.4 6.5 12 0Z" />
  </Svg>
);

// The podium leader's burst (home.tsx AvatarStarBurst, keyframes in
// global.css): stars out from behind the coin in every direction but down,
// staggered so a few are always in flight. Web only. No glow.
const BURST = [
  { size: 9, dur: 2.4, delay: 0 }, { size: 6, dur: 2.0, delay: 1.1 }, { size: 8, dur: 2.6, delay: 0.5 },
  { size: 10, dur: 2.2, delay: 1.7 }, { size: 7, dur: 2.5, delay: 0.3 }, { size: 9, dur: 2.1, delay: 1.4 },
  { size: 6, dur: 2.7, delay: 0.8 }, { size: 7, dur: 2.3, delay: 2.0 }, { size: 6, dur: 2.4, delay: 1.2 },
];
const StarBurst = ({ at }: { at: number }) => (Platform.OS !== 'web' ? null : (
  <View style={[{ position: 'absolute', left: at, top: at, width: 0, height: 0 }, { pointerEvents: 'none' }]}>
    {BURST.map((b, i) => (
      <View
        key={i}
        style={{
          position: 'absolute', left: -b.size / 2, top: -b.size / 2, width: b.size, height: b.size,
          animationName: `rivalSparkBurst${i}`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s`,
          animationIterationCount: 'infinite', animationTimingFunction: 'ease-out', animationFillMode: 'both',
        } as any}
      >
        <Svg width={b.size} height={b.size} viewBox="0 0 24 24">
          <Path fill="#ffd27a" d="M12 0c.6 6.5 5.5 11.4 12 12-6.5.6-11.4 5.5-12 12-.6-6.5-5.5-11.4-12-12C6.5 11.4 11.4 6.5 12 0Z" />
        </Svg>
      </View>
    ))}
  </View>
));

export function RankLadder({ effort, climb = false, delay = 0, next = false, label = '2026 rank' }: {
  effort: number;
  climb?: boolean;
  delay?: number;
  next?: boolean;
  label?: string;
}) {
  const [shown, setShown] = useState(climb && Platform.OS === 'web' ? 0 : effort);
  const pop = useRef(new Animated.Value(1)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const lastLevel = useRef(getLevel(shown).level);

  useEffect(() => {
    if (!climb || Platform.OS !== 'web') { setShown(effort); return; }
    const steps = getLevel(effort).level;
    const duration = Math.min(4000, Math.max(1600, steps * 450));
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / duration);
      setShown(effort * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [effort, climb, delay]);

  const lvl = getLevel(shown);
  const settled = Math.abs(shown - effort) < 0.5;
  // A step up: the new name rises in and pops, a touch more on the last one.
  useEffect(() => {
    if (lvl.level === lastLevel.current) return;
    lastLevel.current = lvl.level;
    rise.setValue(14);
    pop.setValue(1);
    Animated.parallel([
      Animated.timing(rise, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.sequence([
        Animated.timing(pop, { toValue: settled ? 1.14 : 1.1, duration: 140, useNativeDriver: false }),
        Animated.timing(pop, { toValue: 1, duration: 180, useNativeDriver: false }),
      ]),
    ]).start();
  }, [lvl.level]);

  const final = getLevel(effort);
  const nextLevel = LEVELS[final.level] ?? null;
  const progress = xpProgressInLevel(shown);
  const sheen = rankSheen(lvl.level);
  const nextSheen = nextLevel ? rankSheen(nextLevel.level) : sheen;
  const barSheen = next ? nextSheen : sheen;

  return (
    <View style={next ? s.wrapSm : s.wrap}>
      <View style={s.ladder}>
        {LEVELS.map((l) => {
          const m = rankSheen(l.level);
          const passed = l.level < lvl.level;
          const current = l.level === lvl.level;
          const isNext = next && settled && nextLevel && l.level === nextLevel.level;
          const top = l.level === LEVELS.length;
          if (current) {
            const coin = (
              <Animated.View key={l.level} style={[s.coinOn, next && s.coinOnSm, coinFill(m), { transform: [{ scale: pop }] }]}>
                <RivalIcon name={iconFor(l.name)} size={next ? 16 : 20} color="#14100e" />
              </Animated.View>
            );
            if (!top) return coin;
            // Unrivaled reached: the podium leader's stars burst out from
            // behind the coin, once the climb has landed.
            const r = (next ? 34 : 44) / 2;
            return (
              <View key={l.level}>
                {settled ? <StarBurst at={r} /> : null}
                {coin}
              </View>
            );
          }
          if (passed) return <View key={l.level} style={[s.coin, coinFill(m)]} />;
          if (top) {
            return (
              <View key={l.level} style={s.coinTop}>
                <Spark size={13} style={{ top: -12, right: -9 }} />
                <Spark size={9} style={{ bottom: -9, right: -5 }} />
                <Spark size={8} style={{ top: -8, left: -10, opacity: 0.85 }} />
                <Spark size={6} style={{ bottom: -5, left: -9, opacity: 0.7 }} />
              </View>
            );
          }
          if (isNext) {
            return (
              <View key={l.level} style={[s.coinNext, { borderColor: m.light, backgroundColor: m.light + '1f' }]}>
                <RivalIcon name={iconFor(l.name)} size={12} color={m.light} />
              </View>
            );
          }
          return <View key={l.level} style={s.coinAhead} />;
        })}
      </View>

      <View style={s.line}>
        {next && nextLevel ? (
          <Text style={[s.name, s.nameNext, rankTextSheen(nextLevel.level)]}>{nextLevel.name} next</Text>
        ) : (
          <Animated.Text style={[s.name, rankTextSheen(lvl.level), { transform: [{ translateY: rise }, { scale: pop }] }]}>{lvl.name}</Animated.Text>
        )}
        {next && nextLevel ? (
          <Text style={[s.togo, { color: nextSheen.light }]}>{fmt(nextLevel.minXp - effort)} Effort to go</Text>
        ) : (
          <Text style={s.kick}>{lvl.level} of {LEVELS.length}</Text>
        )}
      </View>

      <View style={s.bar}>
        <View style={[s.fill, barFill(barSheen), { width: `${Math.round(Math.min(1, progress.pct) * 100)}%` as any }]} />
      </View>
      {next ? null : (
      <View style={s.ends}>
        {(
          <>
            <Text style={s.endText}><Text style={s.endStrong}>{fmt(shown)}</Text> Effort</Text>
            {LEVELS[lvl.level] ? <Text style={s.endText}>{LEVELS[lvl.level].name} at <Text style={s.endStrong}>{fmt(LEVELS[lvl.level].minXp)}</Text></Text> : <Text style={s.endText}>{label}</Text>}
          </>
        )}
      </View>
      )}
    </View>
  );
}

const coinFill = (m: { light: string; dark: string }): object => (Platform.OS === 'web'
  ? { backgroundImage: `linear-gradient(160deg, ${m.light}, ${m.dark})` }
  : { backgroundColor: m.dark });
const barFill = (m: { light: string; dark: string }): object => (Platform.OS === 'web'
  ? { backgroundImage: `linear-gradient(90deg, ${m.dark}, ${m.light})` }
  : { backgroundColor: m.light });

const s = StyleSheet.create({
  wrap: { gap: 10 },
  wrapSm: { gap: 6 },
  ladder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  coin: { width: 18, height: 18, borderRadius: 9 },
  coinOn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  coinOnSm: { width: 34, height: 34, borderRadius: 17 },
  coinNext: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  coinAhead: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.14)' },
  coinTop: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,210,122,0.75)', backgroundColor: 'rgba(255,240,176,0.14)' },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  name: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 28, lineHeight: 34, color: '#fff' },
  nameNext: { fontSize: 20, lineHeight: 25 },
  kick: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' },
  togo: { fontFamily: RivalFontFamily, fontSize: 13, fontWeight: '700' },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: RivalColors.accentFill },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
  endText: { fontFamily: RivalFontFamily, fontSize: 11.5, color: 'rgba(255,255,255,0.55)' },
  endStrong: { color: '#fff', fontWeight: '700' },
});
