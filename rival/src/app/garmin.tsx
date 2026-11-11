import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyPageHead, GREY_PAGE_BG, RivalIcon } from '../components/rival';
import { GreyPrimary } from '../components/rival/RivalGreySheet';
import { goBack } from '../lib/tabNav';

// Garmin (Mockup 31, approved 2026-11-11). Garmin's Starter access sends only
// activities recorded after connecting, so past activities come from Garmin's
// data download, read by the archive import (lib/archive.ts) and shown on the
// same end page as any archive. The live connection (Connect, then Garmin's
// sign-in) switches on with GARMIN_LIVE once the Garmin keys are set up.

const GARMIN_LIVE = false;

const STEPS = [
  'On garmin.com, open Account, Data Management, Export your data',
  'Garmin emails a .zip, usually within a day or two',
  'Import it here. Activities already in RIVAL are skipped',
];

export default function GarminScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="CONNECTED DEVICES" title="Garmin" onBack={() => goBack()} />

        <View style={[s.card, s.hero]}>
          <View style={s.badge}><RivalIcon name="watch" size={34} color="#fff" /></View>
          <Text style={s.heroTitle}>Every activity, as it happens</Text>
          <Text style={[s.body, { textAlign: 'center' }]}>
            New activities from a Garmin device arrive in RIVAL on their own, with routes, heart rate, pace and splits, and the sets of strength activities.
          </Text>
        </View>

        {!GARMIN_LIVE ? (
          <View style={s.card}>
            <Text style={s.label}>Live connection</Text>
            <Text style={s.body}>Opens soon. Past activities can be brought in now.</Text>
          </View>
        ) : null}

        <View style={s.card}>
          <Text style={s.label}>Bring in your history</Text>
          <View style={s.steps}>
            {STEPS.map((step, i) => (
              <View style={s.step} key={step}>
                <View style={s.dot}><Text style={s.dotText}>{i + 1}</Text></View>
                <Text style={s.stepText}>{step}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 12 }} />
        {GARMIN_LIVE ? <GreyPrimary label="Connect" onPress={() => { /* Garmin sign-in, once the keys are set up */ }} /> : null}
        <GreyPrimary label="Import Garmin history" tone={GARMIN_LIVE ? 'ghost' : undefined} onPress={() => router.push('/import-archive')} />
        <Text style={s.note}>RIVAL only reads activities. Nothing is written to Garmin.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  pageWide: { backgroundColor: RivalColors.surfaceContainer },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  card: { borderRadius: 22, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, padding: 16, gap: 10 },
  hero: { alignItems: 'center', paddingTop: 26, paddingBottom: 18 },
  badge: { width: 64, height: 64, borderRadius: 18, backgroundColor: '#000', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, color: '#fff', marginTop: 4, textAlign: 'center' },
  label: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1.7, textTransform: 'uppercase', color: RivalColors.accentText },
  body: { fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.72)' },
  steps: { gap: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,181,158,0.14)' },
  dotText: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '800', color: RivalColors.accentText },
  stepText: { flex: 1, fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.72)' },
  note: { fontFamily: RivalFontFamily, fontSize: 12, lineHeight: 17, color: RivalColors.textSecondary, textAlign: 'center' },
});
