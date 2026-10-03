import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { GreySheet, GreyLabel, GreyNote, GreyPrimary, GreyRows, GreyRow, GreyRowInput, rb } from './RivalGreySheet';
import { RivalIcon } from './RivalIcon';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { supabase, getAuthUser } from '../../lib/supabase';
import { calculateEffortScore, loadScoringConfig, type ScoringConfig } from '../../lib/effort';
import { findMatchingRaceId } from '../../lib/raceMatch';
import { matchCanonicalLift } from '../../lib/lifts';
import { goToTab } from '../../lib/tabNav';

// Multi-day scan on phone (Ricky, 2026-10-02): a pop-up with one row of days
// to swipe back through, ending on today, always showing six whole days. Two
// steps, one job each: "Scan photos" reads them and saves nothing; the review
// lists what was found per day, any row can be changed or removed, and
// "Save all" saves them and goes to the Activity page.

type Photo = { uri: string; base64: string; mimeType: string };
type Day = { date: Date; photos: Photo[] };
type Draft = {
  date: Date;
  name: string;
  type: string;
  minutes: string;
  km: string;
  elevation: number;
  exercises: any[] | null;
  /** Set when the photos couldn't be read. */
  error?: string;
};

const DAYS_BACK = 42; // six weeks to swipe back through
const VISIBLE = 6;
const GAP = 6;
const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Class formats are almost always a full class even when the board only shows
// the timed part, as in the single scan.
const CLASS_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT', 'Bootcamp']);
const classFloor = (type: string, seconds: number) =>
  CLASS_TYPES.has(type) && seconds > 0 && seconds < 30 * 60 ? 45 * 60 : seconds;

function lastDays(): Day[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: DAYS_BACK }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (DAYS_BACK - 1 - i));
    return { date: d, photos: [] };
  });
}

const shortDate = (d: Date) => `${d.getDate()} ${MONTH[d.getMonth()]}`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

async function pickPhotos(): Promise<Photo[]> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        const read = (file: File) => new Promise<Photo>((done) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const uri = e.target?.result as string;
            done({ uri, base64: uri.split(',')[1], mimeType: file.type || 'image/jpeg' });
          };
          reader.readAsDataURL(file);
        });
        resolve(await Promise.all(files.map(read)));
      };
      input.click();
    });
  }
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo library access is needed to add photos.');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.8, base64: true });
  if (result.canceled) return [];
  return (result.assets ?? []).filter((a) => a.base64).map((a) => ({ uri: a.uri, base64: a.base64!, mimeType: a.mimeType || 'image/jpeg' }));
}

export function MultiDayScan() {
  const [days, setDays] = useState<Day[]>(lastDays);
  const [phase, setPhase] = useState<'photos' | 'scanning' | 'review' | 'saving'>('photos');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [stripW, setStripW] = useState(0);
  const [firstShown, setFirstShown] = useState(DAYS_BACK - VISIBLE);
  const stripRef = useRef<ScrollView>(null);

  useEffect(() => { loadScoringConfig().then(setConfig).catch(() => {}); }, []);

  const close = () => (router.canGoBack() ? router.back() : goToTab('/my-activities'));
  const cardW = stripW > 0 ? (stripW - GAP * (VISIBLE - 1)) / VISIBLE : 0;
  const step = cardW + GAP;
  const withPhotos = days.filter((d) => d.photos.length > 0);
  const photoCount = withPhotos.reduce((n, d) => n + d.photos.length, 0);
  const shownFrom = days[Math.max(0, Math.min(DAYS_BACK - VISIBLE, firstShown))].date;
  const shownTo = days[Math.max(0, Math.min(DAYS_BACK - 1, firstShown + VISIBLE - 1))].date;
  const range = shownFrom.getMonth() === shownTo.getMonth()
    ? `${shownFrom.getDate()} – ${shortDate(shownTo)}`
    : `${shortDate(shownFrom)} – ${shortDate(shownTo)}`;

  async function addPhotos(i: number) {
    if (phase !== 'photos') return;
    setError(null);
    try {
      const photos = await pickPhotos();
      if (photos.length === 0) return;
      setDays((prev) => prev.map((d, di) => (di === i ? { ...d, photos: [...d.photos, ...photos] } : d)));
    } catch (e: any) {
      setError(e?.message ?? 'Photos could not be added.');
    }
  }

  function removePhoto(dayIndex: number, photoIndex: number) {
    setDays((prev) => prev.map((d, di) => (di === dayIndex ? { ...d, photos: d.photos.filter((_, pi) => pi !== photoIndex) } : d)));
  }

  // Step 1: read every day's photos. Nothing is saved.
  async function scan() {
    if (withPhotos.length === 0) return;
    setError(null);
    setPhase('scanning');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setPhase('photos'); setError('Sign in to continue.'); return; }
    const found = await Promise.all(withPhotos.map(async (day): Promise<Draft> => {
      const blank: Draft = { date: day.date, name: '', type: 'Workout', minutes: '', km: '', elevation: 0, exercises: null };
      try {
        const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/scan-workout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({ images: day.photos.map((p) => ({ base64Image: p.base64, mediaType: p.mimeType })) }),
        });
        const data = await res.json();
        if (!res.ok || !data.workout) return { ...blank, error: 'The photos could not be read.' };
        const w = data.workout;
        const type = w.workoutType || 'Workout';
        const seconds = classFloor(type, w.duration || 0);
        return {
          date: day.date,
          name: type,
          type,
          minutes: seconds > 0 ? String(Math.round(seconds / 60)) : '',
          km: w.distance ? String(Math.round(w.distance * 100) / 100) : '',
          elevation: w.elevation || 0,
          exercises: w.exercises?.length > 0 ? w.exercises : null,
        };
      } catch {
        return { ...blank, error: 'The photos could not be read.' };
      }
    }));
    setDrafts(found);
    setPhase('review');
  }

  const effortOf = (d: Draft) => {
    if (!config || d.error) return null;
    const seconds = (parseFloat(d.minutes) || 0) * 60;
    if (seconds <= 0) return null;
    return Math.round(calculateEffortScore(d.type, seconds, d.elevation, config, (parseFloat(d.km) || 0) * 1000));
  };
  const issueOf = (d: Draft) => {
    if (d.error) return d.error;
    if (!(parseFloat(d.minutes) > 0)) return 'Add the duration';
    return null;
  };
  const saveable = drafts.filter((d) => !issueOf(d));

  // Step 2: save what was reviewed, then go to the Activity page.
  async function saveAll() {
    if (saveable.length === 0) return;
    setPhase('saving');
    setError(null);
    const { data: { user } } = await getAuthUser();
    if (!user) { setPhase('review'); setError('Sign in to continue.'); return; }
    const cfg = config ?? await loadScoringConfig();
    const failed: Draft[] = [];
    for (const d of saveable) {
      const seconds = Math.round((parseFloat(d.minutes) || 0) * 60);
      const meters = (parseFloat(d.km) || 0) * 1000;
      const effort = calculateEffortScore(d.type, seconds, d.elevation, cfg, meters);
      const startedAt = d.date.toISOString();
      const name = d.name.trim() || d.type;
      const { data: row, error: insertError } = await supabase.from('activities').insert({
        user_id: user.id,
        provider: 'rival_scan',
        provider_activity_id: `scan-multi-${d.date.getTime()}-${Date.now()}`,
        name,
        name_locked: name !== d.type,
        activity_type: d.type,
        distance_meters: meters,
        duration_seconds: seconds,
        elevation_meters: d.elevation,
        started_at: startedAt,
        effort_score: effort,
        raw_effort_score: effort,
        exercises: d.exercises,
        race_id: await findMatchingRaceId(user.id, startedAt),
      }).select('id').single();
      if (insertError || !row) { failed.push(d); continue; }
      const lifts = (d.exercises ?? [])
        .map((ex: any) => ({ canonical: matchCanonicalLift(ex.name), ex }))
        .filter((m: any) => m.canonical && m.ex.weight)
        .map((m: any) => ({ user_id: user.id, activity_id: row.id, exercise_name: m.canonical, weight_kg: m.ex.weight, reps: m.ex.reps ?? null, performed_at: startedAt }));
      if (lifts.length > 0) await supabase.from('exercise_entries').insert(lifts);
    }
    if (failed.length > 0) {
      // Keep only what didn't save, so nothing is saved twice on retry.
      setDrafts(failed);
      setPhase('review');
      setError(`${failed.length} ${failed.length === 1 ? 'activity' : 'activities'} could not be saved. Try again.`);
      return;
    }
    goToTab('/my-activities');
  }

  const updateDraft = (i: number, patch: Partial<Draft>) => setDrafts((prev) => prev.map((d, di) => (di === i ? { ...d, ...patch } : d)));
  const removeDraft = (i: number) => { setEditing(null); setDrafts((prev) => prev.filter((_, di) => di !== i)); };

  const reviewing = phase === 'review' || phase === 'saving';
  const editingDraft = editing !== null ? drafts[editing] : null;

  const footer = reviewing ? (
    <>
      <GreyPrimary label={phase === 'saving' ? 'Saving…' : 'Save all'} busy={phase === 'saving'} disabled={phase === 'saving' || saveable.length === 0} onPress={saveAll} />
      <TouchableOpacity onPress={() => { setPhase('photos'); setEditing(null); }} disabled={phase === 'saving'} style={s.secondary} accessibilityRole="button">
        <Text style={s.secondaryText}>Back to photos</Text>
      </TouchableOpacity>
    </>
  ) : (
    <>
      <GreyPrimary label={phase === 'scanning' ? 'Scanning…' : 'Scan photos'} busy={phase === 'scanning'} disabled={phase === 'scanning' || withPhotos.length === 0} onPress={scan} />
      <Text style={s.hint}>Swipe right for earlier days.</Text>
    </>
  );

  // Editing one day: drawn over the sheet, like the calendar.
  const overlay = editingDraft && editing !== null ? (
    <View style={s.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setEditing(null)} accessibilityLabel="Done" />
      <View style={s.overlayCard}>
        <Text style={s.overlayKicker}>{`${WEEKDAY[editingDraft.date.getDay()]} ${shortDate(editingDraft.date).toUpperCase()}`}</Text>
        <Text style={s.overlayTitle}>{editingDraft.type}</Text>
        <GreyRows>
          <GreyRow icon="manual" label="Name">
            <GreyRowInput value={editingDraft.name} onChangeText={(t) => updateDraft(editing, { name: t })} placeholder={editingDraft.type} />
          </GreyRow>
          <GreyRow icon="timer" label="Duration">
            <GreyRowInput value={editingDraft.minutes} onChangeText={(t) => updateDraft(editing, { minutes: t.replace(/[^0-9.]/g, '') })} placeholder="0" keyboardType="decimal-pad" />
            <Text style={s.unit}>min</Text>
          </GreyRow>
          <GreyRow icon="distance" label="Distance">
            <GreyRowInput value={editingDraft.km} onChangeText={(t) => updateDraft(editing, { km: t.replace(/[^0-9.]/g, '') })} placeholder="Optional" keyboardType="decimal-pad" />
            <Text style={s.unit}>km</Text>
          </GreyRow>
        </GreyRows>
        <View style={s.overlayActions}>
          <TouchableOpacity onPress={() => removeDraft(editing)} style={s.remove} accessibilityRole="button">
            <RivalIcon name="delete" size={16} color={RivalColors.textSecondary} />
            <Text style={s.removeText}>Remove day</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setEditing(null)} style={s.done} accessibilityRole="button">
            <Text style={s.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  ) : null;

  return (
    <View style={s.backdrop}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
      <GreySheet
        kicker={reviewing ? 'REVIEW' : 'SEVERAL DAYS'}
        title="Multi-day scan"
        onClose={close}
        footer={footer}
        overlay={overlay}
      >
        <Text style={s.sub}>{reviewing ? 'Check each day before saving. Tap one to change it.' : "Add photos to each day. They're scanned together."}</Text>
        {error ? <Text style={s.error}>{error}</Text> : null}

        {!reviewing ? (
          <View style={[rb.card, rb.hero, s.card]}>
            <View style={s.head}>
              <Text style={s.range}>{range}</Text>
              <Text style={s.count}>{photoCount === 0 ? 'Tap a day to add photos' : `${plural(photoCount, 'photo')} · ${plural(withPhotos.length, 'day')}`}</Text>
            </View>
            <View onLayout={(e) => setStripW(e.nativeEvent.layout.width)}>
              {cardW > 0 && (
                <ScrollView
                  ref={stripRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  snapToInterval={step}
                  decelerationRate="fast"
                  // Web: the browser's own snapping, one whole day at a time.
                  style={Platform.OS === 'web' ? ({ scrollSnapType: 'x mandatory' } as any) : undefined}
                  contentContainerStyle={{ gap: GAP }}
                  onContentSizeChange={() => stripRef.current?.scrollToEnd({ animated: false })}
                  scrollEventThrottle={32}
                  onScroll={(e) => setFirstShown(Math.round(e.nativeEvent.contentOffset.x / step))}
                >
                  {days.map((d, i) => {
                    const has = d.photos.length > 0;
                    const isToday = i === DAYS_BACK - 1;
                    return (
                      <TouchableOpacity
                        key={d.date.getTime()}
                        onPress={() => addPhotos(i)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={`${WEEKDAY[d.date.getDay()]} ${shortDate(d.date)}, ${has ? plural(d.photos.length, 'photo') : 'add photos'}`}
                        style={[
                          s.day, { width: cardW }, has && s.dayOn, isToday && !has && s.dayToday,
                          Platform.OS === 'web' && ({ scrollSnapAlign: 'start' } as any),
                          phase === 'scanning' && has && SCAN_PULSE,
                        ]}
                      >
                        <Text style={[s.dayName, has && s.dayNameOn]}>{isToday ? 'TODAY' : WEEKDAY[d.date.getDay()]}</Text>
                        <Text style={s.dayNum}>{d.date.getDate()}</Text>
                        {has ? (
                          <View style={s.dayCount}>
                            <RivalIcon name="camera" size={10} color={RivalColors.accentText} />
                            <Text style={s.dayCountText}>{d.photos.length}</Text>
                          </View>
                        ) : (
                          <Text style={s.dayPlus}>+</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
            {photoCount > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.thumbs}>
                {days.flatMap((d, di) => d.photos.map((p, pi) => (
                  <View key={`${di}-${pi}`} style={s.thumb}>
                    <Image source={{ uri: p.uri }} style={s.thumbImg} />
                    <Text style={s.thumbDay}>{WEEKDAY[d.date.getDay()]}</Text>
                    {phase === 'photos' && (
                      <TouchableOpacity style={s.thumbRemove} onPress={() => removePhoto(di, pi)} accessibilityLabel="Remove photo">
                        <RivalIcon name="close" size={11} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </View>
                )))}
              </ScrollView>
            )}
          </View>
        ) : (
          <View style={[rb.card, rb.hero, s.list]}>
            {drafts.length === 0 ? (
              <GreyNote>Every day was removed. Go back to add photos.</GreyNote>
            ) : drafts.map((d, i) => {
              const issue = issueOf(d);
              const effort = effortOf(d);
              const details = [d.type, d.km ? `${d.km} km` : null, d.minutes ? `${d.minutes} min` : null].filter(Boolean).join(' · ');
              return (
                <TouchableOpacity key={d.date.getTime()} style={[s.row, i > 0 && s.rowRule]} onPress={() => setEditing(i)} activeOpacity={0.8} accessibilityRole="button" disabled={phase === 'saving'}>
                  <View style={s.rowDay}>
                    <Text style={s.rowDayName}>{WEEKDAY[d.date.getDay()]}</Text>
                    <Text style={s.rowDayNum}>{d.date.getDate()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>{d.error ? 'Not read' : (d.name.trim() || d.type)}</Text>
                    <Text style={[s.rowSub, issue && s.rowIssue]} numberOfLines={1}>{issue ?? details}</Text>
                  </View>
                  {effort !== null && (
                    <View style={s.rowEffort}>
                      <Text style={s.rowEffortNum}>{effort}</Text>
                      <Text style={s.rowEffortLabel}>Effort</Text>
                    </View>
                  )}
                  <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.35)" />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {reviewing && saveable.length < drafts.length && drafts.length > 0 ? (
          <GreyNote>Days marked in orange are left out of Save all until they're fixed or removed.</GreyNote>
        ) : null}
      </GreySheet>
    </View>
  );
}

// The day cards with photos breathe while they're read, like the loading
// screens (keyframes in global.css).
const SCAN_PULSE: any = Platform.OS === 'web'
  ? { animationName: 'rivalSkelPulse', animationDuration: '1.2s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' }
  : null;

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sub: { fontSize: 12.5, lineHeight: 17, color: RivalColors.textSecondary, textAlign: 'center', marginBottom: 16, marginTop: -4 },
  error: { fontSize: 12.5, color: RivalColors.accentText, textAlign: 'center', marginBottom: 12 },
  card: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 14 },
  head: { alignItems: 'center', marginBottom: 12, gap: 4 },
  range: { fontSize: 13, fontWeight: '800', color: RivalColors.textPrimary },
  count: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: RivalColors.textSecondary },
  day: {
    height: 84, borderRadius: 13, paddingTop: 8, paddingBottom: 7, alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  dayOn: {
    borderColor: 'rgba(255,181,158,0.55)', backgroundColor: 'rgba(217,119,87,0.22)',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, rgba(217,119,87,0.35), rgba(217,119,87,0.12))' } as any : {}),
  },
  dayToday: { borderColor: 'rgba(255,181,158,0.35)' },
  dayName: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary },
  dayNameOn: { color: '#ffd1be' },
  dayNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, color: RivalColors.textPrimary },
  dayPlus: { fontSize: 15, fontWeight: '700', lineHeight: 15, color: RivalColors.accentText },
  dayCount: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dayCountText: { fontSize: 10, fontWeight: '800', color: RivalColors.accentText },
  thumbs: { gap: 8, paddingTop: 14 },
  thumb: { width: 58, height: 58, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)' },
  thumbImg: { width: '100%', height: '100%' },
  thumbDay: { position: 'absolute', left: 5, bottom: 4, fontSize: 8, fontWeight: '800', color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  thumbRemove: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 11.5, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 4 },
  secondary: { alignItems: 'center', paddingVertical: 8 },
  secondaryText: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  list: { paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  rowDay: { width: 40, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(217,119,87,0.22)', borderWidth: 1, borderColor: 'rgba(255,181,158,0.4)' },
  rowDayName: { fontSize: 8.5, fontWeight: '800', letterSpacing: 1, color: '#ffd1be' },
  rowDayNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 16, color: RivalColors.textPrimary },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: RivalColors.textPrimary },
  rowSub: { fontSize: 11.5, color: RivalColors.textSecondary, marginTop: 2 },
  rowIssue: { color: RivalColors.accentText },
  rowEffort: { alignItems: 'flex-end' },
  rowEffortNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, lineHeight: 22, color: RivalColors.textPrimary },
  rowEffortLabel: { fontSize: 9.5, fontWeight: '600', color: RivalColors.textSecondary },
  unit: { fontSize: 13, color: RivalColors.textSecondary, marginLeft: 6 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 16, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  overlayCard: { backgroundColor: RivalColors.surfaceHigh, borderRadius: 20, padding: 16, gap: 10 },
  overlayKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: RivalColors.accentText, textAlign: 'center' },
  overlayTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, color: RivalColors.textPrimary, textAlign: 'center', marginBottom: 4 },
  overlayActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  remove: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  removeText: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  done: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 999, backgroundColor: 'rgba(255,181,158,0.14)' },
  doneText: { fontSize: 13.5, fontWeight: '800', color: RivalColors.accentText },
});
