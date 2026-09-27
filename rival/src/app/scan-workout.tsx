import { defaultActivityName } from '../lib/activityName';
import { fitPhoto } from '../lib/imageResize';
import { useState, useCallback, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Image, Platform, ActivityIndicator, TextInput, useWindowDimensions } from 'react-native';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase, getAuthUser } from '../lib/supabase';
import { calculateEffortScore, loadScoringConfig } from '../lib/effort';
import { isoToDisplayDate, displayToIsoDate } from '../lib/dateFormat';
import { findMatchingRaceId } from '../lib/raceMatch';
import { RivalColors, RivalRadius, RivalButtonColors } from '../constants/rivalTheme';
import { RivalIcon, RivalBackButton, RivalDateField, RivalMobileHeader, RivalRowLink, RivalWarm, activityIconName, rm } from '../components/rival';
import { MAX_VIDEO_MB as SHARED_MAX_VIDEO_MB } from '../components/rival/MediaPicker';
import { CANONICAL_LIFTS, LIFT_ALIASES, matchCanonicalLift, normalizeLiftName } from '../lib/lifts';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';

type ExtractedWorkout = {
  workoutType: string;
  duration: number;
  distance: number | null;
  elevation: number | null;
  exercises: Array<{
    name: string;
    reps?: number; sets?: number; weight?: number; distanceMeters?: number;
    prescribedReps?: number; prescribedSets?: number; prescribedWeight?: number; prescribedDistanceMeters?: number;
  }>;
  intensity: number;
  notes: string;
};

type MediaItem = { blob: Blob; uri: string; type: 'photo' | 'video'; mimeType: string; ext: string };

const TYPE_OPTIONS: Array<{ type: string; icon: string }> = [
  { type: 'Run', icon: '🏃' },
  { type: 'Ride', icon: '🚴' },
  { type: 'Swim', icon: '🏊' },
  { type: 'Rowing', icon: '🚣' },
  { type: 'WeightTraining', icon: '🏋️' },
  { type: 'CrossFit', icon: '🤸' },
  { type: 'Hyrox', icon: '🔥' },
  { type: 'Bootcamp', icon: '🎽' },
  { type: 'HIIT', icon: '⚡' },
  { type: 'Workout', icon: '💪' },
];

// Class-based formats are almost always a full ~45-60min session even though the
// scanned WOD/board only shows the timed portion (e.g. a 15min WOD inside an hour class).
const CLASS_BASED_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT', 'Bootcamp']);
const CLASS_DURATION_FLOOR_SECONDS = 45 * 60;

function dateToLocalStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Matches races.tsx's finish-time parser — typed directly as "1:31:25" (h:mm:ss) or "31:25" (mm:ss).
function parseTimeToSeconds(t: string): number {
  const parts = t.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function todayLocalStr(): string {
  return dateToLocalStr(new Date());
}

function applyClassDurationFloor(workoutType: string, durationSeconds: number): number {
  if (CLASS_BASED_TYPES.has(workoutType) && durationSeconds > 0 && durationSeconds < 30 * 60) {
    return CLASS_DURATION_FLOOR_SECONDS;
  }
  return durationSeconds;
}

export default function ScanWorkoutScreen() {
  const [scanImages, setScanImages] = useState<Array<{ uri: string; aspectRatio: number }>>([]);
  const [extraMedia, setExtraMedia] = useState<MediaItem[]>([]);
  const [extractedWorkout, setExtractedWorkout] = useState<ExtractedWorkout | null>(null);
  const [userNotes, setUserNotes] = useState('');
  const [loading, setLoading] = useState(false);
  // Split the same way manual-entry.tsx's form is — name/date map to a
  // visible field and render right under it; everything else (capture
  // permission, AI read failures, save failures) is a whole-flow problem
  // shown near the action that triggered it, not a banner pinned over
  // content unrelated to the error.
  const [fieldError, setFieldError] = useState<{ field: 'name' | 'date'; message: string } | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [mediaErrorMsg, setMediaErrorMsg] = useState<string | null>(null);
  // Decoupled from extractedWorkout.distance (a number) so typing "42." doesn't
  // immediately snap back to "42" — Number("42.") === 42, and a controlled input
  // whose value is re-derived from the parsed number on every keystroke can never
  // hold a trailing "." or trailing zeros while the user is still typing.
  const [distanceText, setDistanceText] = useState('');
  // Same decoupling for duration, typed directly as "1:31:25" (h:mm:ss) rather than
  // a separate minutes field + read-only preview — matches the finish-time input on races.tsx.
  const [durationText, setDurationText] = useState('');

  useEffect(() => {
    const current = distanceText.trim() === '' ? null : Number(distanceText);
    if (extractedWorkout?.distance !== current) {
      setDistanceText(extractedWorkout?.distance != null ? String(extractedWorkout.distance) : '');
    }
    // Only re-sync from extractedWorkout — distanceText itself is the typing source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractedWorkout?.distance]);

  useEffect(() => {
    const current = parseTimeToSeconds(durationText);
    if (extractedWorkout?.duration !== current) {
      setDurationText(extractedWorkout?.duration ? formatDurationHMS(extractedWorkout.duration) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractedWorkout?.duration]);

  useEffect(() => {
    if (!generalError) return;
    const t = setTimeout(() => setGeneralError(null), 5000);
    return () => clearTimeout(t);
  }, [generalError]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [savedActivityId, setSavedActivityId] = useState<string | null>(null);
  const [savedHasPhoto, setSavedHasPhoto] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [workoutName, setWorkoutName] = useState('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [distanceUnit, setDistanceUnit] = useState<'m' | 'mi'>('m');
  const [liftTags, setLiftTags] = useState<Record<number, string>>({});
  const [tagPickerIndex, setTagPickerIndex] = useState<number | null>(null);
  const [nameSuggestIndex, setNameSuggestIndex] = useState<number | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [activityDateStr, setActivityDateStr] = useState(() => isoToDisplayDate(todayLocalStr()));
  const [editActivityId, setEditActivityId] = useState<string | null>(null);
  const [editOriginalStartedAt, setEditOriginalStartedAt] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  // Mobile gets the RIVAL look (see RivalMobile.tsx); desktop keeps this
  // screen as it was until the mobile app is finished. Same markup for both —
  // the review form is long and shared — with mobile styles swapped in and
  // emoji replaced by real icons.
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= BREAKPOINT_WIDE_LAYOUT;
  const st = (wide ? styles : mobileStyles) as typeof styles;
  const em = (glyph: string) => (wide ? glyph : '');

  const { activityId: editParamId, mode: entryMode, source: entrySource } = useLocalSearchParams<{ activityId?: string; mode?: string; source?: string }>();

  // Entry-point params from the Add Workout hub. `mode=manual` jumps straight
  // into the manual-entry form; `source=camera|gallery` best-effort auto-opens
  // the picker (native always works; on web the browser may require a tap, in
  // which case the upload buttons are right there as a fallback). Runs once.
  useEffect(() => {
    if (editParamId) return;
    if (entryMode === 'manual') { startManualEntry(); return; }
    if (entrySource === 'camera' || entrySource === 'gallery') { pickImage(entrySource); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editParamId) return;
    setLoadingEdit(true);
    (async () => {
      const { data: activity, error } = await supabase
        .from('activities')
        .select('id, name, activity_type, started_at, duration_seconds, distance_meters, elevation_meters, notes, exercises')
        .eq('id', editParamId)
        .single();
      setLoadingEdit(false);
      if (error || !activity) {
        setGeneralError('Could not load that activity to edit');
        return;
      }
      setEditActivityId(activity.id);
      setEditOriginalStartedAt(activity.started_at);
      setActivityDateStr(isoToDisplayDate(dateToLocalStr(new Date(activity.started_at))));
      setWorkoutName(activity.name || activity.activity_type);
      setUserNotes(activity.notes || '');
      const exercises = (activity.exercises || []) as ExtractedWorkout['exercises'];
      const tags: Record<number, string> = {};
      exercises.forEach((ex: any, i: number) => { if (ex.prLift) tags[i] = ex.prLift; });
      setLiftTags(tags);
      setExtractedWorkout({
        workoutType: activity.activity_type,
        duration: activity.duration_seconds || 0,
        distance: activity.distance_meters ? activity.distance_meters / 1000 : null,
        elevation: activity.elevation_meters || null,
        exercises,
        intensity: 50,
        notes: activity.notes || '',
      });
    })();
  }, [editParamId]);

  const KG_PER_LB = 0.453592;
  const M_PER_MI = 1609.34;

  function kgToDisplay(kg: number | undefined): string {
    if (kg == null) return '';
    const val = weightUnit === 'lb' ? kg / KG_PER_LB : kg;
    return String(Math.round(val * 10) / 10);
  }

  function displayToKg(value: string): number | undefined {
    if (value.trim() === '') return undefined;
    const num = Number(value);
    return weightUnit === 'lb' ? num * KG_PER_LB : num;
  }

  function metersToDisplay(m: number | undefined): string {
    if (m == null) return '';
    const val = distanceUnit === 'mi' ? m / M_PER_MI : m;
    return String(Math.round(val * 100) / 100);
  }

  function displayToMeters(value: string): number | undefined {
    if (value.trim() === '') return undefined;
    const num = Number(value);
    return distanceUnit === 'mi' ? num * M_PER_MI : num;
  }

  function resetForNewImage() {
    setExtraMedia([]);
    setExtractedWorkout(null);
    setWorkoutName('');
    setUserNotes('');
    setFieldError(null);
    setGeneralError(null);
    setSuccessMsg(null);
    setActivityDateStr(isoToDisplayDate(todayLocalStr()));
    setEditActivityId(null);
    setEditOriginalStartedAt(null);
    setLiftTags({});
  }

  function startManualEntry() {
    resetForNewImage();
    setExtractedWorkout({
      workoutType: 'Workout',
      duration: 0,
      distance: null,
      elevation: null,
      exercises: [],
      intensity: 50,
      notes: '',
    });
    setWorkoutName('');
  }

  async function pickImage(source: 'camera' | 'gallery') {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        resetForNewImage();

        const readFile = (file: File) => new Promise<{ dataUri: string; base64: string; mimeType: string; w: number; h: number }>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUri = e.target?.result as string;
            const base64 = dataUri.split(',')[1];
            const mimeType = file.type || 'image/jpeg';
            const img = document.createElement('img');
            img.onload = () => resolve({ dataUri, base64, mimeType, w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ dataUri, base64, mimeType, w: 1, h: 1 });
            img.src = dataUri;
          };
          reader.readAsDataURL(file);
        });

        const results = await Promise.all(files.map(readFile));
        setScanImages(results.map(r => ({ uri: r.dataUri, aspectRatio: r.w / r.h })));

        await analyzeImages(results.map(r => ({ base64Image: r.base64, mediaType: r.mimeType })));
      };
      input.click();
      return;
    }

    // Native (iOS/Android)
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setGeneralError(source === 'camera' ? 'Camera access is required to take a photo.' : 'Photo library access is required to upload a photo.');
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true, allowsMultipleSelection: true });

    if (result.canceled || !result.assets?.length) return;

    resetForNewImage();

    setScanImages(result.assets.map(a => ({
      uri: a.uri,
      aspectRatio: a.width && a.height ? a.width / a.height : 1,
    })));

    const imagesForAnalysis = result.assets
      .filter(a => a.base64)
      .map(a => ({ base64Image: a.base64!, mediaType: a.mimeType || 'image/jpeg' }));

    if (imagesForAnalysis.length > 0) {
      await analyzeImages(imagesForAnalysis);
    } else {
      setGeneralError('Could not read the photo. Try again.');
    }
  }

  const MAX_PHOTOS = 2;
  const MAX_VIDEOS = 1;
  const MAX_PHOTO_MB = 15;
  // Shared with MediaPicker, which matches the storage bucket's own limit.
  const MAX_VIDEO_MB = SHARED_MAX_VIDEO_MB;

  function checkMediaLimits(
    type: 'photo' | 'video',
    sizeMb: number,
    photoCount: number,
    videoCount: number
  ): string | null {
    if (type === 'video' && sizeMb > MAX_VIDEO_MB) return `Video too large (max ${MAX_VIDEO_MB}MB)`;
    if (type === 'photo' && sizeMb > MAX_PHOTO_MB) return `Photo too large (max ${MAX_PHOTO_MB}MB)`;
    if (type === 'photo' && photoCount >= MAX_PHOTOS) return `Max ${MAX_PHOTOS} photos per workout`;
    if (type === 'video' && videoCount >= MAX_VIDEOS) return `Max ${MAX_VIDEOS} video per workout`;
    return null;
  }

  function pickExtraMedia() {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = true;
      input.onchange = () => {
        const files = Array.from(input.files || []);
        setMediaErrorMsg(null);
        setExtraMedia((prev) => {
          let photoCount = 0;
          let videoCount = 0;
          prev.forEach((m) => (m.type === 'video' ? videoCount++ : photoCount++));

          const accepted: MediaItem[] = [];
          for (const file of files) {
            const type: 'photo' | 'video' = file.type.startsWith('video') ? 'video' : 'photo';
            const sizeMb = file.size / (1024 * 1024);
            const rejection = checkMediaLimits(type, sizeMb, photoCount, videoCount);
            if (rejection) { setMediaErrorMsg(rejection); continue; }

            const uri = URL.createObjectURL(file);
            const ext = file.name.split('.').pop() || (type === 'video' ? 'mp4' : 'jpg');
            accepted.push({ blob: file, uri, type, mimeType: file.type, ext });
            if (type === 'video') videoCount++; else photoCount++;
          }

          return [...prev, ...accepted];
        });
      };
      input.click();
      return;
    }

    // Native (iOS/Android)
    pickExtraMediaNative();
  }

  async function pickExtraMediaNative() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMediaErrorMsg('Photo library access is needed to add photos/videos');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;
    setMediaErrorMsg(null);

    let photoCount = extraMedia.filter((m) => m.type === 'photo').length;
    let videoCount = extraMedia.filter((m) => m.type === 'video').length;

    const accepted: MediaItem[] = [];
    for (const asset of result.assets) {
      const type: 'photo' | 'video' = asset.type === 'video' ? 'video' : 'photo';
      const blob = await (await fetch(asset.uri)).blob();
      const sizeMb = blob.size / (1024 * 1024);
      const rejection = checkMediaLimits(type, sizeMb, photoCount, videoCount);
      if (rejection) { setMediaErrorMsg(rejection); continue; }

      const mimeType = asset.mimeType || (type === 'video' ? 'video/mp4' : 'image/jpeg');
      const ext = asset.fileName?.split('.').pop() || (type === 'video' ? 'mp4' : 'jpg');
      accepted.push({ blob, uri: asset.uri, type, mimeType, ext });
      if (type === 'video') videoCount++; else photoCount++;
    }

    setExtraMedia((prev) => [...prev, ...accepted]);
  }

  function removeExtraMedia(index: number) {
    setExtraMedia((prev) => prev.filter((_, i) => i !== index));
  }

  async function analyzeImages(images: Array<{ base64Image: string; mediaType: string }>) {
    setAnalyzing(true);
    setGeneralError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/scan-workout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ images }),
      });

      const data = await response.json();

      if (!response.ok || !data.workout) {
        setGeneralError(data.error || 'Could not read the workout image. Try a clearer photo.');
        return;
      }

      const detectedType = data.workout.workoutType || 'Workout';
      setExtractedWorkout({
        workoutType: detectedType,
        duration: applyClassDurationFloor(detectedType, data.workout.duration || 0),
        distance: data.workout.distance ?? null,
        elevation: data.workout.elevation ?? null,
        exercises: data.workout.exercises || [],
        intensity: data.workout.intensity ?? 50,
        notes: data.workout.notes || '',
      });
      setWorkoutName(data.workout.workoutType || 'Workout');
    } catch (err) {
      console.error('Analysis failed:', err);
      setGeneralError('Could not read the workout image. Try a clearer photo.');
    } finally {
      setAnalyzing(false);
    }
  }

  function getPrescribedComparisons(ex: ExtractedWorkout['exercises'][number], index: number) {
    // Only compare against a genuine Rx standard the AI detected in the photo itself —
    // never against the originally-scanned value, otherwise correcting an AI mistake
    // (e.g. Bike misread as Row) gets mislabeled as "scaling".
    const comparisons: Array<{ label: string; wentAbove: boolean }> = [];

    if (ex.prescribedWeight != null && ex.weight != null && ex.prescribedWeight !== ex.weight) {
      const above = ex.weight > ex.prescribedWeight;
      comparisons.push({
        label: above
          ? `${kgToDisplay(ex.weight)}${weightUnit} weight — went above Rx`
          : `Scaled to ${kgToDisplay(ex.weight)}${weightUnit} weight`,
        wentAbove: above,
      });
    }

    if (ex.prescribedReps != null && ex.reps != null && ex.prescribedReps !== ex.reps) {
      const above = ex.reps > ex.prescribedReps;
      comparisons.push({
        label: above ? `${ex.reps} reps — went above Rx` : `Scaled to ${ex.reps} reps`,
        wentAbove: above,
      });
    }

    if (ex.prescribedSets != null && ex.sets != null && ex.prescribedSets !== ex.sets) {
      const above = ex.sets > ex.prescribedSets;
      comparisons.push({
        label: above ? `${ex.sets} sets — went above Rx` : `Scaled to ${ex.sets} sets`,
        wentAbove: above,
      });
    }

    if (ex.prescribedDistanceMeters != null && ex.distanceMeters != null && ex.prescribedDistanceMeters !== ex.distanceMeters) {
      const above = ex.distanceMeters > ex.prescribedDistanceMeters;
      comparisons.push({
        label: above
          ? `${metersToDisplay(ex.distanceMeters)}${distanceUnit} — went above Rx`
          : `Scaled to ${metersToDisplay(ex.distanceMeters)}${distanceUnit}`,
        wentAbove: above,
      });
    }

    return comparisons;
  }

  function updateExercise(index: number, field: 'sets' | 'reps' | 'weight' | 'distanceMeters', value: string) {
    if (!extractedWorkout) return;
    const num = value.trim() === '' ? undefined : Number(value);
    const updatedExercises = extractedWorkout.exercises.map((ex, i) =>
      i === index ? { ...ex, [field]: num } : ex
    );
    setExtractedWorkout({ ...extractedWorkout, exercises: updatedExercises });
  }

  function updateExerciseName(index: number, value: string) {
    if (!extractedWorkout) return;
    const updatedExercises = extractedWorkout.exercises.map((ex, i) =>
      i === index ? { ...ex, name: value } : ex
    );
    setExtractedWorkout({ ...extractedWorkout, exercises: updatedExercises });
  }

  // Canonical-lift suggestions for the name field: match the typed text against each
  // canonical lift's name and its aliases, so "shoulder" surfaces "Overhead Press".
  // Returns [] once the name already resolves exactly to a canonical lift.
  function liftSuggestions(input: string): string[] {
    const q = normalizeLiftName(input || '');
    if (!q || matchCanonicalLift(input)) return [];
    return CANONICAL_LIFTS.filter((lift) =>
      normalizeLiftName(lift).includes(q) ||
      (LIFT_ALIASES[lift] || []).some((a) => normalizeLiftName(a).includes(q))
    ).slice(0, 6);
  }

  // Full canonical-lift filter for the searchable tag picker (empty query = all).
  function filterCanonicalLifts(query: string): string[] {
    const q = normalizeLiftName(query || '');
    if (!q) return CANONICAL_LIFTS;
    return CANONICAL_LIFTS.filter((lift) =>
      normalizeLiftName(lift).includes(q) ||
      (LIFT_ALIASES[lift] || []).some((a) => normalizeLiftName(a).includes(q))
    );
  }

  function addExercise() {
    if (!extractedWorkout) return;
    setExtractedWorkout({
      ...extractedWorkout,
      exercises: [...extractedWorkout.exercises, { name: '' }],
    });
  }

  function removeExercise(index: number) {
    if (!extractedWorkout) return;
    setExtractedWorkout({
      ...extractedWorkout,
      exercises: extractedWorkout.exercises.filter((_, i) => i !== index),
    });
    setLiftTags((prev) => {
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i < index) next[i] = v;
        else if (i > index) next[i - 1] = v;
      }
      return next;
    });
    if (tagPickerIndex === index) setTagPickerIndex(null);
  }

  async function saveWorkout() {
    if (!extractedWorkout) return;

    setLoading(true);
    setFieldError(null);
    setGeneralError(null);
    try {
      const { data: { user } } = await getAuthUser();
      if (!user) return;

      const durationMinutes = extractedWorkout.duration / 60;
      const effortScore = calculateEffortScore(
        extractedWorkout.workoutType,
        extractedWorkout.duration,
        extractedWorkout.elevation || 0,
        await loadScoringConfig(),
      );

      const isoDate = displayToIsoDate(activityDateStr);
      if (!isoDate) {
        setFieldError({ field: 'date', message: 'Enter a valid date' });
        setLoading(false);
        return;
      }
      const [y, m, d] = isoDate.split('-').map(Number);
      const reference = editOriginalStartedAt ? new Date(editOriginalStartedAt) : new Date();
      const startedAt = new Date(y, m - 1, d, reference.getHours(), reference.getMinutes(), reference.getSeconds());
      const name = workoutName.trim() || defaultActivityName(extractedWorkout.workoutType, reference);

      const exercisesPayload = extractedWorkout.exercises.length > 0
        ? extractedWorkout.exercises.map((ex, i) => liftTags[i] ? { ...ex, prLift: liftTags[i] } : ex)
        : null;

      const raceId = await findMatchingRaceId(user.id, startedAt.toISOString());

      const activityPayload = {
        user_id: user.id,
        name,
        activity_type: extractedWorkout.workoutType,
        distance_meters: extractedWorkout.distance ? extractedWorkout.distance * 1000 : 0,
        duration_seconds: extractedWorkout.duration,
        elevation_meters: extractedWorkout.elevation || 0,
        started_at: startedAt.toISOString(),
        effort_score: effortScore,
        raw_effort_score: effortScore,
        notes: userNotes.trim() || null,
        exercises: exercisesPayload,
        race_id: raceId,
      };

      let activityId: string;
      if (editActivityId) {
        const { error } = await supabase.from('activities').update(activityPayload).eq('id', editActivityId);
        if (error) {
          if (error.message.includes('activities_started_at_not_future')) {
            setFieldError({ field: 'date', message: "Future dates can't be logged. Choose today or an earlier date." });
          } else {
            setGeneralError(`Save failed: ${error.message}`);
          }
          return;
        }
        activityId = editActivityId;
        // If the old rows can't be cleared, re-inserting below would DOUBLE the
        // athlete's lifts for this workout and corrupt their PR history, so stop
        // rather than press on.
        const { error: clearErr } = await supabase.from('exercise_entries').delete().eq('activity_id', activityId);
        if (clearErr) {
          setGeneralError(`Couldn't update lifts: ${clearErr.message}`);
          return;
        }
      } else {
        const { data: inserted, error } = await supabase
          .from('activities')
          .insert({ ...activityPayload, provider: 'rival_scan', provider_activity_id: `scan-${Date.now()}` })
          .select('id')
          .single();

        if (error || !inserted) {
          if (error?.message?.includes('activities_started_at_not_future')) {
            setFieldError({ field: 'date', message: "Future dates can't be logged. Choose today or an earlier date." });
          } else {
            setGeneralError(`Save failed: ${error?.message ?? 'unknown error'}`);
          }
          return;
        }
        activityId = inserted.id;
      }

      const liftEntries = extractedWorkout.exercises
        .map((ex, i) => ({
          user_id: user.id,
          activity_id: activityId,
          // Use the canonical name when we recognise the lift (so it groups with
          // existing PR history); otherwise fall back to the user's own name,
          // title-cased. Previously non-canonical lifts were dropped entirely, so
          // manually-entered lifts (e.g. "shoulder press") never reached the PR tracker.
          exercise_name: matchCanonicalLift(ex.name) || liftTags[i]
            || (ex.name ? ex.name.trim().replace(/\b\w/g, c => c.toUpperCase()) : null),
          weight_kg: ex.weight,
          reps: ex.reps ?? null,
          performed_at: startedAt.toISOString(),
        }))
        .filter((e) => !!e.weight_kg && !!e.exercise_name);
      if (liftEntries.length > 0) {
        const { error: liftErr } = await supabase.from('exercise_entries').insert(liftEntries);
        // The activity itself is already saved, so this is reported rather than
        // fatal -- but silently dropping the lifts would leave the PR tracker
        // quietly wrong.
        if (liftErr) setGeneralError(`Workout saved, but the lifts didn't attach: ${liftErr.message}`);
      }

      // Only photos/videos added in the "Photos & Videos" section get stored and shown
      // in the feed — the workout-data scan photos are used for AI extraction only.
      let firstPhotoUrl: string | null = null;

      for (let i = 0; i < extraMedia.length; i++) {
        const item = extraMedia[i];
        const up = await fitPhoto({ blob: item.blob, mimeType: item.mimeType, ext: item.ext });
        const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = `${user.id}/${activityId}-${uniqueId}.${up.ext}`;

        const { error: storageErr } = await supabase.storage
          .from('activity-photos')
          .upload(path, up.blob, { contentType: up.mimeType, upsert: true });

        if (storageErr) {
          console.error('Media upload failed:', storageErr.message);
          continue;
        }

        const { data: urlData } = supabase.storage.from('activity-photos').getPublicUrl(path);

        const { error: mediaErr } = await supabase.from('activity_media').insert({
          activity_id: activityId,
          media_url: urlData.publicUrl,
          media_type: item.type,
        });
        if (mediaErr) { console.error('Media row insert failed:', mediaErr.message); continue; }

        if (item.type === 'photo' && !firstPhotoUrl) {
          firstPhotoUrl = urlData.publicUrl;
        }
      }

      if (firstPhotoUrl) {
        const { error: coverErr } = await supabase.from('activities').update({ photo_url: firstPhotoUrl }).eq('id', activityId);
        if (coverErr) setGeneralError(`Workout saved, but the cover photo didn't set: ${coverErr.message}`);
      }

      setSuccessMsg(`${name} saved with ${Math.round(effortScore)} Effort.`);
      setSavedActivityId(activityId);
      setSavedHasPhoto(!!firstPhotoUrl);
      // Check milestones fire-and-forget
      const { data: { session: ms } } = await supabase.auth.getSession();
      if (ms) fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ms.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
      }).catch(() => {});
      // If they added a photo, let them AI-enhance it before leaving; otherwise
      // head back to the feed automatically.
      if (!firstPhotoUrl) setTimeout(() => goToTab('/my-activities'), 1200);
    } catch (err) {
      console.error('Save failed:', err);
      setGeneralError('Failed to save workout');
    } finally {
      setLoading(false);
    }
  }

  function formatDurationHMS(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return (
    <SafeAreaView style={st.container}>
      <ScrollView contentContainerStyle={st.content}>

        {wide ? (
          <>
            <View style={st.header}>
              <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : goToTab('/my-activities'))} color={RivalColors.accentFill} />
            </View>
            <Text style={st.title}>{editActivityId ? 'Edit Activity' : 'Scan Workout'}</Text>
          </>
        ) : (
          <RivalMobileHeader
            title={editActivityId ? 'Edit activity' : 'Scan workout'}
            onBack={() => (router.canGoBack() ? router.back() : goToTab('/my-activities'))}
          />
        )}
        {loadingEdit && <Text style={st.subtitle}>Loading…</Text>}

        {successMsg && (
          <View style={st.successBanner}>
            <Text style={st.successBannerText}>{em('✓ ')}{successMsg}</Text>
            {savedActivityId && savedHasPhoto && (
              <View style={st.enhanceCta}>
                <TouchableOpacity
                  style={st.enhanceBtn}
                  onPress={() => router.replace(`/ai-share?activityId=${savedActivityId}`)}
                >
                  {!wide ? <RivalIcon name="ai" size={16} color={st.enhanceBtnText.color as string} /> : null}
                  <Text style={st.enhanceBtnText}>{em('✨ ')}Enhance photo with AI</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => goToTab('/my-activities')}>
                  <Text style={st.enhanceDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {scanImages.length === 0 && !extractedWorkout && !editParamId && !wide ? (
          // Mobile: the same hero as Add workout, so arriving here from a
          // cancelled camera reads as the same place, not a new screen.
          <View style={{ gap: 14 }}>
            <View style={rm.hero}>
              <View style={mx.heroTop}>
                <View style={rm.iconCircle}>
                  <RivalIcon name="scan" size={20} color={RivalColors.accentText} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={rm.serifTitleSm}>Photo scan</Text>
                </View>
              </View>
              <Text style={rm.hint}>Capture a workout card, whiteboard or app screenshot. Add several photos if one activity spans more than one. Each day is scanned separately.</Text>
              <View style={mx.steps}>
                {['Capture or upload', 'Details extracted automatically', 'Review and save'].map((t, i) => (
                  <View key={t} style={mx.step}>
                    <View style={mx.stepNum}><Text style={mx.stepNumText}>{i + 1}</Text></View>
                    <Text style={mx.stepText}>{t}</Text>
                  </View>
                ))}
              </View>
              <View style={mx.actions}>
                <TouchableOpacity style={[rm.primary, { flex: 1 }]} onPress={() => pickImage('camera')} activeOpacity={0.85}>
                  <RivalIcon name="camera" size={18} color={rm.primaryText.color as string} />
                  <Text style={rm.primaryText} numberOfLines={1}>Take photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[rm.ghost, { flex: 1 }]} onPress={() => pickImage('gallery')} activeOpacity={0.85}>
                  <RivalIcon name="upload" size={18} color={RivalColors.accentText} />
                  <Text style={rm.ghostText} numberOfLines={1}>Upload</Text>
                </TouchableOpacity>
              </View>
              {generalError && <Text style={rm.error}>{generalError}</Text>}
            </View>
            <RivalRowLink icon="manual" title="Manual entry" body="Enter duration, distance and lifts" onPress={() => router.push('/manual-entry')} />
            <RivalRowLink icon="batch" title="Weekly scan" body="Log multiple days at once" onPress={() => router.push('/weekly-scan')} />
          </View>
        ) : scanImages.length === 0 && !extractedWorkout && !editParamId ? (
          <View style={st.uploadArea}>
            <Text style={st.uploadIcon}>📸</Text>
            <Text style={st.uploadTitle}>Add Workout</Text>
            <Text style={st.uploadSub}>
              Photo from your training app, gym whiteboard, or workout card — select multiple if your workout spans a few photos
            </Text>

            <View style={st.howItWorksCard}>
              <Text style={st.howItWorksTitle}>How it works</Text>
              <View style={st.howItWorksRow}>
                <Text style={st.howItWorksNum}>1</Text>
                <Text style={st.howItWorksText}>Upload one or more photos of a single workout. Each day needs its own scan.</Text>
              </View>
              <View style={st.howItWorksRow}>
                <Text style={st.howItWorksNum}>2</Text>
                <Text style={st.howItWorksText}>The details are extracted automatically</Text>
              </View>
              <View style={st.howItWorksRow}>
                <Text style={st.howItWorksNum}>3</Text>
                <Text style={st.howItWorksText}>Review and save.</Text>
              </View>
            </View>

            <View style={st.buttonRow}>
              <TouchableOpacity style={st.uploadBtn} onPress={() => pickImage('camera')}>
                <Text style={st.uploadBtnText}>📷 Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.uploadBtn} onPress={() => pickImage('gallery')}>
                <Text style={st.uploadBtnText}>📁 Upload</Text>
              </TouchableOpacity>
            </View>
            {generalError && <Text style={st.fieldError}>{em('⚠️ ')}{generalError}</Text>}

            <TouchableOpacity style={st.manualEntryBtn} onPress={() => router.push('/manual-entry')}>
              <Text style={st.manualEntryBtnText}>✏️ Manual Entry</Text>
            </TouchableOpacity>

            <TouchableOpacity style={st.weekScanLinkBtn} onPress={() => router.push('/weekly-scan')}>
              <Text style={st.weekScanLinkBtnText}>📅 Weekly Scan: log multiple days at once</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={st.previewSection}>
            {scanImages.length === 1 && (
              <Image source={{ uri: scanImages[0].uri }} style={[st.image, { aspectRatio: scanImages[0].aspectRatio }]} resizeMode="contain" />
            )}
            {scanImages.length > 1 && (
              <View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.scanImagesRow}>
                  {scanImages.map((img, i) => (
                    <Image key={i} source={{ uri: img.uri }} style={st.scanImageThumb} resizeMode="cover" />
                  ))}
                </ScrollView>
                <Text style={st.scanImagesHint}>{scanImages.length} photos combined into this workout</Text>
              </View>
            )}

            {analyzing ? (
              <View style={st.loadingBox}>
                <ActivityIndicator color={RivalColors.accentFill} size="large" />
                <Text style={st.loadingText}>Extracting workout details…</Text>
              </View>
            ) : extractedWorkout ? (
              <View style={st.extractedBox}>
                <Text style={st.extractedLabel}>Workout Details</Text>

                <View style={st.typeFieldBox}>
                  <Text style={st.fieldLabel}>Type</Text>
                  <View style={st.typeChipRow}>
                    {TYPE_OPTIONS.map((opt) => {
                      const selected = extractedWorkout.workoutType === opt.type;
                      return (
                        <TouchableOpacity
                          key={opt.type}
                          style={[st.typeChip, selected && st.typeChipSelected]}
                          onPress={() => setExtractedWorkout({
                            ...extractedWorkout,
                            workoutType: opt.type,
                            duration: applyClassDurationFloor(opt.type, extractedWorkout.duration),
                          })}
                        >
                          {wide ? <Text style={st.typeChipIcon}>{opt.icon}</Text> : <RivalIcon name={activityIconName(opt.type)} size={15} color={selected ? RivalButtonColors.label(RivalColors.onAccentFill) : RivalColors.textSecondary} />}
                          <Text style={[st.typeChipText, selected && st.typeChipTextSelected]}>{opt.type}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={st.fieldRow}>
                  <Text style={st.fieldLabel}>Duration:</Text>
                  <TextInput
                    style={st.fieldValueInput}
                    value={durationText}
                    onChangeText={(v) => {
                      setDurationText(v);
                      setExtractedWorkout({ ...extractedWorkout, duration: parseTimeToSeconds(v) });
                    }}
                    placeholder="1:31:25"
                    placeholderTextColor={RivalColors.textSecondary}
                    autoCapitalize="none"
                  />
                </View>
                {CLASS_BASED_TYPES.has(extractedWorkout.workoutType) && (
                  <Text style={st.classDurationHint}>
                    CrossFit/Hyrox/HIIT classes usually run 45-60 min total — make sure this includes warm-up & skill work, not just the timed WOD.
                  </Text>
                )}

                <View style={st.fieldRow}>
                  <Text style={st.fieldLabel}>Distance (km):</Text>
                  <TextInput
                    style={st.fieldValueInput}
                    value={distanceText}
                    onChangeText={(v) => {
                      setDistanceText(v);
                      const km = v.trim() === '' ? null : Number(v);
                      if (!Number.isNaN(km)) setExtractedWorkout({ ...extractedWorkout, distance: km });
                    }}
                    placeholder="0"
                    placeholderTextColor={RivalColors.textSecondary}
                    keyboardType="decimal-pad"
                  />
                </View>

                <View style={st.fieldRow}>
                  <Text style={st.fieldLabel}>Elevation (m):</Text>
                  <TextInput
                    style={st.fieldValueInput}
                    value={extractedWorkout.elevation != null ? String(extractedWorkout.elevation) : ''}
                    onChangeText={(v) => {
                      const m = v.trim() === '' ? null : Number(v);
                      setExtractedWorkout({ ...extractedWorkout, elevation: m });
                    }}
                    placeholder="0"
                    placeholderTextColor={RivalColors.textSecondary}
                    keyboardType="numeric"
                  />
                </View>

                {(
                  <View style={st.exercisesBox}>
                    <View style={st.exercisesHeaderRow}>
                      <Text style={st.exercisesLabel}>Exercises ({extractedWorkout.exercises.length})</Text>
                      <View style={st.unitTogglesRow}>
                        <View style={st.unitToggle}>
                          <TouchableOpacity
                            style={[st.unitToggleBtn, weightUnit === 'kg' && st.unitToggleBtnActive]}
                            onPress={() => setWeightUnit('kg')}
                          >
                            <Text style={[st.unitToggleText, weightUnit === 'kg' && st.unitToggleTextActive]}>kg</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[st.unitToggleBtn, weightUnit === 'lb' && st.unitToggleBtnActive]}
                            onPress={() => setWeightUnit('lb')}
                          >
                            <Text style={[st.unitToggleText, weightUnit === 'lb' && st.unitToggleTextActive]}>lb</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={st.unitToggle}>
                          <TouchableOpacity
                            style={[st.unitToggleBtn, distanceUnit === 'm' && st.unitToggleBtnActive]}
                            onPress={() => setDistanceUnit('m')}
                          >
                            <Text style={[st.unitToggleText, distanceUnit === 'm' && st.unitToggleTextActive]}>m</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[st.unitToggleBtn, distanceUnit === 'mi' && st.unitToggleBtnActive]}
                            onPress={() => setDistanceUnit('mi')}
                          >
                            <Text style={[st.unitToggleText, distanceUnit === 'mi' && st.unitToggleTextActive]}>mi</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>

                    {extractedWorkout.exercises.map((ex, i) => {
                      const comparisons = getPrescribedComparisons(ex, i);
                      return (
                        <View key={i} style={st.exerciseEditRow}>
                          <View style={st.exerciseNameRow}>
                            <TextInput
                              style={[st.exerciseNameInput, { flex: 1 }]}
                              value={ex.name}
                              onChangeText={(v) => updateExerciseName(i, v)}
                              onFocus={() => setNameSuggestIndex(i)}
                              onBlur={() => setTimeout(() => setNameSuggestIndex((cur) => (cur === i ? null : cur)), 150)}
                              placeholder="Exercise name"
                              placeholderTextColor={RivalColors.textSecondary}
                            />
                            <TouchableOpacity style={st.removeExerciseBtn} onPress={() => removeExercise(i)}>
                              {wide ? <Text style={st.removeExerciseBtnText}>✕</Text> : <RivalIcon name="close" size={15} color={RivalWarm.muted} />}
                            </TouchableOpacity>
                          </View>
                          {nameSuggestIndex === i && liftSuggestions(ex.name).length > 0 && (
                            <View style={st.nameSuggestBox}>
                              {liftSuggestions(ex.name).map((s) => (
                                <TouchableOpacity
                                  key={s}
                                  style={st.nameSuggestItem}
                                  onPress={() => { updateExerciseName(i, s); setNameSuggestIndex(null); }}
                                >
                                  <Text style={st.nameSuggestText}>{s}</Text>
                                  <Text style={st.nameSuggestHint}>PB tracked</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                          <View style={st.exerciseFieldsRow}>
                            <View style={st.exerciseFieldBox}>
                              <Text style={st.exerciseFieldLabel}>Sets</Text>
                              <TextInput
                                style={st.exerciseFieldInput}
                                value={ex.sets != null ? String(ex.sets) : ''}
                                onChangeText={(v) => updateExercise(i, 'sets', v)}
                                placeholder="-"
                                placeholderTextColor={RivalColors.textSecondary}
                                keyboardType="numeric"
                              />
                            </View>
                            <View style={st.exerciseFieldBox}>
                              <Text style={st.exerciseFieldLabel}>Reps</Text>
                              <TextInput
                                style={st.exerciseFieldInput}
                                value={ex.reps != null ? String(ex.reps) : ''}
                                onChangeText={(v) => updateExercise(i, 'reps', v)}
                                placeholder="-"
                                placeholderTextColor={RivalColors.textSecondary}
                                keyboardType="numeric"
                              />
                            </View>
                            <View style={st.exerciseFieldBox}>
                              <Text style={st.exerciseFieldLabel} numberOfLines={1}>Weight ({weightUnit})</Text>
                              <TextInput
                                style={st.exerciseFieldInput}
                                value={kgToDisplay(ex.weight)}
                                onChangeText={(v) => {
                                  if (!extractedWorkout) return;
                                  const kg = displayToKg(v);
                                  const updated = extractedWorkout.exercises.map((e, idx) =>
                                    idx === i ? { ...e, weight: kg } : e
                                  );
                                  setExtractedWorkout({ ...extractedWorkout, exercises: updated });
                                }}
                                placeholder="-"
                                placeholderTextColor={RivalColors.textSecondary}
                                keyboardType="numeric"
                              />
                            </View>
                            <View style={st.exerciseFieldBox}>
                              <Text style={st.exerciseFieldLabel} numberOfLines={1}>Distance ({distanceUnit})</Text>
                              <TextInput
                                style={st.exerciseFieldInput}
                                value={metersToDisplay(ex.distanceMeters)}
                                onChangeText={(v) => {
                                  if (!extractedWorkout) return;
                                  const meters = displayToMeters(v);
                                  const updated = extractedWorkout.exercises.map((e, idx) =>
                                    idx === i ? { ...e, distanceMeters: meters } : e
                                  );
                                  setExtractedWorkout({ ...extractedWorkout, exercises: updated });
                                }}
                                placeholder="-"
                                placeholderTextColor={RivalColors.textSecondary}
                                keyboardType="numeric"
                              />
                            </View>
                          </View>

                          {matchCanonicalLift(ex.name) ? (
                            <Text style={st.liftAutoTrackedText}>{em('✓ ')}PB tracked as {matchCanonicalLift(ex.name)}</Text>
                          ) : liftTags[i] ? (
                            <View style={st.liftTagChip}>
                              <Text style={st.liftTagChipText}>{em('🏷️ ')}PB tracked as {liftTags[i]}</Text>
                              <TouchableOpacity onPress={() => setLiftTags((prev) => { const next = { ...prev }; delete next[i]; return next; })}>
                                {wide ? <Text style={st.liftTagRemove}>✕</Text> : <RivalIcon name="close" size={13} color={RivalColors.accentText} />}
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={st.tagLiftBtn}
                              onPress={() => { setTagSearch(''); setTagPickerIndex(tagPickerIndex === i ? null : i); }}
                            >
                              <Text style={st.tagLiftBtnText}>{em('🏷️ ')}Tag a lift PB from this exercise</Text>
                            </TouchableOpacity>
                          )}

                          {tagPickerIndex === i && (
                            <View style={st.liftPickerBox}>
                              <TextInput
                                style={st.liftSearchInput}
                                value={tagSearch}
                                onChangeText={setTagSearch}
                                placeholder="Search lifts…"
                                placeholderTextColor={RivalColors.textSecondary}
                                autoFocus
                              />
                              <View style={st.liftPickerRow}>
                                {filterCanonicalLifts(tagSearch).map((lift) => (
                                  <TouchableOpacity
                                    key={lift}
                                    style={st.liftPickerChip}
                                    onPress={() => {
                                      setLiftTags((prev) => ({ ...prev, [i]: lift }));
                                      setTagPickerIndex(null);
                                    }}
                                  >
                                    <Text style={st.liftPickerChipText}>{lift}</Text>
                                  </TouchableOpacity>
                                ))}
                                {filterCanonicalLifts(tagSearch).length === 0 && (
                                  <Text style={st.noExercisesHint}>No matching lifts</Text>
                                )}
                              </View>
                            </View>
                          )}

                          {comparisons.map((c, ci) => (
                            <Text key={ci} style={[st.prescribedNote, c.wentAbove ? st.prescribedAbove : st.prescribedScaled]}>
                              {/* Labels are built with a leading 🔥/💪; the colour
                                  already says above-Rx or scaled, so mobile drops it. */}
                              {wide ? c.label : c.label.replace(/^\S+\s/, '')}
                            </Text>
                          ))}
                        </View>
                      );
                    })}

                    {extractedWorkout.exercises.length === 0 && (
                      <Text style={st.noExercisesHint}>No exercises added yet</Text>
                    )}

                    <TouchableOpacity style={st.addExerciseBtn} onPress={addExercise}>
                      <Text style={st.addExerciseBtnText}>+ Add Exercise</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={st.nameInputBox}>
                  <Text style={st.nameLabel}>Workout Name</Text>
                  <TextInput
                    style={st.nameInput}
                    value={workoutName}
                    onChangeText={(v) => { setWorkoutName(v); if (fieldError?.field === 'name') setFieldError(null); }}
                    placeholder={extractedWorkout ? defaultActivityName(extractedWorkout.workoutType, editOriginalStartedAt ? new Date(editOriginalStartedAt) : new Date()) : 'Morning Run'}
                    placeholderTextColor={RivalColors.textSecondary}
                  />
                  {fieldError?.field === 'name' && <Text style={st.fieldError}>{em('⚠️ ')}{fieldError.message}</Text>}
                </View>

                <View style={st.nameInputBox}>
                  <Text style={st.nameLabel}>Date</Text>
                  <RivalDateField
                    value={activityDateStr}
                    onChangeText={(v) => { setActivityDateStr(v); if (fieldError?.field === 'date') setFieldError(null); }}
                    inputStyle={st.nameInput}
                  />
                  {fieldError?.field === 'date' && <Text style={st.fieldError}>{em('⚠️ ')}{fieldError.message}</Text>}
                </View>

                <View style={st.nameInputBox}>
                  <Text style={st.nameLabel}>Photos & Videos</Text>
                  <Text style={st.mediaHint}>
                    Add a selfie, your view, or a clip — up to {MAX_PHOTOS} photos and {MAX_VIDEOS} video
                  </Text>
                  {mediaErrorMsg && (
                    <Text style={st.mediaErrorText}>{em('⚠️ ')}{mediaErrorMsg}</Text>
                  )}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.mediaRow}>
                    {extraMedia.map((item, i) => (
                      <View key={i} style={st.mediaThumbWrap}>
                        {item.type === 'video' ? (
                          <View style={[st.mediaThumb, st.videoThumbPlaceholder]}>
                            {wide ? <Text style={st.videoThumbIcon}>🎬</Text> : <RivalIcon name="video" size={24} color={RivalColors.accentText} />}
                          </View>
                        ) : (
                          <Image source={{ uri: item.uri }} style={st.mediaThumb} />
                        )}
                        <TouchableOpacity style={st.mediaRemoveBtn} onPress={() => removeExtraMedia(i)}>
                          {wide ? <Text style={st.mediaRemoveText}>✕</Text> : <RivalIcon name="close" size={12} color="#fff" />}
                        </TouchableOpacity>
                      </View>
                    ))}
                    {(() => {
                      const photoCount = extraMedia.filter(m => m.type === 'photo').length;
                      const videoCount = extraMedia.filter(m => m.type === 'video').length;
                      const atLimit = photoCount >= MAX_PHOTOS && videoCount >= MAX_VIDEOS;
                      return !atLimit ? (
                        <TouchableOpacity style={st.mediaAddBtn} onPress={pickExtraMedia}>
                          <Text style={st.mediaAddText}>+ Add</Text>
                        </TouchableOpacity>
                      ) : null;
                    })()}
                  </ScrollView>
                </View>

                <View style={st.nameInputBox}>
                  <Text style={st.nameLabel}>Notes</Text>
                  <TextInput
                    style={[st.nameInput, st.notesInput]}
                    value={userNotes}
                    onChangeText={setUserNotes}
                    placeholder="How did it feel? Share your experience"
                    placeholderTextColor={RivalColors.textSecondary}
                    multiline
                    numberOfLines={3}
                  />
                </View>

                <View style={st.actionRow}>
                  <TouchableOpacity
                    style={st.changeBtn}
                    onPress={() => editActivityId
                      ? goToTab('/my-activities')
                      : (() => { setScanImages([]); setExtractedWorkout(null); setLiftTags({}); setTagPickerIndex(null); })()}
                    disabled={loading}
                  >
                    <Text style={st.changeBtnText}>{editActivityId ? 'Cancel' : scanImages.length > 0 ? 'Change photo' : 'Start over'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={st.saveBtn}
                    onPress={saveWorkout}
                    disabled={loading}
                  >
                    <BusyText busy={loading} style={st.saveBtnText}>
                      {wide ? (loading ? '⏳ Saving…' : '✓ Save Workout') : (loading ? 'Saving…' : 'Save workout')}
                    </BusyText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : generalError ? (
              // The AI read failed with nothing extracted — analyzing is false
              // and extractedWorkout never got set, so without this the screen
              // just went quiet with a photo on it and no visible reason why.
              <View style={st.loadingBox}>
                <Text style={st.fieldError}>{em('⚠️ ')}{generalError}</Text>
                <TouchableOpacity style={st.manualEntryBtn} onPress={() => pickImage('gallery')}>
                  <Text style={st.manualEntryBtnText}>Try a different photo</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  header: { marginBottom: 24 },
  back: { color: RivalColors.accentText, fontSize: 16 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 32 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 16 },
  // Same recipe as manual-entry.tsx's fieldError — sits right under (or
  // beside) whatever it's about, replacing the old fixed top banner.
  fieldError: { color: RivalColors.error, fontSize: 12, fontWeight: '600' },
  successBanner: { backgroundColor: `${RivalColors.success}22`, borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: RivalColors.success },
  successBannerText: { color: RivalColors.success, fontSize: 13, fontWeight: '600' },
  enhanceCta: { marginTop: 12, gap: 8 },
  enhanceBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  enhanceBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontWeight: '800', fontSize: 15 },
  enhanceDoneText: { color: RivalColors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 6 },

  uploadArea: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  uploadIcon: { fontSize: 64 },
  uploadTitle: { fontSize: 24, fontWeight: '800', color: RivalColors.textPrimary },
  uploadSub: { fontSize: 14, color: RivalColors.textSecondary, textAlign: 'center', maxWidth: 280 },
  howItWorksCard: { width: '100%', backgroundColor: RivalColors.surfaceLowest, borderRadius: 14, padding: 14, marginTop: 16, gap: 8, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  howItWorksTitle: { fontSize: 13, fontWeight: '700', color: RivalColors.success, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  howItWorksRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  howItWorksNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: `${RivalColors.accentFill}22`, borderWidth: 1, borderColor: `${RivalColors.accentFill}55`, color: RivalColors.accentText, fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 18 },
  howItWorksText: { flex: 1, fontSize: 13, color: RivalColors.textSecondary, lineHeight: 18 },
  manualEntryBtn: { marginTop: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, alignItems: 'center' },
  weekScanLinkBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  weekScanLinkBtnText: { color: RivalColors.success, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  manualEntryBtnText: { color: RivalColors.textSecondary, fontSize: 14, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  uploadBtn: { flex: 1, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  uploadBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontSize: 15, fontWeight: '700' },

  previewSection: { gap: 16 },
  image: { width: '100%', maxHeight: 420, borderRadius: 14, backgroundColor: RivalColors.surfaceContainerHigh },
  scanImagesRow: { gap: 8 },
  scanImageThumb: { width: 160, height: 220, borderRadius: 12, backgroundColor: RivalColors.surfaceContainerHigh },
  scanImagesHint: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 8, textAlign: 'center' },

  loadingBox: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  loadingText: { color: RivalColors.textSecondary, fontSize: 15 },

  extractedBox: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, gap: 12 },
  extractedLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },

  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceContainerHigh },
  fieldLabel: { fontSize: 13, color: RivalColors.textSecondary, fontWeight: '600' },
  fieldValue: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  fieldValueInput: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary, backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, minWidth: 80, textAlign: 'right' },
  classDurationHint: { fontSize: 12, color: RivalColors.success, backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, padding: 10, marginTop: 6, marginBottom: 8, lineHeight: 17 },

  typeFieldBox: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceContainerHigh, gap: 8 },
  typeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, backgroundColor: RivalColors.surfaceLow, minWidth: 100, flexGrow: 1, flexBasis: '22%' },
  typeChipSelected: { borderColor: RivalColors.accentFill, backgroundColor: `${RivalColors.accentFill}22` },
  typeChipIcon: { fontSize: 14 },
  typeChipText: { fontSize: 13, fontWeight: '600', color: RivalColors.textSecondary },
  typeChipTextSelected: { color: RivalColors.accentText, fontWeight: '700' },

  exercisesBox: { marginTop: 8, gap: 6 },
  exercisesLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.success, textTransform: 'uppercase', letterSpacing: 0.5 },
  exerciseItem: { fontSize: 13, color: RivalColors.textSecondary, marginLeft: 8 },
  prescribedNote: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  prescribedAbove: { color: RivalColors.success },
  prescribedScaled: { color: RivalColors.tertiary },

  liftAutoTrackedText: { fontSize: 11, fontWeight: '700', color: RivalColors.success, marginTop: 6 },
  tagLiftBtn: { marginTop: 6, alignSelf: 'flex-start' },
  tagLiftBtnText: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText },
  liftTagChip: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: `${RivalColors.accentFill}22`, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: RivalColors.accentFill },
  liftTagChipText: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText },
  liftTagRemove: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  liftPickerBox: { marginTop: 8, backgroundColor: RivalColors.surfaceLowest, borderRadius: 10, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, padding: 10 },
  liftSearchInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: RivalColors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  liftPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  liftPickerChip: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  liftPickerChipText: { fontSize: 11, fontWeight: '600', color: RivalColors.textSecondary },
  moreExercises: { fontSize: 12, color: RivalColors.textSecondary, fontStyle: 'italic', marginLeft: 8 },

  exerciseEditRow: { backgroundColor: RivalColors.surfaceLow, borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, gap: 8 },
  exerciseName: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  exerciseNameInput: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary, backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  nameSuggestBox: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceContainer, marginTop: 4, overflow: 'hidden' },
  nameSuggestItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceContainer },
  nameSuggestText: { color: RivalColors.textPrimary, fontSize: 14, fontWeight: '600' },
  nameSuggestHint: { color: RivalColors.success, fontSize: 11, fontWeight: '600' },
  exerciseNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  removeExerciseBtn: { padding: 6 },
  removeExerciseBtnText: { color: RivalColors.textSecondary, fontSize: 14, fontWeight: '700' },
  noExercisesHint: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 12 },
  addExerciseBtn: { marginTop: 8, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: `${RivalColors.accentFill}55`, alignItems: 'center' },
  addExerciseBtnText: { color: RivalColors.accentText, fontSize: 14, fontWeight: '700' },
  exerciseFieldsRow: { flexDirection: 'row', gap: 6 },
  exerciseFieldBox: { flex: 1, gap: 4, minWidth: 0 },
  exerciseFieldLabel: { fontSize: 9, color: RivalColors.textSecondary, fontWeight: '600', height: 12 },
  exerciseFieldInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, color: RivalColors.textPrimary, fontSize: 14, fontWeight: '600', borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, textAlign: 'center' },
  exercisesHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  unitTogglesRow: { flexDirection: 'row', gap: 8 },
  unitToggle: { flexDirection: 'row', backgroundColor: RivalColors.surfaceLow, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, overflow: 'hidden' },
  unitToggleBtn: { paddingHorizontal: 10, paddingVertical: 5 },
  unitToggleBtnActive: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  unitToggleText: { fontSize: 11, fontWeight: '700', color: RivalColors.textSecondary },
  unitToggleTextActive: { color: RivalButtonColors.label(RivalColors.onAccentFill) },

  nameInputBox: { marginTop: 12, gap: 8 },
  nameLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  nameInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.textPrimary, fontSize: 16, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  mediaHint: { fontSize: 12, color: RivalColors.textSecondary, marginTop: -4 },
  mediaErrorText: { fontSize: 12, color: RivalColors.error, fontWeight: '600' },
  mediaRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  mediaThumbWrap: { position: 'relative' },
  mediaThumb: { width: 80, height: 80, borderRadius: 10, backgroundColor: RivalColors.surfaceContainerHigh },
  videoThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  videoThumbIcon: { fontSize: 28 },
  mediaRemoveBtn: { position: 'absolute', top: -6, right: -6, backgroundColor: RivalColors.accentFill, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  mediaRemoveText: { color: RivalColors.onAccentFill, fontSize: 11, fontWeight: '800' },
  mediaAddBtn: { width: 80, height: 80, borderRadius: 10, borderWidth: 1, borderColor: RivalColors.accentFill, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  mediaAddText: { color: RivalColors.accentText, fontSize: 13, fontWeight: '700' },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  changeBtn: { flex: 1, borderWidth: 1, borderColor: RivalColors.accentFill, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  changeBtnText: { color: RivalColors.accentText, fontSize: 15, fontWeight: '700' },
  saveBtn: { flex: 1, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontSize: 15, fontWeight: '700' },
});

// Mobile: the RIVAL look over the same markup — warm cards, orange caps
// labels, gradient primary pill, no grey boxes. The green labels the desktop
// version still has (How it works, Exercises) are an older theme's leftovers.
const mobileStyles = {
  ...styles,
  ...StyleSheet.create({
    container: { flex: 1, backgroundColor: RivalWarm.page },
    content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },
    successBanner: { backgroundColor: RivalWarm.card, borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(126,217,149,0.35)' },
    successBannerText: { color: '#8fe0a8', fontSize: 14, fontWeight: '700' },
    enhanceBtn: { flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },

    previewSection: { gap: 14 },
    image: { width: '100%', maxHeight: 420, borderRadius: 16, backgroundColor: RivalWarm.card },
    scanImageThumb: { width: 150, height: 210, borderRadius: 14, backgroundColor: RivalWarm.card },
    scanImagesHint: { fontSize: 12, color: RivalWarm.muted, marginTop: 8, textAlign: 'center' },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 12, backgroundColor: RivalWarm.card, borderRadius: 16, borderWidth: 1, borderColor: RivalWarm.cardBorder },
    loadingText: { color: RivalWarm.soft, fontSize: 15, fontWeight: '600' },

    extractedBox: { backgroundColor: RivalWarm.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: RivalWarm.cardBorder, gap: 12 },
    extractedLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
    fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: RivalWarm.hairline },
    fieldLabel: { fontSize: 13, color: RivalWarm.soft, fontWeight: '600' },
    fieldValueInput: {
      minWidth: 110, fontSize: 15, fontWeight: '700', color: '#fff', backgroundColor: RivalWarm.field, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, textAlign: 'right',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    classDurationHint: { fontSize: 12, color: RivalWarm.soft, backgroundColor: RivalWarm.field, borderRadius: 10, padding: 10, lineHeight: 17 },

    typeFieldBox: { paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: RivalWarm.hairline, gap: 10 },
    typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.03)' },
    typeChipSelected: { borderColor: 'transparent', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
    typeChipText: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
    typeChipTextSelected: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontWeight: '800' },

    exercisesBox: { marginTop: 4, gap: 8 },
    exercisesLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
    exerciseEditRow: { backgroundColor: RivalWarm.field, borderRadius: 14, padding: 12, gap: 10 },
    exerciseNameInput: {
      fontSize: 15.5, fontWeight: '700', color: '#fff', padding: 0,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    nameSuggestBox: { backgroundColor: '#2a221e', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
    nameSuggestItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: RivalWarm.hairline },
    nameSuggestHint: { color: RivalColors.accentText, fontSize: 10.5, fontWeight: '800' },
    removeExerciseBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
    exerciseFieldsRow: { flexDirection: 'row', gap: 6 },
    exerciseFieldBox: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 10, paddingVertical: 7 },
    exerciseFieldLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', color: RivalWarm.muted },
    exerciseFieldInput: {
      width: '100%', textAlign: 'center', padding: 0, fontSize: 18, fontWeight: '300', color: '#fff', backgroundColor: 'transparent',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    liftAutoTrackedText: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText },
    tagLiftBtnText: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText },
    liftPickerBox: { backgroundColor: '#2a221e', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 10 },
    liftSearchInput: {
      backgroundColor: RivalWarm.field, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: '#fff', fontSize: 14,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    liftPickerChip: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    addExerciseBtn: { paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,209,190,0.35)', alignItems: 'center' },
    unitToggle: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 999, padding: 3, overflow: 'hidden' },
    unitToggleBtn: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },

    nameInputBox: { gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: RivalWarm.hairline },
    nameLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
    nameInput: {
      backgroundColor: RivalWarm.field, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15.5, fontWeight: '600', borderWidth: 0,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    mediaHint: { fontSize: 12, color: RivalWarm.muted },
    mediaThumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: RivalWarm.field },
    mediaRemoveBtn: { position: 'absolute', top: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 11, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
    mediaAddBtn: { width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,209,190,0.35)', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },

    actionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
    changeBtn: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,209,190,0.28)', paddingVertical: 14, borderRadius: 999, alignItems: 'center' },
    changeBtnText: { color: RivalColors.accentText, fontSize: 14.5, fontWeight: '700' },
    saveBtn: { flex: 1.4, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingVertical: 14, borderRadius: 999, alignItems: 'center' },
    saveBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontSize: 15, fontWeight: '800' },
    manualEntryBtn: { marginTop: 4, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,209,190,0.28)', alignItems: 'center' },
    manualEntryBtnText: { color: RivalColors.accentText, fontSize: 14, fontWeight: '700' },
  }),
};

// Mobile-only pieces of the empty state.
const mx = StyleSheet.create({
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  steps: { gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,209,190,0.12)' },
  stepNumText: { fontSize: 11, fontWeight: '800', color: RivalColors.accentText },
  stepText: { flex: 1, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.72)' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
