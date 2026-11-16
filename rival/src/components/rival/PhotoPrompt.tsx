import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppState, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuthUser, supabase } from '../../lib/supabase';
import { saveArrangement } from '../../lib/activityMedia';
import { formatDistance } from '../../lib/units';
import { liveClock } from '../../lib/liveActivity';
import { getLive } from '../../lib/liveActivityStore';
import { celebrationFor, type Celebration, type CelebrationActivity } from '../../lib/celebration';
import { loadCelebration } from '../../lib/celebrationLoad';
import { CelebrationScreen } from './CelebrationScreen';
import { fetchAllActivities } from '../../lib/fetchAllActivities';
import { activityToPrompt, isQuoteUp, markPromptSeen, onPromptCheck, seenPrompts, type PromptActivity } from '../../lib/photoPrompt';
import { BREAKPOINT_WIDE_LAYOUT } from '../../constants/breakpoints';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { MediaPicker, pickMediaFiles, type MediaItem } from './MediaPicker';
import { GreyPrimary } from './RivalGreySheet';
import { MomentCaptured } from './MomentCaptured';
import { RivalIcon } from './RivalIcon';
import { useSheetDrag } from './useSheetDrag';
import { webFx } from '../../lib/webFx';

// Capture The Moment: a pop-up over the page, so the page itself never moves
// (Ricky, 2026-10-31, option 3). Phones only, on the four main tabs.
const TABS = new Set(['/home', '/my-activities', '/team-feed', '/messages']);

export function PhotoPrompt() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activity, setActivity] = useState<PromptActivity | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ items: MediaItem[]; notice?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState(false);
  // A personal best or one of the year's achievements: shown full screen
  // instead of the sheet (Ricky, 2026-11-02).
  const [moment, setMoment] = useState<{ c: Celebration; activity: CelebrationActivity } | null>(null);
  const onPage = TABS.has(pathname) && width < BREAKPOINT_WIDE_LAYOUT;
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  const openRef = useRef(false);
  openRef.current = !!activity;

  const check = useCallback(async () => {
    if (!onPageRef.current || openRef.current || isQuoteUp() || getLive()) return;
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    const { data } = await supabase.from('activities')
      .select('id, name, started_at, provider, photo_url, duration_seconds, distance_meters, effort_score')
      .eq('user_id', user.id).order('started_at', { ascending: false }).limit(10);
    // Dev only: ?previewPrompt=1 shows it for the latest activity, whatever its
    // age, so the pop-up can be looked at on a phone. Saves nothing unless a
    // photo is chosen.
    const preview = __DEV__ && Platform.OS === 'web' && typeof location !== 'undefined' && location.search.includes('previewPrompt=1');
    if (preview && data?.[0]) { setMoment(await momentFor(user.id, data[0].id)); setUserId(user.id); setActivity(data[0] as PromptActivity); return; }
    // ?previewCelebration=pb or =achievement: the newest activity with one, to look at.
    const want = __DEV__ && Platform.OS === 'web' && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('previewCelebration') : null;
    if (want) {
      const rows = (await fetchAllActivities(user.id, 'id, name, activity_type, started_at, utc_offset_seconds, duration_seconds, distance_meters, elevation_meters, effort_score, exercises, provider, photo_url, race_id')) as any[];
      for (const a of [...rows].sort((x, y) => y.started_at.localeCompare(x.started_at))) {
        if (want === 'event' && !a.race_id) continue;
        const c: Celebration | null | undefined = want === 'event' ? (await loadCelebration(user.id, a.id))?.c : celebrationFor(rows, a.id, user.id);
        if (c && c.kind === want) { setMoment({ c, activity: a }); setUserId(user.id); setActivity(a); return; }
      }
    }
    const found = activityToPrompt((data ?? []) as PromptActivity[], seenPrompts());
    if (!found || !onPageRef.current || isQuoteUp() || getLive()) return;
    // Its photos may be held as media with no cover.
    const { count } = await supabase.from('activity_media').select('id', { count: 'exact', head: true }).eq('activity_id', found.id);
    markPromptSeen(found.id);
    if (count) return;
    const m = await momentFor(user.id, found.id);
    if (!onPageRef.current || isQuoteUp() || getLive()) return;
    setMoment(m);
    setUserId(user.id);
    setActivity(found);
  }, []);

  useEffect(() => {
    const first = setTimeout(check, 6000);
    const off = onPromptCheck(check);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { clearTimeout(first); off(); sub.remove(); };
  }, [check]);

  const close = useCallback(() => { setActivity(null); setMoment(null); }, []);
  const dragRef = useSheetDrag(close);

  async function choose() {
    setError(null);
    const { items, rejected } = await pickMediaFiles();
    if (items.length) setPicked({ items, notice: rejected[0] });
    else if (rejected.length) setError(rejected[0]);
  }

  async function save(items: MediaItem[]) {
    if (!activity || !userId) return;
    setPicked(null);
    setSaving(true);
    const result = await saveArrangement({ activityId: activity.id, userId, items, existing: [], currentCover: null });
    setSaving(false);
    if (result.errors.length) { setError(result.errors[0]); return; }
    close();
    setCaptured(true);
  }

  if (captured) return <MomentCaptured onDone={() => setCaptured(false)} />;
  if (!activity) return null;
  const stats = [
    (activity.distance_meters ?? 0) > 0 ? formatDistance((activity.distance_meters ?? 0) / 1000) : null,
    activity.duration_seconds ? liveClock(activity.duration_seconds) : null,
    activity.effort_score ? `Effort ${Math.round(activity.effort_score)}` : null,
  ].filter(Boolean).join(' · ');

  const picker = picked ? (
    <MediaPicker initial={picked.items} initialNotice={picked.notice} title="Photos and videos" onCancel={() => setPicked(null)} onDone={save} />
  ) : null;
  if (moment) {
    return (
      <CelebrationScreen celebration={moment.c} activity={moment.activity} busy={saving} error={error} onAddPhoto={choose} onClose={close}>
        {picker}
      </CelebrationScreen>
    );
  }

  const sheet = (
    <View style={s.dim}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={close} accessibilityLabel="Not now" />
      <View ref={dragRef as any} style={[s.sheet, { paddingBottom: Math.max(30, insets.bottom + 8) }]}>
        <View style={[s.sky, { pointerEvents: 'none' }]} />
        <View style={[s.fade, { pointerEvents: 'none' }]} />
        <View style={s.grabber} />
        <View style={s.camera}><RivalIcon name="addPhoto" size={36} color="rgba(255,255,255,0.8)" /></View>
        <Text style={s.kicker}>{activity.name}</Text>
        <Text style={s.title}>Capture The Moment.</Text>
        {stats ? <Text style={s.stats}>{stats}</Text> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        <View style={s.button}><GreyPrimary label="Add photo" busy={saving} onPress={choose} /></View>
        <TouchableOpacity onPress={close} disabled={saving} style={s.later}><Text style={s.laterText}>Not now</Text></TouchableOpacity>
      </View>
      {picker}
    </View>
  );
  // Beside the bottom bar under <body>, or the bar would sit on top of it.
  return Platform.OS === 'web' ? createPortal(sheet, document.body) : sheet;
}

async function momentFor(userId: string, activityId: string) {
  return loadCelebration(userId, activityId);
}

const SHEET = RivalColors.surfaceHigh;
const s = StyleSheet.create({
  dim: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute', top: 0, left: 0, right: 0, zIndex: 400, backgroundColor: 'rgba(0,0,0,0.6)',
    // 100vh is the true screen on an iPhone home-screen app (see RivalTopNav).
    ...(Platform.OS === 'web' ? { height: '100vh' } as any : { bottom: 0 }),
  },
  sheet: { backgroundColor: SHEET, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, overflow: 'hidden' },
  sky: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 330, backgroundColor: '#a7786a',
    ...(webFx({ backgroundImage: 'linear-gradient(180deg, #5b5f7d 0%, #a7786a 50%, #e0a46a 100%)' })),
  },
  fade: {
    position: 'absolute', top: 150, left: 0, right: 0, height: 181,
    ...(webFx({ backgroundImage: `linear-gradient(180deg, rgba(40,40,40,0), ${SHEET})` })),
  },
  grabber: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, backgroundColor: 'rgba(255,255,255,0.45)' },
  camera: { alignItems: 'center', marginTop: 90, marginBottom: 96 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', textAlign: 'center', color: RivalColors.accentText },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 28, lineHeight: 35, color: '#fff', textAlign: 'center', marginTop: 4 },
  stats: { fontSize: 12.5, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 4 },
  error: { fontSize: 13, color: RivalColors.error, textAlign: 'center', marginTop: 8 },
  button: { marginTop: 18 },
  later: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, marginTop: 7 },
  laterText: { fontSize: 13.5, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
});
