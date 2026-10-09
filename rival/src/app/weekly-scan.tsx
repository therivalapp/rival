import { useState, useEffect } from 'react';
import { fitPhoto } from '../lib/imageResize';
import { RivalColors, RivalButtonColors } from '../constants/rivalTheme';
import { RivalIcon, RivalBackButton, RivalMobileHeader, RivalWarm, rm, GreyPageHead, GREY_PAGE_BG } from '../components/rival';
import { sidePageWide } from '../constants/breakpoints';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Image, Platform, ActivityIndicator, TextInput, useWindowDimensions } from 'react-native';
import { notify } from '../lib/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase, getAuthUser } from '../lib/supabase';
import { calculateEffortScore, loadScoringConfig } from '../lib/effort';
import { findMatchingRaceId } from '../lib/raceMatch';
import { matchCanonicalLift } from '../lib/lifts';
import { goToTab } from '../lib/tabNav';
import { MultiDayScan } from '../components/rival/MultiDayScan';

type DayImage = { uri: string; base64: string; mimeType: string };
type DayState = {
  date: Date;
  label: string;
  shortLabel: string;
  images: DayImage[];
};

type DayResult = {
  label: string;
  status: 'pending' | 'scanning' | 'saved' | 'error';
  workoutType?: string;
  xp?: number;
  errorMsg?: string;
  activityId?: string;
  name?: string;
  mediaCount?: number;
};

function getCurrentWeekDays(): DayState[] {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return dayLabels.map((shortLabel, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return {
      date,
      label: `${shortLabel} ${date.getDate()}`,
      shortLabel,
      images: [],
    };
  });
}

// Class-based formats are almost always a full ~45-60min session even though the
// scanned WOD/board only shows the timed portion (e.g. a 15min WOD inside an hour class).
const CLASS_BASED_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT', 'Bootcamp']);
const CLASS_DURATION_FLOOR_SECONDS = 45 * 60;

function applyClassDurationFloor(workoutType: string, durationSeconds: number): number {
  if (CLASS_BASED_TYPES.has(workoutType) && durationSeconds > 0 && durationSeconds < 30 * 60) {
    return CLASS_DURATION_FLOOR_SECONDS;
  }
  return durationSeconds;
}

// Phone: the multi-day scan pop-up (MultiDayScan.tsx). Desktop keeps this page.
export default function WeeklyScanRoute() {
  const wide = sidePageWide(useWindowDimensions().width);
  return wide ? <WeeklyScanScreen /> : <MultiDayScan />;
}

function WeeklyScanScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const wide = sidePageWide(windowWidth);

  const [days, setDays] = useState<DayState[]>(getCurrentWeekDays());
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<DayResult[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(null), 5000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  async function pickPhotosForDay(dayIndex: number) {
    setErrorMsg(null);

    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        const readFile = (file: File) => new Promise<DayImage>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUri = e.target?.result as string;
            resolve({ uri: dataUri, base64: dataUri.split(',')[1], mimeType: file.type || 'image/jpeg' });
          };
          reader.readAsDataURL(file);
        });

        const images = await Promise.all(files.map(readFile));
        setDays((prev) => prev.map((d, i) => i === dayIndex ? { ...d, images: [...d.images, ...images] } : d));
      };
      input.click();
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setErrorMsg('Photo library access is required to add workout photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
      base64: true,
    });

    if (result.canceled || !result.assets?.length) return;

    const images: DayImage[] = result.assets
      .filter(a => a.base64)
      .map(a => ({ uri: a.uri, base64: a.base64!, mimeType: a.mimeType || 'image/jpeg' }));

    setDays((prev) => prev.map((d, i) => i === dayIndex ? { ...d, images: [...d.images, ...images] } : d));
  }

  function removeDayImage(dayIndex: number, imgIndex: number) {
    setDays((prev) => prev.map((d, i) =>
      i === dayIndex ? { ...d, images: d.images.filter((_, ii) => ii !== imgIndex) } : d
    ));
  }

  async function scanAndSaveAll() {
    const daysWithPhotos = days.filter(d => d.images.length > 0);
    if (daysWithPhotos.length === 0) {
      setErrorMsg('Add a photo to at least one day.');
      return;
    }

    setProcessing(true);
    setErrorMsg(null);
    const initialResults: DayResult[] = daysWithPhotos.map(d => ({ label: d.label, status: 'pending' }));
    setResults(initialResults);

    const { data: { user } } = await getAuthUser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!user || !session) {
      setProcessing(false);
      setErrorMsg('Sign in to continue.');
      return;
    }

    for (let i = 0; i < daysWithPhotos.length; i++) {
      const day = daysWithPhotos[i];
      setResults((prev) => prev!.map((r, ri) => ri === i ? { ...r, status: 'scanning' } : r));

      try {
        const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/scan-workout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({
            images: day.images.map(img => ({ base64Image: img.base64, mediaType: img.mimeType })),
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.workout) {
          setResults((prev) => prev!.map((r, ri) => ri === i ? { ...r, status: 'error', errorMsg: data.error || 'Could not read photo' } : r));
          continue;
        }

        const workout = data.workout;
        const workoutType = workout.workoutType || 'Workout';
        const duration = applyClassDurationFloor(workoutType, workout.duration || 0);
        const distance = workout.distance || 0;
        const effortScore = calculateEffortScore(workoutType, duration, workout.elevation || 0, await loadScoringConfig(), distance * 1000);

        const raceId = await findMatchingRaceId(user.id, day.date.toISOString());

        const { data: inserted, error: insertErr } = await supabase.from('activities').insert({
          user_id: user.id,
          provider: 'rival_scan',
          provider_activity_id: `scan-week-${day.date.getTime()}-${Date.now()}`,
          name: workoutType,
          activity_type: workoutType,
          distance_meters: distance * 1000,
          duration_seconds: duration,
          elevation_meters: workout.elevation || 0,
          started_at: day.date.toISOString(),
          effort_score: effortScore,
          raw_effort_score: effortScore,
          exercises: workout.exercises?.length > 0 ? workout.exercises : null,
          race_id: raceId,
        }).select('id').single();

        if (insertErr || !inserted) {
          setResults((prev) => prev!.map((r, ri) => ri === i ? { ...r, status: 'error', errorMsg: insertErr?.message } : r));
          continue;
        }

        const liftEntries = (workout.exercises || [])
          .map((ex: any) => ({ canonical: matchCanonicalLift(ex.name), ex }))
          .filter((m: any) => m.canonical && m.ex.weight)
          .map((m: any) => ({
            user_id: user.id,
            activity_id: inserted.id,
            exercise_name: m.canonical,
            weight_kg: m.ex.weight,
            reps: m.ex.reps ?? null,
            performed_at: day.date.toISOString(),
          }));
        if (liftEntries.length > 0) {
          // The activity row is already in; dropping the lifts silently would
          // leave the PR tracker quietly short.
          const { error: liftErr } = await supabase.from('exercise_entries').insert(liftEntries);
          if (liftErr) setErrorMsg(`Saved. The lifts could not be attached: ${liftErr.message}`);
        }

        setResults((prev) => prev!.map((r, ri) => ri === i ? {
          ...r, status: 'saved', workoutType, xp: Math.round(effortScore),
          activityId: inserted.id, name: workoutType, mediaCount: 0,
        } : r));
      } catch (err: any) {
        setResults((prev) => prev!.map((r, ri) => ri === i ? { ...r, status: 'error', errorMsg: 'Failed to scan' } : r));
      }
    }

    setProcessing(false);
  }

  function startEditingName(index: number, currentName: string) {
    setEditingIndex(index);
    setEditingName(currentName);
  }

  async function saveEditedName(index: number) {
    const result = results?.[index];
    if (!result?.activityId) { setEditingIndex(null); return; }
    const trimmed = editingName.trim();
    if (!trimmed) { setEditingIndex(null); return; }

    const { error: nameErr } = await supabase.from('activities').update({ name: trimmed, name_locked: true }).eq('id', result.activityId);
    if (nameErr) {
      setErrorMsg(`The workout could not be renamed: ${nameErr.message}`);
      setEditingIndex(null);
      return;
    }
    setResults((prev) => prev!.map((r, ri) => ri === index ? { ...r, name: trimmed } : r));
    setEditingIndex(null);
  }

  async function addPhotoToResult(index: number) {
    const result = results?.[index];
    if (!result?.activityId) return;
    setErrorMsg(null);

    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;
        await uploadResultMedia(index, result.activityId!, files);
      };
      input.click();
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setErrorMsg('Photo library access is required to add photos and videos.');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (pickerResult.canceled || !pickerResult.assets?.length) return;

    const blobs = await Promise.all(pickerResult.assets.map(async (a) => ({
      blob: await (await fetch(a.uri)).blob(),
      mimeType: a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      ext: a.fileName?.split('.').pop() || (a.type === 'video' ? 'mp4' : 'jpg'),
      mediaType: (a.type === 'video' ? 'video' : 'photo') as 'photo' | 'video',
    })));

    await uploadResultMediaBlobs(index, result.activityId!, blobs);
  }

  const MAX_PHOTOS = 2;
  const MAX_VIDEOS = 1;

  async function uploadResultMedia(index: number, activityId: string, files: File[]) {
    const blobs = files.map(file => ({
      blob: file,
      mimeType: file.type,
      ext: file.name.split('.').pop() || (file.type.startsWith('video') ? 'mp4' : 'jpg'),
      mediaType: (file.type.startsWith('video') ? 'video' : 'photo') as 'photo' | 'video',
    }));
    await uploadResultMediaBlobs(index, activityId, blobs);
  }

  async function uploadResultMediaBlobs(
    index: number,
    activityId: string,
    blobs: Array<{ blob: Blob; mimeType: string; ext: string; mediaType: 'photo' | 'video' }>
  ) {
    setUploadingIndex(index);
    try {
      const { data: { user } } = await getAuthUser();
      if (!user) return;

      const existing = results?.[index]?.mediaCount || 0;
      let photoCount = 0;
      let videoCount = 0;

      for (let i = 0; i < blobs.length; i++) {
        const item = blobs[i];
        if (item.mediaType === 'photo' && photoCount >= MAX_PHOTOS) { setErrorMsg(`Up to ${MAX_PHOTOS} photos per workout`); continue; }
        if (item.mediaType === 'video' && videoCount >= MAX_VIDEOS) { setErrorMsg(`Up to ${MAX_VIDEOS} video per workout`); continue; }

        const up = await fitPhoto({ blob: item.blob, mimeType: item.mimeType, ext: item.ext });
        const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = `${user.id}/${activityId}-${uniqueId}.${up.ext}`;

        const { error: storageErr } = await supabase.storage
          .from('activity-photos')
          .upload(path, up.blob, { contentType: up.mimeType, upsert: true });

        if (storageErr) { setErrorMsg(`Upload failed: ${storageErr.message}`); continue; }

        const { data: urlData } = supabase.storage.from('activity-photos').getPublicUrl(path);

        const { error: mediaErr } = await supabase.from('activity_media').insert({
          activity_id: activityId,
          media_url: urlData.publicUrl,
          media_type: item.mediaType,
        });
        if (mediaErr) { setErrorMsg(`A photo could not be attached: ${mediaErr.message}`); continue; }

        if (item.mediaType === 'photo') {
          photoCount++;
          if (existing === 0 && photoCount === 1) {
            const { error: coverErr } = await supabase.from('activities').update({ photo_url: urlData.publicUrl }).eq('id', activityId);
            if (coverErr) setErrorMsg(`The cover photo could not be set: ${coverErr.message}`);
          }
        } else {
          videoCount++;
        }
      }

      setResults((prev) => prev!.map((r, ri) => ri === index ? { ...r, mediaCount: existing + photoCount + videoCount } : r));
    } finally {
      setUploadingIndex(null);
    }
  }

  const daysWithPhotosCount = days.filter(d => d.images.length > 0).length;
  const allDone = results && results.every(r => r.status === 'saved' || r.status === 'error');

  // Mobile gets the RIVAL look (RivalMobile.tsx) over the same markup;
  // desktop is untouched until the mobile app is finished.
  const st = (wide ? styles : mobileStyles) as typeof styles;
  const em = (glyph: string) => (wide ? glyph : '');

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.content}>

        {wide ? (
          <View style={st.header}>
            <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : goToTab('/my-activities'))} color={RivalColors.accentFill} />
          </View>
        ) : (
          <GreyPageHead kicker="THIS WEEK" title="Weekly scan" onBack={() => (router.canGoBack() ? router.back() : goToTab('/my-activities'))} />
        )}

        {wide ? <Text style={st.title}>Scan Your Week</Text> : null}
        <Text style={st.subtitle}>Add photos to each training day. All days are scanned together.</Text>

        {/* Not tied to one specific day/field — a permission or upload
            failure from any day's photo action lands here, right above the
            day grid it's about, instead of a bar fixed over the whole
            screen (which used to sit on top of the header/back button). */}
        {errorMsg && (
          <TouchableOpacity style={st.inlineErrorBar} onPress={() => setErrorMsg(null)}>
            <Text style={st.floatingErrorText}>{em('⚠️ ')}{errorMsg}</Text>
          </TouchableOpacity>
        )}

        {!results ? (
          <>
            <View style={st.daysGrid}>
              {days.map((day, i) => {
                const hasPhotos = day.images.length > 0;
                const isFuture = day.date.getTime() > Date.now();
                return (
                  <View key={i} style={[st.dayCard, hasPhotos && st.dayCardActive, isFuture && st.dayCardDisabled]}>
                    <TouchableOpacity
                      onPress={() => isFuture
                        ? notify("Future dates can't be logged", "Activities can be logged for today or earlier.")
                        : pickPhotosForDay(i)}
                      style={st.dayCardTouchable}
                    >
                      <Text style={[st.dayLabel, hasPhotos && st.dayLabelActive]}>{day.shortLabel}</Text>
                      <Text style={[st.dayDate, hasPhotos && st.dayLabelActive]}>{day.date.getDate()}</Text>
                      {isFuture ? (
                        <Text style={st.dayAddIcon}>—</Text>
                      ) : hasPhotos ? (
                        wide ? (
                          <Text style={st.dayPhotoCount}>📸 {day.images.length}</Text>
                        ) : (
                          <View style={mx.dayCount}>
                            <RivalIcon name="camera" size={11} color={RivalColors.accentText} />
                            <Text style={st.dayPhotoCount}>{day.images.length}</Text>
                          </View>
                        )
                      ) : (
                        <Text style={st.dayAddIcon}>+</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {days.some(d => d.images.length > 0) && (
              <View style={st.thumbsSection}>
                {days.map((day, di) => day.images.length === 0 ? null : (
                  <View key={di} style={st.thumbsRow}>
                    <Text style={st.thumbsRowLabel}>{day.label}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {day.images.map((img, ii) => (
                        <View key={ii} style={st.thumbWrap}>
                          <Image source={{ uri: img.uri }} style={st.thumb} />
                          <TouchableOpacity style={st.thumbRemove} onPress={() => removeDayImage(di, ii)}>
                            {wide ? <Text style={st.thumbRemoveText}>✕</Text> : <RivalIcon name="close" size={12} color="#fff" />}
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={[st.scanAllBtn, daysWithPhotosCount === 0 && st.scanAllBtnDisabled]}
              onPress={scanAndSaveAll}
              disabled={daysWithPhotosCount === 0 || processing}
            >
              <Text style={st.scanAllBtnText}>
                {wide
                  ? (processing ? '⏳ Scanning…' : `Scan & Save All (${daysWithPhotosCount})`)
                  : processing
                    ? 'Scanning…'
                    : daysWithPhotosCount === 0
                      ? 'Add photos to begin'
                      : `Scan and save ${daysWithPhotosCount} ${daysWithPhotosCount === 1 ? 'day' : 'days'}`}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={st.resultsSection}>
            {results.map((r, i) => (
              <View key={i} style={st.resultRowCard}>
                <View style={st.resultRowTop}>
                  <Text style={st.resultLabel}>{r.label}</Text>
                  {r.status === 'pending' && <Text style={st.resultStatusPending}>Waiting…</Text>}
                  {r.status === 'scanning' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator size="small" color={RivalColors.accentFill} />
                      <Text style={st.resultStatusPending}>Scanning…</Text>
                    </View>
                  )}
                  {r.status === 'error' && (
                    <Text style={st.resultStatusError}>{em('⚠️ ')}{r.errorMsg}</Text>
                  )}
                </View>

                {r.status === 'saved' && (
                  <>
                    <View style={st.resultSavedRow}>
                      {editingIndex === i ? (
                        <TextInput
                          style={st.resultNameInput}
                          value={editingName}
                          onChangeText={setEditingName}
                          autoFocus
                          onSubmitEditing={() => saveEditedName(i)}
                          onBlur={() => saveEditedName(i)}
                        />
                      ) : (
                        <TouchableOpacity onPress={() => startEditingName(i, r.name || r.workoutType || '')} style={{ flex: 1 }}>
                          {wide ? (
                            <Text style={st.resultStatusSaved}>✓ {r.name} — +{r.xp} Effort ✏️</Text>
                          ) : (
                            // The name is the session; Effort is what it earned.
                            // Tap the name to rename it, as before.
                            <View style={mx.savedRow}>
                              <Text style={mx.savedName} numberOfLines={1}>{r.name}</Text>
                              <View style={mx.effortTag}><Text style={mx.effortTagText}>+{r.xp} Effort</Text></View>
                            </View>
                          )}
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={st.resultPhotoBtn}
                        onPress={() => addPhotoToResult(i)}
                        disabled={uploadingIndex === i}
                      >
                        {wide ? (
                          <Text style={st.resultPhotoBtnText}>
                            {uploadingIndex === i ? '⏳' : `📷${r.mediaCount ? ` ${r.mediaCount}` : ''}`}
                          </Text>
                        ) : uploadingIndex === i ? (
                          <ActivityIndicator size="small" color={RivalColors.accentText} />
                        ) : (
                          <>
                            <RivalIcon name="addPhoto" size={15} color={RivalColors.accentText} />
                            {r.mediaCount ? <Text style={st.resultPhotoBtnText}>{r.mediaCount}</Text> : null}
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            ))}

            {allDone && (
              <TouchableOpacity style={st.doneBtn} onPress={() => goToTab('/my-activities')}>
                <Text style={st.doneBtnText}>View my Activities →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  header: { marginBottom: 16 },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 24, lineHeight: 20 },

  // In normal document flow now, not position:absolute — it used to float
  // over the header/back button no matter what it was about; now it pushes
  // the day grid down instead of covering anything.
  inlineErrorBar: { backgroundColor: '#3b0a0a', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#f87171', marginBottom: 16 },
  floatingErrorText: { color: '#f87171', fontSize: 13, fontWeight: '600' },

  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  dayCard: { width: '13%', minWidth: 44, aspectRatio: 0.75, backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  dayCardActive: { backgroundColor: '#1A0A12', borderColor: RivalColors.accentFill },
  dayCardDisabled: { opacity: 0.35 },
  dayCardTouchable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  dayLabel: { fontSize: 11, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase' },
  dayLabelActive: { color: RivalColors.accentFill },
  dayDate: { fontSize: 16, fontWeight: '800', color: RivalColors.textSecondary },
  dayAddIcon: { fontSize: 16, color: '#444444', fontWeight: '700' },
  dayPhotoCount: { fontSize: 11, fontWeight: '700', color: RivalColors.accentFill },

  thumbsSection: { gap: 14, marginBottom: 24 },
  thumbsRow: { gap: 8 },
  thumbsRowLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  thumbWrap: { position: 'relative' },
  thumb: { width: 70, height: 70, borderRadius: 10, backgroundColor: RivalColors.surfaceHigh },
  thumbRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: RivalColors.accentFill, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  thumbRemoveText: { color: RivalColors.textPrimary, fontSize: 11, fontWeight: '800' },

  scanAllBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  scanAllBtnDisabled: { backgroundColor: '#3A2530', ...RivalButtonColors.noGradient },
  scanAllBtnText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontSize: 16, fontWeight: '800' },

  resultsSection: { gap: 10 },
  resultRowCard: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 8 },
  resultRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultSavedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultNameInput: { flex: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, color: RivalColors.textPrimary, fontSize: 13, fontWeight: '700', borderWidth: 1, borderColor: RivalColors.accentFill },
  resultPhotoBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  resultPhotoBtnText: { fontSize: 13, fontWeight: '700', color: '#CCCCCC' },
  resultLabel: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  resultStatusPending: { fontSize: 13, color: RivalColors.textSecondary },
  resultStatusSaved: { fontSize: 13, color: RivalColors.accentText, fontWeight: '700' },
  resultStatusError: { fontSize: 12, color: '#f87171', fontWeight: '600' },

  doneBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  doneBtnText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontSize: 16, fontWeight: '800' },
});

// Mobile: the blend (grey page, recessed cards) over the same markup.
const mobileStyles = {
  ...styles,
  ...StyleSheet.create({
    container: { flex: 1, backgroundColor: GREY_PAGE_BG },
    content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 120 },
    title: { fontFamily: rm.serifTitle.fontFamily, fontStyle: 'italic', fontSize: 26, fontWeight: '700', color: '#fff', marginTop: 4, marginBottom: 6 },
    subtitle: { fontSize: 13, color: RivalColors.textSecondary, marginBottom: 14, lineHeight: 18, textAlign: 'center' },
    inlineErrorBar: { backgroundColor: 'rgba(255,107,107,0.08)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255,143,143,0.35)', marginBottom: 14 },
    floatingErrorText: { color: '#ff8f8f', fontSize: 13, fontWeight: '600' },

    daysGrid: { flexDirection: 'row', gap: 6, marginBottom: 18 },
    dayCard: { flex: 1, minWidth: 0, aspectRatio: 0.72, backgroundColor: RivalColors.surfaceLowest, borderRadius: 14, borderWidth: 1, borderColor: RivalColors.surfaceBright },
    dayCardActive: { backgroundColor: 'rgba(255,209,190,0.10)', borderColor: 'rgba(255,181,158,0.55)' },
    dayCardTouchable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
    dayLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: RivalWarm.muted, textTransform: 'uppercase' },
    dayLabelActive: { color: RivalColors.accentText },
    dayDate: { fontFamily: rm.serifTitle.fontFamily, fontStyle: 'italic', fontSize: 19, fontWeight: '700', color: RivalWarm.soft },
    dayAddIcon: { fontSize: 16, color: 'rgba(255,255,255,0.3)', fontWeight: '600' },
    dayPhotoCount: { fontSize: 11, fontWeight: '800', color: RivalColors.accentText },

    thumbsSection: { gap: 10, marginBottom: 18 },
    thumbsRow: { gap: 8, backgroundColor: RivalColors.surfaceLowest, borderRadius: 16, borderWidth: 1, borderColor: RivalColors.surfaceBright, padding: 14 },
    thumbsRowLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary },
    thumb: { width: 76, height: 76, borderRadius: 12, backgroundColor: RivalWarm.field },
    thumbRemove: { position: 'absolute', top: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 11, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },

    scanAllBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingVertical: 15, borderRadius: 999, alignItems: 'center' },
    scanAllBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.06)', ...RivalButtonColors.noGradient },
    scanAllBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontSize: 15.5, fontWeight: '800' },

    resultsSection: { gap: 10 },
    resultRowCard: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: RivalColors.surfaceBright, gap: 10 },
    resultLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary },
    resultStatusPending: { fontSize: 13, color: RivalWarm.muted },
    resultStatusError: { fontSize: 12.5, color: '#ff8f8f', fontWeight: '600', flexShrink: 1, textAlign: 'right' },
    resultNameInput: {
      flex: 1, backgroundColor: RivalWarm.field, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: '#fff', fontSize: 15, fontWeight: '700', borderWidth: 0,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    resultPhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,209,190,0.28)' },
    resultPhotoBtnText: { fontSize: 12.5, fontWeight: '800', color: RivalColors.accentText },

    doneBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingVertical: 15, borderRadius: 999, alignItems: 'center', marginTop: 6 },
    doneBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontSize: 15.5, fontWeight: '800' },
  }),
};

const mx = StyleSheet.create({
  dayCount: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  savedName: { flexShrink: 1, fontFamily: rm.serifTitle.fontFamily, fontStyle: 'italic', fontSize: 18, fontWeight: '700', color: '#fff' },
  effortTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,209,190,0.12)' },
  effortTagText: { fontSize: 11.5, fontWeight: '800', color: RivalColors.accentText },
});
