import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily, rivalWordmark } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyPageHead, GREY_PAGE_BG, RivalIcon } from '../components/rival';
import { HistoryReveal } from '../components/rival/HistoryReveal';
import { getAuthUser } from '../lib/supabase';
import { goToTab } from '../lib/tabNav';
import { invalidateActivityCache } from '../lib/fetchAllActivities';
import { fetchYearEffort, previewImport, readArchive, runImport, type ImportItem, type ImportProgress, type ImportResult, type ReadArchive } from '../lib/archive';

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
  // Already in RIVAL without a photo, with one in this archive: only the photos are added.
  const [fill, setFill] = useState<ImportItem[]>([]);
  const [prog, setProg] = useState<ImportProgress>({ done: 0, photos: 0, videos: 0, routes: 0 });
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [yearEffort, setYearEffort] = useState(0);
  // Picker open: an iPhone downloads the file from iCloud before handing it
  // over, so the drop zone says so until it arrives (or the picker closes).
  const [opening, setOpening] = useState(false);
  // Reading: the file is unpacked, then each activity is checked against RIVAL.
  const [checked, setChecked] = useState(0);
  const [total, setTotal] = useState(0);
  // An import cut off last time (the page closed or reloaded part way).
  const [paused, setPaused] = useState<Paused | null>(null);
  useEffect(() => { setPaused(loadPaused()); }, []);
  useWakeLock(step === 'reading' || step === 'importing');

  function choose() {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.addEventListener('cancel', () => setOpening(false));
    input.onchange = async () => {
      setOpening(false);
      const file = input.files?.[0];
      if (!file) return;
      setFileName(file.name);
      setChecked(0);
      setTotal(0);
      setStep('reading');
      setError(null);
      try {
        const r = await readArchive(file);
        setRead(r);
        setSource(r.source);
        setTotal(r.items.length);
        const { fresh: newKeys, needsPhoto } = await previewImport(r.items, setChecked);
        setFresh(r.items.filter((i) => newKeys.has(i.key)));
        setFill(r.items.filter((i) => needsPhoto.has(i.key) && r.photos.has(i.key)));
        setStep('preview');
      } catch (e: any) {
        setError(e?.message === 'not_an_archive'
          ? 'This file is not a supported archive. Choose the .zip as it was downloaded.'
          : 'The file could not be read. Try again.');
        setStep('error');
      }
    };
    setOpening(true);
    input.click();
  }

  async function start() {
    const run = [...fresh, ...fill];
    if (!read || !run.length) return;
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    setStep('importing');
    setProg({ done: 0, photos: 0, videos: 0, routes: 0 });
    savePaused({ file: fileName, done: 0, total: run.length, at: Date.now() });
    try {
      const res = await runImport(user.id, read, run, (p) => {
        setProg(p);
        savePaused({ file: fileName, done: Math.min(p.done, fresh.length), total: fresh.length, at: Date.now() });
      });
      savePaused(null);
      setPaused(null);
      setResults(res);
      invalidateActivityCache();
      setYearEffort(await fetchYearEffort(user.id));
      setStep('done');
    } catch {
      setError('The import stopped part way. Activities already added are kept; run it again to finish.');
      setStep('error');
    }
  }

  // Covers plus every other photo; videos counted on their own.
  const extrasOf = (i: ImportItem) => read?.extras.get(i.key) ?? [];
  const photosIn = (list: ImportItem[]) => list.filter((i) => read?.photos.has(i.key)).length
    + list.reduce((n, i) => n + extrasOf(i).filter((m) => m.type === 'photo').length, 0);
  const videosIn = (list: ImportItem[]) => list.reduce((n, i) => n + extrasOf(i).filter((m) => m.type === 'video').length, 0);
  const routes = fresh.filter((i) => i.polyline).length;
  const photos = photosIn([...fresh, ...fill]);
  const videos = videosIn([...fresh, ...fill]);
  const linked = (read?.items.length ?? 0) - fresh.length;
  // While reading: everything in the file.
  const all = read?.items ?? [];
  const runTotal = fresh.length + fill.length;
  const span = fresh.length
    ? `${monthYear(fresh.reduce((a, b) => (a.startedAt < b.startedAt ? a : b)).startedAt)} – ${monthYear(fresh.reduce((a, b) => (a.startedAt > b.startedAt ? a : b)).startedAt)}`
    : '';

  if (step === 'done') {
    const ok = new Map(results.filter((x) => x.status === 'imported').map((x) => [x.key, x]));
    const added = fresh.filter((i) => ok.has(i.key));
    if (!added.length) {
      // Only photos were added to activities already in RIVAL.
      return (
        <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
          <ScrollView contentContainerStyle={s.content}>
            <GreyPageHead kicker="CONNECTED DEVICES" title="Import an archive" onBack={back} />
            <View style={s.card}>
              <Text style={s.label}>Photos added</Text>
              <Text style={s.bigNum}>{(prog.photos + prog.videos).toLocaleString()}</Text>
              <Text style={s.body}>To activities already in RIVAL.</Text>
            </View>
            <TouchableOpacity style={s.primary} onPress={() => goToTab('/my-activities')} activeOpacity={0.85}>
              <Text style={s.primaryText}>See the journal</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      );
    }
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
            {paused ? (
              <View style={s.card}>
                <Text style={s.label}>Import paused</Text>
                <Text style={s.body}>{paused.done.toLocaleString()} of {paused.total.toLocaleString()} added from {paused.file}. Choose the same file to finish.</Text>
              </View>
            ) : null}
            <View style={s.tiles}>
              {(['rival', 'strava'] as const).map((k) => (
                <TouchableOpacity key={k} style={[s.tile, source === k && s.tileOn]} onPress={() => setSource(k)} activeOpacity={0.85}>
                  <RivalIcon name={k === 'rival' ? 'archive' : 'upload'} size={54} color={source === k ? 'rgba(42,20,8,0.16)' : 'rgba(255,255,255,0.08)'} style={s.tileMark} />
                  <Text style={[s.tileTitle, source === k && s.tileTitleOn]}>{k === 'rival' ? 'RIVAL' : 'Other apps'}</Text>
                  <Text style={[s.tileSub, source === k && s.tileSubOn]}>{k === 'rival' ? 'A RIVAL archive' : 'An archive from another app'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.drop} onPress={choose} activeOpacity={0.85}>
              <View style={s.dropCoin}><RivalIcon name="upload" size={22} color={RivalColors.accentText} /></View>
              <Text style={s.dropTitle}>{opening ? 'Opening the file…' : 'Choose the .zip file'}</Text>
              <Text style={s.dropSub}>{opening ? 'Files stored in iCloud can take a moment.' : 'From Files or Downloads. Nothing is added until the next step.'}</Text>
            </TouchableOpacity>
            {error ? <Text style={s.error}>{error}</Text> : null}
            {source === 'strava' ? (
              <View style={s.card}>
                <Text style={s.label}>Archives from other apps</Text>
                <Text style={s.body}>Most fitness apps can export past activities as a .zip from their account settings.</Text>
              </View>
            ) : (
              <View style={s.card}>
                <Text style={s.label}>Getting a RIVAL archive</Text>
                <Text style={s.body}>Settings, Account, Delete account, Download archive saves one to this device. It does not delete anything.</Text>
              </View>
            )}
          </>
        ) : step === 'reading' ? (
          <LoaderCard
            fileName={fileName}
            pct={total ? 10 + Math.round((checked / total) * 90) : 4}
            rows={[
              { label: 'Activities', value: all.length },
              { label: 'Photos', value: photosIn(all) },
              ...(videosIn(all) ? [{ label: 'Videos', value: videosIn(all) }] : []),
              { label: 'Routes', value: all.filter((i) => i.polyline).length },
            ]}
          />
        ) : step === 'preview' ? (
          <>
            <View style={s.fileRow}><RivalIcon name="archive" size={16} color={RivalColors.accentText} /><Text style={s.fileName} numberOfLines={1}>{fileName}</Text></View>
            <View style={s.card}>
              <Text style={s.label}>{fresh.length ? 'Ready to import' : fill.length ? 'Photos to add' : 'Nothing new'}</Text>
              <View style={s.coinRow}>
                <View style={s.coin}><RivalIcon name="archive" size={20} color={RivalButtonColors.label(RivalColors.onAccentFill)} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.bigNum}>{(fresh.length || (fill.length ? photos + videos : 0)).toLocaleString()}</Text>
                  <Text style={s.body}>{fresh.length ? `new activities, ${span}` : fill.length ? 'For activities already in RIVAL.' : 'Everything in this archive is already in RIVAL.'}</Text>
                </View>
              </View>
              <View style={s.facts}>
                {linked > 0 ? <Fact label="Already in RIVAL" value={linked.toLocaleString()} first /> : null}
                <Fact label="Photos" value={photos.toLocaleString()} first={linked === 0} />
                {videos > 0 ? <Fact label="Videos" value={videos.toLocaleString()} /> : null}
                <Fact label="Routes" value={routes.toLocaleString()} />
              </View>
            </View>
            {runTotal ? (
              <TouchableOpacity style={s.primary} onPress={start} activeOpacity={0.85}>
                <Text style={s.primaryText}>{fresh.length ? `Import ${fresh.length.toLocaleString()} ${fresh.length === 1 ? 'activity' : 'activities'}` : 'Add photos'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.ghost} onPress={back}><Text style={s.ghostText}>Done</Text></TouchableOpacity>
            )}
          </>
        ) : (
          <LoaderCard
            fileName={fileName}
            pct={runTotal ? Math.max(3, Math.round((prog.done / runTotal) * 100)) : 0}
            rows={[
              ...(fresh.length ? [{ label: 'Activities', value: Math.min(prog.done, fresh.length), of: fresh.length }] : []),
              ...(photos ? [{ label: 'Photos', value: prog.photos, of: photos }] : []),
              ...(videos ? [{ label: 'Videos', value: prog.videos, of: videos }] : []),
              ...(fresh.length ? [{ label: 'Routes', value: prog.routes, of: routes }] : []),
            ]}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Loading (Ricky, 2026-11-08, option C): the opening screen's pulsing RIVAL
// over a bar that fills, and what the archive holds counting up beneath.
function LoaderCard({ fileName, pct, rows }: { fileName: string; pct: number; rows: { label: string; value: number; of?: number }[] }) {
  const web = Platform.OS === 'web';
  return (
    <View style={[s.card, s.loader]}>
      <Text style={[s.word, web && ({ animationName: 'rivalBusyPulse', animationDuration: '1.65s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' } as any)]}>RIVAL</Text>
      <View style={s.loaderTrack}>
        <View style={[s.loaderFill, { width: `${pct}%` as any }, web && ({ transition: 'width 0.5s ease-out' } as any)]} />
      </View>
      <Text style={s.loaderFile} numberOfLines={1}>{fileName}</Text>
      <View style={[s.facts, s.loaderFacts]}>
        {rows.map((r, k) => (
          <View key={r.label} style={[s.fact, k > 0 && s.factDivided]}>
            <Text style={s.factLabel}>{r.label}</Text>
            <Text style={s.factValue}>
              <Tally value={r.value} />
              {r.of != null ? <Text style={s.factOf}> of {r.of.toLocaleString()}</Text> : null}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A number that climbs to each new value instead of jumping. */
function Tally({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (Platform.OS !== 'web') { setShown(value); return; }
    const start = from.current;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / 900);
      const v = start + (value - start) * (1 - Math.pow(1 - p, 3));
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{Math.round(shown).toLocaleString()}</>;
}

// Keeps the phone from locking while an archive is read or imported, which
// would pause the page part way (Screen Wake Lock; Safari 16.4 and later).
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || Platform.OS !== 'web' || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: any = null;
    let live = true;
    const get = async () => {
      try { lock = await (navigator as any).wakeLock.request('screen'); } catch { /* not allowed now: carry on */ }
      if (!live) lock?.release?.();
    };
    const onVis = () => { if (document.visibilityState === 'visible') get(); };
    get();
    document.addEventListener('visibilitychange', onVis);
    return () => { live = false; document.removeEventListener('visibilitychange', onVis); lock?.release?.(); };
  }, [on]);
}

// An import in progress is noted on the device, so one cut off (the page
// closed or reloaded) says so next time. Choosing the same file again adds
// only what is missing.
type Paused = { file: string; done: number; total: number; at: number };
const PAUSED_KEY = 'rival_import_paused';
function loadPaused(): Paused | null {
  try {
    const p = JSON.parse(localStorage.getItem(PAUSED_KEY) || 'null') as Paused | null;
    return p && Date.now() - p.at < 7 * 864e5 && p.done < p.total ? p : null;
  } catch { return null; }
}
function savePaused(p: Paused | null) {
  try { p ? localStorage.setItem(PAUSED_KEY, JSON.stringify(p)) : localStorage.removeItem(PAUSED_KEY); } catch { /* private mode */ }
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
  factOf: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontWeight: '400', fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  loader: { alignItems: 'center', paddingTop: 36, gap: 16 },
  word: { ...rivalWordmark(22), color: RivalColors.accentText, opacity: 0.9 },
  loaderTrack: { width: 180, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  loaderFill: { height: 4, borderRadius: 2, backgroundColor: RivalColors.accentText },
  loaderFile: { fontFamily: RivalFontFamily, fontSize: 12, color: 'rgba(255,255,255,0.5)', maxWidth: '90%' },
  loaderFacts: { alignSelf: 'stretch', marginTop: 14 },
  factValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: '#fff' },
  primary: { height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  primaryText: { fontFamily: RivalFontFamily, fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  ghost: { height: 46, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.88)' },
  track: { flexDirection: 'row', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: '#e8835f' },
});
