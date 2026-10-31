import { distanceUnit, elevationUnit, formatSpeedOrPace, fromDisplayDistance, fromDisplayElevation, toDisplayDistance, toDisplayElevation } from '../lib/units';
import { defaultActivityName } from '../lib/activityName';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, Image, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { selectAll } from '../lib/selectAll';
import { tilesFor, useRecentTypes } from '../lib/recentTypes';
import { activityDeleted } from '../lib/activityEvents';
import { calculateEffortScore, effortBreakdown, loadScoringConfig, ScoringConfig } from '../lib/effort';
import { isoToDisplayDate, displayToIsoDate, friendlyDate } from '../lib/dateFormat';
import { suggestLifts } from '../lib/liftSuggest';
import { findMatchingRaceId } from '../lib/raceMatch';
import { formatDuration, formatDurationClock } from '../lib/format';
import { confirmAction, notify } from '../lib/notify';
import { loadSavedWorkout } from '../lib/savedWorkouts';
import { CANONICAL_LIFTS, matchCanonicalLift } from '../lib/lifts';
import { bestFor, lastTimeFor, percentWeight, repeatOptions, type LiftActivity, type LiftEntry, type LiftLine, type SavedWorkout } from '../lib/liftHistory';
import { RivalButton, RivalCard, RivalIcon, activityIconName, RivalBackButton, RivalDateField, GreyPageHead, GreyRows, GreyRow, GreyCalendar, GREY_PAGE_BG, rb } from '../components/rival';
import { CoverImage } from '../components/rival/CoverImage';
import { MediaPicker, pickMediaFiles, MAX_MEDIA, MAX_VIDEOS, MAX_VIDEO_SECONDS, type MediaItem } from '../components/rival/MediaPicker';
import { MEDIA_COLUMNS, existingAsItems, saveArrangement, type MediaRow } from '../lib/activityMedia';
import { RivalColors, RivalRadius, RivalSerifFamily, RivalType, RivalButtonColors, PHONE_CARD_BG, RivalGhost } from '../constants/rivalTheme';
import { sidePageWide, SIDE_PAGE_MAX_WIDTH } from '../constants/breakpoints';
import { BusyText } from '../components/rival/BusyText';
import { TrainingPartners } from '../components/rival/TrainingPartners';
import { tagTeammates, withinTagWindow, TAG_WINDOW_HOURS } from '../lib/sharedActivities';
import { backToOrigin, goToTab } from '../lib/tabNav';
import { MilestonePhotoPrompt } from '../components/rival/MilestonePhotoPrompt';
import { useKeyboardOpen } from '../lib/keyboard';

// `markedPb`: a first-time lift the person says is a personal best (lib/liftPb.ts).
// `pct`: the weight was set as a percentage of the person's best (liftHistory.ts).
type Exercise = { name: string; sets?: number; reps?: number; weight?: number; markedPb?: boolean; pct?: number };

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

// Phone tiles, as in the review mockup; See all adds the rest.
// Workout and HYROX in place of Hike and HIIT (Ricky, 2026-10-18: used more).
// Workout sits apart from Weights so the two dumbbells aren't side by side (Ricky, 2026-10-23).
// Gym activities, where the Lifts row is offered.
const LIFT_TYPES = new Set(['WeightTraining', 'Workout', 'CrossFit', 'Hyrox', 'HIIT', 'Bootcamp']);
// Long enough that the four quick tiles stay full as lifts are added.
const MAIN_LIFTS = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press', 'Pull-up', 'Barbell Row', 'Lat Pulldown', 'Incline Bench Press', 'Dip', 'Bicep Curl', 'Lunge', 'Leg Press', 'Hip Thrust'];

// Shorter on a quick tile, to stay within two lines clear of the icon.
const QUICK_LIFT_LABELS: Record<string, string> = {
  'Incline Bench Press': 'Incline Bench', 'Dumbbell Bench Press': 'Dumbbell Bench', 'Close Grip Bench Press': 'Close Grip Bench',
  'Pause Bench Press': 'Pause Bench', 'Incline Dumbbell Press': 'Incline Dumbbell', 'Bulgarian Split Squat': 'Bulgarian Split',
};

const PHONE_TILES = ['Run', 'Ride', 'Swim', 'CrossFit', 'WeightTraining', 'Hyrox', 'Workout'];
// See all: every type RIVAL scores (scoring_config), grouped, with a search
// (Ricky, 2026-10-29, design/all-types-mockup.png). The seven tiles are left
// out of the groups, as they are already on screen.
const TYPE_GROUPS: [string, string[]][] = [
  ['Run and walk', ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike', 'TrackAndField']],
  ['Ride', ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide', 'Handcycle', 'Velomobile']],
  ['Gym and classes', ['WeightTraining', 'Workout', 'CrossFit', 'Hyrox', 'HIIT', 'Bootcamp', 'Yoga', 'Pilates', 'Elliptical', 'StairStepper', 'VirtualRow']],
  ['Water', ['Swim', 'Rowing', 'Kayaking', 'Canoeing', 'StandUpPaddling', 'Surfing', 'Kitesurf', 'Windsurf', 'Sail']],
  ['Racket sports', ['Tennis', 'Squash', 'Pickleball', 'Badminton', 'TableTennis', 'Racquetball']],
  ['Team sports', ['Basketball', 'Football', 'Soccer', 'Rugby', 'Cricket', 'Volleyball', 'Handball', 'FieldHockey', 'IceHockey', 'Lacrosse', 'Frisbee']],
  ['Winter', ['AlpineSki', 'BackcountrySki', 'NordicSki', 'Snowboard', 'Snowshoe', 'IceSkate']],
  ['Other', ['Golf', 'MartialArts', 'Fencing', 'RockClimbing', 'InlineSkate', 'RollerSki', 'Skateboard', 'Wheelchair']],
];
const ALL_TYPES = TYPE_GROUPS.flatMap(([, types]) => types);
const TILE_NAMES: Record<string, string> = {
  WeightTraining: 'Weights', Hyrox: 'HYROX', TrailRun: 'Trail run', HIIT: 'HIIT', CrossFit: 'CrossFit', VirtualRun: 'Treadmill', VirtualRide: 'Indoor ride',
  VirtualRow: 'Indoor row', MountainBikeRide: 'Mountain bike', EBikeRide: 'E-bike', EMountainBikeRide: 'E-MTB', StandUpPaddling: 'Paddle board',
  BackcountrySki: 'Ski touring', Sail: 'Sailing', TrackAndField: 'Track and field',
};
// The activity name is a short label that fits one line on a feed card; the
// story goes in the journal (Ricky, 2026-10-08).
const NAME_MAX = 30;

function tileLabel(t: string): string {
  if (TILE_NAMES[t]) return TILE_NAMES[t];
  const words = t.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Class formats: the time entered is scored as it is, with a note under a
// short one asking for the full class time if it was a class (no 45-minute
// minimum since 2026-10-27, as on the scan screen).
const CLASS_BASED_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT', 'Bootcamp']);

// Quick tiles under the numbers (Ricky, 2026-10-29, other-types-mockup.png).
// Distance types get Time and Distance side by side and these distances, in
// km (shown in the chosen units); everything else one Time card with these
// lengths in minutes. The person's usual one is marked, from their history.
const DISTANCE_PRESETS: Record<string, number[]> = {
  Run: [5, 10, 15, 21.1], TrailRun: [5, 10, 15, 21.1], VirtualRun: [5, 8, 10, 15],
  Walk: [3, 5, 8, 10], Hike: [5, 10, 15, 20],
  Ride: [20, 40, 60, 100], VirtualRide: [20, 30, 40, 60], MountainBikeRide: [10, 20, 30, 40], GravelRide: [20, 40, 60, 100], EBikeRide: [10, 20, 30, 40],
  Swim: [1, 1.5, 2, 3], Rowing: [2, 5, 10, 21.1], VirtualRow: [2, 5, 10, 21.1],
  Kayaking: [5, 10, 15, 20], Canoeing: [5, 10, 15, 20], StandUpPaddling: [3, 5, 8, 10],
  NordicSki: [5, 10, 15, 20], Snowshoe: [3, 5, 8, 10], InlineSkate: [5, 10, 15, 20], EMountainBikeRide: [10, 20, 30, 40],
};
const CLASS_LENGTHS = [45, 60, 75, 90];
const TIME_LENGTHS = [30, 45, 60, 75];

/** A time in minutes, as the Time tiles take it: 60:00 rather than 1:00:00. */
function minutesClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The value logged most often, if it came up at least twice. */
function usualOf(values: number[]): number | null {
  const counts = new Map<number, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  let best: number | null = null;
  let most = 1;
  counts.forEach((n, v) => { if (n > most) { best = v; most = n; } });
  return best;
}


function todayDisplay(): string {
  const d = new Date();
  return isoToDisplayDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

export default function ManualEntryScreen() {
  const { width } = useWindowDimensions();
  const wide = sidePageWide(width);
  // While typing, the Log activity bar and the home-indicator gap step
  // aside, so the field sits right above the keyboard (Ricky, 2026-10-24).
  const typing = useKeyboardOpen();
  // Prefills the date when opened from the Month calendar ("tap a logged-
  // looking empty day" → jump straight to logging that day), passed as
  // ?date=YYYY-MM-DD. Falls back to today for every other entry point
  // (the FAB, "Add Workout" screen, etc. never pass this param).
  const { date: prefillDateIso, editId, saved: savedParam } = useLocalSearchParams<{ date?: string; editId?: string; saved?: string }>();
  const isEditMode = !!editId;

  // From a saved workout it starts on Weights, so the page doesn't open on
  // Run and then switch.
  const [workoutType, setWorkoutType] = useState(savedParam ? 'WeightTraining' : 'Run');
  const [showAllTypes, setShowAllTypes] = useState(false);
  // The seven tiles: the person's own types first (lib/recentTypes.ts).
  const recentTypes = useRecentTypes();
  const tiles = tilesFor(recentTypes, PHONE_TILES);
  const [typeQuery, setTypeQuery] = useState('');
  const [calOpen, setCalOpen] = useState(false);
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
  // The numbers an edited activity was loaded with, and whether its owner had
  // confirmed it as correct. The confirmation holds only while those numbers
  // stay the same; changing them means the new ones are checked again.
  const [loadedReview, setLoadedReview] = useState<{ type: string; seconds: number; meters: number; climb: number; confirmed: boolean } | null>(null);
  const [elevationM, setElevationM] = useState('');
  // Treadmills show incline, not metres climbed. On a Treadmill activity the
  // climb is entered as the average incline and worked out from the distance:
  // metres climbed = distance x incline %.
  const [inclinePct, setInclinePct] = useState('');
  const isTreadmill = workoutType === 'VirtualRun';
  useEffect(() => {
    // Phone only for now: desktop keeps its metres field (mobile-only phase).
    if (!isTreadmill || wide) return;
    const km = distanceKm.trim() === '' ? 0 : fromDisplayDistance(Number(distanceKm)) || 0;
    const pct = Number(inclinePct) || 0;
    const climbM = km > 0 && pct > 0 ? km * 1000 * (pct / 100) : 0;
    setElevationM(climbM > 0 ? String(Math.round(toDisplayElevation(climbM))) : '');
  }, [isTreadmill, inclinePct, distanceKm, wide]);
  const [notes, setNotes] = useState('');
  // Teammates picked before the activity exists; tagged once it has saved.
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [journalOpen, setJournalOpen] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [showExercises, setShowExercises] = useState(false);
  const [showRepeats, setShowRepeats] = useState(false);
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
  const [milestoneCheck, setMilestoneCheck] = useState<{ activityId: string; userId: string } | null>(null);
  const [savedHasPhoto, setSavedHasPhoto] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  // Preserves the original time-of-day (not just the date) when editing, so
  // changing only the date field doesn't quietly reset an activity logged at
  // 6am to whatever time you happen to be editing it.
  const [originalStartedAt, setOriginalStartedAt] = useState<Date | null>(null);
  // Start time of day, shown as 12-hour clock fields. A new entry starts at
  // the current time; editing shows the activity's own (Ricky, 2026-10-09: a
  // watch with a wrong clock needs its run's time put right here).
  const [startHour, setStartHour] = useState(() => String(((new Date().getHours() + 11) % 12) + 1));
  const [startMin, setStartMin] = useState(() => String(new Date().getMinutes()).padStart(2, '0'));
  const [startPm, setStartPm] = useState(() => new Date().getHours() >= 12);
  // What the activity said when it was opened for editing, so a save can tell
  // which of the imported details were changed by hand.
  const [loadedFrom, setLoadedFrom] = useState<{ provider: string | null; name: string } | null>(null);
  // What a blank name will be saved as.
  const namePlaceholder = defaultActivityName(workoutType, isEditMode && originalStartedAt ? originalStartedAt : new Date());
  // Held in state so the "≈ N Effort" hint can be computed synchronously on
  // every keystroke. Without it the hint fell back to the unknown-type
  // default and credited no elevation, so it read ~48 where the activity
  // would actually save as 92 — worse than showing nothing.
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig | null>(null);
  useEffect(() => { loadScoringConfig().then(setScoringConfig); }, []);

  // The lifts logged before, so a lift logged for the first time can offer
  // "Personal best" (Ricky, 2026-10-23). Null until loaded: no switch yet.
  // Opened from a saved workout, the page waits for the workout and the lift
  // history, then fades in once, filled in: the tiles, main lifts and rows
  // otherwise moved as each arrived (Ricky, 2026-10-27: "the tiles kind of
  // start jumping around"). Shown anyway after 2.5s.
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [savedLoaded, setSavedLoaded] = useState(!savedParam);
  const [holdTimedOut, setHoldTimedOut] = useState(false);
  useEffect(() => {
    if (!savedParam) return;
    const t = setTimeout(() => setHoldTimedOut(true), 2500);
    return () => clearTimeout(t);
  }, [savedParam]);
  const formReady = !savedParam || holdTimedOut || (savedLoaded && historyLoaded);
  const [priorLifts, setPriorLifts] = useState<{ lift: string; activityId: string | null; at: number }[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      try {
        const rows = await selectAll<any>((from, to) => supabase.from('exercise_entries')
          .select('id, activity_id, exercise_name, weight_kg, reps, performed_at').eq('user_id', user.id).order('id').range(from, to));
        setPriorLifts(rows.map((r) => ({ lift: r.exercise_name, activityId: r.activity_id, at: new Date(r.performed_at).getTime() })));
        setLiftEntries(rows.filter((r) => r.activity_id).map((r) => ({ name: r.exercise_name, weightKg: Number(r.weight_kg) || 0, reps: r.reps, at: r.performed_at })));
      } catch {}
      // Past activities' lifts (sets, reps and weight are kept on the
      // activity) and saved workouts, for Repeat a workout and last time.
      const { data: acts } = await supabase.from('activities')
        .select('id, started_at, activity_type, exercises').eq('user_id', user.id).not('exercises', 'is', null)
        .order('started_at', { ascending: false }).limit(300);
      setLiftHistory((acts ?? []).filter((a: any) => Array.isArray(a.exercises) && a.exercises.length)
        .map((a: any) => ({ id: a.id, startedAt: a.started_at, activityType: a.activity_type, exercises: a.exercises })));
      const { data: lastLogged } = await supabase.from('activities')
        .select('activity_type, duration_seconds').eq('user_id', user.id).eq('provider', 'rival_manual')
        .gt('duration_seconds', 0).order('started_at', { ascending: false }).limit(200);
      const lastTimes: Record<string, number> = {};
      for (const r of lastLogged ?? []) if (!(r.activity_type in lastTimes)) lastTimes[r.activity_type] = r.duration_seconds;
      lastTimeByType.current = lastTimes;
      // Every source, last six months: the usual time and distance per type.
      const { data: recent } = await supabase.from('activities')
        .select('activity_type, duration_seconds, distance_meters').eq('user_id', user.id)
        .gte('started_at', new Date(Date.now() - 183 * 86400000).toISOString())
        .order('started_at', { ascending: false }).limit(500);
      setTypeHistory((recent ?? []).map((r: any) => ({ type: r.activity_type, seconds: r.duration_seconds ?? 0, meters: r.distance_meters ?? 0 })));
      const { data: saved } = await supabase.from('saved_workouts')
        .select('id, name, activity_type, exercises, last_used_at, usual_day').order('last_used_at', { ascending: false });
      setSavedWorkouts((saved ?? []).map((s: any) => ({ id: s.id, name: s.name, activityType: s.activity_type, exercises: s.exercises ?? [], lastUsedAt: s.last_used_at, usualDay: s.usual_day ?? null })));
    })().finally(() => setHistoryLoaded(true));
  }, []);
  // Picking a tile fills in the time last logged by hand for that type, one
  // step quicker for a regular activity (Ricky, 2026-10-28). Only into an
  // empty time, or one this filled in itself: never over a typed time.
  const lastTimeByType = useRef<Record<string, number>>({});
  const [typeHistory, setTypeHistory] = useState<{ type: string; seconds: number; meters: number }[]>([]);
  const autoTime = useRef<string | null>(null);
  function pickType(t: string) {
    setWorkoutType(t);
    if (isEditMode) return;
    const current = `${durationMin}:${durationSec}`;
    if (current !== ':' && current !== autoTime.current) return;
    const last = lastTimeByType.current[t];
    const min = last ? String(Math.floor(last / 60)) : '';
    const sec = last && last % 60 ? String(last % 60).padStart(2, '0') : '';
    setDurationMin(min);
    setDurationSec(sec);
    autoTime.current = `${min}:${sec}`;
  }
  // Lifts made quicker (Ricky, 2026-10-24): last time's numbers faded,
  // percentages of a best, and workouts to repeat (lib/liftHistory.ts).
  const [liftEntries, setLiftEntries] = useState<LiftEntry[]>([]);
  const [liftHistory, setLiftHistory] = useState<LiftActivity[]>([]);
  const [savedWorkouts, setSavedWorkouts] = useState<SavedWorkout[]>([]);
  const [pctFocus, setPctFocus] = useState<number | null>(null);
  const [savingWorkout, setSavingWorkout] = useState<string | null>(null);
  const [workoutMsg, setWorkoutMsg] = useState<string | null>(null);
  // A saved workout's ⋯: which one is open, and the name being edited.
  const [savedMenu, setSavedMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      const { data, error } = await supabase.from('activities').select('*').eq('id', editId).single();
      if (error || !data) { setGeneralError('Could not load this activity'); setLoadingEdit(false); return; }
      setWorkoutType(data.activity_type || 'Run');
      setWorkoutName(data.name || '');
      const started = new Date(data.started_at);
      setOriginalStartedAt(started);
      setStartHour(String(((started.getHours() + 11) % 12) + 1));
      setStartMin(String(started.getMinutes()).padStart(2, '0'));
      setStartPm(started.getHours() >= 12);
      setLoadedFrom({ provider: data.provider ?? null, name: data.name || '' });
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
      // A saved treadmill climb shows as the incline it came from.
      if (data.activity_type === 'VirtualRun' && data.distance_meters > 0 && data.elevation_meters > 0) {
        setInclinePct(String(Math.round((data.elevation_meters / data.distance_meters) * 1000) / 10));
      }
      setLoadedReview({
        type: data.activity_type, seconds: data.duration_seconds ?? 0, meters: data.distance_meters ?? 0,
        climb: data.elevation_meters ?? 0, confirmed: !!data.effort_confirmed,
      });
      setNotes(data.notes || '');
      if (Array.isArray(data.exercises)) setExercises(data.exercises);
      const { data: mediaRows } = await supabase.from('activity_media').select(MEDIA_COLUMNS).eq('activity_id', editId);
      const rows = (mediaRows ?? []) as MediaRow[];
      setSavedMedia(rows);
      setSavedCover(data.photo_url ?? null);
      if (!wide) setMedia(existingAsItems(rows, data.photo_url ?? null, { x: data.photo_focal_x ?? null, y: data.photo_focal_y ?? null }));
      setLoadingEdit(false);
    })();
  }, [editId]);

  // Projected effort so the user gets immediate feedback before saving.
  const durationSeconds = (() => {
    const mins = durationMin.trim() === '' ? 0 : Number(durationMin);
    const secs = durationSec.trim() === '' ? 0 : Number(durationSec);
    const raw = (Number.isFinite(mins) ? mins * 60 : 0) + (Number.isFinite(secs) ? secs : 0);
    return raw;
  })();

  // A new entry is taken to have just finished: the start time follows the
  // time entered (10 min logged at 7:31 starts at 7:21), until the start
  // time is set by hand (Ricky, 2026-10-24). Editing never moves it.
  const startTouched = useRef(false);
  const enteredSeconds = (Number(durationMin) || 0) * 60 + (Number(durationSec) || 0);
  useEffect(() => {
    if (isEditMode || startTouched.current) return;
    const start = new Date(Date.now() - enteredSeconds * 1000);
    setStartHour(String(((start.getHours() + 11) % 12) + 1));
    setStartMin(String(start.getMinutes()).padStart(2, '0'));
    setStartPm(start.getHours() >= 12);
    // Started before midnight: it was yesterday's, if the date is still today.
    const today = todayDisplay();
    const startDay = isoToDisplayDate(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`);
    setDateStr((cur) => (cur === today && startDay !== today ? startDay : cur));
  }, [enteredSeconds, isEditMode]);

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
  // A tracked, weighted lift with nothing logged before this activity's day.
  function isFirstLift(ex: Exercise): boolean {
    const lift = matchCanonicalLift(ex.name);
    if (!lift || !ex.weight || !priorLifts) return false;
    const iso = displayToIsoDate(dateStr);
    const dayEnd = iso ? new Date(`${iso}T23:59:59`).getTime() : Date.now();
    const at = isEditMode && originalStartedAt ? originalStartedAt.getTime() : dayEnd;
    return !priorLifts.some((p) => p.lift === lift && p.activityId !== editId && p.at < at);
  }
  function toggleMarkedPb(index: number) {
    setExercises((prev) => prev.map((ex, i) => i === index ? { ...ex, markedPb: !ex.markedPb } : ex));
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
  // Earlier than this activity: what "last time" and "your best" are read from.
  const liftBeforeMs = isEditMode && originalStartedAt ? originalStartedAt.getTime() : Infinity;
  const pastLifts = liftHistory.filter((a) => a.id !== editId);
  const lastTime = (ex: Exercise) => (ex.name.trim() ? lastTimeFor(pastLifts, ex.name, liftBeforeMs) : null);
  const bestOf = (ex: Exercise) => (ex.name.trim() ? bestFor(liftEntries.filter((e) => liftBeforeMs === Infinity || new Date(e.at).getTime() < liftBeforeMs), ex.name) : null);
  function keepLastTime(index: number, field?: 'sets' | 'reps' | 'weight') {
    setExercises((prev) => prev.map((ex, i) => {
      if (i !== index) return ex;
      const last = lastTime(ex);
      if (!last) return ex;
      const pick = (f: 'sets' | 'reps' | 'weight') => (ex[f] == null && last[f] != null && (!field || field === f) ? { [f]: last[f] } : {});
      return { ...ex, ...pick('sets'), ...pick('reps'), ...pick('weight') };
    }));
  }
  function setPctMode(index: number, on: boolean) {
    setExercises((prev) => prev.map((ex, i) => {
      if (i !== index) return ex;
      if (!on) return { ...ex, pct: undefined };
      const best = bestOf(ex);
      // 0 marks % as chosen before anything is typed.
      return { ...ex, pct: best && ex.weight ? Math.round((ex.weight / best.kg) * 100) : 0 };
    }));
  }
  function updatePct(index: number, value: string) {
    setExercises((prev) => prev.map((ex, i) => {
      if (i !== index) return ex;
      const pct = value.trim() === '' ? undefined : Number(value);
      const best = bestOf(ex);
      if (pct == null || !Number.isFinite(pct)) return { ...ex, pct: 0, weight: undefined };
      return { ...ex, pct, weight: best ? percentWeight(best.kg, pct, weightUnit) : undefined };
    }));
  }
  const repeats = repeatOptions(pastLifts, savedWorkouts, new Date());
  function applyRepeat(lines: LiftLine[], savedId?: string) {
    const picked = lines.filter((l) => l?.name?.trim()).map((l): Exercise => ({ name: l.name, sets: l.sets, reps: l.reps, weight: l.weight }));
    // Weights: all of them added, with a fresh one on top for anything extra.
    setExercises(workoutType === 'WeightTraining' ? [...picked, { name: '' }] : picked);
    setShowRepeats(false);
    if (savedId) supabase.from('saved_workouts').update({ last_used_at: new Date().toISOString() }).eq('id', savedId).then(() => {});
  }
  // One save at a time: on a slow connection a second tap made a second
  // copy (Ricky, 2026-10-24: "Chest day" was saved twice).
  const workoutBusy = useRef(false);
  const [workoutSaving, setWorkoutSaving] = useState(false);
  async function saveWorkout() {
    if (workoutBusy.current) return;
    workoutBusy.current = true;
    setWorkoutSaving(true);
    try { await saveWorkoutNow(); } finally { workoutBusy.current = false; setWorkoutSaving(false); }
  }
  async function saveWorkoutNow() {
    const name = (savingWorkout ?? '').trim();
    if (!name) return;
    const lines = exercises.filter((e) => e.name.trim()).map((e) => ({ name: matchCanonicalLift(e.name) || e.name.trim(), sets: e.sets, reps: e.reps, weight: e.weight }));
    // The name of one already saved updates it with these lifts: how a
    // routine that has changed is kept current.
    const same = savedWorkouts.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
    if (same) {
      const now = new Date().toISOString();
      const { error, count } = await supabase.from('saved_workouts')
        .update({ exercises: lines, activity_type: workoutType, last_used_at: now }, { count: 'exact' }).eq('id', same.id);
      if (error || !count) { setWorkoutMsg(`The saved activity could not be updated: ${error?.message ?? 'not found'}`); return; }
      setSavedWorkouts((prev) => prev.map((s) => (s.id === same.id ? { ...s, exercises: lines, lastUsedAt: now } : s)));
      setSavingWorkout(null);
      setWorkoutMsg(`Updated ${same.name}.`);
      return;
    }
    const { data, error } = await supabase.from('saved_workouts')
      .insert({ name, activity_type: workoutType, exercises: lines }).select('id, last_used_at').single();
    if (error || !data) { setWorkoutMsg(`The activity could not be saved: ${error?.message ?? 'unknown error'}`); return; }
    setSavedWorkouts((prev) => [{ id: data.id, name, activityType: workoutType, exercises: lines, lastUsedAt: data.last_used_at }, ...prev]);
    setSavingWorkout(null);
    setWorkoutMsg(`Saved as ${name}.`);
  }

  async function renameSaved() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    const { error, count } = await supabase.from('saved_workouts').update({ name }, { count: 'exact' }).eq('id', renaming.id);
    if (error || !count) { setWorkoutMsg(`The saved activity could not be renamed: ${error?.message ?? 'not found'}`); return; }
    setSavedWorkouts((prev) => prev.map((s) => (s.id === renaming.id ? { ...s, name } : s)));
    setRenaming(null);
  }
  async function deleteSaved(id: string, name: string) {
    setSavedMenu(null);
    const sure = await confirmAction({ title: `Delete ${name}?`, message: 'It will no longer be offered under Repeat an activity. Activities already logged are not changed.', confirmLabel: 'Delete', destructive: true });
    if (!sure) return;
    const { error, count } = await supabase.from('saved_workouts').delete({ count: 'exact' }).eq('id', id);
    if (error || !count) { setWorkoutMsg(`The saved activity could not be deleted: ${error?.message ?? 'not found'}`); return; }
    setSavedWorkouts((prev) => prev.filter((s) => s.id !== id));
  }

  // Canonical-lift name suggestions (substring match) so a typed "shoulder"
  // surfaces "Overhead Press" and the lift feeds the PR tracker on save.
  // An empty name offers the person's own lifts, most recent first, not
  // already in this activity: their usual lift is one tap (Ricky, 2026-10-23).
  function recentLifts(): string[] {
    const inUse = new Set(exercises.map((ex) => matchCanonicalLift(ex.name)).filter(Boolean));
    const seen: string[] = [];
    [...(priorLifts ?? [])].sort((a, b) => b.at - a.at).forEach((p) => {
      if (CANONICAL_LIFTS.includes(p.lift) && !inUse.has(p.lift) && !seen.includes(p.lift)) seen.push(p.lift);
    });
    return seen.slice(0, 6);
  }

  function liftSuggestions(input: string): string[] {
    const q = (input || '').trim().toLowerCase();
    if (!q) return recentLifts();
    if (matchCanonicalLift(input)) return [];
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
    // Its lifts go too, or they'd still count in the PB history (the rows
    // only lose their activity link when it's deleted).
    const { error: liftsError } = await supabase.from('exercise_entries').delete().eq('activity_id', editId);
    if (liftsError) notify('Its lifts were not removed from the history', liftsError.message);
    // Close its card on the Activity tab, so it's plainly gone.
    activityDeleted(editId);
    backToOrigin();
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
      const stillConfirmed = !!loadedReview?.confirmed && loadedReview.type === workoutType
        && loadedReview.seconds === durationSeconds && Math.abs(loadedReview.meters - distance * 1000) < 1
        && Math.abs(loadedReview.climb - elevation) < 1;
      const effortScore = calculateEffortScore(
        workoutType,
        durationSeconds,
        elevation,
        await loadScoringConfig(),
        distance * 1000,
        stillConfirmed,
      );

      const [y, m, d] = isoDate.split('-').map(Number);
      // Editing keeps the activity's original time-of-day — only the
      // date portion is replaceable here, so a 6am run stays a 6am run
      // even if you only meant to fix its distance.
      const timeSource = isEditMode && originalStartedAt ? originalStartedAt : new Date();
      const name = workoutName.trim() || defaultActivityName(workoutType, timeSource);
      const hour12 = Math.min(12, Math.max(1, Number(startHour) || 12));
      const minute = Math.min(59, Math.max(0, Number(startMin) || 0));
      const hour24 = (hour12 % 12) + (startPm ? 12 : 0);
      // Seconds are kept from the original when the clock time wasn't touched,
      // so opening and saving an activity doesn't nudge its start at all.
      const sameClock = hour24 === timeSource.getHours() && minute === timeSource.getMinutes();
      const startedAt = new Date(y, m - 1, d, hour24, minute, sameClock ? timeSource.getSeconds() : 0);
      // An imported activity (Strava) is refreshed by every sync. What was
      // changed by hand here is locked so the next sync keeps it: the name, and
      // the start time (a watch with a wrong clock uploads the wrong day).
      const imported = isEditMode && !!loadedFrom?.provider && loadedFrom.provider !== 'manual';
      const locks: Record<string, boolean> = {};
      if (imported && workoutName.trim() && workoutName.trim() !== loadedFrom!.name) locks.name_locked = true;
      if (imported && originalStartedAt && Math.abs(startedAt.getTime() - originalStartedAt.getTime()) >= 60 * 1000) locks.started_at_locked = true;

      // Only keep exercises the user actually named; tag canonical lifts so
      // they group with existing PR history in the feed/activity record.
      const namedExercises = exercises.filter((ex) => ex.name.trim());
      const exercisesPayload = namedExercises.length > 0
        ? namedExercises.map((ex) => {
            const canonical = matchCanonicalLift(ex.name);
            // The mark only counts on a first-time lift; anything else is judged by weight.
            const { markedPb, pct, ...plain } = ex;
            // A percentage is kept with the lift only when one was typed.
            const rest = pct ? { ...plain, pct } : plain;
            const kept = markedPb && isFirstLift(ex) ? { ...rest, markedPb: true } : rest;
            return canonical ? { ...kept, prLift: canonical } : kept;
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
            // The phone's own time zone, so the time of day shows where it happened.
            utc_offset_seconds: -startedAt.getTimezoneOffset() * 60,
            effort_score: effortScore,
            raw_effort_score: effortScore,
            effort_confirmed: stillConfirmed,
            notes: notes.trim() || null,
            exercises: exercisesPayload,
            race_id: raceId,
            ...locks,
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
            // The phone's own time zone, so the time of day shows where it happened.
            utc_offset_seconds: -startedAt.getTimezoneOffset() * 60,
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
        if (partnerIds.length > 0) {
          const tagged = await tagTeammates(activityId, partnerIds);
          if (!tagged.ok) setGeneralError(`Activity saved, but the activity partners were not added: ${tagged.error ?? 'try again from the activity'}`);
        }
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
        if (liftErr) setGeneralError(`Activity saved, but the lifts didn't attach: ${liftErr.message}`);
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
        if (result.errors.length) setGeneralError(`Activity saved, but: ${result.errors[0]}`);
        coverUrl = result.cover;
      }

      // Milestones are earned off total hours — recheck fire-and-forget.
      const { data: { session } } = await supabase.auth.getSession();
      if (session) fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
      }).catch(() => {});

      if (isEditMode) {
        backToOrigin();
        return;
      }
      setSavedActivityId(activityId);
      setSavedHasPhoto(!!coverUrl);
      // With a photo, offer to AI-enhance before leaving; otherwise head to the feed.
      if (!coverUrl) setMilestoneCheck({ activityId, userId: user.id });
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
      <Text style={styles.panelLabel}>ACTIVITY TYPE</Text>
      <View style={styles.typeGrid}>
        {TYPE_OPTIONS.map((opt) => {
          const selected = workoutType === opt.type;
          return (
            <TouchableOpacity
              key={opt.type}
              style={[styles.typeCard, selected && styles.typeCardSelected]}
              onPress={() => pickType(opt.type)}
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
        <Text style={styles.fieldLabel}>ACTIVITY NAME</Text>
        <TextInput
          style={styles.input}
          value={workoutName}
          onChangeText={(v) => { setWorkoutName(v); if (fieldError?.field === 'name') setFieldError(null); }}
          placeholder={namePlaceholder}
          placeholderTextColor={RivalColors.textSecondary}
          maxLength={NAME_MAX}
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
          keyboardType="numeric" autoComplete="off"
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
          keyboardType="numeric" autoComplete="off"
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
          ≈ {Math.round(calculateEffortScorePreview(workoutType, durationSeconds, elevationM, scoringConfig, distanceKm))} Effort · {formatDuration(durationSeconds)}
        </Text>
      )}
      {CLASS_BASED_TYPES.has(workoutType) && durationSeconds > 0 && durationSeconds < 30 * 60 && (
        <Text style={styles.classHint}>If this was a class, enter the full class time, including the warm-up.</Text>
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
          <Text style={styles.discard}>Discard activity</Text>
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
                  <TextInput style={styles.exFieldInput} value={ex.sets != null ? String(ex.sets) : ''} onChangeText={(v) => updateExerciseNum(i, 'sets', v)} placeholder="-" placeholderTextColor={RivalColors.textSecondary} keyboardType="numeric" autoComplete="off" />
                </View>
                <View style={styles.exField}>
                  <Text style={styles.exFieldLabel}>Reps</Text>
                  <TextInput style={styles.exFieldInput} value={ex.reps != null ? String(ex.reps) : ''} onChangeText={(v) => updateExerciseNum(i, 'reps', v)} placeholder="-" placeholderTextColor={RivalColors.textSecondary} keyboardType="numeric" autoComplete="off" />
                </View>
                <View style={styles.exField}>
                  <Text style={styles.exFieldLabel}>Weight ({weightUnit})</Text>
                  <TextInput style={styles.exFieldInput} value={kgToDisplay(ex.weight)} onChangeText={(v) => updateExerciseNum(i, 'weightDisplay', v)} placeholder="-" placeholderTextColor={RivalColors.textSecondary} keyboardType="numeric" autoComplete="off" />
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
                <View style={[styles.mediaOrder, { pointerEvents: 'none' }]}>
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
  // What counts toward Effort for this sport, so the form can say so: distance
  // only where the sport has a distance rate, climbing only where it has an
  // elevation rate. Mixed sessions (HYROX, CrossFit) are scored on time.
  const scoresDistance = (scoringConfig?.distanceRates?.[workoutType] ?? 0) > 0;
  const scoresClimb = (scoringConfig?.elevationRates?.[workoutType] ?? 0) > 0;
  const enteredKm = distanceKm.trim() === '' ? 0 : Number(distanceKm) || 0;
  const enteredClimb = elevationM.trim() === '' ? 0 : Number(elevationM) || 0;
  // The rows fit the activity (Ricky, 2026-10-24): distance and elevation
  // where the type earns Effort from them, lifts for gym activities.
  // Anything already filled in stays, so a change of type never hides it.
  const showDistance = !scoringConfig || scoresDistance || enteredKm > 0;
  const showClimb = isTreadmill || !scoringConfig || scoresClimb || enteredClimb > 0;
  const namedLifts = exercises.filter((e) => e.name?.trim()).length;
  const showLifts = LIFT_TYPES.has(workoutType) || namedLifts > 0;
  // Weights: the workout is the page, straight under the type (Ricky,
  // 2026-10-25, mockup approved). Other types keep Lifts as a row.
  const workoutLeads = workoutType === 'WeightTraining';
  // The main lifts as chips: the person's most logged first, then the usual
  // ones, five in all.
  const mainLifts = (() => {
    const counts = new Map<string, number>();
    (priorLifts ?? []).forEach((p) => { if (CANONICAL_LIFTS.includes(p.lift)) counts.set(p.lift, (counts.get(p.lift) ?? 0) + 1); });
    const mine = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
    return [...new Set([...mine, ...MAIN_LIFTS])].slice(0, 5);
  })();
  // Weights starts with a row ready to fill in.
  useEffect(() => {
    if (workoutLeads && !isEditMode) setExercises((prev) => (prev.length ? prev : [{ name: '' }]));
  }, [workoutLeads]);
  // Opened from a saved workout (Add an activity → Saved workouts): its type,
  // name and exercises filled in, last time's numbers faded as usual.
  useEffect(() => {
    if (!savedParam || isEditMode) return;
    loadSavedWorkout(savedParam).then((w) => {
      if (!w) return;
      setWorkoutType(w.activityType || 'WeightTraining');
      setWorkoutName(w.name.slice(0, NAME_MAX));
      applyRepeat(w.exercises, w.id);
      setShowExercises(true);
    }).finally(() => setSavedLoaded(true));
  }, [savedParam]);
  function toggleMainLift(lift: string) {
    setExercises((prev) => {
      const at = prev.findIndex((e) => matchCanonicalLift(e.name) === lift);
      // Tapped again with nothing typed for it yet: taken out.
      if (at >= 0) return prev[at].sets == null && prev[at].reps == null && prev[at].weight == null ? prev.filter((_, i) => i !== at) : prev;
      const blank = prev.findIndex((e) => !e.name.trim());
      if (blank >= 0) return prev.map((e, i) => (i === blank ? { ...e, name: lift } : e));
      return [...prev, { name: lift }];
    });
  }
  const effortParts = [
    formatDuration(durationSeconds),
    ...(scoresDistance && enteredKm > 0 ? [`${enteredKm} ${distanceUnit()}`] : []),
    ...(scoresClimb && enteredClimb > 0 ? [`${enteredClimb} ${elevationUnit()} elevation`] : []),
  ].join(' + ');
  // Faster than the sport allows: less counts until it is confirmed, which
  // the athlete is asked about once it is saved.
  const overLimit = (() => {
    if (!scoringConfig || durationSeconds <= 0) return false;
    const km = distanceKm.trim() === '' ? 0 : fromDisplayDistance(Number(distanceKm)) || 0;
    const climb = elevationM.trim() === '' ? 0 : fromDisplayElevation(Number(elevationM)) || 0;
    const b = effortBreakdown(workoutType, durationSeconds, climb, scoringConfig, km * 1000);
    const unchanged = !!loadedReview?.confirmed && loadedReview.type === workoutType && loadedReview.seconds === durationSeconds
      && Math.abs(loadedReview.meters - km * 1000) < 1 && Math.abs(loadedReview.climb - climb) < 1;
    return b.capped && !unchanged;
  })();
  const effortNow = durationSeconds > 0
    ? Math.round(calculateEffortScorePreview(workoutType, durationSeconds, elevationM, scoringConfig, distanceKm))
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
  // The new activity's start: the chosen day at the current time of day, as
  // saveSession() builds it.
  const draftStart = (() => {
    const iso = displayToIsoDate(dateStr);
    if (!iso) return null;
    const [y, mo, d] = iso.split('-').map(Number);
    const now = new Date();
    return new Date(y, mo - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
  })();
  const partnersStart = isEditMode ? originalStartedAt?.toISOString() ?? null : draftStart;
  const partnersOpen = !!partnersStart && withinTagWindow(partnersStart);
  const partnersCard = isEditMode ? (
    editId && partnersStart ? (
      <View style={m.journal}>
        <Text style={m.cardLabel}>Activity partners</Text>
        <TrainingPartners activityId={editId} startedAt={partnersStart} companions={null} />
      </View>
    ) : null
  ) : partnersOpen && partnersStart ? (
    <View style={m.journal}>
      <Text style={m.cardLabel}>Activity partners</Text>
      <TrainingPartners activityId={null} startedAt={partnersStart} companions={null} draftIds={partnerIds} onDraftChange={setPartnerIds} />
    </View>
  ) : null;

  // An exercise as one row when the workout leads: name and last time on the
  // left, sets, reps and weight on the right, so a whole session fits. The
  // row being typed in opens its extras below: same as last time, a
  // percentage, remove.
  const [openLift, setOpenLift] = useState<number | null>(null);
  const compactLift = (ex: Exercise, i: number) => {
    const last = lastTime(ex);
    const best = bestOf(ex);
    const pctOn = ex.pct != null && !!best;
    const open = openLift === i;
    const named = !!ex.name.trim();
    const tracked = !!matchCanonicalLift(ex.name);
    const ghost = (f: 'sets' | 'reps' | 'weight') => (last && last[f] != null ? (f === 'weight' ? kgToDisplay(last[f]) : String(last[f])) : '');
    const missing = (['sets', 'reps', 'weight'] as const).some((f) => ex[f] == null && last && last[f] != null);
    const lastText = last
      ? `Last time ${[last.sets && last.reps ? `${last.sets} × ${last.reps}` : last.sets ? `${last.sets} sets` : last.reps ? `${last.reps} reps` : '', last.weight != null ? `${kgToDisplay(last.weight)} ${weightUnit}` : ''].filter(Boolean).join(' · ')}`
      : null;
    const box = (f: 'sets' | 'reps', label: string) => (
      <View style={m.cNum}>
        <Text style={m.cNumLabel}>{label}</Text>
        <TextInput
          style={m.cNumInput}
          value={ex[f] != null ? String(ex[f]) : ''}
          onChangeText={(v) => updateExerciseNum(i, f, v)}
          onFocus={() => { setOpenLift(i); if (ex[f] == null && last?.[f] != null) keepLastTime(i, f); }}
          selectTextOnFocus
          placeholder={ghost(f) || '–'}
          placeholderTextColor={ghost(f) ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.25)'}
          keyboardType="numeric" autoComplete="off"
        />
      </View>
    );
    return (
      <View key={i} style={m.cLift}>
        <View style={m.cRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              style={[m.cName, !named && m.liftNameEmpty]}
              value={ex.name}
              onChangeText={(v) => updateExerciseName(i, v)}
              onFocus={() => { setOpenLift(i); setNameSuggestIndex(i); }}
              onBlur={() => setTimeout(() => setNameSuggestIndex((cur) => (cur === i ? null : cur)), 150)}
              placeholder="Exercise name"
              placeholderTextColor="rgba(255,181,158,0.85)"
              autoComplete="off"
              textContentType="none"
            />
            {named ? (
              lastText ? <Text style={m.cSub} numberOfLines={1}>{lastText}</Text>
                : tracked ? <Text style={m.cPb}>PB TRACKED</Text> : null
            ) : null}
          </View>
          <View style={m.cNums}>
            {box('sets', 'Sets')}
            {box('reps', 'Reps')}
            <View style={[m.cNum, pctOn && pctFocus === i && m.liftFieldTyping]}>
              <Text style={m.cNumLabel}>{pctOn ? '%' : weightUnit === 'kg' ? 'Kg' : 'Lb'}</Text>
              {pctOn ? (
                <TextInput
                  style={[m.cNumInput, pctFocus !== i && ex.weight != null && m.liftFieldCalc]}
                  value={pctFocus === i ? (ex.pct ? String(ex.pct) : '') : kgToDisplay(ex.weight)}
                  onChangeText={(v) => updatePct(i, v.replace(/[^\d.]/g, ''))}
                  onFocus={() => { setOpenLift(i); setPctFocus(i); }}
                  onBlur={() => setPctFocus((cur) => (cur === i ? null : cur))}
                  selectTextOnFocus
                  placeholder="%"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="decimal-pad" autoComplete="off"
                />
              ) : (
                <TextInput
                  style={m.cNumInput}
                  value={kgToDisplay(ex.weight)}
                  onChangeText={(v) => updateExerciseNum(i, 'weightDisplay', v)}
                  onFocus={() => { setOpenLift(i); if (ex.weight == null && last?.weight != null) keepLastTime(i, 'weight'); }}
                  selectTextOnFocus
                  placeholder={ghost('weight') || '–'}
                  placeholderTextColor={ghost('weight') ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.25)'}
                  keyboardType="decimal-pad" autoComplete="off"
                />
              )}
            </View>
          </View>
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

        {pctOn && best ? (
          <Text style={m.liftMetaText} numberOfLines={2}>
            {`${ex.pct ? `${ex.pct}% of ` : ''}${kgToDisplay(best.kg)} ${weightUnit}${best.estimated ? `, estimated from ${kgToDisplay(best.from.weightKg)} × ${best.from.reps}` : ', your best'}`}
          </Text>
        ) : null}

        {open || (!named && exercises.length > 1) ? (
          <View style={m.cExtras}>
            {last && missing && !pctOn ? (
              <TouchableOpacity style={m.sameBtn} onPress={() => keepLastTime(i)} activeOpacity={0.8}>
                <Text style={m.sameBtnText}>Same as last time</Text>
              </TouchableOpacity>
            ) : null}
            {best ? (
              <View style={m.pctSeg}>
                {([['kg', false], ['%', true]] as const).map(([label, on]) => (
                  <TouchableOpacity key={label} style={[m.pctSegBtn, pctOn === on && m.pctSegBtnOn]} onPress={() => setPctMode(i, on)}>
                    <Text style={[m.pctSegText, pctOn === on && m.pctSegTextOn]}>{label === 'kg' ? weightUnit : '%'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <TouchableOpacity style={m.cRemove} onPress={() => { removeExercise(i); setOpenLift(null); }} accessibilityRole="button" accessibilityLabel={`Remove ${ex.name || 'exercise'}`}>
              <RivalIcon name="close" size={13} color="rgba(255,255,255,0.5)" />
              <Text style={m.cRemoveText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isFirstLift(ex) ? (
          <TouchableOpacity style={m.firstLift} onPress={() => toggleMarkedPb(i)} activeOpacity={0.8} accessibilityRole="switch" accessibilityState={{ checked: !!ex.markedPb }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[m.firstLiftTitle, ex.markedPb && m.firstLiftTitleOn]}>Personal best</Text>
              <Text style={m.firstLiftSub}>{`First ${matchCanonicalLift(ex.name)} on RIVAL. Turn on if this is a personal best.`}</Text>
            </View>
            <View style={[m.pbSwitch, ex.markedPb && m.pbSwitchOn]}>
              <View style={[m.pbKnob, ex.markedPb && m.pbKnobOn]} />
            </View>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  // Workouts worth repeating today, one tap each (Ricky, 2026-10-24).
  const repeatList = (withOr: boolean) => (
    <View style={m.repeatWrap}>
      {withOr ? <Text style={m.cardLabel}>Repeat an activity</Text> : null}
      {repeats.map((r, ri) => (
        <View key={r.key}>
          {renaming && renaming.id === r.savedId ? (
            <View style={[m.repeatRow, m.repeatRowFirst]}>
              <TextInput
                style={[m.saveWorkoutInput, { backgroundColor: 'transparent', paddingHorizontal: 0 }]}
                value={renaming.name}
                onChangeText={(v) => setRenaming({ ...renaming, name: v.slice(0, 60) })}
                autoFocus
                onSubmitEditing={renameSaved}
              />
              <TouchableOpacity onPress={() => setRenaming(null)}><Text style={m.repeatDetail}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={m.sameBtn} onPress={renameSaved} disabled={!renaming.name.trim()}>
                <Text style={[m.sameBtnText, !renaming.name.trim() && { opacity: 0.4 }]}>Save</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={[m.repeatRow, ri === 0 && m.repeatRowFirst]} activeOpacity={0.8} onPress={() => applyRepeat(r.exercises, r.savedId)} accessibilityRole="button">
              <View style={m.repeatIcon}><RivalIcon name="replay" size={19} color={RivalColors.accentText} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={m.repeatTitle}>{r.title}</Text>
                <Text style={m.repeatDetail}>{r.detail}</Text>
              </View>
              <Text style={m.repeatUse}>Use</Text>
              {/* Only a saved workout has a ⋯: past ones are the
                  activities themselves (Ricky, 2026-10-24). */}
              {r.savedId ? (
                <TouchableOpacity
                  style={m.repeatMore}
                  onPress={() => setSavedMenu((cur) => (cur === r.savedId ? null : r.savedId!))}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  accessibilityLabel={`More for ${r.title}`}
                >
                  <RivalIcon name="moreHoriz" size={18} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          )}
          {savedMenu && savedMenu === r.savedId && !renaming ? (
            <View style={m.savedMenu}>
              <TouchableOpacity style={m.savedMenuItem} onPress={() => { setSavedMenu(null); setRenaming({ id: r.savedId!, name: r.title }); }}>
                <RivalIcon name="edit" size={15} color={RivalColors.onSurface} />
                <Text style={m.savedMenuText}>Rename</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.savedMenuItem} onPress={() => deleteSaved(r.savedId!, r.title)}>
                <RivalIcon name="delete" size={15} color={RivalColors.danger} />
                <Text style={[m.savedMenuText, { color: RivalColors.danger }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ))}
      {withOr ? <Text style={m.repeatOr}>or</Text> : null}
    </View>
  );

  const mobileLiftsCard = (
    <View style={m.card}>
      {workoutLeads ? (
        <>
          <View style={m.liftsTitleRow}>
            <Text style={m.cardLabel}>Exercises</Text>
            {namedLifts > 0 ? (
              <View style={m.liftsCount}><Text style={m.liftsCountText}>{namedLifts}</Text></View>
            ) : null}
          </View>
          {/* The main lifts, one tap each: the person's own most logged
              first (Ricky, 2026-10-25). */}
          <View style={m.mainLifts}>
            {mainLifts.map((lift) => {
              const on = exercises.some((e) => matchCanonicalLift(e.name) === lift);
              return (
                <TouchableOpacity key={lift} style={[m.mainLift, on && m.mainLiftOn]} onPress={() => toggleMainLift(lift)} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <RivalIcon name={on ? 'check' : 'add'} size={14} color={RivalColors.accentText} />
                  <Text style={[m.mainLiftText, on && m.mainLiftTextOn]}>{lift}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : (
      <TouchableOpacity
        style={m.liftsHead}
        onPress={() => {
          if (showExercises) setExercises((prev) => prev.filter((e) => e.name?.trim()));
          setShowExercises((v) => !v);
        }}
        activeOpacity={0.8}
      >
        <View style={{ flex: 1 }}>
          <View style={m.liftsTitleRow}>
            <Text style={m.cardLabel}>Lifts</Text>
            {namedLifts > 0 ? (
              <View style={m.liftsCount}><Text style={m.liftsCountText}>{namedLifts}</Text></View>
            ) : null}
          </View>
          <Text style={[m.cardHint, { marginTop: 3 }]}>Optional · tracked as PBs</Text>
        </View>
        <View style={[m.liftsToggle, showExercises && m.liftsToggleOpen]}>
          <RivalIcon name={showExercises ? 'chevronDown' : 'add'} size={18} color={RivalColors.accentText} />
        </View>
      </TouchableOpacity>
      )}

      {(showExercises || workoutLeads) && (
        <>
          {/* Nothing named yet: the workouts worth repeating today, one tap
              each (Ricky, 2026-10-24). */}
          {namedLifts === 0 && repeats.length > 0 ? repeatList(true) : null}
          {exercises.length > 0 && (
            <View style={m.unitToggle}>
              {(['kg', 'lb'] as const).map((u) => (
                <TouchableOpacity key={u} style={[m.unitBtn, weightUnit === u && m.unitBtnOn]} onPress={() => setWeightUnit(u)}>
                  <Text style={[m.unitText, weightUnit === u && m.unitTextOn]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {exercises.map((ex, i) => workoutLeads ? compactLift(ex, i) : (
            <View key={i} style={m.lift}>
              <View style={m.liftNameRow}>
                <Text style={m.liftIndex}>{i + 1}</Text>
                {/* Empty, the name is a dashed salmon field asking to be
                    filled, so a new exercise is not missed (Ricky, 2026-10-16). */}
                <TextInput
                  style={[m.liftName, !ex.name.trim() && m.liftNameEmpty]}
                  value={ex.name}
                  onChangeText={(v) => updateExerciseName(i, v)}
                  onFocus={() => setNameSuggestIndex(i)}
                  onBlur={() => setTimeout(() => setNameSuggestIndex((cur) => (cur === i ? null : cur)), 150)}
                  placeholder="Add exercise name"
                  placeholderTextColor="rgba(255,181,158,0.85)"
                  // iOS offered to fill it with a contact's name.
                  autoComplete="off"
                  textContentType="none"
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

              {(() => {
                // Last time's numbers show faded in the empty boxes; a tap
                // keeps one, typing replaces it. Only what is kept is saved.
                const last = lastTime(ex);
                const best = bestOf(ex);
                const pctOn = ex.pct != null && !!best;
                const ghost = (f: 'sets' | 'reps' | 'weight') => (last && last[f] != null ? (f === 'weight' ? kgToDisplay(last[f]) : String(last[f])) : '');
                const missing = (['sets', 'reps', 'weight'] as const).some((f) => ex[f] == null && last && last[f] != null);
                const fields = [
                  { f: 'sets' as const, label: 'Sets', value: ex.sets != null ? String(ex.sets) : '', onChange: (v: string) => updateExerciseNum(i, 'sets', v) },
                  { f: 'reps' as const, label: 'Reps', value: ex.reps != null ? String(ex.reps) : '', onChange: (v: string) => updateExerciseNum(i, 'reps', v) },
                ];
                return (
                  <>
                    <View style={m.liftFields}>
                      {fields.map(({ f, label, value, onChange }) => (
                        <View key={label} style={m.liftField}>
                          <Text style={m.liftFieldLabel}>{label}</Text>
                          <TextInput
                            style={m.liftFieldInput}
                            value={value}
                            onChangeText={onChange}
                            onFocus={() => { if (ex[f] == null && last?.[f] != null) keepLastTime(i, f); }}
                            selectTextOnFocus
                            placeholder={ghost(f) || '–'}
                            placeholderTextColor={ghost(f) ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.25)'}
                            keyboardType="numeric" autoComplete="off"
                          />
                        </View>
                      ))}
                      <View style={[m.liftField, pctOn && pctFocus === i && m.liftFieldTyping]}>
                        <Text style={m.liftFieldLabel}>{weightUnit === 'kg' ? 'Kg' : 'Lb'}</Text>
                        {pctOn ? (
                          // A percentage: typed as a number, shown as the
                          // weight to load once typed (Ricky, 2026-10-24).
                          <>
                            <TextInput
                              style={[m.liftFieldInput, pctFocus !== i && ex.weight != null && m.liftFieldCalc]}
                              value={pctFocus === i ? (ex.pct ? String(ex.pct) : '') : kgToDisplay(ex.weight)}
                              onChangeText={(v) => updatePct(i, v.replace(/[^\d.]/g, ''))}
                              onFocus={() => setPctFocus(i)}
                              onBlur={() => setPctFocus((cur) => (cur === i ? null : cur))}
                              selectTextOnFocus
                              placeholder="%"
                              placeholderTextColor="rgba(255,255,255,0.28)"
                              keyboardType="decimal-pad" autoComplete="off"
                            />
                            {ex.pct ? <Text style={m.liftFieldPct}>{`${ex.pct}%`}</Text> : null}
                          </>
                        ) : (
                          <TextInput
                            style={m.liftFieldInput}
                            value={kgToDisplay(ex.weight)}
                            onChangeText={(v) => updateExerciseNum(i, 'weightDisplay', v)}
                            onFocus={() => { if (ex.weight == null && last?.weight != null) keepLastTime(i, 'weight'); }}
                            selectTextOnFocus
                            placeholder={ghost('weight') || '–'}
                            placeholderTextColor={ghost('weight') ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.25)'}
                            keyboardType="decimal-pad" autoComplete="off"
                          />
                        )}
                      </View>
                    </View>
                    {pctOn || (best && ex.name.trim()) || (last && missing) ? (
                      <View style={m.liftMeta}>
                        <Text style={m.liftMetaText} numberOfLines={2}>
                          {pctOn && best
                            ? `${ex.pct ? `${ex.pct}% of ` : ''}${kgToDisplay(best.kg)} ${weightUnit}${best.estimated ? `, estimated from ${kgToDisplay(best.from.weightKg)} × ${best.from.reps}` : ', your best'} · ${new Date(best.from.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                            : last && missing ? `Last time · ${new Date(last.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
                        </Text>
                        {!pctOn && last && missing ? (
                          <TouchableOpacity style={m.sameBtn} onPress={() => keepLastTime(i)} activeOpacity={0.8}>
                            <Text style={m.sameBtnText}>Same as last time</Text>
                          </TouchableOpacity>
                        ) : null}
                        {best ? (
                          <View style={m.pctSeg}>
                            {([['kg', false], ['%', true]] as const).map(([label, on]) => (
                              <TouchableOpacity key={label} style={[m.pctSegBtn, pctOn === on && m.pctSegBtnOn]} onPress={() => setPctMode(i, on)}>
                                <Text style={[m.pctSegText, pctOn === on && m.pctSegTextOn]}>{label === 'kg' ? weightUnit : '%'}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </>
                );
              })()}

              {/* First time this lift is logged: the person can say it's a
                  personal best; off, it saves as a normal lift and nothing shows. */}
              {isFirstLift(ex) ? (
                <TouchableOpacity style={m.firstLift} onPress={() => toggleMarkedPb(i)} activeOpacity={0.8} accessibilityRole="switch" accessibilityState={{ checked: !!ex.markedPb }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[m.firstLiftTitle, ex.markedPb && m.firstLiftTitleOn]}>Personal best</Text>
                    <Text style={m.firstLiftSub}>{`First ${matchCanonicalLift(ex.name)} on RIVAL. Turn on if this is a personal best.`}</Text>
                  </View>
                  <View style={[m.pbSwitch, ex.markedPb && m.pbSwitchOn]}>
                    <View style={[m.pbKnob, ex.markedPb && m.pbKnobOn]} />
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}

          <TouchableOpacity style={m.addLift} onPress={addExercise} activeOpacity={0.8}>
            <RivalIcon name="add" size={16} color={RivalColors.accentText} />
            <Text style={m.addLiftText}>{exercises.length ? 'Add another exercise' : 'Add an exercise'}</Text>
          </TouchableOpacity>
          {/* Name these lifts to repeat them later (saved_workouts.sql). */}
          {namedLifts > 0 ? (
            savingWorkout != null ? (
              <View style={m.saveWorkoutRow}>
                <TextInput
                  style={m.saveWorkoutInput}
                  value={savingWorkout}
                  onChangeText={(v) => setSavingWorkout(v.slice(0, 60))}
                  placeholder="Name, e.g. Push day"
                  autoComplete="off"
                  textContentType="none"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  autoFocus
                  onSubmitEditing={saveWorkout}
                />
                <TouchableOpacity style={m.sameBtn} onPress={saveWorkout} disabled={!savingWorkout.trim() || workoutSaving}>
                  {workoutSaving
                    ? <BusyText busy style={m.sameBtnText}>Saving…</BusyText>
                    : <Text style={[m.sameBtnText, !savingWorkout.trim() && { opacity: 0.4 }]}>Save</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => { setWorkoutMsg(null); setSavingWorkout(''); }} style={m.saveWorkoutLink}>
                <RivalIcon name="replay" size={14} color={RivalColors.accentText} />
                <Text style={m.saveWorkoutLinkText}>{savedWorkouts.length ? 'Save or update a saved activity' : 'Save to repeat later'}</Text>
              </TouchableOpacity>
            )
          ) : null}
          {/* Saved: a clear line in place of the name box, so it is plain
              that the tap worked. */}
          {workoutMsg ? (
            <View style={m.workoutSaved}>
              {/^(Saved|Updated)/.test(workoutMsg) ? <RivalIcon name="check" size={15} color={RivalColors.accentText} /> : null}
              <Text style={/^(Saved|Updated)/.test(workoutMsg) ? m.workoutSavedText : m.cardHint}>{workoutMsg}</Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  // ---- Weights (Ricky, 2026-10-28, design/weights-input-mockup-2.png, 2b) --
  // Time and Repeat as two big tiles, then the exercise being entered, always
  // on top, with the four lifts most used as tiles under it and the ones
  // already added listed below. The exercise on top is the last in the list.
  const openIndex = exercises.length - 1;
  const openEx = openIndex >= 0 ? exercises[openIndex] : null;
  const added = exercises.slice(0, Math.max(0, openIndex));
  // Most used over the last 8 weeks, then most recent; your own exercises
  // count too. What's already added, and the activity's name, steer them to
  // the lifts that go together (lib/liftSuggest). Never one already added.
  const quickLifts = (() => {
    const since = Date.now() - 56 * 86400000;
    const stats = new Map<string, { name: string; count: number; last: number }>();
    const recent: string[][] = [];
    pastLifts.forEach((a) => {
      const at = new Date(a.startedAt).getTime();
      if (at < since) return;
      recent.push((a.exercises ?? []).map((l: LiftLine) => l?.name ?? '').filter((n: string) => n.trim()));
      (a.exercises ?? []).forEach((l: LiftLine) => {
        if (!l?.name?.trim()) return;
        const name = matchCanonicalLift(l.name) || l.name.trim();
        const k = name.toLowerCase();
        const cur = stats.get(k) ?? { name, count: 0, last: 0 };
        stats.set(k, { name, count: cur.count + 1, last: Math.max(cur.last, at) });
      });
    });
    const mine = [...stats.values()].sort((x, y) => y.count - x.count || y.last - x.last).map((v) => v.name);
    return suggestLifts({ mine, activities: recent, added: exercises.map((e) => e.name), activityName: workoutName, fallback: MAIN_LIFTS, count: 4 });
  })();
  function nextExercise() {
    if (!openEx?.name.trim()) return;
    setExercises((prev) => [...prev, { name: '' }]);
    setNameSuggestIndex(null);
  }
  function quickLift(name: string) {
    setExercises((prev) => {
      const last = prev[prev.length - 1];
      if (last && !last.name.trim()) return prev.map((e, i) => (i === prev.length - 1 ? { ...e, name } : e));
      return [...prev, { name }];
    });
    setNameSuggestIndex(null);
  }
  // An added exercise tapped goes back on top to change; a blank one there goes.
  function reopenExercise(index: number) {
    setExercises((prev) => {
      const rest = prev.filter((e, i) => i !== index && (i !== prev.length - 1 || e.name.trim()));
      return [...rest, prev[index]];
    });
  }
  function removeOpenExercise() {
    setExercises((prev) => {
      const rest = prev.slice(0, -1);
      return rest.length ? rest : [{ name: '' }];
    });
    setNameSuggestIndex(null);
  }
  const liftSummary = (ex: Exercise) => [
    ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : ex.sets ? `${ex.sets} sets` : ex.reps ? `${ex.reps} reps` : '',
    ex.weight != null ? `${kgToDisplay(ex.weight)} ${weightUnit}` : '',
  ].filter(Boolean).join(' · ');
  const lastWeightsTime = lastTimeByType.current[workoutType];
  // Whole minutes in the big tiles: typing clears seconds a last time brought in.
  const typeMinutes = (v: string) => { setDurationMin(v.replace(/\D/g, '')); setDurationSec(''); if (fieldError?.field === 'duration') setFieldError(null); };
  const halfTimeTile = (
    <View style={[w.big, w.bigTime]}>
      <Text style={m.cardLabel}>Time</Text>
      <View style={w.timeLine}>
        <TextInput
          style={w.timeInput}
          value={durationMin}
          onChangeText={typeMinutes}
          placeholder="0"
          placeholderTextColor="rgba(255,255,255,0.28)"
          keyboardType="numeric" autoComplete="off"
          accessibilityLabel="Minutes"
        />
        <Text style={w.timeUnit}>min</Text>
        {durationSec ? <Text style={w.timeUnit}>{`${durationSec.padStart(2, '0')} sec`}</Text> : null}
      </View>
      {lastWeightsTime ? <Text style={w.bigSub} numberOfLines={1}>{`Last time ${minutesClock(lastWeightsTime)}`}</Text> : null}
    </View>
  );

  const openCard = openEx ? (() => {
    const i = openIndex;
    const ex = openEx;
    const last = lastTime(ex);
    const best = bestOf(ex);
    const pctOn = ex.pct != null && !!best;
    const named = !!ex.name.trim();
    const ghost = (f: 'sets' | 'reps' | 'weight') => (last && last[f] != null ? (f === 'weight' ? kgToDisplay(last[f]) : String(last[f])) : '');
    const missing = (['sets', 'reps', 'weight'] as const).some((f) => ex[f] == null && last && last[f] != null);
    const box = (f: 'sets' | 'reps', label: string) => (
      <View style={w.box}>
        <TextInput
          style={w.boxInput}
          value={ex[f] != null ? String(ex[f]) : ''}
          onChangeText={(v) => updateExerciseNum(i, f, v)}
          onFocus={() => { if (ex[f] == null && last?.[f] != null) keepLastTime(i, f); }}
          selectTextOnFocus
          placeholder={ghost(f) || '–'}
          placeholderTextColor="rgba(255,255,255,0.28)"
          keyboardType="numeric" autoComplete="off"
        />
        <Text style={w.boxLabel}>{label}</Text>
      </View>
    );
    return (
      <View style={w.open}>
        <View style={w.openHead}>
          <TextInput
            style={[w.openName, !named && w.openNameEmpty]}
            value={ex.name}
            onChangeText={(v) => updateExerciseName(i, v)}
            onFocus={() => setNameSuggestIndex(i)}
            onBlur={() => setTimeout(() => setNameSuggestIndex((cur) => (cur === i ? null : cur)), 150)}
            placeholder="Exercise name"
            placeholderTextColor="rgba(255,181,158,0.85)"
            autoComplete="off"
            textContentType="none"
          />
          <View style={m.unitToggle}>
            {(['kg', 'lb'] as const).map((u) => (
              <TouchableOpacity key={u} style={[w.unitBtn, weightUnit === u && m.unitBtnOn]} onPress={() => setWeightUnit(u)}>
                <Text style={[m.unitText, weightUnit === u && m.unitTextOn]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>
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

        <View style={w.boxes}>
          {box('sets', 'SETS')}
          {box('reps', 'REPS')}
          <View style={[w.box, pctOn && pctFocus === i && w.boxTyping]}>
            {pctOn ? (
              <TextInput
                style={[w.boxInput, pctFocus !== i && ex.weight != null && m.liftFieldCalc]}
                value={pctFocus === i ? (ex.pct ? String(ex.pct) : '') : kgToDisplay(ex.weight)}
                onChangeText={(v) => updatePct(i, v.replace(/[^\d.]/g, ''))}
                onFocus={() => setPctFocus(i)}
                onBlur={() => setPctFocus((cur) => (cur === i ? null : cur))}
                selectTextOnFocus
                placeholder="%"
                placeholderTextColor="rgba(255,255,255,0.28)"
                keyboardType="decimal-pad" autoComplete="off"
              />
            ) : (
              <TextInput
                style={w.boxInput}
                value={kgToDisplay(ex.weight)}
                onChangeText={(v) => updateExerciseNum(i, 'weightDisplay', v)}
                onFocus={() => { if (ex.weight == null && last?.weight != null) keepLastTime(i, 'weight'); }}
                selectTextOnFocus
                placeholder={ghost('weight') || '–'}
                placeholderTextColor="rgba(255,255,255,0.28)"
                keyboardType="decimal-pad" autoComplete="off"
              />
            )}
            <Text style={w.boxLabel}>{pctOn ? '%' : weightUnit.toUpperCase()}</Text>
          </View>
        </View>

        {pctOn && best ? (
          <Text style={w.openSub} numberOfLines={2}>
            {`${ex.pct ? `${ex.pct}% of ` : ''}${kgToDisplay(best.kg)} ${weightUnit}${best.estimated ? `, estimated from ${kgToDisplay(best.from.weightKg)} × ${best.from.reps}` : ', your best'}`}
          </Text>
        ) : last ? (
          <Text style={w.openSub} numberOfLines={1}>{`Last time ${liftSummary({ name: ex.name, sets: last.sets, reps: last.reps, weight: last.weight })}`}</Text>
        ) : null}

        {named && ((last && missing && !pctOn) || best || exercises.length > 1) ? (
          <View style={m.cExtras}>
            {last && missing && !pctOn ? (
              <TouchableOpacity style={m.sameBtn} onPress={() => keepLastTime(i)} activeOpacity={0.8}>
                <Text style={m.sameBtnText}>Same as last time</Text>
              </TouchableOpacity>
            ) : null}
            {best ? (
              <View style={m.pctSeg}>
                {([['kg', false], ['%', true]] as const).map(([label, on]) => (
                  <TouchableOpacity key={label} style={[m.pctSegBtn, pctOn === on && m.pctSegBtnOn]} onPress={() => setPctMode(i, on)}>
                    <Text style={[m.pctSegText, pctOn === on && m.pctSegTextOn]}>{label === 'kg' ? weightUnit : '%'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <TouchableOpacity style={m.cRemove} onPress={removeOpenExercise} accessibilityRole="button" accessibilityLabel={`Remove ${ex.name || 'exercise'}`}>
              <RivalIcon name="close" size={13} color="rgba(255,255,255,0.5)" />
              <Text style={m.cRemoveText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isFirstLift(ex) ? (
          <TouchableOpacity style={m.firstLift} onPress={() => toggleMarkedPb(i)} activeOpacity={0.8} accessibilityRole="switch" accessibilityState={{ checked: !!ex.markedPb }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[m.firstLiftTitle, ex.markedPb && m.firstLiftTitleOn]}>Personal best</Text>
              <Text style={m.firstLiftSub}>{`First ${matchCanonicalLift(ex.name)} on RIVAL. Turn on if this is a personal best.`}</Text>
            </View>
            <View style={[m.pbSwitch, ex.markedPb && m.pbSwitchOn]}>
              <View style={[m.pbKnob, ex.markedPb && m.pbKnobOn]} />
            </View>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={[w.another, !named && { opacity: 0.45 }]} onPress={nextExercise} disabled={!named} activeOpacity={0.8} accessibilityRole="button">
          <RivalIcon name="add" size={17} color={RivalColors.accentText} />
          <Text style={w.anotherText}>Add another exercise</Text>
        </TouchableOpacity>
      </View>
    );
  })() : null;

  const weightsLead = (
    <View style={w.stack}>
      <View style={w.half}>
        {halfTimeTile}
        {repeats.length > 0 ? (
          <TouchableOpacity
            style={[w.big, showRepeats && w.bigOn]}
            onPress={() => (repeats.length === 1 ? applyRepeat(repeats[0].exercises, repeats[0].savedId) : setShowRepeats((v) => !v))}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <View style={w.bigHead}>
              <Text style={m.cardLabel}>Repeat</Text>
              <RivalIcon name="replay" size={18} color={RivalColors.accentText} />
            </View>
            <Text style={w.repeatTitle} numberOfLines={2}>{repeats[0].title}</Text>
            {/* A count, not the lift names: those don't fit half a phone. */}
            <Text style={w.bigSub}>{`${repeats[0].exercises.length} ${repeats[0].exercises.length === 1 ? 'exercise' : 'exercises'}${repeats.length > 1 ? ` · ${repeats.length - 1} more` : ''}`}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {showRepeats && repeats.length > 1 ? <View style={m.card}>{repeatList(false)}</View> : null}

      <Text style={w.sec}>Exercise</Text>
      {openCard}

      {quickLifts.length > 0 ? (
        <View style={w.quick}>
          {quickLifts.map((name) => (
            <TouchableOpacity key={name} style={w.quickTile} onPress={() => quickLift(name)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`Add ${name}`}>
              <View style={[w.quickArt, { pointerEvents: 'none' }]}>
                <RivalIcon name="weights" size={20} color="rgba(255,181,158,0.35)" />
              </View>
              <Text style={w.quickText} numberOfLines={2}>{QUICK_LIFT_LABELS[name] ?? name}</Text>
            </TouchableOpacity>
          ))}
          {/* Fewer than four keep the tile size. */}
          {Array.from({ length: 4 - quickLifts.length }, (_, k) => <View key={`gap${k}`} style={w.quickGap} />)}
        </View>
      ) : null}

      {added.length > 0 ? (
        <>
          <Text style={w.sec}>{`Added · ${added.length}`}</Text>
          {added.map((ex, i) => (
            <TouchableOpacity key={`${i}-${ex.name}`} style={w.addedRow} onPress={() => reopenExercise(i)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`Change ${ex.name}`}>
              <RivalIcon name="checkCircle" size={18} color={RivalColors.accentText} />
              <Text style={w.addedName} numberOfLines={1}>{ex.name}</Text>
              <Text style={w.addedSum}>{liftSummary(ex)}</Text>
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      {/* Name these lifts to repeat them later (saved_workouts.sql). */}
      {namedLifts > 0 ? (
        savingWorkout != null ? (
          <View style={m.saveWorkoutRow}>
            <TextInput
              style={m.saveWorkoutInput}
              value={savingWorkout}
              onChangeText={(v) => setSavingWorkout(v.slice(0, 60))}
              placeholder="Name, e.g. Push day"
              autoComplete="off"
              textContentType="none"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoFocus
              onSubmitEditing={saveWorkout}
            />
            <TouchableOpacity style={m.sameBtn} onPress={saveWorkout} disabled={!savingWorkout.trim() || workoutSaving}>
              {workoutSaving
                ? <BusyText busy style={m.sameBtnText}>Saving…</BusyText>
                : <Text style={[m.sameBtnText, !savingWorkout.trim() && { opacity: 0.4 }]}>Save</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => { setWorkoutMsg(null); setSavingWorkout(''); }} style={m.saveWorkoutLink}>
            <RivalIcon name="replay" size={14} color={RivalColors.accentText} />
            <Text style={m.saveWorkoutLinkText}>{savedWorkouts.length ? 'Save or update a saved activity' : 'Save to repeat later'}</Text>
          </TouchableOpacity>
        )
      ) : null}
      {workoutMsg ? (
        <View style={m.workoutSaved}>
          {/^(Saved|Updated)/.test(workoutMsg) ? <RivalIcon name="check" size={15} color={RivalColors.accentText} /> : null}
          <Text style={/^(Saved|Updated)/.test(workoutMsg) ? m.workoutSavedText : m.cardHint}>{workoutMsg}</Text>
        </View>
      ) : null}
    </View>
  );

  // Every other type (Ricky, 2026-10-29, other-types-mockup.png): distance
  // types lead with Time and Distance tiles, the pace and quick distances;
  // the rest with one Time card holding quick lengths.
  const distancePresets = workoutLeads ? undefined : DISTANCE_PRESETS[workoutType];
  const distanceLeads = !!distancePresets;
  const timeLeads = !workoutLeads && !distanceLeads;
  const sameType = typeHistory.filter((h) => h.type === workoutType);
  const shownDistance = (meters: number) => Math.round(toDisplayDistance(meters / 1000) * 10) / 10;
  const usualDistance = usualOf(sameType.filter((h) => h.meters > 0).map((h) => shownDistance(h.meters)));
  const distanceTiles = distancePresets
    ? [...new Set([...(usualDistance ? [usualDistance] : []), ...distancePresets.map((km) => shownDistance(km * 1000))])].slice(0, 4)
    : [];
  const lastDistance = sameType.find((h) => h.meters > 0);
  const usualLength = usualOf(sameType.map((h) => Math.round(h.seconds / 300) * 5).filter((v) => v > 0));
  const lengths = (() => {
    const base = CLASS_BASED_TYPES.has(workoutType) ? CLASS_LENGTHS : TIME_LENGTHS;
    if (usualLength == null || base.includes(usualLength)) return base;
    // The usual one takes the place of the nearest.
    const nearest = base.reduce((a, b) => (Math.abs(b - usualLength) < Math.abs(a - usualLength) ? b : a));
    return base.map((v) => (v === nearest ? usualLength : v)).sort((a, b) => a - b);
  })();
  const enteredMeters = enteredKm > 0 ? fromDisplayDistance(enteredKm) * 1000 : 0;
  const pace = durationSeconds > 0 && enteredMeters > 0
    ? formatSpeedOrPace(enteredMeters, durationSeconds, /Ride$/.test(workoutType) ? 'Ride' : workoutType)
    : null;
  const quickTile = (key: string, value: number, unit: string, usual: boolean, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} style={[w.qTile, on && w.qTileOn]} onPress={onPress} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${value} ${unit}`}>
      {usual ? <Text style={[w.qUsual, on && w.qOnText]}>Usual</Text> : null}
      <Text style={[w.qNum, on && w.qNumOn]}>{value}</Text>
      <Text style={[w.qUnit, on && w.qOnText]}>{unit}</Text>
    </TouchableOpacity>
  );
  const pickLength = (min: number) => { setDurationMin(String(min)); setDurationSec(''); if (fieldError?.field === 'duration') setFieldError(null); };
  const lengthOn = (min: number) => durationMin === String(min) && !(Number(durationSec) > 0);

  const distanceLead = (
    <View style={w.stack}>
      <View style={w.half}>
        {halfTimeTile}
        <View style={[w.big, w.bigTime]}>
          <Text style={m.cardLabel}>Distance</Text>
          <View style={w.timeLine}>
            <TextInput
              style={[w.timeInput, w.distanceInput]}
              value={distanceKm}
              onChangeText={(v) => setDistanceKm(v.replace(/[^\d.]/g, ''))}
              placeholder="0"
              placeholderTextColor="rgba(255,255,255,0.28)"
              keyboardType="decimal-pad" autoComplete="off"
              accessibilityLabel="Distance"
            />
            <Text style={w.timeUnit}>{distanceUnit()}</Text>
          </View>
          {lastDistance ? <Text style={w.bigSub} numberOfLines={1}>{`Last time ${shownDistance(lastDistance.meters)} ${distanceUnit()}`}</Text> : null}
        </View>
      </View>
      {pace ? (
        <View style={w.pace}>
          <RivalIcon name="speed" size={17} color={RivalColors.accentText} />
          <Text style={w.paceText}>{`${/\/h|mph/.test(pace) ? 'Speed' : 'Pace'} ${pace}`}</Text>
        </View>
      ) : null}
      <View style={w.quick}>
        {distanceTiles.map((v) => quickTile(`d${v}`, v, distanceUnit().toUpperCase(), v === usualDistance, Number(distanceKm) === v, () => setDistanceKm(String(v))))}
      </View>
    </View>
  );

  const lastLength = lastTimeByType.current[workoutType];
  const timeCardSub = CLASS_BASED_TYPES.has(workoutType)
    ? (lastLength ? `Last time ${minutesClock(lastLength)} · full class time, warm-up included` : 'Full class time, warm-up included')
    : lastLength ? `Last time ${minutesClock(lastLength)}` : null;
  const timeLead = (
    <View style={w.timeCard}>
      <Text style={[m.cardLabel, { alignSelf: 'stretch' }]}>Time</Text>
      <View style={w.cardLine}>
        <TextInput
          style={w.cardInput}
          value={durationMin}
          onChangeText={typeMinutes}
          placeholder="0"
          placeholderTextColor="rgba(255,255,255,0.28)"
          keyboardType="numeric" autoComplete="off"
          accessibilityLabel="Minutes"
        />
        <Text style={w.cardUnit}>MIN</Text>
        {durationSec ? <Text style={w.cardUnit}>{`${durationSec.padStart(2, '0')} SEC`}</Text> : null}
      </View>
      {timeCardSub ? <Text style={w.cardSub}>{timeCardSub}</Text> : null}
      <View style={[w.quick, { alignSelf: 'stretch', marginTop: 8 }]}>
        {lengths.map((v) => quickTile(`t${v}`, v, 'MIN', v === usualLength, lengthOn(v), () => pickLength(v)))}
      </View>
    </View>
  );
  function toggleLifts() {
    // Opening with none yet starts the first one, so there is something to
    // fill in straight away. Closing drops blanks.
    if (!showExercises && exercises.length === 0) addExercise();
    if (showExercises) setExercises((prev) => prev.filter((e) => e.name?.trim()));
    setShowExercises((v) => !v);
  }

  const typeTile = (t: string, fromAll = false) => {
    const on = workoutType === t;
    return (
      <TouchableOpacity
        key={t}
        style={[m.tile, fromAll && m.tileSmall, on && m.tileOn]}
        onPress={() => { pickType(t); if (fromAll) { setShowAllTypes(false); setTypeQuery(''); } }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
      >
        <View style={[m.tileArt, { pointerEvents: 'none' }]}>
          <RivalIcon name={activityIconName(t)} size={56} color={on ? 'rgba(255,255,255,0.32)' : 'rgba(255,181,158,0.2)'} />
        </View>
        {/* Long names wrap to a second line in See all. */}
        <Text style={[m.tileText, fromAll && m.tileTextSmall, on && m.tileTextOn]} numberOfLines={fromAll ? 2 : 1}>{tileLabel(t)}</Text>
      </TouchableOpacity>
    );
  };

  const mobileLayout = (
    <View style={m.stack}>
      {/* The name is the page's title, as it is in the activity viewer —
          no card around it. Type and date have their own fields below, and
          Effort lives in the save bar, where it stays on screen while the
          numbers that change it are being edited. */}
      {/* Name and activity in the Add an activity style (Ricky, 2026-10-03):
          no card around them, an outlined field, and the types as tiles with
          a big faint icon behind the word; the chosen one lit peach. */}
      <View style={m.typeBlock}>
        <TextInput
          style={m.nameField}
          value={workoutName}
          onChangeText={(v) => { setWorkoutName(v); if (fieldError?.field === 'name') setFieldError(null); }}
          placeholder={namePlaceholder}
          placeholderTextColor="rgba(255,255,255,0.35)"
          accessibilityLabel="Name"
          maxLength={NAME_MAX}
        />
        {workoutName.length >= NAME_MAX - 10 ? (
          <Text style={m.nameCount}>{workoutName.length}/{NAME_MAX}</Text>
        ) : null}
        {fieldError?.field === 'name' && <Text style={styles.fieldError}>{fieldError.message}</Text>}
        {/* Seven tiles plus See all, four to a row. See all opens every other
            type below, grouped and searchable; a pick closes it and shows in
            the eighth tile. */}
        <View style={m.tiles}>
          {tiles.map((t) => typeTile(t))}
          {(() => {
            const outside = !tiles.includes(workoutType) && !showAllTypes;
            return (
              <TouchableOpacity style={[m.tile, outside ? m.tileOn : m.tileAll]} onPress={() => { setShowAllTypes((v) => !v); setTypeQuery(''); }} activeOpacity={0.8} accessibilityRole="button">
                <View style={[m.tileArt, { pointerEvents: 'none' }]}>
                  <RivalIcon name={outside ? activityIconName(workoutType) : 'apps'} size={56} color={outside ? 'rgba(255,255,255,0.32)' : 'rgba(255,181,158,0.2)'} />
                </View>
                <Text style={[m.tileText, outside ? m.tileTextOn : m.tileAllText]} numberOfLines={1}>
                  {showAllTypes ? 'Fewer' : outside ? tileLabel(workoutType) : 'See all'}
                </Text>
              </TouchableOpacity>
            );
          })()}
        </View>
        {showAllTypes ? (() => {
          const q = typeQuery.trim().toLowerCase();
          const rest = (types: string[]) => types.filter((t) => !tiles.includes(t));
          const found = q ? rest(ALL_TYPES).filter((t) => tileLabel(t).toLowerCase().includes(q)) : [];
          return (
            <View style={m.allTypes}>
              <View style={[m.typeSearch, q && m.typeSearchOn]}>
                <RivalIcon name="search" size={19} color={RivalColors.accentText} />
                <TextInput
                  style={m.typeSearchInput}
                  value={typeQuery}
                  onChangeText={setTypeQuery}
                  placeholder={`Search ${ALL_TYPES.length} activities`}
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  autoComplete="off"
                  accessibilityLabel="Search activities"
                />
                {q ? (
                  <TouchableOpacity onPress={() => setTypeQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
                    <RivalIcon name="close" size={18} color="rgba(255,255,255,0.4)" />
                  </TouchableOpacity>
                ) : null}
              </View>
              {q ? (
                <>
                  <View style={m.tiles}>
                    {found.map((t) => typeTile(t, true))}
                    {Array.from({ length: (4 - (found.length % 4)) % 4 }, (_, k) => <View key={`gap${k}`} style={m.tileGap} />)}
                  </View>
                  <Text style={m.typeCount}>{found.length === 0 ? 'No activities match.' : `${found.length} ${found.length === 1 ? 'activity' : 'activities'}`}</Text>
                </>
              ) : TYPE_GROUPS.map(([heading, types]) => {
                const shown = rest(types);
                if (!shown.length) return null;
                return (
                  <View key={heading} style={m.typeGroup}>
                    <View style={m.groupHead}>
                      <Text style={m.cardLabel}>{heading}</Text>
                      <Text style={m.groupCount}>{shown.length}</Text>
                    </View>
                    <View style={m.tiles}>
                      {shown.map((t) => typeTile(t, true))}
                      {Array.from({ length: (4 - (shown.length % 4)) % 4 }, (_, k) => <View key={`gap${k}`} style={m.tileGap} />)}
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })() : null}
      </View>

      {workoutLeads ? weightsLead : distanceLeads ? distanceLead : timeLead}
      {/* Lifts stay optional; on a distance type only once some are in. */}
      {((timeLeads && showLifts) || (distanceLeads && namedLifts > 0)) && !showExercises ? (
        <TouchableOpacity style={w.liftsCard} onPress={toggleLifts} activeOpacity={0.85} accessibilityRole="button">
          <View style={w.liftsIcon}><RivalIcon name="weights" size={19} color={RivalColors.accentText} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={w.liftsTitle}>{namedLifts > 0 ? `${namedLifts} ${namedLifts === 1 ? 'lift' : 'lifts'}` : 'Add lifts'}</Text>
            <Text style={w.liftsSub}>Optional · tracked as PBs</Text>
          </View>
          <RivalIcon name="add" size={20} color={RivalColors.accentText} />
        </TouchableOpacity>
      ) : null}
      {!workoutLeads && showExercises && showLifts ? mobileLiftsCard : null}

      {/* Photos and Journal as one card, the post the team sees: picture on
          top, words underneath (Ricky, 2026-10-29, journal-mockup.png B),
          straight under the numbers. */}
      <View style={m.post}>
        {/* Photos inline, Instagram-style: numbered in posting order, tap one
            to rearrange, the last tile adds more. */}
        {media.length === 0 ? (
          // Nothing added yet: one wide, warm tile instead of a dark card
          // with a small dashed box in it (Ricky, 2026-10-02).
          <TouchableOpacity style={[m.mediaEmpty, m.postMedia]} onPress={pickMedia} activeOpacity={0.85} accessibilityRole="button">
            {/* A big tile like Upload on Add an activity: the camera large and
                faint behind the words (Ricky, 2026-10-03). */}
            <View style={[m.tileArt, { pointerEvents: 'none' }]}>
              <RivalIcon name="addPhoto" size={92} color="rgba(255,181,158,0.18)" />
            </View>
            <Text style={m.mediaEmptyTitle}>Add photos or a video</Text>
            <Text style={m.mediaEmptySub}>Up to {MAX_MEDIA} · 1 video, up to {MAX_VIDEO_SECONDS / 60} min</Text>
          </TouchableOpacity>
        ) : (
          <View style={m.postThumbs}>
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
                    ? <CoverImage uri={item.uri} focalX={item.focalX} focalY={item.focalY} style={m.thumb} />
                    : <View style={[m.thumb, m.thumbVideo]}><RivalIcon name="video" size={22} color={RivalColors.accentText} /></View>}
                  <View style={[m.thumbOrder, { pointerEvents: 'none' }]}>
                    <Text style={m.thumbOrderText}>{i + 1}</Text>
                  </View>
                  {i === 0 && item.type === 'photo' ? (
                    <View style={[m.thumbCover, { pointerEvents: 'none' }]}><Text style={m.thumbCoverText}>Cover</Text></View>
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
            <Text style={m.cardHint}>Up to {MAX_MEDIA} · 1 video, up to {MAX_VIDEO_SECONDS / 60} min · tap a photo to reorder or position it</Text>
            {mediaError && <Text style={styles.fieldError}>{mediaError}</Text>}
          </View>
        )}

        {/* Same words and feel as the journal in the activity viewer — it is
            the same note, so it should read as the same thing. */}
        <View style={m.postCaption}>
          <Text style={[m.cardLabel, m.journalLabel]}>Journal</Text>
          <TextInput
            // One line until it's used, then room to write (Ricky, 2026-10-02).
            style={[m.journalInput, !journalOpen && !notes && m.journalInputShort]}
            value={notes}
            onChangeText={setNotes}
            onFocus={() => setJournalOpen(true)}
            onBlur={() => setJournalOpen(false)}
            placeholder="How did it go?"
            placeholderTextColor="rgba(255,255,255,0.3)"
            multiline
          />
          <View style={m.postHint}>
            <RivalIcon name="groups" size={15} color={RivalColors.accentText} />
            <Text style={m.postHintText}>Shown on team feeds</Text>
          </View>
        </View>

      </View>
      {media.length === 0 && mediaError ? <Text style={styles.fieldError}>{mediaError}</Text> : null}

      {/* The numbers. Duration gets the full width — min and sec side by
          side were cramped into a third of a phone. */}
      {/* Time, distance and climb as labelled rows, like the Plan an
          activity details card. No card title (the review note). */}
      <View>
        <GreyRows>
          {showDistance && !distanceLeads ? (
          <GreyRow icon="distance" label="Distance">
            <View style={m.timeRow}>
              <TextInput style={[m.rowInput, m.wideInput]} value={distanceKm} onChangeText={setDistanceKm} placeholder="Optional" placeholderTextColor="rgba(255,255,255,0.28)" keyboardType="decimal-pad" autoComplete="off" />
              {distanceKm ? <Text style={m.rowUnit}>{distanceUnit()}</Text> : null}
            </View>
          </GreyRow>
          ) : null}
          {!showClimb ? null : isTreadmill ? (
            <GreyRow icon="elevation" label="Incline">
              <View style={m.timeRow}>
                <TextInput style={[m.rowInput, m.wideInput]} value={inclinePct} onChangeText={setInclinePct} placeholder="Average" placeholderTextColor="rgba(255,255,255,0.28)" keyboardType="decimal-pad" autoComplete="off" />
                {inclinePct ? <Text style={m.rowUnit}>%</Text> : null}
              </View>
            </GreyRow>
          ) : (
            <GreyRow icon="elevation" label="Elevation">
              <View style={m.timeRow}>
                <TextInput style={[m.rowInput, m.wideInput]} value={elevationM} onChangeText={setElevationM} placeholder="Optional" placeholderTextColor="rgba(255,255,255,0.28)" keyboardType="numeric" autoComplete="off" />
                {elevationM ? <Text style={m.rowUnit}>{elevationUnit()}</Text> : null}
              </View>
            </GreyRow>
          )}
          {/* Date and start time in one row; the start time fills itself in
              (now, less the time entered), so it isn't a step of its own
              (Ricky, 2026-10-30). Both are set in the calendar sheet. */}
          <GreyRow icon="calendar" label="Date" value={`${friendlyDate(dateStr)} · ${startHour || '12'}:${(startMin || '0').padStart(2, '0')} ${startPm ? 'pm' : 'am'}`} onPress={() => setCalOpen(true)} />
          {/* Lifts as one more row here rather than a card of its own; the
              list opens below when tapped (Ricky, 2026-10-02). */}
        </GreyRows>
        {isTreadmill && Number(inclinePct) > 0 ? (
          <Text style={styles.classHint}>
            {elevationM
              ? `About ${Number(elevationM).toLocaleString()} ${elevationUnit()} climbed at ${inclinePct}% over the distance.`
              : 'Add the distance to work out the climb from the incline.'}
          </Text>
        ) : null}
        {fieldError?.field === 'duration' && <Text style={styles.fieldError}>{fieldError.message}</Text>}
        {fieldError?.field === 'date' && <Text style={styles.fieldError}>{fieldError.message}</Text>}
        {scoringConfig && ((enteredKm > 0 && !scoresDistance) || (enteredClimb > 0 && !scoresClimb)) && (
          <Text style={styles.classHint}>
            {!scoresDistance && enteredKm > 0 && !scoresClimb && enteredClimb > 0
              ? 'Distance and elevation are saved, but this activity is scored on time.'
              : !scoresDistance && enteredKm > 0
                ? 'Distance is saved, but this activity is scored on time.'
                : 'Elevation is saved, but not scored for this activity.'}
          </Text>
        )}
      </View>

      <Modal visible={calOpen} transparent animationType="fade" onRequestClose={() => setCalOpen(false)}>
        <View style={{ flex: 1 }}>
          <GreyCalendar
            value={displayToIsoDate(dateStr)}
            onChange={(iso) => { setDateStr(isoToDisplayDate(iso)); if (fieldError?.field === 'date') setFieldError(null); }}
            onClose={() => setCalOpen(false)}
            footer={
              <View style={m.calTime}>
                <View style={m.calTimeRow}>
                  <Text style={m.calTimeLabel}>Start time</Text>
                  <View style={m.timeRow}>
                    <TextInput
                      style={[m.rowInput, m.hourInput]}
                      value={startHour}
                      onChangeText={(v) => { startTouched.current = true; setStartHour(v.replace(/\D/g, '').slice(0, 2)); }}
                      placeholder="9"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      keyboardType="numeric" autoComplete="off"
                      accessibilityLabel="Start hour"
                    />
                    <Text style={m.rowUnit}>:</Text>
                    <TextInput
                      style={[m.rowInput, m.minInput]}
                      value={startMin}
                      onChangeText={(v) => { startTouched.current = true; setStartMin(v.replace(/\D/g, '').slice(0, 2)); }}
                      onBlur={() => setStartMin((v) => (v ? String(Math.min(59, Number(v))).padStart(2, '0') : '00'))}
                      placeholder="00"
                      placeholderTextColor="rgba(255,255,255,0.28)"
                      keyboardType="numeric" autoComplete="off"
                      accessibilityLabel="Start minute"
                    />
                    <TouchableOpacity onPress={() => { startTouched.current = true; setStartPm((v) => !v); }} style={m.ampm} accessibilityRole="button" accessibilityLabel={startPm ? 'PM, tap for AM' : 'AM, tap for PM'}>
                      <Text style={m.ampmText}>{startPm ? 'pm' : 'am'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <TouchableOpacity style={m.calDone} onPress={() => setCalOpen(false)} accessibilityRole="button">
                  <Text style={m.calDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            }
          />
        </View>
      </Modal>

      {/* Who else was there. Partners can only be added within the tagging
          window, so an older date shows who is already on it and nothing more. */}
      {partnersCard}

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
              {overLimit
                ? <Text style={[m.effortSub, m.effortWarn]} numberOfLines={2}>Faster than realistic. Check it, or confirm it after saving.</Text>
                : <Text style={m.effortSub} numberOfLines={1}>{effortParts}</Text>}
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
      {/* The exercise on top is saved with the rest, so the athlete need
          not add another to keep it (Ricky, 2026-10-28). */}
      {workoutLeads && openEx?.name.trim() ? (
        <Text style={w.includes} numberOfLines={1}>{`Includes ${openEx.name.trim()}`}</Text>
      ) : null}
    </View>
  );

  const saved = !!savedActivityId;

  return (
    <SafeAreaView style={[styles.container, !wide && m.page]} edges={!wide && typing ? ['top', 'left', 'right'] : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, !wide && m.content]}
        style={[{ opacity: formReady ? 1 : 0 }, Platform.OS === 'web' && ({ transition: 'opacity 220ms ease-out' } as any)]}
      >
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
          <GreyPageHead
            kicker={isEditMode ? 'EDIT' : 'LOG'}
            title={isEditMode ? 'Edit activity' : 'Log an activity'}
            onBack={() => (router.canGoBack() ? router.back() : goToTab('/my-activities'))}
          />
        )}

        {loadingEdit && <Text style={styles.subtitle}>Loading activity…</Text>}

        {saved && (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>Activity saved</Text>
            {savedHasPhoto ? (
              <View style={styles.successActions}>
                <TouchableOpacity onPress={backToOrigin}>
                  <Text style={styles.doneText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : null}
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

      {!wide && !loadingEdit && !typing && mobileSaveBar}

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
      {milestoneCheck ? <MilestonePhotoPrompt {...milestoneCheck} onDone={backToOrigin} /> : null}
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
  distanceShown = '',
): number {
  if (!config) return 0;
  const elevation = elevationM.trim() === '' ? 0 : fromDisplayElevation(Number(elevationM));
  const km = distanceShown.trim() === '' ? 0 : fromDisplayDistance(Number(distanceShown));
  return calculateEffortScore(type, durationSeconds, elevation, config, (km || 0) * 1000);
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
  discard: { color: RivalColors.danger, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 4 },

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
  page: { backgroundColor: GREY_PAGE_BG },
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 32, width: '100%', maxWidth: SIDE_PAGE_MAX_WIDTH, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginBottom: 6 },
  // Small, so it labels the page without competing with the session's own
  // name, which is the real title just below.
  title: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: RivalColors.accentText },
  headerDate: { fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  fieldLabel: { fontSize: 12.5, fontWeight: '600', color: RivalColors.textSecondary, marginBottom: -4 },
  typeBlock: { gap: 12 },
  nameField: {
    backgroundColor: RivalGhost.fill, borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border,
    paddingHorizontal: 15, paddingVertical: 13, color: '#fff', fontSize: 16, fontWeight: '500',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '23%', flexGrow: 1, height: 78, justifyContent: 'flex-end', paddingHorizontal: 10, paddingBottom: 9, overflow: 'hidden',
    borderRadius: 16, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)',
  } as any,
  tileOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' } as any,
  tileAll: { borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.45)', backgroundColor: 'rgba(255,209,190,0.03)' },
  tileArt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  badgeOn: {
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  badgeAll: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.5)' },
  tileText: { fontSize: 13, fontWeight: '800', color: '#fff' } as any,
  tileTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  tileAllText: { color: RivalColors.accentText },
  tileGap: { width: '23%', flexGrow: 1 } as any,
  // See all: whole words only, two lines at most (Velomobile, Mountain bike).
  tileSmall: { paddingHorizontal: 6 },
  tileTextSmall: {
    fontSize: 11.5, lineHeight: 13.5, letterSpacing: -0.3,
    ...(Platform.OS === 'web' ? { wordBreak: 'keep-all', overflowWrap: 'normal' } : {}),
  } as any,
  allTypes: { gap: 14, marginTop: 4 },
  typeSearch: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: RivalGhost.border },
  typeSearchOn: { borderWidth: 1.5, borderColor: 'rgba(255,181,158,0.55)' },
  typeSearchInput: {
    flex: 1, minWidth: 0, padding: 0, fontSize: 15.5, fontWeight: '600', color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  typeGroup: { gap: 10 },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 2 },
  groupCount: { fontSize: 10.5, fontWeight: '800', color: 'rgba(255,255,255,0.3)' },
  typeCount: { textAlign: 'center', fontSize: 12.5, color: RivalColors.textSecondary },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  rowInput: {
    width: 44, textAlign: 'right', paddingVertical: 8, paddingHorizontal: 0, color: '#fff', fontSize: 15, fontWeight: '500',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  secInput: { width: 28, marginLeft: 6 },
  // Hour and minute sit either side of the colon, as a clock reads.
  hourInput: { width: 24 },
  minInput: { width: 24, textAlign: 'left' },
  wideInput: { width: 110 },
  ampm: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,181,158,0.4)', marginLeft: 4 },
  ampmText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
  rowUnit: { fontSize: 13, fontWeight: '600', color: RivalColors.textSecondary },
  // Start time under the calendar grid, then Done.
  calTime: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', gap: 12 },
  calTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calTimeLabel: { fontSize: 14, fontWeight: '600', color: '#fff' },
  calDone: { alignItems: 'center', paddingVertical: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  calDoneText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  nameInput: {
    padding: 0, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 24, fontWeight: '700', color: '#fff', lineHeight: 30,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },

  stack: { gap: 12 },


  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText, marginBottom: 8, marginLeft: 2 },
  chips: { gap: 8, paddingRight: 16 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border,
  },
  chipOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: RivalButtonColors.fill },
  chipText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.textSecondary },
  chipTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },

  card: { backgroundColor: PHONE_CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border, padding: 14, gap: 12 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary },
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
  mediaEmpty: {
    minHeight: 112, justifyContent: 'flex-end', paddingVertical: 14, paddingHorizontal: 16, overflow: 'hidden',
    borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)', backgroundColor: RivalGhost.fill,
  },
  mediaEmptyIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,181,158,0.14)' },
  mediaEmptyTitle: { fontSize: 16, fontWeight: '800', color: RivalColors.textPrimary },
  mediaEmptySub: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  addTileText: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText },

  nameCount: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.45)', marginTop: -4 },
  journal: { borderRadius: 16, backgroundColor: PHONE_CARD_BG, borderWidth: 1, borderColor: RivalGhost.border, paddingHorizontal: 14, paddingVertical: 14 },
  // The label as on the Time card: no rule under it (Ricky, 2026-10-29).
  journalLabel: { marginBottom: 8 },
  post: { borderRadius: 18, overflow: 'hidden', backgroundColor: RivalGhost.fill, borderWidth: 1.5, borderColor: 'rgba(255,181,158,0.45)' },
  postMedia: { minHeight: 150, borderWidth: 0, borderRadius: 0, borderBottomWidth: 1, borderBottomColor: 'rgba(255,181,158,0.2)', backgroundColor: 'rgba(255,255,255,0.03)' },
  postThumbs: { padding: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,181,158,0.2)' },
  postCaption: { padding: 14 },
  postHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  postHintText: { fontSize: 12, color: RivalColors.textSecondary },
  journalInputShort: { minHeight: 50 },
  journalInput: {
    minHeight: 88, padding: 0, textAlignVertical: 'top',
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 19, lineHeight: 25, color: 'rgba(255,255,255,0.85)',
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
    flex: 1, minWidth: 0, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, borderColor: 'transparent',
    fontSize: 15.5, fontWeight: '700', color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  liftNameEmpty: { borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.55)', backgroundColor: 'rgba(255,209,190,0.06)' },
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
  repeatWrap: { gap: 8 },
  // Weights: main lifts as chips, and one-row exercises (compactLift).
  mainLifts: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  mainLift: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  mainLiftOn: { backgroundColor: RivalGhost.fillOn, borderColor: RivalGhost.borderOn },
  mainLiftText: { fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  mainLiftTextOn: { color: '#fff' },
  cLift: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, paddingVertical: 9, paddingHorizontal: 10, gap: 8 },
  cRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cName: {
    fontSize: 14.5, fontWeight: '700', color: '#fff', paddingVertical: 5, paddingHorizontal: 8, marginLeft: -8,
    borderRadius: 10, borderWidth: 1, borderColor: 'transparent',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  cSub: { fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: -1 },
  cPb: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5, color: '#FFD700', marginTop: 1 },
  cNums: { flexDirection: 'row', gap: 5 },
  cNum: { width: 50, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 9, paddingTop: 5, paddingBottom: 4, borderWidth: 1, borderColor: 'transparent' },
  cNumLabel: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' },
  cNumInput: {
    width: '100%', textAlign: 'center', padding: 0, fontSize: 17, fontWeight: '300', color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  cExtras: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cRemove: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)' },
  cRemoveText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  repeatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  repeatRowFirst: { backgroundColor: 'rgba(255,209,190,0.08)', borderColor: 'rgba(255,181,158,0.35)' },
  repeatIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,209,190,0.10)', alignItems: 'center', justifyContent: 'center' },
  repeatTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  repeatDetail: { fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  repeatUse: { fontSize: 12, fontWeight: '800', color: RivalColors.accentText },
  repeatMore: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', marginLeft: -2 },
  savedMenu: { flexDirection: 'row', gap: 8, marginTop: 6, justifyContent: 'flex-end' },
  savedMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: RivalColors.surfaceHigh, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  savedMenuText: { fontSize: 12.5, fontWeight: '700', color: RivalColors.onSurface },
  repeatOr: { textAlign: 'center', fontSize: 11.5, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
  liftFieldTyping: { borderWidth: 1.5, borderColor: 'rgba(255,181,158,0.55)' },
  liftFieldCalc: { fontWeight: '500' },
  liftFieldPct: { fontSize: 10, fontWeight: '700', color: RivalColors.accentText, marginTop: -1 },
  liftMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  liftMetaText: { flex: 1, minWidth: 0, fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  sameBtn: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,209,190,0.10)' },
  sameBtnText: { fontSize: 12, fontWeight: '800', color: RivalColors.accentText },
  pctSeg: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 999, padding: 2, gap: 2 },
  pctSegBtn: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 999 },
  pctSegBtnOn: { backgroundColor: 'rgba(255,209,190,0.16)' },
  pctSegText: { fontSize: 11.5, fontWeight: '800', color: RivalColors.textSecondary },
  pctSegTextOn: { color: RivalColors.accentText },
  saveWorkoutRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveWorkoutInput: {
    flex: 1, minWidth: 0, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.18)', color: '#fff', fontSize: 14,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  workoutSaved: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  workoutSavedText: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  saveWorkoutLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  saveWorkoutLinkText: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  // The first-time lift's "Personal best" switch (design/first-lift-pb-mockup.html).
  firstLift: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: RivalGhost.hairline },
  firstLiftTitle: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  firstLiftTitleOn: { color: '#ffd27a' },
  firstLiftSub: { fontSize: 11.5, lineHeight: 15.5, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  pbSwitch: { width: 42, height: 25, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', padding: 3, justifyContent: 'center' },
  pbSwitchOn: {
    backgroundColor: '#f5c76a',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(160deg, #fff0b0 0%, #f5c76a 45%, #c4932a 100%)' } as any : {}),
  },
  pbKnob: { width: 19, height: 19, borderRadius: 10, backgroundColor: '#fff', ...(Platform.OS === 'web' ? { boxShadow: '0px 1px 3px rgba(0,0,0,0.35)' } as any : {}) },
  pbKnobOn: { alignSelf: 'flex-end' },

  dangerZone: { alignItems: 'center', paddingVertical: 18 },
  dangerText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.danger },
  discardText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.danger },

  saveBar: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, gap: 8,
    backgroundColor: GREY_PAGE_BG, borderTopWidth: 1, borderTopColor: RivalGhost.hairline,
  },
  saveBarError: { textAlign: 'center' },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 14, width: '100%', maxWidth: SIDE_PAGE_MAX_WIDTH - 32, alignSelf: 'center' },
  // Capped at half the bar: a long note ("Faster than realistic…") wraps
  // inside it instead of squeezing the button into a sliver.
  effortBlock: { minWidth: 92, maxWidth: '50%', flexShrink: 1 },
  effortLine: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  effortNum: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  effortUnit: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  effortSub: { fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.45)', marginTop: 1 },
  effortWarn: { color: RivalColors.accentText },
  effortEmpty: { fontSize: 11.5, fontWeight: '600', lineHeight: 15, color: 'rgba(255,255,255,0.45)' },
  saveBtn: { flex: 1, minWidth: 140, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.55 },
  saveBtnText: { fontSize: 15.5, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill), letterSpacing: 0.2 },
});

// Weights (design/weights-input-mockup-2.png, 2b).
const w = StyleSheet.create({
  stack: { gap: 12 },
  half: { flexDirection: 'row', gap: 10 },
  big: { flex: 1, minHeight: 132, borderRadius: 18, padding: 14, justifyContent: 'space-between', backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  bigTime: { borderWidth: 1.5, borderColor: 'rgba(255,181,158,0.45)' },
  bigOn: { borderColor: 'rgba(255,181,158,0.6)' },
  bigHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bigSub: { fontSize: 12, color: RivalColors.textSecondary },
  timeLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  timeInput: {
    minWidth: 26, maxWidth: 90, padding: 0, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 42, lineHeight: 48, color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', fieldSizing: 'content' } as any : {}),
  },
  timeUnit: { fontSize: 13, fontWeight: '800', color: 'rgba(255,255,255,0.45)' },
  repeatTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, lineHeight: 23, color: '#fff' },
  sec: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: RivalColors.textSecondary, marginTop: 4, marginBottom: -4, marginLeft: 2 },
  open: { borderRadius: 16, padding: 14, gap: 10, backgroundColor: RivalGhost.fill, borderWidth: 1.5, borderColor: 'rgba(255,181,158,0.45)' },
  openHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  openName: {
    flex: 1, minWidth: 0, padding: 0, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, lineHeight: 27, color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  openNameEmpty: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.5)' },
  unitBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  boxes: { flexDirection: 'row', gap: 8 },
  box: { flex: 1, borderRadius: 14, paddingTop: 10, paddingBottom: 9, alignItems: 'center', backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  boxTyping: { borderColor: RivalColors.accentText, backgroundColor: 'rgba(255,181,158,0.12)' },
  boxInput: {
    width: '100%', padding: 0, textAlign: 'center', fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, lineHeight: 34, color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  boxLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  openSub: { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  another: { height: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  anotherText: { fontSize: 14.5, fontWeight: '800', color: RivalColors.accentText },
  quick: { flexDirection: 'row', gap: 8 },
  quickTile: { flex: 1, minWidth: 0, height: 62, borderRadius: 14, overflow: 'hidden', justifyContent: 'flex-end', paddingHorizontal: 8, paddingBottom: 8, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)' },
  quickGap: { flex: 1 },
  quickArt: { position: 'absolute', top: 6, right: 6 },
  quickText: { fontSize: 12, lineHeight: 14, fontWeight: '800', color: '#fff' },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.035)' },
  addedName: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: '#fff' },
  addedSum: { fontSize: 13.5, color: RivalColors.textSecondary, fontVariant: ['tabular-nums'] },
  includes: { textAlign: 'center', fontSize: 12, color: RivalColors.textSecondary },
  distanceInput: { maxWidth: 120 },
  pace: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.035)' },
  paceText: { fontSize: 14, fontWeight: '600', color: '#fff', fontVariant: ['tabular-nums'] },
  qTile: { flex: 1, minWidth: 0, height: 60, paddingTop: 9, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)' },
  qTileOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' } as any,
  qUsual: { position: 'absolute', top: 5, left: 0, right: 0, textAlign: 'center', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' },
  qNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 25, lineHeight: 26, color: '#fff' },
  qNumOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  qUnit: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: 'rgba(255,255,255,0.45)', marginTop: 1 },
  qOnText: { color: 'rgba(58,26,14,0.7)' },
  timeCard: { borderRadius: 18, padding: 14, alignItems: 'center', gap: 4, backgroundColor: RivalGhost.fill, borderWidth: 1.5, borderColor: 'rgba(255,181,158,0.45)' },
  cardLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  cardInput: {
    minWidth: 40, maxWidth: 160, padding: 0, textAlign: 'center', fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 64, lineHeight: 72, color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', fieldSizing: 'content' } as any : {}),
  },
  cardUnit: { fontSize: 14, fontWeight: '800', letterSpacing: 0.6, color: 'rgba(255,255,255,0.45)' },
  cardSub: { fontSize: 12.5, color: RivalColors.textSecondary, textAlign: 'center' },
  liftsCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.4)' },
  liftsIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  liftsTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  liftsSub: { fontSize: 12.5, color: RivalColors.textSecondary, marginTop: 2 },
});
