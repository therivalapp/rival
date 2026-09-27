import { distanceUnit, elevationUnit, fromDisplayDistance, fromDisplayElevation, toDisplayDistance, toDisplayElevation } from '../lib/units';
import { defaultActivityName } from '../lib/activityName';
import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, Image, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { calculateEffortScore, loadScoringConfig, ScoringConfig } from '../lib/effort';
import { isoToDisplayDate, displayToIsoDate } from '../lib/dateFormat';
import { findMatchingRaceId } from '../lib/raceMatch';
import { formatDuration } from '../lib/format';
import { confirmAction } from '../lib/notify';
import { CANONICAL_LIFTS, matchCanonicalLift } from '../lib/lifts';
import { RivalButton, RivalCard, RivalIcon, activityIconName, RivalBackButton, RivalDateField } from '../components/rival';
import { MediaPicker, pickMediaFiles, MAX_MEDIA, MAX_VIDEOS, MAX_VIDEO_SECONDS, type MediaItem } from '../components/rival/MediaPicker';
import { MEDIA_COLUMNS, existingAsItems, saveArrangement, type MediaRow } from '../lib/activityMedia';
import { RivalColors, RivalRadius, RivalSerifFamily, RivalType, RivalButtonColors } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';

type Exercise = { name: string; sets?: number; reps?: number; weight?: number };

const KG_PER_LB = 0.453592;

// label is what the user sees; `type` is the canonical activity_type stored in the DB.
const TYPE_OPTIONS: Array<{ type: string; label: string }> = [
  { type: 'Run', label: 'Run' },
  { type: 'Ride', label: 'Ride' },
  { type: 'Swim', label: 'Swim' },
  { type: 'Rowing', label: 'Rowing' },
  { type: 'WeightTraining', label: 'Weights' },
  { type: 'CrossFit', label: 'CrossFit' },
  { type: 'Hyrox', label: 'Hyrox' },
  { type: 'Bootcamp', label: 'Bootcamp' },
  { type: 'HIIT', label: 'HIIT' },
];

// Class-based formats are almost always a full ~45-60min session; mirror the
// scan screen's floor so a 15-min WOD isn't logged as a 15-min session.
const CLASS_BASED_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT', 'Bootcamp']);
const CLASS_DURATION_FLOOR_SECONDS = 45 * 60;


function todayDisplay(): string {
  const d = new Date();
  return isoToDisplayDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

export default function ManualEntryScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;
  // Prefills the date when opened from the Month calendar ("tap a logged-
  // looking empty day" → jump straight to logging that day), passed as
  // ?date=YYYY-MM-DD. Falls back to today for every other entry point
  // (the FAB, "Add Workout" screen, etc. never pass this param).
  const { date: prefillDateIso, editId } = useLocalSearchParams<{ date?: string; editId?: string }>();
  const isEditMode = !!editId;

  const [workoutType, setWorkoutType] = useState('Run');
  const [workoutName, setWorkoutName] = useState('');
  const [dateStr, setDateStr] = useState(() => (prefillDateIso ? isoToDisplayDate(prefillDateIso) || todayDisplay() : todayDisplay()));
  const [durationMin, setDurationMin] = useState('');
  const [durationSec, setDurationSec] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  // The distance as loaded, to the metre. The field shows it rounded to two
  // decimals (6.3928 km reads as noise); saving without touching the field
  // keeps this exact value, so opening and saving an activity never quietly
  // trims a Strava distance.
  const [loadedDistance, setLoadedDistance] = useState<{ shown: string; meters: number } | null>(null);
  const [elevationM, setElevationM] = useState('');
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [showExercises, setShowExercises] = useState(false);
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [nameSuggestIndex, setNameSuggestIndex] = useState<number | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  // What an edited activity already had, so saving knows what was removed or
  // moved. On mobile it is also shown in the row, numbered, as part of the
  // set; desktop keeps adding alongside it as before (mobile-only phase).
  const [savedMedia, setSavedMedia] = useState<MediaRow[]>([]);
  const [savedCover, setSavedCover] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Split from one screen-wide errorMsg into three, each rendered next to
  // the thing it's actually about — Ricky's call after a top-of-screen red
  // bar covered unrelated content and gave no hint which field was wrong.
  const [fieldError, setFieldError] = useState<{ field: 'name' | 'date' | 'duration'; message: string } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [savedActivityId, setSavedActivityId] = useState<string | null>(null);
  const [savedHasPhoto, setSavedHasPhoto] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  // Preserves the original time-of-day (not just the date) when editing, so
  // changing only the date field doesn't quietly reset an activity logged at
  // 6am to whatever time you happen to be editing it.
  const [originalStartedAt, setOriginalStartedAt] = useState<Date | null>(null);
  // What a blank name will be saved as.
  const namePlaceholder = defaultActivityName(workoutType, isEditMode && originalStartedAt ? originalStartedAt : new Date());
  // Held in state so the "≈ N Effort" hint can be computed synchronously on
  // every keystroke. Without it the hint fell back to the unknown-type
  // default and credited no elevation, so it read ~48 where the activity
  // would actually save as 92 — worse than showing nothing.
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig | null>(null);
  useEffect(() => { loadScoringConfig().then(setScoringConfig); }, []);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      const { data, error } = await supabase.from('activities').select('*').eq('id', editId).single();
      if (error || !data) { setGeneralError('Could not load this activity'); setLoadingEdit(false); return; }
      setWorkoutType(data.activity_type || 'Run');
      setWorkoutName(data.name || '');
      const started = new Date(data.started_at);
      setOriginalStartedAt(started);
      setDateStr(isoToDisplayDate(`${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, '0')}-${String(started.getDate()).padStart(2, '0')}`) || todayDisplay());
      setDurationMin(data.duration_seconds > 0 ? String(Math.floor(data.duration_seconds / 60)) : '');
      setDurationSec(data.duration_seconds > 0 ? String(data.duration_seconds % 60) : '');
      if (data.distance_meters > 0) {
        // The distance and climb fields are in the units chosen in Profile.
        const shown = String(Math.round(toDisplayDistance(data.distance_meters / 1000) * 100) / 100);
        setDistanceKm(shown);
        setLoadedDistance({ shown, meters: data.distance_meters });
      } else {
        setDistanceKm('');
      }
      setElevationM(data.elevation_meters > 0 ? String(Math.round(toDisplayElevation(data.elevation_meters))) : '');
      setNotes(data.notes || '');
      if (Array.isArray(data.exercises)) setExercises(data.exercises);
      const { data: mediaRows } = await supabase.from('activity_media').select(MEDIA_COLUMNS).eq('activity_id', editId);
      const rows = (mediaRows ?? []) as MediaRow[];
      setSavedMedia(rows);
      setSavedCover(data.photo_url ?? null);
      if (!wide) setMedia(existingAsItems(rows, data.photo_url ?? null));
      setLoadingEdit(false);
    })();
  }, [editId]);

  // Projected effort so the user gets immediate feedback before saving.
  const durationSeconds = (() => {
    const mins = durationMin.trim() === '' ? 0 : Number(durationMin);
    const secs = durationSec.trim() === '' ? 0 : Number(durationSec);
    const raw = (Number.isFinite(mins) ? mins * 60 : 0) + (Number.isFinite(secs) ? secs : 0);
    return CLASS_BASED_TYPES.has(workoutType) && raw > 0 && raw < 30 * 60 ? CLASS_DURATION_FLOOR_SECONDS : raw;
  })();

  // The ordering sheet, open between the phone's picker and this form.
  const [mediaPicker, setMediaPicker] = useState<{ items: MediaItem[]; notice?: string; saved: number; savedVideos: number } | null>(null);

  // Media already saved on the activity being edited — it counts against the
  // same limit, or editing would be a way round it.
  async function savedMediaCounts(): Promise<{ saved: number; savedVideos: number }> {
    if (!editId) return { saved: 0, savedVideos: 0 };
    const { data } = await supabase.from('activity_media').select('media_type').eq('activity_id', editId);
    const rows = data ?? [];
    return { saved: rows.length, savedVideos: rows.filter((r: any) => r.media_type === 'video').length };
  }

  // Phone first, then the Instagram-style ordering sheet with everything
  // already chosen here plus the new picks, all numbered in posting order.
  // Desktop is left as it was — straight into the row, no sheet — under the
  // mobile-only rule for this phase; it shares the same limits, because an
  // activity's limit cannot depend on which screen added the photos.
  async function pickMedia() {
    const { items, rejected } = await pickMediaFiles();
    setMediaError(rejected[0] ?? null);
    if (!items.length) return;
    const { saved, savedVideos } = await savedMediaCounts();

    if (!wide) {
      // Everything already on the activity is in `media` here, in the pool
      // alongside the new picks, so it isn't also counted as "already
      // attached".
      setMediaPicker({ items: [...media, ...items], notice: rejected[0], saved: 0, savedVideos: 0 });
      return;
    }

    const next = [...media];
    let videos = savedVideos + next.filter((m) => m.type === 'video').length;
    for (const item of items) {
      if (saved + next.length >= MAX_MEDIA) { setMediaError(`Up to ${MAX_MEDIA} photos and videos per activity`); break; }
      if (item.type === 'video') {
        if (videos >= MAX_VIDEOS) { setMediaError('One video per activity'); continue; }
        videos++;
      }
      next.push(item);
    }
    setMedia(next);
  }

  function removeMedia(index: number) {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  }

  // ---- Exercises (optional, for strength sessions) ------------------------
  function kgToDisplay(kg: number | undefined): string {
    if (kg == null) return '';
    const val = weightUnit === 'lb' ? kg / KG_PER_LB : kg;
    return String(Math.round(val * 10) / 10);
  }
  function displayToKg(value: string): number | undefined {
    if (value.trim() === '') return undefined;
    const num = Number(value);
    if (!Number.isFinite(num)) return undefined;
    return weightUnit === 'lb' ? num * KG_PER_LB : num;
  }
  function addExercise() { setExercises((prev) => [...prev, { name: '' }]); }
  function removeExercise(index: number) {
    setExercises((prev) => prev.filter((_, i) => i !== index));
    if (nameSuggestIndex === index) setNameSuggestIndex(null);
  }
  function updateExerciseName(index: number, value: string) {
    setExercises((prev) => prev.map((ex, i) => i === index ? { ...ex, name: value } : ex));
  }
  function updateExerciseNum(index: number, field: 'sets' | 'reps' | 'weightDisplay', value: string) {
    setExercises((prev) => prev.map((ex, i) => {
      if (i !== index) return ex;
      if (field === 'weightDisplay') return { ...ex, weight: displayToKg(value) };
      const num = value.trim() === '' ? undefined : Number(value);
      return { ...ex, [field]: Number.isFinite(num as number) ? num : undefined };
    }));
  }
  // Canonical-lift name suggestions (substring match) so a typed "shoulder"
  // surfaces "Overhead Press" and the lift feeds the PR tracker on save.
  function liftSuggestions(input: string): string[] {
    const q = (input || '').trim().toLowerCase();
    if (!q || matchCanonicalLift(input)) return [];
    return CANONICAL_LIFTS.filter((lift) => lift.toLowerCase().includes(q)).slice(0, 6);
  }

  // "Discard Workout" only makes sense for a not-yet-saved entry (router.back()
  // with nothing written). In edit mode there's an existing saved activity —
  // this actually deletes it (activity_media cascades; exercise_entries are
  // ON DELETE SET NULL, harmless orphans left behind on a row that's gone).
  async function deleteActivity() {
    if (!editId) return;
    if (!(await confirmAction({ title: 'Delete this activity?', message: "This can't be undone.", confirmLabel: 'Delete', destructive: true }))) return;
    setDeleting(true);
    const { error, count } = await supabase.from('activities').delete({ count: 'exact' }).eq('id', editId);
    if (error || !count) {
      setGeneralError(error ? `Delete failed: ${error.message}` : 'The activity could not be deleted. Try again.');
      setDeleting(false);
      return;
    }
    router.back();
  }

  async function saveSession() {
    if (durationSeconds <= 0) { setFieldError({ field: 'duration', message: 'Enter duration.' }); return; }
    const isoDate = displayToIsoDate(dateStr);
    if (!isoDate) { setFieldError({ field: 'date', message: 'Enter a valid date' }); return; }

    setSaving(true);
    setFieldError(null);
    setGeneralError(null);
    try {
      const { data: { user } } = await getAuthUser();
      if (!user) { setSaving(false); return; }

      const distance = loadedDistance && distanceKm === loadedDistance.shown
        ? loadedDistance.meters / 1000
        : distanceKm.trim() === '' ? 0 : fromDisplayDistance(Number(distanceKm));
      const elevation = elevationM.trim() === '' ? 0 : fromDisplayElevation(Number(elevationM));
      const effortScore = calculateEffortScore(
        workoutType,
        durationSeconds,
        elevation,
        await loadScoringConfig(),
      );

      const [y, m, d] = isoDate.split('-').map(Number);
      // Editing keeps the activity's original time-of-day — only the
      // date portion is replaceable here, so a 6am run stays a 6am run
      // even if you only meant to fix its distance.
      const timeSource = isEditMode && originalStartedAt ? originalStartedAt : new Date();
      const name = workoutName.trim() || defaultActivityName(workoutType, timeSource);
      const startedAt = new Date(y, m - 1, d, timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds());

      // Only keep exercises the user actually named; tag canonical lifts so
      // they group with existing PR history in the feed/activity record.
      const namedExercises = exercises.filter((ex) => ex.name.trim());
      const exercisesPayload = namedExercises.length > 0
        ? namedExercises.map((ex) => {
            const canonical = matchCanonicalLift(ex.name);
            return canonical ? { ...ex, prLift: canonical } : ex;
          })
        : null;

      const raceId = await findMatchingRaceId(user.id, startedAt.toISOString());

      let activityId: string;
      if (isEditMode) {
        const { error } = await supabase
          .from('activities')
          .update({
            name,
            activity_type: workoutType,
            distance_meters: distance * 1000,
            duration_seconds: durationSeconds,
            elevation_meters: elevation,
            started_at: startedAt.toISOString(),
            effort_score: effortScore,
            raw_effort_score: effortScore,
            notes: notes.trim() || null,
            exercises: exercisesPayload,
            race_id: raceId,
          })
          .eq('id', editId);
        if (error) {
          setGeneralError(`Save failed: ${error.message}`);
          setSaving(false);
          return;
        }
        activityId = editId as string;
        // Re-sync the PR tracker's lift rows with whatever's now in the form
        // — simplest correct approach is drop-and-reinsert rather than diffing.
        // If the old rows can't be cleared, re-inserting below would DOUBLE the
        // athlete's lifts for this workout and corrupt their PR history, so stop
        // rather than press on.
        const { error: clearErr } = await supabase.from('exercise_entries').delete().eq('activity_id', activityId);
        if (clearErr) {
          setGeneralError(`Couldn't update lifts: ${clearErr.message}`);
          setSaving(false);
          return;
        }
      } else {
        const { data: inserted, error } = await supabase
          .from('activities')
          .insert({
            user_id: user.id,
            name,
            activity_type: workoutType,
            distance_meters: distance * 1000,
            duration_seconds: durationSeconds,
            elevation_meters: elevation,
            started_at: startedAt.toISOString(),
            effort_score: effortScore,
            raw_effort_score: effortScore,
            notes: notes.trim() || null,
            exercises: exercisesPayload,
            provider: 'rival_manual',
            provider_activity_id: `manual-${Date.now()}`,
            race_id: raceId,
          })
          .select('id')
          .single();

        if (error || !inserted) {
          if (error?.message?.includes('activities_started_at_not_future')) {
            setFieldError({ field: 'date', message: "Future dates can't be logged. Choose today or an earlier date." });
          } else {
            setGeneralError(`Save failed: ${error?.message ?? 'unknown error'}`);
          }
          setSaving(false);
          return;
        }
        activityId = inserted.id;
      }

      // Lift entries feed the PR tracker. Use the canonical name when we
      // recognise the lift (so it groups with existing history), else the
      // user's own name title-cased. Only weighted, named lifts count.
      const liftEntries = namedExercises
        .map((ex) => ({
          user_id: user.id,
          activity_id: activityId,
          exercise_name: matchCanonicalLift(ex.name)
            || ex.name.trim().replace(/\b\w/g, (c) => c.toUpperCase()),
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

      // Photos and videos, as one ordered set: removals, uploads, the order
      // shown in the picker, and #1 as the cover — see lib/activityMedia.ts.
      // Desktop only ever adds, so it appends to what is there and leaves the
      // cover alone; `existingId` is filtered out of `media` in case the
      // window crossed the breakpoint after loading.
      const newOnly = media.filter((m) => !m.existingId);
      const arrangement = wide
        ? { items: [...existingAsItems(savedMedia, savedCover), ...newOnly], keepCover: !!savedCover }
        : { items: media, keepCover: false };
      let coverUrl: string | null = savedCover;
      if (wide ? newOnly.length > 0 : true) {
        const result = await saveArrangement({
          activityId,
          userId: user.id,
          items: arrangement.items,
          existing: savedMedia,
          currentCover: savedCover,
          keepCover: arrangement.keepCover,
        });
        if (result.errors.length) setGeneralError(`Workout saved, but: ${result.errors[0]}`);
        coverUrl = result.cover;
      }

      // Milestones are earned off total hours — recheck fire-and-forget.
      const { data: { session } } = await supabase.auth.getSession();
      if (session) fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
      }).catch(() => {});

      if (isEditMode) {
        goToTab('/my-activities');
        return;
      }
      setSavedActivityId(activityId);
      setSavedHasPhoto(!!coverUrl);
      // With a photo, offer to AI-enhance before leaving; otherwise head to the feed.
      if (!coverUrl) setTimeout(() => goToTab('/my-activities'), 900);
    } catch (err) {
      console.error('Save failed:', err);
      setGeneralError('The activity could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  // ---- Left column: type + name + date ------------------------------------
  const typeCard = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelLabel}>WORKOUT TYPE</Text>
      <View style={styles.typeGrid}>
        {TYPE_OPTIONS.map((opt) => {
          const selected = workoutType === opt.type;
          return (
            <TouchableOpacity
              key={opt.type}
              style={[styles.typeCard, selected && styles.typeCardSelected]}
              onPress={() => setWorkoutType(opt.type)}
            >
              <RivalIcon name={activityIconName(opt.type)} size={22} color={selected ? RivalColors.accentText : RivalColors.textSecondary} />
              <Text style={[styles.typeLabel, selected && { color: RivalColors.accentText }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </RivalCard>
  );

  const detailsCard = (
    <RivalCard glass style={styles.panel}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>WORKOUT NAME</Text>
        <TextInput
          style={styles.input}
          value={workoutName}
          onChangeText={(v) => { setWorkoutName(v); if (fieldError?.field === 'name') setFieldError(null); }}
          placeholder={namePlaceholder}
          placeholderTextColor={RivalColors.textSecondary}
        />
        {fieldError?.field === 'name' && <Text style={styles.fieldError}>{fieldError.message}</Text>}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>DATE</Text>
        <RivalDateField
          value={dateStr}
          onChangeText={(v) => { setDateStr(v); if (fieldError?.field === 'date') setFieldError(null); }}
          inputStyle={styles.input}
        />
        {fieldError?.field === 'date' && <Text style={styles.fieldError}>{fieldError.message}</Text>}
      </View>
    </RivalCard>
  );

  // ---- Right column: metrics + comments + media ---------------------------
  const metric = (label: string, unit: string, value: string, onChange: (v: string) => void, placeholder: string, keyboardType: 'numeric' | 'decimal-pad' = 'numeric') => (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricInputRow}>
        <TextInput
          style={styles.metricInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={RivalColors.textSecondary}
          keyboardType={keyboardType}
        />
        <Text style={styles.metricUnit}>{unit}</Text>
      </View>
    </View>
  );

  // Duration gets its own layout rather than the generic `metric` box — two
  // narrow fields (min, sec) sharing the space a single number used to have,
  // so a sub-minute correction doesn't need converting to a decimal.
  const durationMetric = (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>DURATION</Text>
      <View style={styles.metricInputRow}>
        <TextInput
          style={[styles.metricInput, styles.metricInputNarrow]}
          value={durationMin}
          onChangeText={(v) => { setDurationMin(v); if (fieldError?.field === 'duration') setFieldError(null); }}
          placeholder="0"
          placeholderTextColor={RivalColors.textSecondary}
          keyboardType="numeric"
        />
        <Text style={styles.metricUnit}>min</Text>
        <TextInput
          style={[styles.metricInput, styles.metricInputNarrow]}
          value={durationSec}
          onChangeText={(v) => {
            // Clamp to 0-59 as you type rather than after — "75 sec" isn't a
            // typo to catch on save, it's just 1:15, which belongs in the min
            // field, so keep sec honest to what it actually represents.
            const n = v.replace(/\D/g, '').slice(0, 2);
            const clamped = n === '' ? '' : String(Math.min(59, Number(n)));
            setDurationSec(clamped);
            if (fieldError?.field === 'duration') setFieldError(null);
          }}
          placeholder="0"
          placeholderTextColor={RivalColors.textSecondary}
          keyboardType="numeric"
          maxLength={2}
        />
        <Text style={styles.metricUnit}>sec</Text>
      </View>
    </View>
  );

  const metricsCard = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelLabel}>CORE PERFORMANCE METRICS</Text>
      <View style={styles.metricsRow}>
        {durationMetric}
        {metric('DISTANCE', distanceUnit().toUpperCase(), distanceKm, setDistanceKm, '0.00', 'decimal-pad')}
        {metric('ELEVATION', elevationUnit().toUpperCase(), elevationM, setElevationM, '0')}
      </View>
      {fieldError?.field === 'duration' && <Text style={styles.fieldError}>{fieldError.message}</Text>}
      {durationSeconds > 0 && (
        <Text style={styles.effortPreview}>
          ≈ {Math.round(calculateEffortScorePreview(workoutType, durationSeconds, elevationM, scoringConfig))} Effort · {formatDuration(durationSeconds)}
        </Text>
      )}
      {CLASS_BASED_TYPES.has(workoutType) && durationSeconds >= CLASS_DURATION_FLOOR_SECONDS && durationMin.trim() !== '' && Number(durationMin) * 60 < 30 * 60 && (
        <Text style={styles.classHint}>CrossFit, Hyrox, Bootcamp and HIIT activities count as a full 45-minute class, including warm-up and skill work.</Text>
      )}
      {generalError && <Text style={styles.fieldError}>{generalError}</Text>}
      <RivalButton
        busy={saving}
        label={saving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Save activity'}
        onPress={saveSession}
        disabled={saving || !!savedActivityId}
        style={styles.completeBtn}
      />
      {isEditMode ? (
        <TouchableOpacity onPress={deleteActivity} disabled={saving || deleting}>
          <BusyText busy={!!(deleting)} style={styles.discard}>{deleting ? 'Deleting…' : 'Delete Activity'}</BusyText>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => router.back()} disabled={saving}>
          <Text style={styles.discard}>Discard Workout</Text>
        </TouchableOpacity>
      )}
    </RivalCard>
  );

  const commentsCard = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelLabel}>COMMENTS</Text>
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="How did it feel? Share your experience"
        placeholderTextColor={RivalColors.textSecondary}
        multiline
        numberOfLines={4}
      />
    </RivalCard>
  );

  const exercisesCard = (
    <RivalCard glass style={styles.panel}>
      <TouchableOpacity style={styles.exToggleRow} onPress={() => setShowExercises((s) => !s)}>
        <View>
          <Text style={styles.panelLabel}>EXERCISES / LIFTS</Text>
          <Text style={styles.exOptional}>Optional. Logged lifts are tracked as PBs.</Text>
        </View>
        <Text style={styles.exToggleIcon}>{showExercises ? '–' : '+'}</Text>
      </TouchableOpacity>

      {showExercises && (
        <>
          {exercises.length > 0 && (
            <View style={styles.unitToggle}>
              {(['kg', 'lb'] as const).map((u) => (
                <TouchableOpacity key={u} style={[styles.unitBtn, weightUnit === u && styles.unitBtnActive]} onPress={() => setWeightUnit(u)}>
                  <Text style={[styles.unitBtnText, weightUnit === u && { color: RivalColors.accentText }]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {exercises.map((ex, i) => (
            <View key={i} style={styles.exRow}>
              <View style={styles.exNameRow}>
                <TextInput
                  style={styles.exNameInput}
                  value={ex.name}
                  onChangeText={(v) => updateExerciseName(i, v)}
                  onFocus={() => setNameSuggestIndex(i)}
                  onBlur={() => setTimeout(() => setNameSuggestIndex((cur) => (cur === i ? null : cur)), 150)}
                  placeholder="Exercise name"
                  placeholderTextColor={RivalColors.textSecondary}
                />
                <TouchableOpacity style={styles.exRemove} onPress={() => removeExercise(i)}>
                  <RivalIcon name="close" size={16} color={RivalColors.textSecondary} />
                </TouchableOpacity>
              </View>
              {nameSuggestIndex === i && liftSuggestions(ex.name).length > 0 && (
                <View style={styles.suggestBox}>
                  {liftSuggestions(ex.name).map((s) => (
                    <TouchableOpacity key={s} style={styles.suggestItem} onPress={() => { updateExerciseName(i, s); setNameSuggestIndex(null); }}>
                      <Text style={styles.suggestText}>{s}</Text>
                      <Text style={styles.suggestHint}>PB tracked</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={styles.exFieldsRow}>
                <View style={styles.exField}>
                  <Text style={styles.exFieldLabel}>Sets</Text>
                  <TextInput style={styles.exFieldInput} value={ex.sets != null ? String(ex.sets) : ''} onChangeText={(v) => updateExerciseNum(i, 'sets', v)} placeholder="-" placeholderTextColor={RivalColors.textSecondary} keyboardType="numeric" />
                </View>
                <View style={styles.exField}>
                  <Text style={styles.exFieldLabel}>Reps</Text>
                  <TextInput style={styles.exFieldInput} value={ex.reps != null ? String(ex.reps) : ''} onChangeText={(v) => updateExerciseNum(i, 'reps', v)} placeholder="-" placeholderTextColor={RivalColors.textSecondary} keyboardType="numeric" />
                </View>
                <View style={styles.exField}>
                  <Text style={styles.exFieldLabel}>Weight ({weightUnit})</Text>
                  <TextInput style={styles.exFieldInput} value={kgToDisplay(ex.weight)} onChangeText={(v) => updateExerciseNum(i, 'weightDisplay', v)} placeholder="-" placeholderTextColor={RivalColors.textSecondary} keyboardType="numeric" />
                </View>
              </View>
            </View>
          ))}

          <TouchableOpacity style={styles.addExBtn} onPress={addExercise}>
            <Text style={styles.addExBtnText}>+ Add exercise</Text>
          </TouchableOpacity>
        </>
      )}
    </RivalCard>
  );

  const mediaCard = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelLabel}>PHOTOS & VIDEOS</Text>
      {media.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
          {media.map((m, i) => (
            <View key={i} style={styles.mediaThumbWrap}>
              {m.type === 'photo'
                ? <Image source={{ uri: m.uri }} style={styles.mediaThumb} />
                : <View style={[styles.mediaThumb, styles.mediaVideo]}><Text style={styles.mediaVideoIcon}>🎬</Text></View>}
              {/* The posting order, carried over from the ordering sheet. */}
              {!wide ? (
                <View style={styles.mediaOrder} pointerEvents="none">
                  <Text style={styles.mediaOrderText}>{i + 1}</Text>
                </View>
              ) : null}
              <TouchableOpacity style={styles.mediaRemove} onPress={() => removeMedia(i)}>
                <RivalIcon name="close" size={14} color={RivalColors.textPrimary} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
      <TouchableOpacity style={styles.dropzone} onPress={pickMedia}>
        <RivalIcon name="upload" size={24} color={RivalColors.textPrimary} />
        <Text style={styles.dropzoneTitle}>Upload photos or videos</Text>
        <Text style={styles.dropzoneSub}>
          {wide
            ? `Up to ${MAX_MEDIA} photos and videos · PNG, JPG, MP4`
            : `Up to ${MAX_MEDIA} photos and videos · 1 video, up to ${MAX_VIDEO_SECONDS / 60} min`}
        </Text>
      </TouchableOpacity>
      {mediaError && <Text style={styles.fieldError}>{mediaError}</Text>}
    </RivalCard>
  );


  // ---- Mobile layout ------------------------------------------------------
  // The page reads top to bottom in the order you think about a session:
  // what it was, the numbers, when, the photos, how it felt — and the save
  // button is always at the bottom of the screen rather than halfway down,
  // above half the form. Desktop keeps its two-column layout (mobile-only
  // phase); both share every piece of state and every handler.
  const effortNow = durationSeconds > 0
    ? Math.round(calculateEffortScorePreview(workoutType, durationSeconds, elevationM, scoringConfig))
    : null;

  // An activity can be a type this list doesn't offer (a Walk from Strava);
  // it still has to show as selected rather than silently matching nothing.
  const typeChoices = TYPE_OPTIONS.some((o) => o.type === workoutType)
    ? TYPE_OPTIONS
    : [{ type: workoutType, label: workoutType }, ...TYPE_OPTIONS];

  const heroDate = (() => {
    const iso = displayToIsoDate(dateStr);
    if (!iso) return null;
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  })();

  // Lifts, in the same warm cards as the rest of the mobile page. Same state
  // and handlers as the desktop card — only the presentation differs.
  const mobileLiftsCard = (
    <View style={m.card}>
      <TouchableOpacity style={m.liftsHead} onPress={() => setShowExercises((v) => !v)} activeOpacity={0.8}>
        <View style={{ flex: 1 }}>
          <View style={m.liftsTitleRow}>
            <Text style={m.cardLabel}>Lifts</Text>
            {exercises.length > 0 ? (
              <View style={m.liftsCount}><Text style={m.liftsCountText}>{exercises.length}</Text></View>
            ) : null}
          </View>
          <Text style={[m.cardHint, { marginTop: 3 }]}>Optional · tracked as PBs</Text>
        </View>
        <View style={[m.liftsToggle, showExercises && m.liftsToggleOpen]}>
          <RivalIcon name={showExercises ? 'chevronDown' : 'add'} size={18} color={RivalColors.accentText} />
        </View>
      </TouchableOpacity>

      {showExercises && (
        <>
          {exercises.length > 0 && (
            <View style={m.unitToggle}>
              {(['kg', 'lb'] as const).map((u) => (
                <TouchableOpacity key={u} style={[m.unitBtn, weightUnit === u && m.unitBtnOn]} onPress={() => setWeightUnit(u)}>
                  <Text style={[m.unitText, weightUnit === u && m.unitTextOn]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {exercises.map((ex, i) => (
            <View key={i} style={m.lift}>
              <View style={m.liftNameRow}>
                <Text style={m.liftIndex}>{i + 1}</Text>
                <TextInput
                  style={m.liftName}
                  value={ex.name}
                  onChangeText={(v) => updateExerciseName(i, v)}
                  onFocus={() => setNameSuggestIndex(i)}
                  onBlur={() => setTimeout(() => setNameSuggestIndex((cur) => (cur === i ? null : cur)), 150)}
                  placeholder="Exercise name"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                />
                <TouchableOpacity style={m.liftRemove} onPress={() => removeExercise(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <RivalIcon name="close" size={15} color="rgba(255,255,255,0.45)" />
                </TouchableOpacity>
              </View>

              {nameSuggestIndex === i && liftSuggestions(ex.name).length > 0 && (
                <View style={m.suggestBox}>
                  {liftSuggestions(ex.name).map((sug) => (
                    <TouchableOpacity key={sug} style={m.suggestItem} onPress={() => { updateExerciseName(i, sug); setNameSuggestIndex(null); }}>
                      <Text style={m.suggestText}>{sug}</Text>
                      <View style={m.suggestPb}><Text style={m.suggestPbText}>PB tracked</Text></View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={m.liftFields}>
                {([
                  ['Sets', ex.sets != null ? String(ex.sets) : '', (v: string) => updateExerciseNum(i, 'sets', v)],
                  ['Reps', ex.reps != null ? String(ex.reps) : '', (v: string) => updateExerciseNum(i, 'reps', v)],
                  [weightUnit === 'kg' ? 'Kg' : 'Lb', kgToDisplay(ex.weight), (v: string) => updateExerciseNum(i, 'weightDisplay', v)],
                ] as const).map(([label, value, onChange]) => (
                  <View key={label} style={m.liftField}>
                    <Text style={m.liftFieldLabel}>{label}</Text>
                    <TextInput
                      style={m.liftFieldInput}
                      value={value}
                      onChangeText={onChange}
                      placeholder="–"
                      placeholderTextColor="rgba(255,255,255,0.25)"
                      keyboardType="numeric"
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}

          <TouchableOpacity style={m.addLift} onPress={addExercise} activeOpacity={0.8}>
            <RivalIcon name="add" size={16} color={RivalColors.accentText} />
            <Text style={m.addLiftText}>{exercises.length ? 'Add another exercise' : 'Add an exercise'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  const mobileLayout = (
    <View style={m.stack}>
      {/* The name is the page's title, as it is in the activity viewer —
          no card around it. Type and date have their own fields below, and
          Effort lives in the save bar, where it stays on screen while the
          numbers that change it are being edited. */}
      <View style={m.card}>
        <Text style={m.cardLabel}>Name</Text>
        {/* A visible field, like every other editable thing on the page —
            big italic text on its own read as a heading, not an input. */}
        <View style={m.nameField}>
          <TextInput
            style={m.nameInput}
            value={workoutName}
            onChangeText={(v) => { setWorkoutName(v); if (fieldError?.field === 'name') setFieldError(null); }}
            placeholder={namePlaceholder}
            placeholderTextColor="rgba(255,255,255,0.3)"
          />
        </View>
        {fieldError?.field === 'name' && <Text style={styles.fieldError}>{fieldError.message}</Text>}
      </View>

      {/* Type: one scrolling row instead of a grid that filled the screen. */}
      <View>
        <Text style={m.label}>Activity</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={m.chips}>
          {typeChoices.map((opt) => {
            const on = workoutType === opt.type;
            return (
              <TouchableOpacity key={opt.type} style={[m.chip, on && m.chipOn]} onPress={() => setWorkoutType(opt.type)} activeOpacity={0.8}>
                <RivalIcon name={activityIconName(opt.type)} size={16} color={on ? RivalButtonColors.label(RivalColors.onAccentFill) : RivalColors.textSecondary} />
                <Text style={[m.chipText, on && m.chipTextOn]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* The numbers. Duration gets the full width — min and sec side by
          side were cramped into a third of a phone. */}
      <View style={m.card}>
        <Text style={m.cardLabel}>Stats</Text>
        <View style={m.durationBox}>
          <View style={m.durationPart}>
            <TextInput
              style={m.durationInput}
              value={durationMin}
              onChangeText={(v) => { setDurationMin(v.replace(/\D/g, '')); if (fieldError?.field === 'duration') setFieldError(null); }}
              placeholder="0"
              placeholderTextColor="rgba(255,255,255,0.25)"
              keyboardType="numeric"
            />
            <Text style={m.durationUnit}>min</Text>
          </View>
          <Text style={m.durationColon}>:</Text>
          <View style={m.durationPart}>
            <TextInput
              style={m.durationInput}
              value={durationSec}
              onChangeText={(v) => {
                // Clamped as you type: 75 sec is 1:15, and belongs in minutes.
                const n = v.replace(/\D/g, '').slice(0, 2);
                setDurationSec(n === '' ? '' : String(Math.min(59, Number(n))));
                if (fieldError?.field === 'duration') setFieldError(null);
              }}
              placeholder="00"
              placeholderTextColor="rgba(255,255,255,0.25)"
              keyboardType="numeric"
              maxLength={2}
            />
            <Text style={m.durationUnit}>sec</Text>
          </View>
        </View>
        {fieldError?.field === 'duration' && <Text style={styles.fieldError}>{fieldError.message}</Text>}
        <View style={m.statRow}>
          <View style={m.stat}>
            <Text style={m.statLabel}>Distance</Text>
            <View style={m.statValueRow}>
              <TextInput style={m.statInput} value={distanceKm} onChangeText={setDistanceKm} placeholder="0.0" placeholderTextColor="rgba(255,255,255,0.25)" keyboardType="decimal-pad" />
              <Text style={m.statUnit}>{distanceUnit()}</Text>
            </View>
          </View>
          <View style={m.stat}>
            <Text style={m.statLabel}>Elevation</Text>
            <View style={m.statValueRow}>
              <TextInput style={m.statInput} value={elevationM} onChangeText={setElevationM} placeholder="0" placeholderTextColor="rgba(255,255,255,0.25)" keyboardType="numeric" />
              <Text style={m.statUnit}>{elevationUnit()}</Text>
            </View>
          </View>
        </View>
        {CLASS_BASED_TYPES.has(workoutType) && durationSeconds >= CLASS_DURATION_FLOOR_SECONDS && durationMin.trim() !== '' && Number(durationMin) * 60 < 30 * 60 && (
          <Text style={styles.classHint}>CrossFit, Hyrox, Bootcamp and HIIT activities count as a full 45-minute class, including warm-up and skill work.</Text>
        )}
      </View>

      <View style={m.card}>
        <Text style={m.cardLabel}>Date</Text>
        <RivalDateField
          value={dateStr}
          onChangeText={(v) => { setDateStr(v); if (fieldError?.field === 'date') setFieldError(null); }}
          inputStyle={m.dateInput}
        />
        {fieldError?.field === 'date' && <Text style={styles.fieldError}>{fieldError.message}</Text>}
      </View>

      {/* Photos inline, Instagram-style: numbered in posting order, tap one
          to rearrange, the last tile adds more. */}
      <View style={m.card}>
        <View style={m.cardHead}>
          <Text style={m.cardLabel}>Photos & videos</Text>
          <Text style={m.cardHint}>{media.length}/{MAX_MEDIA}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={m.mediaRow}>
          {media.map((item, i) => (
            <TouchableOpacity
              key={item.uri}
              activeOpacity={0.85}
              onPress={() => setMediaPicker({ items: media, saved: 0, savedVideos: 0 })}
              style={m.thumbWrap}
            >
              {item.type === 'photo'
                ? <Image source={{ uri: item.uri }} style={m.thumb} />
                : <View style={[m.thumb, m.thumbVideo]}><RivalIcon name="video" size={22} color={RivalColors.accentText} /></View>}
              <View style={m.thumbOrder} pointerEvents="none">
                <Text style={m.thumbOrderText}>{i + 1}</Text>
              </View>
              {i === 0 && item.type === 'photo' ? (
                <View style={m.thumbCover} pointerEvents="none"><Text style={m.thumbCoverText}>Cover</Text></View>
              ) : null}
            </TouchableOpacity>
          ))}
          {media.length < MAX_MEDIA ? (
            <TouchableOpacity style={[m.thumb, m.addTile]} onPress={pickMedia} activeOpacity={0.8}>
              <RivalIcon name="addPhoto" size={22} color={RivalColors.accentText} />
              <Text style={m.addTileText}>Add</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
        <Text style={m.cardHint}>Up to {MAX_MEDIA} · 1 video, up to {MAX_VIDEO_SECONDS / 60} min · tap a photo to reorder</Text>
        {mediaError && <Text style={styles.fieldError}>{mediaError}</Text>}
      </View>

      {/* Same words and feel as the journal in the activity viewer — it is
          the same note, so it should read as the same thing. */}
      <View style={m.journal}>
        <Text style={m.cardLabel}>Journal</Text>
        <View style={m.journalRule} />
        <TextInput
          style={m.journalInput}
          value={notes}
          onChangeText={setNotes}
          placeholder="Add a note about this activity"
          placeholderTextColor="rgba(255,255,255,0.3)"
          multiline
        />
      </View>

      {mobileLiftsCard}

      {/* Destructive, so it sits apart at the very end rather than next to
          the button you tap every time. */}
      <View style={m.dangerZone}>
        {isEditMode ? (
          <TouchableOpacity onPress={deleteActivity} disabled={saving || deleting} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <BusyText busy={!!(deleting)} style={m.dangerText}>{deleting ? 'Deleting…' : 'Delete this activity'}</BusyText>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => router.back()} disabled={saving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={m.discardText}>Discard</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );


  // Pinned to the bottom of the screen, always reachable.
  const mobileSaveBar = (
    <View style={m.saveBar}>
      {generalError && <Text style={[styles.fieldError, m.saveBarError]}>{generalError}</Text>}
      {!generalError && fieldError && <Text style={[styles.fieldError, m.saveBarError]}>{fieldError.message}</Text>}
      <View style={m.saveRow}>
        {/* Live: recalculates as the duration or climb changes, and it is
            what this session will be worth once saved. */}
        <View style={m.effortBlock}>
          {effortNow !== null ? (
            <>
              <View style={m.effortLine}>
                <Text style={m.effortNum}>{effortNow}</Text>
                <Text style={m.effortUnit}>Effort</Text>
              </View>
              <Text style={m.effortSub}>{formatDuration(durationSeconds)}</Text>
            </>
          ) : (
            <Text style={m.effortEmpty}>Add a time{'\n'}to see Effort</Text>
          )}
        </View>
      <TouchableOpacity
        style={[m.saveBtn, (saving || !!savedActivityId) && m.saveBtnDisabled]}
        onPress={saveSession}
        disabled={saving || !!savedActivityId}
        activeOpacity={0.85}
      >
        <BusyText busy={!!(saving)} style={m.saveBtnText}>{saving ? 'Saving…' : isEditMode ? 'Save changes' : 'Log activity'}</BusyText>
      </TouchableOpacity>
      </View>
    </View>
  );

  const saved = !!savedActivityId;

  return (
    <SafeAreaView style={[styles.container, !wide && m.page]}>
      <ScrollView contentContainerStyle={[styles.content, !wide && m.content]}>
        {wide ? (
          <>
            <View style={styles.header}>
              <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
            </View>
            <Text style={styles.title}>{isEditMode ? 'Edit activity' : 'Log activity'}</Text>
            <Text style={styles.subtitle}>
              {isEditMode ? 'Effort is recalculated when changes are saved.' : 'Logged activities count toward Effort and Team standings.'}
            </Text>
          </>
        ) : (
          <View style={m.header}>
            <RivalBackButton onPress={() => router.back()} />
            <Text style={m.title}>{isEditMode ? 'Edit activity' : 'Log an activity'}</Text>
            {heroDate ? <Text style={m.headerDate}>{heroDate}</Text> : null}
          </View>
        )}

        {loadingEdit && <Text style={styles.subtitle}>Loading activity…</Text>}

        {saved && (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>Activity saved</Text>
            {savedHasPhoto ? (
              <View style={styles.successActions}>
                <TouchableOpacity style={[styles.enhanceBtn, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => router.replace(`/ai-share?activityId=${savedActivityId}`)}>
                  <RivalIcon name="ai" size={16} color={RivalColors.onAccentFill} />
                  <Text style={styles.enhanceBtnText}>Enhance photo with AI</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => goToTab('/my-activities')}>
                  <Text style={styles.doneText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.doneText}>Opening activities…</Text>
            )}
          </View>
        )}

        {!loadingEdit && !wide && mobileLayout}

        {!loadingEdit && wide && (
          <View style={[wide && styles.twoCol]}>
            <View style={[wide && styles.leftCol]}>
              {typeCard}
              {detailsCard}
            </View>
            <View style={[wide && styles.rightCol]}>
              {metricsCard}
              {commentsCard}
              {exercisesCard}
              {mediaCard}
            </View>
          </View>
        )}
      </ScrollView>

      {!wide && !loadingEdit && mobileSaveBar}

      {mediaPicker && (
        <MediaPicker
          initial={mediaPicker.items}
          initialNotice={mediaPicker.notice}
          alreadyAttached={mediaPicker.saved}
          videosAlreadyAttached={mediaPicker.savedVideos}
          title="Photos and videos"
          onCancel={() => setMediaPicker(null)}
          onDone={(items) => { setMedia(items); setMediaPicker(null); }}
        />
      )}
    </SafeAreaView>
  );
}

// The on-screen "≈ N Effort" hint. Uses the same formula and the same live
// config as the save path, so what the athlete is shown before saving is what
// they actually get — until the config has loaded, in which case there is
// nothing honest to show yet.
function calculateEffortScorePreview(
  type: string,
  durationSeconds: number,
  elevationM: string,
  config: ScoringConfig | null,
): number {
  if (!config) return 0;
  const elevation = elevationM.trim() === '' ? 0 : fromDisplayElevation(Number(elevationM));
  return calculateEffortScore(type, durationSeconds, elevation, config);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  header: { marginBottom: 8 },
  back: { color: RivalColors.accentText, fontSize: 16 },
  title: { ...RivalType.headlineLg, color: RivalColors.textPrimary, marginTop: 8 },
  subtitle: { ...RivalType.bodyMd, fontSize: 14, color: RivalColors.textSecondary, marginBottom: 24 },

  // Sits directly under (or beside, for the metrics row) whatever it's
  // actually about — replaces a single fixed top banner that covered the
  // rest of the screen with no clue which field it referred to.
  fieldError: { color: RivalColors.error, fontSize: 12, fontWeight: '600' },

  successBanner: { backgroundColor: `${RivalColors.success}22`, borderRadius: RivalRadius.lg, padding: 16, marginBottom: 20, gap: 8, alignItems: 'center' },
  successText: { color: RivalColors.success, fontSize: 15, fontWeight: '700' },
  successActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  enhanceBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 16, paddingVertical: 10 },
  enhanceBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontWeight: '700', fontSize: 14 },
  doneText: { color: RivalColors.textSecondary, fontSize: 14 },

  twoCol: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  leftCol: { width: '38%', minWidth: 300, maxWidth: 420, flexGrow: 0, flexShrink: 0, gap: 16 },
  rightCol: { flex: 1, gap: 16 },

  panel: { padding: 20, gap: 14, marginBottom: 16 },
  panelLabel: { ...RivalType.labelCaps, color: RivalColors.accentText },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard: { flexBasis: '47%', flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 18, borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: RivalColors.outlineVariant, backgroundColor: RivalColors.surfaceLow },
  typeCardSelected: { borderColor: RivalColors.accentFill, backgroundColor: `${RivalColors.accentFill}22` },
  typeIcon: { fontSize: 22 },
  typeLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },

  field: { gap: 6 },
  fieldLabel: { ...RivalType.labelCaps, fontSize: 11, color: RivalColors.textSecondary },
  input: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.textPrimary, fontSize: 15 },

  metricsRow: { flexDirection: 'row', gap: 10 },
  metricBox: { flex: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, padding: 12, gap: 8 },
  metricLabel: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary },
  metricInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  // minWidth:0 lets the input shrink inside the flex row on react-native-web —
  // without it the input keeps its content width and shoves the unit out of the box.
  metricInput: { flex: 1, minWidth: 0, color: RivalColors.textPrimary, fontSize: 26, fontWeight: '300', padding: 0 },
  // DURATION's min/sec pair share the same box width DISTANCE/ELEVATION give
  // a single number — smaller font and a tighter unit label keep "0 min 0
  // sec" from crowding out the box's own padding.
  metricInputNarrow: { fontSize: 18 },
  metricUnit: { fontSize: 11, color: RivalColors.textSecondary, fontWeight: '700', paddingBottom: 4, flexShrink: 0 },
  effortPreview: { fontSize: 13, color: RivalColors.accentText, fontWeight: '700' },
  classHint: { fontSize: 12, color: RivalColors.textSecondary, lineHeight: 17 },
  completeBtn: { marginTop: 4 },
  discard: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 4 },

  notesInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.onSurface, fontSize: 15, minHeight: 110, textAlignVertical: 'top' },

  exToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exOptional: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  exToggleIcon: { fontSize: 22, color: RivalColors.accentText, fontWeight: '700', width: 24, textAlign: 'center' },
  unitToggle: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, padding: 2, gap: 2 },
  unitBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: RivalRadius.sm },
  unitBtnActive: { backgroundColor: RivalColors.surfaceContainerHigh },
  unitBtnText: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  exRow: { gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: RivalColors.outlineVariant },
  exNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exNameInput: { flex: 1, minWidth: 0, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 12, paddingVertical: 10, color: RivalColors.textPrimary, fontSize: 14 },
  exRemove: { width: 32, height: 32, borderRadius: RivalRadius.DEFAULT, backgroundColor: RivalColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  exRemoveText: { color: RivalColors.textSecondary, fontSize: 13 },
  suggestBox: { backgroundColor: RivalColors.surfaceContainerHigh, borderRadius: RivalRadius.DEFAULT, overflow: 'hidden' },
  suggestItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  suggestText: { color: RivalColors.textPrimary, fontSize: 14, fontWeight: '600' },
  suggestHint: { color: RivalColors.accentText, fontSize: 11, fontWeight: '700' },
  exFieldsRow: { flexDirection: 'row', gap: 8 },
  exField: { flex: 1, gap: 4 },
  exFieldLabel: { fontSize: 10, color: RivalColors.textSecondary, fontWeight: '700' },
  exFieldInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 10, paddingVertical: 8, color: RivalColors.textPrimary, fontSize: 14, textAlign: 'center' },
  addExBtn: { alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderColor: RivalColors.outlineVariant, borderStyle: 'dashed', borderRadius: RivalRadius.DEFAULT, marginTop: 4 },
  addExBtnText: { color: RivalColors.accentText, fontSize: 14, fontWeight: '700' },

  mediaRow: { gap: 10, paddingBottom: 4 },
  mediaThumbWrap: { position: 'relative' },
  mediaOrder: {
    position: 'absolute', top: 4, left: 4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center',
  },
  mediaOrderText: { fontSize: 11, fontWeight: '800', color: RivalColors.onAccentFill },
  mediaThumb: { width: 72, height: 72, borderRadius: RivalRadius.DEFAULT, backgroundColor: RivalColors.surfaceContainer },
  mediaVideo: { alignItems: 'center', justifyContent: 'center' },
  mediaVideoIcon: { fontSize: 26 },
  mediaRemove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: RivalColors.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: RivalColors.outlineVariant },
  mediaRemoveText: { color: RivalColors.textPrimary, fontSize: 12 },
  dropzone: { borderWidth: 1, borderColor: RivalColors.outlineVariant, borderStyle: 'dashed', borderRadius: RivalRadius.DEFAULT, paddingVertical: 32, alignItems: 'center', gap: 6 },
  dropzoneIcon: { fontSize: 24 },
  dropzoneTitle: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  dropzoneSub: { fontSize: 12, color: RivalColors.textSecondary },
});

// Mobile-only styles — the warm brown palette the activity viewer and feed
// cards already use, so editing a session feels like the same place as
// looking at one.
const WARM_CARD = '#1d1714';
const m = StyleSheet.create({
  page: { backgroundColor: '#110e0c' },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginBottom: 6 },
  // Small, so it labels the page without competing with the session's own
  // name, which is the real title just below.
  title: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: RivalColors.accentText },
  headerDate: { fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  nameField: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  nameInput: {
    padding: 0, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 24, fontWeight: '700', color: '#fff', lineHeight: 30,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },

  stack: { gap: 14 },


  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText, marginBottom: 8, marginLeft: 2 },
  chips: { gap: 8, paddingRight: 16 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: WARM_CARD, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  chipOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: RivalButtonColors.fill },
  chipText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.textSecondary },
  chipTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },

  card: { backgroundColor: WARM_CARD, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', padding: 16, gap: 12 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  cardHint: { fontSize: 11.5, color: 'rgba(255,255,255,0.4)' },

  durationBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, paddingVertical: 14,
  },
  durationPart: { alignItems: 'center', minWidth: 96 },
  durationInput: {
    width: 96, textAlign: 'center', padding: 0, fontSize: 38, fontWeight: '300', color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  durationUnit: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  durationColon: { fontSize: 32, fontWeight: '300', color: 'rgba(255,255,255,0.35)', marginBottom: 16 },

  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  statLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statInput: {
    flex: 1, minWidth: 0, padding: 0, fontSize: 26, fontWeight: '300', color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  statUnit: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },

  dateInput: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontSize: 15, fontWeight: '600',
  },

  mediaRow: { gap: 8, paddingTop: 6, paddingRight: 8 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  thumbVideo: { alignItems: 'center', justifyContent: 'center' },
  thumbOrder: {
    position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10,
    backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center',
  },
  thumbOrderText: { fontSize: 11, fontWeight: '800', color: RivalColors.onAccentFill },
  thumbCover: { position: 'absolute', left: 5, bottom: 5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.55)' },
  thumbCoverText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4, color: '#fff' },
  addTile: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,209,190,0.35)',
  },
  addTileText: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText },

  journal: { borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 16, paddingVertical: 14 },
  journalRule: {
    width: 60, height: 1, marginTop: 6, marginBottom: 10,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(90deg, rgba(217,119,87,0) 0%, rgba(217,119,87,0.6) 25%, rgba(217,119,87,0.6) 75%, rgba(217,119,87,0) 100%)',
    } as any : { backgroundColor: 'rgba(217,119,87,0.6)' }),
  },
  journalInput: {
    minHeight: 88, padding: 0, textAlignVertical: 'top',
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 16, lineHeight: 22, color: 'rgba(255,255,255,0.85)',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },

  liftsHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  liftsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liftsCount: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center' },
  liftsCountText: { fontSize: 10.5, fontWeight: '800', color: RivalColors.onAccentFill },
  liftsToggle: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,209,190,0.10)', alignItems: 'center', justifyContent: 'center' },
  liftsToggleOpen: { backgroundColor: 'rgba(255,209,190,0.16)' },

  unitToggle: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 999, padding: 3, gap: 2 },
  unitBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999 },
  unitBtnOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  unitText: { fontSize: 12.5, fontWeight: '800', color: RivalColors.textSecondary },
  unitTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },

  lift: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 12, gap: 10 },
  liftNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liftIndex: { width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22, fontSize: 11, fontWeight: '800', color: RivalColors.accentText, backgroundColor: 'rgba(255,209,190,0.10)', overflow: 'hidden' },
  liftName: {
    flex: 1, minWidth: 0, padding: 0, fontSize: 15.5, fontWeight: '700', color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  liftRemove: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  suggestBox: { backgroundColor: '#2a221e', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  suggestItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11 },
  suggestText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  suggestPb: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(255,209,190,0.12)' },
  suggestPbText: { fontSize: 10, fontWeight: '800', color: RivalColors.accentText },
  liftFields: { flexDirection: 'row', gap: 8 },
  liftField: { flex: 1, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 10, paddingVertical: 8, gap: 2 },
  liftFieldLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' },
  liftFieldInput: {
    width: '100%', textAlign: 'center', padding: 0, fontSize: 22, fontWeight: '300', color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  addLift: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,209,190,0.35)',
  },
  addLiftText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },

  dangerZone: { alignItems: 'center', paddingVertical: 18 },
  dangerText: { fontSize: 13.5, fontWeight: '700', color: '#ff8f8f' },
  discardText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.textSecondary },

  saveBar: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, gap: 8,
    backgroundColor: '#110e0c', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  saveBarError: { textAlign: 'center' },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  effortBlock: { minWidth: 92 },
  effortLine: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  effortNum: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  effortUnit: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  effortSub: { fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.45)', marginTop: 1 },
  effortEmpty: { fontSize: 11.5, fontWeight: '600', lineHeight: 15, color: 'rgba(255,255,255,0.45)' },
  saveBtn: { flex: 1, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.55 },
  saveBtnText: { fontSize: 15.5, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill), letterSpacing: 0.2 },
});
