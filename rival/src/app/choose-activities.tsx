import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalGhost } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyLabel, GreyPageHead, GreyPrimary, GREY_PAGE_BG, RivalIcon, activityIconName, type RivalIconName } from '../components/rival';
import { TYPE_GROUPS, tileLabel } from '../lib/activityTypes';
import { getPrefs, updatePrefs } from '../lib/prefs';

// Choose activities (Ricky, 2026-11-02; design/new-member-setup-mockup.png).
// Straight after creating an account, before Getting started. The picks lead
// on Start and the activity tiles until logged history outranks them
// (recentTypes.withUsual).

// The most common first; the rest sit in their groups below.
const COMMON = ['Run', 'WeightTraining', 'Workout', 'Ride', 'Swim', 'Walk', 'Hike', 'HIIT', 'CrossFit', 'Hyrox', 'Calisthenics', 'Yoga'];
const GROUP_ICONS: Record<string, RivalIconName> = {
  'Run and walk': 'run', Ride: 'ride', 'Gym and classes': 'weights', Water: 'swim',
  'Racket sports': 'tennis', 'Team sports': 'soccer', Winter: 'ski', Other: 'golf',
};
const LABELS: Record<string, string> = { WeightTraining: 'Weight training' };
const label = (t: string) => LABELS[t] ?? tileLabel(t);

export default function ChooseActivitiesScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const [picked, setPicked] = useState<string[]>(() => getPrefs().usualTypes);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  const next = () => router.replace('/getting-started?welcome=1');

  async function save() {
    setSaving(true);
    // A failed save only loses the tailoring; the defaults still work.
    await updatePrefs({ usualTypes: picked });
    setSaving(false);
    next();
  }

  const tile = (t: string) => {
    const on = picked.includes(t);
    return (
      <TouchableOpacity
        key={t}
        style={[s.tile, on ? s.tileOn : s.tileOff]}
        onPress={() => toggle(t)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={label(t)}
        accessibilityState={{ selected: on }}
      >
        <View style={[s.tileIcon, { pointerEvents: 'none' }]}>
          <RivalIcon name={activityIconName(t)} size={56} color={on ? 'rgba(255,255,255,0.32)' : 'rgba(255,181,158,0.2)'} />
        </View>
        {on ? <View style={s.tick}><RivalIcon name="check" size={16} color={TILE_INK} /></View> : null}
        <Text style={[s.tileLabel, on && s.tileLabelOn]}>{label(t)}</Text>
      </TouchableOpacity>
    );
  };

  const groups = TYPE_GROUPS.map(([name, types]) => [name, types.filter((t) => !COMMON.includes(t))] as const).filter(([, types]) => types.length);

  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="SET UP" title="Choose activities" sub="RIVAL is tailored around your choices." />
        <View style={s.steps}><View style={[s.step, s.stepOn]} /><View style={s.step} /></View>

        <View style={s.labRow}>
          <GreyLabel>Activities</GreyLabel>
          {picked.length ? <Text style={s.count}>{picked.length} picked</Text> : null}
        </View>
        <View style={s.grid}>{COMMON.map(tile)}</View>

        <GreyLabel>More activities</GreyLabel>
        <View style={s.card}>
          {groups.map(([name, types], i) => {
            const isOpen = open === name;
            const n = types.filter((t) => picked.includes(t)).length;
            return (
              <View key={name} style={i > 0 && s.rule}>
                <TouchableOpacity style={s.row} onPress={() => setOpen(isOpen ? null : name)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
                  <RivalIcon name={GROUP_ICONS[name] ?? 'workout'} size={20} color={RivalColors.accentText} />
                  <Text style={s.rowName}>{name}</Text>
                  {n ? <Text style={s.rowCount}>{n} picked</Text> : null}
                  <RivalIcon name={isOpen ? 'chevronUp' : 'chevronDown'} size={20} color="rgba(255,255,255,0.45)" />
                </TouchableOpacity>
                {isOpen ? <View style={[s.grid, s.gridIn]}>{types.map(tile)}</View> : null}
              </View>
            );
          })}
        </View>

        <View style={s.actions}>
          <GreyPrimary label="Continue" busy={saving} disabled={saving} onPress={save} />
          <TouchableOpacity style={s.skip} onPress={next} accessibilityRole="button">
            <Text style={s.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const TILE_INK = RivalButtonColors.label(RivalColors.onAccentFill);

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  pageWide: { backgroundColor: RivalColors.surfaceContainer },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 60, gap: 12 },
  steps: { flexDirection: 'row', gap: 5, justifyContent: 'center', marginTop: -2 },
  step: { width: 18, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  stepOn: { backgroundColor: RivalColors.accentText },
  labRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { fontFamily: RivalFontFamily, fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText, marginRight: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridIn: { paddingBottom: 12 },
  tile: { flexGrow: 1, flexBasis: '30%', height: 78, borderRadius: 16, paddingHorizontal: 10, paddingBottom: 9, justifyContent: 'flex-end', overflow: 'hidden' },
  tileOff: { borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)', backgroundColor: RivalGhost.fill },
  tileOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  tileIcon: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  tick: { position: 'absolute', top: 7, right: 8 },
  tileLabel: { fontFamily: RivalFontFamily, fontSize: 12.5, fontWeight: '800', color: RivalColors.textPrimary, ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' } as any : {}) },
  tileLabelOn: { color: TILE_INK },
  card: { borderRadius: 16, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, paddingHorizontal: 12 },
  rule: { borderTopWidth: 1, borderTopColor: RivalGhost.hairline },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 48 },
  rowName: { flex: 1, fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', color: '#fff' },
  rowCount: { fontFamily: RivalFontFamily, fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  actions: { gap: 6, marginTop: 8 },
  skip: { alignItems: 'center', paddingVertical: 10 },
  skipText: { fontFamily: RivalFontFamily, fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
});
