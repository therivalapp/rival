import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GREY_PAGE_BG, RivalIcon } from '../components/rival';
import { GreySheet } from '../components/rival/RivalGreySheet';
import { GradientText } from '../components/rival/GradientText';
import { RoutePopUp } from '../components/rival/RivalModal';
import { ReadyHead, ReadyTile } from '../components/rival/ImportPieces';
import { webFx } from '../lib/webFx';
import { HistoryReveal } from '../components/rival/HistoryReveal';
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
  // Then each workout is checked against RIVAL, which took 15 s with the bar
  // already full (Ricky, 2026-11-16): the bar now covers both steps.
  const [checked, setChecked] = useState(0);
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
    setChecked(0);
    try {
      const r = await readHealth((done, total) => setRead({ done, total }));
      setFound(r.found);
      setAll(r.items);
      setAnchor(r.anchor);
      const newKeys = r.items.length ? await previewHealth(r.items, setChecked) : new Set<string>();
      setFresh(r.items.filter((i) => newKeys.has(i.key)));
      setStep('preview');
    } catch {
      setError('Activities could not be read from Apple Health. Try again.');
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

  // Loading can't be closed by tapping outside or pulling down: the import
  // would stop part way (Mockup 94, Ricky 2026-11-16).
  const busy = step === 'reading' || step === 'importing';
  const close = () => { if (!busy) back(); };
  const loadPct = step === 'reading'
    ? (read.total ? 4 + Math.round((read.done / read.total) * 46) + Math.round((checked / read.total) * 50) : 4)
    : (fresh.length ? Math.max(3, Math.round((prog.done / fresh.length) * 100)) : 0);
  const loadCount = step === 'reading' ? read.done : prog.done;
  const loadOf = step === 'reading' ? read.total : fresh.length;

  const button = (label: string, onPress: () => void) => (
    <TouchableOpacity style={s.primary} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
      <Text style={s.primaryText}>{label}</Text>
    </TouchableOpacity>
  );

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;
  if (!healthAvailable) {
    body = <Text style={[s.body, { textAlign: 'center', marginVertical: 18 }]}>Apple Health connects in the RIVAL iPhone app.</Text>;
  } else if (step === 'connect' || step === 'error') {
    body = (
      <View style={s.connect}>
        <View style={s.heart}><RivalIcon name="health" size={38} color="#ff375f" /></View>
        <Text style={s.heroTitle}>Every activity, in one place</Text>
        <Text style={[s.body, { textAlign: 'center' }]}>Past and new activities from Apple Health come into RIVAL, with routes, heart rate and calories.</Text>
        <View style={s.card}>
          <Text style={s.label}>Included</Text>
          <Text style={s.body}>Activities from Apple Watch and other apps that save to Apple Health.</Text>
        </View>
        {error ? <Text style={s.error}>{error}</Text> : null}
      </View>
    );
    footer = <View style={{ gap: 10 }}>{button('Connect', connect)}<Text style={s.note}>RIVAL only reads from Apple Health.</Text></View>;
  } else if (step === 'reading' || step === 'importing') {
    body = (
      <View style={s.loading}>
        <GradientText style={s.loadNum}>{loadCount.toLocaleString()}</GradientText>
        <Text style={s.loadOf}>{loadOf ? `of ${loadOf.toLocaleString()} ${loadOf === 1 ? 'activity' : 'activities'}` : 'Activities'}</Text>
        <View style={s.track}><View style={[s.fill, { width: `${loadPct}%` }]} /></View>
      </View>
    );
    footer = <Text style={s.note}>Keep RIVAL open until this finishes.</Text>;
  } else if (step === 'preview') {
    body = fresh.length ? (
      <View style={s.loading}>
        <ReadyHead count={fresh.length} caption={fresh.length === 1 ? 'New activity' : 'New activities'} span={span} />
        <View style={s.tiles}>
          <ReadyTile icon="map" value={routes} label="Routes" />
          <ReadyTile icon="health" value={withHr} label="Heart rate" />
          <ReadyTile icon="check" value={linked} label="In RIVAL" />
        </View>
      </View>
    ) : (
      <View style={s.loading}>
        <Text style={s.heroTitle}>Nothing new</Text>
        <Text style={[s.body, { textAlign: 'center' }]}>Every activity in Apple Health is already in RIVAL. New ones arrive on their own from now on.</Text>
      </View>
    );
    footer = fresh.length ? (
      <View style={{ gap: 10 }}>
        {button(`Import ${fresh.length.toLocaleString()} ${fresh.length === 1 ? 'activity' : 'activities'}`, start)}
        {linked ? <Text style={s.note}>{`${linked.toLocaleString()} already in RIVAL ${linked === 1 ? 'is' : 'are'} linked, not added twice.`}</Text> : null}
      </View>
    ) : button('Done', finishEmpty);
  }

  return (
    <RoutePopUp>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
        <GreySheet kicker="CONNECTED DEVICES" title="Apple Health" onClose={close} footer={footer}>
          {body}
        </GreySheet>
      </View>
    </RoutePopUp>
  );
}


const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  connect: { alignItems: 'stretch', gap: 8, paddingTop: 14 },
  loading: { alignItems: 'center', paddingTop: 16, paddingBottom: 6 },
  loadNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 56, lineHeight: 64, paddingHorizontal: 8, color: RivalColors.accentText, ...webFx({ backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #D97757 150%)', backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' }) },
  loadOf: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: RivalColors.accentText, marginTop: 2 },
  track: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 22, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  tiles: { alignSelf: 'stretch', flexDirection: 'row', gap: 8, marginTop: 20 },
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
