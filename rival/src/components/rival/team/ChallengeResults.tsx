// Finished team challenges (Ricky, 2026-11-14): the result on the team hub's
// Overview for 14 days (Mockup 57 v5), the trophy case and the team records
// on Challenges (Mockup 59 v4). Glass tiles in the podium colours, the app's
// own laurel on first place.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { inkNudge } from '../../../lib/inkCentre';
import { AccessibilityInfo, Animated, Easing, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Stop } from 'react-native-svg';
import { RivalColors, RivalFontFamily, RivalSerifFamily } from '../../../constants/rivalTheme';
import { webFx } from '../../../lib/webFx';
import type { ChallengeMetric, ChallengeResult, TeamRecord } from '../../../lib/teamChallengeResults';
import { LaurelWreath } from '../LaurelWreath';
import { RivalAvatar } from '../RivalAvatar';
import { RivalIcon } from '../RivalIcon';

type Who = { name: (userId: string) => string; avatar: (userId: string) => string | null | undefined };

const GOLD = '255,215,0';
const SALMON = '255,181,158';
const TEAL = '94,218,199';
const PLACE = [
  { rgb: GOLD, color: '#FFD700', rim: 'rgba(255,244,184,0.95)', label: '1ST' },
  { rgb: SALMON, color: RivalColors.accentText, rim: 'rgba(255,226,214,0.9)', label: '2ND' },
  { rgb: TEAL, color: RivalColors.tertiary, rim: 'rgba(200,250,240,0.85)', label: '3RD' },
];

export const METRIC_WORD: Record<ChallengeMetric, string> = {
  xp: 'Effort', distance: 'Distance', elevation: 'Elevation', duration: 'Time', activities: 'Activities',
};
const UNIT: Record<ChallengeMetric, string> = { xp: '', distance: 'km', elevation: 'm', duration: 'h', activities: '' };

export function amount(metric: ChallengeMetric, v: number): string {
  if (metric === 'distance') return (v < 100 ? Math.round(v * 10) / 10 : Math.round(v)).toLocaleString();
  if (metric === 'duration') return (Math.round(v * 10) / 10).toLocaleString();
  return Math.round(v).toLocaleString();
}

/** The total inside the finished ring: the longer the number, the smaller,
 *  so "54", "998" and "120,000" all sit inside the 200px ring. */
export function heroSize(text: string): number {
  const n = text.length;
  return n <= 2 ? 68 : n <= 3 ? 60 : n <= 4 ? 52 : n <= 5 ? 44 : n <= 6 ? 38 : 32;
}

/** A number with its unit small and muted, right against it ("1,240m"). */
function Figure({ metric, v, style, unitSize }: { metric: ChallengeMetric; v: number; style: any; unitSize: number }) {
  const unit = UNIT[metric];
  return (
    <Text style={style} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
      {amount(metric, v)}
      {unit ? <Text style={[s.unit, { fontSize: unitSize }]}>{unit}</Text> : null}
    </Text>
  );
}

/** First name and last initial ("Ricky J."), as on the Today podium, for
 *  the narrow tiles and the Also contributed row (Ricky, 2026-11-15). */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

const day = (iso: string, withYear = false) =>
  new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
const month = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
function span(r: { start: string; end: string }): string {
  const a = month(r.start), b = month(r.end);
  if (a === b) return b;
  const sameYear = r.start.slice(0, 4) === r.end.slice(0, 4);
  return `${new Date(r.start + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${b}`;
}

/** Glass: a faint tint, a bright top rim and a thin inner line, like the
 *  podium (Mockup 59 v3 B). */
function Glass({ rgb, rim, style, children, wash = 0.07 }: { rgb: string; rim: string; style?: StyleProp<ViewStyle>; children: React.ReactNode; wash?: number }) {
  return (
    <View style={[s.glass, { borderColor: `rgba(${rgb},0.5)`, borderTopColor: rim, backgroundColor: `rgba(${rgb},${wash})` }, style]}>
      <View style={[s.glassInner, { pointerEvents: 'none' }]} />
      {children}
    </View>
  );
}

// ---- Overview: the ended challenge (Mockup 57 v5) ---------------------------
// A completed challenge (the team reached its goal) gets the gold header of
// Mockup 64 C, and the first time each member opens it, the motion of
// Mockup 61 v5: the ring fills to 100%, the tick draws in, one pop, then the
// result, the podium rising and confetti down the whole page (Ricky,
// 2026-11-15).

export const cl = (x: number) => Math.max(0, Math.min(1, x));
export const e3 = (x: number) => 1 - Math.pow(1 - cl(x), 3);
export const io = (x: number) => { const v = cl(x); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; };
const INTRO_S = 9;
// Completed team challenge (Mockup 78 B, Ricky 2026-11-15): the Goal
// complete timeline, then the podium rises.
const TEAM_DONE_S = 10.9;
const CONFETTI_AT = 4.0;

/** Seconds into the completed motion, or INTRO_S when it isn't playing. */
export function useIntroClock(play: boolean, onConfetti?: () => void, onFinished?: () => void, length = INTRO_S): number {
  const INTRO_S = length;
  const [t, setT] = useState(play ? 0 : INTRO_S);
  const cbs = useRef({ onConfetti, onFinished });
  cbs.current = { onConfetti, onFinished };
  useEffect(() => {
    if (!play) { setT(INTRO_S); return; }
    let raf = 0;
    let cancelled = false;
    let fired = false;
    AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduce) => {
      if (cancelled) return;
      if (reduce) { setT(INTRO_S); cbs.current.onFinished?.(); return; }
      const t0 = Date.now();
      const step = () => {
        const now = (Date.now() - t0) / 1000;
        if (!fired && now >= CONFETTI_AT) { fired = true; cbs.current.onConfetti?.(); }
        setT(Math.min(now, INTRO_S));
        if (now < INTRO_S) raf = requestAnimationFrame(step);
        else cbs.current.onFinished?.();
      };
      raf = requestAnimationFrame(step);
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [play]);
  return t;
}

// Tick I (Mockup 62), already placed inside the 200px ring, and the line its
// reveal follows (short arm first, then up to the point).
const TICK = 'M53.6,109.6 L71.2,95.2 Q82.4,106.4 90.4,119.2 Q116,87.2 149.6,56.8 Q122.4,95.2 96.8,140 Q90.4,144.8 85.6,143.2 Q69.6,125.6 53.6,109.6 Z';
const TICK_LINE = 'M52,95.2 L90.4,138.4 L156,48.8';
const TICK_LINE_LEN = 169;
const RING = 200;
const RING_R = 86;
const RING_C = 2 * Math.PI * RING_R;

/** `hold` keeps the finished ring and tick in place (Focus complete, Mockup
 *  66 v4) instead of handing over to the header after the pop. */
/** `soft`: the gold ring as a soft gold, light gold to amber (Mockup 76 D,
 *  Ricky's pick for the Focus ring) instead of the flat #FFD700. */
/** `tickUp`: the tick drops up into a pill above the ring (team events). */
export function CompleteRing({ t, hold = false, tickOutAt, center, soft = false, tickUp = false }: { t: number; hold?: boolean; tickOutAt?: number; center?: React.ReactNode; soft?: boolean; tickUp?: boolean }) {
  const softId = `soft${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // With tickOutAt, the tick shrinks and drops towards the pill below, fading.
  const drop = tickOutAt == null ? 0 : io((t - tickOutAt) / 0.6);
  const maskId = `tick${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const f = e3(t / 3.2);
  const draw = io((t - 3.45) / 0.6);
  const pop = Math.sin(cl((t - 3.95) / 0.45) * Math.PI) * 0.05;
  const away = hold ? 0 : io((t - 4.9) / 0.6);
  return (
    <View style={[s.introRing, hold && s.introRingHold, { opacity: 1 - away, transform: [{ scale: (1 + pop) * (1 - 0.3 * away) }], pointerEvents: 'none' }]}>
      <View style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={RING} height={RING} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={100} cy={100} r={RING_R} stroke="rgba(255,255,255,0.1)" strokeWidth={14} fill="none" />
          {soft ? (
            <Defs>
              {/* The ring is turned -90deg, so x runs bottom to top here: light gold at the top. */}
              <LinearGradient id={softId} x1="1" y1="0" x2="0" y2="0">
                <Stop offset="0" stopColor="#f3d77a" />
                <Stop offset="1" stopColor="#c79a2e" />
              </LinearGradient>
            </Defs>
          ) : null}
          <Circle cx={100} cy={100} r={RING_R} stroke={t >= 3.2 ? (soft ? `url(#${softId})` : '#FFD700') : RivalColors.accentText} strokeWidth={14} fill="none"
            strokeLinecap="round" strokeDasharray={`${Math.max(0.01, RING_C * f)} ${RING_C}`} />
        </Svg>
        {draw > 0 ? (
          <Svg width={RING} height={RING} viewBox="0 0 200 200" style={{ position: 'absolute' }}>
            <Defs>
              <Mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
                <Path d={TICK_LINE} fill="none" stroke="#fff" strokeWidth={27} strokeDasharray={`${TICK_LINE_LEN} ${TICK_LINE_LEN}`} strokeDashoffset={TICK_LINE_LEN * (1 - draw)} />
              </Mask>
            </Defs>
            <G opacity={1 - drop} translateY={(tickUp ? -70 : 70) * drop} scale={1 - 0.75 * drop} originX={100} originY={100}>
              <G mask={`url(#${maskId})`}><Path d={TICK} fill={RivalColors.event} /></G>
            </G>
          </Svg>
        ) : null}
        <View style={{ alignItems: 'center', opacity: 1 - io((t - 3.3) / 0.3) }}>
          <Text style={s.introPct}>{Math.floor(100 * f + 1e-4)}%</Text>
          <Text style={s.introSub}>COMPLETE</Text>
        </View>
        {center ? <View style={{ position: 'absolute', alignItems: 'center' }}>{center}</View> : null}
      </View>
    </View>
  );
}

export function EndedChallenge({ result, who, play = false, onConfetti, onFinished }: {
  result: ChallengeResult;
  who: Who;
  /** Play the completed motion (first time this member sees it). */
  play?: boolean;
  onConfetti?: () => void;
  onFinished?: () => void;
}) {
  const done = result.target > 0 && result.total >= result.target;
  const t = useIntroClock(done && play, onConfetti, onFinished, TEAM_DONE_S);
  const intro = done && play && t < TEAM_DONE_S;
  const [first, second, third] = result.people;
  const rest = result.people.slice(3);
  const tile = (c: typeof first | undefined, place: number, height: number, avatarSize: number, riseAt: number, fixed = false) => {
    if (!c) return <View style={{ flex: 1 }} />;
    const p = PLACE[place];
    const q = intro ? io((t - riseAt) / 0.9) : 1;
    return (
      <View style={[s.tile, { height }, fixed && s.tileFixed, q < 1 && { transform: [{ translateY: (1 - q) * height }] }, webFx({ backgroundImage: `linear-gradient(180deg, rgba(${p.rgb},0.30) 0%, rgba(${p.rgb},0.10) 55%, rgba(${p.rgb},0.04) 100%)` })]}>
        <Glass rgb={p.rgb} rim={p.rim} wash={0} style={StyleSheet.absoluteFill}><View /></Glass>
        <Text style={[s.place, { color: p.color }]}>{p.label}</Text>
        <View style={{ marginTop: 'auto', alignItems: 'center' }}>
          {/* First place sits a little higher: the laurel's crossed stems
              need room above the name (Ricky, 2026-11-15). */}
          <View style={[s.ring, { borderColor: p.color, borderRadius: avatarSize }, place === 0 && { marginBottom: 8 }]}>
            {place === 0 ? <LaurelWreath avatarSize={avatarSize} /> : null}
            <RivalAvatar uri={who.avatar(c.userId)} name={who.name(c.userId)} size={avatarSize} />
          </View>
          <Text style={s.tileName} numberOfLines={1}>{shortName(who.name(c.userId))}</Text>
          <Figure metric={result.metric} v={c.value} style={[s.tileValue, place === 0 && s.tileValueFirst]} unitSize={place === 0 ? 14 : 12} />
        </View>
      </View>
    );
  };
  const facts = (
    <View style={s.facts}>
      {[[result.people.length, 'Contributed'], [result.activityCount, 'Activities'], [result.days, 'Days']].map(([n, l], i) => (
        <View key={String(l)} style={[s.fact, i > 0 && s.factLine]}>
          <Text style={s.factNum}>{Number(n).toLocaleString()}</Text>
          <Text style={s.factLabel}>{String(l).toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
  // As a finished Goal (FocusComplete): the tick drops into the pill, the
  // total counts up inside the soft gold ring, then the line and the facts.
  const badgeIn = intro ? io((t - 5.75) / 0.5) : 1;
  const numIn = intro ? io((t - 6.1) / 0.6) : 1;
  const count = intro ? e3((t - 6.1) / 3) : 1;
  const resultIn = intro ? io((t - 7.6) / 0.6) : 1;
  const factsIn = intro ? io((t - 8.1) / 0.6) : 1;
  const totalText = amount(result.metric, result.total);
  const goalWord = result.metric === 'xp' ? 'Effort' : METRIC_WORD[result.metric].toLowerCase();
  return (
    <View style={s.ended}>
      {done ? (
        <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
          <CompleteRing
            t={intro ? t : 7}
            hold
            soft
            tickOutAt={5.45}
            center={numIn > 0 ? (
              <View style={{ alignItems: 'center', opacity: numIn, transform: [{ translateY: 10 * (1 - numIn) }] }}>
                <Text style={[s.ringTotal, { fontSize: heroSize(totalText), lineHeight: heroSize(totalText) * 1.15, transform: [{ translateY: inkNudge(totalText, heroSize(totalText)) }] }]}>{count >= 1 ? totalText : amount(result.metric, result.total * count)}</Text>
                {UNIT[result.metric] ? <Text style={s.ringUnit}>{UNIT[result.metric]}</Text> : null}
              </View>
            ) : null}
          />
          <View style={[s.doneBadge, webFx({ backgroundImage: 'linear-gradient(160deg, rgba(255,226,122,0.34) 0%, rgba(184,134,11,0.18) 55%, rgba(255,215,0,0.26) 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.25)' }), intro && { opacity: badgeIn, transform: [{ scale: 0.85 + 0.15 * badgeIn }] }]}>
            {/* Gold glass (Mockup 69 C): the first-place podium glass as a pill. */}
            <View style={[s.doneSheen, webFx({ backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0))' }), { pointerEvents: 'none' }]} />
            <RivalIcon name="checkCircle" size={15} color="#FFD700" />
            <Text style={s.doneText}>CHALLENGE COMPLETE</Text>
          </View>
          <View style={[{ alignItems: 'center', alignSelf: 'stretch' }, intro && { opacity: resultIn, transform: [{ translateY: 12 * (1 - resultIn) }] }]}>
            <Text style={s.doneLine}>
              <Text style={s.doneLinePct}>{Math.floor((result.total / result.target) * 100)}%</Text>
              {` of the ${amount(result.metric, result.target)}${UNIT[result.metric]} ${goalWord} goal`}
            </Text>
          </View>
          <View style={[{ alignItems: 'center', alignSelf: 'stretch' }, intro && { opacity: factsIn }]}>{facts}</View>
        </View>
      ) : (
        <>
          <Text style={s.kick}>{`${METRIC_WORD[result.metric].toUpperCase()} · ENDED ${day(result.end).toUpperCase()}`}</Text>
          <Figure metric={result.metric} v={result.total} style={s.hero} unitSize={22} />
          <Text style={s.heroSub}>{`${METRIC_WORD[result.metric]} together, ${day(result.start)} – ${day(result.end)}`}</Text>
          {facts}
        </>
      )}
      {first && result.people.length === 1 ? (
        // One contributor: one wide gold card, not a podium with gaps
        // (Mockup 65 solo B, Ricky 2026-11-15).
        <View style={[s.soloWrap, intro && { overflow: 'hidden' }]}>
          <Glass rgb={GOLD} rim="rgba(255,244,184,0.95)" wash={0} style={[s.solo, webFx({ backgroundImage: 'linear-gradient(135deg, rgba(255,215,0,0.26) 0%, rgba(255,215,0,0.05) 70%)' }), intro && { transform: [{ translateY: (1 - io((t - 9.0) / 0.9)) * 110 }] }]}>
            <View style={[s.ring, { borderColor: '#FFD700', borderRadius: 56, marginVertical: 6, marginLeft: 4 }]}>
              <LaurelWreath avatarSize={56} />
              <RivalAvatar uri={who.avatar(first.userId)} name={who.name(first.userId)} size={56} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.place, { color: '#FFD700' }]}>1ST</Text>
              <Text style={s.soloName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{who.name(first.userId)}</Text>
            </View>
            <Figure metric={result.metric} v={first.value} style={s.soloValue} unitSize={14} />
          </Glass>
        </View>
      ) : first && result.people.length === 2 ? (
        // Two contributors: 1st and 2nd side by side, centred, podium-size
        // tiles (Mockup 65 two B).
        <View style={[s.podium, { justifyContent: 'center' }, intro && { overflow: 'hidden' }]}>
          {tile(second, 1, 166, 46, 9.0, true)}
          {tile(first, 0, 200, 50, 9.35, true)}
        </View>
      ) : first ? (
        <View style={[s.podium, intro && { overflow: 'hidden' }]}>
          {tile(second, 1, 166, 46, 9.35)}
          {tile(first, 0, 200, 50, 9.7)}
          {tile(third, 2, 144, 44, 9.0)}
        </View>
      ) : (
        <Text style={s.none}>No activities were added during this challenge.</Text>
      )}
      <View style={[{ alignSelf: 'stretch' }, intro && { opacity: io((t - 10.2) / 0.7) }]}>
        {rest.length > 0 ? (
          <>
            <Text style={s.alsoLabel}>{'ALSO CONTRIBUTED · '}<Text style={{ color: '#fff' }}>{rest.length}</Text></Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.alsoRow} contentContainerStyle={{ gap: 12, paddingRight: 40 }}>
              {rest.map((c) => (
                <View key={c.userId} style={s.alsoP}>
                  <RivalAvatar uri={who.avatar(c.userId)} name={who.name(c.userId)} size={40} />
                  <Figure metric={result.metric} v={c.value} style={s.alsoValue} unitSize={10} />
                  <Text style={s.alsoName} numberOfLines={1}>{shortName(who.name(c.userId))}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        ) : null}
        {!done && result.target > 0 ? <Text style={s.target}>Goal {amount(result.metric, result.target)}{UNIT[result.metric]}</Text> : null}
      </View>
    </View>
  );
}

// Confetti down the whole page, once, when a completed challenge is first
// seen (Mockup 61 v5). On the native driver; nothing on reduced motion.
const CONFETTI = ['#FFD700', RivalColors.accentText, RivalColors.tertiary, '#fff4b8', '#D97757', '#ffffff'];

export function Confetti({ run }: { run: number }) {
  const { width, height } = useWindowDimensions();
  const clock = useRef(new Animated.Value(0)).current;
  const pieces = useMemo(() => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    return Array.from({ length: 90 }, (_, i) => ({
      x: rnd(), delay: 0.02 + rnd() * 2.7, dur: 5.2 / (0.75 + rnd() * 0.6),
      sway: (rnd() - 0.5) * 40, rot: rnd() * 360, spin: (rnd() - 0.5) * 720, color: CONFETTI[i % CONFETTI.length],
    }));
  }, []);
  const total = Math.max(...pieces.map((p) => p.delay + p.dur)) + 0.1;
  useEffect(() => {
    if (!run) return;
    clock.setValue(0);
    const a = Animated.timing(clock, { toValue: total, duration: total * 1000, easing: Easing.linear, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [run]);
  if (!run) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50, pointerEvents: 'none' }]}>
      {pieces.map((p, i) => {
        const steps = [0, 0.25, 0.5, 0.75, 1];
        const at = steps.map((k) => p.delay + p.dur * k);
        return (
          <Animated.View key={i} style={[s.confetto, {
            backgroundColor: p.color, left: p.x * width,
            opacity: clock.interpolate({ inputRange: [p.delay - 0.01, p.delay, p.delay + p.dur, p.delay + p.dur + 0.01], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
            transform: [
              { translateY: clock.interpolate({ inputRange: [p.delay, p.delay + p.dur], outputRange: [-30, height + 30], extrapolate: 'clamp' }) },
              { translateX: clock.interpolate({ inputRange: at, outputRange: steps.map((k) => Math.sin(k * 6) * p.sway), extrapolate: 'clamp' }) },
              { rotate: clock.interpolate({ inputRange: [p.delay, p.delay + p.dur], outputRange: [`${p.rot}deg`, `${p.rot + p.spin}deg`], extrapolate: 'clamp' }) },
            ],
          }]} />
        );
      })}
    </View>
  );
}

// ---- Challenges: trophy case and team records (Mockup 59 v4 A) -------------

export function TrophyCase({ results, who }: { results: ChallengeResult[]; who: Who }) {
  if (results.length === 0) return null;
  return (
    <View style={{ gap: 9 }}>
      <View style={s.secRow}><Text style={s.sec}>TROPHY CASE</Text><Text style={s.secCount}>{results.length}</Text></View>
      <View style={s.case}>
        {results.map((r) => (
          <Glass key={r.key} rgb={GOLD} rim="rgba(255,244,184,0.95)" style={s.trophy}>
            <Text style={s.trophyType}>{METRIC_WORD[r.metric].toUpperCase()}</Text>
            <Text style={s.trophyWhen}>{span(r)}</Text>
            <Figure metric={r.metric} v={r.total} style={s.trophyTotal} unitSize={14} />
            <View style={s.mini}>
              {[1, 0, 2].map((place) => {
                const c = r.people[place];
                if (!c) return <View key={place} style={{ width: 34 }} />;
                const size = place === 0 ? 34 : place === 1 ? 28 : 26;
                return (
                  <View key={place} style={s.miniP}>
                    <View style={[s.ring, { borderColor: PLACE[place].color, borderRadius: size }]}>
                      {place === 0 ? <LaurelWreath avatarSize={size} shadow={false} /> : null}
                      <RivalAvatar uri={who.avatar(c.userId)} name={who.name(c.userId)} size={size} />
                    </View>
                    <Text style={s.miniName} numberOfLines={1}>{who.name(c.userId)}</Text>
                  </View>
                );
              })}
            </View>
          </Glass>
        ))}
      </View>
    </View>
  );
}

export function TeamRecords({ all, thisYear, who }: { all: TeamRecord[]; thisYear: TeamRecord[]; who: Who }) {
  const year = new Date().getFullYear();
  const [view, setView] = useState<'year' | 'all'>('year');
  if (all.length === 0) return null;
  const list = view === 'year' ? thisYear : all;
  return (
    <View style={{ gap: 9 }}>
      <Text style={s.sec}>TEAM RECORDS</Text>
      <View style={s.seg}>
        {(['year', 'all'] as const).map((v) => (
          <TouchableOpacity key={v} style={[s.segItem, view === v && s.segOn]} onPress={() => setView(v)} accessibilityRole="button" accessibilityState={{ selected: view === v }}>
            <Text style={[s.segText, view === v && s.segTextOn]}>{v === 'year' ? String(year) : 'All time'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {list.length === 0 ? (
        <Text style={s.recNote}>No challenges have finished this year yet.</Text>
      ) : list.map((r) => (
        <Glass key={r.metric} rgb={GOLD} rim="rgba(255,244,184,0.9)" wash={0.06} style={s.rec}>
          <View style={s.recAvatar}>
            <LaurelWreath avatarSize={38} />
            <RivalAvatar uri={who.avatar(r.userId)} name={who.name(r.userId)} size={38} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.recKind}>{`MOST ${METRIC_WORD[r.metric].toUpperCase()}`}</Text>
            <Text style={s.recName} numberOfLines={1}>{who.name(r.userId)}</Text>
          </View>
          <Figure metric={r.metric} v={r.value} style={s.recValue} unitSize={15} />
          <Text style={s.recDate}>{month(r.end)}</Text>
        </Glass>
      ))}
      {list.length > 0 ? (
        <Text style={s.recNote}>{view === 'year' ? 'Resets on 1 January. Beat one in a challenge to take the spot.' : 'The most anyone has added in one challenge.'}</Text>
      ) : null}
    </View>
  );
}

const SERIF = { fontFamily: RivalSerifFamily, fontStyle: 'italic' as const, fontWeight: '700' as const, color: '#fff' };

const s = StyleSheet.create({
  unit: { fontStyle: 'normal', fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  glass: { borderWidth: 1, borderTopWidth: 1.5, borderRadius: 16, overflow: 'hidden' },
  glassInner: { position: 'absolute', top: 3.5, left: 3.5, right: 3.5, bottom: 3.5, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  ring: { borderWidth: 2, padding: 0, position: 'relative' },

  ended: { alignItems: 'center', marginTop: 18, paddingHorizontal: 18 },
  kick: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6, color: RivalColors.accentText },
  hero: { ...SERIF, fontSize: 50, lineHeight: 58, marginTop: 6 },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  // Three equal columns, so the middle one (Activities) sits in the centre.
  facts: { flexDirection: 'row', marginTop: 14, width: 330, maxWidth: '100%' },
  fact: { flex: 1, alignItems: 'center' },
  factLine: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.15)' },
  factNum: { ...SERIF, fontSize: 22 },
  factLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: RivalColors.accentText, marginTop: 2 },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 22, alignSelf: 'stretch' },
  tile: { flex: 1, borderRadius: 16, overflow: 'hidden', paddingTop: 12, paddingBottom: 14, alignItems: 'center' },
  tileFixed: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '31.4%' },
  soloWrap: { alignSelf: 'stretch', marginTop: 22 },
  solo: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, paddingLeft: 22, paddingRight: 18 },
  soloName: { ...SERIF, fontSize: 22, marginTop: 2 },
  soloValue: { ...SERIF, fontSize: 28, maxWidth: 130 },
  place: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6 },
  tileName: { fontSize: 14, fontWeight: '800', color: '#fff', marginTop: 6, maxWidth: 96 },
  tileValue: { ...SERIF, fontSize: 20, marginTop: 1 },
  tileValueFirst: { fontSize: 25 },
  none: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 18 },
  alsoLabel: { alignSelf: 'flex-start', fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: RivalColors.accentText, marginTop: 24 },
  alsoRow: { alignSelf: 'stretch', marginTop: 8, marginRight: -18 },
  alsoP: { alignItems: 'center', width: 50, gap: 3 },
  alsoValue: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
  alsoName: { fontSize: 11.5, color: '#fff', maxWidth: 50 },
  doneBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, overflow: 'hidden', backgroundColor: Platform.OS === 'web' ? 'transparent' : 'rgba(230,180,40,0.24)', borderWidth: 1, borderColor: 'rgba(255,226,122,0.75)', borderTopColor: 'rgba(255,244,184,0.95)' },
  doneSheen: { position: 'absolute', left: 8, right: 8, top: 1, height: '45%', borderRadius: 999, backgroundColor: Platform.OS === 'web' ? 'transparent' : 'rgba(255,255,255,0.10)' },
  doneText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: RivalColors.rankAnchors.unrivaled },
  // The total inside the ring, ivory as on a finished Goal (FocusComplete hero).
  ringTotal: { ...SERIF, color: RivalColors.event, textAlign: 'center', paddingHorizontal: 8 },
  ringUnit: { fontFamily: RivalFontFamily, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  heroGold: { color: RivalColors.rankAnchors.unrivaled, marginTop: 12 },
  doneLine: { fontSize: 12.5, color: '#fff', marginTop: 6 },
  doneLinePct: { color: '#FFD700', fontWeight: '800' },
  introRing: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  introRingHold: { position: 'relative', top: undefined, left: undefined, right: undefined },
  introPct: { ...SERIF, fontSize: 46, lineHeight: 52 },
  introSub: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6, color: RivalColors.accentText, marginTop: 2 },
  confetto: { position: 'absolute', top: 0, width: 7, height: 11, borderRadius: 2 },
  target: { fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 16 },

  secRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sec: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: '#A0A0A0' },
  secCount: { fontSize: 10, fontWeight: '800', color: RivalColors.accentText },
  case: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trophy: { width: '48.5%', paddingTop: 12, paddingBottom: 12, paddingHorizontal: 8, alignItems: 'center' },
  trophyType: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: '#FFD700' },
  trophyWhen: { fontSize: 11, color: '#fff', marginTop: 2 },
  trophyTotal: { ...SERIF, fontSize: 26, marginTop: 6 },
  mini: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 14, marginTop: 16 },
  miniP: { alignItems: 'center', gap: 10 },
  miniName: { fontSize: 10.5, fontWeight: '700', color: '#fff', maxWidth: 56 },

  seg: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: 3 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 999 },
  segOn: { backgroundColor: 'rgba(255,181,158,0.18)' },
  segText: { fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  segTextOn: { color: RivalColors.accentText },
  rec: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingRight: 14, paddingLeft: 18, gap: 18 },
  recAvatar: { position: 'relative', marginVertical: 8 },
  recKind: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, color: '#FFD700' },
  recName: { ...SERIF, fontSize: 23, marginTop: 2 },
  recValue: { ...SERIF, fontSize: 32, marginTop: 14, maxWidth: 140 },
  recDate: { position: 'absolute', top: 10, right: 14, fontSize: 10.5, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  recNote: { fontSize: 11.5, color: 'rgba(255,255,255,0.7)' },
});
