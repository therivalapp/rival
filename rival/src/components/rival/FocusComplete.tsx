import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon } from './RivalIcon';
import { GlassPill, GLASS_TEXT } from './GlassPill';
import { inkNudge } from '../../lib/inkCentre';
import { GreySheet } from './RivalGreySheet';
import { CompleteRing, heroSize, useIntroClock } from './team/ChallengeResults';

// Focus complete (Mockup 66 v4, Ricky 2026-11-15). The first time a goal is
// reached, the ring counts to 100%, turns gold, the tick draws in and confetti
// falls, as on a completed team challenge but without the podium. Then, like
// the team version, the ring fades and the total counts up big in gold, since
// the distance is the achievement (Ricky 2026-11-15), with GOAL COMPLETE above
// it and the next step below: Next Focus when other goals are lined up, Set
// next Focus when there are none.

export type NextFocus = { id: string; label: string; sub: string; pct: number };

const INTRO_END = 10.2;
const e3 = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const io = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

export function FocusComplete({ target, unit, daysEarly, facts, hasOthers, play, onConfetti, onFinished, onNext }: {
  target: number; unit: string; daysEarly: number | null; facts: { activities: number; seconds: number; days: number };
  hasOthers: boolean; play: boolean; onConfetti: () => void; onFinished: () => void; onNext: () => void;
}) {
  const t = useIntroClock(play, onConfetti, onFinished, INTRO_END);
  const intro = t < INTRO_END;
  // Mockup 74 A1. Ring fills, tick draws, one pop and confetti; the tick holds
  // a second, then shrinks and drops towards GOAL COMPLETE as the pill
  // arrives; the total rises inside the ring over 3 s; then the line, the
  // facts one after another, and the button.
  const pillIn = intro ? io((t - 5.75) / 0.5) : 1;
  const numIn = intro ? io((t - 6.1) / 0.6) : 1;
  const count = intro ? e3((t - 6.1) / 3) : 1;
  const lineIn = intro ? io((t - 7.6) / 0.6) : 1;
  const factIn = (i: number) => (intro ? io((t - (8.1 + i * 0.35)) / 0.6) : 1);
  const factCount = (i: number) => (intro ? e3((t - (8.1 + i * 0.35)) / 1.2) : 1);
  const btnIn = intro ? io((t - 9.4) / 0.6) : 1;
  const decimals = target % 1 !== 0 ? 1 : 0;
  const shown = count >= 1 ? target : Math.round(target * count * 10 ** decimals) / 10 ** decimals;
  const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const early = daysEarly && daysEarly > 0 ? `Finished ${daysEarly} ${daysEarly === 1 ? 'day' : 'days'} early` : 'Goal reached';
  const secs = Math.round(facts.seconds * factCount(1));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return (
    <View style={s.wrap}>
      <CompleteRing
        t={intro ? t : 7}
        hold
        soft
        tickOutAt={5.45}
        center={numIn > 0 ? (
          <View style={{ alignItems: 'center', opacity: numIn, transform: [{ translateY: 10 * (1 - numIn) }] }}>
            {/* Sized for the final number, so it fits the ring however long.
                No one-line clipping: on the web it cut the italic 5's ball. */}
            <Text style={[s.hero, { fontSize: heroSize(fmt(target)), lineHeight: heroSize(fmt(target)) * 1.15, transform: [{ translateY: inkNudge(fmt(target), heroSize(fmt(target))) }] }]}>{fmt(shown)}</Text>
            <Text style={s.heroUnit}>{unit}</Text>
          </View>
        ) : null}
      />
      <GlassPill tone="gold" style={[s.pill, { opacity: pillIn, transform: [{ scale: 0.85 + 0.15 * pillIn }] }]}>
        <RivalIcon name="checkCircle" size={15} color={GLASS_TEXT.gold} />
        <Text style={s.pillText}>GOAL COMPLETE</Text>
      </GlassPill>
      <Text style={[s.line, { opacity: lineIn }]}>{early}</Text>
      <View style={s.facts}>
        <View style={[s.fact, { opacity: factIn(0) }]}>
          <Text style={s.factNum}>{Math.round(facts.activities * factCount(0))}</Text>
          <Text style={s.factLabel}>{facts.activities === 1 ? 'ACTIVITY' : 'ACTIVITIES'}</Text>
        </View>
        <View style={[s.fact, s.factLine, { opacity: factIn(1) }]}>
          {/* Separate pieces on one baseline, so the small h and m don't
              push TIME lower than the other labels. */}
          <View style={s.timeRow}>
            {h > 0 ? <><Text style={s.factNum}>{h}</Text><Text style={s.factUnit}>h</Text></> : null}
            <Text style={s.factNum}>{m}</Text><Text style={s.factUnit}>m</Text>
          </View>
          <Text style={s.factLabel}>TIME</Text>
        </View>
        <View style={[s.fact, s.factLine, { opacity: factIn(2) }]}>
          <Text style={s.factNum}>{Math.round(facts.days * factCount(2))}</Text>
          <Text style={s.factLabel}>{facts.days === 1 ? 'DAY' : 'DAYS'}</Text>
        </View>
      </View>
      <TouchableOpacity style={[s.btn, { opacity: btnIn }]} onPress={onNext} activeOpacity={0.85} accessibilityRole="button">
        <Text style={s.btnText}>{hasOthers ? 'Next Goal' : 'Set next Goal'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function MiniRing({ pct }: { pct: number }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <Svg width={36} height={36} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={18} cy={18} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={4} fill="none" />
      <Circle cx={18} cy={18} r={r} stroke={RivalColors.accentText} strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray={`${Math.max(0.01, c * Math.min(1, pct))} ${c}`} />
    </Svg>
  );
}

/** Next Focus: one of the other goals takes the spot, or a new one. */
export function NextFocusSheet({ visible, others, onPick, onAdd, onClose }: {
  visible: boolean; others: NextFocus[]; onPick: (id: string) => void; onAdd: () => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
        <GreySheet kicker="GOAL" title="Next Goal" onClose={onClose} footer={null}>
          <View style={s.rows}>
            {others.map((o) => (
              <TouchableOpacity key={o.id} style={s.row} onPress={() => onPick(o.id)} activeOpacity={0.8} accessibilityRole="button">
                <MiniRing pct={o.pct} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowName}>{o.label}</Text>
                  <Text style={s.rowSub}>{o.sub}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.row} onPress={onAdd} activeOpacity={0.8} accessibilityRole="button">
              <View style={s.plus}><RivalIcon name="add" size={18} color={RivalColors.accentText} /></View>
              <Text style={s.rowName}>Add a new Goal</Text>
            </TouchableOpacity>
          </View>
        </GreySheet>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', alignSelf: 'stretch' },
  after: { alignItems: 'center' },
  // Ivory, so the gold stays with the ring and the pill (Ricky 2026-11-15).
  hero: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', color: RivalColors.event, textAlign: 'center', paddingHorizontal: 8 },
  // The unit as on the Focus ring: small, soft white (RivalChallengeRing ringTarget).
  heroUnit: { fontFamily: RivalFontFamily, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, marginTop: 18 },
  pillText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: GLASS_TEXT.gold },
  line: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '800', color: '#fff', marginTop: 10, textAlign: 'center' },
  // The team challenge header's facts row (ChallengeResults facts).
  facts: { flexDirection: 'row', marginTop: 12, width: 330, maxWidth: '100%' },
  fact: { flex: 1, alignItems: 'center' },
  factLine: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.15)' },
  factNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, lineHeight: 31, color: '#fff', paddingHorizontal: 4 },
  // h and m small and plain, as the top bar writes Total time earned.
  factUnit: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontWeight: '600', fontSize: 13, color: 'rgba(255,255,255,0.65)', marginLeft: -2, marginRight: 2 },
  timeRow: { flexDirection: 'row', alignItems: 'baseline' },
  factLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: RivalColors.accentText, marginTop: 1 },
  btn: { marginTop: 15, paddingVertical: 11, paddingHorizontal: 22, borderRadius: 999, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  btnText: { fontSize: 13.5, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.72)' },
  rows: { gap: 10, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  rowName: { fontFamily: RivalFontFamily, fontSize: 15, fontWeight: '800', color: '#fff' },
  rowSub: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  plus: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,181,158,0.5)', alignItems: 'center', justifyContent: 'center' },
});

