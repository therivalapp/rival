import { GradientText } from './GradientText';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Platform, View, Text, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { RivalColors, RivalFontFamily, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, RivalIconName } from './RivalIcon';
import { webFx } from '../../lib/webFx';

// Below a target of 100, a whole-number progress value reads as sparse in
// the ring's large digit slot ("7 / 10" looks empty where "428 / 1,000"
// looks substantial) — the ring is sized for a few comma-grouped digits, not
// one bare one. One decimal fills that same visual weight at small scale
// without inventing false precision at large scale, where the digit count
// alone already reads as "full". Keyed off the TARGET, not the progress
// value, so a goal that's barely started (0.4 / 10) still gets the decimal
// it needs rather than one keyed off however far in you happen to be.
function formatRingValue(value: number, target: number): string {
  return target < 100 ? value.toFixed(1) : Math.round(value).toLocaleString();
}

// The number is the point of the ring, so it's sized to fill the hole rather
// than sit politely in the middle of it — stepped down only as far as the
// digit count forces. Buckets rather than a measured fit: the constraint is
// the ring's inner width, and these are the largest sizes that clear it for
// each length in the serif italic face at the default 200 ring.
function ringValueFontSize(text: string, size: number): number {
  const byLength = text.length <= 2 ? 68 : text.length <= 3 ? 60 : text.length <= 4 ? 52 : text.length <= 5 ? 44 : 38;
  // Scaled by the ring's own size, so a smaller ring elsewhere doesn't overflow.
  return Math.round(byLength * (size / 200));
}

// Extracted from team-hub.tsx's Team Challenge ring (ChallengeRing) so
// home.tsx's Focus card can use the identical component instead of a second
// hand-copy — team-hub.tsx still has its own inline version; only a new
// consumer was pointed at this one, not a full de-dup pass.
export function RivalChallengeRing({
  pct,
  value,
  valueText,
  target,
  unit,
  icon = null,
  size = 200,
  thickness = 14,
  style,
  animate,
  segments,
}: {
  pct: number;
  value: number;
  /** Shown in place of the number, for a time such as 21:14. */
  valueText?: string;
  target: number;
  unit: string;
  icon?: RivalIconName | null;
  size?: number;
  thickness?: number;
  style?: ViewStyle;
  /** Fill the ring from empty and count the number up from 0, starting when
   *  `run` turns true. Once per mount. */
  animate?: { run: boolean; ms: number; ease: (p: number) => number };
  /** The fill split by sport (Mockup 50 B): each part's share of the target
   *  and its colour, in drawing order. Left out, the ring is one colour. */
  segments?: RingSegment[] | null;
}) {
  const [f, setF] = useState(animate ? 0 : 1);
  const done = useRef(!animate);
  useEffect(() => {
    if (done.current || !animate?.run) return;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / animate.ms);
      setF(animate.ease(p));
      if (p < 1) raf = requestAnimationFrame(tick);
      else done.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate?.run]);
  const clamped = Math.max(0, Math.min(1, pct)) * f;
  const ringId = `ringGrad${useId().replace(/[^a-zA-Z0-9]/g, '')}`; // unique per ring on the page
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const formatted = valueText ?? formatRingValue(value * f, target);
  // Sized for the final number, so the digits don't change size as they count.
  const valueSize = ringValueFontSize(valueText ?? formatRingValue(value, target), size);
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <LinearGradient id={ringId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={RivalColors.accentFill} />
            <Stop offset="100%" stopColor={RivalColors.accentText} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={thickness} fill="none" />
        {segments && segments.length > 1 ? (
          drawSegments(segments, f, size, radius, thickness, circumference, ringId)
        ) : (
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={`url(#${ringId})`} strokeWidth={thickness} fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
        />
        )}
      </Svg>
      {icon ? <RivalIcon name={icon} size={22} color={RivalColors.accentText} style={{ marginBottom: 4 } as any} /> : null}
      {/* Digits have no descenders, but the line box still reserves that
          descender space below the baseline (the font's em metrics, not this
          component's doing) — with nothing below to fill it, that reserved
          gap reads as dead air between the number and the "/ target" line,
          making the whole two-line group LOOK bottom-heavy even though its
          bounding box is genuinely centered in the ring (verified against
          the ring's own SVG rect). This negative margin claws back roughly
          that unused descender space so the numeral's actual ink — not its
          box — sits at the ring's visual center. Scales with the ring so a
          smaller ring elsewhere isn't over-corrected. */}
      <GradientText
        gradient="linear-gradient(180deg, #FFFFFF 0%, #D97757 150%)"
        style={[
          styles.ringValue,
          { fontSize: valueSize, lineHeight: Math.round(valueSize * 1.06), marginTop: -Math.round(valueSize * 0.12) },
        ]}
      >
        {formatted}
      </GradientText>
      <Text style={styles.ringTarget}>{unit}</Text>
    </View>
  );
}

export type RingSegment = { key: string; label: string; frac: number; amountText: string; colour: string };

// Each sport's colour on the Focus ring (Mockup 50 B, Ricky 2026-11-13). Run
// keeps the ring's own orange; the rest are rank colours from rankSheen.ts
// (emerald, stone, amethyst, sapphire). 'brand' means the ring gradient.
const SPORT_RING_COLOURS: Record<string, string> = {
  Run: 'brand', Ride: '#9fd9bd', Walk: '#d8d3cc', Hike: '#c9b0e8', Swim: '#9fb6e6',
};
const OTHER_RING_COLOURS = ['#d4ecf0', '#eef1f5'];
const BRAND_DOT = '#e8906f';

/** Ring segments for a sport split (goalSportSplit), each a share of `target`. */
export function sportRingSegments(split: { sport: string; label: string; km: number }[] | null, target: number, unit = 'km'): RingSegment[] | null {
  if (!split || split.length < 2 || !(target > 0)) return null;
  let other = 0;
  return split.map((p) => ({
    key: p.sport,
    label: p.label,
    frac: p.km / target,
    amountText: `${p.km.toLocaleString()} ${unit}`,
    colour: SPORT_RING_COLOURS[p.sport] ?? OTHER_RING_COLOURS[other++ % OTHER_RING_COLOURS.length],
  }));
}

const dotColour = (c: string) => (c === 'brand' ? BRAND_DOT : c);

// Sport by sport around the ring, with a small gap between sports and round
// ends only at the very start and the end of the fill. `f` (0 to 1) is how
// far the fill has drawn, so the sports draw in turn as it animates.
function drawSegments(segs: RingSegment[], f: number, size: number, radius: number, thickness: number, circumference: number, ringId: string) {
  const GAP = 2.5;
  const MIN = circumference * 0.015; // a 1 km swim on a 300 km focus still shows
  let lens = segs.map((sg) => Math.max(Math.max(0, sg.frac) * circumference, MIN));
  const total = lens.reduce((a, b) => a + b, 0);
  const full = circumference - GAP;
  if (total > full) lens = lens.map((l) => (l * full) / total);
  const drawn = lens.reduce((a, b) => a + b, 0) * f;
  const c = size / 2;
  const at = (len: number) => {
    const ang = (len / circumference) * 2 * Math.PI;
    return { cx: c + radius * Math.cos(ang), cy: c + radius * Math.sin(ang) };
  };
  const out: ReactNode[] = [];
  let start = 0;
  let lastColour = segs[0].colour;
  lens.forEach((len, i) => {
    const visible = Math.min(len - (i < lens.length - 1 ? GAP : 0), drawn - start);
    if (visible > 0.5) {
      const stroke = segs[i].colour === 'brand' ? `url(#${ringId})` : segs[i].colour;
      out.push(
        <Circle
          key={segs[i].key}
          cx={c} cy={c} r={radius}
          stroke={stroke} strokeWidth={thickness} fill="none"
          strokeDasharray={`${visible} ${circumference}`}
          strokeDashoffset={-start}
        />,
      );
      lastColour = segs[i].colour;
    }
    start += len;
  });
  if (drawn > 0.5) {
    const end = at(Math.min(drawn, start));
    out.push(<Circle key="cap-start" {...at(0)} r={thickness / 2} fill={dotColour(segs[0].colour)} />);
    out.push(<Circle key="cap-end" {...end} r={thickness / 2} fill={dotColour(lastColour)} />);
  }
  return out;
}

/** The key under a ring split by sport: a dot, the sport and its amount. */
export function RingSportKey({ segments }: { segments: RingSegment[] | null | undefined }) {
  if (!segments || segments.length < 2) return null;
  return (
    <View style={styles.key}>
      {segments.map((sg) => (
        <View key={sg.key} style={styles.keyItem}>
          <View style={[styles.keyDot, { backgroundColor: dotColour(sg.colour) }]} />
          <Text style={styles.keyLabel}>{sg.label} <Text style={styles.keyAmount}>{sg.amountText}</Text></Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Serif italic to match the rest of Today's hero numbers (Total Time
  // Earned, Total Effort, Next Event days, LEGEND rank) — Ricky's standing
  // rule for this screen. team-hub.tsx's OWN ChallengeRing (a separate copy,
  // not this component) intentionally keeps its plain white number; this
  // component is only consumed by home.tsx's Focus card right now.
  ringValue: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', color: RivalColors.accentFill,
    textAlign: 'center',
    ...(webFx({
      backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #D97757 150%)',
      backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent',
    })),
  },
  ringTarget: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  key: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, rowGap: 8, marginTop: 16, marginHorizontal: 4 },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyDot: { width: 8, height: 8, borderRadius: 4 },
  keyLabel: { fontFamily: RivalFontFamily, fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  keyAmount: { fontWeight: '500', color: 'rgba(255,255,255,0.5)' },
});
