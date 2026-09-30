import { useState, useEffect } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, Platform, Image, Linking, useWindowDimensions } from 'react-native';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { GreySheet, GreyLabel, GreyField, GreyTiles, GreyRows, GreyRow, GreyRowInput, GreyPrimary, GreyCalendar, GreyNote, GreyPageHead, rb } from '../components/rival';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { RivalTopNav, RivalIcon, RivalFixedBackground } from '../components/rival';
import type { RivalIconName } from '../components/rival/RivalIcon';
import { RivalColors, RivalRadius, RivalType, RivalButtonColors } from '../constants/rivalTheme';
import { displayToIsoDate, isoToDisplayDate, friendlyDate } from '../lib/dateFormat';
import { formatGoalTimeMask } from '../lib/format';
import { Asset } from 'expo-asset';
import { BusyText } from '../components/rival/BusyText';

const MODAL_BG_SOURCE = require('../../assets/images/backgrounds/optimized/trail-sisters-finish-line.jpg');
// Same RN-Web gap as RivalFixedBackground: Image's style/resizeMode can't
// reposition the crop on web (its inner div hardcodes center), so a plain
// <Image> can't push the focal point down onto the runners instead of the
// sky above them. Raw <img> + object-position sidesteps it; native keeps Image.
const MODAL_BG_FOCAL_POINT = '50% 68%';

// Mirrors races.tsx exactly — same race-creation logic, just reached from
// inside team creation instead of a separate page. races.tsx itself still
// uses emoji glyphs (predates the real-icons rule); this modal is part of
// the Refined Ember redesign, so it uses RivalIcon instead.
const RACE_TYPES = ['Run', 'Ride', 'Swim', 'Triathlon', 'HYROX', 'CrossFit', 'Other', 'Custom'];
const RACE_TYPE_ICONS: Record<string, RivalIconName> = {
  Run: 'run', Ride: 'ride', Swim: 'swim', Triathlon: 'medal',
  HYROX: 'hyrox', CrossFit: 'crossfit', Other: 'flag', Custom: 'star',
};
// Quick-select common distances per type — saves typing, shown only for the
// plain-distance types (Triathlon/HYROX/CrossFit/Custom have their own
// distance model already).
const POPULAR_DISTANCES: Record<string, number[]> = {
  Run: [5, 10, 21.1, 42.2],
  Ride: [20, 40, 90, 180],
  Swim: [1, 1.9, 3.8],
  Other: [5, 10, 21.1, 42.2],
};
// Official HYROX format × division structure: Singles/Doubles/Relay, each with
// an Open and Pro division; Doubles and Relay also have Mixed alongside Men/Women.
// Shown as two steps instead of all 12 at once — pick a gender group first,
// then the format/division options valid for it (Mixed only has Doubles/Relay;
// nothing has a "Relay Pro" or "Doubles Pro Mixed").
const HYROX_GENDERS = ['Men', 'Women', 'Mixed'] as const;
type HyroxGender = typeof HYROX_GENDERS[number];
// Mirrors the optional fields find-race-link may return per candidate —
// only ever present when the model is confident, never guessed.
type LinkCandidate = {
  label: string; url: string; location?: string; date?: string; type?: string;
  distance_km?: number; triathlon_km?: { swim: number; bike: number; run: number };
};
const HYROX_FORMATS: Record<HyroxGender, Array<{ label: string; value: string }>> = {
  Men: [
    { label: 'Singles', value: 'Men' },
    { label: 'Singles Pro', value: 'Men Pro' },
    { label: 'Doubles', value: 'Doubles Men' },
    { label: 'Doubles Pro', value: 'Doubles Pro Men' },
    { label: 'Relay', value: 'Relay Men' },
  ],
  Women: [
    { label: 'Singles', value: 'Women' },
    { label: 'Singles Pro', value: 'Women Pro' },
    { label: 'Doubles', value: 'Doubles Women' },
    { label: 'Doubles Pro', value: 'Doubles Pro Women' },
    { label: 'Relay', value: 'Relay Women' },
  ],
  Mixed: [
    { label: 'Doubles', value: 'Doubles Mixed' },
    { label: 'Relay', value: 'Relay Mixed' },
  ],
};
function hyroxGenderOf(value: string): HyroxGender {
  if (value.includes('Mixed')) return 'Mixed';
  if (value.includes('Women')) return 'Women';
  return 'Men';
}
const CROSSFIT_FORMATS = ['Open', 'Local Comp', 'Sanctional', 'Games'];

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function todayLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Month-grid date picker helpers for the Add Event modal's Race Date field
// and the Team Target deadline — a full calendar month instead of a bare
// text box, navigable by month (single arrows) or year (double arrows).
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function addYears(d: Date, n: number): Date {
  return new Date(d.getFullYear() + n, d.getMonth(), 1);
}
function toDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
// Read-only confirmation line above the calendar — replaces a manually-typed
// date box, which was redundant once the calendar could jump any month/year.
function formatSelectedDate(ddmmyyyy: string): string {
  const iso = displayToIsoDate(ddmmyyyy);
  if (!iso) return 'No date selected yet';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
// Gives the countdown its context — both above the calendar and in the
// live preview card. null when no valid date is set yet.
function daysRemaining(ddmmyyyy: string): number | null {
  const iso = displayToIsoDate(ddmmyyyy);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}
// Live preview card echoes raw typed input (location) — capitalize so
// "whistler" reads as "Whistler" without forcing the input itself to.
function capFirst(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
// Monday-start grid cells for a given month — null entries are the blank
// leading cells before the 1st (no trailing blanks needed; a ragged last
// row is fine visually and avoids computing next-month day numbers).
function monthGridCells(viewDate: Date): (number | null)[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun..6=Sat
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  // Pad the trailing partial week to a full 7 too — otherwise the last row's
  // leftover cells (e.g. just "30, 31") are the only children in that flex
  // row and stretch to fill it, instead of staying aligned under their columns.
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function chunkWeeks<T>(cells: T[]): T[][] {
  const weeks: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

type RaceOption = { id: string; name: string; race_date: string; race_type: string };

// Mirrors CHALLENGE_METRICS in league.tsx (same metric vocabulary as
// league_challenges) so "Team Target" progress reads consistently with
// how head-to-head Challenges already score.
type GoalMetric = 'xp' | 'distance' | 'elevation' | 'duration' | 'activities';
const GOAL_METRICS: Array<{ value: GoalMetric; label: string }> = [
  { value: 'distance', label: 'Distance (km)' },
  { value: 'elevation', label: 'Elevation (m)' },
  { value: 'duration', label: 'Time (hours)' },
  { value: 'xp', label: 'Effort Earned' },
  { value: 'activities', label: 'Activities Logged' },
];

// Full month-grid date picker (replaces the earlier week-strip — a single
// week made picking a date months out impractical). Reused for both Race
// Date and the Team Target deadline; owns its own displayed-month state so
// each field navigates independently.
function MonthCalendarPicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const weeks = chunkWeeks(monthGridCells(viewDate));

  // `value` can change out from under this component — auto-filled from a
  // race-link search, or typed elsewhere — without the user ever touching
  // the nav arrows. Without this, the grid keeps showing whatever month it
  // opened on, so the newly-set date never appears highlighted (or even
  // visible) until the user manually navigates to find it.
  useEffect(() => {
    const iso = displayToIsoDate(value);
    if (!iso) return;
    const [y, m] = iso.split('-').map(Number);
    setViewDate(prev => (prev.getFullYear() === y && prev.getMonth() === m - 1) ? prev : new Date(y, m - 1, 1));
  }, [value]);
  const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };

  return (
    <View style={styles.calendarWidget}>
      <View style={styles.calendarHeaderRow}>
        <View style={styles.calendarNavGroup}>
          <TouchableOpacity onPress={() => setViewDate(d => addYears(d, -1))} hitSlop={hitSlop}>
            <RivalIcon name="yearBack" size={16} color={RivalColors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewDate(d => addMonths(d, -1))} hitSlop={hitSlop}>
            <RivalIcon name="monthBack" size={16} color={RivalColors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.calendarMonthLabel}>{viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <View style={styles.calendarNavGroup}>
          <TouchableOpacity onPress={() => setViewDate(d => addMonths(d, 1))} hitSlop={hitSlop}>
            <RivalIcon name="monthForward" size={16} color={RivalColors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewDate(d => addYears(d, 1))} hitSlop={hitSlop}>
            <RivalIcon name="yearForward" size={16} color={RivalColors.textSecondary} />
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
            const dayStr = toDDMMYYYY(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
            const isSelected = value === dayStr;
            return (
              <TouchableOpacity
                key={di}
                style={[styles.calendarDayCell, isSelected && styles.calendarDayCellActive]}
                onPress={() => onChange(dayStr)}
              >
                <Text style={[styles.calendarDayNum, isSelected && styles.calendarDayNumActive]}>{day}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// stitch-export-20 ("Establish Your Collective"): adapted rather than copied
// verbatim — "Collective"/"Forge"/"Elite" and the invented Standard
// Training/T100/Hyrox path cards don't match RIVAL's shipped vocabulary
// (Team, not Collective) or brand voice (calm, not grind-culture), and there's
// no "training path" concept in the data model. Kept the layout language
// (glass panel over a full-bleed photo, segmented privacy control, selectable
// cards) but pointed the cards at the real Journeys/race feature and dropped
// the fabricated "Collective Charter" agreement line.
export default function CreateLeagueScreen() {
  const [name, setName] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Creating…');
  const [error, setError] = useState('');

  // Journeys: a league becomes a shared destination when a race is attached — see
  // project_rival_journeys_concept.md. Deliberately optional, defaults to a normal league.
  const [myRaces, setMyRaces] = useState<RaceOption[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);

  // Team Target: a cumulative team-wide goal ("1000km by Dec 1") instead of a
  // real dated race — everyone's logged activity counts toward one shared
  // number. Mutually exclusive with attaching a race (see leagues_team_goal.sql).
  const [teamGoalMode, setTeamGoalMode] = useState(false);
  const [goalMetric, setGoalMetric] = useState<GoalMetric>('distance');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');

  // Every team gets an AI-generated crest — no photo upload option, so every
  // team page shares one consistent look instead of a mix of AI art and
  // whatever snapshot someone had on hand. A retry after a crest failure
  // reuses this id rather than creating a second league row.
  const [leagueId, setLeagueId] = useState<string | null>(null);
  // Set once crest generation succeeds — switches the panel to a reveal
  // screen instead of navigating straight to the team feed, so the crest
  // (the one thing every team gets, unique, one-time) gets its own moment.
  const [revealCrestUrl, setRevealCrestUrl] = useState<string | null>(null);
  // 3 candidates come back from one generation call; the admin picks one
  // before it's written to the league (see chooseCrest below).
  const [crestCandidates, setCrestCandidates] = useState<string[] | null>(null);
  const [confirmingCrest, setConfirmingCrest] = useState(false);

  // Add-race: full parity with races.tsx's own Add Race form (same fields,
  // same per-type disciplines) so nothing is left out — reached inline here
  // instead of sending someone away from team creation and back.
  const [showAddRace, setShowAddRace] = useState(false);
  const [raceCalOpen, setRaceCalOpen] = useState(false);
  const [goalCalOpen, setGoalCalOpen] = useState(false);
  const phone = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  const [raceName, setRaceName] = useState('');
  const [raceType, setRaceType] = useState('Run');
  const [distanceKm, setDistanceKm] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [location, setLocation] = useState('');
  const [regUrl, setRegUrl] = useState('');
  const [triSwim, setTriSwim] = useState('');
  const [triBike, setTriBike] = useState('');
  const [triRun, setTriRun] = useState('');
  const [hyroxCategory, setHyroxCategory] = useState('Men');
  const [crossfitFormat, setCrossfitFormat] = useState('Open');
  const [goalFinishTime, setGoalFinishTime] = useState('');
  const [customDisciplines, setCustomDisciplines] = useState<{ name: string; distance: string }[]>([{ name: '', distance: '' }]);
  const [addingRace, setAddingRace] = useState(false);
  const [addRaceError, setAddRaceError] = useState('');
  const [searchingLink, setSearchingLink] = useState(false);
  const [searchLinkError, setSearchLinkError] = useState('');
  // Brief true right after a successful search — drives the "found" pulse
  // on the status line instead of the text just silently swapping.
  const [linkJustFound, setLinkJustFound] = useState(false);
  // Up to 3 candidates from the search — ambiguous names (two clubs, last
  // year's vs this year's event) get resolved by the user picking, instead
  // of the model silently committing to one.
  const [linkCandidates, setLinkCandidates] = useState<LinkCandidate[]>([]);
  // Collapsed by default — the best guess auto-fills, this just reveals the
  // other matches if that guess turns out wrong.
  const [showLinkAlternatives, setShowLinkAlternatives] = useState(false);
  // True once `location` holds a value the user typed themselves, rather
  // than one a search auto-filled. Only a user-typed location is a genuine
  // disambiguation hint — feeding an auto-filled one into the next search
  // (for a different event) biases it toward the previous event's location.
  const [locationIsUserHint, setLocationIsUserHint] = useState(false);

  function eventSummaryLabel(): string {
    if (raceType === 'HYROX') {
      const gender = hyroxGenderOf(hyroxCategory);
      const fmt = HYROX_FORMATS[gender].find(f => f.value === hyroxCategory);
      return `HYROX — ${gender} ${fmt?.label ?? ''}`.trim();
    }
    if (raceType === 'CrossFit') return `CrossFit — ${crossfitFormat}`;
    if (raceType === 'Triathlon' || raceType === 'Custom') {
      const d = computedDistance();
      return d > 0 ? `${raceType} · ${d.toFixed(1)} km` : raceType;
    }
    const d = parseFloat(distanceKm) || 0;
    return d > 0 ? `${d} km ${raceType}` : raceType;
  }

  function computedDistance(): number {
    if (raceType === 'Triathlon') return (parseFloat(triSwim) || 0) + (parseFloat(triBike) || 0) + (parseFloat(triRun) || 0);
    if (raceType === 'HYROX') return 8;
    if (raceType === 'CrossFit') return 0;
    if (raceType === 'Custom') return customDisciplines.reduce((s, d) => s + (parseFloat(d.distance) || 0), 0);
    return parseFloat(distanceKm) || 0;
  }

  function buildDisciplines(): { name: string; distance_km: number }[] | null {
    if (raceType === 'Triathlon') return [
      { name: 'Swim', distance_km: parseFloat(triSwim) || 0 },
      { name: 'Bike', distance_km: parseFloat(triBike) || 0 },
      { name: 'Run', distance_km: parseFloat(triRun) || 0 },
    ];
    if (raceType === 'HYROX') return [{ name: hyroxCategory, distance_km: 0 }];
    if (raceType === 'CrossFit') return [{ name: crossfitFormat, distance_km: 0 }];
    if (raceType === 'Custom') return customDisciplines.filter(d => d.name.trim()).map(d => ({ name: d.name.trim(), distance_km: parseFloat(d.distance) || 0 }));
    return null;
  }

  function addCustomDiscipline() { setCustomDisciplines(prev => [...prev, { name: '', distance: '' }]); }
  function updateCustomDiscipline(index: number, field: 'name' | 'distance', value: string) {
    setCustomDisciplines(prev => prev.map((d, i) => i === index ? { ...d, [field]: value } : d));
  }
  function removeCustomDiscipline(index: number) { setCustomDisciplines(prev => prev.filter((_, i) => i !== index)); }

  function isAddRaceValid(): boolean {
    if (!raceName.trim() || !raceDate || !displayToIsoDate(raceDate)) return false;
    if (raceType === 'Triathlon') return !!(triSwim || triBike || triRun);
    if (raceType === 'HYROX' || raceType === 'CrossFit') return true;
    if (raceType === 'Custom') return customDisciplines.some(d => d.name.trim());
    return !!distanceKm;
  }

  function closeAddRace() {
    setShowAddRace(false);
    setAddRaceError('');
    setRaceName(''); setRaceType('Run'); setDistanceKm(''); setRaceDate('');
    setLocation(''); setRegUrl(''); setTriSwim(''); setTriBike(''); setTriRun('');
    setHyroxCategory('Men'); setCrossfitFormat('Open'); setGoalFinishTime('');
    setCustomDisciplines([{ name: '', distance: '' }]);
    setSearchLinkError('');
    setLocationIsUserHint(false);
  }

  // Saves the "open a new tab, google it, copy the link back" trip — one
  // web-search-backed lookup for the official registration page.
  // Shared by the auto-picked top match and manually choosing from "See
  // others" — searching again (e.g. for a different event) always refreshes
  // location/date/type/distance to match the new candidate, clearing a field
  // rather than leaving it if this candidate doesn't confidently know it —
  // otherwise an omitted field silently keeps showing the previous event's
  // value instead of reading as "unknown."
  function applyCandidateDetails(c: LinkCandidate) {
    setRegUrl(c.url);
    setLocation(c.location ?? '');
    setLocationIsUserHint(false);
    setRaceDate((c.date && isoToDisplayDate(c.date)) || '');
    const type = c.type ?? 'Run';
    setRaceType(type);
    if (type === 'Triathlon' && c.triathlon_km) {
      setTriSwim(String(c.triathlon_km.swim));
      setTriBike(String(c.triathlon_km.bike));
      setTriRun(String(c.triathlon_km.run));
      setDistanceKm('');
    } else {
      setTriSwim(''); setTriBike(''); setTriRun('');
      setDistanceKm(c.distance_km ? String(c.distance_km) : '');
    }
    setLinkJustFound(true);
    setTimeout(() => setLinkJustFound(false), 900);
  }

  async function searchRegistrationLink() {
    if (!raceName.trim()) {
      setSearchLinkError('Enter an event name first.');
      return;
    }
    setSearchingLink(true);
    setSearchLinkError('');
    setLinkCandidates([]);
    setShowLinkAlternatives(false);
    const { data, error: searchError } = await supabase.functions.invoke('find-race-link', {
      body: { name: raceName.trim(), location: (locationIsUserHint && location.trim()) || undefined },
    });
    if (searchError || data?.error) {
      // supabase-js throws on any non-2xx without reading the body — our
      // own error detail (e.g. "Search 502: ...") lives unread on
      // error.context, so the message otherwise falls back to a generic
      // "Edge Function returned a non-2xx status code" no matter what
      // actually failed server-side.
      let message = data?.error || searchError?.message || 'Search failed';
      const context = (searchError as { context?: Response })?.context;
      if (context?.json) {
        try {
          const body = await context.json();
          if (body?.error) message = body.error;
        } catch { /* body wasn't JSON — keep the generic message */ }
      }
      setSearchLinkError(message);
      setSearchingLink(false);
      return;
    }
    const candidates: LinkCandidate[] = data?.candidates ?? [];
    if (candidates.length === 0) {
      // regUrl may already be set from an earlier search — a "not found" on
      // a re-search shouldn't read as if that result vanished too.
      setSearchLinkError(regUrl
        ? "Couldn't confirm a better match — left your current website as-is."
        : "No website found — check the spelling or try Search again. It's optional either way.");
    } else {
      // Auto-fill the top match rather than making the user choose up front —
      // the rest stay one tap away (collapsed) in case it's wrong.
      applyCandidateDetails(candidates[0]);
      if (candidates.length > 1) setLinkCandidates(candidates);
    }
    setSearchingLink(false);
  }

  function chooseLinkCandidate(c: LinkCandidate) {
    applyCandidateDetails(c);
    setShowLinkAlternatives(false);
  }

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
    if (!name.trim()) {
      setError('Enter a team name.');
      return;
    }

    let goalTargetIso: string | null = null;
    if (teamGoalMode) {
      if (!goalTarget.trim() || Number(goalTarget) <= 0) {
        setError('Enter a target to aim for.');
        return;
      }
      goalTargetIso = displayToIsoDate(goalTargetDate);
      if (!goalTargetIso) {
        setError('Enter a valid target date (DD/MM/YYYY).');
        return;
      }
    }

    setLoading(true);
    setError('');

    const { data: { user } } = await getAuthUser();
    if (!user) {
      setError('Sign in to continue.');
      setLoading(false);
      return;
    }

    // A retry after a crest-generation failure already has a league — don't
    // recreate it, just retry the crest itself below.
    let currentLeagueId = leagueId;

    if (!currentLeagueId) {
      setLoadingLabel('Creating team…');
      const inviteCode = generateInviteCode();

      // Generate the id client-side instead of relying on .select() to hand
      // it back after insert — leagues_select requires either is_private=false
      // or an active league_members row, neither of which exists yet at the
      // instant of insert for a private team, so PostgREST's post-insert
      // representation comes back empty (no error, just no row).
      const newLeagueId = crypto.randomUUID();

      const { error: leagueError } = await supabase
        .from('leagues')
        .insert({
          id: newLeagueId,
          name: name.trim(),
          created_by: user.id,
          is_private: isPrivate,
          invite_code: inviteCode,
          race_id: teamGoalMode ? null : selectedRaceId,
          goal_metric: teamGoalMode ? goalMetric : null,
          goal_target: teamGoalMode ? Number(goalTarget) : null,
          goal_target_date: teamGoalMode ? goalTargetIso : null,
        });

      if (leagueError) {
        console.log('League error:', JSON.stringify(leagueError));
        setError("Couldn't create the team. Try again.");
        setLoading(false);
        return;
      }

      const { error: memberError } = await supabase.from('league_members').insert({
        league_id: newLeagueId,
        user_id: user.id,
        role: 'admin',
      });

      if (memberError) {
        console.log('League member error:', JSON.stringify(memberError));
        setError("The team was created, but admin access couldn't be assigned. Try again.");
        setLoading(false);
        return;
      }

      currentLeagueId = newLeagueId;
      setLeagueId(newLeagueId);
    }

    setLoadingLabel('Generating crest…');
    const { data, error: genError } = await supabase.functions.invoke('generate-team-crest', { body: { leagueId: currentLeagueId } });
    if (genError || data?.error) {
      setError(data?.error || genError?.message || 'Crest generation failed');
      setLoading(false);
      return;
    }

    setLoading(false);
    setCrestCandidates(data.urls);
  }

  async function chooseCrest(url: string) {
    if (!leagueId) return;
    setConfirmingCrest(true);
    setError('');
    const { error } = await supabase
      .from('leagues')
      .update({ logo_url: url, crest_generated_at: new Date().toISOString() })
      .eq('id', leagueId);
    setConfirmingCrest(false);
    if (error) {
      setError("Couldn't save the crest. Try again.");
      return;
    }
    setCrestCandidates(null);
    setRevealCrestUrl(url);
  }

  function enterTeam() {
    if (!leagueId) return;
    router.replace({ pathname: '/team-hub', params: { id: leagueId } });
  }

  async function saveAddRace() {
    if (!isAddRaceValid()) return;
    const isoDate = displayToIsoDate(raceDate);
    if (!isoDate) return;

    setAddingRace(true);
    setAddRaceError('');

    const { data: { user } } = await getAuthUser();
    if (!user) {
      setAddRaceError('Sign in to continue.');
      setAddingRace(false);
      return;
    }

    const payload = {
      name: raceName.trim(), race_type: raceType, distance_km: computedDistance(),
      race_date: isoDate, location: location.trim() || null,
      registration_url: regUrl.trim() || null, disciplines: buildDisciplines(),
      goal_finish_time: goalFinishTime.trim() || null,
    };

    const { data: newRace, error: raceError } = await supabase
      .from('races')
      .insert({ ...payload, user_id: user.id, is_public: true })
      .select('id, name, race_date, race_type')
      .single();

    if (raceError || !newRace) {
      setAddRaceError(raceError?.message || 'Failed to add event.');
      setAddingRace(false);
      return;
    }

    setMyRaces(prev => [...prev, newRace].sort((a, b) => a.race_date.localeCompare(b.race_date)));
    setSelectedRaceId(newRace.id);
    setAddingRace(false);
    closeAddRace();
  }

  return (
    <View style={[styles.root, phone && rb.page]}>
      {/* Phone: the blend, no background photo. */}
      {!phone && (
        <>
          <RivalFixedBackground
            source={require('../../assets/images/backgrounds/optimized/mountain-bikers-forest-trail.jpg')}
            focalPoint="40% 55%"
          />
          <View style={styles.scrim} />
        </>
      )}
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <RivalTopNav active="teams" />
        <ScrollView contentContainerStyle={phone ? [rb.content, { paddingBottom: 120 }] : styles.content}>
          <View style={phone ? undefined : styles.panel}>
            {crestCandidates ? (
              <View style={styles.revealBlock}>
                <Text style={styles.revealEyebrow}>Choose a Crest</Text>
                <Text style={styles.subtitle}>Three takes on {name.trim()} — choose the one that's your team.</Text>
                <View style={styles.crestPickRow}>
                  {crestCandidates.map((url, i) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.crestPickFrame}
                      onPress={() => chooseCrest(url)}
                      disabled={confirmingCrest}
                    >
                      <Image source={{ uri: url }} style={styles.crestPickImg} resizeMode="cover" />
                    </TouchableOpacity>
                  ))}
                </View>
                {confirmingCrest ? <Text style={styles.subtitle}>Saving…</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </View>
            ) : revealCrestUrl ? (
              <View style={styles.revealBlock}>
                <Text style={styles.revealEyebrow}>Team Crest</Text>
                <View style={styles.revealCrestFrame}>
                  <Image source={{ uri: revealCrestUrl }} style={styles.revealCrestImg} />
                </View>
                <Text style={styles.title}>{name.trim()}</Text>
                <Text style={styles.subtitle}>Generated uniquely for this team.</Text>
                <TouchableOpacity style={[styles.createButton, styles.revealEnterBtn]} onPress={enterTeam}>
                  <Text style={styles.createButtonText}>Enter Team</Text>
                </TouchableOpacity>
              </View>
            ) : phone ? (
            <>
              <GreyPageHead kicker="TEAMS" title="Create a team" sub="Fitness is better when it's shared." onBack={() => (router.canGoBack() ? router.back() : router.replace('/discover-leagues'))} />
              <GreyLabel>Team name</GreyLabel>
              <GreyField value={name} onChangeText={setName} placeholder="Half Marathon 2026" maxLength={40} autoFocus />
              {name.trim() ? <GreyNote>The crest is generated from this name.</GreyNote> : null}

              <GreyLabel>Who can join</GreyLabel>
              <GreyTiles
                columns={2}
                options={[
                  { value: 'public' as const, label: 'Public', icon: 'globe' as const },
                  { value: 'private' as const, label: 'Private', icon: 'lock' as const },
                ]}
                value={isPrivate ? 'private' : 'public'}
                onChange={(v) => setIsPrivate(v === 'private')}
              />
              <GreyNote>{isPrivate ? 'Invite only. Members join with a code.' : 'Anyone can find the team and ask to join.'}</GreyNote>

              <GreyLabel>Shared goal</GreyLabel>
              <GreyRows>
                <GreyRow icon="groups" label="No event" onPress={() => { setSelectedRaceId(null); setTeamGoalMode(false); }}>
                  {!teamGoalMode && selectedRaceId === null ? <RivalIcon name="check" size={17} color={RivalColors.accentText} /> : null}
                </GreyRow>
                {myRaces.map((rc) => (
                  <GreyRow key={rc.id} icon="race" label={rc.name} onPress={() => { setSelectedRaceId(rc.id); setTeamGoalMode(false); }}>
                    {!teamGoalMode && selectedRaceId === rc.id ? <RivalIcon name="check" size={17} color={RivalColors.accentText} /> : (
                      <Text style={pm.rowMeta}>{new Date(`${rc.race_date.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</Text>
                    )}
                  </GreyRow>
                ))}
                <GreyRow icon="target" label="Team target" onPress={() => { setTeamGoalMode(true); setSelectedRaceId(null); }}>
                  {teamGoalMode ? <RivalIcon name="check" size={17} color={RivalColors.accentText} /> : null}
                </GreyRow>
                <GreyRow icon="add" label="Add an event" onPress={() => setShowAddRace(true)}>
                  <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
                </GreyRow>
              </GreyRows>

              {teamGoalMode ? (
                <>
                  <GreyLabel>What counts</GreyLabel>
                  <GreyTiles
                    columns={3}
                    options={GOAL_METRICS.map((m) => ({ value: m.value, label: m.label.replace(/ \(.*\)/, '').replace(' Earned', '').replace(' Logged', '') }))}
                    value={goalMetric}
                    onChange={setGoalMetric}
                  />
                  <View style={{ height: 10 }} />
                  <GreyRows>
                    <GreyRow icon="target" label="Target">
                      <GreyRowInput value={goalTarget} onChangeText={setGoalTarget} placeholder="1000" keyboardType="decimal-pad" />
                    </GreyRow>
                    <GreyRow icon="calendar" label="Complete by" value={goalTargetDate ? friendlyDate(goalTargetDate) : ''} placeholder="Choose" onPress={() => setGoalCalOpen(true)} />
                  </GreyRows>
                  <Modal visible={goalCalOpen} transparent animationType="fade" onRequestClose={() => setGoalCalOpen(false)}>
                    <View style={{ flex: 1 }}>
                      <GreyCalendar
                        value={goalTargetDate ? displayToIsoDate(goalTargetDate) : null}
                        onChange={(iso) => { setGoalTargetDate(isoToDisplayDate(iso)); setGoalCalOpen(false); }}
                        onClose={() => setGoalCalOpen(false)}
                      />
                    </View>
                  </Modal>
                </>
              ) : null}

              {error ? <Text style={[styles.error, { marginTop: 10 }]}>{error}</Text> : null}
              <View style={{ height: 16 }} />
              <GreyPrimary label={loading ? loadingLabel : 'Create team'} busy={loading} disabled={loading} onPress={handleCreate} />
              <GreyNote>Every team receives a unique crest.</GreyNote>
            </>
            ) : (
            <>
            <View style={styles.header}>
              <Text style={styles.title}>Create a Team</Text>
              <Text style={styles.subtitle}>Fitness is better when it's shared.</Text>
            </View>

            <View style={styles.form}>
              <View>
                <Text style={styles.label}>Team Name</Text>
                <TextInput
                  style={[styles.input, nameFocused && styles.inputFocused]}
                  placeholder="Half Marathon 2026"
                  placeholderTextColor="rgba(219,193,185,0.4)"
                  value={name}
                  onChangeText={setName}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  maxLength={40}
                  autoFocus
                />
                {name.trim() ? (
                  <View style={styles.namePreviewHint}>
                    <RivalIcon name="ai" size={13} color={RivalColors.accentText} />
                    <Text style={styles.namePreviewHintText}>The crest is generated from this name.</Text>
                  </View>
                ) : null}
              </View>

              <View>
                <Text style={styles.label}>Privacy</Text>
                <View style={styles.segmented}>
                  <TouchableOpacity
                    style={[styles.segmentBtn, !isPrivate && styles.segmentBtnActive]}
                    onPress={() => setIsPrivate(false)}
                  >
                    <RivalIcon name="globe" size={18} color={!isPrivate ? RivalColors.onAccentFill : RivalColors.onSurfaceVariant} />
                    <Text style={[styles.segmentText, !isPrivate && styles.segmentTextActive]}>Public</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentBtn, isPrivate && styles.segmentBtnActive]}
                    onPress={() => setIsPrivate(true)}
                  >
                    <RivalIcon name="lock" size={18} color={isPrivate ? RivalColors.onAccentFill : RivalColors.onSurfaceVariant} />
                    <Text style={[styles.segmentText, isPrivate && styles.segmentTextActive]}>Private</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.privacyHint}>
                  {isPrivate ? 'Invite only. Members join with a code.' : 'Anyone can find and request to join.'}
                </Text>
              </View>

              <View>
                <Text style={styles.label}>Shared Goal (Optional)</Text>
                <Text style={styles.toggleSubtitle}>An event the team is training toward. Members keep individual goals while sharing the same finish line.</Text>
                <TouchableOpacity
                  style={[styles.pathCardWide, !teamGoalMode && selectedRaceId === null && styles.pathCardActive]}
                  onPress={() => { setSelectedRaceId(null); setTeamGoalMode(false); }}
                >
                  <View style={styles.pathIconWrap}>
                    <RivalIcon name="groups" size={16} color={RivalColors.accentText} />
                  </View>
                  <View style={styles.pathCardWideText}>
                    <Text style={styles.pathTitle}>No Event</Text>
                    <Text style={styles.pathDesc}>Train together without a shared event.</Text>
                  </View>
                </TouchableOpacity>
                {myRaces.length > 0 && (
                  <View style={styles.pathGrid}>
                    {myRaces.map(r => (
                      <TouchableOpacity
                        key={r.id}
                        style={[styles.pathCard, !teamGoalMode && selectedRaceId === r.id && styles.pathCardActive]}
                        onPress={() => { setSelectedRaceId(r.id); setTeamGoalMode(false); }}
                      >
                        <View style={styles.pathIconWrap}>
                          <RivalIcon name="race" size={16} color={RivalColors.accentText} />
                        </View>
                        <Text style={styles.pathTitle} numberOfLines={1}>{r.name}</Text>
                        <Text style={styles.pathDesc}>{new Date(`${r.race_date.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {/* Race list can be empty (nothing lined up yet) — always
                    offer a way to add one rather than just hiding the option.
                    Quick-add stays right here (see quickAddRace) instead of
                    sending people to /races and back. */}
                <TouchableOpacity style={styles.addEventBtn} onPress={() => setShowAddRace(true)}>
                  <RivalIcon name="add" size={16} color={RivalColors.accentText} />
                  <Text style={styles.addEventBtnText}>Add an Event</Text>
                </TouchableOpacity>

                {/* Team Target: a cumulative team-wide number instead of a
                    real dated race — see leagues_team_goal.sql. A separate
                    option from the race cards above, not a relabel of
                    "Add an Event" (that stays scoped to attaching a race). */}
                <TouchableOpacity
                  style={[styles.pathCardWide, styles.teamGoalCard, teamGoalMode && styles.pathCardActive]}
                  onPress={() => { setTeamGoalMode(true); setSelectedRaceId(null); }}
                >
                  <View style={styles.pathIconWrap}>
                    <RivalIcon name="target" size={16} color={RivalColors.accentText} />
                  </View>
                  <View style={styles.pathCardWideText}>
                    <Text style={styles.pathTitle}>Set a Team Target</Text>
                    <Text style={styles.pathDesc}>All member activity counts toward one shared target.</Text>
                  </View>
                </TouchableOpacity>

                {teamGoalMode && (
                  <>
                    <View style={styles.fieldPanelFull}>
                      <Text style={styles.panelLabel}>Metric</Text>
                      <View style={styles.typeRow}>
                        {GOAL_METRICS.map(m => (
                          <TouchableOpacity
                            key={m.value}
                            style={[styles.typeChip, goalMetric === m.value && styles.typeChipActive]}
                            onPress={() => setGoalMetric(m.value)}
                          >
                            <Text style={[styles.typeChipText, goalMetric === m.value && styles.typeChipTextActive]}>{m.label}</Text>
                          </TouchableOpacity>
                        ))}
                        <View style={styles.inlineTargetGroup}>
                          <Text style={styles.inlineTargetLabel}>Target</Text>
                          <TextInput
                            style={[styles.panelInput, styles.targetInput]}
                            placeholder="1000"
                            placeholderTextColor="rgba(219,193,185,0.4)"
                            value={goalTarget}
                            onChangeText={setGoalTarget}
                            keyboardType="decimal-pad"
                          />
                        </View>
                      </View>
                    </View>

                    <View style={styles.dateCard}>
                      <Text style={styles.panelLabel}>Complete By</Text>
                      <Text style={[styles.selectedDateText, !goalTargetDate && styles.selectedDateTextEmpty]}>
                        {formatSelectedDate(goalTargetDate)}
                      </Text>
                      <MonthCalendarPicker value={goalTargetDate} onChange={setGoalTargetDate} />
                    </View>
                  </>
                )}
              </View>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View>
              <TouchableOpacity
                style={[styles.createButton, loading && styles.createButtonDisabled]}
                onPress={handleCreate}
                disabled={loading}
              >
                <Text style={styles.createButtonText}>
                  {loading ? loadingLabel : 'Create Team'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.footerHint}>Every team receives a unique AI-generated crest.</Text>
            </View>
            </>
            )}

          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Plain conditional render instead of RN's <Modal> — on this web build
          Modal doesn't portal to a top-level overlay, it renders children
          in place inside whatever parent it's mounted under, so it was
          appearing nested (and blurred) inside the glass panel above instead
          of covering the screen. A manually fixed-position View is what
          actually produces a real overlay here (same class of RN-Web gap as
          RivalFixedBackground's img fix). */}
      {showAddRace && phone ? (
        // Phone: the grey Add event pop-up (the same one Events uses).
        <Modal visible transparent animationType="slide" onRequestClose={closeAddRace}>
          <View style={pm.backdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeAddRace} accessibilityLabel="Close" />
            <GreySheet
              kicker="NEW TEAM"
              title="Add an event"
              onClose={closeAddRace}
              footer={<>
                {addRaceError ? <Text style={[styles.error, { textAlign: 'center' }]}>{addRaceError}</Text> : null}
                <GreyPrimary label={addingRace ? 'Adding…' : 'Add event'} busy={addingRace} disabled={!isAddRaceValid() || addingRace} onPress={saveAddRace} />
              </>}
              overlay={raceCalOpen ? (
                <GreyCalendar
                  value={raceDate ? displayToIsoDate(raceDate) : null}
                  onChange={(iso) => { setRaceDate(isoToDisplayDate(iso)); setRaceCalOpen(false); }}
                  onClose={() => setRaceCalOpen(false)}
                />
              ) : undefined}
            >
              <GreyLabel>Name</GreyLabel>
              <GreyField value={raceName} onChangeText={setRaceName} placeholder="Auckland Half Marathon" />
              <TouchableOpacity onPress={searchRegistrationLink} disabled={searchingLink || !raceName.trim()} style={pm.findLink}>
                <Text style={pm.findLinkText}>
                  {searchingLink ? 'Searching…' : searchLinkError ? searchLinkError : regUrl ? 'Website found. Search again' : 'Find the website'}
                </Text>
              </TouchableOpacity>
              <GreyLabel>Type</GreyLabel>
              <GreyTiles
                options={RACE_TYPES.map((t) => ({ value: t, label: t, icon: RACE_TYPE_ICONS[t] }))}
                value={raceType}
                onChange={setRaceType}
              />
              {raceType === 'HYROX' ? (
                <>
                  <GreyLabel>Category</GreyLabel>
                  <GreyTiles columns={3} options={HYROX_GENDERS.map((g) => ({ value: g, label: g }))} value={hyroxGenderOf(hyroxCategory)} onChange={(g) => setHyroxCategory(HYROX_FORMATS[g][0].value)} />
                  <View style={{ height: 8 }} />
                  <GreyTiles columns={3} options={HYROX_FORMATS[hyroxGenderOf(hyroxCategory)].map((f) => ({ value: f.value, label: f.label }))} value={hyroxCategory} onChange={setHyroxCategory} />
                </>
              ) : raceType === 'CrossFit' ? (
                <>
                  <GreyLabel>Format</GreyLabel>
                  <GreyTiles options={CROSSFIT_FORMATS.map((f) => ({ value: f, label: f }))} value={crossfitFormat} onChange={setCrossfitFormat} />
                </>
              ) : raceType === 'Triathlon' ? (
                <>
                  <GreyLabel>Disciplines</GreyLabel>
                  <GreyRows>
                    {([['swim', 'Swim', triSwim, setTriSwim, '1.9'], ['ride', 'Bike', triBike, setTriBike, '90'], ['run', 'Run', triRun, setTriRun, '21.1']] as const).map(([icon, label, val, setter, ph]) => (
                      <GreyRow key={label} icon={icon} label={label}>
                        <GreyRowInput value={val} onChangeText={setter} placeholder={`${ph} km`} keyboardType="decimal-pad" />
                      </GreyRow>
                    ))}
                  </GreyRows>
                </>
              ) : raceType === 'Custom' ? (
                <>
                  <GreyLabel>Disciplines</GreyLabel>
                  <GreyRows>
                    {customDisciplines.map((d, i) => (
                      <GreyRow key={i} icon="flag" label={`Part ${i + 1}`}>
                        <View style={pm.discRow}>
                          <GreyRowInput value={d.name} onChangeText={(v) => updateCustomDiscipline(i, 'name', v)} placeholder="Kayak" style={{ flex: 1 }} />
                          <GreyRowInput value={d.distance} onChangeText={(v) => updateCustomDiscipline(i, 'distance', v)} placeholder="km" keyboardType="decimal-pad" style={{ width: 54, flex: 0 }} />
                        </View>
                      </GreyRow>
                    ))}
                  </GreyRows>
                  <TouchableOpacity onPress={addCustomDiscipline} style={pm.findLink}><Text style={pm.findLinkText}>Add a part</Text></TouchableOpacity>
                </>
              ) : null}
              <GreyLabel>Details</GreyLabel>
              <GreyRows>
                <GreyRow icon="calendar" label="Date" value={raceDate ? friendlyDate(raceDate) : ''} placeholder="Required" onPress={() => setRaceCalOpen(true)} />
                {raceType !== 'Triathlon' && raceType !== 'HYROX' && raceType !== 'CrossFit' && raceType !== 'Custom' ? (
                  <GreyRow icon="distance" label="Distance">
                    <GreyRowInput value={distanceKm} onChangeText={setDistanceKm} placeholder="Optional" keyboardType="decimal-pad" />
                  </GreyRow>
                ) : null}
                <GreyRow icon="location" label="Location">
                  <GreyRowInput value={location} onChangeText={(v) => { setLocation(v); setLocationIsUserHint(true); }} placeholder="Optional" />
                </GreyRow>
                <GreyRow icon="link" label="Website">
                  <GreyRowInput value={regUrl} onChangeText={setRegUrl} placeholder="Optional" autoCapitalize="none" />
                </GreyRow>
                <GreyRow icon="flag" label="Goal time">
                  <GreyRowInput value={goalFinishTime} onChangeText={(v) => setGoalFinishTime(formatGoalTimeMask(v))} placeholder="Optional" keyboardType="number-pad" />
                </GreyRow>
              </GreyRows>
            </GreySheet>
          </View>
        </Modal>
      ) : showAddRace && (
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalCard}>
            {Platform.OS === 'web' ? (
              // @ts-ignore — intentional escape hatch to a real DOM element, same technique as RivalFixedBackground
              <img
                src={Asset.fromModule(MODAL_BG_SOURCE).uri}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: MODAL_BG_FOCAL_POINT, display: 'block' }}
              />
            ) : (
              <Image source={MODAL_BG_SOURCE} style={styles.modalCardBg} resizeMode="cover" />
            )}
            <View style={styles.modalCardScrim} />
            <View style={styles.modalHeaderRow}>
              <View>
                <Text style={styles.modalTitle}>Add an Event</Text>
                <Text style={styles.modalSubtitle}>A shared event for the team to train toward.</Text>
              </View>
              <TouchableOpacity onPress={closeAddRace} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <RivalIcon name="close" size={20} color={RivalColors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Live preview — builds itself as fields fill in below, instead
                of the page staying inert until you hit submit. Faint
                oversized type-icon watermark gives each race a visual
                identity at a glance, before you've even read the name. */}
            <View style={styles.previewCard}>
              <RivalIcon
                name={RACE_TYPE_ICONS[raceType]}
                size={108}
                color={RivalColors.accentFill}
                style={styles.previewWatermark}
              />

              <Text style={[styles.previewName, styles.previewCenterText]} numberOfLines={2}>{raceName.trim() || 'Untitled Event'}</Text>

              {daysRemaining(raceDate) !== null && (
                <View style={[styles.previewCountdownGlass, styles.previewCountdownGlassBelowName]}>
                  <Text style={styles.previewCountdownNum}>{Math.max(0, daysRemaining(raceDate)!)}</Text>
                  <Text style={styles.previewCountdownLabel}>{daysRemaining(raceDate) === 1 ? 'Day' : 'Days'}</Text>
                  <Text style={styles.previewCountdownLabel}>Remaining</Text>
                </View>
              )}

              <Text style={[styles.previewSubtitle, styles.previewCenterText]} numberOfLines={1}>
                {[
                  raceDate ? formatSelectedDate(raceDate) : 'Date not set yet',
                  location.trim() ? capFirst(location.trim()) : null,
                  eventSummaryLabel(),
                ].filter(Boolean).join('  ·  ')}
              </Text>

              {goalFinishTime.trim() ? (
                <View style={styles.previewGoalTag}>
                  <RivalIcon name="target" size={11} color={RivalColors.accentText} />
                  <Text style={styles.previewProgressGoalText}>Goal: {goalFinishTime.trim()}</Text>
                </View>
              ) : null}
            </View>

            {/* Search leads the form — it's what auto-fills the rest, so it
                comes before any manual field, not buried next to Website
                where it used to live. One bar, not two panels — Event Name
                doubles as the search query, so the button lives right in the
                input instead of a separately-bordered "action" beside it. */}
            <View style={styles.fieldPanelFull}>
              <Text style={styles.panelLabel}>Event Name</Text>
              <View style={styles.searchBarRow}>
                <TextInput
                  style={[styles.panelInput, styles.searchBarInput]}
                  placeholder="Auckland Half Marathon"
                  placeholderTextColor="rgba(219,193,185,0.4)"
                  value={raceName}
                  onChangeText={setRaceName}
                />
                <TouchableOpacity style={styles.searchBarBtn} onPress={searchRegistrationLink} disabled={searchingLink}>
                  <RivalIcon name="search" size={16} color={RivalColors.onAccentFill} />
                  <BusyText busy={!!(searchingLink)} style={styles.searchBarBtnText}>{searchingLink ? 'Searching…' : 'Search'}</BusyText>
                </TouchableOpacity>
              </View>
              <View style={styles.searchStatusRow}>
                <Text style={[styles.searchPanelStatus, linkJustFound && styles.searchPanelStatusFound]} numberOfLines={1}>
                  {searchingLink ? 'Searching…' : searchLinkError ? searchLinkError : regUrl ? '✓ Website found' : 'Search fills in the website automatically'}
                </Text>
                {linkCandidates.length > 0 && (
                  <TouchableOpacity onPress={() => setShowLinkAlternatives(v => !v)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={styles.linkAlternativesToggle} numberOfLines={1}>
                      {showLinkAlternatives ? 'Hide other matches' : 'See other matches'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {showLinkAlternatives && linkCandidates.length > 0 && (
                <View style={styles.linkCandidateList}>
                  {linkCandidates.map(c => (
                    <TouchableOpacity key={c.url} style={[styles.linkCandidateRow, c.url === regUrl && styles.linkCandidateRowActive]} onPress={() => chooseLinkCandidate(c)}>
                      <Text style={styles.linkCandidateLabel} numberOfLines={1}>{c.url === regUrl ? '✓ ' : ''}{c.label}</Text>
                      <Text style={styles.linkCandidateUrl} numberOfLines={1}>{c.url}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={[styles.panelLabel, { marginTop: 14 }]}>Website (Optional)</Text>
              {/* Search picks its best guess, but it isn't always right (see
                  the Priority #1 rule above) — a one-tap way to actually
                  check the link before trusting it beats making someone
                  copy-paste it into a new tab themselves. */}
              <View style={styles.searchBarRow}>
                <TextInput
                  style={[styles.panelInput, styles.searchBarInput]}
                  placeholder="https://…"
                  placeholderTextColor="rgba(219,193,185,0.4)"
                  value={regUrl}
                  onChangeText={setRegUrl}
                  autoCapitalize="none"
                />
                {regUrl.trim() ? (
                  <TouchableOpacity
                    style={styles.openLinkBtn}
                    onPress={() => Linking.openURL(regUrl.trim())}
                    accessibilityLabel="Open website in a new tab"
                  >
                    <RivalIcon name="openInNew" size={18} color={RivalColors.accentText} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <View style={styles.bentoRow}>
              <View style={[styles.fieldPanel, styles.fieldPanelHalf]}>
                <Text style={styles.panelLabel}>Location (Optional)</Text>
                <TextInput
                  style={styles.panelInput}
                  placeholder="Auckland, NZ"
                  placeholderTextColor="rgba(219,193,185,0.4)"
                  value={location}
                  onChangeText={v => { setLocation(v); setLocationIsUserHint(true); }}
                />
              </View>
              <View style={[styles.fieldPanel, styles.fieldPanelHalf]}>
                <Text style={styles.panelLabel}>Goal Finish Time (Optional)</Text>
                <TextInput
                  style={[styles.panelInput, styles.targetInput]}
                  placeholder="00:00:00"
                  placeholderTextColor="rgba(219,193,185,0.4)"
                  value={goalFinishTime}
                  onChangeText={v => setGoalFinishTime(formatGoalTimeMask(v))}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                />
                <View style={styles.goalTimeHintRow}>
                  {goalFinishTime.trim() ? <RivalIcon name="target" size={12} color={RivalColors.textSecondary} /> : null}
                  <Text style={styles.goalTimeHint} numberOfLines={2}>
                    {goalFinishTime.trim()
                      ? `Aiming for ${goalFinishTime.trim()}.`
                      : "Set a time to aim for."}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.bentoRow}>
            <View style={[styles.fieldPanel, styles.fieldPanelHalf]}>
              <Text style={styles.panelLabel}>Type</Text>
              <View style={styles.typeRow}>
                {RACE_TYPES.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeChip, raceType === t && styles.typeChipActive]}
                    onPress={() => setRaceType(t)}
                  >
                    <RivalIcon name={RACE_TYPE_ICONS[t]} size={14} color={raceType === t ? RivalButtonColors.label(RivalColors.onAccentFill) : RivalColors.onSurfaceVariant} />
                    <Text style={[styles.typeChipText, raceType === t && styles.typeChipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {raceType !== 'Triathlon' && raceType !== 'HYROX' && raceType !== 'CrossFit' && raceType !== 'Custom' && (
                <>
                  <Text style={[styles.panelLabel, { marginTop: 16 }]}>Distance (km)</Text>
                  <TextInput
                    style={styles.panelInput}
                    placeholder="21.1"
                    placeholderTextColor="rgba(219,193,185,0.4)"
                    value={distanceKm}
                    onChangeText={setDistanceKm}
                    keyboardType="decimal-pad"
                  />
                  {POPULAR_DISTANCES[raceType] && (
                    <View style={styles.popularDistanceRow}>
                      {POPULAR_DISTANCES[raceType].map(d => (
                        <TouchableOpacity
                          key={d}
                          style={[styles.popularDistanceChip, parseFloat(distanceKm) === d && styles.typeChipActive]}
                          onPress={() => setDistanceKm(String(d))}
                        >
                          <Text style={[styles.popularDistanceChipText, parseFloat(distanceKm) === d && styles.typeChipTextActive]}>{d}km</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              )}

              {raceType === 'Triathlon' && (
                <>
                  <Text style={[styles.panelLabel, { marginTop: 16 }]}>Disciplines</Text>
                  {([['swim', 'Swim (km)', triSwim, setTriSwim, '1.9'], ['ride', 'Bike (km)', triBike, setTriBike, '90'], ['run', 'Run (km)', triRun, setTriRun, '21.1']] as const).map(([icon, label, val, setter, ph]) => (
                    <View key={label} style={styles.disciplineRow}>
                      <RivalIcon name={icon} size={14} color={RivalColors.accentText} />
                      <Text style={styles.disciplineLabel}>{label}</Text>
                      <TextInput style={[styles.panelInput, styles.disciplineInput]} placeholder={ph} placeholderTextColor="rgba(219,193,185,0.4)" value={val} onChangeText={setter} keyboardType="decimal-pad" />
                    </View>
                  ))}
                  {computedDistance() > 0 && <Text style={styles.distanceSummary}>Total: {computedDistance().toFixed(1)} km</Text>}
                </>
              )}

              {raceType === 'Custom' && (
                <>
                  <Text style={[styles.panelLabel, { marginTop: 16 }]}>Disciplines</Text>
                  {customDisciplines.map((d, i) => (
                    <View key={i} style={styles.customDisciplineRow}>
                      <TextInput style={[styles.panelInput, { flex: 1, minWidth: 0 }]} placeholder="Kayak" placeholderTextColor="rgba(219,193,185,0.4)" value={d.name} onChangeText={v => updateCustomDiscipline(i, 'name', v)} />
                      <TextInput style={[styles.panelInput, styles.disciplineInput]} placeholder="km" placeholderTextColor="rgba(219,193,185,0.4)" value={d.distance} onChangeText={v => updateCustomDiscipline(i, 'distance', v)} keyboardType="decimal-pad" />
                      {customDisciplines.length > 1 && (
                        <TouchableOpacity onPress={() => removeCustomDiscipline(i)}>
                          <RivalIcon name="close" size={18} color={RivalColors.textSecondary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity style={styles.addDisciplineBtn} onPress={addCustomDiscipline}>
                    <Text style={styles.addEventBtnText}>+ Add discipline</Text>
                  </TouchableOpacity>
                  {computedDistance() > 0 && <Text style={styles.distanceSummary}>Total: {computedDistance().toFixed(1)} km</Text>}
                </>
              )}

              {raceType === 'HYROX' && (
                <>
                  <Text style={[styles.panelLabel, { marginTop: 16 }]}>Category</Text>
                  <View style={styles.typeRow}>
                    {HYROX_GENDERS.map(g => (
                      <TouchableOpacity
                        key={g}
                        style={[styles.typeChip, hyroxGenderOf(hyroxCategory) === g && styles.typeChipActive]}
                        onPress={() => setHyroxCategory(HYROX_FORMATS[g][0].value)}
                      >
                        <Text style={[styles.typeChipText, hyroxGenderOf(hyroxCategory) === g && styles.typeChipTextActive]}>{g}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[styles.panelLabel, { marginTop: 12 }]}>Format</Text>
                  <View style={styles.typeRow}>
                    {HYROX_FORMATS[hyroxGenderOf(hyroxCategory)].map(f => (
                      <TouchableOpacity key={f.value} style={[styles.typeChip, hyroxCategory === f.value && styles.typeChipActive]} onPress={() => setHyroxCategory(f.value)}>
                        <Text style={[styles.typeChipText, hyroxCategory === f.value && styles.typeChipTextActive]}>{f.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {raceType === 'CrossFit' && (
                <>
                  <Text style={[styles.panelLabel, { marginTop: 16 }]}>Format</Text>
                  <View style={styles.typeRow}>
                    {CROSSFIT_FORMATS.map(f => (
                      <TouchableOpacity key={f} style={[styles.typeChip, crossfitFormat === f && styles.typeChipActive]} onPress={() => setCrossfitFormat(f)}>
                        <Text style={[styles.typeChipText, crossfitFormat === f && styles.typeChipTextActive]}>{f}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </View>

            <View style={[styles.fieldPanel, styles.fieldPanelHalf]}>
              <Text style={styles.panelLabel}>Event Date</Text>
              <Text style={[styles.selectedDateText, !raceDate && styles.selectedDateTextEmpty]}>
                {formatSelectedDate(raceDate)}
              </Text>
              {daysRemaining(raceDate) !== null && (
                <Text style={styles.dateCardCountdown}>
                  {Math.max(0, daysRemaining(raceDate)!)} {daysRemaining(raceDate) === 1 ? 'day' : 'days'} remaining
                </Text>
              )}
              <MonthCalendarPicker value={raceDate} onChange={setRaceDate} />
            </View>
            </View>

            {addRaceError ? <Text style={[styles.error, { marginTop: 16 }]}>{addRaceError}</Text> : null}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={closeAddRace}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, (!isAddRaceValid() || addingRace) && styles.createButtonDisabled]}
                onPress={saveAddRace}
                disabled={!isAddRaceValid() || addingRace}
              >
                <BusyText busy={!!(addingRace)} style={styles.createButtonText}>{addingRace ? 'Adding…' : 'Add Event'}</BusyText>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// Phone Add event pop-up.
const pm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  findLink: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 4 },
  findLinkText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
  discRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rowMeta: { fontSize: 13, color: RivalColors.textSecondary },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  scrim: { position: 'fixed' as any, top: 0, left: 0, right: 0, height: '100vh' as any, backgroundColor: 'rgba(14,14,14,0.55)' },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, maxWidth: 620, width: '100%', alignSelf: 'center', flexGrow: 1, justifyContent: 'center' },

  panel: {
    backgroundColor: 'rgba(27,27,27,0.65)',
    borderRadius: RivalRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 32,
    gap: 24,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(24px)' } as any : {}),
  },

  header: { alignItems: 'center', gap: 6 },
  title: { ...RivalType.headlineLg, fontSize: 30, lineHeight: 36, color: RivalColors.textPrimary, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 },
  subtitle: { ...RivalType.bodyLg, fontSize: 15, color: RivalColors.textSecondary },

  form: { gap: 20 },
  label: { ...RivalType.labelCaps, color: RivalColors.accentText, marginBottom: 8 },
  toggleSubtitle: { fontSize: 12, color: RivalColors.textSecondary, marginTop: -4, marginBottom: 10 },
  privacyHint: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 8 },

  input: {
    backgroundColor: 'rgba(14,14,14,0.5)',
    borderRadius: RivalRadius.DEFAULT,
    borderWidth: 1,
    borderColor: 'rgba(85,67,61,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    ...RivalType.titleMd,
    fontSize: 16,
    color: RivalColors.textPrimary,
    // RN Web still lets the browser paint its own default focus ring on top
    // of our custom one unless outlineStyle is explicitly killed.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  inputFocused: {
    borderColor: RivalColors.accentFill,
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 15px rgba(217,119,87,0.3)' } as any : {}),
  },
  namePreviewHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  namePreviewHintText: { fontSize: 12, color: RivalColors.textSecondary, flexShrink: 1 },

  segmented: { flexDirection: 'row', backgroundColor: 'rgba(14,14,14,0.5)', padding: 6, borderRadius: RivalRadius.md, borderWidth: 1, borderColor: 'rgba(85,67,61,0.2)' },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: RivalRadius.DEFAULT },
  segmentBtnActive: { backgroundColor: RivalColors.accentText },
  segmentText: { ...RivalType.titleMd, fontSize: 13, color: RivalColors.onSurfaceVariant },
  segmentTextActive: { color: RivalColors.onAccentFill },

  pathCardWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(85,67,61,0.3)',
    borderRadius: RivalRadius.md,
    padding: 10,
    marginBottom: 8,
    ...(Platform.OS === 'web' ? { transitionProperty: 'transform, background-color', transitionDuration: '150ms' } as any : {}),
  },
  pathCardWideText: { flex: 1, gap: 2 },
  pathGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pathCard: {
    flexGrow: 1,
    minWidth: 140,
    borderWidth: 1,
    borderColor: 'rgba(85,67,61,0.3)',
    borderRadius: RivalRadius.md,
    padding: 10,
    gap: 3,
    ...(Platform.OS === 'web' ? { transitionProperty: 'transform, background-color', transitionDuration: '150ms' } as any : {}),
  },
  pathCardActive: { borderColor: RivalColors.accentFill, backgroundColor: 'rgba(217,119,87,0.08)' },
  pathIconWrap: { width: 28, height: 28, borderRadius: RivalRadius.full, backgroundColor: RivalColors.surfaceBright, alignItems: 'center', justifyContent: 'center' },
  pathTitle: { ...RivalType.titleMd, fontSize: 13, color: RivalColors.textPrimary, textTransform: 'uppercase' },
  pathDesc: { fontSize: 11, color: RivalColors.onSurfaceVariant, opacity: 0.8, lineHeight: 14 },

  addEventBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 12, borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.15)' },
  addEventBtnText: { ...RivalType.labelCaps, fontSize: 12, color: RivalColors.accentText },
  teamGoalCard: { marginTop: 16, marginBottom: 0 },

  error: { color: RivalColors.error, fontSize: 13 },

  createButton: {
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
    paddingVertical: 18,
    borderRadius: RivalRadius.lg,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 30px rgba(217,119,87,0.2)' } as any : {}),
  },
  createButtonDisabled: { opacity: 0.5 },
  createButtonText: { ...RivalType.titleMd, fontSize: 15, color: RivalButtonColors.label(RivalColors.onAccentFill), textTransform: 'uppercase', letterSpacing: 1.5 },
  footerHint: { ...RivalType.labelCaps, fontSize: 13, letterSpacing: 0.3, color: RivalColors.onSurfaceVariant, opacity: 0.6, textAlign: 'center', marginTop: 14 },

  // Crest reveal — shown once, right after creation, before the team feed.
  revealBlock: { alignItems: 'center', gap: 10 },
  // revealBlock centers its children (shrink-wraps width) — without this the
  // button hugs "Enter Team" instead of stretching full-width like the main
  // Create Team button, which is what made it look cramped/different.
  revealEnterBtn: { width: '100%', marginTop: 10 },
  revealEyebrow: { ...RivalType.labelCaps, color: RivalColors.accentText },
  revealCrestFrame: {
    width: 200,
    height: 200,
    borderRadius: RivalRadius.lg,
    borderWidth: 2,
    borderColor: RivalColors.accentFill,
    overflow: 'hidden',
    marginVertical: 8,
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 40px rgba(217,119,87,0.35)' } as any : {}),
  },
  revealCrestImg: { width: '100%', height: '100%' },

  crestPickRow: { flexDirection: 'row', gap: 10, marginVertical: 8 },
  crestPickFrame: {
    width: 100,
    height: 100,
    borderRadius: RivalRadius.lg,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  crestPickImg: { width: '100%', height: '100%' },

  // RN Web's Modal portal renders with `position: absolute`, inheriting
  // whatever position it happens to land at in the DOM rather than covering
  // the viewport — same class of bug as RivalFixedBackground's img fix.
  // Forcing `fixed` here is what actually makes it a full-screen overlay.
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20, ...(Platform.OS === 'web' ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 } as any : {}) },
  modalScroll: { width: '100%', maxWidth: 680, maxHeight: '88%', borderRadius: RivalRadius.lg, ...(Platform.OS === 'web' ? { flexGrow: 0 } as any : {}) },
  modalCard: { backgroundColor: RivalColors.surfaceBright, borderRadius: RivalRadius.lg, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 14, overflow: 'hidden', position: 'relative' },
  // Photo sits behind all modal content, dimmed enough that fields/text stay
  // legible — same glass-panel-over-photo language as the page itself.
  modalCardBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  modalCardScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,18,16,0.82)' },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  modalTitle: { ...RivalType.titleMd, fontSize: 20, color: RivalColors.textPrimary, marginBottom: 4 },
  modalSubtitle: { fontSize: 12, color: RivalColors.textSecondary, maxWidth: 360, lineHeight: 16 },

  // Bento-style bordered panels (stitch-export-21) — every field group sits
  // in its own card instead of a bare label-over-input stack, and search
  // leads the form since it auto-fills most of what follows.
  bentoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fieldPanel: { backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 14, gap: 8 },
  fieldPanelFull: { backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 14, gap: 8 },
  // Sized to hug the calendar itself instead of stretching a full-width card
  // around a narrower widget — that left dead space in the gutters on both
  // sides. Centered contents so the label/date line up with the grid below.
  dateCard: { backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 14, gap: 8, width: '60%', minWidth: 260, alignSelf: 'center', alignItems: 'center', marginTop: 14 },
  fieldPanelHalf: { flexGrow: 1, flexBasis: 180 },
  // Event Name doubles as the search query — one bar, input + button docked
  // at the trailing edge, instead of two separately-bordered panels.
  searchBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBarInput: { flex: 1 },
  // Icon + label, not icon-only — an icon-only square next to the input was
  // too easy to miss and skip straight to typing the website in by hand.
  searchBarBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: RivalRadius.DEFAULT },
  searchBarBtnText: { fontSize: 13, fontWeight: '700', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  openLinkBtn: { height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: 'rgba(217,119,87,0.4)' },
  panelLabel: { ...RivalType.labelCaps, fontSize: 11, color: RivalColors.onSurfaceVariant, opacity: 0.8 },
  panelInput: {
    backgroundColor: 'rgba(14,14,14,0.5)',
    borderRadius: RivalRadius.DEFAULT,
    borderWidth: 1,
    borderColor: 'rgba(85,67,61,0.3)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: RivalColors.textPrimary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  selectedDateText: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  // A target is a short number — stretching it full-width like Event Name or
  // a URL looked oversized for what it actually holds.
  targetInput: { width: 110, paddingVertical: 8 },
  inlineTargetGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineTargetLabel: { ...RivalType.labelCaps, fontSize: 11, color: RivalColors.accentText },
  selectedDateTextEmpty: { fontWeight: '400', color: RivalColors.textSecondary },
  searchStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 },
  searchPanelStatus: { flexShrink: 1, fontSize: 11, color: RivalColors.textSecondary, lineHeight: 14, ...(Platform.OS === 'web' ? { transitionProperty: 'color', transitionDuration: '200ms' } as any : {}) },
  searchPanelStatusFound: { color: RivalColors.accentText, fontWeight: '700' },
  linkAlternativesToggle: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  linkCandidateList: { marginTop: 8, gap: 6 },
  linkCandidateRow: { backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: 'rgba(85,67,61,0.3)', paddingHorizontal: 12, paddingVertical: 9 },
  linkCandidateRowActive: { borderColor: RivalColors.accentFill, borderWidth: 1.5 },
  linkCandidateLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textPrimary },
  linkCandidateUrl: { fontSize: 11, color: RivalColors.textSecondary, marginTop: 1 },

  // Popular distance quick-picks under the plain Distance field.
  popularDistanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  popularDistanceChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RivalRadius.full, borderWidth: 1, borderColor: 'rgba(85,67,61,0.3)' },
  popularDistanceChipText: { fontSize: 12, color: RivalColors.onSurfaceVariant, fontWeight: '600' },

  // Countdown shown right above the calendar — gives an otherwise-empty
  // widget context before you've picked a day.
  dateCardCountdown: { ...RivalType.labelCaps, fontSize: 11, color: RivalColors.accentText, marginTop: -2 },

  // Live preview card — builds itself as the form below fills in, instead of
  // the page staying inert until Add Event is pressed.
  // Barely tinted, not filled — stacked on top of the modal's own dark
  // scrim, even a light fill read as a near-solid box hiding the photo
  // behind it entirely. Just the border now carries the "this stands out"
  // signal.
  previewCard: { backgroundColor: 'rgba(70,32,16,0.55)', borderRadius: RivalRadius.lg, borderWidth: 1.5, borderColor: 'rgba(217,119,87,0.5)', paddingVertical: 18, paddingHorizontal: 8, marginTop: 16, marginHorizontal: 36, gap: 10, overflow: 'hidden' },
  // Oversized, low-opacity, rotated — a texture in the corner, not another
  // thing competing for attention. RN View defaults to position:'relative',
  // so this absolute layer paints below the (default-positioned) siblings
  // that follow it in the tree without needing an explicit zIndex.
  previewWatermark: { position: 'absolute', top: -20, right: -20, opacity: 0.14, transform: [{ rotate: '-12deg' }] },
  previewCenterText: { textAlign: 'center', alignSelf: 'center' },
  // Centered stack — matches stitch-export-22/23's ("Refined Ember" hero)
  // composition (countdown floating above a huge centered title, subtitle
  // line, then the progress bar) rather than the left-aligned icon-list this
  // replaced. Tracking on the name matches that hero's title treatment
  // (tracking-[0.5em]) directly rather than a scaled-down fraction of it.
  previewName: { ...RivalType.titleMd, fontSize: 30, lineHeight: 36, color: RivalColors.textPrimary, textTransform: 'uppercase', letterSpacing: 15 },
  previewSubtitle: { fontSize: 16, color: RivalColors.onSurfaceVariant, marginTop: 8 },
  // "Glass monolith" tile from stitch-export-22/23, condensed to card scale:
  // same recipe (near-transparent fill + backdrop blur + hairline border),
  // just a fraction of the blur radius and padding since it's not a
  // full-screen hero.
  previewCountdownGlass: {
    alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, paddingHorizontal: 32,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RivalRadius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)' } as any : {}),
  },
  previewCountdownGlassBelowName: { marginTop: 14 },
  previewCountdownNum: {
    ...RivalType.metricLarge, fontSize: 72, lineHeight: 74, fontWeight: '800', color: RivalColors.accentText,
  },
  previewCountdownLabel: { ...RivalType.labelCaps, fontSize: 12, color: RivalColors.textSecondary, lineHeight: 15 },
  // Dropped the progress-bar treatment stitch-export-22/23 used here — with
  // no real training-start timestamp to measure against, any fill position
  // was an arbitrary proxy with nothing behind it, and no amount of
  // labeling made "42% to race day" mean something real. The countdown
  // number above is the one honest metric this card has.
  previewGoalTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 14,
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: RivalRadius.full,
    backgroundColor: 'rgba(217,119,87,0.15)', borderWidth: 1, borderColor: 'rgba(217,119,87,0.4)',
  },
  previewProgressGoalText: { fontSize: 15, fontWeight: '700', color: RivalColors.accentText },

  // Week-strip date picker (stitch-export-21's "Calendar Marker") — a pick-a-
  // day widget under the text field instead of a bare YYYY-MM-DD box.
  // Capped width (roughly half the panel) instead of stretching full-width —
  // a 7-column day grid that wide made each cell oversized for what's just a
  // date picker, not the main focus of the form.
  calendarWidget: { marginTop: 10, gap: 6, width: '100%' },
  calendarHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarNavGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calendarMonthLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.textPrimary },
  calendarDaysRow: { flexDirection: 'row', gap: 2 },
  calendarDayLabel: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '700', color: RivalColors.textSecondary },
  calendarDayCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RivalRadius.sm, borderWidth: 1, borderColor: 'transparent' },
  calendarDayCellActive: { backgroundColor: 'rgba(217,119,87,0.15)', borderColor: RivalColors.accentFill },
  calendarDayNum: { fontSize: 11, color: RivalColors.onSurfaceVariant },
  calendarDayNumActive: { color: RivalColors.accentText, fontWeight: '700' },

  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // flexGrow + minWidth so a short chip ("Men") and a long one ("Doubles Pro
  // Women") both stretch to fill their row evenly instead of each sizing to
  // its own text — that's what read as "floating" in a narrow column, where
  // ragged chip widths left uneven gaps between rows.
  typeChip: { flexGrow: 1, minWidth: 84, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RivalRadius.full, borderWidth: 1, borderColor: 'rgba(85,67,61,0.3)' },
  typeChipActive: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: RivalButtonColors.fill },
  typeChipText: { fontSize: 13, color: RivalColors.onSurfaceVariant, fontWeight: '600' },
  typeChipTextActive: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  disciplineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  disciplineLabel: { flex: 1, fontSize: 14, color: RivalColors.onSurfaceVariant },
  disciplineInput: { width: 100 },
  customDisciplineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, overflow: 'hidden' },
  addDisciplineBtn: { marginTop: 10, alignSelf: 'flex-start' },
  distanceSummary: { fontSize: 13, color: RivalColors.accentText, fontWeight: '700', marginTop: 10 },
  goalTimeHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  goalTimeHint: { fontSize: 12, color: RivalColors.textSecondary, fontStyle: 'italic' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 10 },
  modalCancelBtn: { flex: 1, paddingVertical: 16, borderRadius: RivalRadius.DEFAULT, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  modalCancelText: { color: RivalColors.textSecondary, fontWeight: '700' },
  modalSaveBtn: { flex: 1, paddingVertical: 16, borderRadius: RivalRadius.DEFAULT, alignItems: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
});
