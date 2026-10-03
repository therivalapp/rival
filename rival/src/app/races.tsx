import { getMyTeamIds } from '../lib/myTeams';
import { useState, useCallback } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput, Modal, Linking, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { confirmAction, notify } from '../lib/notify';
import { formatDisplayName, formatRaceName } from '../lib/identity';
import { isoToDisplayDate, displayToIsoDate, friendlyDate } from '../lib/dateFormat';
import { formatGoalTimeMask } from '../lib/format';
import { RivalTopNav, RivalPageHeader, RivalIcon, RivalBackButton, RivalDateField, RivalMobileHeader, RivalWarm, rm, rb, GreyPageHead, GreySegment, RivalSheet, RivalSheetCard, RivalTiles, RivalMoreRow, GreySheet, GreyLabel, GreyRows, GreyRow, GreyRowInput, GreyField, GreyTiles, GreyNote, GreyPrimary, GreyCalendar } from '../components/rival';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import type { RivalIconName } from '../components/rival';
import { RivalColors, RivalSerifFamily, RivalButtonColors } from '../constants/rivalTheme';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';

const RACE_TYPES = ['Run', 'Ride', 'Swim', 'Triathlon', 'HYROX', 'CrossFit', 'Custom', 'Other'];
const EVENT_TYPE_ICONS: Record<string, RivalIconName> = {
  Run: 'run', Ride: 'ride', Swim: 'swim', Triathlon: 'eventTriathlon',
  HYROX: 'eventHyrox', CrossFit: 'crossfit', Other: 'moreHoriz', Custom: 'eventCustom',
};

type RaceDirectory = { name: string; description: string; url: string; types: string[] };

const RACE_DIRECTORIES: RaceDirectory[] = [
  // Running
  { name: 'Squamish 50', description: 'Iconic trail ultra in the Sea to Sky corridor', url: 'https://www.squamish50.com', types: ['Run'] },
  { name: 'BC Athletics', description: 'Official road & trail races across British Columbia', url: 'https://www.bcathletics.org/events', types: ['Run'] },
  { name: 'parkrun Canada', description: 'Free weekly 5km events — Whistler & nearby', url: 'https://www.parkrun.ca', types: ['Run'] },
  { name: 'UltraSignUp', description: 'Trail & ultra running events in BC and beyond', url: 'https://ultrasignup.com/results_region.aspx?region=British+Columbia', types: ['Run'] },
  { name: 'iRunFar', description: 'Trail & ultra race calendar — Sea to Sky region', url: 'https://www.irunfar.com/races', types: ['Run'] },
  { name: 'Sportstats', description: 'Canadian race calendar & results platform', url: 'https://www.sportstats.ca', types: ['Run', 'Triathlon', 'Ride'] },
  // Triathlon
  { name: 'Triathlon BC', description: 'Official BC triathlon events including Ironman 70.3 Whistler', url: 'https://www.triathlonbc.ca/events', types: ['Triathlon', 'Swim'] },
  { name: 'IRONMAN', description: 'Full & 70.3 events — Whistler hosts an annual 70.3', url: 'https://www.ironman.com/races', types: ['Triathlon'] },
  // Cycling
  { name: 'Gran Fondo Whistler', description: 'Epic gran fondo through the Sea to Sky corridor', url: 'https://www.granfondowhistler.com', types: ['Ride'] },
  { name: 'Cycling BC', description: 'Road, mountain & gravel events across BC', url: 'https://www.cyclingbc.net/events', types: ['Ride'] },
  { name: 'Pemberton Gran Fondo', description: 'Road ride from Whistler to Pemberton', url: 'https://www.pembertongrfondo.com', types: ['Ride'] },
  // HYROX
  { name: 'HYROX', description: 'Official HYROX race finder — Vancouver events nearby', url: 'https://hyrox.com/races', types: ['HYROX'] },
  // CrossFit
  { name: 'CrossFit Games', description: 'CrossFit Open & sanctional events', url: 'https://games.crossfit.com', types: ['CrossFit'] },
  // Obstacles & Other
  { name: 'Spartan Race Canada', description: 'Obstacle course races across BC', url: 'https://www.spartan.com/en/race/find-race/detail.html?countryCode=CA', types: ['Other'] },
  { name: 'Tough Mudder Canada', description: 'Team obstacle events in BC', url: 'https://toughmudder.com/events', types: ['Other'] },
  { name: 'RaceRoster', description: 'Largest Canadian race registration platform', url: 'https://raceroster.com/events?province=BC', types: ['Run', 'Triathlon', 'Ride', 'Swim', 'Other'] },
];

// Real icons, not emoji — emoji render differently on every platform and sit
// outside the design system's colour and weight rules.
const RACE_TYPE_ICONS: Record<string, RivalIconName> = {
  Run: 'run', Ride: 'ride', Swim: 'swim', Triathlon: 'medal',
  HYROX: 'bolt', CrossFit: 'crossfit', Other: 'flag', Custom: 'flag',
};

const HYROX_STATIONS: { name: string; distance_km: number }[] = [
  { name: '8 × 1km Run', distance_km: 8 },
  { name: 'SkiErg', distance_km: 1 },
  { name: 'Sled Push', distance_km: 0.05 },
  { name: 'Sled Pull', distance_km: 0.05 },
  { name: 'Burpee Broad Jump', distance_km: 0.08 },
  { name: 'Row', distance_km: 1 },
  { name: 'Farmers Carry', distance_km: 0.2 },
  { name: 'Sandbag Lunges', distance_km: 0.1 },
  { name: 'Wall Balls', distance_km: 0 },
];

// Official HYROX format × division structure: Singles/Doubles/Relay, each with an
// Open and Pro division; Doubles and Relay also have Mixed alongside Men/Women.
const HYROX_CATEGORIES = [
  'Men', 'Women', 'Men Pro', 'Women Pro',
  'Doubles Men', 'Doubles Women', 'Doubles Mixed', 'Doubles Pro Men', 'Doubles Pro Women',
  'Relay Men', 'Relay Women', 'Relay Mixed',
];
const CROSSFIT_FORMATS = ['Open', 'Local Comp', 'Sanctional', 'Games'];

type Discipline = { name: string; distance_km: number };

type Race = {
  id: string;
  user_id: string;
  name: string;
  race_type: string;
  distance_km: number;
  race_date: string;
  location: string | null;
  registration_url: string | null;
  is_public: boolean;
  disciplines: Discipline[] | null;
  goal_finish_time: string | null;
  actual_finish_time: string | null;
  users: { display_name: string | null; email: string };
  interest_count: number;
  i_am_interested: boolean;
  avg_weekly_km: number;
};

function parseTimeToSeconds(t: string): number {
  const parts = t.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function getFinishMessage(actualTime: string, goalTime: string | null): string {
  const actual = parseTimeToSeconds(actualTime);
  if (!goalTime || parseTimeToSeconds(goalTime) === 0) {
    const msgs = [
      "You finished. That's everything.",
      "Crossing that line took everything, and you did it.",
      "Every step was earned. Go celebrate.",
      "That finish line was yours. Own it.",
      "Doesn't matter what the clock says, you showed up and you finished.",
    ];
    return msgs[actual % msgs.length];
  }
  const goal = parseTimeToSeconds(goalTime);
  const diff = goal - actual;
  if (diff >= 600) return "You absolutely smashed your goal. That's what all those early mornings were for.";
  if (diff >= 60) return "Goal crushed. Every second of training showed up today.";
  if (diff >= -60) return "Right on target — that's not luck, that's discipline.";
  if (diff >= -300) return "Just shy of the goal, but you crossed that line. That takes everything.";
  if (diff >= -900) return "The time doesn't define the effort. You were out there when it counted.";
  return "Some events are harder than others. The fact you showed up, toed the line, and finished — that's the real achievement.";
}

function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayLocalStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysUntil(dateStr: string): number {
  const race = parseDateLocal(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((race.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatRaceDate(dateStr: string): string {
  return parseDateLocal(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function TrainingBar({ avgWeeklyKm, distanceKm }: { avgWeeklyKm: number; distanceKm: number }) {
  if (distanceKm <= 0) return null;
  const pct = Math.min(avgWeeklyKm / distanceKm, 1);
  const displayPct = Math.round(pct * 100);
  const done = pct >= 1;
  return (
    <View style={styles.trainingSection}>
      <View style={styles.trainingLabelRow}>
        <Text style={styles.trainingLabel}>Weekly avg vs event distance</Text>
        <Text style={[styles.trainingPct, done && { color: RivalColors.accentGold }]}>{displayPct}%</Text>
      </View>
      <View style={styles.trainingTrack}>
        <View style={[styles.trainingFill, { width: `${displayPct}%`, backgroundColor: done ? RivalColors.accentFill : RivalColors.accentFill }]} />
      </View>
      <Text style={styles.trainingMeta}>
        {avgWeeklyKm.toFixed(1)} km/week avg · {distanceKm} km race
      </Text>
    </View>
  );
}

// On mobile, a group of fields sits in its own card inside the sheet; on
// desktop the fields run on as before.
function SheetGroup({ m, children }: { m: boolean; children: React.ReactNode }) {
  return m ? <RivalSheetCard>{children}</RivalSheetCard> : <>{children}</>;
}

export default function RacesScreen() {
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [races, setRaces] = useState<Race[]>([]);
  const [completedRaces, setCompletedRaces] = useState<Race[]>([]);
  const [leagueMateIds, setLeagueMateIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [showAdd, setShowAdd] = useState(add === 'true');
  // The optional fields (link, goal time) wait behind "Add details" on mobile.
  const [showDetails, setShowDetails] = useState(false);
  const [eventCalOpen, setEventCalOpen] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [findFilter, setFindFilter] = useState<string | null>(null);
  const [editingRace, setEditingRace] = useState<Race | null>(null);
  const [activeTab, setActiveTab] = useState<'friends' | 'mine' | 'completed'>('mine');

  const [raceName, setRaceName] = useState('');
  const [raceType, setRaceType] = useState('Run');
  const [distanceKm, setDistanceKm] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [location, setLocation] = useState('');
  const [regUrl, setRegUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [triSwim, setTriSwim] = useState('');
  const [triBike, setTriBike] = useState('');
  const [triRun, setTriRun] = useState('');
  const [hyroxCategory, setHyroxCategory] = useState('Women');
  const [crossfitFormat, setCrossfitFormat] = useState('Open');
  const [goalFinishTime, setGoalFinishTime] = useState('');
  const [finishModalRace, setFinishModalRace] = useState<Race | null>(null);
  const [actualFinishInput, setActualFinishInput] = useState('');
  const [savingFinish, setSavingFinish] = useState(false);
  const [customDisciplines, setCustomDisciplines] = useState<{ name: string; distance: string }[]>([{ name: '', distance: '' }]);

  function computedDistance(): number {
    if (raceType === 'Triathlon') return (parseFloat(triSwim) || 0) + (parseFloat(triBike) || 0) + (parseFloat(triRun) || 0);
    if (raceType === 'HYROX') return 8;
    if (raceType === 'CrossFit') return 0;
    if (raceType === 'Custom') return customDisciplines.reduce((s, d) => s + (parseFloat(d.distance) || 0), 0);
    return parseFloat(distanceKm) || 0;
  }

  function buildDisciplines(): Discipline[] | null {
    if (raceType === 'Triathlon') return [
      { name: 'Swim', distance_km: parseFloat(triSwim) || 0 },
      { name: 'Bike', distance_km: parseFloat(triBike) || 0 },
      { name: 'Run', distance_km: parseFloat(triRun) || 0 },
    ];
    if (raceType === 'HYROX') return [{ name: hyroxCategory, distance_km: 0 }, ...HYROX_STATIONS];
    if (raceType === 'CrossFit') return [{ name: crossfitFormat, distance_km: 0 }];
    if (raceType === 'Custom') return customDisciplines.filter((d) => d.name.trim()).map((d) => ({ name: d.name.trim(), distance_km: parseFloat(d.distance) || 0 }));
    return null;
  }

  function addCustomDiscipline() { setCustomDisciplines((prev) => [...prev, { name: '', distance: '' }]); }
  function updateCustomDiscipline(index: number, field: 'name' | 'distance', value: string) {
    setCustomDisciplines((prev) => prev.map((d, i) => i === index ? { ...d, [field]: value } : d));
  }
  function removeCustomDiscipline(index: number) { setCustomDisciplines((prev) => prev.filter((_, i) => i !== index)); }

  function isFormValid(): boolean {
    if (!raceName || !raceDate || !displayToIsoDate(raceDate)) return false;
    if (raceType === 'Triathlon') return !!(triSwim || triBike || triRun);
    if (raceType === 'HYROX' || raceType === 'CrossFit') return true;
    if (raceType === 'Custom') return customDisciplines.some((d) => d.name.trim());
    return !!distanceKm;
  }

  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;
  const m = !wide;

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    setUserId(user.id);

    const today = todayLocalStr();

    // Get league mates
    const leagueIds = await getMyTeamIds(user.id).catch(() => [] as string[]);

    // "friendIds" is historical naming — this has always been TEAMMATES,
    // read straight off league_members. Only the tab label said "Friends".
    let friendIds: string[] = [];
    if (leagueIds.length > 0) {
      const { data: leagueMembersData } = await supabase
        .from('league_members').select('user_id').in('league_id', leagueIds).neq('user_id', user.id).eq('status', 'active');
      friendIds = [...new Set((leagueMembersData || []).map((m: any) => m.user_id))];
    }
    const friendSet = new Set(friendIds);
    setLeagueMateIds(friendSet);

    const [racesRes, pastRes, interestsRes, activitiesRes] = await Promise.all([
      supabase.from('races').select('*, users(display_name)')
        .or(`is_public.eq.true,user_id.eq.${user.id}`)
        .gte('race_date', today).order('race_date', { ascending: true }),
      supabase.from('races').select('*, users(display_name)')
        .eq('user_id', user.id).lt('race_date', today).order('race_date', { ascending: false }),
      supabase.from('race_interests').select('race_id, user_id'),
      supabase.from('activities').select('distance_meters, started_at')
        .eq('user_id', user.id)
        .gte('started_at', new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    const totalKm = (activitiesRes.data || []).reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000;
    const avgWeeklyKm = totalKm / 8;

    const withMeta = (racesRes.data || []).map((r: any) => {
      const raceInterests = (interestsRes.data || []).filter((i: any) => i.race_id === r.id);
      return { ...r, interest_count: raceInterests.length, i_am_interested: raceInterests.some((i: any) => i.user_id === user.id), avg_weekly_km: avgWeeklyKm };
    });

    setRaces(withMeta);
    setCompletedRaces((pastRes.data || []).map((r: any) => ({ ...r, interest_count: 0, i_am_interested: false, avg_weekly_km: avgWeeklyKm })));
    setLoading(false);
  }

  async function toggleInterest(race: Race) {
    if (race.user_id === userId) return;
    if (race.i_am_interested) {
      const { error } = await supabase.from('race_interests').delete().eq('race_id', race.id).eq('user_id', userId);
      if (error) notify("Couldn't update interest", error.message);
    } else {
      const { error } = await supabase.from('race_interests').insert({ race_id: race.id, user_id: userId });
      if (error) notify("Couldn't update interest", error.message);
    }
    load();
  }

  async function saveRace() {
    if (!isFormValid()) return;
    const isoDate = displayToIsoDate(raceDate);
    if (!isoDate) return;
    setSaving(true);
    const payload = {
      name: raceName.trim(), race_type: raceType, distance_km: computedDistance(),
      race_date: isoDate, location: location.trim() || null,
      registration_url: regUrl.trim() || null, disciplines: buildDisciplines(),
      goal_finish_time: goalFinishTime.trim() || null,
    };
    if (editingRace) {
      const { error: updErr } = await supabase.from('races').update(payload).eq('id', editingRace.id);
      if (updErr) {
        // Clear the spinner and leave the modal open with their input intact,
        // rather than returning past setSaving(false) below.
        setSaving(false);
        notify("Couldn't save that event", updErr.message);
        return;
      }
    } else {
      const { data: newRace, error: newErr } = await supabase
        .from('races')
        .insert({ ...payload, user_id: userId, is_public: true })
        .select('id')
        .single();
      if (newErr) {
        setSaving(false);
        notify("Couldn't add that event", newErr.message);
        return;
      }
      if (newRace) notifyLeagueMatesOfNewRace(newRace.id);
    }
    setSaving(false);
    closeModal();
    load();
  }

  async function notifyLeagueMatesOfNewRace(raceId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/race-added-notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ raceId }),
      });
    } catch {
      // best-effort — don't block the race save on notification failures
    }
  }

  function openEdit(race: Race) {
    setEditingRace(race);
    setRaceName(race.name); setRaceType(race.race_type); setRaceDate(isoToDisplayDate(race.race_date));
    setLocation(race.location || ''); setRegUrl(race.registration_url || '');
    setGoalFinishTime(race.goal_finish_time || '');
    setShowDetails(!!(race.registration_url || race.goal_finish_time));
    if (race.race_type === 'Triathlon' && race.disciplines) {
      setTriSwim(String(race.disciplines.find((d) => d.name === 'Swim')?.distance_km ?? ''));
      setTriBike(String(race.disciplines.find((d) => d.name === 'Bike')?.distance_km ?? ''));
      setTriRun(String(race.disciplines.find((d) => d.name === 'Run')?.distance_km ?? ''));
    } else if (race.race_type === 'CrossFit' && race.disciplines?.[0]) {
      setCrossfitFormat(race.disciplines[0].name);
    } else if (race.race_type === 'HYROX' && race.disciplines?.[0]) {
      setHyroxCategory(race.disciplines[0].name);
    } else if (race.race_type === 'Custom' && race.disciplines) {
      setCustomDisciplines(race.disciplines.map((d) => ({ name: d.name, distance: String(d.distance_km) })));
    } else {
      setDistanceKm(String(race.distance_km));
    }
    setShowAdd(true);
  }

  function closeModal() {
    setShowAdd(false); setEditingRace(null);
    setRaceName(''); setDistanceKm(''); setRaceDate('');
    setLocation(''); setRegUrl(''); setRaceType('Run');
    setTriSwim(''); setTriBike(''); setTriRun('');
    setHyroxCategory('Women'); setCrossfitFormat('Open');
    setGoalFinishTime(''); setShowDetails(false);
    setCustomDisciplines([{ name: '', distance: '' }]);
  }

  async function deleteRace(id: string) {
    if (!(await confirmAction({ title: 'Delete this event?', confirmLabel: 'Delete', destructive: true }))) return;
    const { error } = await supabase.from('races').delete().eq('id', id);
    if (error) {
      notify("Couldn't delete that event", error.message);
      return;
    }
    setRaces((prev) => prev.filter((r) => r.id !== id));
  }

  async function saveActualFinishTime() {
    if (!finishModalRace || !actualFinishInput.trim()) return;
    setSavingFinish(true);
    const { error } = await supabase.from('races').update({ actual_finish_time: actualFinishInput.trim() }).eq('id', finishModalRace.id);
    if (error) {
      setSavingFinish(false);
      notify("Couldn't save finish time", error.message);
      return;
    }
    setSavingFinish(false);
    setFinishModalRace(null);
    setActualFinishInput('');
    load();
  }

  const myRaces = races.filter((r) => r.user_id === userId);
  const friendRaces = races.filter((r) => leagueMateIds.has(r.user_id));
  const displayed = activeTab === 'mine' ? myRaces : activeTab === 'completed' ? completedRaces : friendRaces;

  // Shared by both layouts; on mobile the sheets take the warm palette.
  const inp = m ? [rm.field, rm.input] : styles.modalInput;
  // The Add / Edit event form, shared by the mobile sheet and the desktop modal.
  const addEventForm = (
    <>
      {!m && <Text style={styles.modalTitle}>{editingRace ? 'Edit Event' : 'Add an Event'}</Text>}

              <SheetGroup m={m}>
              {m && <Text style={rm.label}>The event</Text>}
              <Text style={m ? rm.fieldLabel : styles.modalLabel}>{m ? 'Name' : 'Event name'}</Text>
              <TextInput style={inp} placeholder="Auckland Half Marathon" placeholderTextColor={RivalColors.textSecondary} value={raceName} onChangeText={setRaceName} />

              <Text style={m ? rm.fieldLabel : styles.modalLabel}>Type</Text>
              {m ? (
                // Eight equal tiles, four across, each with an icon: tidier
                // than a wrapping row of pills of different widths.
                <RivalTiles
                  options={RACE_TYPES.map((t) => ({ value: t, label: t, icon: EVENT_TYPE_ICONS[t] ?? 'moreHoriz' }))}
                  value={raceType}
                  onChange={setRaceType}
                />
              ) : (
              <View style={styles.segmentRow}>
                {RACE_TYPES.map((t) => (
                  <TouchableOpacity key={t} style={[styles.segment, raceType === t && styles.segmentActive]} onPress={() => setRaceType(t)}>
                    <Text style={[styles.segmentText, raceType === t && styles.segmentTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              )}

              {raceType !== 'Triathlon' && raceType !== 'HYROX' && raceType !== 'CrossFit' && raceType !== 'Custom' && (
                <>
                  <Text style={m ? rm.fieldLabel : styles.modalLabel}>Distance (km)</Text>
                  <TextInput style={inp} placeholder="21.1" placeholderTextColor={RivalColors.textSecondary} value={distanceKm} onChangeText={setDistanceKm} keyboardType="decimal-pad" />
                </>
              )}

              {raceType === 'Triathlon' && (
                <>
                  <Text style={m ? rm.fieldLabel : styles.modalLabel}>Disciplines</Text>
                  {[['Swim (km)', triSwim, setTriSwim, '1.9'], ['Bike (km)', triBike, setTriBike, '90'], ['Run (km)', triRun, setTriRun, '21.1']].map(([label, val, setter, ph]: any) => (
                    <View key={label} style={styles.disciplineInputRow}>
                      <Text style={styles.disciplineInputLabel}>{label}</Text>
                      <TextInput style={[inp, styles.disciplineInput]} placeholder={ph} placeholderTextColor={RivalColors.textSecondary} value={val} onChangeText={setter} keyboardType="decimal-pad" />
                    </View>
                  ))}
                  {computedDistance() > 0 && <Text style={styles.distanceSummary}>Total: {computedDistance().toFixed(1)} km</Text>}
                </>
              )}

              {raceType === 'Custom' && (
                <>
                  <Text style={m ? rm.fieldLabel : styles.modalLabel}>Disciplines</Text>
                  {customDisciplines.map((d, i) => (
                    <View key={i} style={styles.customDisciplineRow}>
                      <TextInput style={[inp, { flex: 1 }]} placeholder="Kayak" placeholderTextColor={RivalColors.textSecondary} value={d.name} onChangeText={(v) => updateCustomDiscipline(i, 'name', v)} />
                      <TextInput style={[inp, styles.disciplineInput]} placeholder="km" placeholderTextColor={RivalColors.textSecondary} value={d.distance} onChangeText={(v) => updateCustomDiscipline(i, 'distance', v)} keyboardType="decimal-pad" />
                      {customDisciplines.length > 1 && (
                        <TouchableOpacity onPress={() => removeCustomDiscipline(i)}><Text style={styles.removeDisc}>✕</Text></TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity style={styles.addDisciplineBtn} onPress={addCustomDiscipline}>
                    <Text style={styles.addDisciplineBtnText}>+ Add discipline</Text>
                  </TouchableOpacity>
                  {computedDistance() > 0 && <Text style={styles.distanceSummary}>Total: {computedDistance().toFixed(1)} km</Text>}
                </>
              )}

              {raceType === 'HYROX' && (
                <>
                  <Text style={m ? rm.fieldLabel : styles.modalLabel}>Category</Text>
                  {m ? (
                    <RivalTiles options={HYROX_CATEGORIES.map((c) => ({ value: c, label: c }))} value={hyroxCategory} onChange={setHyroxCategory} columns={2} />
                  ) : (
                  <View style={styles.segmentRow}>
                    {HYROX_CATEGORIES.map((c) => (
                      <TouchableOpacity key={c} style={[styles.segment, hyroxCategory === c && styles.segmentActive]} onPress={() => setHyroxCategory(c)}>
                        <Text style={[styles.segmentText, hyroxCategory === c && styles.segmentTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  )}
                  <View style={styles.infoBox}>
                    <Text style={styles.infoBoxTitle}>{m ? 'Standard HYROX format' : '⚡ Standard HYROX Format'}</Text>
                    <Text style={styles.infoBoxText}>8 × 1km Run · SkiErg 1km · Sled Push · Sled Pull · Burpee Broad Jump · Row 1km · Farmers Carry · Sandbag Lunges · Wall Balls</Text>
                    <Text style={styles.infoBoxAccent}>8km run total</Text>
                  </View>
                </>
              )}

              {raceType === 'CrossFit' && (
                <>
                  <Text style={m ? rm.fieldLabel : styles.modalLabel}>Format</Text>
                  {m ? (
                    <RivalTiles options={CROSSFIT_FORMATS.map((f) => ({ value: f, label: f }))} value={crossfitFormat} onChange={setCrossfitFormat} columns={2} />
                  ) : (
                  <View style={styles.segmentRow}>
                    {CROSSFIT_FORMATS.map((f) => (
                      <TouchableOpacity key={f} style={[styles.segment, crossfitFormat === f && styles.segmentActive]} onPress={() => setCrossfitFormat(f)}>
                        <Text style={[styles.segmentText, crossfitFormat === f && styles.segmentTextActive]}>{f}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  )}
                  <View style={styles.infoBox}>
                    <Text style={styles.infoBoxTitle}>{m ? 'CrossFit competition' : '🏋️ CrossFit Competition'}</Text>
                    <Text style={styles.infoBoxText}>Multiple WODs over the event period. Add a registration link for teammates.</Text>
                  </View>
                </>
              )}

              </SheetGroup>

              {m ? (
                <SheetGroup m={m}>
                  <Text style={rm.label}>Date and location</Text>
                  <View style={ms.pair}>
                    <View style={ms.pairWide}>
                      <Text style={rm.fieldLabel}>Date</Text>
                      <RivalDateField value={raceDate} onChangeText={setRaceDate} placeholder="18/10/2026" inputStyle={inp as any} />
                    </View>
                    <View style={ms.pairHalf}>
                      <Text style={rm.fieldLabel}>Location</Text>
                      <TextInput style={inp} placeholder="Auckland" placeholderTextColor={RivalColors.textSecondary} value={location} onChangeText={setLocation} />
                    </View>
                  </View>
                </SheetGroup>
              ) : (
                <>
                  <Text style={styles.modalLabel}>Event date (DD/MM/YYYY)</Text>
                  <RivalDateField value={raceDate} onChangeText={setRaceDate} placeholder="18/10/2026" inputStyle={inp as any} />
                  <Text style={styles.modalLabel}>Location (optional)</Text>
                  <TextInput style={inp} placeholder="Auckland, NZ" placeholderTextColor={RivalColors.textSecondary} value={location} onChangeText={setLocation} />
                </>
              )}

              {m && !showDetails ? (
                <RivalMoreRow text="Registration link, goal time" action="Add details +" onPress={() => setShowDetails(true)} />
              ) : (
              <SheetGroup m={m}>
              {m && <Text style={rm.label}>Details</Text>}
              <Text style={m ? rm.fieldLabel : styles.modalLabel}>{m ? 'Registration link' : 'Registration link (optional)'}</Text>
              <TextInput style={inp} placeholder="https://…" placeholderTextColor={RivalColors.textSecondary} value={regUrl} onChangeText={setRegUrl} autoCapitalize="none" />

              <Text style={m ? rm.fieldLabel : styles.modalLabel}>{m ? 'Goal time' : 'Goal finish time (optional)'}</Text>
              <TextInput style={inp} placeholder="00:00:00" placeholderTextColor={RivalColors.textSecondary} value={goalFinishTime} onChangeText={v => setGoalFinishTime(formatGoalTimeMask(v))} keyboardType="number-pad" autoCapitalize="none" />
              <Text style={styles.goalTimeHint}>
                {goalFinishTime.trim()
                  ? `Goal: ${goalFinishTime.trim()}.`
                  : 'A time to aim for. It can be changed later.'}
              </Text>
              </SheetGroup>
              )}
    </>
  );

  // Phone Add / Edit event: the grey pop-up style from Plan an activity.
  // Sized to its content, and closed with the X, so there's no Cancel button.
  const eventSheet = (
    <GreySheet
      kicker="EVENTS"
      title={editingRace ? 'Edit event' : 'Add event'}
      onClose={() => { setEventCalOpen(false); closeModal(); }}
      footer={<>
        <GreyPrimary
          label={saving ? 'Saving…' : editingRace ? 'Save changes' : 'Add event'}
          busy={saving}
          disabled={!isFormValid() || saving}
          onPress={saveRace}
        />
        {editingRace && (
          <TouchableOpacity style={ms.deleteLink} onPress={() => { const id = editingRace.id; closeModal(); deleteRace(id); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <RivalIcon name="delete" size={15} color={RivalColors.error} />
            <Text style={ms.deleteLinkText}>Delete event</Text>
          </TouchableOpacity>
        )}
      </>}
      overlay={eventCalOpen ? (
        <GreyCalendar
          value={displayToIsoDate(raceDate)}
          onChange={(iso) => { setRaceDate(isoToDisplayDate(iso)); setEventCalOpen(false); }}
          onClose={() => setEventCalOpen(false)}
        />
      ) : null}
    >
      <GreyLabel>Event</GreyLabel>
      <GreyField placeholder="Event name" value={raceName} onChangeText={setRaceName} />

      <GreyLabel>Type</GreyLabel>
      <GreyTiles
        options={RACE_TYPES.map((t) => ({ value: t, label: t, icon: EVENT_TYPE_ICONS[t] ?? 'moreHoriz' }))}
        value={raceType}
        onChange={setRaceType}
      />

      {raceType === 'HYROX' && (
        <>
          <GreyLabel>Category</GreyLabel>
          <GreyTiles options={HYROX_CATEGORIES.map((c) => ({ value: c, label: c }))} value={hyroxCategory} onChange={setHyroxCategory} columns={2} />
          <GreyNote>Standard format: 8 × 1 km run with 8 stations between. 8 km run in total.</GreyNote>
        </>
      )}

      {raceType === 'CrossFit' && (
        <>
          <GreyLabel>Format</GreyLabel>
          <GreyTiles options={CROSSFIT_FORMATS.map((f) => ({ value: f, label: f }))} value={crossfitFormat} onChange={setCrossfitFormat} columns={2} />
          <GreyNote>Multiple workouts over the event. Add a registration link for teammates.</GreyNote>
        </>
      )}

      {raceType === 'Triathlon' && (
        <>
          <GreyLabel>Distances</GreyLabel>
          <GreyRows>
            <GreyRow icon="swim" label="Swim (km)"><GreyRowInput placeholder="1.9" value={triSwim} onChangeText={setTriSwim} keyboardType="decimal-pad" /></GreyRow>
            <GreyRow icon="ride" label="Bike (km)"><GreyRowInput placeholder="90" value={triBike} onChangeText={setTriBike} keyboardType="decimal-pad" /></GreyRow>
            <GreyRow icon="run" label="Run (km)"><GreyRowInput placeholder="21.1" value={triRun} onChangeText={setTriRun} keyboardType="decimal-pad" /></GreyRow>
          </GreyRows>
          {computedDistance() > 0 && <GreyNote>Total: {computedDistance().toFixed(1)} km</GreyNote>}
        </>
      )}

      {raceType === 'Custom' && (
        <>
          <GreyLabel>Disciplines</GreyLabel>
          <GreyRows>
            {customDisciplines.map((d, i) => (
              <View key={i} style={ms.discRow}>
                <TextInput style={ms.discName} placeholder="Kayak" placeholderTextColor="rgba(255,255,255,0.28)" value={d.name} onChangeText={(v) => updateCustomDiscipline(i, 'name', v)} />
                <TextInput style={ms.discKm} placeholder="km" placeholderTextColor="rgba(255,255,255,0.28)" value={d.distance} onChangeText={(v) => updateCustomDiscipline(i, 'distance', v)} keyboardType="decimal-pad" />
                {customDisciplines.length > 1 && (
                  <TouchableOpacity onPress={() => removeCustomDiscipline(i)} accessibilityLabel="Remove discipline" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <RivalIcon name="close" size={15} color={RivalColors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity style={ms.discAdd} onPress={addCustomDiscipline}>
              <RivalIcon name="add" size={16} color={RivalColors.accentText} />
              <Text style={ms.discAddText}>Add discipline</Text>
            </TouchableOpacity>
          </GreyRows>
          {computedDistance() > 0 && <GreyNote>Total: {computedDistance().toFixed(1)} km</GreyNote>}
        </>
      )}

      <GreyLabel>Details</GreyLabel>
      <GreyRows>
        <GreyRow icon="calendar" label="Date" value={raceDate && displayToIsoDate(raceDate) ? friendlyDate(raceDate) : ''} placeholder="Choose a date" onPress={() => setEventCalOpen(true)} />
        <GreyRow icon="location" label="Location"><GreyRowInput placeholder="Optional" value={location} onChangeText={setLocation} /></GreyRow>
        {raceType !== 'Triathlon' && raceType !== 'HYROX' && raceType !== 'CrossFit' && raceType !== 'Custom' ? (
          <GreyRow icon="distance" label="Distance (km)"><GreyRowInput placeholder="21.1" value={distanceKm} onChangeText={setDistanceKm} keyboardType="decimal-pad" /></GreyRow>
        ) : null}
        <GreyRow icon="link" label="Registration"><GreyRowInput placeholder="Optional" value={regUrl} onChangeText={setRegUrl} autoCapitalize="none" keyboardType="url" /></GreyRow>
        <GreyRow icon="timer" label="Goal time"><GreyRowInput placeholder="Optional" value={goalFinishTime} onChangeText={(v) => setGoalFinishTime(formatGoalTimeMask(v))} keyboardType="number-pad" /></GreyRow>
      </GreyRows>
    </GreySheet>
  );

  const modals = (
    <>
        {/* Add / Edit Race Modal */}
        <Modal visible={showAdd} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            {m ? (
              eventSheet
            ) : (
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalCard}>
                {addEventForm}
                <View style={styles.modalButtons}>
                  <TouchableOpacity style={styles.cancelButton} onPress={closeModal}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, (!isFormValid() || saving) && styles.saveButtonDisabled]}
                    onPress={saveRace} disabled={!isFormValid() || saving}
                  >
                    <BusyText busy={!!(saving)} style={styles.saveButtonText}>{saving ? 'Saving…' : editingRace ? 'Save Changes' : 'Add Event'}</BusyText>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </Modal>

        {/* Find a Race Modal */}
        {m ? (
          // Phone: the grey pop-up. Type tiles, directories as one list.
          <Modal visible={showFind} transparent animationType="slide" onRequestClose={() => setShowFind(false)}>
            <View style={ms.backdrop}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowFind(false)} accessibilityLabel="Close" />
              <GreySheet kicker="EVENTS" title="Find an event" onClose={() => setShowFind(false)} footer={null}>
                <GreyNote>Sea to Sky · BC · Canada</GreyNote>
                <View style={{ height: 10 }} />
                <GreyTiles
                  options={['All', 'Run', 'Ride', 'Swim', 'Triathlon', 'HYROX', 'CrossFit', 'Other'].map((t) => ({ value: t, label: t }))}
                  value={findFilter ?? 'All'}
                  onChange={(t) => setFindFilter(t === 'All' ? null : t)}
                />
                <GreyLabel>Directories</GreyLabel>
                <GreyRows>
                  {RACE_DIRECTORIES.filter((d) => !findFilter || d.types.includes(findFilter)).map((dir) => (
                    <TouchableOpacity key={dir.name} style={ms.dirRow} onPress={() => Linking.openURL(dir.url)} activeOpacity={0.8}>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={ms.dirName}>{dir.name}</Text>
                        <Text style={ms.dirDesc} numberOfLines={2}>{dir.description}</Text>
                      </View>
                      <RivalIcon name="openInNew" size={15} color="rgba(255,255,255,0.4)" />
                    </TouchableOpacity>
                  ))}
                </GreyRows>
              </GreySheet>
            </View>
          </Modal>
        ) : (
        <Modal visible={showFind} transparent animationType="slide" onRequestClose={() => setShowFind(false)}>
          <View style={styles.modalOverlay}>
            {m && <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowFind(false)} accessibilityLabel="Close" />}
            <View style={[styles.findModalCard, m && ms.sheet, m && { paddingBottom: 0 }]}>
              <View style={styles.findModalHeader}>
                <Text style={m ? rm.serifTitleSm : styles.modalTitle}>{m ? 'Find an event' : 'Find an Event'}</Text>
                {!m && (
                  <TouchableOpacity onPress={() => setShowFind(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={styles.findModalClose}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.findModalSub}>Sea to Sky · BC · Canada</Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.findFilterScroll} contentContainerStyle={styles.findFilterRow}>
                <TouchableOpacity
                  style={[styles.findFilterChip, m && ms.chip, findFilter === null && styles.findFilterChipActive]}
                  onPress={() => setFindFilter(null)}
                >
                  <Text style={[styles.findFilterText, findFilter === null && styles.findFilterTextActive]}>All</Text>
                </TouchableOpacity>
                {['Run', 'Ride', 'Swim', 'Triathlon', 'HYROX', 'CrossFit', 'Other'].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.findFilterChip, m && ms.chip, findFilter === t && styles.findFilterChipActive]}
                    onPress={() => setFindFilter(findFilter === t ? null : t)}
                  >
                    <Text style={[styles.findFilterText, findFilter === t && styles.findFilterTextActive]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <ScrollView style={styles.findDirectoryList} showsVerticalScrollIndicator={false}>
                {RACE_DIRECTORIES
                  .filter((d) => !findFilter || d.types.includes(findFilter))
                  .map((dir) => (
                    <TouchableOpacity
                      key={dir.name}
                      style={styles.directoryCard}
                      onPress={() => Linking.openURL(dir.url)}
                    >
                      <View style={styles.directoryInfo}>
                        <Text style={styles.directoryName}>{dir.name}</Text>
                        <Text style={styles.directoryDesc}>{dir.description}</Text>
                        <View style={styles.directoryTypes}>
                          {dir.types.map((t) => (
                            <View key={t} style={styles.directoryTypeChip}>
                              <Text style={styles.directoryTypeText}>{t}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                      <Text style={styles.directoryArrow}>→</Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
        )}

        {/* Log Finish Time Modal */}
        {m ? (
          // Phone: the grey pop-up. Goal and finish time as rows; Save only.
          <Modal visible={!!finishModalRace} transparent animationType="slide" onRequestClose={() => { setFinishModalRace(null); setActualFinishInput(''); }}>
            <View style={ms.backdrop}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { setFinishModalRace(null); setActualFinishInput(''); }} accessibilityLabel="Close" />
              <GreySheet
                kicker="EVENTS"
                title="Log finish time"
                onClose={() => { setFinishModalRace(null); setActualFinishInput(''); }}
                footer={<GreyPrimary label={savingFinish ? 'Saving…' : 'Save finish time'} busy={savingFinish} disabled={!actualFinishInput.trim() || savingFinish} onPress={saveActualFinishTime} />}
              >
                <Text style={ms.finishRace}>{formatRaceName(finishModalRace?.name)}</Text>
                <GreyRows>
                  {finishModalRace?.goal_finish_time ? (
                    <GreyRow icon="flag" label="Goal time" value={finishModalRace.goal_finish_time} />
                  ) : null}
                  <GreyRow icon="timer" label="Finish time">
                    <GreyRowInput value={actualFinishInput} onChangeText={setActualFinishInput} placeholder="1:52:34" autoCapitalize="none" autoFocus />
                  </GreyRow>
                </GreyRows>
                <GreyNote>
                  {actualFinishInput.trim()
                    ? getFinishMessage(actualFinishInput.trim(), finishModalRace?.goal_finish_time ?? null)
                    : 'Every finish counts.'}
                </GreyNote>
              </GreySheet>
            </View>
          </Modal>
        ) : (
        <Modal visible={!!finishModalRace} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.finishModalCard, m && ms.sheet]}>
              <Text style={m ? rm.serifTitleSm : styles.modalTitle}>{m ? 'Log finish time' : 'Log Finish Time'}</Text>
              <Text style={styles.finishModalRaceName}>{formatRaceName(finishModalRace?.name)}</Text>

              {finishModalRace?.goal_finish_time && (
                <View style={styles.goalTimeRow}>
                  <Text style={styles.finishTimeLabel}>Goal time</Text>
                  <Text style={styles.finishTimeValue}>{finishModalRace.goal_finish_time}</Text>
                </View>
              )}

              <Text style={[m ? rm.label : styles.modalLabel, { marginTop: 16 }]}>Finish time</Text>
              <TextInput
                style={inp} placeholder="1:52:34" placeholderTextColor={RivalColors.textSecondary}
                value={actualFinishInput} onChangeText={setActualFinishInput}
                autoCapitalize="none" autoFocus
              />

              {actualFinishInput.trim() ? (
                <View style={styles.finishPreviewBox}>
                  <Text style={styles.finishPreviewMessage}>
                    {getFinishMessage(actualFinishInput.trim(), finishModalRace?.goal_finish_time ?? null)}
                  </Text>
                </View>
              ) : (
                <Text style={styles.finishModalHint}>Every finish counts.</Text>
              )}

              {m ? (
                <View style={[ms.sheetActions, { marginTop: 10 }]}>
                  <TouchableOpacity
                    style={[rm.primary, (!actualFinishInput.trim() || savingFinish) && rm.disabled]}
                    onPress={saveActualFinishTime} disabled={!actualFinishInput.trim() || savingFinish} activeOpacity={0.85}
                  >
                    <BusyText busy={!!(savingFinish)} style={rm.primaryText}>{savingFinish ? 'Saving…' : 'Save finish time'}</BusyText>
                  </TouchableOpacity>
                  <TouchableOpacity style={rm.ghost} onPress={() => { setFinishModalRace(null); setActualFinishInput(''); }} activeOpacity={0.85}>
                    <Text style={rm.ghostText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.modalButtons}>
                  <TouchableOpacity style={styles.cancelButton} onPress={() => { setFinishModalRace(null); setActualFinishInput(''); }}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, (!actualFinishInput.trim() || savingFinish) && styles.saveButtonDisabled]}
                    onPress={saveActualFinishTime} disabled={!actualFinishInput.trim() || savingFinish}
                  >
                    <BusyText busy={!!(savingFinish)} style={styles.saveButtonText}>{savingFinish ? 'Saving…' : 'Save'}</BusyText>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>
        )}
    </>
  );

  if (!wide) {
    const tabs: { key: typeof activeTab; label: string; count: number }[] = [
      { key: 'mine', label: 'Mine', count: myRaces.length },
      { key: 'friends', label: 'Teammates', count: friendRaces.length },
      { key: 'completed', label: 'Completed', count: completedRaces.length },
    ];
    const emptyText = activeTab === 'mine'
      ? 'No events added yet.'
      : activeTab === 'completed'
      ? 'No completed events yet.'
      : leagueMateIds.size === 0
      ? 'Join a team to see teammates’ events.'
      : 'No teammate events yet.';

    return (
      <SafeAreaView style={rb.page} edges={['top', 'left', 'right']}>
        <RivalTopNav active="today" />
        <ScrollView contentContainerStyle={[rb.content, ms.content]}>
          <GreyPageHead kicker="RACES AND COMPETITIONS" title="Events" onBack={() => (router.canGoBack() ? router.back() : goToTab('/home'))} />

          <View style={ms.actions}>
            <TouchableOpacity style={[rm.primary, { flex: 1 }]} onPress={() => setShowAdd(true)} activeOpacity={0.85}>
              <RivalIcon name="add" size={18} color={rm.primaryText.color as string} />
              <Text style={rm.primaryText}>Add event</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[rm.ghost, { flex: 1 }]} onPress={() => { setFindFilter(null); setShowFind(true); }} activeOpacity={0.85}>
              <RivalIcon name="search" size={17} color={RivalColors.accentText} />
              <Text style={rm.ghostText}>Find events</Text>
            </TouchableOpacity>
          </View>

          <GreySegment
            options={tabs.map((t) => ({ value: t.key, label: t.count > 0 ? `${t.label} ${t.count}` : t.label }))}
            value={activeTab}
            onChange={setActiveTab}
          />

          {loading && <Text style={ms.loadingText}>Loading…</Text>}

          {!loading && displayed.length === 0 && (
            <View style={[rb.card, ms.emptyRow]}>
              <View style={rb.badge}>
                <RivalIcon name="flag" size={16} color={RivalColors.accentText} />
              </View>
              <Text style={ms.emptyText}>{emptyText}</Text>
            </View>
          )}

          {displayed.map((race, index) => {
            const isOwn = race.user_id === userId;
            const days = daysUntil(race.race_date);
            const past = days < 0;
            const ownerName = race.users ? formatDisplayName(race.users) : undefined;
            // The next race of your own is the one hero moment on the screen.
            const hero = activeTab === 'mine' && index === 0 && !past;
            const typeLine = [race.race_type, race.distance_km > 0 ? `${race.distance_km} km` : null].filter(Boolean).join(' · ');
            const beat = past && race.actual_finish_time && race.goal_finish_time
              && parseTimeToSeconds(race.actual_finish_time) <= parseTimeToSeconds(race.goal_finish_time);

            return (
              // Your own race opens the editor; delete lives in there too.
              <TouchableOpacity
                key={race.id}
                activeOpacity={isOwn ? 0.85 : 1}
                disabled={!isOwn}
                onPress={() => openEdit(race)}
                style={[rb.card, hero && rb.hero]}
              >
                {/* Ticket: the event on the left, the countdown on the right
                    past a dashed tear line (the ticket on Today). */}
                <View style={ms.ticket}>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={[rb.label, hero && { color: RivalColors.accentText }]} numberOfLines={1}>{hero ? 'Next event' : typeLine}</Text>
                    <Text style={ms.ticketName} numberOfLines={2}>{formatRaceName(race.name)}</Text>
                    <Text style={ms.ticketMeta} numberOfLines={1}>
                      {[formatRaceDate(race.race_date), race.location].filter(Boolean).join(' · ')}
                    </Text>
                    {hero && typeLine ? <Text style={ms.ticketType} numberOfLines={1}>{typeLine}</Text> : null}
                    {!isOwn && ownerName ? <Text style={ms.owner}>{ownerName}</Text> : null}
                  </View>
                  <View style={ms.stub}>
                    {!past ? (
                      <>
                        <Text style={ms.stubNum}>{days}</Text>
                        <Text style={rb.label}>{days === 1 ? 'Day' : 'Days'}</Text>
                      </>
                    ) : (
                      <RivalIcon name="checkCircle" size={24} color={RivalColors.accentGold} />
                    )}
                  </View>
                </View>

                {race.disciplines && race.disciplines.length > 0 && (
                  <View style={styles.disciplinesRow}>
                    {race.disciplines.map((d, i) => (
                      <View key={i} style={ms.discipline}>
                        <Text style={ms.disciplineText}>{d.name}{d.distance_km > 0 ? ` · ${d.distance_km} km` : ''}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {!past && race.goal_finish_time ? (
                  <View style={ms.goalRow}>
                    <Text style={rm.label}>Goal time</Text>
                    <Text style={ms.goalValue}>{race.goal_finish_time}</Text>
                  </View>
                ) : null}

                {isOwn && !past && race.distance_km > 0 ? (
                  <TrainingBar avgWeeklyKm={race.avg_weekly_km} distanceKm={race.distance_km} />
                ) : null}

                {past && isOwn && race.actual_finish_time ? (
                  <View style={ms.finish}>
                    <View style={ms.goalRow}>
                      <Text style={rm.label}>Finish time</Text>
                      <Text style={ms.goalValue}>{race.actual_finish_time}</Text>
                    </View>
                    {race.goal_finish_time ? (
                      <View style={ms.goalRow}>
                        <Text style={rm.label}>Goal</Text>
                        <Text style={[ms.goalValue, { color: beat ? RivalColors.accentGold : RivalWarm.soft }]}>{race.goal_finish_time}</Text>
                      </View>
                    ) : null}
                    <Text style={ms.message}>{getFinishMessage(race.actual_finish_time, race.goal_finish_time)}</Text>
                  </View>
                ) : null}

                {past && isOwn && !race.actual_finish_time ? (
                  <TouchableOpacity style={rm.ghost} onPress={() => { setFinishModalRace(race); setActualFinishInput(''); }} activeOpacity={0.85}>
                    <RivalIcon name="timer" size={16} color={RivalColors.accentText} />
                    <Text style={rm.ghostText}>Log finish time</Text>
                  </TouchableOpacity>
                ) : null}

                {(!isOwn || race.interest_count > 0 || race.registration_url) ? (
                  <View style={ms.footer}>
                    {!isOwn && (
                      <TouchableOpacity
                        style={[ms.inBtn, race.i_am_interested && ms.inBtnOn]}
                        onPress={() => toggleInterest(race)}
                        activeOpacity={0.85}
                      >
                        {race.i_am_interested ? <RivalIcon name="check" size={14} color={rm.primaryText.color as string} /> : null}
                        <Text style={[ms.inText, race.i_am_interested && ms.inTextOn]}>{race.i_am_interested ? 'Going' : "I'm in too"}</Text>
                      </TouchableOpacity>
                    )}
                    {race.interest_count > 0 && (
                      <Text style={ms.metaText}>{race.interest_count} going</Text>
                    )}
                    <View style={{ flex: 1 }} />
                    {race.registration_url ? (
                      <TouchableOpacity onPress={() => Linking.openURL(race.registration_url!)} style={ms.register} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={ms.registerText}>Register</Text>
                        <RivalIcon name="openInNew" size={13} color={RivalColors.accentText} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {modals}
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

        <View style={styles.titleRow}>
          <RivalPageHeader title="Events" subtitle="Races, competitions and more." rules={false} />
          <View style={styles.titleButtons}>
            <TouchableOpacity style={styles.findBtn} onPress={() => { setFindFilter(null); setShowFind(true); }}>
              <Text style={styles.findBtnText}>Find</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
              <Text style={styles.addBtnText}>+ Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'mine' && styles.tabActive]}
            onPress={() => setActiveTab('mine')}
          >
            <Text style={[styles.tabText, activeTab === 'mine' && styles.tabTextActive]}>
              Mine ({myRaces.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'friends' && styles.tabActive]}
            onPress={() => setActiveTab('friends')}
          >
            <Text style={[styles.tabText, activeTab === 'friends' && styles.tabTextActive]}>
              Teammates ({friendRaces.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'completed' && styles.tabActive]}
            onPress={() => setActiveTab('completed')}
          >
            <Text style={[styles.tabText, activeTab === 'completed' && styles.tabTextActive]}>
              Completed ({completedRaces.length})
            </Text>
          </TouchableOpacity>
        </View>

        {loading && <Text style={styles.emptyText}>Loading…</Text>}

        {!loading && displayed.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🏁</Text>
            <Text style={styles.emptyText}>
              {activeTab === 'mine'
                ? "You haven't added any events yet."
                : activeTab === 'completed'
                ? "No completed events yet."
                : leagueMateIds.size === 0
                ? "Join a team to see your friends' events here."
                : "None of your teammates have added an event yet."}
            </Text>
          </View>
        )}

        {displayed.map((race) => {
          const isOwn = race.user_id === userId;
          const days = daysUntil(race.race_date);
          const past = days < 0;
          const ownerName = race.users ? formatDisplayName(race.users) : undefined;

          return (
            <View key={race.id} style={[styles.raceCard, isOwn && styles.raceCardOwn, past && styles.raceCardCompleted]}>

              <View style={styles.raceHeader}>
                <View style={styles.raceTypeRow}>
                  <RivalIcon name={RACE_TYPE_ICONS[race.race_type] ?? 'flag'} size={26} color={RivalColors.accentText} />
                  <View style={styles.raceMeta}>
                    <Text style={styles.raceTypeLabel}>{race.race_type.toUpperCase()}</Text>
                    {!isOwn && <Text style={styles.raceOwner}>{ownerName}</Text>}
                    {isOwn && <Text style={styles.raceOwnerYou}>Event</Text>}
                  </View>
                </View>
                {isOwn && (
                  <View style={styles.ownActions}>
                    <TouchableOpacity onPress={() => openEdit(race)}>
                      <Text style={styles.editBtn}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteRace(race.id)}>
                      <Text style={styles.deleteBtn}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <Text style={styles.raceName}>{formatRaceName(race.name)}</Text>

              <View style={styles.raceDetails}>
                {race.location ? (
                  <View style={styles.raceDetailRow}>
                    <RivalIcon name="location" size={13} color={RivalColors.textSecondary} />
                    <Text style={styles.raceDetail}>{race.location}</Text>
                  </View>
                ) : null}
                {race.distance_km > 0 && (
                  <View style={styles.raceDetailRow}>
                    <RivalIcon name="distance" size={13} color={RivalColors.textSecondary} />
                    <Text style={styles.raceDetail}>{race.distance_km} km</Text>
                  </View>
                )}
                <View style={styles.raceDetailRow}>
                  <RivalIcon name="calendar" size={13} color={RivalColors.textSecondary} />
                  <Text style={styles.raceDetail}>{formatRaceDate(race.race_date)}</Text>
                </View>
              </View>

              {race.disciplines && race.disciplines.length > 0 && (
                <View style={styles.disciplinesRow}>
                  {race.disciplines.map((d, i) => (
                    <View key={i} style={styles.disciplineChip}>
                      <Text style={styles.disciplineChipText}>{d.name}{d.distance_km > 0 ? ` · ${d.distance_km}km` : ''}</Text>
                    </View>
                  ))}
                </View>
              )}

              {!past && (
                <View style={styles.countdownRow}>
                  <Text style={styles.countdownNum}>{days}</Text>
                  <Text style={styles.countdownLabel}>days to go</Text>
                </View>
              )}

              {!past && race.goal_finish_time && (
                <View style={styles.goalTimeRow}>
                  <Text style={styles.goalTimeLabel}>🎯 Goal</Text>
                  <Text style={styles.goalTimeValue}>{race.goal_finish_time}</Text>
                </View>
              )}

              {past && (
                <View style={styles.completedBadge}>
                  <Text style={styles.completedBadgeText}>✓ Event completed</Text>
                </View>
              )}

              {past && isOwn && race.actual_finish_time && (
                <View style={styles.finishTimesBlock}>
                  <View style={styles.finishTimeRow}>
                    <Text style={styles.finishTimeLabel}>Finish time</Text>
                    <Text style={styles.finishTimeValue}>{race.actual_finish_time}</Text>
                  </View>
                  {race.goal_finish_time && (
                    <View style={styles.finishTimeRow}>
                      <Text style={styles.finishTimeLabel}>Goal</Text>
                      <Text style={[
                        styles.finishTimeValue,
                        parseTimeToSeconds(race.actual_finish_time) <= parseTimeToSeconds(race.goal_finish_time)
                          ? styles.finishBeat : styles.finishMissed,
                      ]}>
                        {race.goal_finish_time}
                        {parseTimeToSeconds(race.actual_finish_time) <= parseTimeToSeconds(race.goal_finish_time) ? ' ✓' : ''}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.finishMessage}>
                    {getFinishMessage(race.actual_finish_time, race.goal_finish_time)}
                  </Text>
                </View>
              )}

              {past && isOwn && !race.actual_finish_time && (
                <TouchableOpacity style={styles.logFinishBtn} onPress={() => { setFinishModalRace(race); setActualFinishInput(''); }}>
                  <Text style={styles.logFinishBtnText}>+ Log finish time</Text>
                </TouchableOpacity>
              )}

              {isOwn && !past && <TrainingBar avgWeeklyKm={race.avg_weekly_km} distanceKm={race.distance_km} />}

              <View style={styles.raceFooter}>
                {!isOwn && (
                  <TouchableOpacity
                    style={[styles.interestedBtn, race.i_am_interested && styles.interestedBtnActive]}
                    onPress={() => toggleInterest(race)}
                  >
                    <Text style={[styles.interestedBtnText, race.i_am_interested && styles.interestedBtnTextActive]}>
                      {race.i_am_interested ? "I'm in ✓" : "I'm in too"}
                    </Text>
                  </TouchableOpacity>
                )}
                {race.interest_count > 0 && (
                  <Text style={styles.interestCount}>
                    {race.interest_count} {race.interest_count === 1 ? 'person' : 'people'} in
                  </Text>
                )}
                {race.registration_url && (
                  <TouchableOpacity onPress={() => Linking.openURL(race.registration_url!)}>
                    <Text style={styles.registerLink}>
                      {isOwn ? 'Register' : `Register with ${ownerName}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

            </View>
          );
        })}

      </ScrollView>

      {modals}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 },
  header: { marginBottom: 0 },
  back: { color: RivalColors.accentFill, fontSize: 16 },

  titleRow: { flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 24 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary },
  titleButtons: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  findBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: RivalColors.accentText },
  findBtnText: { color: RivalColors.accentText, fontWeight: '700', fontSize: 15 },
  addBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  addBtnText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontWeight: '700', fontSize: 15 },

  findModalCard: { backgroundColor: RivalColors.surfaceContainer, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 0, maxHeight: '85%', marginTop: 'auto' },
  findModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  findModalClose: { color: RivalColors.textSecondary, fontSize: 20, padding: 4 },
  findModalSub: { fontSize: 13, color: RivalColors.textSecondary, marginBottom: 16 },
  findFilterScroll: { flexGrow: 0, marginBottom: 16 },
  findFilterRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  findFilterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: RivalColors.surfaceHigh, backgroundColor: RivalColors.surfaceContainer },
  findFilterChipActive: { backgroundColor: RivalColors.accentText, borderColor: RivalColors.accentText },
  findFilterText: { fontSize: 13, fontWeight: '600', color: RivalColors.textSecondary },
  findFilterTextActive: { color: RivalColors.surfaceLow },
  findDirectoryList: { marginHorizontal: -28, paddingHorizontal: 28 },
  directoryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 12 },
  directoryInfo: { flex: 1, gap: 4 },
  directoryName: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  directoryDesc: { fontSize: 12, color: RivalColors.textSecondary },
  directoryTypes: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  directoryTypeChip: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  directoryTypeText: { fontSize: 10, color: RivalColors.textSecondary, fontWeight: '600' },
  directoryArrow: { fontSize: 18, color: RivalColors.accentText },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh, backgroundColor: RivalColors.surfaceContainer },
  tabActive: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: RivalButtonColors.fill },
  tabText: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: RivalButtonColors.label(RivalColors.textPrimary) },

  emptyState: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  emptyIcon: { fontSize: 36 },
  emptyText: { color: RivalColors.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 20 },

  raceCard: {
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: 16, padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 12,
  },
  raceCardOwn: { borderColor: RivalColors.accentText },
  raceCardCompleted: { opacity: 0.7 },

  raceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  raceTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  raceTypeIcon: { fontSize: 28 },
  raceMeta: { gap: 2 },
  raceTypeLabel: { fontSize: 11, fontWeight: '800', color: RivalColors.accentText, letterSpacing: 1 },
  raceOwner: { fontSize: 12, color: RivalColors.textSecondary },
  raceOwnerYou: { fontSize: 12, color: RivalColors.accentText, fontWeight: '600' },
  ownActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editBtn: { color: RivalColors.accentFill, fontSize: 14, fontWeight: '700' },
  deleteBtn: { color: RivalColors.textSecondary, fontSize: 18, padding: 4 },

  raceName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22, fontWeight: '700', color: RivalColors.textPrimary },
  raceDetails: { gap: 4 },
  raceDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  raceDetail: { fontSize: 13, color: RivalColors.textSecondary },

  disciplinesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  disciplineChip: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  disciplineChipText: { color: RivalColors.textSecondary, fontSize: 12, fontWeight: '600' },

  countdownRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  countdownNum: { fontSize: 36, fontWeight: '900', color: RivalColors.textPrimary },
  countdownLabel: { fontSize: 14, color: RivalColors.textSecondary, fontWeight: '600' },

  goalTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  goalTimeLabel: { fontSize: 12, color: RivalColors.textSecondary, fontWeight: '600' },
  goalTimeValue: { fontSize: 15, color: RivalColors.accentFill, fontWeight: '800' },

  completedBadge: { backgroundColor: 'rgba(245,183,89,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(245,183,89,0.35)' },
  completedBadgeText: { color: RivalColors.accentGold, fontSize: 13, fontWeight: '700' },

  finishTimesBlock: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  finishTimeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  finishTimeLabel: { fontSize: 12, color: RivalColors.textSecondary, fontWeight: '600' },
  finishTimeValue: { fontSize: 16, color: RivalColors.textPrimary, fontWeight: '800' },
  finishBeat: { color: RivalColors.accentGold },
  finishMissed: { color: RivalColors.accentGold },
  finishMessage: { fontSize: 13, color: RivalColors.textSecondary, fontStyle: 'italic', lineHeight: 19, marginTop: 4 },

  logFinishBtn: { borderWidth: 1, borderColor: RivalColors.accentFill, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  logFinishBtnText: { color: RivalColors.accentFill, fontSize: 14, fontWeight: '700' },

  trainingSection: { gap: 6 },
  trainingLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  trainingLabel: { fontSize: 12, color: RivalColors.textSecondary, fontWeight: '600' },
  trainingPct: { fontSize: 12, color: RivalColors.accentFill, fontWeight: '700' },
  trainingTrack: { height: 8, backgroundColor: RivalColors.surfaceHigh, borderRadius: 4 },
  trainingFill: { height: '100%', borderRadius: 4 },
  trainingMeta: { fontSize: 11, color: RivalColors.textSecondary },

  raceFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  interestedBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.accentFill },
  interestedBtnActive: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  interestedBtnText: { color: RivalColors.accentFill, fontWeight: '700', fontSize: 13 },
  interestedBtnTextActive: { color: RivalButtonColors.label(RivalColors.textPrimary) },
  interestCount: { fontSize: 12, color: RivalColors.textSecondary, flex: 1 },
  registerLink: { color: RivalColors.accentText, fontSize: 13, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalScroll: { maxHeight: '90%' },
  modalCard: { backgroundColor: RivalColors.surfaceContainer, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 12 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  modalInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, padding: 14, color: RivalColors.textPrimary, fontSize: 16, borderWidth: 1, borderColor: RivalColors.surfaceHigh },

  segmentRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  segment: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh, backgroundColor: RivalColors.surfaceContainer },
  segmentActive: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: RivalButtonColors.fill },
  segmentText: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: RivalButtonColors.label(RivalColors.textPrimary) },

  disciplineInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  disciplineInputLabel: { color: RivalColors.textSecondary, fontSize: 14, fontWeight: '600', width: 100 },
  disciplineInput: { flex: 1 },
  distanceSummary: { fontSize: 14, color: RivalColors.accentFill, fontWeight: '700', textAlign: 'right' },
  customDisciplineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  removeDisc: { color: RivalColors.textSecondary, fontSize: 18, paddingHorizontal: 4 },
  addDisciplineBtn: { paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh, alignItems: 'center' },
  addDisciplineBtnText: { color: RivalColors.accentFill, fontWeight: '700', fontSize: 14 },

  infoBox: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 4 },
  infoBoxTitle: { fontSize: 14, fontWeight: '800', color: RivalColors.textPrimary },
  infoBoxText: { fontSize: 12, color: RivalColors.textSecondary, lineHeight: 18 },
  infoBoxAccent: { fontSize: 12, color: RivalColors.accentFill, fontWeight: '700' },

  goalTimeHint: { fontSize: 12, color: RivalColors.textSecondary, fontStyle: 'italic' },

  finishModalCard: { backgroundColor: RivalColors.surfaceContainer, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 12, marginTop: 'auto' },
  finishModalRaceName: { fontSize: 16, color: RivalColors.textSecondary, marginBottom: 4 },
  finishPreviewBox: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  finishPreviewMessage: { fontSize: 14, color: RivalColors.textPrimary, fontStyle: 'italic', lineHeight: 20 },
  finishModalHint: { fontSize: 13, color: RivalColors.textSecondary, fontStyle: 'italic' },

  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  cancelButtonText: { color: RivalColors.textSecondary, fontSize: 16, fontWeight: '600' },
  saveButton: { flex: 2, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontSize: 16, fontWeight: '700' },
});

// Mobile only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  dirName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  dirDesc: { fontSize: 12, lineHeight: 16, color: RivalColors.textSecondary },
  finishRace: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 12 },
  loadingText: { fontSize: 12.5, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyText: { flex: 1, fontSize: 13, lineHeight: 18, color: RivalColors.textSecondary },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ticketName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, lineHeight: 24, color: '#fff' },
  ticketMeta: { fontSize: 12.5, color: RivalColors.textSecondary },
  ticketType: { fontSize: 11.5, color: 'rgba(255,255,255,0.4)' },
  stub: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minWidth: 64, paddingLeft: 12, borderLeftWidth: 1.5, borderStyle: 'dashed', borderLeftColor: 'rgba(255,209,190,0.18)' },
  stubNum: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, lineHeight: 34, color: '#fff',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #ffffff, #D97757 170%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : {}),
  } as any,
  content: { paddingBottom: 120 },
  actions: { flexDirection: 'row', gap: 10 },
  tabs: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999, backgroundColor: RivalWarm.field, borderWidth: 1, borderColor: RivalWarm.cardBorder },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999 },
  tabOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  tabText: { fontSize: 13, fontWeight: '700', color: RivalWarm.soft },
  tabTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  empty: { alignItems: 'center', paddingVertical: 28 },

  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  owner: { fontSize: 12.5, fontWeight: '600', color: RivalWarm.soft, marginTop: 2 },
  countdown: { alignItems: 'center', minWidth: 48 },
  countdownNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 30, fontWeight: '700', color: RivalColors.accentText, lineHeight: 34 },
  countdownLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalWarm.muted },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  metaText: { fontSize: 12.5, fontWeight: '600', color: RivalWarm.soft },
  discipline: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: RivalWarm.field, borderWidth: 1, borderColor: RivalWarm.cardBorder },
  disciplineText: { fontSize: 11.5, fontWeight: '600', color: RivalWarm.soft },
  goalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 18, fontWeight: '700', color: '#fff' },
  finish: { gap: 8 },
  message: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 15, lineHeight: 21, color: RivalWarm.soft },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2 },
  inBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,209,190,0.28)' },
  inBtnOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' },
  inText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
  inTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  register: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  registerText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },

  sheetScroll: { flexGrow: 0 },
  // Find and Log finish sheets: the same page background and sand edge as the
  // shared form sheet (RivalSheet).
  sheet: {
    backgroundColor: RivalWarm.page, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,209,190,0.18)',
    paddingHorizontal: 16, paddingTop: 22, paddingBottom: 36, gap: 10,
  },
  pair: { flexDirection: 'row', gap: 10 },
  pairWide: { flex: 1.15, gap: 10 },
  pairHalf: { flex: 1, gap: 10 },
  chip: { borderRadius: 999, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: RivalWarm.field, paddingHorizontal: 14 },
  sheetActions: { gap: 10 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  deleteLinkText: { fontSize: 14, fontWeight: '700', color: RivalColors.error },
  discRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46 },
  discName: { flex: 1, minWidth: 0, color: RivalColors.textPrimary, fontSize: 15, fontWeight: '500', paddingVertical: 8, backgroundColor: 'transparent', borderWidth: 0 },
  discKm: { width: 64, color: RivalColors.textPrimary, fontSize: 15, fontWeight: '500', textAlign: 'right', paddingVertical: 8, backgroundColor: 'transparent', borderWidth: 0 },
  discAdd: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  discAddText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
});
