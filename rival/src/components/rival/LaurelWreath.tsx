import { useId, useMemo } from 'react';
import { Platform } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

// The gold laurel wreath around the Weekly Leader's picture, chosen in the
// podium workbench (2026-09-26, "Crossed stems, thinner"). Two branches of
// soft, slightly irregular leaves grow up both sides of the picture and stop
// three quarters of the way up; below it their stems cross in an X.

const PAD = 26; // room around the picture for the leaves and stem ends
const GAP = 5; // stem distance outside the picture's edge
const RANGE: [number, number] = [22, 120]; // degrees round from the bottom
const PAIRS = 9;
const LEAF_LEN = 7.8;
const LEAF_WID = 2.35;
const SPREAD = 28; // leaf angle off the stem
const STEM = 1;
const TAIL = 1.55; // how far the stems carry on past where they cross
const GOLD = ['#FFF4B8', '#FFD700', '#B8860B'];
const EDGE = '#7a5a10';

const f1 = (n: number) => n.toFixed(1);

type Leaf = { x: number; y: number; angle: number; d: string; vein: string };

function build(avatarSize: number) {
  const size = avatarSize + PAD * 2;
  const c = size / 2;
  const r = avatarSize / 2 + GAP;
  const [t0, t1] = RANGE;
  const at = (side: number, t: number) => {
    const th = ((90 + side * t) * Math.PI) / 180;
    return { x: c + r * Math.cos(th), y: c + r * Math.sin(th), th };
  };
  const stems: string[] = [];
  const leaves: Leaf[] = [];
  const tips: { x: number; y: number; angle: number; d: string }[] = [];

  for (const side of [-1, 1]) {
    const a0 = at(side, t0);
    const a1 = at(side, t1);
    // Carry the stem straight on from the base of the branch, across the
    // other stem, to a short end on the far side.
    const gx = side * -Math.sin(a0.th);
    const gy = side * Math.cos(a0.th);
    const cross = (c - a0.x) / -gx;
    stems.push(`M${f1(a0.x)},${f1(a0.y)} L${f1(a0.x - gx * cross * TAIL)},${f1(a0.y - gy * cross * TAIL)}`);
    stems.push(`M${f1(a0.x)},${f1(a0.y)} A${r},${r} 0 0 ${side < 0 ? 0 : 1} ${f1(a1.x)},${f1(a1.y)}`);

    for (let i = 0; i < PAIRS; i++) {
      const f = i / (PAIRS - 1);
      const p = at(side, t0 + (t1 - t0) * f);
      const base = (Math.atan2(side * Math.cos(p.th), side * -Math.sin(p.th)) * 180) / Math.PI;
      const len = LEAF_LEN * (1 - f * 0.45);
      const wid = LEAF_WID * (1 - f * 0.35);
      for (const k of [-1, 1]) {
        // A small fixed wobble in angle and length so the leaves don't look
        // stamped, and each one bends a little at the tip.
        const wob = Math.sin(i * 2.3 + k * 1.7);
        const l = len * (1 + wob * 0.08);
        const bend = -k * side * wid * 0.9;
        leaves.push({
          x: p.x,
          y: p.y,
          angle: base + k * (SPREAD + wob * 7),
          d: `M0,0 C${f1(l * 0.25)},${f1(-wid * 1.25)} ${f1(l * 0.7)},${f1(-wid * 1.05 + bend * 0.3)} ${f1(l)},${f1(bend * 0.55)} C${f1(l * 0.72)},${f1(wid * 0.85 + bend * 0.3)} ${f1(l * 0.28)},${f1(wid * 1.05)} 0,0 Z`,
          vein: `M0.8,0 Q${f1(l * 0.5)},${f1(bend * 0.1)} ${f1(l * 0.8)},${f1(bend * 0.4)}`,
        });
      }
    }
    // One leaf at the very end of the branch.
    const e = at(side, t1 + 4);
    const tipLen = LEAF_LEN * 0.6;
    tips.push({
      x: e.x,
      y: e.y,
      angle: (Math.atan2(side * Math.cos(e.th), side * -Math.sin(e.th)) * 180) / Math.PI,
      d: `M0,0 Q${f1(tipLen * 0.45)},-2.2 ${f1(tipLen)},0 Q${f1(tipLen * 0.45)},2.2 0,0 Z`,
    });
  }
  return { size, stems, leaves, tips };
}

// Leaves drawn as gold outlines rather than solid shapes. false = filled.
const OUTLINE_LEAVES = false;

/** Sits centred behind a picture of `avatarSize`; place it inside the
 *  picture's own (position: relative) wrapper. */
export function LaurelWreath({ avatarSize }: { avatarSize: number }) {
  const gradId = `laurel${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const { size, stems, leaves, tips } = useMemo(() => build(avatarSize), [avatarSize]);
  const fill = `url(#${gradId})`;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      pointerEvents="none"
      style={[
        { position: 'absolute', left: -PAD, top: -PAD, overflow: 'visible' } as any,
        Platform.OS === 'web'
          ? ({ filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.55))' } as any)
          : null,
      ]}
    >
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={GOLD[0]} />
          <Stop offset="0.5" stopColor={GOLD[1]} />
          <Stop offset="1" stopColor={GOLD[2]} />
        </LinearGradient>
      </Defs>
      {stems.map((d, i) => (
        <Path key={`s${i}`} d={d} fill="none" stroke={fill} strokeWidth={STEM} strokeLinecap="round" />
      ))}
      {leaves.map((l, i) => (
        <G key={`l${i}`} transform={`translate(${f1(l.x)} ${f1(l.y)}) rotate(${f1(l.angle)})`}>
          {OUTLINE_LEAVES ? (
            <>
              <Path d={l.d} fill="none" stroke={fill} strokeWidth={0.9} strokeLinejoin="round" />
              <Path d={l.vein} fill="none" stroke={fill} strokeOpacity={0.7} strokeWidth={0.5} />
            </>
          ) : (
            <>
              <Path d={l.d} fill={fill} stroke={EDGE} strokeOpacity={0.55} strokeWidth={0.45} />
              <Path d={l.vein} fill="none" stroke={EDGE} strokeOpacity={0.5} strokeWidth={0.5} />
            </>
          )}
        </G>
      ))}
      {tips.map((t, i) => (
        <G key={`t${i}`} transform={`translate(${f1(t.x)} ${f1(t.y)}) rotate(${f1(t.angle)})`}>
          <Path d={t.d} fill={OUTLINE_LEAVES ? 'none' : fill} stroke={OUTLINE_LEAVES ? fill : undefined} strokeWidth={OUTLINE_LEAVES ? 0.9 : undefined} strokeLinejoin="round" />
        </G>
      ))}
    </Svg>
  );
}
