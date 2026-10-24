import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyPageHead, GREY_PAGE_BG, RivalIcon } from '../components/rival';
import { HistoryReveal } from '../components/rival/HistoryReveal';
import { getAuthUser } from '../lib/supabase';
import { goToTab } from '../lib/tabNav';
import { invalidateActivityCache } from '../lib/fetchAllActivities';
import { fetchYearEffort, previewImport, readArchive, runImport, type ImportItem, type ImportResult, type ReadArchive } from '../lib/archive';

// Import an archive (Ricky, 2026-10-17): a Strava archive (Settings, My
// Account, Request your archive) or a RIVAL archive. The file is read here;
// the preview receipt says what is new before anything is written; then the
// import runs in batches and ends on the "Imported" reveal (E1): the
// archive's photos (or the skies its activities started under), the hours
// counting up, Effort with distance by sport, and what was found.

type Step = 'choose' | 'reading' | 'preview' | 'importing' | 'done' | 'error';


const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

export default function ImportArchiveScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const back = () => (router.canGoBack() ? router.back() : goToTab('/home'));
  const [source, setSource] = useState<'strava' | 'rival'>('strava');
  const [step, setStep] = useState<Step>('choose');
  const [fileName, setFileName] = useState('');
  const [read, setRead] = useState<ReadArchive | null>(null);
  const [fresh, setFresh] = useState<ImportItem[]>([]);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [yearEffort, setYearEffort] = useState(0);

  function choose() {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setFileName(file.name);
      setStep('reading');
      setError(null);
      try {
        const r = await readArchive(file);
        setRead(r);
        setSource(r.source);
        const newKeys = await previewImport(r.items);
        setFresh(r.items.filter((i) => newKeys.has(i.key)));
        setStep('preview');
      } catch (e: any) {
        setError(e?.message === 'not_an_archive'
          ? 'This file is not a RIVAL or Strava archive. Choose the .zip as it was downloaded.'
          : 'The file could not be read. Try again.');
        setStep('error');
      }
    };
    input.click();
  }

  async function start() {
    if (!read || !fresh.length) return;
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    setStep('importing');
    setDone(0);
    try {
      const res = await runImport(user.id, read, fresh, setDone);
      setResults(res);
      invalidateActivityCache();
      setYearEffort(await fetchYearEffort(user.id));
      setStep('done');
    } catch {
      setError('The import stopped part way. Activities already added are kept; run it again to finish.');
      setStep('error');
    }
  }

  const routes = fresh.filter((i) => i.polyline).length;
  // Covers plus every other photo; videos counted on their own.
  const extrasOf = (i: ImportItem) => read?.extras.get(i.key) ?? [];
  const photos = fresh.filter((i) => read?.photos.has(i.key)).length
    + fresh.reduce((n, i) => n + extrasOf(i).filter((m) => m.type === 'photo').length, 0);
  const videos = fresh.reduce((n, i) => n + extrasOf(i).filter((m) => m.type === 'video').length, 0);
  const linked = (read?.items.length ?? 0) - fresh.length;
  const span = fresh.length
    ? `${monthYear(fresh.reduce((a, b) => (a.startedAt < b.startedAt ? a : b)).startedAt)} – ${monthYear(fresh.reduce((a, b) => (a.startedAt > b.startedAt ? a : b)).startedAt)}`
    : '';

  if (step === 'done') {
    const ok = new Map(results.filter((x) => x.status === 'imported').map((x) => [x.key, x]));
    const added = fresh.filter((i) => ok.has(i.key));
    const photoUrls = added.filter((i) => read!.photos.has(i.key)).slice(0, 6).map((i) => {
      const p = read!.photos.get(i.key)!;
      return URL.createObjectURL(new Blob([p.bytes as BlobPart], { type: p.ext === 'png' ? 'image/png' : 'image/jpeg' }));
    });
    return (
      <HistoryReveal
        kicker="Archive imported"
        activities={added.map((i) => ({ ...i, effort: ok.get(i.key)?.effort ?? 0 }))}
        photoUrls={photoUrls}
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
        <GreyPageHead kicker="CONNECTED DEVICES" title="Import an archive" onBack={back} />

        {step === 'choose' || step === 'error' ? (
          <>
            <View style={s.tiles}>
              {(['rival', 'strava'] as const).map((k) => (
                <TouchableOpacity key={k} style={[s.tile, source === k && s.tileOn]} onPress={() => setSource(k)} activeOpacity={0.85}>
                  <RivalIcon name={k === 'rival' ? 'archive' : 'upload'} size={54} color={source === k ? 'rgba(42,20,8,0.16)' : 'rgba(255,255,255,0.08)'} style={s.tileMark} />
                  <Text style={[s.tileTitle, source === k && s.tileTitleOn]}>{k === 'rival' ? 'RIVAL' : 'Strava'}</Text>
                  <Text style={[s.tileSub, source === k && s.tileSubOn]}>{k === 'rival' ? 'An archive from RIVAL' : 'Request your archive'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.drop} onPress={choose} activeOpacity={0.85}>
              <View style={s.dropCoin}><RivalIcon name="upload" size={22} color={RivalColors.accentText} /></View>
              <Text style={s.dropTitle}>Choose the .zip file</Text>
              <Text style={s.dropSub}>From Files or Downloads. Nothing is added until the next step.</Text>
            </TouchableOpacity>
            {error ? <Text style={s.error}>{error}</Text> : null}
            {source === 'strava' ? (
              <View style={s.card}>
                <Text style={s.label}>Getting the Strava archive</Text>
                <Text style={s.body}>1. On strava.com, open Settings, then My Account.</Text>
                <Text style={s.body}>2. Under Download or Delete Your Account, choose Request your archive.</Text>
                <Text style={s.body}>3. Strava emails the .zip, usually within a few hours.</Text>
              </View>
            ) : (
              <View style={s.card}>
                <Text style={s.label}>Getting a RIVAL archive</Text>
                <Text style={s.body}>Profile, Delete account, Download archive saves one to this device. It does not delete anything.</Text>
              </View>
            )}
          </>
        ) : step === 'reading' ? (
          <View style={s.card}>
            <View style={s.coinRow}>
              <View style={s.coin}><RivalIcon name="archive" size={20} color={RivalButtonColors.label(RivalColors.onAccentFill)} /></View>
              <View style={{ flex: 1 }}><Text style={s.serif}>Reading the archive</Text><Text style={s.body}>{fileName}</Text></View>
            </View>
          </View>
        ) : step === 'preview' ? (
          <>
            <View style={s.fileRow}><RivalIcon name="archive" size={16} color={RivalColors.accentText} /><Text style={s.fileName} numberOfLines={1}>{fileName}</Text></View>
            <View style={s.card}>
              <Text style={s.label}>{fresh.length ? 'Ready to import' : 'Nothing new'}</Text>
              <View style={s.coinRow}>
                <View style={s.coin}><RivalIcon name="archive" size={20} color={RivalButtonColors.label(RivalColors.onAccentFill)} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.bigNum}>{fresh.length.toLocaleString()}</Text>
                  <Text style={s.body}>{fresh.length ? `new activities, ${span}` : 'Everything in this archive is already in RIVAL.'}</Text>
                </View>
              </View>
              <View style={s.facts}>
                <Fact label="Already in RIVAL, linked" value={linked.toLocaleString()} first />
                <Fact label="Photos" value={photos.toLocaleString()} />
                {videos > 0 ? <Fact label="Videos" value={videos.toLocaleString()} /> : null}
                <Fact label="Routes" value={routes.toLocaleString()} />
              </View>
            </View>
            {fresh.length ? (
              <TouchableOpacity style={s.primary} onPress={start} activeOpacity={0.85}>
                <Text style={s.primaryText}>Import {fresh.length.toLocaleString()} {fresh.length === 1 ? 'activity' : 'activities'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.ghost} onPress={back}><Text style={s.ghostText}>Done</Text></TouchableOpacity>
            )}
          </>
        ) : (
          <View style={s.card}>
            <Text style={s.label}>Importing</Text>
            <View style={s.coinRow}>
              <View style={s.coin}><RivalIcon name="upload" size={20} color={RivalButtonColors.label(RivalColors.onAccentFill)} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.serif}>{done.toLocaleString()} of {fresh.length.toLocaleString()}</Text>
                <Text style={s.body}>Adding activities, routes, photos and videos</Text>
              </View>
            </View>
            <View style={s.track}><View style={[s.trackFill, { width: `${fresh.length ? Math.round((done / fresh.length) * 100) : 0}%` as any }]} /></View>
            <Text style={[s.body, { fontSize: 12, color: 'rgba(255,255,255,0.5)' }]}>Keep this screen open until it finishes.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Fact({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View style={[s.fact, !first && s.factDivided]}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  pageWide: { backgroundColor: RivalColors.surfaceContainer },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  card: { borderRadius: 22, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, padding: 16, gap: 10 },
  label: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1.7, textTransform: 'uppercase', color: RivalColors.accentText },
  body: { fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.72)' },
  error: { fontFamily: RivalFontFamily, fontSize: 13, color: RivalColors.danger, textAlign: 'center' },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, minHeight: 92, borderRadius: 16, padding: 12, justifyContent: 'flex-end', overflow: 'hidden', backgroundColor: 'rgba(255,209,190,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  tileOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' },
  tileMark: { position: 'absolute', right: -8, top: -8 },
  tileTitle: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '800', color: '#fff' },
  tileTitleOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  tileSub: { fontFamily: RivalFontFamily, fontSize: 11, color: 'rgba(255,255,255,0.55)' },
  tileSubOn: { color: 'rgba(42,20,8,0.7)' },
  drop: { borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.4)', backgroundColor: 'rgba(232,131,95,0.06)', paddingVertical: 22, paddingHorizontal: 14, alignItems: 'center', gap: 8 },
  dropCoin: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,131,95,0.18)' },
  dropTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#fff' },
  dropSub: { fontFamily: RivalFontFamily, fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coin: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  serif: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, color: '#fff' },
  bigNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 40, lineHeight: 46, color: '#fff' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  fileName: { flex: 1, fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.8)' },
  facts: { borderRadius: 14, backgroundColor: 'rgba(255,209,190,0.05)' },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  factDivided: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  factLabel: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.62)' },
  factValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: '#fff' },
  primary: { height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  primaryText: { fontFamily: RivalFontFamily, fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  ghost: { height: 46, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.88)' },
  track: { flexDirection: 'row', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: '#e8835f' },
});
