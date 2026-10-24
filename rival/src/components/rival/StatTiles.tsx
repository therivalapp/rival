import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalButtonColors, RivalGhost, RivalSerifFamily } from '../../constants/rivalTheme';
import { MAX_STATS, type StatKey, type StatOption } from '../../lib/shareStamp';

// The stats to put on a share card or stamp, as mini tiles that show the real
// figure (rival/design/share-stat-tiles.html, Ricky 2026-10-22: tiles, not
// pills). Chosen ones are lit peach; Effort is a solid gold tile, always on
// (on a lift activity, a choice that starts off);
// once three are chosen the rest fade.

type Props = {
  options: StatOption[];
  chosen: StatKey[];
  effort: number;
  onToggle: (key: StatKey) => void;
  /** Given for lift activities: Effort becomes a choice, gold when on, a
   *  plain tile when off (Ricky, 2026-10-23). Otherwise it's always on. */
  effortOn?: boolean;
  onToggleEffort?: () => void;
};

export function StatTiles({ options, chosen, effort, onToggle, effortOn = true, onToggleEffort }: Props) {
  const full = chosen.length >= MAX_STATS;
  const tile = (o: StatOption) => {
    const on = chosen.includes(o.key);
    return (
      <TouchableOpacity
        key={o.key}
        style={[t.tile, on && t.tileOn, !on && full && t.tileFull]}
        onPress={() => onToggle(o.key)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${o.label}, ${o.figure.value}${o.figure.unit ? ` ${o.figure.unit}` : ''}`}
      >
        <Text style={[t.value, on && t.valueOn]} numberOfLines={1}>
          {o.figure.value}
          {o.figure.unit ? <Text style={[t.unit, on && t.unitOn]}>{` ${o.figure.unit}`}</Text> : null}
        </Text>
        <Text style={[t.label, on && t.labelOn]} numberOfLines={1}>{o.figure.label}</Text>
      </TouchableOpacity>
    );
  };
  // One grid: the everyday stats, then whatever the connected device sent,
  // then Effort, which is always on (Ricky, 2026-10-22: no separate section).
  return (
    <View style={t.wrap}>
      <Text style={t.heading}>{`Select up to ${MAX_STATS}`}</Text>
      <View style={t.grid}>
        {options.map(tile)}
        {onToggleEffort ? (
          <TouchableOpacity
            style={[t.tile, effortOn && t.tileGold]}
            onPress={onToggleEffort}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: effortOn }}
            accessibilityLabel={`Effort, ${effort}`}
          >
            <Text style={[t.value, effortOn && t.valueGold]} numberOfLines={1}>{String(Math.round(effort * 10) / 10)}</Text>
            <Text style={[t.label, effortOn && t.labelGold]}>Effort</Text>
          </TouchableOpacity>
        ) : (
          <View style={[t.tile, t.tileGold]} accessibilityLabel={`Effort, ${effort}, always shown`}>
            <Text style={[t.value, t.valueGold]} numberOfLines={1}>{String(Math.round(effort * 10) / 10)}</Text>
            <Text style={[t.label, t.labelGold]}>Effort</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const t = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 7 },
  heading: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  // Four to a row.
  tile: {
    width: '23%', flexGrow: 1, maxWidth: '24%', alignItems: 'center', gap: 3, paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 12, borderWidth: 1, borderColor: RivalGhost.border, backgroundColor: RivalGhost.fill, overflow: 'hidden',
  },
  tileOn: { borderColor: 'transparent', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  tileFull: { opacity: 0.4 },
  // Solid gold with a gentle sheen, pale at the top left to deep at the
  // bottom right, and a faint bright top edge (Ricky, 2026-10-22).
  tileGold: {
    borderColor: 'transparent', backgroundColor: '#f5c76a',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(160deg, #fff0b0 0%, #f5c76a 45%, #c4932a 100%)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)',
    } as any : {}),
  },
  value: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, lineHeight: 18, color: 'rgba(255,255,255,0.6)' },
  valueOn: { color: '#2a120a' },
  valueGold: { color: '#3a2600' },
  unit: { fontFamily: undefined, fontStyle: 'normal', fontSize: 9, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  unitOn: { color: 'rgba(42,18,10,0.65)' },
  label: { fontSize: 8.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' },
  labelOn: { color: 'rgba(42,18,10,0.75)' },
  labelGold: { color: 'rgba(58,38,0,0.75)' },
});

