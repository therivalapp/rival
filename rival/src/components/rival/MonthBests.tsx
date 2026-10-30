import { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, type RivalIconName } from './RivalIcon';

// The month's personal bests on Activity (phones, Ricky 2026-10-16, option
// B3): the week card's grey (no glow since 2026-10-29), the month as a serif
// title, and the bests as rows: what and the day, then old to new, the best
// it beat struck through and the new one in gold. Three show; See all opens
// the rest. Each row opens its activity. Folded to one line (the latest
// best) until tapped, except on the day a best is set.

export type MonthBest = {
  key: string;
  activityId: string;
  icon: RivalIconName;
  title: string;
  /** The day, "Oct 15". */
  sub: string;
  value: string;
  unit?: string;
  /** The best it beat, shown struck through before the new one. */
  was?: string;
  date: string;
};

const SHOWN = 3;

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** Old to new: the best it beat struck through, then the new one in gold. */
function Figure({ b, small }: { b: MonthBest; small?: boolean }) {
  return (
    <>
      {b.was ? (
        <>
          <Text style={s.was} numberOfLines={1}>{b.was}</Text>
          <Text style={s.arrow}>→</Text>
        </>
      ) : null}
      <Text style={[s.value, small && s.valueSmall]} numberOfLines={1}>
        {b.value}
        {b.unit ? <Text style={s.unit}>{b.unit}</Text> : null}
      </Text>
    </>
  );
}

export function MonthBests({ month, bests, onOpen }: { month: string; bests: MonthBest[]; onOpen: (activityId: string) => void }) {
  const [all, setAll] = useState(false);
  // Folded to one line so the activity cards stay near the top (Ricky,
  // 2026-10-16); open on the day a new best is set, for its moment.
  const [open, setOpen] = useState(() => !!bests[0] && isToday(bests[0].date));
  if (!bests.length) return null;
  const shown = all ? bests : bests.slice(0, SHOWN);
  const latest = bests[0];

  if (!open) {
    return (
      <TouchableOpacity style={[s.card, s.cardFolded]} onPress={() => setOpen(true)} activeOpacity={0.85} accessibilityRole="button" accessibilityState={{ expanded: false }}>
        <RivalIcon name="trophy" size={20} color="#ffd27a" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.kicker} numberOfLines={1}>{month} bests · {bests.length}</Text>
          <Text style={s.rowTitle} numberOfLines={1}>{latest.title}</Text>
        </View>
        <Figure b={latest} small />
        <RivalIcon name="chevronDown" size={18} color="rgba(255,255,255,0.4)" />
      </TouchableOpacity>
    );
  }

  return (
    // Open, a tap anywhere but a row folds it; rows open their activity.
    <TouchableOpacity style={s.card} onPress={() => setOpen(false)} activeOpacity={0.95}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>Personal bests · {bests.length}</Text>
          <Text style={s.title}>{month}</Text>
        </View>
        {bests.length > SHOWN ? (
          <TouchableOpacity onPress={() => setAll((v) => !v)} hitSlop={8} accessibilityRole="button" style={{ marginRight: 12 }}>
            <Text style={s.see}>{all ? 'Show fewer' : 'See all'}</Text>
          </TouchableOpacity>
        ) : null}
        <RivalIcon name="chevronDown" size={18} color="rgba(255,255,255,0.4)" style={{ transform: [{ rotate: '180deg' }], marginBottom: 3 }} />
      </View>
      <View style={s.rows}>
        {shown.map((b, i) => (
          <TouchableOpacity key={b.key} style={[s.row, i > 0 && s.rowDivided]} onPress={() => onOpen(b.activityId)} activeOpacity={0.8} accessibilityRole="button">
            <RivalIcon name={b.icon} size={17} color="#ffd27a" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.rowTitle} numberOfLines={1}>{b.title}</Text>
              <Text style={s.rowSub} numberOfLines={1}>{b.sub}</Text>
            </View>
            <Figure b={b} />
          </TouchableOpacity>
        ))}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: { position: 'relative', overflow: 'hidden', borderRadius: 22, padding: 15, gap: 12, backgroundColor: RivalGhost.ground },
  cardFolded: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-end' },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: '#ffd27a' },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, lineHeight: 26, color: '#fff' },
  see: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText, marginBottom: 3 },
  rows: { borderRadius: 16, backgroundColor: RivalGhost.fill },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11 },
  rowDivided: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  rowSub: { fontSize: 11.5, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  was: { fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecorationLine: 'line-through', textDecorationColor: 'rgba(255,255,255,0.3)' } as any,
  arrow: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginHorizontal: -5 },
  value: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, lineHeight: 26, color: '#ffc94d',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #fff4d6, #ffc94d)', backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } as any : {}),
  },
  valueSmall: { fontSize: 20, lineHeight: 25 },
  unit: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginLeft: 2, WebkitTextFillColor: 'rgba(255,255,255,0.5)' } as any,
});
