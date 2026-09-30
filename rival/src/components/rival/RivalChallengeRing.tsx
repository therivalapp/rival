import { useEffect, useId, useRef, useState } from 'react';
import { Platform, View, Text, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, RivalIconName } from './RivalIcon';

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
  target,
  unit,
  icon = null,
  size = 200,
  thickness = 14,
  style,
  animate,
}: {
  pct: number;
  value: number;
  target: number;
  unit: string;
  icon?: RivalIconName | null;
  size?: number;
  thickness?: number;
  style?: ViewStyle;
  /** Fill the ring from empty and count the number up from 0, starting when
   *  `run` turns true. Once per mount. */
  animate?: { run: boolean; ms: number; ease: (p: number) => number };
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
  const formatted = formatRingValue(value * f, target);
  // Sized for the final number, so the digits don't change size as they count.
  const valueSize = ringValueFontSize(formatRingValue(value, target), size);
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
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={`url(#${ringId})`} strokeWidth={thickness} fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
        />
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
      <Text
        style={[
          styles.ringValue,
          { fontSize: valueSize, lineHeight: Math.round(valueSize * 1.06), marginTop: -Math.round(valueSize * 0.12) },
        ]}
      >
        {formatted}
      </Text>
      <Text style={styles.ringTarget}>{unit}</Text>
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
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #D97757 150%)',
      backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent',
    } as any : {}),
  },
  ringTarget: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
});
