// Focused "start a challenge" flow — pick a metric, set a target, pick a
// deadline, confirm. Split out from the old behavior of routing "Start a
// Team Challenge" straight into /league (the unfinished, everything-at-once
// team page) — creating a challenge and viewing one already running are two
// different jobs (see project_rival_team_challenge_concept memory).
//
// Two modes, mutually exclusive per the DB (leagues_goal_or_race_not_both):
// - Team Target: pick a metric + number, deadline via quick presets OR a
//   custom calendar date. Writes goal_metric/goal_target/goal_target_date.
// - Race Goal: the team is training toward an event already on the
//   creator's own /races list (same source create-league.tsx's Journey path
//   uses) — picking one just sets leagues.race_id, no target/metric needed,
//   the race's own date IS the deadline.
// Either way this writes straight onto the existing `leagues` row
// (leagues_team_goal.sql columns) team-hub.tsx already reads, so no new
// schema and team-hub's hero/standings pick it up as-is.
import React, { useEffect, useState } from 'react';
import { ImageBackground, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { RivalIcon, RivalIconName, RivalBackButton, RivalWarm, GreyPageHead, rb } from '../components/rival';
import { sidePageWide } from '../constants/breakpoints';
import { RivalColors, RivalRadius, RivalSerifFamily, RivalSpacing, RivalButtonColors, RivalGhost } from '../constants/rivalTheme';
import { BusyText } from '../components/rival/BusyText';

type GoalMetric = 'xp' | 'distance' | 'elevation' | 'duration' | 'activities';
type Mode = 'target' | 'race';

const METRICS: Array<{ value: GoalMetric; label: string; unit: string; icon: RivalIconName }> = [
  { value: 'distance', label: 'Distance', unit: 'km', icon: 'distance' },
  { value: 'elevation', label: 'Elevation', unit: 'm', icon: 'elevation' },
  { value: 'duration', label: 'Time', unit: 'hrs', icon: 'timerOutline' },
  { value: 'activities', label: 'Activities', unit: 'logged', icon: 'checkCircleOutline' },
  { value: 'xp', label: 'Effort', unit: 'effort', icon: 'bolt' },
];

// Deadlines a team target realistically runs on — a bare date picker asks
// people to do the math themselves; these compute it for them. "Custom"
// drops into the calendar below for anything else.
const DURATIONS: Array<{ label: string; days: number }> = [
  { label: '1 Week', days: 7 },
  { label: '2 Weeks', days: 14 },
  { label: '1 Month', days: 30 },
  { label: '3 Months', days: 90 },
];

type RaceOption = { id: string; name: string; race_date: string; race_type: string | null };

function todayLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function addYears(d: Date, n: number): Date { return new Date(d.getFullYear() + n, d.getMonth(), 1); }
function toIsoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function monthGridCells(viewDate: Date): (number | null)[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function chunkWeeks<T>(cells: T[]): T[][] {
  const weeks: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function MonthCalendarPicker({ value, onChange }: { value: string | null; onChange: (iso: string) => void }) {
  const [viewDate, setViewDate] = useState(() => (value ? new Date(value + 'T00:00:00') : startOfMonth(new Date())));
  const weeks = chunkWeeks(monthGridCells(viewDate));
  const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };

  return (
    <View style={styles.calendarWidget}>
      <View style={styles.calendarHeaderRow}>
        <View style={styles.calendarNavGroup}>
          <TouchableOpacity onPress={() => setViewDate((d) => addYears(d, -1))} hitSlop={hitSlop}>
            <RivalIcon name="yearBack" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewDate((d) => addMonths(d, -1))} hitSlop={hitSlop}>
            <RivalIcon name="monthBack" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
        <Text style={styles.calendarMonthLabel}>{viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <View style={styles.calendarNavGroup}>
          <TouchableOpacity onPress={() => setViewDate((d) => addMonths(d, 1))} hitSlop={hitSlop}>
            <RivalIcon name="monthForward" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewDate((d) => addYears(d, 1))} hitSlop={hitSlop}>
            <RivalIcon name="yearForward" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.calendarDaysRow}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={styles.calendarDayLabel}>{d}</Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.calendarDaysRow}>
          {week.map((day, di) => {
            if (day === null) return <View key={di} style={styles.calendarDayCell} />;
            const cellIso = toIsoDate(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
            const isSelected = value === cellIso;
            return (
              <TouchableOpacity key={di} style={[styles.calendarDayCell, isSelected && styles.calendarDayCellActive]} onPress={() => onChange(cellIso)}>
                <Text style={[styles.calendarDayNum, isSelected && styles.calendarDayNumActive]}>{day}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// Same photo as the Team Challenge hero on Team Hub, so editing the challenge
// feels like the same place you tapped into it from.
const HERO_PHOTO = require('../../assets/images/backgrounds/optimized/coastal-highway-triathlete-dusk-3.jpg');

const WARM_GRADIENT = 'linear-gradient(225deg, #FFB86B 0%, #FF8773 100%)';

// A numbered step in its own panel — the form reads as three decisions in
// order rather than one long stack of labels and chips.
function Step({ n, title, children, mob }: { n: number; title: string; children: React.ReactNode; mob?: boolean }) {
  return (
    <View style={[styles.step, mob && ms.step]}>
      <View style={styles.stepHead}>
        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>{n}</Text></View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

export default function CreateTeamChallenge() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [mode, setMode] = useState<Mode>('target');

  // Team Target state
  const [metric, setMetric] = useState<GoalMetric>('distance');
  const [target, setTarget] = useState('');
  const [duration, setDuration] = useState<number | 'custom'>(30);
  const [customDate, setCustomDate] = useState<string | null>(null);

  // Race Goal state
  const [myRaces, setMyRaces] = useState<RaceOption[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the team already has a challenge. The same page then edits it:
  // Team Hub opens it from the challenge ring, and it arrives filled in with
  // what's running now instead of blank.
  const [editing, setEditing] = useState(false);
  // Phone: the app's own terracotta→salmon gradient and warm cards, and
  // sentence-case labels. Desktop keeps this page's original treatment.
  const { width } = useWindowDimensions();
  const mob = !sidePageWide(width);
  const sc = (t: string) => (mob ? t.charAt(0) + t.slice(1).toLowerCase() : t);

  const selectedMetric = METRICS.find((m) => m.value === metric)!;

  useEffect(() => {
    if (!id) return;
    supabase
      .from('leagues')
      .select('goal_metric, goal_target, goal_target_date, race_id')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        if (data.race_id) {
          setEditing(true);
          setMode('race');
          setSelectedRaceId(data.race_id);
        } else if (data.goal_metric && data.goal_target) {
          setEditing(true);
          setMode('target');
          setMetric(data.goal_metric as GoalMetric);
          setTarget(String(data.goal_target));
          // The existing due date is a specific day, so it's shown as one.
          if (data.goal_target_date) {
            setDuration('custom');
            setCustomDate(data.goal_target_date);
          }
        }
      });
  }, [id]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      const { data } = await supabase
        .from('races')
        .select('id, name, race_date, race_type')
        .eq('user_id', user.id)
        .gte('race_date', todayLocalStr())
        .order('race_date', { ascending: true });
      setMyRaces(data ?? []);
    })();
  }, []);

  async function handleCreate() {
    if (!id) return;
    setError(null);

    if (mode === 'race') {
      if (!selectedRaceId) {
        setError('Choose an event.');
        return;
      }
      setSaving(true);
      const { error: dbErr } = await supabase
        .from('leagues')
        .update({ race_id: selectedRaceId, goal_metric: null, goal_target: null, goal_target_date: null })
        .eq('id', id);
      setSaving(false);
      if (dbErr) { setError(dbErr.message); return; }
      router.replace({ pathname: '/team-hub', params: { id } });
      return;
    }

    const numTarget = parseFloat(target);
    if (!numTarget || numTarget <= 0) {
      setError('Enter a target above 0.');
      return;
    }
    let goalTargetDate: string;
    if (duration === 'custom') {
      if (!customDate) { setError('Choose a date.'); return; }
      goalTargetDate = customDate;
    } else {
      const d = new Date();
      d.setDate(d.getDate() + duration);
      goalTargetDate = toIsoDate(d);
    }

    setSaving(true);
    const { error: dbErr } = await supabase
      .from('leagues')
      .update({ goal_metric: metric, goal_target: numTarget, goal_target_date: goalTargetDate, race_id: null })
      .eq('id', id);

    setSaving(false);
    if (dbErr) { setError(dbErr.message); return; }
    router.replace({ pathname: '/team-hub', params: { id } });
  }

  const targetNum = parseFloat(target);
  const hasTarget = Number.isFinite(targetNum) && targetNum > 0;
  const dueDate = duration === 'custom'
    ? (customDate ? new Date(customDate + 'T00:00:00') : null)
    : new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const selectedRace = myRaces.find((r) => r.id === selectedRaceId);

  return (
    <View style={[styles.screen, mob && ms.screen]}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {/* The page must scroll: the app's frame is fixed to the screen height,
            so without this everything below the fold was cut off. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[{ paddingBottom: 60 }, mob && rb.column]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {mob ? (
            // Phone: the blend header instead of the photo.
            <View style={{ paddingHorizontal: 16 }}>
              <GreyPageHead
                kicker="TEAM CHALLENGE"
                title={editing ? 'Edit team challenge' : 'Start a team challenge'}
                sub="One shared target. All member activity counts toward it."
                onBack={() => router.back()}
              />
            </View>
          ) : (
          <ImageBackground source={HERO_PHOTO} style={styles.hero} resizeMode="cover">
            <View style={styles.heroShade} pointerEvents="none" />
            <View style={styles.topRow}>
              <RivalBackButton onPress={() => router.back()} color="#fff" style={styles.backBtn} />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.kicker}>TEAM CHALLENGE</Text>
              <Text style={styles.heroTitle}>{editing ? sc('Edit Team Challenge') : mob ? 'Start a team challenge' : 'Start a Team Challenge'}</Text>
              <Text style={styles.heroSub}>One shared target. All member activity counts toward it.</Text>
            </View>
          </ImageBackground>
          )}

          <View style={styles.body}>
            {/* Live preview: the challenge as it will read, updating as you
                choose, so the form isn't a blind series of inputs. */}
            <View style={[styles.preview, mob && ms.preview]}>
              <View style={[styles.previewIcon, mob && ms.gradient]}>
                <RivalIcon name={mode === 'target' ? selectedMetric.icon : 'flag'} size={24} color="#1a1411" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                {mode === 'target' ? (
                  <>
                    <Text style={styles.previewKicker}>{selectedMetric.label.toUpperCase()}</Text>
                    {hasTarget ? (
                      <Text style={[styles.previewValue, mob && ms.previewValue]}>
                        {targetNum.toLocaleString()} <Text style={styles.previewUnit}>{selectedMetric.unit}</Text>
                      </Text>
                    ) : (
                      <Text style={styles.previewEmpty}>Set a target</Text>
                    )}
                    <Text style={styles.previewDue}>{dueDate ? `Due ${fmt(dueDate)}` : 'Choose a due date'}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.previewKicker}>EVENT</Text>
                    <Text style={[styles.previewValue, mob && ms.previewValue]} numberOfLines={2}>{selectedRace ? selectedRace.name : 'Choose an event'}</Text>
                    {!!selectedRace && <Text style={styles.previewDue}>{fmt(new Date(selectedRace.race_date + 'T00:00:00'))}</Text>}
                  </>
                )}
              </View>
            </View>

            <View style={[styles.modeRow, mob && ms.modeRow]}>
              <TouchableOpacity style={[styles.modeTab, mode === 'target' && styles.modeTabActive, mob && mode === 'target' && ms.modeOn]} onPress={() => setMode('target')}>
                <Text style={[styles.modeTabText, mode === 'target' && styles.modeTabTextActive, mob && mode === 'target' && ms.modeOnText]}>{sc('Team Target')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modeTab, mode === 'race' && styles.modeTabActive, mob && mode === 'race' && ms.modeOn]} onPress={() => setMode('race')}>
                <Text style={[styles.modeTabText, mode === 'race' && styles.modeTabTextActive, mob && mode === 'race' && ms.modeOnText]}>{sc('Event Goal')}</Text>
              </TouchableOpacity>
            </View>

            {mode === 'target' ? (
              <>
                <Step n={1} title="Goal" mob={mob}>
                  <View style={styles.metricGrid}>
                    {METRICS.map((m) => {
                      const on = metric === m.value;
                      return (
                        <TouchableOpacity key={m.value} style={[styles.metricTile, mob && ms.tile, on && styles.metricTileOn, mob && on && ms.tileOn]} onPress={() => setMetric(m.value)}>
                          <View style={[styles.metricIcon, on && styles.metricIconOn, mob && on && ms.gradient]}>
                            <RivalIcon name={m.icon} size={20} color={on ? (mob ? ms.onGradient.color as string : '#1a1411') : RivalColors.accentText} />
                          </View>
                          <Text style={[styles.metricTileText, on && styles.metricTileTextOn]}>{m.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </Step>

                <Step n={2} title="Target" mob={mob}>
                  <View style={[styles.targetWell, mob && ms.well]}>
                    <TextInput
                      style={[styles.targetInput, mob && ms.targetInput]}
                      placeholder="1000"
                      placeholderTextColor="rgba(255,255,255,0.25)"
                      value={target}
                      onChangeText={(v) => setTarget(v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.targetUnit}>{selectedMetric.unit}</Text>
                  </View>
                </Step>

                <Step n={3} title="Complete by" mob={mob}>
                  <View style={styles.durationRow}>
                    {DURATIONS.map((d) => (
                      <TouchableOpacity
                        key={d.days}
                        style={[styles.durationChip, mob && ms.chip, duration === d.days && styles.durationChipActive, mob && duration === d.days && ms.gradient]}
                        onPress={() => setDuration(d.days)}
                      >
                        <Text style={[styles.durationChipText, duration === d.days && styles.durationChipTextActive, mob && duration === d.days && ms.onGradient]}>{sc(d.label)}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={[styles.durationChip, mob && ms.chip, duration === 'custom' && styles.durationChipActive, mob && duration === 'custom' && ms.gradient]}
                      onPress={() => setDuration('custom')}
                    >
                      <Text style={[styles.durationChipText, duration === 'custom' && styles.durationChipTextActive, mob && duration === 'custom' && ms.onGradient]}>{sc('Custom Date')}</Text>
                    </TouchableOpacity>
                  </View>

                  {duration === 'custom' && (
                    <View style={[styles.dateCard, mob && ms.well]}>
                      <Text style={[styles.selectedDateText, !customDate && styles.selectedDateTextEmpty]}>
                        {customDate ? new Date(customDate + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'No date selected yet'}
                      </Text>
                      <MonthCalendarPicker value={customDate} onChange={setCustomDate} />
                    </View>
                  )}
                </Step>
              </>
            ) : (
              <Step n={1} title="Event" mob={mob}>
                {myRaces.length === 0 ? (
                  <Text style={styles.emptyRaceText}>No upcoming events. Add one from Events first.</Text>
                ) : (
                  <View style={{ gap: 8 }}>
                    {myRaces.map((r) => (
                      <TouchableOpacity
                        key={r.id}
                        style={[styles.raceRow, mob && ms.tile, selectedRaceId === r.id && styles.raceRowActive, mob && selectedRaceId === r.id && ms.gradient]}
                        onPress={() => setSelectedRaceId(r.id)}
                      >
                        <RivalIcon name="flag" size={16} color={selectedRaceId === r.id ? (mob ? ms.onGradient.color as string : '#1a1411') : RivalColors.accentText} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.raceRowName, selectedRaceId === r.id && styles.raceRowTextActive, mob && selectedRaceId === r.id && ms.onGradient]}>{r.name}</Text>
                          <Text style={[styles.raceRowDate, selectedRaceId === r.id && styles.raceRowTextActive, mob && selectedRaceId === r.id && ms.onGradient]}>
                            {new Date(r.race_date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </Step>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity style={[styles.createBtn, mob && ms.gradient, saving && styles.createBtnDisabled]} onPress={handleCreate} disabled={saving}>
              <BusyText busy={!!(saving)} style={[styles.createBtnText, mob && ms.onGradient]}>{saving ? 'Saving…' : editing ? sc('Save Changes') : sc('Start Challenge')}</BusyText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#131313' },

  // overflow hidden is load-bearing: on web the photo isn't clipped to its
  // container by default, and it painted down behind the whole form.
  hero: { minHeight: 250, justifyContent: 'space-between', overflow: 'hidden' },
  heroShade: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'linear-gradient(180deg, rgba(19,19,19,0.15) 0%, rgba(19,19,19,0.55) 55%, #131313 100%)' }
      : { backgroundColor: 'rgba(19,19,19,0.55)' }),
  } as any,
  topRow: { paddingHorizontal: RivalSpacing.gutter, paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  heroText: { paddingHorizontal: RivalSpacing.gutter, paddingBottom: 18, alignItems: 'center' },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 2, color: RivalColors.accentText },
  heroTitle: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 28, color: '#fff', marginTop: 4, textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  heroSub: { fontSize: 13.5, color: 'rgba(255,255,255,0.8)', marginTop: 6, textAlign: 'center' },

  body: { paddingHorizontal: RivalSpacing.gutter, gap: 16, maxWidth: 480, width: '100%', alignSelf: 'center' },

  preview: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22,
    backgroundColor: '#1f1b19', borderWidth: 1, borderColor: `${RivalColors.accentFill}55`,
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 30px rgba(217,119,87,0.14)' } : {}),
  } as any,
  previewIcon: {
    width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: WARM_GRADIENT } : {}),
  } as any,
  previewKicker: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6, color: RivalColors.accentText },
  previewValue: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -0.4, marginTop: 1 },
  previewUnit: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  previewEmpty: { fontSize: 20, fontWeight: '700', color: 'rgba(255,255,255,0.4)', marginTop: 3 },
  previewDue: { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 1 },

  modeRow: {
    flexDirection: 'row', padding: 4, borderRadius: RivalRadius.full,
    backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: RivalColors.surfaceBright,
  },
  modeTab: { flex: 1, minHeight: 42, borderRadius: RivalRadius.full, alignItems: 'center', justifyContent: 'center' },
  modeTabActive: { backgroundColor: RivalColors.surfaceBright },
  modeTabText: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  modeTabTextActive: { color: '#fff' },

  step: {
    padding: 16, borderRadius: 20, gap: 12,
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBadge: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${RivalColors.accentFill}26`, borderWidth: 1, borderColor: `${RivalColors.accentFill}66`,
  },
  stepBadgeText: { fontSize: 12.5, fontWeight: '800', color: RivalColors.accentText },
  stepTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: '#fff' },

  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricTile: {
    flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: 8, paddingVertical: 14, borderRadius: 16,
    backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  metricTileOn: { borderColor: RivalColors.accentText, backgroundColor: `${RivalColors.accentFill}22` },
  metricIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${RivalColors.accentFill}1f`,
  },
  metricIconOn: {
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: WARM_GRADIENT } : {}),
  } as any,
  metricTileText: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  metricTileTextOn: { color: '#fff' },

  targetWell: {
    flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 16,
    backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: RivalColors.surfaceBright,
  },
  targetInput: { flex: 1, minWidth: 0, fontSize: 34, fontWeight: '800', color: '#fff', paddingVertical: 6, letterSpacing: -0.5 },
  targetUnit: { fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },

  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  durationChip: {
    borderRadius: RivalRadius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 15, paddingVertical: 9, backgroundColor: RivalColors.surfaceLowest,
  },
  durationChipActive: { backgroundColor: RivalColors.accentText, borderColor: RivalColors.accentText },
  durationChipText: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  durationChipTextActive: { color: RivalColors.surfaceLowest },

  dateCard: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 14, gap: 8 },
  selectedDateText: { fontSize: 14, fontWeight: '700', color: '#fff', textAlign: 'center' },
  selectedDateTextEmpty: { fontWeight: '400', color: 'rgba(255,255,255,0.4)' },

  calendarWidget: { marginTop: 10, gap: 6, width: '100%' },
  calendarHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarNavGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calendarMonthLabel: { fontSize: 12, fontWeight: '700', color: '#fff' },
  calendarDaysRow: { flexDirection: 'row', gap: 2 },
  calendarDayLabel: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  calendarDayCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RivalRadius.sm, borderWidth: 1, borderColor: 'transparent' },
  calendarDayCellActive: { backgroundColor: 'rgba(217,119,87,0.18)', borderColor: RivalColors.accentFill },
  calendarDayNum: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  calendarDayNumActive: { color: RivalColors.accentText, fontWeight: '700' },

  emptyRaceText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 18 },
  raceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: RivalColors.surfaceLowest, padding: 14,
  },
  raceRowActive: { backgroundColor: RivalColors.accentText, borderColor: RivalColors.accentText },
  raceRowName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  raceRowDate: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  raceRowTextActive: { color: '#1a1411' },

  error: { color: '#ff9b8f', fontSize: 13, textAlign: 'center' },

  createBtn: {
    marginTop: 8, minHeight: 54, borderRadius: RivalRadius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: WARM_GRADIENT, boxShadow: '0 10px 28px rgba(255,135,115,0.3)' } : {}),
  } as any,
  createBtnDisabled: { opacity: 0.6 },
  createBtnText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2, color: '#1a1411' },
});

// Phone only — the Add an activity look (warm grey page, warm outlines; Ricky, 2026-10-03).
const ms = StyleSheet.create({
  screen: { backgroundColor: RivalGhost.ground },
  // The app-wide terracotta→salmon gradient, not this page's own orange.
  gradient: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' },
  onGradient: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  preview: { backgroundColor: RivalGhost.fill, borderColor: 'rgba(255,181,158,0.35)' },
  previewValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700' },
  modeRow: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border },
  step: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border },
  tile: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border },
  tileOn: { backgroundColor: RivalGhost.fillOn, borderColor: RivalGhost.borderOn },
  well: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border },
  targetInput: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700' },
  chip: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border },
  // The chosen half of the Team target / Event goal switch: a warm lift.
  modeOn: { backgroundColor: RivalGhost.fillOn, ...RivalButtonColors.noGradient, borderColor: 'transparent' },
  modeOnText: { color: '#fff' },
});
