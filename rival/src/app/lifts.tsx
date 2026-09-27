import { useSnapState } from '../lib/snapState';
import { LB_PER_KG, toDisplayWeight, weightUnit } from '../lib/units';
import { useState, useEffect, useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput, Modal, ImageBackground, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { notify } from '../lib/notify';
import { CANONICAL_LIFTS, matchCanonicalLift } from '../lib/lifts';
import { RivalIcon, RivalTopNav, RivalFixedBackground, RivalBackButton, RivalWarm, rm } from '../components/rival';
import { RivalColors, RivalRadius, RivalType, RivalSerifFamily, RivalButtonColors } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';

type Entry = { id: string; exercise_name: string; weight_kg: number; reps: number | null; performed_at: string };
// kg as stored → the chosen units, to one decimal; and back for saving.
const shownWeight = (kg: number) => Math.round(toDisplayWeight(kg) * 10) / 10;
const storedWeight = (shown: number) => (weightUnit() === 'lb' ? shown / LB_PER_KG : shown);

type LiftCard = { name: string; pb: number; goal: number | null; goalStart: number | null; history: Entry[] };

export default function LiftsScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;

  const [cards, setCards] = useSnapState<LiftCard[]>('lifts.cards', []);
  const [loading, setLoading] = useSnapState('lifts.loading', true);
  const [focused, setFocused] = useState<string | null>(null);

  const [logModalFor, setLogModalFor] = useState<string | null>(null);
  const [logWeight, setLogWeight] = useState('');
  const [logReps, setLogReps] = useState('');
  const [customName, setCustomName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);

  const [goalModalFor, setGoalModalFor] = useState<string | null>(null);
  const [goalWeight, setGoalWeight] = useState('');
  const [goalModalIsNew, setGoalModalIsNew] = useState(true);
  const [goalModalCurrentPb, setGoalModalCurrentPb] = useState(0);

  useFocusEffect(useCallback(() => { load(); }, []));

  // Keep a valid focused lift: prefer whatever the user was viewing, else the
  // top card (sorted history-first, then highest PB).
  useEffect(() => {
    if (cards.length === 0) return;
    if (!focused || !cards.find(c => c.name === focused)) setFocused(cards[0].name);
  }, [cards]);

  async function load() {
    const { data: { user } } = await getAuthUser();
    if (!user) { setLoading(false); return; }

    const [entriesRes, goalsRes] = await Promise.all([
      supabase.from('exercise_entries').select('id, exercise_name, weight_kg, reps, performed_at')
        .eq('user_id', user.id).order('performed_at', { ascending: false }),
      supabase.from('exercise_goals').select('exercise_name, target_weight_kg, starting_weight_kg').eq('user_id', user.id),
    ]);

    // Everything on this screen is in the units chosen in Profile. Weights
    // are converted once here (kg are stored) and back again when saved, so
    // the PB, goal, checkpoints and history all agree with each other.
    const goalMap = new Map<string, { target: number; start: number | null }>();
    (goalsRes.data || []).forEach((g: any) => goalMap.set(g.exercise_name, {
      target: shownWeight(g.target_weight_kg),
      start: g.starting_weight_kg == null ? null : shownWeight(g.starting_weight_kg),
    }));

    const byName = new Map<string, Entry[]>();
    (entriesRes.data || []).forEach((e: any) => {
      if (!byName.has(e.exercise_name)) byName.set(e.exercise_name, []);
      byName.get(e.exercise_name)!.push({ ...e, weight_kg: shownWeight(e.weight_kg) });
    });

    const names = new Set<string>([...CANONICAL_LIFTS, ...byName.keys()]);
    const built: LiftCard[] = Array.from(names).map(name => {
      const history = byName.get(name) || [];
      const pb = history.reduce((max, e) => Math.max(max, e.weight_kg), 0);
      const g = goalMap.get(name);
      return { name, pb, goal: g?.target ?? null, goalStart: g?.start ?? null, history };
    }).sort((a, b) => {
      const aHas = a.history.length > 0, bHas = b.history.length > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return b.pb - a.pb;
    });

    setCards(built);
    setLoading(false);
  }

  function openLogModal(name: string) {
    setLogModalFor(name);
    setLogWeight('');
    setLogReps('');
    setCustomName('');
  }

  async function saveLog() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    const rawName = logModalFor === 'Other' ? customName.trim() : logModalFor;
    const exerciseName = (rawName && matchCanonicalLift(rawName)) || rawName;
    const weight = parseFloat(logWeight);
    if (!exerciseName || !weight || weight <= 0) return;

    setSaving(true);
    const { error } = await supabase.from('exercise_entries').insert({
      user_id: user.id,
      exercise_name: exerciseName,
      weight_kg: storedWeight(weight),
      reps: logReps ? parseInt(logReps, 10) : null,
      performed_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      notify("Couldn't log that lift", error.message);
      return;
    }
    if (exerciseName) setFocused(exerciseName);
    setLogModalFor(null);
    load();
  }

  function openGoalModal(name: string, current: number | null, currentPb: number) {
    setGoalModalFor(name);
    setGoalWeight(current ? String(current) : '');
    setGoalModalIsNew(current === null);
    setGoalModalCurrentPb(currentPb);
  }

  async function saveGoal() {
    const { data: { user } } = await getAuthUser();
    if (!user || !goalModalFor) return;
    const target = parseFloat(goalWeight);
    if (!target || target <= 0) return;

    const payload: Record<string, unknown> = { user_id: user.id, exercise_name: goalModalFor, target_weight_kg: storedWeight(target) };
    if (goalModalIsNew) payload.starting_weight_kg = storedWeight(goalModalCurrentPb);

    setSavingGoal(true);
    const { error } = await supabase.from('exercise_goals')
      .upsert(payload, { onConflict: 'user_id,exercise_name' });
    setSavingGoal(false);
    if (error) {
      notify("Couldn't save that goal", error.message);
      return;
    }
    setGoalModalFor(null);
    load();
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  function getMilestones(start: number, goal: number): number[] {
    const range = goal - start;
    if (range <= 0) return [];
    const step = range <= 10 ? 0.5 : range <= 50 ? 2.5 : 5;
    const raw = [start + range * 0.25, start + range * 0.5, start + range * 0.75];
    const rounded = raw.map(v => Math.round(v / step) * step);
    return Array.from(new Set(rounded)).filter(v => v > start && v < goal).sort((a, b) => a - b);
  }

  function prDate(history: Entry[], pb: number): string | null {
    const matches = history.filter(e => e.weight_kg === pb);
    if (matches.length === 0) return null;
    const earliest = matches.reduce((min, e) => new Date(e.performed_at) < new Date(min.performed_at) ? e : min, matches[0]);
    return formatDate(earliest.performed_at);
  }

  function fmtVolume(v: number): string {
    return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
  }

  const active = cards.find(c => c.name === focused) || cards[0] || null;
  const hasEntries = !!active && active.history.length > 0;

  // Derived hero stats for the focused lift.
  const goalStart = active?.goalStart ?? 0;
  const range = active?.goal ? active.goal - goalStart : 0;
  const progress = active?.goal && range > 0 ? Math.min(1, Math.max(0, (active.pb - goalStart) / range)) : null;
  const milestones = active?.goal ? getMilestones(goalStart, active.goal) : [];
  const pctOf = (ms: number): number => active?.goal ? ((ms - goalStart) / (active.goal - goalStart)) * 100 : 0;
  const lastEntry = active?.history[0];
  const prevEntry = active?.history[1];
  const trendPct = lastEntry && prevEntry && prevEntry.weight_kg > 0
    ? ((lastEntry.weight_kg - prevEntry.weight_kg) / prevEntry.weight_kg) * 100 : null;
  const totalVolume = active ? active.history.reduce((s, e) => s + e.weight_kg * (e.reps || 1), 0) : 0;
  // Chips: every lift you've logged, plus the major lifts even with no entries
  // yet (an invitation to log them, like the mockup) — not all 50 canonicals.
  const MAJOR_LIFTS = ['Squat', 'Bench Press', 'Deadlift', 'Overhead Press', 'Clean and Jerk', 'Snatch', 'Front Squat', 'Overhead Squat'];
  const chips = [
    ...cards.filter(c => c.history.length > 0),
    ...cards.filter(c => c.history.length === 0 && MAJOR_LIFTS.includes(c.name)),
  ];

  return (
    <View style={styles.container}>
      {/* Full-bleed background layer — decoupled from content so it always
          reaches the bottom of the screen. Focal point biased right to keep the
          lifter centred in the frame. */}
      <RivalFixedBackground
        source={require('../../assets/images/backgrounds/optimized/deadlift-rival-plates-box.jpg')}
        focalPoint="55% 45%"
      />
      <View style={styles.scrim} />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <RivalTopNav active="activity" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headerRow}>
            <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : goToTab('/my-activities'))} color={RivalColors.accentFill} />
            <Text style={styles.headerTitle}>{wide ? 'Personal Bests' : 'Personal bests'}</Text>
            <View style={{ width: 48 }} />
          </View>

          <View style={styles.heroWrap}>
          {loading && <Text style={styles.emptyText}>Loading…</Text>}

          {!loading && !active && (
            <Text style={styles.emptyText}>No lifts logged.</Text>
          )}

          {!loading && active && (
            <View style={[styles.hero, wide && styles.heroWide]}>
              <Text style={styles.activeFocus}>ACTIVE FOCUS: {active.name.toUpperCase()}</Text>

              {hasEntries ? (
                <>
                  <View style={styles.pbRow}>
                    <Text style={[styles.pbValue, !wide && ms.pbValue]}>{active.pb}</Text>
                    <Text style={styles.pbUnit}>{weightUnit().toUpperCase()}</Text>
                  </View>

                  {progress !== null && active.goal !== null ? (
                    <View style={styles.progressBlock}>
                      <View style={styles.progressHeader}>
                        <Text style={styles.progressPct}>{Math.round(progress * 100)}% COMPLETE</Text>
                        {prDate(active.history, active.pb) && (
                          <Text style={styles.pbDate}>PB set on {prDate(active.history, active.pb)}</Text>
                        )}
                      </View>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                        {milestones.map((ms) => (
                          <View key={ms} style={[styles.tick, { left: `${pctOf(ms)}%` }]} />
                        ))}
                      </View>
                      <View style={styles.capsRow}>
                        <View style={styles.capLeft}>
                          <Text style={styles.progressCapLabel}>START</Text>
                          <Text style={styles.progressCapValue}>{goalStart}</Text>
                        </View>
                        {milestones.map((ms) => (
                          <View key={ms} style={[styles.checkpointAbs, { left: `${pctOf(ms)}%` }]}>
                            <RivalIcon name="checkCircle" size={13} color={active.pb >= ms ? RivalColors.accentText : RivalColors.textSecondary} />
                            <Text style={[styles.checkpointText, active.pb >= ms && { color: RivalColors.accentText }]}>{ms}</Text>
                          </View>
                        ))}
                        <View style={styles.capRight}>
                          <Text style={styles.progressCapLabel}>TARGET</Text>
                          <Text style={styles.progressCapValue}>{active.goal}</Text>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.noGoalHint}>Set a goal to track progress toward a new PB.</Text>
                  )}
                </>
              ) : (
                <View style={styles.pbRow}>
                  <Text style={[styles.pbValue, { color: RivalColors.textSecondary }]}>—</Text>
                  <Text style={styles.noGoalHint}>No PB logged yet. Log your first {active.name.toLowerCase()}.</Text>
                </View>
              )}

              <View style={styles.heroActions}>
                {wide ? (
                  <>
                    <TouchableOpacity style={[styles.heroBtn, styles.heroBtnPrimary]} onPress={() => openLogModal(active.name)}>
                      <RivalIcon name="add" size={18} color={RivalColors.onAccentFill} />
                      <Text style={styles.heroBtnPrimaryText}>LOG LIFT</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.heroBtn, styles.heroBtnSecondary]} onPress={() => openGoalModal(active.name, active.goal, active.pb)}>
                      <RivalIcon name="target" size={18} color={RivalColors.textPrimary} />
                      <Text style={styles.heroBtnSecondaryText}>{active.goal ? 'EDIT GOAL' : 'SET GOAL'}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={[rm.primary, { flex: 1 }]} onPress={() => openLogModal(active.name)} activeOpacity={0.85}>
                      <RivalIcon name="add" size={18} color={rm.primaryText.color as string} />
                      <Text style={rm.primaryText}>Log lift</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[rm.ghost, ms.ghostOnPhoto, { flex: 1 }]} onPress={() => openGoalModal(active.name, active.goal, active.pb)} activeOpacity={0.85}>
                      <RivalIcon name="target" size={17} color={RivalColors.accentText} />
                      <Text style={rm.ghostText}>{active.goal ? 'Edit goal' : 'Set goal'}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>

              {hasEntries && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.statsRow}>
                    <View style={styles.stat}>
                      <Text style={styles.statLabel}>LAST ACTIVITY</Text>
                      <Text style={styles.statValue}>{lastEntry!.weight_kg} {weightUnit()}</Text>
                      {trendPct !== null && (
                        <View style={styles.trendRow}>
                          <RivalIcon name={trendPct >= 0 ? 'trendUp' : 'trendDown'} size={13} color={trendPct >= 0 ? RivalColors.success : RivalColors.textSecondary} />
                          <Text style={[styles.trendText, { color: trendPct >= 0 ? RivalColors.success : RivalColors.textSecondary }]}>
                            {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statLabel}>ACTIVITIES</Text>
                      <Text style={styles.statValue}>{active.history.length}</Text>
                      <Text style={styles.statSub}>logged</Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statLabel}>TOTAL VOLUME</Text>
                      <Text style={styles.statValue}>{fmtVolume(totalVolume)}</Text>
                      <Text style={styles.statSub}>{weightUnit()} lifted</Text>
                    </View>
                  </View>
                </>
              )}
            </View>
          )}
          </View>

          {/* Lift switcher — sits at the bottom; the centred hero above fills the space */}
          {!loading && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
              <TouchableOpacity style={styles.logDifferentChip} onPress={() => openLogModal('Other')}>
                <RivalIcon name="add" size={18} color={RivalColors.accentText} />
                <Text style={styles.logDifferentText}>Log another lift</Text>
              </TouchableOpacity>
              {chips.map((c) => {
                const isActive = c.name === focused;
                const hasPb = c.history.length > 0;
                return (
                  <TouchableOpacity
                    key={c.name}
                    style={[styles.chip, isActive && styles.chipActive, !wide && isActive && ms.chipActive, !hasPb && styles.chipEmpty]}
                    onPress={() => setFocused(c.name)}
                  >
                    <Text style={[styles.chipName, isActive && { color: wide ? RivalColors.onAccentFill : ms.onGradient.color }]}>{c.name.toUpperCase()}</Text>
                    {hasPb ? (
                      <Text style={[styles.chipValue, !wide && ms.chipValue, isActive && { color: wide ? RivalColors.onAccentFill : ms.onGradient.color }]}>{c.pb} <Text style={styles.chipUnit}>{weightUnit().toUpperCase()}</Text></Text>
                    ) : (
                      <Text style={styles.chipNoEntry}>NO ENTRIES</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Log modal */}
      <Modal visible={!!logModalFor} transparent animationType="fade" onRequestClose={() => setLogModalFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, !wide && ms.modalBox]}>
            <Text style={[styles.modalTitle, !wide && ms.modalTitle]}>Log {logModalFor === 'Other' ? 'a lift' : logModalFor}</Text>
            {logModalFor === 'Other' && (
              <TextInput
                style={wide ? styles.modalInput : [rm.field, rm.input, ms.modalInput]}
                placeholder="Exercise name"
                placeholderTextColor={RivalColors.textSecondary}
                value={customName}
                onChangeText={setCustomName}
              />
            )}
            <TextInput
              style={wide ? styles.modalInput : [rm.field, rm.input, ms.modalInput]}
              placeholder={`Weight (${weightUnit()})`}
              placeholderTextColor={RivalColors.textSecondary}
              keyboardType="decimal-pad"
              value={logWeight}
              onChangeText={setLogWeight}
            />
            <TextInput
              style={wide ? styles.modalInput : [rm.field, rm.input, ms.modalInput]}
              placeholder="Reps (optional)"
              placeholderTextColor={RivalColors.textSecondary}
              keyboardType="number-pad"
              value={logReps}
              onChangeText={setLogReps}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={wide ? styles.modalCancelBtn : [rm.ghost, { flex: 1 }]} onPress={() => setLogModalFor(null)}>
                <Text style={wide ? styles.modalCancelText : rm.ghostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={wide ? styles.modalSaveBtn : [rm.primary, { flex: 1 }]} onPress={saveLog} disabled={saving}>
                <BusyText busy={!!(saving)} style={wide ? styles.modalSaveText : rm.primaryText}>{saving ? 'Saving…' : 'Save'}</BusyText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Goal modal */}
      <Modal visible={!!goalModalFor} transparent animationType="fade" onRequestClose={() => setGoalModalFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, !wide && ms.modalBox]}>
            <Text style={[styles.modalTitle, !wide && ms.modalTitle]}>Goal for {goalModalFor}</Text>
            <TextInput
              style={wide ? styles.modalInput : [rm.field, rm.input, ms.modalInput]}
              placeholder={`Target weight (${weightUnit()})`}
              placeholderTextColor={RivalColors.textSecondary}
              keyboardType="decimal-pad"
              value={goalWeight}
              onChangeText={setGoalWeight}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={wide ? styles.modalCancelBtn : [rm.ghost, { flex: 1 }]} onPress={() => setGoalModalFor(null)}>
                <Text style={wide ? styles.modalCancelText : rm.ghostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={wide ? styles.modalSaveBtn : [rm.primary, { flex: 1 }, savingGoal && rm.disabled]} onPress={saveGoal} disabled={savingGoal}>
                <BusyText busy={!!(savingGoal)} style={wide ? styles.modalSaveText : rm.primaryText}>{savingGoal ? 'Saving…' : 'Save'}</BusyText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  safe: { flex: 1 },
  // Bias the crop toward the lifter (right of frame) so she stays centred at
  // any width — objectPosition is resolution-independent, so this holds on a
  // half-width window too.
  scrim: { position: 'fixed' as any, top: 0, left: 0, right: 0, height: '100vh' as any, backgroundColor: 'rgba(14,14,14,0.5)' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, maxWidth: 1100, width: '100%', alignSelf: 'center' },
  heroWrap: { flex: 1, justifyContent: 'center', width: '100%' },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 28 },
  back: { color: RivalColors.accentText, fontSize: 16, width: 48 },
  headerTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 26, lineHeight: 32, letterSpacing: 0.5, fontWeight: '700', color: RivalColors.accentText, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 12 },
  emptyText: { color: RivalColors.textSecondary, textAlign: 'center', marginTop: 40 },

  // Hero glass card
  hero: {
    backgroundColor: 'rgba(20,20,20,0.62)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: RivalRadius.xl, paddingVertical: 48, paddingHorizontal: 28,
    alignItems: 'center', gap: 4,
    width: '100%', maxWidth: 480, alignSelf: 'center',
  },
  heroWide: { paddingVertical: 64, paddingHorizontal: 36 },
  activeFocus: { ...RivalType.labelCaps, color: RivalColors.accentText, letterSpacing: 2, marginBottom: 8 },
  pbRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  pbValue: { fontSize: 104, fontWeight: '800', fontStyle: 'italic', color: RivalColors.textPrimary, lineHeight: 108, letterSpacing: -3 },
  pbUnit: { fontSize: 44, fontWeight: '700', color: RivalColors.accentText, marginBottom: 16 },

  progressBlock: { width: '100%', marginTop: 16, gap: 10 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  progressPct: { fontSize: 18, fontWeight: '800', color: RivalColors.accentText },
  pbDate: { fontSize: 13, color: RivalColors.textSecondary },
  progressTrack: { height: 8, backgroundColor: RivalColors.surfaceContainerHigh, borderRadius: 4, overflow: 'hidden', position: 'relative' },
  progressFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: RivalColors.accentText, borderRadius: 4 },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: 'rgba(0,0,0,0.5)' },
  capsRow: { position: 'relative', height: 40, marginTop: 2 },
  capLeft: { position: 'absolute', left: 0, top: 0 },
  capRight: { position: 'absolute', right: 0, top: 0, alignItems: 'flex-end' },
  checkpointAbs: { position: 'absolute', top: 2, flexDirection: 'row', alignItems: 'center', gap: 3, transform: [{ translateX: -18 }] },
  progressCapLabel: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary },
  progressCapValue: { fontSize: 16, fontWeight: '800', color: RivalColors.textPrimary },
  checkpointText: { fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary },
  noGoalHint: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 8, maxWidth: 320 },

  heroActions: { flexDirection: 'row', gap: 12, marginTop: 22, width: '100%' },
  heroBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: RivalRadius.DEFAULT },
  heroBtnPrimary: { backgroundColor: RivalColors.accentText },
  heroBtnPrimaryText: { color: RivalColors.onAccentFill, fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  heroBtnSecondary: { backgroundColor: RivalColors.surfaceContainerHigh, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  heroBtnSecondaryText: { color: RivalColors.textPrimary, fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },

  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', width: '100%', marginTop: 26, marginBottom: 18 },
  statsRow: { flexDirection: 'row', width: '100%' },
  stat: { flex: 1, alignItems: 'center', gap: 3 },
  statLabel: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary },
  statValue: { fontSize: 24, fontWeight: '800', color: RivalColors.textPrimary },
  statSub: { fontSize: 11, color: RivalColors.textSecondary },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  trendText: { fontSize: 12, fontWeight: '700' },

  // Chip switcher — the flex:1 heroWrap above pushes this to the bottom.
  chipScroll: { flexGrow: 0, marginTop: 12 },
  chipRow: { gap: 10, paddingVertical: 4, paddingRight: 20 },
  logDifferentChip: {
    minWidth: 120, alignItems: 'center', justifyContent: 'center', gap: 4,
    borderRadius: RivalRadius.md, borderWidth: 1, borderColor: RivalColors.outlineVariant,
    borderStyle: 'dashed', paddingVertical: 16, paddingHorizontal: 16,
  },
  logDifferentText: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.accentText },
  chip: {
    minWidth: 128, borderRadius: RivalRadius.md, backgroundColor: 'rgba(20,20,20,0.62)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', gap: 4,
  },
  chipActive: { backgroundColor: RivalColors.accentText, borderColor: RivalColors.accentText },
  chipEmpty: { opacity: 0.6 },
  chipName: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary },
  chipValue: { fontSize: 20, fontWeight: '800', color: RivalColors.textPrimary },
  chipUnit: { fontSize: 11, fontWeight: '700', color: RivalColors.textSecondary },
  chipNoEntry: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { backgroundColor: RivalColors.surfaceHigh, borderRadius: RivalRadius.lg, padding: 20, width: '85%', maxWidth: 420, borderWidth: 1, borderColor: RivalColors.outlineVariant },
  modalTitle: { fontSize: 16, fontWeight: '800', color: RivalColors.textPrimary, marginBottom: 14 },
  modalInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 12, paddingVertical: 10, color: RivalColors.textPrimary, borderWidth: 1, borderColor: RivalColors.outlineVariant, marginBottom: 10 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  modalCancelBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: RivalColors.outlineVariant },
  modalCancelText: { color: RivalColors.textSecondary, fontWeight: '700' },
  modalSaveBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: RivalRadius.DEFAULT, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  modalSaveText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontWeight: '700' },
});

// Phone only — the RIVAL look (see RivalMobile.tsx) on this page's own design.
const ms = StyleSheet.create({
  pbValue: { fontFamily: RivalSerifFamily, letterSpacing: -1 },
  ghostOnPhoto: { backgroundColor: 'rgba(17,14,12,0.55)' },
  chipActive: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' },
  onGradient: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  chipValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700' },
  modalBox: { backgroundColor: RivalWarm.card, borderColor: RivalWarm.cardBorder, borderRadius: 20, padding: 22, gap: 10 },
  modalTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  modalInput: { marginBottom: 0 },
});
