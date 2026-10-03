import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import { RivalIcon, GreyPageHead, GreyLabel, GreyNote, GREY_PAGE_BG, type RivalIconName } from '../components/rival';
import { activityTypeLabel } from '../components/rival/EffortBreakdownSheet';
import { effortBreakdown, loadScoringConfig, type ScoringConfig } from '../lib/effort';
import { distanceUnit, elevationUnit, formatActivityDistance, formatElevation, FEET_PER_METRE, KM_PER_MILE } from '../lib/units';
import { goToTab } from '../lib/tabNav';

// How Effort works — the scoring rules in plain language, with worked
// examples and every rate. Examples and rates are computed from the live
// scoring_config through lib/effort.ts, so this page cannot drift from the
// numbers activities are actually scored with.

const IDEAS: { icon: RivalIconName; title: string; body: string }[] = [
  {
    icon: 'distance',
    title: 'Distance sports score on distance',
    body: 'Runs, rides, swims, hikes and rows earn most of their Effort from distance, with some for time. Indoor activities count when a distance is recorded.',
  },
  {
    icon: 'timer',
    title: 'Everything else scores on time',
    body: 'Gym work, HYROX, CrossFit, yoga and team sports are scored on time, weighted by activity. So is any distance sport with no distance recorded.',
  },
  {
    icon: 'elevation',
    title: 'Climbing adds Effort',
    body: 'Climbing adds Effort on foot, bike and skis, including treadmill incline.',
  },
  {
    icon: 'check',
    title: 'Only what can be measured',
    body: 'Each sport has a realistic top speed, such as 24 km/h running or 60 km/h cycling, and climbing is limited to 2,500 m an hour. An activity faster than that is sent to you to check: edit it, or confirm it is correct and all of it counts. There is no bonus for heart rate or intensity.',
  },
];

// Worked examples, scored live.
const EXAMPLES: { type: string; minutes: number; meters: number; climb: number }[] = [
  { type: 'Run', minutes: 50, meters: 10000, climb: 0 },
  { type: 'Run', minutes: 50, meters: 8000, climb: 0 },
  { type: 'Ride', minutes: 60, meters: 30000, climb: 300 },
  { type: 'WeightTraining', minutes: 50, meters: 0, climb: 0 },
];

const TIME_PREVIEW = 8;

export default function EffortScreen() {
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [allTime, setAllTime] = useState(false);
  useEffect(() => { loadScoringConfig().then(setConfig); }, []);

  const back = () => (router.canGoBack() ? router.back() : goToTab('/home'));
  const imperial = distanceUnit() === 'mi';
  const perDist = (perKm: number) => (imperial ? perKm * KM_PER_MILE : perKm);
  const num = (n: number) => (Math.round(n * 100) / 100).toString();

  const types = config ? Object.keys(config.multipliers) : [];
  const distanceTypes = types
    .filter((t) => (config?.distanceRates?.[t] ?? 0) > 0)
    .sort((a, b) => activityTypeLabel(a).localeCompare(activityTypeLabel(b)));
  const timeTypes = types
    .filter((t) => !((config?.distanceRates?.[t] ?? 0) > 0))
    .sort((a, b) => (config!.multipliers[b] - config!.multipliers[a]) || activityTypeLabel(a).localeCompare(activityTypeLabel(b)));
  const climbRate = config ? Math.max(0, ...Object.values(config.elevationRates)) : 0;
  const climbPer = imperial ? `${num(climbRate * 100 / FEET_PER_METRE)} per 100 ft` : `${num(climbRate * 100)} per 100 m`;

  return (
    <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead
          kicker="EFFORT"
          title="How Effort works"
          sub="How long, how far and how high."
          onBack={back}
        />

        <View style={s.card}>
          {IDEAS.map((idea, i) => (
            <View key={idea.title} style={[s.idea, i > 0 && s.rule]}>
              <View style={s.badge}>
                <RivalIcon name={idea.icon} size={16} color={RivalColors.accentText} />
              </View>
              <View style={s.ideaText}>
                <Text style={s.ideaTitle}>{idea.title}</Text>
                <Text style={s.ideaBody}>{idea.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {config ? (
          <>
            <GreyLabel>Examples</GreyLabel>
            <View style={s.card}>
              {EXAMPLES.map((ex, i) => {
                const b = effortBreakdown(ex.type, ex.minutes * 60, ex.climb, config, ex.meters);
                const parts = b.basis === 'time' && b.climbScore === 0 ? 'Scored on time' : [
                  `${Math.round(b.timeScore)} time`,
                  ...(b.distanceScore > 0 ? [`${Math.round(b.distanceScore)} distance`] : []),
                  ...(b.climbScore > 0 ? [`${Math.round(b.climbScore)} climbing`] : []),
                ].join(' + ');
                const what = [
                  ex.meters > 0 ? formatActivityDistance(ex.meters, ex.type) : null,
                  `${ex.minutes} min`,
                  ex.climb > 0 ? `${formatElevation(ex.climb)} climbed` : null,
                ].filter(Boolean).join(' · ');
                return (
                  <View key={i} style={[s.row, i > 0 && s.rule]}>
                    <View style={s.rowText}>
                      <Text style={s.rowTitle}>{activityTypeLabel(ex.type)} <Text style={s.rowMeta}>{what}</Text></Text>
                      <Text style={s.rowSub}>{parts}</Text>
                    </View>
                    <Text style={s.rowValue}>{Math.round(b.total)}</Text>
                  </View>
                );
              })}
            </View>

            <GreyLabel>Scored on distance</GreyLabel>
            <View style={s.card}>
              {distanceTypes.map((t, i) => (
                <View key={t} style={[s.rateRow, i > 0 && s.rule]}>
                  <Text style={s.rateName} numberOfLines={1}>{activityTypeLabel(t)}</Text>
                  <Text style={s.rate}>
                    {num(perDist(config.distanceRates![t]))} / {distanceUnit()}
                    <Text style={s.rateDim}>  +  {num(config.distanceTimeRates?.[t] ?? 0)} / min</Text>
                  </Text>
                </View>
              ))}
            </View>
            <GreyNote>Climbing adds {climbPer} on foot, bike and skis.</GreyNote>

            <GreyLabel>Scored on time</GreyLabel>
            <View style={s.card}>
              {(allTime ? timeTypes : timeTypes.slice(0, TIME_PREVIEW)).map((t, i) => (
                <View key={t} style={[s.rateRow, i > 0 && s.rule]}>
                  <Text style={s.rateName} numberOfLines={1}>{activityTypeLabel(t)}</Text>
                  <Text style={s.rate}>{num(config.multipliers[t])} / min</Text>
                </View>
              ))}
              {timeTypes.length > TIME_PREVIEW ? (
                <TouchableOpacity style={[s.rateRow, s.rule, s.more]} onPress={() => setAllTime((v) => !v)} accessibilityRole="button">
                  <Text style={s.moreText}>{allTime ? 'Show fewer' : `Show all ${timeTypes.length}`}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : null}

        <TouchableOpacity style={[s.card, s.link]} onPress={() => router.push('/ranks')} activeOpacity={0.8}>
          <View style={s.badge}><RivalIcon name="crown" size={16} color={RivalColors.accentText} /></View>
          <View style={s.ideaText}>
            <Text style={s.ideaTitle}>Ranks</Text>
            <Text style={s.ideaBody}>Effort moves you up the ranks through the year.</Text>
          </View>
          <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 120, gap: 0 },
  card: {
    backgroundColor: RivalColors.surfaceLowest, borderRadius: 16,
    borderWidth: 1, borderColor: RivalColors.surfaceBright, paddingHorizontal: 13, marginTop: 12,
  },
  rule: { borderTopWidth: 1, borderTopColor: 'rgba(50,50,50,0.8)' },
  badge: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  idea: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 13 },
  ideaText: { flex: 1, gap: 3 },
  ideaTitle: { fontSize: 14.5, fontWeight: '700', color: '#fff' },
  ideaBody: { fontSize: 13, lineHeight: 18.5, color: RivalColors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  rowMeta: { fontSize: 13, fontWeight: '500', color: RivalColors.textSecondary },
  rowSub: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  rowValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 20, fontWeight: '700', color: RivalColors.accentText, fontVariant: ['tabular-nums'] },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 42 },
  rateName: { flex: 1, fontSize: 13.5, fontWeight: '600', color: RivalColors.textSecondary },
  rate: { fontSize: 13.5, fontWeight: '600', color: '#fff', fontVariant: ['tabular-nums'] },
  rateDim: { fontWeight: '500', color: 'rgba(255,255,255,0.45)' },
  more: { justifyContent: 'center' },
  moreText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginTop: 20 },
});
