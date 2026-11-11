import { useEffect, useMemo, useRef, useState } from 'react';
import { ROUTE_TYPES, useGpsState } from '../lib/gpsRecorder';
import { Image, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Modal } from '../components/rival/RivalModal';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase, getAuthUser } from '../lib/supabase';
import { RivalIcon, type RivalIconName } from '../components/rival/RivalIcon';
import { MomentCaptured } from '../components/rival/MomentCaptured';
import { LiveCamera, liveCameraAvailable } from '../components/rival/LiveCamera';
import { GreyField, GreyPrimary, GreySheet, GREY_PAGE_BG } from '../components/rival/RivalGreySheet';
import { pickMediaFiles } from '../components/rival/MediaPicker';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import { goToTab } from '../lib/tabNav';
import { confirmAction } from '../lib/notify';
import { tilesFor, useRecentTypes, withUsual } from '../lib/recentTypes';
import { bestFor, lastTimeFor, liftKey, liftsByUse, upNext, usualFor, type LiftActivity, type LiftEntry } from '../lib/liftHistory';
import { selectAll } from '../lib/selectAll';
import { CANONICAL_LIFTS, isHoldLift } from '../lib/lifts';
import { todaysWorkout, updateSavedWorkout, type SavedWorkoutRow } from '../lib/savedWorkouts';
import { loadStartData, startDataNow, type PastRow } from '../lib/startData';
import { liftsFromSaved, liftsToSave, liveClock, liveSeconds, logsLifts, togglePause, totalSets, type LiveActivity, type LiveLift } from '../lib/liveActivity';
import { addLivePhotos, clearLive, setLivePhotos, startLive, updateLive, useLive, useTick } from '../lib/liveActivityStore';
import { distanceUnit, elevationUnit, formatDistance, toDisplayDistance, toDisplayElevation, toDisplayWeight, weightUnit } from '../lib/units';
import { currentPace, elevationGain, paceClock, splits, trackDistance } from '../lib/liveTrack';
import { saveLiveActivity } from '../lib/saveLiveActivity';
import { getLivePhotos } from '../lib/liveActivityStore';
import { backToOrigin } from '../lib/tabNav';
import { LiveRoute } from '../components/rival/LiveRoute';
import { FinishSplits, FinishTiles, MoreDetails, MoreDetailsRow, type Tile } from '../components/rival/LiveFinishParts';
import { EffortBreakdownSheet } from '../components/rival/EffortBreakdownSheet';
import { calculateEffortScore, loadScoringConfig, type ScoringConfig } from '../lib/effort';
import { MilestonePhotoPrompt } from '../components/rival/MilestonePhotoPrompt';
import { showSavedActivityNote } from '../components/rival/SavedActivityNote';
import { MediaPicker, type MediaItem } from '../components/rival/MediaPicker';
import { tileLabel } from '../lib/activityTypes';
import { fetchTeammates } from '../lib/sharedActivities';
import { START_TYPES, speedNow, hyroxPart, hyroxParts, hyroxSplits, hyroxTotals, highestPoint, showsSpeed, skiRuns, statFamily, topSpeed, waves, WOD_LABEL, type ActivityStats, type MatchResult, type Score, type Wod } from '../lib/activityStats';
import { finishTiles, moreDetailsLine } from '../lib/finishTiles';
import { AddCard, LiftsCard, MiniBars, ResultCard, ResultEditor, RoundsCard, RoundSplits, ScoreCard, ScoreEditor, SkiChart, SwimDetails, TableCard, WodPicker } from '../components/rival/LiveFinishExtras';

const KG_PER_LB = 0.453592;
const fromDisplayWeight = (shown: number) => (weightUnit() === 'lb' ? shown * KG_PER_LB : shown);

// Start, from the middle of the bottom bar (Ricky, 2026-10-31, ready screen A).
// Nothing running: the ready screen, a full-screen photo per activity, swiped
// sideways. Running: the timer, lifts as you go and Capture The Moment. Finish
// hands over to Log an activity, so a recorded activity is reviewed and scored
// exactly like any other.

const DEFAULT_TYPES = ['WeightTraining', 'Run', 'Ride', 'Workout', 'Walk', 'Hike', 'TrailRun', 'CrossFit', 'Calisthenics', 'HIIT', 'MountainBikeRide'];
const LABELS: Record<string, string> = {
  WeightTraining: 'Weight training', TrailRun: 'Trail run', VirtualRun: 'Treadmill', VirtualRide: 'Indoor ride', Hyrox: 'HYROX',
};
const label = (t: string) => LABELS[t] ?? tileLabel(t);

// Always these, never a person's own photos (Ricky, 2026-11-01), so the page
// stays polished however a photo turned out.
const STOCK: Record<string, number> = {
  WeightTraining: require('../../assets/images/backgrounds/optimized/deadlift-rival-plates-box.jpg'),
  Run: require('../../assets/images/backgrounds/optimized/trail-runner-summit-marker.jpg'),
  TrailRun: require('../../assets/images/backgrounds/optimized/ridge-runners-hazy-backlit.jpg'),
  Ride: require('../../assets/images/backgrounds/optimized/mountain-bikers-forest-trail.jpg'),
  Swim: require('../../assets/images/backgrounds/optimized/coastal-highway-triathlete-dusk-3.jpg'),
  Workout: require('../../assets/images/backgrounds/optimized/overhead-squat-warehouse-gym.jpg'),
  Walk: require('../../assets/images/backgrounds/optimized/sunset-beach-group-walking.jpg'),
  Hike: require('../../assets/images/backgrounds/optimized/coastal-cliff-hikers-group.jpg'),
  CrossFit: require('../../assets/images/backgrounds/optimized/handstand-crossfit-box.jpg'),
  Calisthenics: require('../../assets/images/backgrounds/optimized/handstand-city-plaza-dawn.jpg'),
  HIIT: require('../../assets/images/backgrounds/optimized/rope-climb-atelier-gym.jpg'),
  Hyrox: require('../../assets/images/backgrounds/optimized/overhead-squat-warehouse-gym.jpg'),
  MountainBikeRide: require('../../assets/images/backgrounds/optimized/mountain-bikers-forest-trail.jpg'),
  GravelRide: require('../../assets/images/backgrounds/optimized/mountain-bikers-forest-trail.jpg'),
  AlpineSki: require('../../assets/images/backgrounds/optimized/a-solitary-majestic-snow-capped.jpg'),
  Snowboard: require('../../assets/images/backgrounds/optimized/a-solitary-majestic-snow-capped.jpg'),
  BackcountrySki: require('../../assets/images/backgrounds/optimized/a-solitary-sharp-mountain-peak.jpg'),
  NordicSki: require('../../assets/images/backgrounds/optimized/a-vast-sun-drenched-alpine.jpg'),
  Snowshoe: require('../../assets/images/backgrounds/optimized/a-vast-sun-drenched-alpine.jpg'),
  Yoga: require('../../assets/images/backgrounds/optimized/handstand-airy-warehouse-gym.jpg'),
  // Stand-ins until the Start backgrounds are made (BETA_PLAN, AI backgrounds).
  Kayaking: require('../../assets/images/backgrounds/optimized/coastal-highway-triathlete-dusk-3.jpg'),
  StandUpPaddling: require('../../assets/images/backgrounds/optimized/sunset-beach-group-walking.jpg'),
  Sail: require('../../assets/images/backgrounds/optimized/coastal-highway-triathlete-dusk-3.jpg'),
  InlineSkate: require('../../assets/images/backgrounds/optimized/handstand-city-plaza-dawn.jpg'),
  Wheelchair: require('../../assets/images/backgrounds/optimized/handstand-city-plaza-dawn.jpg'),
  Golf: require('../../assets/images/backgrounds/optimized/team-feed-hero-dusk-ridge-2.jpg'),
};
const STOCK_OTHER: number = require('../../assets/images/backgrounds/optimized/a-rugged-winding-mountain-path.jpg');

const setsIn = (r: PastRow) => (Array.isArray(r.exercises) ? r.exercises.reduce((n: number, e: any) => n + (Number(e?.sets) || 0), 0) : 0);
const close = () => (router.canGoBack() ? router.back() : goToTab('/home'));

function toHistory(rows: PastRow[]): LiftActivity[] {
  return rows.filter((r) => Array.isArray(r.exercises) && r.exercises.length)
    .map((r) => ({ id: r.id, startedAt: r.started_at, activityType: r.activity_type, exercises: r.exercises }));
}

export default function StartScreen() {
  const { live, photos } = useLive();
  return live ? <LiveScreen live={live} photos={photos} /> : <ReadyScreen />;
}

// ---- Ready ------------------------------------------------------------------

/** The page's photo, faded in once it has loaded rather than drawn in strips. */
function StartPhoto({ source }: { source: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Image
      source={source}
      style={[s.stock, { opacity: loaded ? 1 : 0 }, Platform.OS === 'web' && ({ transition: 'opacity 260ms ease-out' } as any)]}
      resizeMode="cover"
      onLoad={() => setLoaded(true)}
    />
  );
}

function ReadyScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const recent = useRecentTypes();
  // Drawn at once: from data fetched ahead of the tap, or the usual types
  // until it arrives. The first swipe freezes the order, so pages never move under a thumb.
  const [data, setData] = useState(startDataNow);
  const past = data?.past ?? null;
  const saved = data?.saved ?? null;
  const [index, setIndex] = useState(0);
  // Per activity type, the saved activity picked; undefined is the default.
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    loadStartData().then(setData).catch(() => {});
  }, []);

  const today = useMemo(() => (saved ? todaysWorkout(saved) : null), [saved]);
  // Opens on today's saved activity, else the last type done.
  // Frozen once there is history to order by, so the pages never change
  // under the person once Start is open.
  const frozen = useRef<string[] | null>(null);
  const types = useMemo(() => {
    if (frozen.current) return frozen.current;
    const first = today?.activityType ?? past?.[0]?.activity_type ?? recent[0] ?? withUsual([])[0];
    const rest = tilesFor(past ? withUsual(past.map((r) => r.activity_type)) : recent, DEFAULT_TYPES, 2);
    const order = [...new Set([...(first ? [first] : []), ...rest])].filter((t) => START_TYPES.has(t)).slice(0, 10);
    if (past) frozen.current = order;
    return order;
  }, [today, past, recent]);

  const lastOf = (t: string) => past?.find((r) => r.activity_type === t) ?? null;
  // When the order settles (history arrives) before any swipe, go back to the
  // first page: the browser otherwise follows the page that was showing to
  // its new place, and Start opened partway along (Ricky, 2026-11-02).
  const pager = useRef<ScrollView>(null);
  const swiped = useRef(false);
  const firstType = types[0];
  useEffect(() => {
    if (swiped.current) return;
    pager.current?.scrollTo({ x: 0, animated: false });
    setIndex(0);
  }, [firstType, types.length]);

  const type = types[index] ?? types[0];
  const choices = (saved ?? [] as SavedWorkoutRow[]).filter((w) => !w.activityType || w.activityType === type);
  const showSaved = logsLifts(type) && choices.length > 0;
  const chosenId = picked[type] !== undefined ? picked[type] : (today && (today.activityType === type || !today.activityType) ? today.id : null);
  const chosen = choices.find((w) => w.id === chosenId) ?? null;

  // CrossFit and HYROX ask the workout's shape first, unless a saved
  // activity already says (design/crossfit-live-mockup.png, 1).
  const [wod, setWod] = useState<Wod | null>(null);
  function tapStart() {
    if ((type === 'CrossFit' || type === 'Hyrox') && !chosen) setWod(type === 'Hyrox' ? { format: 'race', minutes: null, division: 'Open' } : { format: 'amrap', minutes: 20 });
    else start();
  }

  function start(picked?: Wod) {
    const history = toHistory(past ?? []);
    const lifts = chosen ? liftsFromSaved(chosen.exercises).map((l) => {
      const last = lastTimeFor(history, l.name);
      return { ...l, sets: last?.sets ?? l.sets, reps: last?.reps ?? l.reps, weight: last?.weight ?? l.weight };
    }) : [];
    if (chosen) updateSavedWorkout(chosen.id, { touch: true }).catch(() => {});
    const movements = picked?.movements?.filter((m) => m.name.trim());
    startLive({ activityType: type, savedId: chosen?.id ?? null, name: chosen?.name ?? null, lifts, ...(picked ? { stats: { wod: { ...picked, movements } } } : {}) });
    setWod(null);
  }

  return (
    <View style={s.readyPage}>
      <ScrollView
        ref={pager}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEventThrottle={32}
        onTouchStart={() => { swiped.current = true; }}
        onScroll={(e) => {
          if (e.nativeEvent.contentOffset.x > 4 && swiped.current) frozen.current = types;
          const next = Math.round(e.nativeEvent.contentOffset.x / width);
          if (next !== index && next >= 0 && next < types.length) setIndex(next);
        }}
        style={[StyleSheet.absoluteFill, Platform.OS === 'web' && ({ overflowAnchor: 'none' } as any)]}
      >
        {types.map((t) => {
          const last = lastOf(t);
          const distance = (last?.distance_meters ?? 0) > 0 ? formatDistance((last?.distance_meters ?? 0) / 1000) : null;
          const sets = last ? setsIn(last) : 0;
          const stats = last ? [
            { value: liveClock(last.duration_seconds ?? 0), name: 'LAST TIME' },
            ...(logsLifts(t) ? (sets ? [{ value: String(sets), name: 'SETS' }] : []) : (distance ? [{ value: distance, name: 'DISTANCE' }] : [])),
            ...(last.effort_score ? [{ value: String(Math.round(last.effort_score)), name: 'EFFORT' }] : []),
          ] : [];
          return (
            <View key={t} style={{ width, height: '100%' as any }}>
              {/* Only this page's photo and its neighbours load: all ten at once
                  arrived in pieces (Ricky, 2026-11-02). */}
              {Math.abs(types.indexOf(t) - index) <= 1 ? <StartPhoto source={STOCK[t] ?? STOCK_OTHER} /> : null}
              <View style={[StyleSheet.absoluteFill, s.shade, { pointerEvents: 'none' }]} />
              <View style={s.titleBlock}>
                <Text style={s.swipe}>Swipe to change</Text>
                <Text style={s.title}>{label(t)}</Text>
              </View>
              {stats.length ? (
                <View style={s.stats}>
                  {stats.map((st, i) => (
                    <View key={st.name} style={[s.stat, i > 0 && s.statLine]}>
                      <Text style={s.statValue}>{st.value}</Text>
                      <Text style={s.statName}>{st.name}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <View style={[s.dots, { pointerEvents: 'none' }]}>
        {types.map((t, i) => <View key={t} style={[s.dot, i === index && s.dotOn]} />)}
      </View>

      {showSaved ? (
        <TouchableOpacity style={s.savedBtn} onPress={() => setPickerOpen(true)} accessibilityLabel="Choose a saved activity">
          <Text style={s.savedKicker}>Saved activity</Text>
          <View style={s.savedRow}>
            <Text style={s.savedName}>{chosen?.name ?? 'None'}</Text>
            <RivalIcon name="chevronDown" size={16} color={RivalColors.accentText} />
          </View>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={[s.x, { top: Math.max(54, insets.top + 4) }]} onPress={close} accessibilityLabel="Close">
        <RivalIcon name="close" size={21} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={[s.go, { bottom: Math.max(52, insets.bottom + 18) }]} onPress={tapStart} accessibilityLabel={`Start ${label(type)}`} activeOpacity={0.85}>
        <Text style={s.goText}>Start</Text>
      </TouchableOpacity>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={s.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPickerOpen(false)} />
          <GreySheet kicker="START" title="Saved activity" onClose={() => setPickerOpen(false)} footer={null}>
            {[{ id: null as string | null, name: 'None', detail: 'Add lifts while the timer runs.' }, ...choices.map((w) => ({
              id: w.id as string | null, name: w.name, detail: w.exercises.map((e) => e.name).filter(Boolean).join(', '),
            }))].map((row) => (
              <TouchableOpacity key={row.id ?? 'none'} style={[s.choice, row.id === (chosen?.id ?? null) && s.choiceOn]} onPress={() => { setPicked((p) => ({ ...p, [type]: row.id })); setPickerOpen(false); }}>
                <Text style={s.choiceName}>{row.name}</Text>
                <Text style={s.choiceDetail}>{row.detail}</Text>
              </TouchableOpacity>
            ))}
          </GreySheet>
        </View>
      </Modal>

      <Modal visible={!!wod} transparent animationType="slide" onRequestClose={() => setWod(null)}>
        <View style={s.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setWod(null)} />
          {wod ? (
            <GreySheet kicker={label(type).toUpperCase()} title="Workout" onClose={() => setWod(null)} footer={<View style={{ paddingBottom: Math.max(14, insets.bottom) }}><GreyPrimary label="Start workout" onPress={() => start(wod)} /></View>}>
              <WodPicker value={wod} onChange={setWod} hyrox={type === 'Hyrox'} />
            </GreySheet>
          ) : <View />}
        </View>
      </Modal>
    </View>
  );
}

// ---- Live -------------------------------------------------------------------

/** A number box. Keeps what is being typed, so "82." isn't tidied away. */
function NumBox({ value, name, onChange }: { value: number | undefined; name: string; onChange: (n: number | undefined) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <View style={s.box}>
      <TextInput
        style={s.boxInput} keyboardType="decimal-pad" placeholder="-" placeholderTextColor={RivalColors.textSecondary}
        value={text ?? (value == null ? '' : String(value))} selectTextOnFocus
        onFocus={() => setText(value == null ? '' : String(value))}
        onChangeText={(v) => { setText(v); const n = Number(v); onChange(v.trim() === '' || !Number.isFinite(n) ? undefined : n); }}
        onBlur={() => setText(null)}
      />
      <Text style={s.boxName}>{name}</Text>
    </View>
  );
}

function Side({ icon, name, onPress, lit }: { icon: RivalIconName; name: string; onPress: () => void; lit?: boolean }) {
  return (
    <TouchableOpacity style={s.side} onPress={onPress} accessibilityLabel={name} activeOpacity={0.8}>
      <View style={[s.sideCircle, lit && s.sideLit]}><RivalIcon name={icon} size={25} color={RivalColors.accentText} /></View>
      <Text style={[s.dockName, lit && s.dockNameLit]}>{name}</Text>
    </TouchableOpacity>
  );
}

const shown = (kg: number | undefined) => (kg == null ? undefined : Math.round(toDisplayWeight(kg) * 10) / 10);

function LiveScreen({ live, photos }: { live: LiveActivity; photos: MediaItem[] }) {
  const photoCount = photos.length;
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const paused = live.pausedAt != null;
  const now = useTick(!paused);
  const unit = weightUnit();
  const [past, setPast] = useState<PastRow[]>(() => startDataNow()?.past ?? []);
  const [entries, setEntries] = useState<LiftEntry[]>([]);
  // First name, for the result card.
  const [me, setMe] = useState('You');
  useEffect(() => {
    loadStartData().then((d) => setPast(d.past)).catch(() => {});
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      supabase.from('users').select('display_name').eq('id', user.id).maybeSingle()
        .then(({ data }) => { const first = (data?.display_name ?? '').trim().split(/\s+/)[0]; if (first) setMe(first); }, () => {});
      const rows = await selectAll<any>((from, to) => supabase.from('exercise_entries')
        .select('id, exercise_name, weight_kg, reps, performed_at').eq('user_id', user.id).order('id').range(from, to));
      setEntries(rows.map((r) => ({ name: r.exercise_name, weightKg: Number(r.weight_kg) || 0, reps: r.reps, at: r.performed_at })));
    })().catch(() => {});
  }, []);
  const history = useMemo(() => toHistory(past), [past]);
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [finishing, setFinishing] = useState<number | null>(null);
  // Finish pauses the clock while you decide; Keep going picks it back up,
  // unless it was already paused before (Ricky, 2026-11-02).
  const wasRunning = useRef(false);
  function openFinish(at?: number) {
    wasRunning.current = !paused;
    if (!paused) updateLive(togglePause(live));
    setFinishing(at ?? liveSeconds(live));
  }
  function keepGoing() {
    setFinishing(null);
    if (wasRunning.current) updateLive(togglePause(live));
    wasRunning.current = false;
  }
  const [keep, setKeep] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [captured, setCaptured] = useState(false);
  const type = live.activityType;
  const family = statFamily(type);
  const stats: ActivityStats = live.stats ?? {};
  const setStats = (patch: Partial<ActivityStats>) => updateLive({ stats: { ...live.stats, ...patch } });
  // A CrossFit workout or a HYROX race, picked after Start; Lifts is the usual gym screen.
  const wod = stats.wod ?? null;
  const wodMode = wod && wod.format !== 'lifts' ? wod.format : null;
  const laps = stats.laps ?? [];
  const gym = logsLifts(type) && !wodMode;

  const setLift = (i: number, patch: Partial<LiveLift>) => updateLive({ lifts: live.lifts.map((l, at) => (at === i ? { ...l, ...patch } : l)) });
  const hasNumbers = (l: LiveLift) => l.sets != null || l.reps != null || l.weight != null;
  const lineOf = (l: { name?: string; sets?: number; reps?: number; weight?: number }) => {
    const hold = !!l.name && isHoldLift(l.name);
    const count = l.sets && l.reps ? `${l.sets} × ${l.reps}${hold ? ' sec' : ''}` : l.sets ? `${l.sets} sets` : l.reps ? `${l.reps}${hold ? ' sec' : ' reps'}` : '';
    return { count, weight: l.weight != null ? `${shown(l.weight)} ${unit}` : '' };
  };

  // One tap logs it with last time's numbers. A first-timer has none, so the
  // numbers open once.
  function addLift(name: string) {
    const prior = lastTimeFor(history, name);
    const clean = name.trim();
    const at = live.lifts.length;
    updateLive({ lifts: [...live.lifts, { name: clean, sets: prior?.sets, reps: prior?.reps, weight: prior?.weight, logged: !!prior }] });
    setQuery('');
    setSearching(false);
    setAdding(false);
    if (!prior) setEditing(at);
  }

  // Their usual next lift large, the rest as tiles, in order of use.
  const doneNames = live.lifts.filter((l) => l.logged).map((l) => l.name);
  const taken = new Set(live.lifts.map((l) => liftKey(l.name)));
  const next = useMemo(() => {
    const n = upNext(history, live.lifts.map((l) => l.name));
    return n && !taken.has(liftKey(n)) ? n : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, doneNames.length, live.lifts.length]);
  const q = query.trim().toLowerCase();
  const names = useMemo(() => [...new Set([...liftsByUse(history), ...CANONICAL_LIFTS])], [history]);
  const tiles = names.filter((n) => !taken.has(liftKey(n)) && n !== next && (!q || n.toLowerCase().includes(q))).slice(0, q ? 9 : next ? 5 : 8);
  const nextLast = next ? lastTimeFor(history, next) : null;
  const lastDay = nextLast ? new Date(nextLast.at).toLocaleDateString(undefined, { weekday: 'long' }) : '';

  // Straight to the camera: mid-activity is no time for a menu (Ricky, 2026-11-02).
  // Capture opens RIVAL's own camera where it can: one tap, no Use Photo or
  // Retake step (Ricky, 2026-11-02).
  const [camera, setCamera] = useState(false);
  // Tapping a photo at Finish opens them all to untick the ones not wanted.
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  async function snap(library = false) {
    if (!library && !cameraBlocked && liveCameraAvailable()) { setCamera(true); return; }
    const { items, rejected } = await pickMediaFiles({ camera: !library });
    setPhotoError(rejected[0] ?? null);
    if (items.length) { addLivePhotos(items); setCaptured(true); }
  }

  async function discard() {
    if (await confirmAction({ title: 'Discard this activity?', message: 'The time, lifts and photos will be removed.', confirmLabel: 'Discard', destructive: true })) {
      clearLive();
      close();
    }
  }

  // Save straight from Finish (Ricky, 2026-11-02): no form. A celebration
  // follows if it earned something and has no photo, then back to the page
  // Start was opened from, with a short note to edit it there.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<{ activityId: string; userId: string; note: string } | null>(null);
  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveLiveActivity(live, finishing ?? liveSeconds(live), getLivePhotos(), keep, {
      ...stats, elapsedSeconds, ...(score && wantsScore ? { score } : {}), ...(wodMode === 'emom' && !laps.length ? { laps: Array.from({ length: Math.floor(finishSeconds / 60) }, (_, i) => (i + 1) * 60) } : {}),
    });
    setSaving(false);
    if ('error' in result) { setSaveError(result.error); return; }
    const note = result.warning ?? `${label(type)} saved.`;
    setFinishing(null);
    if (result.hasPhoto) done(result.activityId, note);
    else setCelebrate({ activityId: result.activityId, userId: result.userId, note });
  }
  function done(activityId: string, note: string) {
    backToOrigin();
    clearLive();
    showSavedActivityNote(note, activityId);
  }

  const toSave = liftsToSave(live.lifts);
  const edit = editing == null ? null : live.lifts[editing];
  const best = edit ? bestFor(entries, edit.name) : null;
  const facts = edit ? [
    { name: 'LAST TIME', line: lastTimeFor(history, edit.name), sub: null as string | null },
    { name: 'USUAL', line: usualFor(history, edit.name), sub: 'Last 8 weeks' },
  ] : [];
  const bottom = Math.max(30, insets.bottom + 8);
  // The route, once GPS records one (lib/liveTrack.ts): distance leads, with
  // Splits and Map a swipe away (design/live-run-mockup.png).
  const track = live.track ?? [];
  const hasRoute = !gym && track.length >= 2;
  const gpsState = useGpsState();
  const gpsNote = gpsState === 'searching' ? 'Finding location…'
    : gpsState === 'denied' ? 'Location is off. Allow it in Settings to record the route.'
      : gpsState === 'unavailable' ? 'Location is not available. The time is still recorded.' : null;
  const unitKm = distanceUnit() === 'mi' ? 1.609344 : 1;
  const metres = hasRoute ? trackDistance(track) : 0;
  const dist = toDisplayDistance(metres / 1000).toFixed(2);
  const distName = distanceUnit() === 'mi' ? 'MILES' : 'KILOMETRES';
  const perUnit = ` /${distanceUnit()}`;
  const recorded = liveSeconds(live, now);
  const pace = hasRoute ? currentPace(track) : null;
  const avgPace = metres > 50 ? (recorded / metres) * 1000 : null;
  const gain = hasRoute ? Math.round(toDisplayElevation(elevationGain(track))) : 0;
  const split = hasRoute ? splits(track, unitKm * 1000) : { done: [], into: 0, intoSeconds: 0 };
  const fastest = split.done.length ? Math.min(...split.done.map((d) => d.seconds)) : 0;
  const slowest = split.done.length ? Math.max(...split.done.map((d) => d.seconds)) : 0;
  // 0 for the slowest split, 1 for the fastest, so small differences show.
  const quick = (sec: number) => (slowest > fastest ? (slowest - sec) / (slowest - fastest) : 1);
  const [page, setPage] = useState(0);
  const [mapW, setMapW] = useState(0);
  const heaviest = Math.max(0, ...toSave.map((l) => l.weight ?? 0));
  const volume = toSave.reduce((sum, l) => sum + (l.sets ?? 1) * (l.reps ?? 0) * (l.weight ?? 0), 0);
  const finishSeconds = finishing ?? recorded;
  // Elapsed counts the pauses too; Finish pauses the clock, so pausedAt is the end.
  const elapsedSeconds = Math.max(finishSeconds, Math.floor(((live.pausedAt ?? now) - live.startedAt) / 1000));
  const [details, setDetails] = useState(false);
  const [showEffort, setShowEffort] = useState(false);
  const [scoring, setScoring] = useState<ScoringConfig | null>(null);
  useEffect(() => { if (finishing != null && !scoring) loadScoringConfig().then(setScoring).catch(() => {}); }, [finishing, scoring]);
  const climb = hasRoute ? elevationGain(track) : 0;
  const effortNow = scoring ? calculateEffortScore(type, finishSeconds, climb, scoring, metres) : null;
  // The hero: descent on a ski day, distance where there is one, else time.
  // Board, racket, team and gym activities lead with time even with a route
  // (design/activity-stats-map.png).
  const ski = useMemo(() => (family === 'downhill' && hasRoute ? skiRuns(track) : null), [family, hasRoute, track]);
  const skiDay = ski && ski.runs.length ? ski : null;
  const swimM = !hasRoute ? stats.distanceM ?? 0 : 0;
  const heroKind: 'distance' | 'time' | 'descent' = skiDay ? 'descent'
    : TIME_HERO.has(family) ? 'time'
    : hasRoute || swimM > 50 ? 'distance' : 'time';
  const raceLaps = wodMode === 'race' ? laps : null;
  // With the Roxzone timed, a race is 31 parts rather than 16.
  const rox = !!wod?.roxzone;
  const raceParts = hyroxParts(rox);
  // Waves are for surfing and the like, not a sail.
  const wv = family === 'board' && type !== 'Sail' && hasRoute ? waves(track) : null;
  // Six at most, per activity (lib/finishTiles.ts), Effort lit and tappable.
  const finishTileList: Tile[] = finishTiles({
    family, activityType: type, hero: heroKind, metres, seconds: finishSeconds, climb,
    highest: hasRoute ? highestPoint(track) : null, topKmh: hasRoute ? topSpeed(track) : null, ski: skiDay,
    waveCount: wv?.count ?? null, longestWave: wv?.longest ?? null,
    effort: effortNow, avgBpm: live.avgBpm, maxBpm: live.maxBpm, calories: live.calories, cadence: live.cadence, avgPower: live.avgPower,
    stats, lifts: { exercises: toSave.length, sets: totalSets(live.lifts), heaviest, volume },
    hyroxKm: raceLaps ? raceParts.slice(0, raceLaps.length).filter((p) => p.kind === 'run').length : null,
    division: wodMode === 'race' ? wod?.division ?? null : null,
  }).map((t) => (t.effort ? { ...t, onPress: () => setShowEffort(true) } : t));
  // Lifts heavier than ever before get a PB pill.
  const pbs = toSave.map((l) => {
    if (!l.weight) return false;
    const before = entries.filter((e) => liftKey(e.name) === liftKey(l.name)).map((e) => e.weightKg);
    return before.length > 0 && l.weight > Math.max(...before) + 1e-9;
  });
  // A CrossFit score, filled in from the rounds tapped; a match result, typed in.
  const autoScore: Score | null = wodMode === 'amrap' ? { kind: 'rounds', rounds: laps.length, reps: 0, rx: true, workout: `AMRAP ${wod?.minutes ?? ''} min` }
    : wodMode === 'fortime' ? { kind: 'time', seconds: finishSeconds, rx: true, workout: 'For time' }
    : wodMode === 'emom' ? { kind: 'rounds', rounds: Math.floor(finishSeconds / 60), rx: true, workout: `EMOM ${wod?.minutes ?? ''} min` }
    : null;
  const score = stats.score ?? autoScore;
  const wantsScore = type === 'CrossFit' || (!!wodMode && wodMode !== 'race');
  const wantsResult = family === 'racket' || family === 'team';
  const [editor, setEditor] = useState<'score' | 'result' | null>(null);
  const [scoreDraft, setScoreDraft] = useState<Score>({ kind: 'rounds', rounds: 0, reps: 0, rx: true });
  const [resultDraft, setResultDraft] = useState<MatchResult>({ sets: [] });
  // Teammates you play most first, to pick as the opponent.
  const [teammates, setTeammates] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (editor === 'result' && family === 'racket' && !teammates.length) fetchTeammates().then(setTeammates).catch(() => {});
  }, [editor, family, teammates.length]);
  const swimDetails = family === 'swim' && !!(stats.laps100?.length || stats.strokes || stats.swolf);
  // Every 100 m up to 12 bars; past that, every 200, 300 m and so on, a time per 100 m.
  const swimBars = useMemo(() => {
    const l = stats.laps100 ?? [];
    if (!l.length) return null;
    const g = Math.ceil(l.length / 12);
    const seconds: number[] = [], labels: string[] = [];
    for (let i = 0; i < l.length; i += g) {
      const chunk = l.slice(i, i + g);
      seconds.push(Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length));
      labels.push(g === 1 ? String(i + 1) : String((i + chunk.length) * 100));
    }
    return { every: g * 100, seconds, labels };
  }, [stats.laps100]);
  const hasDetails = hasRoute || swimDetails || !!live.zoneSeconds?.some((z) => z > 0);

  // CrossFit and HYROX, live (design/crossfit-live-mockup.png): one tap a
  // round, the clock counting down an AMRAP or EMOM, Finish when time is up.
  const capS = wod?.minutes && wodMode && wodMode !== 'race' ? wod.minutes * 60 : null;
  function tapRound() {
    const next = [...laps, liveSeconds(live)];
    setStats({ laps: next });
    if (wodMode === 'race' && next.length >= raceParts.length) openFinish();
  }
  useEffect(() => {
    if (!wodMode || !capS || paused || finishing != null || recorded < capS) return;
    openFinish(capS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorded >= (capS ?? Infinity)]);
  const wodClock = wodMode === 'amrap' && capS ? Math.max(0, capS - recorded) : wodMode === 'emom' ? 60 - (recorded % 60) : recorded;
  const wodPill = wodMode === 'amrap' ? `TIME LEFT · ROUND ${laps.length + 1}`
    : wodMode === 'emom' ? `MINUTE ${Math.floor(recorded / 60) + 1}${wod?.minutes ? ` OF ${wod.minutes}` : ''}`
    : wodMode === 'race' ? `THIS PART · ${liveClock(Math.max(0, recorded - (laps[laps.length - 1] ?? 0)))}`
    : `ROUND ${laps.length + 1}${capS ? ` · CAP ${liveClock(capS)}` : ''}`;
  const wodKicker = wodMode === 'race' ? label(type).toUpperCase() : `${(live.name ?? label(type)).toUpperCase()} · ${wodMode ? WOD_LABEL[wodMode].toUpperCase() : ''}${wod?.minutes && wodMode !== 'fortime' ? ` ${wod.minutes}` : ''}`;
  const moves = wod?.movements ?? [];
  const wodBody = (
    <View style={{ flex: 1 }}>
      <View style={[s.timerBlock, { paddingTop: Math.max(88, insets.top + 34) }]}>
        <View style={s.kickerRow}>
          {paused ? null : <View style={[s.liveDot, LIVE_PULSE]} />}
          <Text style={[s.kicker, paused && s.kickerPaused]}>{paused ? 'PAUSED' : wodKicker}</Text>
        </View>
        <Text style={[s.timer, paused && s.timerPaused]}>{liveClock(wodClock)}</Text>
        <View style={s.wodPill}><Text style={s.wodPillText}>{wodPill.split(' · ')[0]}{wodPill.includes(' · ') ? ' · ' : ''}<Text style={{ color: RivalColors.accentText }}>{wodPill.split(' · ').slice(1).join(' · ')}</Text></Text></View>
      </View>
      <ScrollView
        horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flex: 1 }}
        onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / screenW))} scrollEventThrottle={32}
      >
        <View style={[s.wodPage, { width: screenW }]}>
          {moves.length ? (
            <View style={s.moves}>
              {moves.map((m, i) => (
                <View key={`${m.name}-${i}`} style={[s.moveRow, i > 0 && s.splitLine]}>
                  <Text style={s.moveName}>{m.name}</Text>
                  {m.reps ? <Text style={s.moveReps}>{m.reps}</Text> : null}
                </View>
              ))}
            </View>
          ) : <View />}
          {wodMode === 'emom' ? <View /> : wodMode === 'race' ? (
            <RoundsCard laps={laps} onRound={tapRound} label="Done" icon="check" name={`PART ${Math.min(raceParts.length, laps.length + 1)} OF ${raceParts.length}`} sub={hyroxPart(laps.length, rox).name} showTimes={false} />
          ) : (
            <RoundsCard laps={laps} onRound={tapRound} />
          )}
        </View>
        <View style={[s.wodPage, { width: screenW, justifyContent: 'flex-start' }]}>
          <RoundSplits laps={laps} names={wodMode === 'race' ? (i) => hyroxPart(i, rox).name : undefined} />
        </View>
      </ScrollView>
      <View style={s.pageDots}>{[0, 1].map((i) => <View key={i} style={[s.pageDot, page === i && s.pageDotOn]} />)}</View>
    </View>
  );
  // Lifts fill the space under the clock; otherwise it all sits centred.
  const listing = gym && live.lifts.length > 0;
  const timer = (
    <View style={[s.timerBlock, listing && { paddingTop: Math.max(88, insets.top + 34) }]}>
      <View style={s.kickerRow}>
        {paused ? null : <View style={[s.liveDot, LIVE_PULSE]} />}
        <Text style={[s.kicker, paused && s.kickerPaused]}>{paused ? 'PAUSED' : (live.name ?? label(type)).toUpperCase()}</Text>
      </View>
      <Text style={[s.timer, paused && s.timerPaused]}>{liveClock(recorded)}</Text>
      {/* Until the route has points: the GPS is still finding a signal, or
          location is off (lib/gpsRecorder.ts). */}
      {ROUTE_TYPES.has(type) && !paused && gpsNote ? (
        <Text style={[s.gpsNote, gpsState === 'searching' && Platform.OS === 'web' ? ({ animationName: 'rivalBusyPulse', animationDuration: '1.4s', animationIterationCount: 'infinite' } as any) : null]}>{gpsNote}</Text>
      ) : null}
    </View>
  );

  const kicker = (extra?: string) => (
    <View style={s.kickerRow}>
      {paused ? null : <View style={[s.liveDot, LIVE_PULSE]} />}
      <Text style={[s.kicker, paused && s.kickerPaused]}>{paused ? 'PAUSED' : `${(live.name ?? label(type)).toUpperCase()}${extra ? ` · ${extra}` : ''}`}</Text>
    </View>
  );
  // No icons on the stats (Ricky, 2026-11-02), BPM included.
  const stat = (value: string, unit: string | null, name: string, i: number) => (
    <View key={name} style={[s.stat, i > 0 && s.statLine]}>
      <View style={s.liveStatLine}>
        <Text style={s.liveStatValue}>{value}{unit ? <Text style={s.liveStatUnit}>{unit}</Text> : null}</Text>
      </View>
      <Text style={s.statName}>{name}</Text>
    </View>
  );
  // Skiing and snowboarding, live (design/live-ski-surf-mockup.png): metres
  // skied lead, speed in km/h, runs instead of splits, and the lifts told
  // apart by the altitude so nothing is tapped on a chairlift.
  const skiLive = family === 'downhill' && hasRoute ? ski : null;
  const speedU = distanceUnit() === 'mi' ? ' mph' : ' km/h';
  const kmh = (v: number | null) => (v == null ? '-' : (Math.round(toDisplayDistance(v) * 10) / 10).toFixed(1));
  const elev = (m: number | null) => (m == null ? '-' : Math.round(toDisplayElevation(m)).toLocaleString());
  const skiNow = skiLive && !skiLive.lift ? speedNow(track) : null;
  const skiedName = `${elevationUnit() === 'ft' ? 'FEET' : 'METRES'} ${type === 'Snowboard' ? 'RIDDEN' : 'SKIED'}`;
  const skiRows = skiLive ? [
    [liveClock(skiLive.skiSeconds), null, 'SKIING'],
    [kmh(skiNow), skiNow == null ? null : speedU, 'SPEED'],
    ...(live.bpm ? [[String(live.bpm), null, 'BPM']] : []),
    [String(skiLive.runs.length), null, 'RUNS'],
    skiLive.lift ? [liveClock(skiLive.liftSeconds), null, 'ON LIFTS'] : [kmh(topSpeed(track)), speedU, 'TOP SPEED'],
    [elev(skiLive.highest), ` ${elevationUnit()}`, 'HIGHEST'],
  ] as [string, string | null, string][] : null;
  // Speed, not pace, where speed is what people read: rides, paddling,
  // sailing, skating and wheelchair (Ricky: "speed, never pace" on a ride).
  // Golf shows neither.
  const bySpeed = showsSpeed(family) || family === 'row';
  const speedLive = bySpeed && hasRoute ? speedNow(track) : null;
  const avgKmh = bySpeed && metres > 50 && recorded > 0 ? (metres / recorded) * 3.6 : null;
  const statRows = skiRows ?? [
    [liveClock(recorded), null, 'TIME'],
    ...(family === 'golf' ? [] : bySpeed ? [[kmh(speedLive), speedLive == null ? null : speedU, 'SPEED']] : [[pace ? paceClock(pace, unitKm) : '-', perUnit, 'PACE']]),
    ...(live.bpm ? [[String(live.bpm), null, 'BPM']] : []),
    ...(family === 'golf' ? [] : bySpeed ? [[kmh(avgKmh), avgKmh == null ? null : speedU, 'AVG SPEED']] : [[avgPace ? paceClock(avgPace, unitKm) : '-', perUnit, 'AVG PACE']]),
    [gain.toLocaleString(), ` ${elevationUnit()}`, 'ELEVATION'],
    ...(live.calories ? [[Math.round(live.calories).toLocaleString(), null, 'CALORIES']] : []),
  ] as [string, string | null, string][];
  // Even rows: 3 + 3 with a watch, 2 + 2 without, never one stat on its own.
  const firstRow = statRows.length === 4 ? 2 : 3;
  const rows3 = [statRows.slice(0, firstRow), statRows.slice(firstRow, 6)].filter((r) => r.length);
  const mainThree = skiLive ? (
    <View style={s.liveStatRow}>
      {stat(elev(skiLive.descent), ` ${elevationUnit()}`, type === 'Snowboard' ? 'RIDDEN' : 'SKIED', 0)}
      {stat(liveClock(skiLive.skiSeconds), null, 'SKIING', 1)}
      {stat(kmh(skiNow), skiNow == null ? null : speedU, 'SPEED', 2)}
    </View>
  ) : (
    <View style={s.liveStatRow}>
      {stat(dist, ` ${distanceUnit()}`, 'DISTANCE', 0)}
      {stat(liveClock(recorded), null, 'TIME', 1)}
      {family === 'golf' ? stat(gain.toLocaleString(), ` ${elevationUnit()}`, 'ELEVATION', 2)
        : bySpeed ? stat(kmh(speedLive), speedLive == null ? null : speedU, 'SPEED', 2)
          : stat(pace ? paceClock(pace, unitKm) : '-', perUnit, 'PACE', 2)}
    </View>
  );
  const longestRun = skiLive?.runs.length ? Math.max(...skiLive.runs.map((r) => r.descent)) : 0;
  // The run under way is the last one found while not on a lift.
  const runNow = skiLive && !skiLive.lift && skiLive.runs.length ? skiLive.runs[skiLive.runs.length - 1] : null;
  const runsPage = skiLive ? (
    <>
      {kicker('RUNS')}
      <View style={s.miniStrip}>{mainThree}</View>
      <View style={s.curSplit}>
        <View style={s.curTop}>
          <Text style={s.curName}>{skiLive.lift ? 'On the lift' : `Run ${Math.max(1, skiLive.runs.length)}`}</Text>
          <Text style={s.curSub}>{skiLive.lift
            ? `${liveClock(skiLive.legSeconds)} · run ${skiLive.runs.length + 1} next`
            : `${elev(runNow?.descent ?? 0)} ${elevationUnit()} down · ${liveClock(skiLive.legSeconds)}`}</Text>
        </View>
        {skiLive.lift ? null : <View style={s.curBar}><View style={[s.curFill, { width: `${Math.min(100, ((runNow?.descent ?? 0) / (longestRun || 1)) * 100)}%` }]} /></View>}
      </View>
      {skiLive.runs.length ? (
        <View style={s.splitHead}>
          <Text style={[s.splitHeadText, { width: 50 }]}>RUN</Text>
          <Text style={[s.splitHeadText, { width: 58 }]}>DESCENT</Text>
          <View style={{ flex: 1 }} />
          <Text style={[s.splitHeadText, { width: 70, textAlign: 'right' }]}>TOP</Text>
        </View>
      ) : null}
      <ScrollView style={{ flex: 1, alignSelf: 'stretch' }} contentContainerStyle={{ paddingHorizontal: 18 }}>
        {skiLive.runs.map((r, n) => ({ r, n: n + 1 })).reverse().map(({ r, n }, i) => (
          <View key={n} style={[s.splitRow, i > 0 && s.splitLine]}>
            <Text style={[s.splitN, { width: 50 }]}>{`Run ${n}`}</Text>
            <Text style={[s.splitT, { width: 58 }]}>{`${elev(r.descent)} ${elevationUnit()}`}</Text>
            <View style={s.splitBar}><View style={[s.splitFill, r.descent === longestRun && s.splitBest, { width: `${30 + (r.descent / (longestRun || 1)) * 70}%` }]} /></View>
            <Text style={[s.splitE, { width: 70 }]}>{`${kmh(r.topKmh)}${speedU}`}</Text>
          </View>
        ))}
      </ScrollView>
    </>
  ) : null;
  const dots = (
    <View style={s.pageDots}>{[0, 1, 2].map((i) => <View key={i} style={[s.pageDot, page === i && s.pageDotOn]} />)}</View>
  );
  // The map fills the page down to the three numbers under it.
  const mapH = Math.max(300, screenH - 290);
  const pager = (
    <View style={{ flex: 1 }}>
      <ScrollView
        horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flex: 1 }}
        onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / screenW))} scrollEventThrottle={32}
      >
        <View style={[s.livePage, { width: screenW }]}>
          {kicker()}
          <Text style={s.liveHero}>{skiLive ? elev(skiLive.descent) : dist}</Text>
          <Text style={s.liveHeroUnit}>{skiLive ? skiedName : distName}</Text>
          {skiLive?.lift ? (
            <View style={[s.wodPill, { marginTop: 10 }]}><Text style={s.wodPillText}>ON THE LIFT · <Text style={{ color: RivalColors.accentText }}>{liveClock(skiLive.legSeconds)}</Text></Text></View>
          ) : null}
          {rows3.map((r, ri) => (
            <View key={ri} style={[s.liveStatRow, { marginTop: ri ? 20 : 26 }]}>
              {r.map(([v, u, n], i) => stat(v, u, n, i))}
            </View>
          ))}
        </View>
        <View style={[s.livePage, s.splitsPage, { width: screenW, paddingTop: Math.max(110, insets.top + 60) }]}>
          {runsPage ?? (<>
          {kicker('SPLITS')}
          <View style={s.miniStrip}>{mainThree}</View>
          <View style={s.curSplit}>
            <View style={s.curTop}>
              <Text style={s.curName}>{`${distanceUnit() === 'mi' ? 'Mile' : 'Kilometre'} ${split.done.length + 1}`}</Text>
              <Text style={s.curSub}>{`${toDisplayDistance(split.into / 1000).toFixed(2)} of 1 ${distanceUnit()} · ${liveClock(split.intoSeconds)}`}</Text>
            </View>
            <View style={s.curBar}><View style={[s.curFill, { width: `${Math.min(100, (split.into / (unitKm * 1000)) * 100)}%` }]} /></View>
          </View>
          {split.done.length ? (
            <View style={s.splitHead}>
              <Text style={[s.splitHeadText, { width: 38 }]}>{distanceUnit().toUpperCase()}</Text>
              <Text style={[s.splitHeadText, { width: 48 }]}>PACE</Text>
              <View style={{ flex: 1 }} />
              <Text style={[s.splitHeadText, { width: 50, textAlign: 'right' }]}>ELEV</Text>
            </View>
          ) : null}
          <ScrollView style={{ flex: 1, alignSelf: 'stretch' }} contentContainerStyle={{ paddingHorizontal: 18 }}>
            {[...split.done].reverse().map((d, i) => (
              <View key={d.n} style={[s.splitRow, i > 0 && s.splitLine]}>
                <Text style={s.splitN}>{d.n}</Text>
                <Text style={s.splitT}>{liveClock(d.seconds)}</Text>
                <View style={s.splitBar}><View style={[s.splitFill, d.seconds === fastest && s.splitBest, { width: `${45 + quick(d.seconds) * 51}%` }]} /></View>
                <Text style={s.splitE}>{`+${Math.round(toDisplayElevation(d.gain))} ${elevationUnit()}`}</Text>
              </View>
            ))}
          </ScrollView>
          </>)}
        </View>
        <View style={[s.mapPage, { width: screenW }]}>
          <LiveRoute track={track} width={screenW} height={mapH} end="now" />
          <View style={[s.mapFade, { top: mapH - 140 }]} />
          <View style={[s.mapChip, { top: Math.max(58, insets.top + 8) }]}>{kicker()}</View>
          <View style={{ paddingBottom: 6 }}>{mainThree}</View>
        </View>
      </ScrollView>
      {dots}
    </View>
  );

  return (
    <View style={s.readyPage}>
      <Image source={STOCK[type] ?? STOCK_OTHER} style={s.stock} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFill, s.liveShade, paused && s.liveShadePaused, { pointerEvents: 'none' }]} />

      {listing ? timer : null}

      {wodMode && !hasRoute ? wodBody : hasRoute ? pager : listing ? (
      <ScrollView style={s.liveList} contentContainerStyle={s.liveListIn} keyboardShouldPersistTaps="handled">
        {gym && live.lifts.length ? (
          <>
            {live.lifts.map((l, i) => {
              const { count, weight } = lineOf(l);
              return (
                <TouchableOpacity key={`${l.name}-${i}`} style={s.row} onPress={() => setEditing(i)} accessibilityLabel={`Change ${l.name}`} activeOpacity={0.7}>
                  <TouchableOpacity
                    style={[s.tick, l.logged && s.tickOn]} accessibilityLabel={l.logged ? `Undo ${l.name}` : `Log ${l.name}`}
                    onPress={() => (hasNumbers(l) ? setLift(i, { logged: !l.logged }) : setEditing(i))}
                  >
                    <RivalIcon name={l.logged ? 'check' : 'add'} size={17} color={l.logged ? '#1a1210' : RivalColors.accentText} />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowName}>{l.name}</Text>
                    {count ? <Text style={s.rowSub}>{count}</Text> : null}
                  </View>
                  {weight ? <Text style={s.rowWeight}>{weight}</Text> : null}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={s.addLift} onPress={() => setAdding(true)} activeOpacity={0.7}>
              <RivalIcon name="add" size={17} color={RivalColors.accentText} />
              <Text style={s.addLiftText}>Add exercise</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={s.prompt}>
            {photoCount === 0 ? (
              <TouchableOpacity onPress={() => snap()} activeOpacity={0.8} accessibilityLabel="Add a photo">
                <Text style={s.promptTitle}>Capture The Moment.</Text>
                <Text style={s.promptSub}>{gym ? 'Between sets, while it is happening.' : 'While it is happening.'}</Text>
              </TouchableOpacity>
            ) : null}
            {gym ? (
              <TouchableOpacity style={s.addPill} onPress={() => setAdding(true)} activeOpacity={0.7}>
                <RivalIcon name="add" size={17} color={RivalColors.accentText} />
                <Text style={s.addLiftText}>Add exercise</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        {photoError ? <Text style={s.error}>{photoError}</Text> : null}
      </ScrollView>
      ) : (
        // No lifts to list: the clock sits in the middle of the screen
        // (Ricky, 2026-11-02). Capture The Moment is the Photo button now.
        <View style={s.centred}>
          {timer}
          <View style={[s.prompt, s.promptCentred]}>
            {gym ? (
              <TouchableOpacity style={s.addPill} onPress={() => setAdding(true)} activeOpacity={0.7}>
                <RivalIcon name="add" size={17} color={RivalColors.accentText} />
                <Text style={s.addLiftText}>Add exercise</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {photoError ? <Text style={s.error}>{photoError}</Text> : null}
        </View>
      )}

      <View style={[s.dock, { paddingBottom: bottom }]}>
        <Side icon="flag" name="Finish" onPress={() => openFinish()} />
        <TouchableOpacity style={s.side} onPress={() => updateLive(togglePause(live))} accessibilityLabel={paused ? 'Resume' : 'Pause'} activeOpacity={0.85}>
          <View style={s.mainCircle}><RivalIcon name={paused ? 'play' : 'pause'} size={44} color="#fff" /></View>
          <Text style={s.dockName}>{paused ? 'Resume' : 'Pause'}</Text>
        </TouchableOpacity>
        {/* Says Capture until the first photo: a reminder that never
            interrupts the activity (Ricky, 2026-11-02). */}
        <Side icon="addPhoto" name={photoCount === 0 ? 'Capture' : 'Photo'} lit={photoCount === 0} onPress={() => snap()} />
      </View>

      <TouchableOpacity style={[s.x, { top: Math.max(54, insets.top + 4) }]} onPress={close} accessibilityLabel="Close. The timer keeps running.">
        <RivalIcon name="chevronDown" size={24} color="#fff" />
      </TouchableOpacity>

      {camera ? (
        <LiveCamera
          onShot={(item) => { setCamera(false); addLivePhotos([item]); setCaptured(true); }}
          onClose={() => setCamera(false)}
          // Camera access refused: say so, and use the phone's camera from the next tap.
          onFail={() => { setCamera(false); setCameraBlocked(true); setPhotoError('The camera could not open. Tap Capture to use the phone camera instead.'); }}
        />
      ) : null}
      {captured ? <MomentCaptured onDone={() => setCaptured(false)} /> : null}

      <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}>
        <View style={s.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAdding(false)} />
          <GreySheet title="Add exercise" onClose={() => setAdding(false)} footer={q ? <GreyPrimary label={`Add ${query.trim()}`} onPress={() => addLift(query)} /> : null}>
            <GreyField key={searching ? 'typing' : 'idle'} value={query} onChangeText={setQuery} placeholder="Search exercises" autoCorrect={false} autoFocus={searching} />
            {next && !q ? (
              <TouchableOpacity style={s.next} onPress={() => addLift(next)} activeOpacity={0.85}>
                <View style={{ flex: 1 }}>
                  <Text style={s.nextKicker}>Up next, usually</Text>
                  <Text style={s.nextName}>{next}</Text>
                  {nextLast ? <Text style={s.nextSub}>{`${lineOf(nextLast).count}, same as ${lastDay}`}</Text> : null}
                </View>
                {nextLast?.weight != null ? <Text style={s.nextWeight}>{shown(nextLast.weight)}<Text style={s.nextUnit}> {unit}</Text></Text> : null}
              </TouchableOpacity>
            ) : null}
            <View style={s.tiles}>
              {tiles.map((n) => {
                const prior = lastTimeFor(history, n);
                return (
                  <TouchableOpacity key={n} style={s.tile} onPress={() => addLift(n)} activeOpacity={0.8}>
                    {prior ? <Text style={s.tileWeight}>{prior.weight != null ? shown(prior.weight) : 'BW'}</Text> : null}
                    <Text style={s.tileName}>{n}</Text>
                    {prior ? <Text style={s.tileSub}>{lineOf(prior).count}</Text> : null}
                  </TouchableOpacity>
                );
              })}
              {!q ? (
                <TouchableOpacity style={[s.tile, s.tileNew]} onPress={() => setSearching(true)} activeOpacity={0.8}>
                  <RivalIcon name="add" size={20} color={RivalColors.accentText} />
                  <Text style={s.tileNewText}>New</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </GreySheet>
        </View>
      </Modal>

      <Modal visible={!!edit} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={s.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setEditing(null)} />
          {edit && editing != null ? (
            <GreySheet
              title={edit.name} onClose={() => setEditing(null)}
              footer={(
                <>
                  <GreyPrimary label="Done" onPress={() => { setLift(editing, { logged: hasNumbers(edit) }); setEditing(null); }} />
                  <TouchableOpacity style={s.textBtn} onPress={() => { updateLive({ lifts: live.lifts.filter((_, i) => i !== editing) }); setEditing(null); }}>
                    <Text style={s.discard}>Remove exercise</Text>
                  </TouchableOpacity>
                </>
              )}
            >
              <View style={s.boxes}>
                <NumBox value={edit.sets} name="SETS" onChange={(n) => setLift(editing, { sets: n == null ? undefined : Math.floor(n) })} />
                <NumBox value={edit.reps} name={isHoldLift(edit.name) ? 'SECONDS' : 'REPS'} onChange={(n) => setLift(editing, { reps: n })} />
                <NumBox value={shown(edit.weight)} name={unit.toUpperCase()} onChange={(n) => setLift(editing, { weight: n == null ? undefined : fromDisplayWeight(n) })} />
              </View>
              {facts.some((f) => f.line) || best ? (
                <View style={s.facts}>
                  {facts.map((f) => (f.line ? (
                    <TouchableOpacity key={f.name} style={s.fact} onPress={() => setLift(editing, { sets: f.line?.sets, reps: f.line?.reps, weight: f.line?.weight })}>
                      <Text style={s.factName}>{f.name}</Text>
                      <Text style={s.factLine}>{[lineOf(f.line).count, shown(f.line.weight)].filter((v) => v !== '' && v != null).join(' · ')}</Text>
                      <Text style={s.factSub}>{f.sub ?? new Date((f.line as { at: string }).at).toLocaleDateString(undefined, { weekday: 'long' })}</Text>
                    </TouchableOpacity>
                  ) : null))}
                  {best ? (
                    <TouchableOpacity style={s.fact} onPress={() => setLift(editing, { weight: best.kg })}>
                      <Text style={s.factName}>BEST</Text>
                      <Text style={s.factLine}>{`${shown(best.kg)} ${unit}`}</Text>
                      <Text style={s.factSub}>{best.estimated ? 'Estimated' : new Date(best.from.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </GreySheet>
          ) : <View />}
        </View>
      </Modal>

      <Modal visible={finishing != null} transparent animationType="slide" onRequestClose={keepGoing}>
        <View style={s.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={keepGoing} />
          {editor === 'score' ? (
            <GreySheet
              kicker={label(type).toUpperCase()} title="Score" onBack={() => setEditor(null)} onClose={() => setEditor(null)}
              footer={<View style={{ paddingBottom: Math.max(14, insets.bottom) }}><GreyPrimary label="Save score" onPress={() => { setStats({ score: scoreDraft }); setEditor(null); }} /></View>}
            >
              <ScoreEditor value={scoreDraft} onChange={setScoreDraft} counted={wodMode === 'amrap' || wodMode === 'fortime' ? laps.length : undefined} />
            </GreySheet>
          ) : editor === 'result' ? (
            <GreySheet
              kicker={label(type).toUpperCase()} title="Result" onBack={() => setEditor(null)} onClose={() => setEditor(null)}
              footer={<View style={{ paddingBottom: Math.max(14, insets.bottom) }}><GreyPrimary label="Save result" onPress={() => { setStats({ result: { ...resultDraft, sets: resultDraft.sets.filter((p) => p[0] || p[1]) } }); setEditor(null); }} /></View>}
            >
              <ResultEditor value={resultDraft} onChange={setResultDraft} team={family === 'team'} teammates={teammates} />
            </GreySheet>
          ) : details ? (
            <GreySheet
              kicker={heroKind === 'distance' && hasRoute ? `${label(type).toUpperCase()} · ${dist} ${distanceUnit().toUpperCase()}` : label(type).toUpperCase()} title="More details"
              onBack={() => setDetails(false)} onClose={() => setDetails(false)} footer={<View style={{ height: Math.max(14, insets.bottom) }} />}
            >
              {swimDetails && !hasRoute ? (
                <SwimDetails stats={stats} moving={finishSeconds} elapsed={elapsedSeconds} />
              ) : (
                <MoreDetails
                  track={track} unitKm={unitKm} moving={finishSeconds} elapsed={elapsedSeconds}
                  avgBpm={live.avgBpm} maxBpm={live.maxBpm} cadence={live.cadence} zoneSeconds={live.zoneSeconds} hrMax={live.hrMax}
                />
              )}
            </GreySheet>
          ) : (
          <GreySheet
            kicker={`${label(type).toUpperCase()} · PAUSED`}
            title={heroKind === 'descent' && skiDay ? Math.round(toDisplayElevation(skiDay.descent)).toLocaleString()
              : heroKind === 'distance' ? (hasRoute ? dist : Math.round(swimM).toLocaleString())
              : liveClock(finishing ?? 0)}
            heroCaption={heroKind === 'descent' ? skiedName : heroKind === 'distance' ? (hasRoute ? distName : 'METRES') : 'TIME'}
            onClose={keepGoing}
            footer={(
              <>
                {saveError ? <Text style={s.saveError}>{saveError}</Text> : null}
                <View style={s.finishBtns}>
                  <TouchableOpacity style={s.resume} onPress={keepGoing} accessibilityLabel="Resume" disabled={saving}>
                    <RivalIcon name="play" size={30} color="#fff" />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}><GreyPrimary label="Save activity" busy={saving} onPress={save} /></View>
                </View>
                <Text style={s.resumeName}>Resume</Text>
                <View style={s.finishSep} />
                {/* Clear of the iPhone's home bar, so it isn't tapped by accident. */}
                <TouchableOpacity style={[s.textBtn, { paddingBottom: 6, marginBottom: Math.max(14, insets.bottom) }]} onPress={discard} disabled={saving}><Text style={s.discardRed}>Discard activity</Text></TouchableOpacity>
              </>
            )}
          >
            {/* With a route: moving time (saved and scored) and elapsed, which
                adds the stops. Timed activities have no moving: the big number
                is the time, and a pause shows as how long it was (Ricky, 2026-11-02). */}
            {skiDay ? (
              <TimesRow cells={[[skiDay.skiSeconds, 'SKIING'], [skiDay.liftSeconds, 'ON LIFTS']]} />
            ) : raceLaps?.length ? (
              <TimesRow cells={[
                [hyroxTotals(raceLaps, rox).running, 'RUNNING'], [hyroxTotals(raceLaps, rox).stations, 'STATIONS'],
                ...(rox ? [[hyroxTotals(raceLaps, rox).roxzone, 'ROXZONE'] as [number, string]] : []),
              ]} />
            ) : heroKind === 'distance' ? (
              <TimesRow cells={[[finishSeconds, 'MOVING TIME'], [elapsedSeconds, 'ELAPSED TIME']]} />
            ) : elapsedSeconds - finishSeconds >= 5 ? (
              <TimesRow cells={[[elapsedSeconds - finishSeconds, 'PAUSED']]} />
            ) : null}
            {wantsResult ? (stats.result
              ? <ResultCard result={stats.result} me={me} onEdit={() => { setResultDraft(stats.result!); setEditor('result'); }} />
              : <AddCard label="Add result" onPress={() => { setResultDraft({ sets: [] }); setEditor('result'); }} />) : null}
            {wantsScore ? (score
              ? <ScoreCard score={score} wod={wod} onEdit={() => { setScoreDraft(score); setEditor('score'); }} />
              : <AddCard label="Add score" onPress={() => { setScoreDraft({ kind: 'rounds', rounds: 0, reps: 0, rx: true }); setEditor('score'); }} />) : null}
            <View style={wantsResult || wantsScore ? { marginTop: 10 } : null}><FinishTiles tiles={finishTileList} /></View>
            {hasRoute ? (
              <View style={s.finishMap} onLayout={(e) => setMapW(e.nativeEvent.layout.width)}>
                {mapW ? <LiveRoute track={track} width={mapW} height={84} end="finish" /> : null}
              </View>
            ) : null}
            {skiDay ? (
              <>
                <SkiChart track={track} day={skiDay} />
                <TableCard
                  title="RUNS" extra={`LONGEST ${Math.round(toDisplayElevation(Math.max(...skiDay.runs.map((r) => r.descent)))).toLocaleString()} ${elevationUnit().toUpperCase()} DESCENT`}
                  cols={[{ label: 'RUN' }, { label: 'DESCENT', width: 64 }, { label: 'TOP', width: 70 }, { label: 'TIME', width: 48 }]}
                  rows={skiDay.runs.map((r, i) => [String(i + 1), `${Math.round(toDisplayElevation(r.descent)).toLocaleString()} ${elevationUnit()}`, `${(Math.round(toDisplayDistance(r.topKmh) * 10) / 10).toFixed(1)} ${distanceUnit() === 'mi' ? 'mph' : 'km/h'}`, liveClock(r.seconds)])}
                  hi={skiDay.runs.reduce((b, r, i) => (r.descent > skiDay.runs[b].descent ? i : b), 0)} show={4} moreNoun="more runs"
                />
              </>
            ) : hasRoute && family !== 'golf' ? <FinishSplits track={track} unitKm={unitKm} speed={showsSpeed(family) || family === 'row'} /> : null}
            {raceLaps?.length ? (
              <TableCard
                title="STATIONS" cols={[{ label: 'STATION' }, { label: 'RUN', width: 52 }, { label: 'TIME', width: 56 }]}
                rows={hyroxSplits(raceLaps, rox).map((r) => [`${r.n} · ${r.station}`, r.run != null ? liveClock(r.run) : '-', r.time != null ? liveClock(r.time) : '-'])}
              />
            ) : null}
            {family === 'swim' && swimBars ? (
              <MiniBars title={`SPLITS · EVERY ${swimBars.every} M`} seconds={swimBars.seconds} labels={swimBars.labels} />
            ) : null}
            {logsLifts(type) && toSave.length ? <LiftsCard lifts={toSave} pbs={pbs} /> : null}
            {hasDetails ? <MoreDetailsRow onPress={() => setDetails(true)} sub={moreDetailsLine(family)} /> : null}
            {logsLifts(type) && !live.savedId && toSave.length ? (
              <TouchableOpacity style={s.keepRow} onPress={() => setKeep((v) => !v)} activeOpacity={0.8}>
                <RivalIcon name="replay" size={22} color={RivalColors.accentText} />
                <View style={{ flex: 1 }}>
                  <Text style={s.keepName}>Save as a saved activity</Text>
                  <Text style={s.keepSub}>{`Start with ${toSave.length === 1 ? 'this lift' : 'these lifts'} next time.`}</Text>
                </View>
                <View style={[s.switch, keep && s.switchOn]}><View style={[s.knob, keep && s.knobOn]} /></View>
              </TouchableOpacity>
            ) : null}
            {/* Photos taken during it, and the one place Capture The Moment is
                asked when there are none (Ricky, 2026-11-02). */}
            {photoCount ? (
              <View style={s.thumbs}>
                {photos.slice(0, 4).map((p, i) => (
                  <TouchableOpacity key={p.uri} onPress={() => setReviewing(p.uri)} activeOpacity={0.8} accessibilityLabel="Look through the photos">
                    {p.type === 'photo'
                      ? <Image source={{ uri: p.uri }} style={s.thumb} />
                      : <View style={[s.thumb, s.thumbVideo]}><RivalIcon name="play" size={20} color="#fff" /></View>}
                    {i === 3 && photoCount > 4 ? <View style={s.thumbMore}><Text style={s.thumbMoreText}>{`+${photoCount - 4}`}</Text></View> : null}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={s.addThumb} onPress={() => snap(true)} accessibilityLabel="Add photo">
                  <RivalIcon name="addPhoto" size={20} color={RivalColors.accentText} />
                  <Text style={s.addThumbText}>Add</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={s.finishPhoto} onPress={() => snap(true)}>
                <RivalIcon name="addPhoto" size={18} color={RivalColors.accentText} />
                <Text style={s.addLiftText}>Capture The Moment</Text>
              </TouchableOpacity>
            )}
          </GreySheet>
          )}
          {/* Inside the pop-up's layer, so it opens over it. */}
          {reviewing ? (
            <MediaPicker
              initial={photos} initialFocus={reviewing} title={photoCount === 1 ? 'Photo taken' : 'Photos taken'} doneLabel="Keep"
              onCancel={() => setReviewing(null)}
              onDone={(items) => { setLivePhotos(items); setReviewing(null); }}
            />
          ) : null}
        </View>
      </Modal>
      <EffortBreakdownSheet
        activity={showEffort && effortNow != null ? { activity_type: type, duration_seconds: finishSeconds, distance_meters: metres, elevation_meters: climb, effort_score: Math.round(effortNow) } : null}
        onClose={() => setShowEffort(false)}
      />
      {celebrate ? (
        <MilestonePhotoPrompt activityId={celebrate.activityId} userId={celebrate.userId} onDone={() => done(celebrate.activityId, celebrate.note)} />
      ) : null}
    </View>
  );
}

// Activities whose Finish leads with time even when there is a route.
const TIME_HERO = new Set(['board', 'racket', 'team', 'golf', 'weights', 'classes', 'mind', 'machine', 'climb', 'combat']);

/** Moving and elapsed, skiing and lifts, running and stations, or paused. */
function TimesRow({ cells }: { cells: [number, string][] }) {
  return (
    <View style={s.timesRow}>
      {cells.map(([sec, name], i) => (
        <View key={name} style={[s.timesCell, i > 0 && s.statLine]}><Text style={s.timesValue}>{liveClock(sec)}</Text><Text style={s.statName}>{name}</Text></View>
      ))}
    </View>
  );
}

const serif = { fontFamily: RivalSerifFamily, fontStyle: 'italic' as const };
// The dot by RUN breathes while it records (Ricky, 2026-11-02). Keyframes in
// global.css; inline because StyleSheet drops animationName on web.
const LIVE_PULSE: any = Platform.OS === 'web'
  ? { animationName: 'rivalLivePulse', animationDuration: '1.6s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' }
  : null;
const CARD = '#232120';
const LINE = 'rgba(255,181,158,0.18)';

const s = StyleSheet.create({
  readyPage: { flex: 1, backgroundColor: '#111' },
  // The size is explicit, or the image takes the photo's own size on web.
  stock: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  shade: Platform.OS === 'web'
    ? { backgroundImage: 'linear-gradient(180deg, rgba(8,8,8,.35) 0%, rgba(8,8,8,.05) 28%, rgba(8,8,8,.72) 58%, #111 88%)' } as any
    : { backgroundColor: 'rgba(8,8,8,0.5)' },
  titleBlock: { position: 'absolute', left: 0, right: 0, bottom: 412, alignItems: 'center', paddingHorizontal: 16 },
  swipe: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: RivalColors.accentText },
  title: { ...serif, fontWeight: '700', fontSize: 40, lineHeight: 48, color: '#fff', marginTop: 6, textAlign: 'center' },
  dots: { position: 'absolute', left: 0, right: 0, bottom: 397, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotOn: { width: 18, backgroundColor: RivalColors.accentText },
  stats: { position: 'absolute', left: 24, right: 24, bottom: 288, flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center' },
  statLine: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.14)' },
  statValue: { ...serif, fontWeight: '700', fontSize: 24, lineHeight: 29, color: '#fff' },
  statName: { fontSize: 8.5, letterSpacing: 1.3, fontWeight: '800', color: RivalColors.accentText },
  savedBtn: { position: 'absolute', alignSelf: 'center', bottom: 206, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  savedKicker: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  savedName: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
  x: { position: 'absolute', left: 16, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(14,13,12,0.55)', alignItems: 'center', justifyContent: 'center' },
  xLive: { backgroundColor: 'transparent' },
  go: { position: 'absolute', alignSelf: 'center', width: 118, height: 118, borderRadius: 59, backgroundColor: CARD, borderWidth: 2.5, borderColor: '#e8835f', alignItems: 'center', justifyContent: 'center' },
  goText: { ...serif, fontWeight: '600', fontSize: 30, color: 'rgba(255,255,255,0.92)' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  choice: { borderWidth: 1, borderColor: LINE, borderRadius: 16, padding: 13, marginBottom: 8, backgroundColor: 'rgba(255,181,158,0.03)' },
  choiceOn: { borderColor: '#e8835f' },
  choiceName: { fontSize: 14.5, fontWeight: '800', color: '#fff' },
  choiceDetail: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },

  liveShade: Platform.OS === 'web'
    ? { backgroundImage: 'linear-gradient(180deg, rgba(8,8,8,.55) 0%, rgba(8,8,8,.25) 26%, rgba(8,8,8,.82) 46%, #111 66%)' } as any
    : { backgroundColor: 'rgba(8,8,8,0.7)' },
  liveShadePaused: Platform.OS === 'web'
    ? { backgroundImage: 'linear-gradient(180deg, rgba(8,8,8,.75), rgba(8,8,8,.8) 55%, #111 82%)' } as any
    : { backgroundColor: 'rgba(8,8,8,0.8)' },
  timerBlock: { alignItems: 'center', paddingHorizontal: 44 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#e8835f' },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: RivalColors.accentText },
  kickerPaused: { color: 'rgba(255,255,255,0.65)' },
  timer: { ...serif, fontWeight: '700', fontSize: 84, lineHeight: 96, color: '#fff', textAlign: 'center', marginTop: 4, ...(Platform.OS === 'web' ? { fontVariantNumeric: 'tabular-nums' } as any : {}) },
  gpsNote: { fontSize: 13, lineHeight: 18, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 10, paddingHorizontal: 32 },
  timerPaused: { opacity: 0.7 },
  lastRow: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 12 },
  liveList: { flex: 1, marginTop: 12 },
  centred: { flex: 1, justifyContent: 'center', paddingTop: 40 },
  promptCentred: { marginTop: 44, paddingHorizontal: 18 },
  liveListIn: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 18, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  tick: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: 'rgba(255,181,158,0.4)', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  tickOn: { backgroundColor: '#e8835f', borderColor: '#e8835f' },
  rowName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  rowSub: { fontSize: 12.5, color: '#a0a0a0', marginTop: 1 },
  rowWeight: { ...serif, fontWeight: '700', fontSize: 16, color: '#fff' },
  prompt: { alignItems: 'center', paddingBottom: 12 },
  promptTitle: { ...serif, fontWeight: '700', fontSize: 26, lineHeight: 32, color: '#fff', textAlign: 'center' },
  promptSub: { fontSize: 13.5, color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginTop: 3 },
  addPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 44, paddingHorizontal: 20, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,181,158,0.4)', marginTop: 20 },
  addLift: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,181,158,0.4)', marginTop: 8 },
  addLiftText: { fontSize: 13.5, fontWeight: '800', color: RivalColors.accentText },
  error: { fontSize: 12.5, color: RivalColors.accentText, textAlign: 'center', marginTop: 8 },
  dock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 26, paddingTop: 8 },
  side: { alignItems: 'center' },
  sideCircle: { width: 62, height: 62, borderRadius: 31, backgroundColor: CARD, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  mainCircle: { width: 104, height: 104, borderRadius: 52, backgroundColor: CARD, borderWidth: 2.5, borderColor: '#e8835f', alignItems: 'center', justifyContent: 'center' },
  dockName: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.65)', marginTop: 7 },
  sideLit: { borderColor: '#e8835f', borderWidth: 2 },
  dockNameLit: { color: RivalColors.accentText },
  next: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 20, borderWidth: 1.5, borderColor: '#e8835f', paddingVertical: 15, paddingHorizontal: 16, marginTop: 12, backgroundColor: 'rgba(255,181,158,0.1)', ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, rgba(255,181,158,.16), rgba(217,119,87,.05))' } as any : {}) },
  nextKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: RivalColors.accentText },
  nextName: { ...serif, fontWeight: '700', fontSize: 29, lineHeight: 35, color: '#fff', marginTop: 3 },
  nextSub: { fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  nextWeight: { ...serif, fontWeight: '700', fontSize: 44, lineHeight: 50, color: '#fff' },
  nextUnit: { fontSize: 15, color: 'rgba(255,255,255,0.7)' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  tile: { width: '31%', flexGrow: 1, height: 87, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: LINE, backgroundColor: 'rgba(255,181,158,0.04)', paddingHorizontal: 4 },
  tileWeight: { ...serif, fontWeight: '700', fontSize: 20, lineHeight: 24, color: '#fff' },
  tileName: { fontSize: 12, fontWeight: '800', color: '#fff', marginTop: 3, textAlign: 'center' },
  tileSub: { fontSize: 10.5, color: '#a0a0a0', marginTop: 1 },
  tileNew: { borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.35)', backgroundColor: 'transparent' },
  tileNewText: { fontSize: 12, fontWeight: '800', color: RivalColors.accentText, marginTop: 2 },
  boxes: { flexDirection: 'row', gap: 8 },
  box: { flex: 1, alignItems: 'center', borderRadius: 16, paddingTop: 11, paddingBottom: 9, backgroundColor: 'rgba(255,255,255,0.05)' },
  boxInput: { ...serif, width: '100%', textAlign: 'center', fontSize: 32, lineHeight: 38, fontWeight: '700', color: '#fff', padding: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  boxName: { fontSize: 9, letterSpacing: 1.3, fontWeight: '800', color: '#a0a0a0', marginTop: 1 },
  facts: { flexDirection: 'row', gap: 7, marginTop: 10 },
  fact: { flex: 1, alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: LINE, paddingVertical: 9, paddingHorizontal: 4 },
  factName: { fontSize: 8.5, letterSpacing: 1.2, fontWeight: '800', color: RivalColors.accentText },
  factLine: { fontSize: 13, fontWeight: '800', color: '#fff', marginTop: 3, textAlign: 'center' },
  factSub: { fontSize: 11, color: '#a0a0a0', marginTop: 1 },
  keepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)', borderRadius: 16, padding: 12, marginTop: 12 },
  keepName: { fontSize: 14, fontWeight: '800', color: '#fff' },
  keepSub: { fontSize: 12, color: '#a0a0a0', marginTop: 1 },
  switch: { width: 42, height: 25, borderRadius: 13, padding: 3, backgroundColor: 'rgba(255,255,255,0.14)' },
  switchOn: { backgroundColor: '#e8835f' },
  knob: { width: 19, height: 19, borderRadius: 10, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  finishPhoto: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.35)', marginTop: 10 },
  textBtn: { alignItems: 'center', paddingTop: 12 },
  keepGoing: { fontSize: 14, fontWeight: '800', color: RivalColors.accentText },
  discard: { fontSize: 13, fontWeight: '600', color: RivalColors.textSecondary },
  // The live route pages and Finish B (design/live-run-mockup.png).
  livePage: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 8 },
  liveHero: { ...serif, fontWeight: '700', fontSize: 96, lineHeight: 104, color: '#fff', textAlign: 'center', marginTop: 2, ...(Platform.OS === 'web' ? { fontVariantNumeric: 'tabular-nums' } as any : {}) },
  // Georgia's 3, 4, 5, 7 and 9 hang below the line: the caption sits clear of them.
  liveHeroUnit: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.8, color: '#a0a0a0', textAlign: 'center', marginTop: 12 },
  liveStatRow: { flexDirection: 'row', alignSelf: 'stretch', marginHorizontal: 24 },
  liveStatLine: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  liveStatValue: { ...serif, fontWeight: '700', fontSize: 26, lineHeight: 31, color: '#fff' },
  liveStatUnit: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  splitsPage: { justifyContent: 'flex-start', backgroundColor: 'rgba(10,10,10,0.6)' },
  miniStrip: { alignSelf: 'stretch', marginTop: 14, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  curSplit: { alignSelf: 'stretch', marginHorizontal: 18, marginTop: 18, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  curTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  curName: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
  curSub: { fontSize: 12, color: '#a0a0a0' },
  curBar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 9, overflow: 'hidden' },
  curFill: { height: '100%', borderRadius: 3, backgroundColor: '#e8835f', ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, #D97757, #ffb59e)' } as any : {}) },
  splitHead: { flexDirection: 'row', alignSelf: 'stretch', gap: 12, marginHorizontal: 20, marginTop: 14 },
  splitHeadText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: '#a0a0a0' },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 2 },
  splitLine: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  splitN: { width: 38, fontSize: 12, fontWeight: '800', color: '#a0a0a0' },
  splitT: { ...serif, width: 48, fontWeight: '700', fontSize: 16, color: '#fff' },
  splitBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  splitFill: { height: '100%', borderRadius: 4, backgroundColor: 'rgba(255,181,158,0.55)' },
  splitBest: { backgroundColor: '#e8835f', ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, #D97757, #ffb59e)' } as any : {}) },
  splitE: { width: 50, textAlign: 'right', fontSize: 11.5, color: '#a0a0a0' },
  mapPage: { flex: 1, backgroundColor: '#111', justifyContent: 'space-between' },
  mapFade: { position: 'absolute', left: 0, right: 0, height: 140, ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, rgba(17,17,17,0), #111)' } as any : {}) },
  mapChip: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(14,13,12,0.7)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  pageDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  pageDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  pageDotOn: { width: 18, backgroundColor: RivalColors.accentText },
  finishMap: { height: 84, borderRadius: 14, overflow: 'hidden', marginTop: 10, backgroundColor: '#1e1f1e' },
  thumbs: { flexDirection: 'row', gap: 8, marginTop: 10 },
  thumb: { width: 58, height: 58, borderRadius: 14, backgroundColor: '#444' },
  thumbVideo: { alignItems: 'center', justifyContent: 'center' },
  thumbMore: { position: 'absolute', top: 0, left: 0, width: 58, height: 58, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  thumbMoreText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  addThumb: { width: 58, height: 58, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.4)', alignItems: 'center', justifyContent: 'center', gap: 2 },
  addThumbText: { fontSize: 10.5, fontWeight: '800', color: RivalColors.accentText },
  finishBtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resume: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: '#e8835f', alignItems: 'center', justifyContent: 'center' },
  resumeName: { width: 56, textAlign: 'center', fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', marginTop: -1 },
  finishSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginTop: 12 },
  discardRed: { fontSize: 13.5, fontWeight: '700', color: '#ff8f8f' },
  saveError: { fontSize: 12.5, color: RivalColors.accentText, textAlign: 'center' },
  timesRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4, marginBottom: 12 },
  timesCell: { alignItems: 'center', paddingHorizontal: 16 },
  timesValue: { ...serif, fontWeight: '700', fontSize: 19, lineHeight: 23, color: '#fff' },
  // CrossFit and HYROX, live (design/crossfit-live-mockup.png).
  wodPill: { alignSelf: 'center', marginTop: 2, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, backgroundColor: 'rgba(14,13,12,0.6)' },
  wodPillText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.3, color: '#a0a0a0' },
  wodPage: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 22, paddingBottom: 12 },
  moves: { borderRadius: 16, backgroundColor: 'rgba(35,33,32,0.85)', paddingHorizontal: 12, paddingVertical: 2 },
  moveRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  moveName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  moveReps: { fontSize: 14, fontWeight: '600', color: '#a0a0a0' },
});
