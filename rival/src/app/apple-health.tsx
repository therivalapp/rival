import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyPageHead, GREY_PAGE_BG, RivalIcon } from '../components/rival';
import { HistoryReveal } from '../components/rival/HistoryReveal';
import { LoaderCard, Fact } from '../components/rival/ImportPieces';
import { getAuthUser } from '../lib/supabase';
import { goToTab } from '../lib/tabNav';
import { fetchYearEffort } from '../lib/archive';
import {
  healthAvailable, askHealth, readHealth, previewHealth, importHealth, finishConnect,
  type HealthItem, type HealthResult,
} from '../lib/appleHealth';

// Apple Health (Mockup 29, 2026-11-10): the archive import's full treatment.
// Connect, Apple's permission sheet, the Ready to import receipt (nothing is
// added until Import), the RIVAL loader, then the archive's end page. After
// that the connection is saved and new workouts arrive on their own
// (lib/appleHealth.ts).

type Step = 'connect' | 'reading' | 'preview' | 'importing' | 'done' | 'error';

const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

export default function AppleHealthScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const back = () => (router.canGoBack() ? router.back() : goToTab('/home'));
  const [step, setStep] = useState<Step>('connect');
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState(0);
  const [read, setRead] = useState({ done: 0, total: 0 });
  const [all, setAll] = useState<HealthItem[]>([]);
  const [anchor, setAnchor] = useState('');
  const [fresh, setFresh] = useState<HealthItem[]>([]);
  const [prog, setProg] = useState({ done: 0, routes: 0 });
  const [results, setResults] = useState<HealthResult[]>([]);
  const [yearEffort, setYearEffort] = useState(0);

  async function connect() {
    setError(null);
    if (!(await askHealth())) {
      setError('Apple Health could not be opened. Try again.');
      return;
    }
    setStep('reading');
    try {
      const r = await readHealth((done, total) => setRead({ done, total }));
      setFound(r.found);
      setAll(r.items);
      setAnchor(r.anchor);
      const newKeys = r.items.length ? await previewHealth(r.items) : new Set<string>();
      setFresh(r.items.filter((i) => newKeys.has(i.key)));
      setStep('preview');
    } catch {
      setError('Workouts could not be read from Apple Health. Try again.');
      setStep('error');
    }
  }

  async function start() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    setStep('importing');
    setProg({ done: 0, routes: 0 });
    try {
      // Everything goes, so workouts already in RIVAL are linked to Health too.
      const freshKeys = new Set(fresh.map((i) => i.key));
      const ordered = [...fresh, ...all.filter((i) => !freshKeys.has(i.key))];
      const res = await importHealth(ordered, (done, routes) => setProg({ done: Math.min(done, fresh.length), routes }));
      setResults(res);
      await finishConnect(anchor, res.filter((x) => x.status === 'imported').length);
      setYearEffort(await fetchYearEffort(user.id));
      setStep('done');
    } catch {
      setError('The import stopped part way. Activities already added are kept; connect again to finish.');
      setStep('error');
    }
  }

  // Nothing new: the connection is still saved, so new workouts arrive from now on.
  async function finishEmpty() {
    await finishConnect(anchor, 0);
    back();
  }

  const linked = all.length - fresh.length;
  const routes = fresh.filter((i) => i.polyline).length;
  const withHr = fresh.filter((i) => i.avgHeartrate).length;
  const span = fresh.length
    ? `${monthYear(fresh.reduce((a, b) => (a.startedAt < b.startedAt ? a : b)).startedAt)} – ${monthYear(fresh.reduce((a, b) => (a.startedAt > b.startedAt ? a : b)).startedAt)}`
    : '';

  if (step === 'done') {
    const ok = new Map(results.filter((x) => x.status === 'imported').map((x) => [x.key, x]));
    const added = fresh.filter((i) => ok.has(i.key));
    return (
      <HistoryReveal
        kicker="Apple Health imported"
        activities={added.map((i) => ({ ...i, effort: ok.get(i.key)?.effort ?? 0 }))}
        photoUrls={[]}
        yearEffort={yearEffort}
        ctaLabel="See the journal"
        onCta={() => goToTab('/my-activities')}
        onSeeAll={() => goToTab('/my-activities')}
      />
    );
  }

  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="CONNECTED DEVICES" title="Apple Health" onBack={back} />

        {!healthAvailable ? (
          <View style={s.card}>
            <Text style={s.label}>iPhone app</Text>
            <Text style={s.body}>Apple Health connects in the RIVAL iPhone app.</Text>
          </View>
        ) : step === 'connect' || step === 'error' ? (
          <>
            <View style={[s.card, s.hero]}>
              <View style={s.heart}><RivalIcon name="health" size={38} color="#ff375f" /></View>
              <Text style={s.heroTitle}>Every workout, in one place</Text>
              <Text style={[s.body, { textAlign: 'center' }]}>Past and new workouts from Apple Health come into RIVAL, with routes, heart rate and calories.</Text>
            </View>
            <View style={s.card}>
              <Text style={s.label}>Included</Text>
              <Text style={s.body}>Workouts from Apple Watch and other apps that save to Apple Health.</Text>
            </View>
            {error ? <Text style={s.error}>{error}</Text> : null}
            <TouchableOpacity style={s.primary} onPress={connect} activeOpacity={0.85}>
              <Text style={s.primaryText}>Connect</Text>
            </TouchableOpacity>
            <Text style={s.note}>RIVAL only reads from Apple Health.</Text>
          </>
        ) : step === 'reading' ? (
          <LoaderCard
            fileName="Apple Health"
            pct={read.total ? 4 + Math.round((read.done / read.total) * 96) : 4}
            rows={[{ label: 'Workouts', value: read.done, of: read.total || undefined }]}
          />
        ) : step === 'preview' ? (
          <>
            <View style={s.fileRow}>
              <RivalIcon name="health" size={16} color={RivalColors.accentText} />
              <Text style={s.fileName} numberOfLines={1}>Apple Health · {found.toLocaleString()} {found === 1 ? 'workout' : 'workouts'} found</Text>
            </View>
            <View style={s.card}>
              <Text style={s.label}>{fresh.length ? 'Ready to import' : 'Nothing new'}</Text>
              <View style={s.coinRow}>
                <View style={s.coin}><RivalIcon name="health" size={20} color={RivalButtonColors.label(RivalColors.onAccentFill)} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.bigNum}>{fresh.length.toLocaleString()}</Text>
                  <Text style={s.body}>{fresh.length ? `new activities, ${span}` : 'Every workout in Apple Health is already in RIVAL.'}</Text>
                </View>
              </View>
              <View style={s.facts}>
                <Fact label="Already in RIVAL" value={linked.toLocaleString()} first />
                <Fact label="Routes" value={routes.toLocaleString()} />
                <Fact label="Heart rate" value={withHr.toLocaleString()} />
              </View>
            </View>
            {fresh.length ? (
              <TouchableOpacity style={s.primary} onPress={start} activeOpacity={0.85}>
                <Text style={s.primaryText}>Import {fresh.length.toLocaleString()} {fresh.length === 1 ? 'activity' : 'activities'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.ghost} onPress={finishEmpty}><Text style={s.ghostText}>Done</Text></TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <LoaderCard
              fileName="Apple Health"
              pct={fresh.length ? Math.max(3, Math.round((prog.done / fresh.length) * 100)) : 0}
              rows={[
                { label: 'Activities', value: prog.done, of: fresh.length },
                ...(routes ? [{ label: 'Routes', value: prog.routes, of: routes }] : []),
              ]}
            />
            <Text style={s.note}>Keep RIVAL open until this finishes.</Text>
          </>
        )}
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
  heart: { width: 64, height: 64, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, color: '#fff', marginTop: 4, textAlign: 'center' },
  label: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1.7, textTransform: 'uppercase', color: RivalColors.accentText },
  body: { fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.72)' },
  note: { fontFamily: RivalFontFamily, fontSize: 12, lineHeight: 17, color: RivalColors.textSecondary, textAlign: 'center' },
  error: { fontFamily: RivalFontFamily, fontSize: 13, color: RivalColors.danger, textAlign: 'center' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  fileName: { flex: 1, fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.8)' },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coin: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  bigNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 40, lineHeight: 46, color: '#fff' },
  facts: { borderRadius: 14, backgroundColor: 'rgba(255,209,190,0.05)' },
  primary: { height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  primaryText: { fontFamily: RivalFontFamily, fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  ghost: { height: 46, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.88)' },
});
