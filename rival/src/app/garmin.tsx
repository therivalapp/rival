import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyPageHead, GREY_PAGE_BG, RivalIcon } from '../components/rival';
import { GreyPrimary } from '../components/rival/RivalGreySheet';
import { goBack } from '../lib/tabNav';
import { connectGarmin, disconnectGarmin, garminStatus } from '../lib/garmin';

// Garmin (Mockup 31, approved 2026-11-11). A: Connect opens Garmin's own
// sign-in. C: once connected, what happens from now on, and the history
// import as the next step. Garmin's Starter access sends only activities
// recorded after connecting, so past activities come from Garmin's data
// download, read by the archive import (lib/archive.ts).

const STEPS = [
  'On garmin.com, Account, Data Management, Export your data',
  'Garmin emails a .zip, usually within a day or two',
  'Import it here. Duplicates are skipped',
];

export default function GarminScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const params = useLocalSearchParams<{ garmin?: string }>();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [note, setNote] = useState<string | null>(
    params.garmin === 'failed' ? 'Garmin could not be connected. Try again.' : null,
  );

  const load = useCallback(() => { garminStatus().then((s) => setConnected(s.connected)).catch(() => setConnected(false)); }, []);
  useFocusEffect(load);
  useEffect(() => { if (params.garmin) load(); }, [params.garmin, load]);

  const connect = async () => {
    setBusy('connect'); setNote(null);
    const r = await connectGarmin();
    if (r === 'redirecting') return;
    setBusy(null);
    if (r === 'connected') load();
    else if (r === 'failed') setNote('Garmin could not be connected. Try again.');
  };

  const disconnect = async () => {
    if (typeof window !== 'undefined' && window.confirm && !window.confirm('Disconnect Garmin? New activities stop arriving. Activities already in RIVAL stay.')) return;
    setBusy('disconnect'); setNote(null);
    const ok = await disconnectGarmin();
    setBusy(null);
    if (ok) setConnected(false); else setNote('Garmin could not be disconnected. Try again.');
  };

  const history = (
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
  );

  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="CONNECTED DEVICES" title="Garmin" sub={connected ? 'Connected' : undefined} onBack={() => goBack()} />

        {connected ? (
          <>
            <View style={s.card}>
              <Text style={s.label}>From now on</Text>
              <Text style={s.body}>Each activity your Garmin records arrives within minutes of syncing to Garmin Connect.</Text>
            </View>
            {history}
            <View style={{ height: 12 }} />
            <GreyPrimary label="Import Garmin history" onPress={() => router.push('/import-archive')} />
            <GreyPrimary label="Done" tone="ghost" onPress={() => goBack()} />
            <Pressable onPress={disconnect} disabled={!!busy} style={s.quiet}>
              <Text style={s.quietText}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={[s.card, s.hero]}>
              <View style={s.badge}><Text style={s.badgeText}>GARMIN</Text></View>
              <Text style={s.heroTitle}>Every activity, as it happens</Text>
              <Text style={[s.body, { textAlign: 'center' }]}>
                New activities from your Garmin device arrive in RIVAL on their own, with routes, heart rate, pace and splits.
              </Text>
            </View>
            <View style={s.card}>
              <Text style={s.label}>Past activities</Text>
              <Text style={s.body}>Garmin sends activities recorded after you connect. To bring in your history, import Garmin's data download after connecting.</Text>
            </View>
            <View style={{ height: 12 }} />
            <GreyPrimary label="Connect" busy={busy === 'connect'} disabled={connected === null || !!busy} onPress={connect} />
            <Text style={s.note}>RIVAL only reads activities. Nothing is written to Garmin.</Text>
          </>
        )}
        {note ? <Text style={[s.note, { color: RivalColors.accentText }]}>{note}</Text> : null}
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
  badgeText: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, color: '#fff' },
  heroTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, color: '#fff', marginTop: 4, textAlign: 'center' },
  label: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1.7, textTransform: 'uppercase', color: RivalColors.accentText },
  body: { fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.72)' },
  steps: { gap: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,181,158,0.14)' },
  dotText: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '800', color: RivalColors.accentText },
  stepText: { flex: 1, fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.72)' },
  note: { fontFamily: RivalFontFamily, fontSize: 12, lineHeight: 17, color: RivalColors.textSecondary, textAlign: 'center' },
  quiet: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  quietText: { fontFamily: RivalFontFamily, fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
});
