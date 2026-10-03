import { useSnapState } from '../lib/snapState';
import { distanceUnit, elevationUnit, fromDisplayDistance, fromDisplayElevation, toDisplayDistance, toDisplayElevation } from '../lib/units';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { fetchAllActivities } from '../lib/fetchAllActivities';
import { supabase, getAuthUser } from '../lib/supabase';
import { displayToIsoDate, isoToDisplayDate, friendlyDate } from '../lib/dateFormat';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { ALL_ACTIVITIES, computeGoalProgress, goalActivityLabel, goalContributions, GOAL_ACTIVITY_TYPES } from '../lib/goalProgress';
import { confirmAction, notify } from '../lib/notify';
import { RivalChallengeRing, RivalTopNav, RivalIcon, RivalPageHeader, RivalBackButton, RivalDateField, RivalMobileHeader, RivalWarm, rm, activityIconName, type RivalIconName, RivalSheet, RivalTiles, rb, GreyPageHead, GreySheet, GreyLabel, GreyTiles, GreyRows, GreyRow, GreyRowInput, GreyField, GreyNote, GreyPrimary, GreyCalendar } from '../components/rival';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { RivalColors, RivalRadius, RivalSerifFamily, RivalFontFamily, RivalButtonColors } from '../constants/rivalTheme';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';

type Goal = {
  id: string;
  goal_type: 'distance' | 'elevation' | 'gym_sessions';
  target_value: number;
  period_type: 'week' | 'month' | 'year' | 'custom';
  start_date: string;
  end_date: string;
  activity_filter: string | null;
  progress: number;
  pinned: boolean;
  // The latest activities that counted toward it, in shown units (mobile).
  recent?: { startedAt: string; amount: number }[];
};

const GOAL_LABELS: Record<string, string> = {
  distance: 'Distance',
  elevation: 'Elevation',
  gym_sessions: 'Activities',
};

const GOAL_UNITS_METRIC: Record<string, string> = {
  distance: 'km',
  elevation: 'm',
  gym_sessions: 'activities',
};
// Read at render time, so a change of units in Profile shows straight away.
const GOAL_UNITS = new Proxy(GOAL_UNITS_METRIC, {
  get: (t, k: string) => (k === 'distance' ? distanceUnit() : k === 'elevation' ? elevationUnit() : t[k]),
}) as Record<string, string>;

function toShownGoal(type: string, v: number): number {
  return type === 'distance' ? toDisplayDistance(v) : type === 'elevation' ? toDisplayElevation(v) : v;
}
function fromShownGoal(type: string, v: number): number {
  return type === 'distance' ? fromDisplayDistance(v) : type === 'elevation' ? fromDisplayElevation(v) : v;
}

const GOAL_ABBR: Record<string, string> = {
  distance: 'DIST',
  elevation: 'ELEV',
  gym_sessions: 'GYM',
};

const GOAL_ICON: Record<string, RivalIconName> = {
  distance: 'distance',
  elevation: 'elevation',
  gym_sessions: 'weights',
};

const GOAL_BAR_COLOR: Record<string, string> = {
  distance: RivalColors.accentText,
  elevation: RivalColors.accentFill,
  gym_sessions: RivalColors.accentFill,
};

// The quick picks shown for each goal type; every other activity is under
// "More", with a custom activity at the end. "All" is null for Distance and
// Elevation, and ALL_ACTIVITIES for an Activities goal (see goalProgress.ts).
const QUICK_FILTERS: Record<string, string[]> = {
  distance: ['Run', 'Ride', 'Swim', 'Walk', 'Hike'],
  elevation: ['Run', 'Ride', 'Walk', 'Hike'],
  gym_sessions: ['Gym', 'Run', 'Ride', 'Swim'],
};
const allValue = (type: string) => (type === 'gym_sessions' ? ALL_ACTIVITIES : null);
const typeLabel = (v: string) => GOAL_ACTIVITY_TYPES.find((t) => t.value === v)?.label ?? v;

function dateToLocalStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(dateStr: string) {
  // Midday local, so a plain YYYY-MM-DD never shows as the day before.
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getNiceInterval(target: number): number {
  const niceNumbers = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  const rough = target / 8;
  return niceNumbers.find((n) => n >= rough) ?? niceNumbers[niceNumbers.length - 1];
}

const ZERO_MESSAGES = [
  "Goal set. The first activity is the start.",
  "Every activity from here counts toward it.",
  "Progress begins with the first step.",
  "Ready when you are.",
  "Today is a good day to begin.",
  "Your future self will thank you.",
];

// A week/month goal whose end_date has passed without being hit — the DB row
// itself never renews (see saveGoal), so without this it just silently
// disappears from "active" everywhere (home.tsx's featured-goal card, this
// list) with no record of it ever existing. Brand voice: never frame it as
// failure — "missed"/"expired" reads as shame, not encouragement.
function isGoalEnded(goal: Goal): boolean {
  const end = new Date(goal.end_date + 'T23:59:59');
  return end.getTime() < Date.now() && goal.progress < goal.target_value;
}

// What an ended goal achieved, said first; then what comes next. Never how
// far short it fell.
function loggedText(goal: Goal): string {
  const unit = goal.goal_type === 'gym_sessions' && goal.progress === 1 ? 'activity' : GOAL_UNITS[goal.goal_type];
  return `${goal.progress.toLocaleString()} ${unit} logged`;
}
function endedLine(goal: Goal): string {
  const next = goal.period_type === 'week' ? 'A new week is ready.' : goal.period_type === 'month' ? 'A new month is ready.' : 'A fresh start is ready.';
  return goal.progress > 0 ? `${loggedText(goal)}. ${next}` : next;
}
function endedMessage(goal: Goal): string {
  return endedLine(goal);
}

function getEncouragement(progress: number, target: number, unit: string, goalId: string): string | null {
  const pct = progress / target;
  if (pct <= 0) {
    // Pick a consistent message per goal using the id
    const idx = goalId.charCodeAt(0) % ZERO_MESSAGES.length;
    return ZERO_MESSAGES[idx];
  }
  const remaining = Math.round((target - progress) * 10) / 10;
  if (remaining <= 0) return null;
  if (remaining <= target * 0.15) return `Almost there. ${remaining} ${unit} to go.`;
  if (pct >= 0.75) return `Three quarters done. ${remaining} ${unit} to go.`;
  if (pct >= 0.5) return `Over halfway. ${remaining} ${unit} to go.`;
  return `${remaining} ${unit} to go.`;
}

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

function goalIcon(goal: Goal): RivalIconName {
  const f = goal.activity_filter;
  return f && f !== 'Gym' && f !== ALL_ACTIVITIES ? activityIconName(f) : GOAL_ICON[goal.goal_type];
}

function daysLeft(goal: Goal): number {
  const end = new Date(goal.end_date + 'T23:59:59');
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
}

function periodLabel(goal: Goal) {
  const past = isGoalEnded(goal);
  if (goal.period_type === 'week') return past ? 'Last week' : 'This week';
  if (goal.period_type === 'month') return past ? 'Last month' : 'This month';
  if (goal.period_type === 'year') return past ? 'Last year' : 'This year';
  // An extended goal says so: the history stays honest about the dates.
  const ext = Number((goal as any).extended_days ?? 0);
  return `${formatDate(goal.start_date)} – ${formatDate(goal.end_date)}${ext > 0 ? ` · extended ${ext} ${ext === 1 ? 'day' : 'days'}` : ''}`;
}

// "Distance · This month" over the title; a gym goal's type is its title.
function goalKind(goal: Goal): string {
  return `${GOAL_LABELS[goal.goal_type]} · ${periodLabel(goal)}`;
}
function goalTitle(goal: Goal): string {
  return goalActivityLabel(goal);
}

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short' });
}

// Section heading in the Today style: serif title, spaced caps under it.
function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={ms.sectionHead}>
      <Text style={ms.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={ms.sectionSub}>{subtitle}</Text> : null}
    </View>
  );
}

// A slim progress bar that fills when the page opens (web).
function SlimBar({ pct, done }: { pct: number; done: boolean }) {
  const [shown, setShown] = useState(Platform.OS === 'web' ? 0 : pct);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(raf);
  }, [pct]);
  return (
    <View style={ms.slimTrack}>
      <View
        style={[
          ms.slimFill,
          { width: `${Math.max(pct > 0 ? 2 : 0, shown * 100)}%` },
          done && { backgroundColor: RivalColors.accentGold, backgroundImage: 'none' } as any,
        ]}
      />
    </View>
  );
}

function ProgressBar({
  progress,
  target,
  color,
  unit,
  trackColor,
  hidePct = false,
}: {
  progress: number;
  target: number;
  color: string;
  unit: string;
  trackColor?: string;
  // Mobile shows the percentage beside the big number instead.
  hidePct?: boolean;
}) {
  const rawPct = progress / target;
  const pct = Math.min(rawPct, 1);
  const displayPct = Math.round(pct * 100);
  const done = rawPct >= 1;

  // Thumb: at 0% pin to left edge, at 100% pin to right edge, otherwise center on position
  const thumbStyle = done
    ? { right: 0, left: undefined as any, marginLeft: 0 }
    : pct === 0
    ? { left: 0 as any, marginLeft: 0 }
    : { left: `${pct * 100}%` as any, marginLeft: -9 };

  const interval = getNiceInterval(target);
  const checkpoints: number[] = [];
  for (let v = interval; v < target; v += interval) {
    checkpoints.push(v);
  }

  return (
    <View style={styles.barContainer}>
      {checkpoints.length > 0 && (
        <View style={styles.checkpointLabelRow}>
          {checkpoints.map((cp) => {
            const cpPct = (cp / target) * 100;
            const reached = progress >= cp;
            return (
              <View key={cp} style={[styles.checkpointLabel, { left: `${cpPct}%` }]}>
                <Text style={[styles.checkpointLabelText, reached && { color }]}>
                  {cp >= 1000 ? `${cp / 1000}k` : cp}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={[styles.barTrack, trackColor ? { backgroundColor: trackColor } : null]}>
        <View style={[styles.barFill, { width: done ? '100%' : `${pct * 100}%`, backgroundColor: color }]} />

        {checkpoints.map((cp) => {
          const cpPct = (cp / target) * 100;
          const reached = progress >= cp;
          return (
            <View
              key={cp}
              style={[styles.tick, { left: `${cpPct}%`, backgroundColor: reached ? RivalColors.textPrimary : 'rgba(255,181,158,0.45)' }]}
            />
          );
        })}

        <View style={[styles.thumb, thumbStyle, { borderColor: done ? RivalColors.accentGold : color, backgroundColor: done ? RivalColors.accentGold : RivalColors.textPrimary }]} />
      </View>

      <View style={styles.barLabels}>
        <Text style={styles.barLabelStart}>0</Text>
        {hidePct ? null : <Text style={[styles.barLabelProgress, { color: done ? RivalColors.accentGold : color }]}>{displayPct}%</Text>}
        <Text style={styles.barLabelEnd}>{target}</Text>
      </View>
    </View>
  );
}

// The Main focus ring on phone: small, with the percentage inside.
function MiniRing({ pct, size = 76, thickness = 7 }: { pct: number; size?: number; thickness?: number }) {
  const radius = (size - thickness) / 2;
  const c = 2 * Math.PI * radius;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <LinearGradient id="goalMiniRing" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={RivalColors.accentFill} />
            <Stop offset="100%" stopColor={RivalColors.accentText} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={thickness} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="url(#goalMiniRing)" strokeWidth={thickness} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, pct)))} />
      </Svg>
      <Text style={ms.ringPct}>{Math.round(pct * 100)}%</Text>
    </View>
  );
}

export default function GoalsScreen() {
  const [goals, setGoals] = useSnapState<Goal[]>('goals.goals', []);
  const [loading, setLoading] = useSnapState('goals.loading', true);
  // ?add=true (from Today's Custom goal tile) opens the form straight away.
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [showAdd, setShowAdd] = useState(add === 'true');
  const [userId, setUserId] = useSnapState('goals.userId', '');

  const [goalType, setGoalType] = useState<'distance' | 'elevation' | 'gym_sessions'>('distance');
  const [targetValue, setTargetValue] = useState('');
  const [periodType, setPeriodType] = useState<'week' | 'month' | 'year' | 'custom'>('month');
  // The full activity list under "More", and the custom activity being typed.
  const [moreOpen, setMoreOpen] = useState(false);
  const [customActivity, setCustomActivity] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  // Set while a goal is being written, so a double tap saves once.
  const goalWriting = useRef(false);
  const [endCalOpen, setEndCalOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Non-null while the modal is editing an existing goal rather than creating
  // one. Holds the whole row, not just the id, because saving needs the
  // ORIGINAL period/dates to decide whether the goal's window should be
  // recomputed — see saveGoal.
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;

  // Bumped on every visit; keys the Main focus ring so it fills each time.
  const [visit, setVisit] = useState(0);
  useFocusEffect(useCallback(() => { setVisit((v) => v + 1); load(); }, []));

  async function load() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    setUserId(user.id);

    // Together rather than one after the other. The full history, paged: a
    // plain select stops at 1,000 rows, which would under-count a goal for
    // anyone with a long imported history.
    const [{ data: goalsData }, activities] = await Promise.all([
      supabase
        .from('goals')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      fetchAllActivities(user.id, 'activity_type, name, distance_meters, elevation_meters, started_at'),
    ]);

    if (!goalsData) { setLoading(false); return; }

    // Shown in the units chosen in Profile. Stored targets stay metric;
    // storedTarget keeps the original for anything written back.
    const goalsWithProgress = goalsData.map((goal: any) => {
      const progress = computeGoalProgress(goal, activities || []);
      const conv = (v: number) => Math.round(toShownGoal(goal.goal_type, v) * 10) / 10;
      const recent = goalContributions(goal, activities || []).slice(0, 3)
        .map((c) => ({ startedAt: c.startedAt, amount: conv(c.amount) }));
      return { ...goal, storedTarget: goal.target_value, target_value: conv(goal.target_value), progress: conv(progress), recent };
    });

    setGoals(goalsWithProgress);
    setLoading(false);
  }

  // Week and Month are both rolling windows anchored to the moment the goal
  // is set (or renewed via "Try again") — NOT the calendar week/month. A
  // goal started on the 19th runs 19th-25th, not Monday-Sunday; a goal
  // started mid-month runs a full 28 days from today, not just to the end
  // of the current calendar month. Ricky's call: goals should always give
  // you the full period you signed up for, never a partial one because of
  // where today happens to fall in the calendar.
  function getDateRange(period: 'week' | 'month' | 'year' | 'custom') {
    const now = new Date();
    // A year goal is the calendar year, like the yearly ranks, and counts
    // everything since 1 January.
    if (period === 'year') {
      return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31) };
    }
    const start = now;
    if (period === 'week') {
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }
    if (period === 'month') {
      // A fixed 28 days rather than real calendar-month arithmetic — Ricky's
      // call, so every "Month" goal is the same length no matter which
      // actual months it happens to cross (was 28-31 days depending on
      // start date, via setMonth()).
      const end = new Date(start);
      end.setDate(start.getDate() + 27);
      return { start, end };
    }
    const customIso = customEndDate ? displayToIsoDate(customEndDate) : null;
    const end = customIso
      ? (() => { const [y, m, d] = customIso.split('-').map(Number); return new Date(y, m - 1, d); })()
      : now;
    return { start, end };
  }

  // Opens the same modal the + button does, prefilled. Reusing one form
  // rather than writing a second edit-only screen keeps the two paths from
  // drifting apart as goal options get added.
  function openEdit(goal: Goal) {
    setEditingGoal(goal);
    setGoalType(goal.goal_type);
    setTargetValue(String(goal.target_value));
    setPeriodType(goal.period_type);
    // An Activities goal saved before "All" existed has no filter and counts gym activities.
    const f = goal.goal_type === 'gym_sessions' ? (goal.activity_filter ?? 'Gym') : goal.activity_filter;
    setActivityFilter(f);
    const known = f == null || f === ALL_ACTIVITIES || GOAL_ACTIVITY_TYPES.some((t) => t.value === f);
    setCustomActivity(known ? '' : f!);
    setMoreOpen(false);
    setCustomEndDate(goal.period_type === 'custom' ? isoToDisplayDate(goal.end_date) : '');
    setShowAdd(true);
  }

  function closeForm() {
    setShowAdd(false);
    setEditingGoal(null);
    setTargetValue('');
    setPeriodType('month');
    setCustomEndDate('');
    setGoalType('distance');
    setActivityFilter(null);
    setCustomActivity('');
    setMoreOpen(false);
  }

  async function saveGoal() {
    if (goalWriting.current) return;
    goalWriting.current = true;
    try { await saveGoalOnce(); } finally { goalWriting.current = false; }
  }
  async function saveGoalOnce() {
    if (!targetValue || parseFloat(targetValue) <= 0) return;
    // The 3-goal cap applies to creating a 4th, not to editing one of the 3.
    if (!editingGoal && goals.length >= 3) return;
    if (periodType === 'custom' && (!customEndDate || !displayToIsoDate(customEndDate))) return;
    // A custom end date has to be today or later, and never before the goal starts.
    if (periodType === 'custom') {
      const endIso = displayToIsoDate(customEndDate)!;
      const startIso = editingGoal ? editingGoal.start_date : dateToLocalStr(new Date());
      if (endIso < dateToLocalStr(new Date()) || endIso < startIso) {
        notify('Choose a later end date', 'The end date has to be today or later.');
        return;
      }
    }

    setSaving(true);

    const fields = {
      goal_type: goalType,
      target_value: fromShownGoal(goalType, parseFloat(targetValue)),
      period_type: periodType,
      activity_filter: activityFilter,
    };

    if (editingGoal) {
      // Only recompute the goal's window if the period itself actually
      // changed. Recomputing unconditionally would silently restart a
      // half-finished custom goal — or shunt a goal set up mid-month back to
      // the 1st — just because someone nudged the target number.
      const periodChanged =
        periodType !== editingGoal.period_type ||
        (periodType === 'custom' && displayToIsoDate(customEndDate) !== editingGoal.end_date);
      const dates = periodChanged
        ? (() => {
            const { start, end } = getDateRange(periodType);
            // Moving to a custom end date keeps the goal's start, so the
            // progress already made still counts.
            const startDate = periodType === 'custom' ? editingGoal.start_date : dateToLocalStr(start);
            return { start_date: startDate, end_date: dateToLocalStr(end) };
          })()
        : { start_date: editingGoal.start_date, end_date: editingGoal.end_date };

      const { error: editErr } = await supabase.from('goals').update({ ...fields, ...dates }).eq('id', editingGoal.id);
      if (editErr) {
        notify("Couldn't save those changes", editErr.message);
        setSaving(false);
        return;
      }
      setSaving(false);
      closeForm();
      load();
      return;
    }

    const { start, end } = getDateRange(periodType);
    const { error: addErr } = await supabase.from('goals').insert({
      user_id: userId,
      ...fields,
      start_date: dateToLocalStr(start),
      end_date: dateToLocalStr(end),
    });
    if (addErr) {
      // Keep the form open with the values still in it rather than closing on
      // a goal that was never created.
      notify("Couldn't create that goal", addErr.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    closeForm();
    load();
  }

  async function deleteGoal(id: string) {
    if (!(await confirmAction({ title: 'Delete this goal?', confirmLabel: 'Delete', destructive: true }))) return;
    const { error } = await supabase.from('goals').delete().eq('id', id);
    if (error) {
      notify("Couldn't delete that goal", error.message);
      return;
    }
    setGoals((prev) => prev.filter((g) => g.id !== id));
    // Only relevant when called from inside the edit modal (its own onPress
    // guards this for the removed card-level ✕, which never had a form open).
    closeForm();
  }

  // The goal Today shows, chosen the same way home.tsx does: the pinned goal,
  // otherwise the active goal nearest its deadline, then the most complete.
  const activeGoals = goals.filter((g) => new Date(g.end_date + 'T23:59:59').getTime() >= Date.now());
  const focusGoal = [...activeGoals].sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
    || a.end_date.localeCompare(b.end_date)
    || (b.progress / (b.target_value || 1)) - (a.progress / (a.target_value || 1)),
  )[0] ?? null;
  const otherGoals = goals.filter((g) => g.id !== focusGoal?.id);

  // "Make focus" pins the goal, which moves it to Main focus here and on Today.
  function makeFocus(goal: Goal) {
    if (!goal.pinned) togglePin(goal);
    else load();
  }

  // Exactly one pinned goal at a time — pinning this one unpins whichever
  // else was pinned, in the same round trip. This is what home.tsx's Today
  // card reads to decide which goal to feature, ahead of the nearest-
  // deadline auto-pick fallback.
  async function togglePin(goal: Goal) {
    const nextPinned = !goal.pinned;
    setGoals((prev) => prev.map((g) => ({ ...g, pinned: g.id === goal.id ? nextPinned : false })));
    if (nextPinned) {
      const { error: unpinError } = await supabase.from('goals').update({ pinned: false }).eq('user_id', userId).neq('id', goal.id);
      if (unpinError) { load(); return; }
    }
    const { error } = await supabase.from('goals').update({ pinned: nextPinned }).eq('id', goal.id);
    if (error) load();
  }

  // Replaces an ended goal with a fresh one for the current week/month —
  // same type/target/filter, reset progress. Replaces rather than stacking
  // a 4th row, since it's the same slot picking back up, not a new goal.
  async function tryAgainGoal(goal: Goal) {
    // One tap, one goal: a second tap while the first is saving is ignored.
    if (goalWriting.current) return;
    goalWriting.current = true;
    try { await tryAgainGoalOnce(goal); } finally { goalWriting.current = false; }
  }
  async function tryAgainGoalOnce(goal: Goal) {
    // A custom goal starts again over the same number of days, from today.
    const { start, end } = goal.period_type === 'custom'
      ? (() => {
          const days = Math.max(1, Math.round((new Date(goal.end_date + 'T12:00:00').getTime() - new Date(goal.start_date + 'T12:00:00').getTime()) / 86400000) + 1);
          const st = new Date(); const en = new Date(st); en.setDate(st.getDate() + days - 1);
          return { start: st, end: en };
        })()
      : getDateRange(goal.period_type as 'week' | 'month' | 'year');
    // Insert the replacement BEFORE removing the old row, and abort if it
    // fails: unchecked, a failed insert followed by a successful delete left
    // the athlete with no goal at all -- silent data loss on a button labelled
    // "try again".
    const { error: insErr } = await supabase.from('goals').insert({
      user_id: userId,
      goal_type: goal.goal_type,
      target_value: (goal as any).storedTarget ?? goal.target_value,
      period_type: goal.period_type,
      start_date: dateToLocalStr(start),
      end_date: dateToLocalStr(end),
      activity_filter: goal.activity_filter,
    });
    if (insErr) {
      notify("Couldn't start that goal again", insErr.message);
      return;
    }
    const { error: delErr } = await supabase.from('goals').delete().eq('id', goal.id);
    if (delErr) {
      // The new goal exists, so nothing is lost; the old one just lingers.
      notify('Started a fresh goal', 'The completed goal could not be removed and may still appear.');
    }
    load();
  }

  const quick = QUICK_FILTERS[goalType];
  // Everything not in the quick row. Distance and Elevation only list activities that record a distance.
  const moreTypes = GOAL_ACTIVITY_TYPES.filter((t) =>
    !quick.includes(t.value) && (goalType === 'gym_sessions' || (t.distance && t.value !== 'Gym')));
  // A pick from "More" (or a custom one) joins the quick row while selected.
  const extraPick = activityFilter != null && activityFilter !== ALL_ACTIVITIES && !quick.includes(activityFilter) ? activityFilter : null;
  const chip = (value: string | null, label: string, onPress?: () => void) => {
    const on = activityFilter === value;
    return (
      <TouchableOpacity
        key={String(value) + label}
        style={[styles.segment, m && ms.chip, on && styles.segmentActive]}
        onPress={onPress ?? (() => setActivityFilter(value))}
      >
        <Text style={[styles.segmentText, on && styles.segmentTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  // The add/edit sheet is shared by both layouts; on mobile it takes the warm
  // palette so it reads as part of the same screen rather than a grey form.
  const m = !wide;
  // The New / Edit goal form, shared by the mobile sheet and the desktop modal.
  const goalForm = (
    <>
          {!m && <Text style={styles.modalTitle}>{editingGoal ? 'Edit Goal' : 'New Goal'}</Text>}

          <View style={m ? ms.sheetCard : null}>
          <Text style={m ? rm.label : styles.modalLabel}>Type</Text>
          {m ? (
            <RivalTiles
              columns={3}
              options={[
                { value: 'distance' as const, label: GOAL_LABELS.distance, icon: 'distance' as const },
                { value: 'elevation' as const, label: GOAL_LABELS.elevation, icon: 'elevation' as const },
                { value: 'gym_sessions' as const, label: GOAL_LABELS.gym_sessions, icon: 'workout' as const },
              ]}
              value={goalType}
              onChange={(t) => { setGoalType(t); setActivityFilter(allValue(t)); setCustomActivity(''); setMoreOpen(false); }}
            />
          ) : (
          <View style={styles.segmentRow}>
            {(['distance', 'elevation', 'gym_sessions'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.segment, goalType === t && styles.segmentActive]}
                onPress={() => { setGoalType(t); setActivityFilter(allValue(t)); setCustomActivity(''); setMoreOpen(false); }}
              >
                <Text style={[styles.segmentText, goalType === t && styles.segmentTextActive]}>
                  {GOAL_LABELS[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          )}
          </View>

          <View style={m ? ms.sheetCard : null}>
          <Text style={m ? rm.label : styles.modalLabel}>Activity</Text>
          <View style={styles.segmentRow}>
            {chip(allValue(goalType), 'All')}
            {quick.map((v) => chip(v, typeLabel(v)))}
            {extraPick && chip(extraPick, typeLabel(extraPick))}
            <TouchableOpacity
              style={[styles.segment, m && ms.chip, ms.moreChip]}
              onPress={() => setMoreOpen((o) => !o)}
            >
              <Text style={styles.segmentText}>{moreOpen ? 'Less' : 'More'}</Text>
              <RivalIcon name="chevronDown" size={14} color={RivalColors.textSecondary} style={moreOpen ? ({ transform: [{ rotate: '180deg' }] } as any) : undefined} />
            </TouchableOpacity>
          </View>
          {moreOpen && (
            <>
              <View style={[styles.segmentRow, { marginTop: 10 }]}>
                {moreTypes.map((t) => chip(t.value, t.label))}
              </View>
              <Text style={[m ? rm.fieldLabel : styles.modalLabel, { marginTop: 14 }]}>Custom activity</Text>
              <TextInput
                style={m ? [rm.field, rm.input] : styles.modalInput}
                placeholder="For example, Padel"
                placeholderTextColor={RivalColors.textSecondary}
                value={customActivity}
                onChangeText={(v) => {
                  setCustomActivity(v);
                  const t = v.trim();
                  setActivityFilter(t ? t : allValue(goalType));
                }}
                maxLength={40}
              />
              <Text style={[rm.hint, { marginTop: 6 }]}>Counts activities of that type, or with that word in their name.</Text>
            </>
          )}
          </View>

          <View style={m ? ms.sheetCard : null}>
          <Text style={m ? rm.label : styles.modalLabel}>Target ({GOAL_UNITS[goalType]})</Text>
          <TextInput
            style={m ? [rm.field, rm.input] : styles.modalInput}
            placeholder={goalType === 'distance' ? '100' : goalType === 'elevation' ? '5000' : '12'}
            placeholderTextColor={RivalColors.textSecondary}
            value={targetValue}
            onChangeText={setTargetValue}
            keyboardType="decimal-pad"
          />

          </View>

          <View style={m ? ms.sheetCard : null}>
          <Text style={m ? rm.label : styles.modalLabel}>Period</Text>
          {m ? (
            <RivalTiles
              options={(['week', 'month', 'year', 'custom'] as const).map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
              value={periodType}
              onChange={setPeriodType}
            />
          ) : (
          <View style={styles.segmentRow}>
            {(['week', 'month', 'year', 'custom'] as const).map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.segment, periodType === p && styles.segmentActive]}
                onPress={() => setPeriodType(p)}
              >
                <Text style={[styles.segmentText, periodType === p && styles.segmentTextActive]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          )}

          {periodType === 'custom' && (
            <>
              <Text style={m ? rm.fieldLabel : styles.modalLabel}>End date</Text>
              <RivalDateField value={customEndDate} onChangeText={setCustomEndDate} placeholder="31/12/2026" inputStyle={m ? [rm.field, rm.input] as any : styles.modalInput} />
            </>
          )}
          {periodType === 'year' && (
            <Text style={[rm.hint, { marginTop: 8 }]}>1 January to 31 December {new Date().getFullYear()}. Activities since 1 January count.</Text>
          )}
          </View>
    </>
  );

  // Phone: the grey pop-up (GreySheet). Closes by tapping outside or
  // dragging down; no Cancel button.
  const typeOptions = [
    { value: 'distance' as const, label: GOAL_LABELS.distance, icon: 'distance' as const },
    { value: 'elevation' as const, label: GOAL_LABELS.elevation, icon: 'elevation' as const },
    { value: 'gym_sessions' as const, label: GOAL_LABELS.gym_sessions, icon: 'workout' as const },
  ];
  const activityOptions: { value: string; label: string }[] = [
    { value: String(allValue(goalType)), label: 'All' },
    ...quick.map((v) => ({ value: String(v), label: typeLabel(v) })),
    ...(extraPick ? [{ value: String(extraPick), label: typeLabel(extraPick) }] : []),
    ...(moreOpen ? moreTypes.map((t) => ({ value: String(t.value), label: t.label })) : []),
    { value: '__more', label: moreOpen ? 'Fewer' : 'More' },
  ];
  const phoneForm = (
    <>
      <GreyLabel>Type</GreyLabel>
      <GreyTiles
        columns={3}
        options={typeOptions}
        value={goalType}
        onChange={(t) => { setGoalType(t); setActivityFilter(allValue(t)); setCustomActivity(''); setMoreOpen(false); }}
      />
      <GreyLabel>Activity</GreyLabel>
      <GreyTiles
        columns={4}
        options={activityOptions}
        value={String(activityFilter)}
        onChange={(v) => {
          if (v === '__more') { setMoreOpen((o) => !o); return; }
          const opt = [allValue(goalType), ...quick, ...(extraPick ? [extraPick] : []), ...moreTypes.map((t) => t.value)].find((x) => String(x) === v);
          setActivityFilter(opt === undefined ? v : opt);
          setCustomActivity('');
        }}
      />
      {moreOpen ? (
        <>
          <GreyLabel>Custom activity</GreyLabel>
          <GreyField
            placeholder="For example, Padel"
            value={customActivity}
            onChangeText={(v) => {
              setCustomActivity(v);
              const t = v.trim();
              setActivityFilter(t ? t : allValue(goalType));
            }}
            maxLength={40}
          />
          <GreyNote>Counts activities of that type, or with that word in their name.</GreyNote>
        </>
      ) : null}
      <GreyLabel>Details</GreyLabel>
      <GreyRows>
        <GreyRow icon="target" label="Target">
          <View style={ms.targetRow}>
            <GreyRowInput
              value={targetValue}
              onChangeText={setTargetValue}
              placeholder={goalType === 'distance' ? '100' : goalType === 'elevation' ? '5000' : '12'}
              keyboardType="decimal-pad"
              style={ms.targetInput}
            />
            <Text style={ms.targetUnit}>{GOAL_UNITS[goalType]}</Text>
          </View>
        </GreyRow>
        {periodType === 'custom' ? (
          <GreyRow
            icon="calendar"
            label="End date"
            value={customEndDate ? friendlyDate(customEndDate) : ''}
            placeholder="Choose"
            onPress={() => setEndCalOpen(true)}
          />
        ) : null}
      </GreyRows>
      <GreyLabel>Period</GreyLabel>
      <GreyTiles
        options={(['week', 'month', 'year', 'custom'] as const).map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
        value={periodType}
        onChange={setPeriodType}
      />
      {periodType === 'year' ? (
        <GreyNote>1 January to 31 December {new Date().getFullYear()}. Activities since 1 January count.</GreyNote>
      ) : null}
    </>
  );

  const sheet = m ? (
    <Modal visible={showAdd} transparent animationType="slide" onRequestClose={closeForm}>
      <View style={ms.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeForm} accessibilityLabel="Close" />
        <GreySheet
          kicker="GOALS"
          title={editingGoal ? 'Edit goal' : 'New goal'}
          onClose={closeForm}
          footer={<>
            <GreyPrimary label={saving ? 'Saving…' : 'Save'} busy={saving} disabled={!targetValue || saving} onPress={saveGoal} />
            {editingGoal && (
              <TouchableOpacity style={ms.deleteLink} onPress={() => deleteGoal(editingGoal.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <RivalIcon name="delete" size={15} color={RivalColors.error} />
                <Text style={ms.deleteLinkText}>Delete goal</Text>
              </TouchableOpacity>
            )}
          </>}
          overlay={endCalOpen ? (
            <GreyCalendar
              value={customEndDate ? displayToIsoDate(customEndDate) : null}
              onChange={(iso) => { setCustomEndDate(isoToDisplayDate(iso)); setEndCalOpen(false); }}
              onClose={() => setEndCalOpen(false)}
            />
          ) : undefined}
        >
          {phoneForm}
        </GreySheet>
      </View>
    </Modal>
  ) : (
    <Modal visible={showAdd} transparent animationType="slide">
      <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalCard}>
            {goalForm}
            <>
              {editingGoal && (
                <TouchableOpacity style={styles.deleteGoalButton} onPress={() => deleteGoal(editingGoal.id)}>
                  <RivalIcon name="delete" size={16} color={RivalColors.error} />
                  <Text style={styles.deleteGoalButtonText}>Delete Goal</Text>
                </TouchableOpacity>
              )}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={closeForm}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveButton, (!targetValue || saving) && styles.saveButtonDisabled]}
                  onPress={saveGoal}
                  disabled={!targetValue || saving}
                >
                  <BusyText busy={!!(saving)} style={styles.saveButtonText}>{saving ? 'Saving…' : editingGoal ? 'Save Changes' : 'Save Goal'}</BusyText>
                </TouchableOpacity>
              </View>
            </>
          </ScrollView>
      </View>
    </Modal>
  );

  if (!wide) {
    const addGoal = () => { setEditingGoal(null); setShowAdd(true); };
    return (
      <SafeAreaView style={rb.page} edges={['top', 'left', 'right']}>
        <RivalTopNav active="today" />
        <ScrollView contentContainerStyle={[rb.content, ms.content]}>
          <GreyPageHead kicker="SHOWN ON TODAY" title="Goals" onBack={() => (router.canGoBack() ? router.back() : goToTab('/home'))} />

          {!loading && goals.length === 0 ? (
            <View style={[rb.card, ms.emptyRow]}>
              <View style={rb.badge}><RivalIcon name="target" size={16} color={RivalColors.accentText} /></View>
              <Text style={ms.emptyText}>Set a distance, elevation or activities goal for a week, a month, a year or your own dates. Up to three at a time.</Text>
            </View>
          ) : null}

          {loading && <Text style={ms.loading}>Loading…</Text>}

          {focusGoal && (() => {
            const goal = focusGoal;
            const unit = GOAL_UNITS[goal.goal_type];
            const done = goal.progress >= goal.target_value;
            const pct = Math.min(1, goal.target_value > 0 ? goal.progress / goal.target_value : 0);
            const left = daysLeft(goal);
            const of = `${goal.progress.toLocaleString()} of ${goal.target_value.toLocaleString()}${goal.goal_type === 'gym_sessions' ? '' : ` ${unit}`}`;
            return (
              <TouchableOpacity activeOpacity={0.85} onPress={() => openEdit(goal)} style={[rb.card, rb.hero]}>
                <Text style={rb.label}>Main focus</Text>
                <View style={ms.focusRow}>
                  <MiniRing pct={pct} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={ms.focusTitle} numberOfLines={2}>{goalTitle(goal)}</Text>
                    <Text style={ms.focusMeta}>{of} · {done ? 'Complete' : left === 1 ? '1 day left' : `${left} days left`}</Text>
                    <Text style={ms.focusKind} numberOfLines={1}>{goalKind(goal)}</Text>
                  </View>
                </View>
                {!done && goal.recent && goal.recent.length > 0 ? (
                  <View style={ms.recentRow}>
                    {goal.recent.map((c) => (
                      <View key={c.startedAt} style={ms.recentChip}>
                        <Text style={ms.recentText}>
                          {shortDay(c.startedAt)} +{goal.goal_type === 'gym_sessions' ? '1' : `${c.amount.toLocaleString()} ${unit}`}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })()}

          {otherGoals.length > 0 && focusGoal ? <Text style={rb.section}>Other goals</Text> : null}

          {otherGoals.map((goal) => {
            const unit = GOAL_UNITS[goal.goal_type];
            const done = goal.progress >= goal.target_value;
            const ended = !done && isGoalEnded(goal);
            const pct = Math.min(1, goal.target_value > 0 ? goal.progress / goal.target_value : 0);
            const left = daysLeft(goal);
            return (
              <TouchableOpacity key={goal.id} activeOpacity={0.85} onPress={() => openEdit(goal)} style={[rb.card, ms.otherCard]}>
                <View style={ms.otherTop}>
                  <Text style={ms.otherTitle} numberOfLines={1}>{goalTitle(goal)}</Text>
                  <Text style={[ms.otherNum, done && { color: RivalColors.accentGold }]}>
                    {goal.progress.toLocaleString()}<Text style={ms.otherOf}> / {goal.target_value.toLocaleString()}{goal.goal_type === 'gym_sessions' ? '' : ` ${unit}`}</Text>
                  </Text>
                </View>
                <View style={rb.bar}><View style={[rb.barFill, { width: `${Math.max(2, pct * 100)}%` as any }]} /></View>
                <View style={ms.footRow}>
                  <Text style={[ms.footText, done && { color: RivalColors.accentGold }]} numberOfLines={2}>
                    {done
                      ? 'Goal complete'
                      : ended
                        ? endedLine(goal)
                        : `${goalKind(goal)} · ${left === 1 ? '1 day' : `${left} days`} left`}
                  </Text>
                  {ended ? (
                    <TouchableOpacity onPress={() => tryAgainGoal(goal)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Text style={ms.footLink}>Start fresh</Text>
                    </TouchableOpacity>
                  ) : !done ? (
                    <TouchableOpacity onPress={() => makeFocus(goal)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Text style={ms.footLink}>Make focus</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}

          {!loading && goals.length < 3 && (
            <TouchableOpacity style={ms.addBtn} onPress={addGoal} activeOpacity={0.85} accessibilityRole="button">
              <Text style={ms.addBtnText}>{goals.length === 0 ? 'Set a goal' : 'Add goal'}</Text>
            </TouchableOpacity>
          )}
          {goals.length >= 3 && (
            <Text style={ms.note}>Up to three goals at a time. Delete one to add another.</Text>
          )}
        </ScrollView>
        {sheet}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : goToTab('/home'))} color={RivalColors.accentFill} />
        </View>

        <RivalPageHeader title="Goals" subtitle="Goals and progress." />

        {loading && <Text style={styles.emptyText}>Loading…</Text>}

        {!loading && goals.length === 0 && (
          <Text style={styles.emptyText}>No goals yet. Set one below.</Text>
        )}

        {goals.map((goal) => {
          const color = GOAL_BAR_COLOR[goal.goal_type];
          const unit = GOAL_UNITS[goal.goal_type];
          const done = goal.progress >= goal.target_value;
          const ended = !done && isGoalEnded(goal);
          const encouragement = getEncouragement(goal.progress, goal.target_value, unit, goal.id);
          return (
            // The whole card opens the editor — the goal IS the thing being
            // edited, so a dedicated pencil was an extra target for something
            // the card already represents. Delete lives inside that editor now
            // too (see the modal's own Delete button) rather than as a second
            // ✕ target sitting right next to the card's own tap zone — the
            // pin / try-again controls that remain still work fine here: RN's
            // responder system gives the press to the innermost touchable and
            // doesn't bubble it up to this card.
            <TouchableOpacity
              key={goal.id}
              activeOpacity={0.85}
              onPress={() => openEdit(goal)}
              style={[
                styles.goalCard,
                done && { borderColor: RivalColors.accentGold, borderWidth: 1.5 },
              ]}
            >
              <View style={styles.goalHeader}>
                <View style={styles.goalTitleRow}>
                  <View style={[styles.typeBadge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
                    <Text style={[styles.typeBadgeText, { color }]}>{GOAL_ABBR[goal.goal_type]}</Text>
                  </View>
                  <View>
                    <Text style={styles.goalTitle}>{goalActivityLabel(goal)}</Text>
                    <Text style={styles.goalPeriod}>
                      {GOAL_LABELS[goal.goal_type]} · {periodLabel(goal)}
                    </Text>
                  </View>
                </View>
                <View style={styles.goalHeaderActions}>
                  <TouchableOpacity onPress={() => togglePin(goal)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <RivalIcon name="pin" size={18} color={goal.pinned ? RivalColors.accentText : RivalColors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>
              {goal.pinned && <Text style={styles.pinnedLabel}>Pinned to Today</Text>}

              {done && (
                <View style={styles.celebrationBanner}>
                  <Text style={styles.celebrationText}>Goal complete</Text>
                  <Text style={styles.celebrationSub}>Set a new goal to keep the momentum going.</Text>
                </View>
              )}

              <View style={styles.goalProgress}>
                <Text style={[styles.progressCurrent, done && { color: RivalColors.accentGold }]}>{goal.progress}</Text>
                <Text style={styles.progressSep}> / </Text>
                <Text style={styles.progressTarget}>{goal.target_value} {unit}</Text>
              </View>

              <ProgressBar
                progress={goal.progress}
                target={goal.target_value}
                color={color}
                unit={unit}
              />

              {!done && !ended && encouragement && (
                <Text style={styles.encouragement}>{encouragement}</Text>
              )}

              {ended && (
                <View style={styles.endedBlock}>
                  <Text style={styles.encouragement}>{endedMessage(goal)}</Text>
                  <TouchableOpacity style={styles.tryAgainBtn} onPress={() => tryAgainGoal(goal)}>
                    <Text style={styles.tryAgainBtnText}>Start fresh</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {goals.length < 3 && (
          <TouchableOpacity style={styles.addButton} onPress={() => { setEditingGoal(null); setShowAdd(true); }}>
            <Text style={styles.addButtonText}>+ Add Goal</Text>
          </TouchableOpacity>
        )}

        {goals.length >= 3 && (
          <Text style={styles.maxText}>Maximum 3 goals. Delete one to add another.</Text>
        )}

      </ScrollView>

      {sheet}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  // The floating bottom nav (RivalTopNav) is portaled outside this layout
  // and overlays whatever's at the bottom of the page, so a plain content
  // paddingBottom leaves it covering the last thing in the scroll rather
  // than clearing it — Add Goal was sitting right under the pill. Matches
  // home.tsx's own mobile clearance (contentMobile: paddingBottom 120) for
  // the same nav.
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 120 },
  header: { marginBottom: 0 },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 28 },
  emptyText: { color: RivalColors.textSecondary, fontSize: 15, textAlign: 'center', paddingVertical: 24 },
  goalCard: {
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  goalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  goalHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pinnedLabel: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText, marginTop: -8, marginBottom: 10 },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  typeBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  goalTitle: { fontSize: 17, fontWeight: '800', color: RivalColors.textPrimary },
  goalPeriod: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  // Lives in the edit modal now, not the card — see deleteGoal's call site.
  deleteGoalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 12,
    borderRadius: RivalRadius.full,
    borderWidth: 1.5,
    borderColor: 'rgba(255,180,171,0.4)',
  },
  deleteGoalButtonText: { color: RivalColors.error, fontSize: 14, fontWeight: '700' },
  celebrationBanner: {
    backgroundColor: 'rgba(245,183,89,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,183,89,0.25)',
    padding: 12,
    marginBottom: 14,
  },
  celebrationText: {
    fontSize: 15,
    fontWeight: '800',
    color: RivalColors.accentGold,
    marginBottom: 2,
  },
  celebrationSub: {
    fontSize: 12,
    color: RivalColors.accentGold,
    opacity: 0.8,
  },
  encouragement: {
    fontSize: 16,
    fontWeight: '700',
    color: RivalColors.textSecondary,
    marginTop: 10,
    fontStyle: 'italic',
  },
  endedBlock: { marginTop: 10, gap: 10 },
  tryAgainBtn: {
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: RivalRadius.full,
    paddingVertical: 10, alignItems: 'center',
  },
  tryAgainBtnText: { fontSize: 14, fontWeight: '700', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  goalProgress: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 20 },
  // Display number — the editorial serif, matching Today's Focus card.
  progressCurrent: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 30, fontWeight: '700', color: RivalColors.textPrimary },
  progressSep: { color: RivalColors.textSecondary, fontSize: 16 },
  progressTarget: { color: RivalColors.textSecondary, fontSize: 15 },
  barContainer: { gap: 0 },
  checkpointLabelRow: {
    position: 'relative',
    height: 16,
    marginBottom: 2,
  },
  checkpointLabel: {
    position: 'absolute',
    transform: [{ translateX: -10 }],
  },
  checkpointLabelText: {
    fontSize: 9,
    color: RivalColors.accentText,
    fontWeight: '700',
  },
  barTrack: {
    height: 10,
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: 5,
    position: 'relative',
    overflow: 'visible',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    minWidth: 0,
  },
  tick: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: '100%',
    marginLeft: -1,
  },
  thumb: {
    position: 'absolute',
    top: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: RivalColors.textPrimary,
    borderWidth: 3,
    marginLeft: -9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  barLabelStart: { fontSize: 11, color: RivalColors.textSecondary },
  barLabelProgress: { fontSize: 11, fontWeight: '700' },
  barLabelEnd: { fontSize: 11, color: RivalColors.textSecondary },
  addButton: {
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  addButtonText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontSize: 18, fontWeight: '700' },
  maxText: { color: RivalColors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalScroll: {
    maxHeight: '85%',
  },
  modalCard: {
    backgroundColor: RivalColors.surfaceContainer,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 28,
    gap: 12,
  },
  modalTitle: { fontSize: 22, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  segmentRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
    backgroundColor: RivalColors.surfaceContainer,
  },
  segmentActive: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: RivalButtonColors.fill },
  segmentText: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: RivalButtonColors.label(RivalColors.textPrimary) },
  modalInput: {
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: 10,
    padding: 14,
    color: RivalColors.textPrimary,
    fontSize: 16,
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
  },
  cancelButtonText: { color: RivalColors.textSecondary, fontSize: 16, fontWeight: '600' },
  saveButton: {
    flex: 2,
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontSize: 16, fontWeight: '700' },
});

// Mobile only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  targetInput: { width: 110, alignSelf: 'auto' } as any,
  targetUnit: { fontSize: 13, fontWeight: '600', color: RivalColors.textSecondary },
  loading: { fontSize: 12.5, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyText: { flex: 1, fontSize: 13, lineHeight: 18, color: RivalColors.textSecondary },
  focusRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ringPct: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: '#fff' },
  focusTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, lineHeight: 23, color: '#fff' },
  focusMeta: { fontSize: 12.5, color: RivalColors.textSecondary },
  focusKind: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  otherCard: { gap: 10 },
  otherTop: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  otherTitle: { flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: '700', color: '#fff' },
  otherNum: { fontSize: 14, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'] },
  otherOf: { fontSize: 12.5, fontWeight: '500', color: RivalColors.textSecondary },
  addBtn: { paddingVertical: 14, borderRadius: 999, alignItems: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, marginTop: 4 },
  addBtnText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  note: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
  // Clears the floating bottom nav, as the desktop content style does.
  content: { paddingBottom: 120 },
  sectionHead: { marginTop: 6, marginBottom: -2, paddingHorizontal: 4, gap: 3 },
  sectionTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 19, fontWeight: '700', color: '#fff' },
  sectionSub: { fontSize: 10.5, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: RivalColors.accentText },
  // Main focus: the same card as Focus on Today (home.tsx mFocusFree/mFocusEdge).
  focusCard: {
    alignItems: 'center', paddingTop: 18, paddingBottom: 20, paddingHorizontal: 16,
    borderRadius: 22, overflow: 'hidden',
    backgroundColor: '#1b1512', borderWidth: 1, borderColor: 'rgba(255,209,190,0.10)',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'radial-gradient(ellipse 70% 55% at 50% 0%, rgba(217,119,87,0.17), rgba(217,119,87,0.035) 60%, rgba(217,119,87,0) 85%)',
      borderWidth: 0,
    } : {}),
  } as any,
  focusEdge: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22, padding: 1,
    backgroundImage: 'linear-gradient(180deg, rgba(255,209,190,0.30), rgba(255,209,190,0.09) 45%, rgba(255,209,190,0.05))',
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
  } as any,
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 26, marginTop: 16 },
  metaCell: { alignItems: 'center', minWidth: 80 },
  metaNumber: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 26, fontWeight: '700', lineHeight: 30, color: '#fff' },
  metaLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: RivalColors.accentText, marginTop: 3 },
  metaDivider: { width: 1, height: 34, backgroundColor: 'rgba(255,181,158,0.25)' },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 16 },
  recentChip: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,181,158,0.18)', backgroundColor: 'rgba(217,119,87,0.10)', paddingHorizontal: 10, paddingVertical: 4 },
  recentText: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText },
  goalCard: { backgroundColor: RivalWarm.card, borderWidth: 1, borderColor: RivalWarm.cardBorder, borderRadius: 18, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 },
  iconSm: { width: 36, height: 36, borderRadius: 18 },
  goalTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 18, fontWeight: '700', color: '#fff' },
  goalNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 24, fontWeight: '700', color: '#fff' },
  goalOf: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontSize: 12, fontWeight: '600', color: RivalWarm.muted },
  slimTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginTop: 12, marginBottom: 10 },
  slimFill: {
    height: '100%', borderRadius: 3, backgroundColor: RivalColors.accentFill,
    ...(Platform.OS === 'web' ? {
      backgroundImage: `linear-gradient(90deg, ${RivalColors.accentFill}, ${RivalColors.accentText})`,
      transitionProperty: 'width', transitionDuration: '1200ms', transitionTimingFunction: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
    } : {}),
  } as any,
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  footText: { flex: 1, fontSize: 12.5, color: RivalWarm.muted, lineHeight: 17 },
  footLink: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  empty: { alignItems: 'center', paddingVertical: 28 },
  cardDone: { borderColor: 'rgba(245,183,89,0.45)' },
  goalTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pinBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  pinBtnOn: { borderColor: 'rgba(255,209,190,0.35)', backgroundColor: 'rgba(255,209,190,0.10)' },
  numbers: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  progressNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 34, fontWeight: '700', lineHeight: 40 },
  progressOf: { fontSize: 14, fontWeight: '600', color: RivalWarm.muted },
  pct: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  message: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 15, lineHeight: 21, color: RivalWarm.soft },
  doneBlock: { gap: 8 },
  pinnedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pinnedText: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText },

  // Size to the form so the sheet sits on the bottom edge, not mid-screen.
  sheetScroll: { flexGrow: 0 },
  // The sheet takes the Goals page's own look: page background, each choice
  // in its own card, a soft sand edge along the top.
  sheet: {
    backgroundColor: RivalWarm.page, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,209,190,0.18)',
    paddingHorizontal: 16, paddingTop: 22, paddingBottom: 36, gap: 10,
  },
  sheetTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 4, paddingHorizontal: 4, textAlign: 'center' },
  sheetCard: { backgroundColor: RivalWarm.card, borderWidth: 1, borderColor: RivalWarm.cardBorder, borderRadius: 18, padding: 14, gap: 10 },
  moreChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chip: { borderRadius: 999, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: RivalWarm.field, paddingHorizontal: 16 },
  sheetActions: { gap: 10, marginTop: 10 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  deleteLinkText: { fontSize: 14, fontWeight: '700', color: RivalColors.error },
});
