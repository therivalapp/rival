import { useSnapState } from '../lib/snapState';
import { distanceUnit, elevationUnit, fromDisplayDistance, fromDisplayElevation, toDisplayDistance, toDisplayElevation } from '../lib/units';
import { useState, useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { fetchAllActivities } from '../lib/fetchAllActivities';
import { supabase, getAuthUser } from '../lib/supabase';
import { displayToIsoDate, isoToDisplayDate } from '../lib/dateFormat';
import { computeGoalProgress } from '../lib/goalProgress';
import { confirmAction, notify } from '../lib/notify';
import { RivalTopNav, RivalIcon, RivalPageHeader, RivalBackButton, RivalDateField, RivalMobileHeader, RivalWarm, rm, activityIconName, type RivalIconName } from '../components/rival';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { RivalColors, RivalRadius, RivalSerifFamily, RivalButtonColors } from '../constants/rivalTheme';

type Goal = {
  id: string;
  goal_type: 'distance' | 'elevation' | 'gym_sessions';
  target_value: number;
  period_type: 'week' | 'month' | 'custom';
  start_date: string;
  end_date: string;
  activity_filter: string | null;
  progress: number;
  pinned: boolean;
};

const GOAL_LABELS: Record<string, string> = {
  distance: 'Distance',
  elevation: 'Elevation',
  gym_sessions: 'Gym activities',
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

// Activity types available as filters, with display names
const DISTANCE_FILTERS = [
  { value: null, label: 'All' },
  { value: 'Run', label: 'Run' },
  { value: 'Ride', label: 'Ride' },
  { value: 'Swim', label: 'Swim' },
  { value: 'Walk', label: 'Walk' },
  { value: 'Hike', label: 'Hike' },
];

const ELEVATION_FILTERS = [
  { value: null, label: 'All' },
  { value: 'Run', label: 'Run' },
  { value: 'Ride', label: 'Ride' },
  { value: 'Hike', label: 'Hike' },
];

function activityLabel(filter: string | null) {
  if (!filter) return 'All activities';
  return filter;
}

function dateToLocalStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
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
  if (goal.period_type === 'custom') return false; // one-off deadline, not a recurring period — no natural "try again"
  const end = new Date(goal.end_date + 'T23:59:59');
  return end.getTime() < Date.now() && goal.progress < goal.target_value;
}

function endedMessage(goal: Goal): string {
  const unit = GOAL_UNITS[goal.goal_type];
  const remaining = Math.round((goal.target_value - goal.progress) * 10) / 10;
  const period = goal.period_type === 'week' ? 'this week' : 'this month';
  return `The previous goal finished ${remaining} ${unit} short. A new goal period starts ${period}.`;
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
  if (remaining <= target * 0.05) return `Almost there, just ${remaining} ${unit} to go!`;
  if (remaining <= target * 0.15) return `So close! Only ${remaining} ${unit} left.`;
  if (pct >= 0.75) return `Nearly there, ${remaining} ${unit} to go. Keep pushing!`;
  if (pct >= 0.5) return `Great work, you're over halfway! ${remaining} ${unit} remaining.`;
  if (pct >= 0.25) return `Good progress! ${remaining} ${unit} to go.`;
  return `Keep it up, ${remaining} ${unit} to go`;
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

export default function GoalsScreen() {
  const [goals, setGoals] = useSnapState<Goal[]>('goals.goals', []);
  const [loading, setLoading] = useSnapState('goals.loading', true);
  const [showAdd, setShowAdd] = useState(false);
  const [userId, setUserId] = useSnapState('goals.userId', '');

  const [goalType, setGoalType] = useState<'distance' | 'elevation' | 'gym_sessions'>('distance');
  const [targetValue, setTargetValue] = useState('');
  const [periodType, setPeriodType] = useState<'week' | 'month' | 'custom'>('month');
  const [customEndDate, setCustomEndDate] = useState('');
  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Non-null while the modal is editing an existing goal rather than creating
  // one. Holds the whole row, not just the id, because saving needs the
  // ORIGINAL period/dates to decide whether the goal's window should be
  // recomputed — see saveGoal.
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;

  useFocusEffect(useCallback(() => { load(); }, []));

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
      fetchAllActivities(user.id, 'activity_type, distance_meters, elevation_meters, started_at'),
    ]);

    if (!goalsData) { setLoading(false); return; }

    // Shown in the units chosen in Profile. Stored targets stay metric;
    // storedTarget keeps the original for anything written back.
    const goalsWithProgress = goalsData.map((goal: any) => {
      const progress = computeGoalProgress(goal, activities || []);
      const conv = (v: number) => Math.round(toShownGoal(goal.goal_type, v) * 10) / 10;
      return { ...goal, storedTarget: goal.target_value, target_value: conv(goal.target_value), progress: conv(progress) };
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
  function getDateRange(period: 'week' | 'month' | 'custom') {
    const now = new Date();
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
    setActivityFilter(goal.activity_filter);
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
  }

  async function saveGoal() {
    if (!targetValue || parseFloat(targetValue) <= 0) return;
    // The 3-goal cap applies to creating a 4th, not to editing one of the 3.
    if (!editingGoal && goals.length >= 3) return;
    if (periodType === 'custom' && (!customEndDate || !displayToIsoDate(customEndDate))) return;

    setSaving(true);

    const fields = {
      goal_type: goalType,
      target_value: fromShownGoal(goalType, parseFloat(targetValue)),
      period_type: periodType,
      activity_filter: goalType === 'gym_sessions' ? null : activityFilter,
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
        ? (() => { const { start, end } = getDateRange(periodType); return { start_date: dateToLocalStr(start), end_date: dateToLocalStr(end) }; })()
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
    const { start, end } = getDateRange(goal.period_type as 'week' | 'month');
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

  function periodLabel(goal: Goal) {
    if (goal.period_type === 'week') return 'This week';
    if (goal.period_type === 'month') return 'This month';
    return `${formatDate(goal.start_date)} – ${formatDate(goal.end_date)}`;
  }

  const filterOptions = goalType === 'elevation' ? ELEVATION_FILTERS : DISTANCE_FILTERS;

  // The add/edit sheet is shared by both layouts; on mobile it takes the warm
  // palette so it reads as part of the same screen rather than a grey form.
  const m = !wide;
  const sheet = (
    <Modal visible={showAdd} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <ScrollView style={[styles.modalScroll, m && ms.sheetScroll]} contentContainerStyle={[styles.modalCard, m && ms.sheet]}>
          <Text style={m ? rm.serifTitleSm : styles.modalTitle}>{editingGoal ? (m ? 'Edit goal' : 'Edit Goal') : (m ? 'New goal' : 'New Goal')}</Text>

          <Text style={m ? rm.label : styles.modalLabel}>Type</Text>
          <View style={styles.segmentRow}>
            {(['distance', 'elevation', 'gym_sessions'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.segment, m && ms.chip, goalType === t && styles.segmentActive]}
                onPress={() => { setGoalType(t); setActivityFilter(null); }}
              >
                <Text style={[styles.segmentText, goalType === t && styles.segmentTextActive]}>
                  {GOAL_LABELS[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {goalType !== 'gym_sessions' && (
            <>
              <Text style={m ? rm.label : styles.modalLabel}>Activity</Text>
              <View style={styles.segmentRow}>
                {filterOptions.map((opt) => (
                  <TouchableOpacity
                    key={String(opt.value)}
                    style={[styles.segment, m && ms.chip, activityFilter === opt.value && styles.segmentActive]}
                    onPress={() => setActivityFilter(opt.value)}
                  >
                    <Text style={[styles.segmentText, activityFilter === opt.value && styles.segmentTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={m ? rm.label : styles.modalLabel}>Target ({GOAL_UNITS[goalType]})</Text>
          <TextInput
            style={m ? [rm.field, rm.input] : styles.modalInput}
            placeholder={goalType === 'distance' ? '100' : goalType === 'elevation' ? '5000' : '12'}
            placeholderTextColor={RivalColors.textSecondary}
            value={targetValue}
            onChangeText={setTargetValue}
            keyboardType="decimal-pad"
          />

          <Text style={m ? rm.label : styles.modalLabel}>Period</Text>
          <View style={styles.segmentRow}>
            {(['week', 'month', 'custom'] as const).map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.segment, m && ms.chip, periodType === p && styles.segmentActive]}
                onPress={() => setPeriodType(p)}
              >
                <Text style={[styles.segmentText, periodType === p && styles.segmentTextActive]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {periodType === 'custom' && (
            <>
              <Text style={m ? rm.label : styles.modalLabel}>End date</Text>
              <RivalDateField value={customEndDate} onChangeText={setCustomEndDate} placeholder="2026-12-31" inputStyle={m ? [rm.field, rm.input] as any : styles.modalInput} />
            </>
          )}

          {m ? (
            <View style={ms.sheetActions}>
              <TouchableOpacity
                style={[rm.primary, (!targetValue || saving) && rm.disabled]}
                onPress={saveGoal}
                disabled={!targetValue || saving}
                activeOpacity={0.85}
              >
                <Text style={rm.primaryText}>{saving ? 'Saving…' : editingGoal ? 'Save changes' : 'Save goal'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={rm.ghost} onPress={closeForm} activeOpacity={0.85}>
                <Text style={rm.ghostText}>Cancel</Text>
              </TouchableOpacity>
              {editingGoal && (
                <TouchableOpacity style={ms.deleteLink} onPress={() => deleteGoal(editingGoal.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <RivalIcon name="delete" size={15} color={RivalColors.error} />
                  <Text style={ms.deleteLinkText}>Delete goal</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
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
                  <Text style={styles.saveButtonText}>{saving ? 'Saving…' : editingGoal ? 'Save Changes' : 'Save Goal'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );

  if (!wide) {
    return (
      <SafeAreaView style={rm.page} edges={['top', 'left', 'right']}>
        <RivalTopNav active="today" />
        <ScrollView contentContainerStyle={[rm.content, ms.content]}>
          <RivalMobileHeader title="Goals" onBack={() => (router.canGoBack() ? router.back() : router.replace('/home'))} />

          {!loading && goals.length === 0 ? (
            <View style={[rm.hero, ms.empty]}>
              <View style={rm.iconCircle}>
                <RivalIcon name="target" size={20} color={RivalColors.accentText} />
              </View>
              <Text style={rm.serifTitleSm}>No goals yet</Text>
              <Text style={[rm.hint, { textAlign: 'center' }]}>
                Set a distance, elevation or gym goal for a week, a month or a custom date. Up to three at a time.
              </Text>
            </View>
          ) : (
            <Text style={rm.hint}>Up to three goals. The pinned goal appears on Home.</Text>
          )}

          {loading && <Text style={[rm.hint, { textAlign: 'center', paddingVertical: 24 }]}>Loading…</Text>}

          {goals.map((goal) => {
            const unit = GOAL_UNITS[goal.goal_type];
            const done = goal.progress >= goal.target_value;
            const ended = !done && isGoalEnded(goal);
            const encouragement = getEncouragement(goal.progress, goal.target_value, unit, goal.id);
            const pct = Math.min(100, Math.round((goal.progress / goal.target_value) * 100));
            const accent = done ? RivalColors.accentGold : RivalColors.accentText;
            const icon = goal.activity_filter ? activityIconName(goal.activity_filter) : GOAL_ICON[goal.goal_type];
            return (
              // Whole card opens the editor; the pin is its own target inside.
              <TouchableOpacity
                key={goal.id}
                activeOpacity={0.85}
                onPress={() => openEdit(goal)}
                style={[goal.pinned ? rm.hero : rm.card, done && ms.cardDone]}
              >
                <View style={ms.goalTop}>
                  <View style={rm.iconCircle}>
                    <RivalIcon name={icon} size={20} color={accent} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {/* A gym goal has no activity filter, so its type is the title. */}
                    <Text style={rm.label}>{goal.goal_type === 'gym_sessions' ? periodLabel(goal) : `${GOAL_LABELS[goal.goal_type]} · ${periodLabel(goal)}`}</Text>
                    <Text style={rm.serifTitleSm} numberOfLines={1}>{goal.goal_type === 'gym_sessions' ? 'Gym activities' : activityLabel(goal.activity_filter)}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => togglePin(goal)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={[ms.pinBtn, goal.pinned && ms.pinBtnOn]}
                    accessibilityLabel={goal.pinned ? 'Unpin from Home' : 'Pin to Home'}
                  >
                    <RivalIcon name="pin" size={16} color={goal.pinned ? RivalColors.accentText : RivalWarm.muted} />
                  </TouchableOpacity>
                </View>

                <View style={ms.numbers}>
                  <Text style={[ms.progressNum, { color: done ? RivalColors.accentGold : '#fff' }]}>{goal.progress}</Text>
                  <Text style={ms.progressOf}> / {goal.target_value} {unit}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={[ms.pct, { color: accent }]}>{pct}%</Text>
                </View>

                <ProgressBar
                  progress={goal.progress}
                  target={goal.target_value}
                  color={done ? RivalColors.accentGold : RivalColors.accentText}
                  unit={unit}
                  trackColor="rgba(255,255,255,0.08)"
                  hidePct
                />

                {done ? (
                  <View style={ms.doneBlock}>
                    <Text style={[rm.label, { color: RivalColors.accentGold }]}>Goal complete</Text>
                    <Text style={ms.message}>You crushed it! Set new goal to keep the momentum going.</Text>
                  </View>
                ) : ended ? (
                  <View style={ms.doneBlock}>
                    <Text style={ms.message}>{endedMessage(goal)}</Text>
                    <TouchableOpacity style={rm.ghost} onPress={() => tryAgainGoal(goal)} activeOpacity={0.85}>
                      <RivalIcon name="refresh" size={16} color={RivalColors.accentText} />
                      <Text style={rm.ghostText}>Try again {goal.period_type === 'week' ? 'this week' : 'this month'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : encouragement ? (
                  <Text style={ms.message}>{encouragement}</Text>
                ) : null}

                {goal.pinned ? (
                  <View style={ms.pinnedRow}>
                    <RivalIcon name="pin" size={12} color={RivalColors.accentText} />
                    <Text style={ms.pinnedText}>Pinned to Home</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}

          {!loading && goals.length < 3 && (
            <TouchableOpacity style={rm.primary} onPress={() => { setEditingGoal(null); setShowAdd(true); }} activeOpacity={0.85}>
              <RivalIcon name="add" size={18} color={rm.primaryText.color as string} />
              <Text style={rm.primaryText}>Add goal</Text>
            </TouchableOpacity>
          )}

          {goals.length >= 3 && (
            <Text style={[rm.hint, { textAlign: 'center' }]}>Maximum 3 goals. Delete one to add another.</Text>
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
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} color={RivalColors.accentFill} />
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
                    <Text style={styles.goalTitle}>{activityLabel(goal.activity_filter)}</Text>
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
                  <Text style={styles.celebrationSub}>You crushed it! Set new goal to keep the momentum going.</Text>
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
                    <Text style={styles.tryAgainBtnText}>Try again {goal.period_type === 'week' ? 'this week' : 'this month'}</Text>
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
  // Clears the floating bottom nav, as the desktop content style does.
  content: { paddingBottom: 120 },
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
  sheet: { backgroundColor: RivalWarm.card, borderTopWidth: 1, borderColor: RivalWarm.cardBorder, padding: 22, paddingBottom: 36, gap: 12 },
  chip: { borderRadius: 999, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: RivalWarm.field, paddingHorizontal: 16 },
  sheetActions: { gap: 10, marginTop: 10 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  deleteLinkText: { fontSize: 14, fontWeight: '700', color: RivalColors.error },
});
