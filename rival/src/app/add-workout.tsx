import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Image, ImageBackground, useWindowDimensions, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { RivalButton, RivalCard, RivalIcon, RivalIconName, RivalTopNav, RivalBackButton, rb, GreyPageHead, GreyRows, GreyRow, GreySheet } from '../components/rival';
import { goToTab } from '../lib/tabNav';
import { pickScanFiles, setPendingScanDays, setPendingScanFiles } from '../lib/scanHandoff';
import { groupByDay, takenAt } from '../lib/photoDates';
import { RivalButtonColors, RivalColors, RivalRadius, RivalSerifFamily, RivalType } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { SaveChoiceTile, SavedWorkoutTiles } from '../components/rival/SavedWorkoutTiles';
import { loadSavedWorkouts, photoUrls, todaysWorkout, type SavedWorkoutRow } from '../lib/savedWorkouts';

const PROCESS_STEPS: Array<{ icon: RivalIconName; title: string; body: string }> = [
  { icon: 'addPhoto', title: '1. Capture', body: 'Photograph a fitness app screen, gym whiteboard or workout card.' },
  { icon: 'brain', title: '2. Automatic extraction', body: 'Exercises, sets, weights and distance are extracted from the image.' },
  { icon: 'verified', title: '3. Review and save', body: 'Confirm the details. Effort updates as soon as the activity is saved.' },
];

// The tile's icon, large and centred behind the words, fading out towards
// them (Ricky, 2026-10-03).
function TileArt({ icon, primary }: { icon: RivalIconName; primary?: boolean }) {
  return (
    <>
      <View style={[ms.tileArt, { pointerEvents: 'none' }]}>
        <RivalIcon name={icon} size={118} color={primary ? 'rgba(255,255,255,0.32)' : 'rgba(255,181,158,0.24)'} />
      </View>
      <View style={[ms.tileFade, primary ? ms.tileFadePrimary : ms.tileFadeGhost, { pointerEvents: 'none' }]} />
    </>
  );
}

export default function AddWorkoutScreen() {
  const { width } = useWindowDimensions();
  const wide = sidePageWide(width);
  // Saved workouts (lib/savedWorkouts.ts): the fourth tile, and the tiles
  // the pop-up swaps to when it's tapped.
  const [view, setView] = useState<'tiles' | 'saved' | 'savedNew' | 'days'>('tiles');
  // Opened from an empty day on Activity: the activity is for that date, so
  // each way in carries it (Ricky, 2026-10-27, Week rows).
  const { date: forDate } = useLocalSearchParams<{ date?: string }>();
  const withDate = (path: string) => (forDate ? `${path}${path.includes('?') ? '&' : '?'}date=${forDate}` : path) as Href;
  const forDateText = forDate ? new Date(`${forDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : undefined;
  // Upload's photos when they were taken on more than one day.
  const [days, setDays] = useState<{ date: Date; files: File[]; thumbs: string[] }[]>([]);
  const [picked, setPicked] = useState<File[]>([]);
  const [saved, setSaved] = useState<SavedWorkoutRow[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (wide) return;
    loadSavedWorkouts().then(async (list) => {
      setSaved(list);
      setUrls(await photoUrls(list.map((w) => w.imagePath)));
    }).catch(() => setSaved([]));
  }, [wide]);
  // A new saved workout from a photo of the routine: the library opens from
  // the tap; the scan saves it and logs nothing.
  const saveFromPhoto = () => (Platform.OS === 'web'
    ? pickScanFiles('gallery', (files) => { setPendingScanFiles(files); router.push('/scan-workout?source=picked&saveOnly=1'); })
    : router.push('/scan-workout?source=gallery&saveOnly=1'));
  const now = new Date();
  const forToday = saved ? todaysWorkout(saved, now) : null;
  // The two ways to save an activity, in the empty state and Save activity.
  const saveWays = (
    <>
      <TouchableOpacity style={[ms.primary, ms.emptyBtn]} onPress={saveFromPhoto} activeOpacity={0.85} accessibilityRole="button">
        <RivalIcon name="camera" size={17} color={ms.primaryText.color as string} />
        <Text style={ms.primaryText}>Scan a photo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[ms.ghost, ms.emptyBtn]} onPress={() => router.push('/saved-workouts?new=1')} activeOpacity={0.85} accessibilityRole="button">
        <RivalIcon name="manual" size={17} color={RivalColors.accentText} />
        <Text style={ms.ghostText}>Enter manually</Text>
      </TouchableOpacity>
    </>
  );
  const saveNote = 'A photo, screenshot or gym whiteboard can be scanned.';
  const savedSub = forToday ? `${forToday.name} today` : saved?.length ? `${saved.length} saved` : 'Repeat a routine';

  const card = (
    icon: RivalIconName,
    accent: boolean,
    title: string,
    body: string,
    actions: React.ReactNode,
  ) => (
    <RivalCard glass style={[styles.card, wide && styles.cardWide]}>
      <View style={[styles.cardIcon, accent && styles.cardIconAccent]}>
        <RivalIcon name={icon} size={26} color={accent ? RivalColors.accentText : RivalColors.textSecondary} />
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
      <View style={styles.cardActions}>{actions}</View>
    </RivalCard>
  );

  if (!wide) {
    // Phone: a pop-up over the page it came from (a transparent modal on
    // phone, see _layout.tsx). Scanning leads as two big tiles straight on the
    // sheet, because adding activities should be one easy tap (Ricky,
    // 2026-10-02); manual entry and a multi-day scan are the other roads.
    const close = () => (router.canGoBack() ? router.back() : goToTab('/my-activities'));
    // The camera or photo library opens straight from the tile's tap; the
    // scan page then reads what was chosen (lib/scanHandoff.ts). Cancelling
    // leaves you here.
    const scan = (source: 'camera' | 'gallery') => {
      if (Platform.OS !== 'web') { router.push(withDate(`/scan-workout?source=${source}`)); return; }
      pickScanFiles(source, async (files) => {
        // Taken on different days: asked once whether to log one activity a
        // day (Ricky, 2026-10-25). One day goes straight to the scan.
        if (source === 'gallery' && files.length > 1) {
          const dated = await Promise.all(files.map(async (f) => ({ f, at: await takenAt(f) })));
          const groups = groupByDay(dated, (x) => x.at);
          if (groups.length > 1) {
            setPicked(files);
            setDays(groups.map((g) => ({
              date: g.date,
              files: g.items.map((x) => x.f),
              thumbs: g.items.filter((x) => !x.f.type.startsWith('video/')).slice(0, 3).map((x) => URL.createObjectURL(x.f)),
            })));
            setView('days');
            return;
          }
        }
        setPendingScanFiles(files);
        router.push(withDate('/scan-workout?source=picked'));
      }, true);
    };
    return (
      <View style={ms.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
        {view === 'days' ? (
          <GreySheet
            kicker="UPLOAD"
            title={`Photos from ${days.length} days`}
            onClose={close}
            onBack={() => setView('tiles')}
            footer={
              <View style={{ gap: 8 }}>
                <TouchableOpacity
                  style={ms.primary}
                  onPress={() => { setPendingScanDays(days.map((d) => ({ date: d.date, files: d.files }))); router.replace('/weekly-scan?from=add'); }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <Text style={ms.primaryText}>{`Scan as ${days.length} activities`}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={ms.ghost}
                  onPress={() => { setPendingScanFiles(picked); router.push(withDate('/scan-workout?source=picked')); }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <Text style={ms.ghostText}>Scan as one activity</Text>
                </TouchableOpacity>
              </View>
            }
          >
            <Text style={[ms.tileNote, { marginTop: 4 }]}>Sorted by when each photo was taken.</Text>
            <View style={ms.dayList}>
              {days.map((d, i) => {
                const today = new Date();
                const isToday = d.date.toDateString() === today.toDateString();
                return (
                  <View key={d.date.getTime()} style={[ms.dayRow, i > 0 && ms.dayRule]}>
                    <View style={ms.dayDate}>
                      <Text style={ms.dayName}>{isToday ? 'TODAY' : d.date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</Text>
                      <Text style={ms.dayNum}>{d.date.getDate()}</Text>
                    </View>
                    <View style={ms.dayThumbs}>
                      {d.thumbs.map((t) => <Image key={t} source={{ uri: t }} style={ms.dayThumb} />)}
                    </View>
                    <Text style={ms.dayCount}>{`${d.files.length} ${d.files.length === 1 ? 'photo' : 'photos'}`}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={[ms.tileNote, { marginTop: 10 }]}>Days can be changed before saving.</Text>
          </GreySheet>
        ) : view === 'savedNew' ? (
          // Save activity: scanned from a photo, or typed in.
          <GreySheet
            kicker="SAVED ACTIVITIES"
            title="Save activity"
            onClose={close}
            onBack={() => setView('saved')}
            footer={null}
          >
            {/* The same tiles as Saved activities, so the choice keeps its look. */}
            <View style={ms.choiceRow}>
              <SaveChoiceTile icon="camera" title="Scan photo" onPress={saveFromPhoto} />
              <SaveChoiceTile icon="manual" title="Enter manually" onPress={() => router.push('/saved-workouts?new=1')} />
            </View>
          </GreySheet>
        ) : view === 'saved' ? (
          <GreySheet
            kicker="LOG"
            title="Saved activities"
            onClose={close}
            onBack={() => setView('tiles')}
            footer={saved && saved.length ? (
              <TouchableOpacity onPress={() => router.push('/saved-workouts')} accessibilityRole="button">
                <Text style={ms.manage}>Manage saved activities</Text>
              </TouchableOpacity>
            ) : <Text style={ms.tileNote}>{saveNote}</Text>}
          >
            {saved && saved.length ? (
              <SavedWorkoutTiles
                workouts={saved}
                urls={urls}
                today={now.getDay()}
                onPick={(w) => router.push(withDate(`/manual-entry?saved=${w.id}`))}
                onNew={() => setView('savedNew')}
              />
            ) : (
              // Before the first one: what it is, and the two ways to start.
              <View style={ms.empty}>
                <View style={ms.emptyIcon}><RivalIcon name="replay" size={28} color={RivalColors.accentText} /></View>
                <Text style={ms.emptyTitle}>Save a routine</Text>
                <Text style={ms.emptyBody}>Save an activity that repeats, such as a Monday gym routine, once. Next time it opens filled in, with last time's numbers.</Text>
                {saveWays}
              </View>
            )}
          </GreySheet>
        ) : (
        <GreySheet
          kicker="LOG"
          title="Add an activity"
          sub={forDateText}
          onClose={close}
          footer={<Text style={ms.tileNote}>Details are read automatically. Review before saving.</Text>}
        >
          {/* Four ways in, all the same size of tile (Ricky, 2026-10-02):
              the two scans first, the photo tile lit. Multi-day scan is a
              pop-up too, so it takes this one's place rather than stacking
              a second dark backdrop over it. */}
          <View style={[ms.tiles, ms.tilesTop]}>
            <TouchableOpacity style={[ms.tile, ms.tilePrimary]} onPress={() => scan('camera')} activeOpacity={0.85} accessibilityRole="button">
              <TileArt icon="camera" primary />
              <Text style={[ms.tileTitle, { color: ms.primaryText.color as string }]}>Take photo</Text>
              <Text style={[ms.tileSub, { color: ms.primaryText.color as string, opacity: 0.75 }]}>Use the camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ms.tile, ms.tileGhost]} onPress={() => scan('gallery')} activeOpacity={0.85} accessibilityRole="button">
              <TileArt icon="upload" />
              <Text style={ms.tileTitle}>Upload</Text>
              <Text style={ms.tileSub}>One day or several</Text>
            </TouchableOpacity>
          </View>
          <View style={[ms.tiles, { marginTop: 10 }]}>
            <TouchableOpacity style={[ms.tile, ms.tileGhost]} onPress={() => router.push(withDate('/manual-entry'))} activeOpacity={0.85} accessibilityRole="button">
              <TileArt icon="manual" />
              <Text style={ms.tileTitle}>Manual entry</Text>
              <Text style={ms.tileSub}>Type in the details</Text>
            </TouchableOpacity>
            {/* Saved workouts took Multi-day scan's place (Ricky, 2026-10-25):
                several days are now picked through Upload, and Multi-day scan
                stays in the Activity menu. */}
            <TouchableOpacity style={[ms.tile, ms.tileGhost]} onPress={() => setView('saved')} activeOpacity={0.85} accessibilityRole="button">
              <TileArt icon="replay" />
              <Text style={ms.tileTitle}>Saved activities</Text>
              <Text style={ms.tileSub} numberOfLines={1}>{savedSub}</Text>
            </TouchableOpacity>
          </View>
        </GreySheet>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ImageBackground
        source={require('../../assets/images/backgrounds/optimized/overhead-squat-warehouse-gym.jpg')}
        style={styles.bg}
        imageStyle={styles.bgImage}
        resizeMode="cover"
      >
        <RivalTopNav />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
          </View>

          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>ADD WORKOUT</Text>
            <Text style={styles.heroTitle}>Honor the commitment.</Text>
            <Text style={styles.heroSub}>
              Record an activity by photo, by manual entry or with a weekly scan.
            </Text>
          </View>

          {/* Three actions */}
          <View style={[styles.cardsRow, wide && styles.cardsRowWide]}>
            {card('scan', true, 'Scan Workout', 'Capture or upload a workout card. The details are extracted automatically.', (
              <>
                <RivalButton label="Capture" onPress={() => router.push('/scan-workout?source=camera')} style={styles.fullBtn} />
                <RivalButton label="Upload" onPress={() => router.push('/scan-workout?source=gallery')} variant="secondary" style={styles.fullBtn} />
              </>
            ))}
            {card('manual', false, 'Manual Entry', 'Enter duration, distance and lifts.', (
              <RivalButton label="Manual Entry →" onPress={() => router.push('/manual-entry')} variant="secondary" style={styles.fullBtn} />
            ))}
            {card('batch', false, 'Weekly Scan', 'Log multiple days at once.', (
              <RivalButton label="Weekly Scan" onPress={() => router.push('/weekly-scan')} variant="secondary" style={styles.fullBtn} />
            ))}
          </View>

          {/* How it works */}
          <View style={styles.processSection}>
            <Text style={styles.processTitle}>HOW IT WORKS</Text>
            <View style={[styles.processRow, wide && styles.processRowWide]}>
              {PROCESS_STEPS.map((step) => (
                <View key={step.title} style={[styles.processStep, wide && styles.processStepWide]}>
                  <View style={styles.processIcon}>
                    <RivalIcon name={step.icon} size={20} color={RivalColors.accentText} />
                  </View>
                  <View style={styles.processTextWrap}>
                    <Text style={styles.processStepTitle}>{step.title}</Text>
                    <Text style={styles.processStepBody}>{step.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  bg: { flex: 1 },
  // Faint atmospheric backdrop, like the mockup's opacity-10 image behind a scrim.
  bgImage: { opacity: 0.12 },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, maxWidth: 1200, width: '100%', alignSelf: 'center' },

  header: { marginBottom: 8 },
  back: { color: RivalColors.accentText, fontSize: 16 },

  hero: { alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 40, paddingHorizontal: 8 },
  heroLabel: { ...RivalType.labelCaps, color: RivalColors.accentText, letterSpacing: 2 },
  heroTitle: { ...RivalType.headlineLg, color: RivalColors.textPrimary, textAlign: 'center' },
  heroSub: { ...RivalType.bodyMd, color: RivalColors.textSecondary, textAlign: 'center', maxWidth: 560 },

  cardsRow: { gap: 16, marginBottom: 48 },
  cardsRowWide: { flexDirection: 'row', alignItems: 'stretch' },
  card: { flex: 1, padding: 24, gap: 12 },
  cardWide: { flexBasis: 0 },
  cardIcon: { width: 56, height: 56, borderRadius: RivalRadius.md, backgroundColor: RivalColors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  cardIconAccent: { backgroundColor: `${RivalColors.accentFill}22` },
  cardIconText: { fontSize: 26 },
  cardTitle: { ...RivalType.titleMd, fontSize: 22, color: RivalColors.textPrimary },
  cardBody: { ...RivalType.bodyMd, fontSize: 14, color: RivalColors.textSecondary },
  cardActions: { marginTop: 'auto', paddingTop: 16, gap: 10 },
  fullBtn: { width: '100%' },

  processSection: { borderTopWidth: 1, borderTopColor: RivalColors.outlineVariant, paddingTop: 32 },
  processTitle: { ...RivalType.labelCaps, color: RivalColors.textSecondary, textAlign: 'center', letterSpacing: 3, marginBottom: 28 },
  processRow: { gap: 24 },
  processRowWide: { flexDirection: 'row' },
  processStep: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  processStepWide: { flex: 1 },
  processIcon: { width: 48, height: 48, borderRadius: RivalRadius.full, backgroundColor: RivalColors.surfaceContainerHigh, borderWidth: 1, borderColor: RivalColors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  processIconText: { fontSize: 20 },
  processTextWrap: { flex: 1, gap: 4 },
  processStepTitle: { ...RivalType.titleMd, fontSize: 16, color: RivalColors.textPrimary },
  processStepBody: { fontSize: 13, color: RivalColors.textSecondary, lineHeight: 19 },
});

// Phone only — the blend (see RivalGreySheet's rb).
const ms = StyleSheet.create({
  // Save activity's two tiles, placed as the Saved activities strip is.
  choiceRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  stepNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  stepNumText: { fontSize: 12, fontWeight: '800', color: RivalColors.accentText },
  stepText: { flex: 1, fontSize: 14, fontWeight: '600', color: RivalColors.textSecondary },
  actions: { flexDirection: 'row', gap: 8 },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 999,
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  },
  primaryText: { fontSize: 14.5, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  ghost: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)',
  },
  ghostText: { fontSize: 14.5, fontWeight: '700', color: RivalColors.accentText },
  // The two scan tiles on the phone pop-up.
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  tiles: { flexDirection: 'row', gap: 10 },
  tilesTop: { marginTop: 14 },
  tile: { flex: 1, minHeight: 132, borderRadius: 18, padding: 16, justifyContent: 'flex-end', gap: 3, overflow: 'hidden' },
  tilePrimary: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  tileGhost: { borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)', backgroundColor: 'rgba(255,209,190,0.05)' },
  tileIconPrimary: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.12)', marginBottom: 'auto' },
  tileIconGhost: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,181,158,0.1)', marginBottom: 'auto' },
  tileArt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  tileFade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tileFadePrimary: Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(0deg, rgba(223,124,92,0.55), rgba(223,124,92,0) 55%)' } as any : {},
  tileFadeGhost: Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(0deg, rgba(35,33,32,0.75), rgba(35,33,32,0) 60%)' } as any : {},
  tileTitle: { fontSize: 17, fontWeight: '800', color: RivalColors.textPrimary },
  tileSub: { fontSize: 12, fontWeight: '500', color: RivalColors.textSecondary },
  tileNote: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
  dayList: { marginTop: 14, backgroundColor: 'rgba(255,209,190,0.05)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,181,158,0.22)', paddingHorizontal: 13 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8 },
  dayRule: { borderTopWidth: 1, borderTopColor: 'rgba(255,209,190,0.08)' },
  dayDate: { width: 44, alignItems: 'center' },
  dayName: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8, color: RivalColors.textSecondary },
  dayNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, color: '#fff' },
  dayThumbs: { flexDirection: 'row', gap: 4, flex: 1 },
  dayThumb: { width: 30, height: 38, borderRadius: 6 },
  dayCount: { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  manage: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText, textAlign: 'center' },
  empty: { alignItems: 'center', paddingTop: 18, paddingHorizontal: 6, gap: 6 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,209,190,0.10)', marginBottom: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: RivalColors.textPrimary },
  emptyBody: { fontSize: 13, lineHeight: 19, color: RivalColors.textSecondary, textAlign: 'center', marginBottom: 14 },
  emptyBtn: { alignSelf: 'stretch' },
});
