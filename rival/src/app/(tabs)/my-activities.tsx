import { JournalYearView } from '../../components/rival/JournalYearView';
import { SkyBackdrop } from '../../components/rival/SkyBackdrop';
import { GoldStar } from '../../components/rival/RespectStar';
import { arrivedFromTab, goToTab, onTabReselect } from '../../lib/tabNav';
import { clearShareRequest, onShareRequest, pendingShare } from '../../lib/shareRequest';
import { onActivityDeleted } from '../../lib/activityEvents';
import { type LiftPb } from '../../lib/liftPb';
import { activityPbs, DISTANCE_SPORTS } from '../../lib/activityPbs';
import { fetchReactionsOn } from '../../lib/reactions';
import { useSnapState } from '../../lib/snapState';
import { distanceUnit, formatActivityDistance, formatElevation, formatSpeedOrPace, formatWeight, toDisplayDistance } from '../../lib/units';
import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, Image, Platform, ImageBackground, useWindowDimensions } from 'react-native';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { supabase, getAuthUser } from '../../lib/supabase';
import { formatDisplayName, formatRaceName } from '../../lib/identity';
import { notify } from '../../lib/notify';
import { formatDuration, formatDurationClock } from '../../lib/format';
import { calculateStreak } from '../../lib/streak';
import { displayToIsoDate, isoToDisplayDate } from '../../lib/dateFormat';
import { fetchAllActivities } from '../../lib/fetchAllActivities';
import { QUOTES, hashStr } from '../../lib/quotes';
import { getMyTeamIds } from '../../lib/myTeams';
import { computeActivityInsight, InsightTone } from '../../lib/activityInsights';
import { loadScoringConfig, DEFAULT_MULTIPLIER, ScoringConfig } from '../../lib/effort';
import { rm } from '../../components/rival/RivalMobile';
import { RivalTopNav, RivalIcon, activityIconName, RivalFixedBackground, ActivityDiaryViewer, DiaryActivity, PhotoPositioner, CoverImage, RivalStartTiles } from '../../components/rival';
import { MediaPicker, pickMediaFiles, type MediaItem } from '../../components/rival/MediaPicker';
import { RUN_TYPES, fastestBests, fastestTitle, pbStoodText, type FastestBest } from '../../lib/bestEfforts';
import { activityDisplayName } from '../../lib/yearReview';
import { MonthBests, type MonthBest } from '../../components/rival/MonthBests';
import { activityTypeLabel } from '../../components/rival/EffortBreakdownSheet';
import { selectAll } from '../../lib/selectAll';
import { DayColumns, EmptyWeek, MonthWeekColumns, WeekLadder, type Checkpoint, FilterButton, FilterSheet, ShowingLine, WeekCard, EventLegs, WeekEarned, WeekNote, WeekNumbers, filterCount, weekEffortCompactStyle, weekEffortStyle, type ActivityFilters } from '../../components/rival/WeekCard';
import { getPrefs } from '../../lib/prefs';
import { MEDIA_COLUMNS, existingAsItems, saveArrangement, sortMedia, type MediaRow } from '../../lib/activityMedia';
import { RivalColors, RivalRadius, RivalType, RivalSerifFamily, RivalButtonColors, RivalGhost, RivalFontFamily, rivalTextShadow } from '../../constants/rivalTheme';
import { BREAKPOINT_TWO_UP_GRID, BREAKPOINT_SPACIOUS_GALLERY, BREAKPOINT_MOBILE_NAV, BREAKPOINT_WIDE_LAYOUT, sidePageWide } from '../../constants/breakpoints';
import { cardPhoto, fullPhoto } from '../../lib/imageUrl';

type ExerciseEntry = {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  distanceMeters?: number;
  prLift?: string;
};

type Activity = {
  id: string;
  /** The owner confirmed it is correct, so it scores in full. */
  effort_confirmed?: boolean;
  name: string | null;
  activity_type: string;
  started_at: string;
  utc_offset_seconds?: number | null;
  duration_seconds: number;
  distance_meters: number;
  elevation_meters: number | null;
  effort_score: number;
  photo_url: string | null;
  photo_focal_x: number | null;
  photo_focal_y: number | null;
  exercises: ExerciseEntry[] | null;
  race_id: string | null;
  notes: string | null;
  location: string | null;
  companions: string | null;
  shared_from_activity_id: string | null;
  pinned: boolean;
};


type WeekGroup = {
  label: string;
  weekStart: number;
  activities: Activity[];
  total: number;
};

type MonthGroup = {
  year: number;
  month: number; // 0-indexed (Date.getMonth())
  label: string; // "August 2026"
  startWeekday: number; // 0=Sun..6=Sat, leading blank cells in the grid
  daysInMonth: number;
  byDay: Map<number, Activity[]>; // day-of-month -> activities that day
  total: number;
  count: number;
  seconds: number;
  km: number;
};


// Sports where distances rarely clear 1km — showing metres reads better than
// a stunted "0.4 km".
const METERS_SPORTS = new Set(['Swim', 'Rowing']);

// Water sports — any recorded "elevation" is GPS noise, never a real climb,
// so the elevation tile is suppressed for these.
const WATER_SPORTS = new Set(['Swim', 'Rowing', 'Kayaking', 'StandUpPaddling', 'Surfing']);

// PB badge (~21px: 3+3 padding + 15px text) + the card's 14px stack gap —
// how far the inline photo rides up to sit level with the badge.
const PB_BADGE_OFFSET = 35;
// Icon-button row (30px) + the card's 14px stack gap — how far the inline
// photo extends DOWN past the stats row so its bottom lines up with the
// insight/actions row's bottom. Negative marginBottom keeps the overhang out
// of layout so the insight row doesn't get pushed down and chase it.
const INSIGHT_ROW_OVERHANG = 44;

// The ×N badge reads from scoring_config, the same source the score itself
// uses. It used to be a hardcoded table here, which drifted: it claimed Swim
// was ×1.5 long after Swim was scoring ×1.2 — the app misreporting its own maths.

const INSIGHT_ICON: Record<InsightTone, 'trophy' | 'fire' | 'trendUp'> = {
  record: 'trophy',
  streak: 'fire',
  comeback: 'trendUp',
};
const INSIGHT_COLOR: Record<InsightTone, string> = {
  record: RivalColors.rankAnchors.unrivaled,
  streak: RivalColors.accentText,
  comeback: RivalColors.tertiary,
};

// Local (not UTC) YYYY-MM-DD for a timestamp — a plain string .slice(0, 10)
// on started_at would read the UTC date, which is wrong for NZ (UTC+12/13).
// Full weekday name ("Friday", not "Fri") for the subtle day badge on
// journal photo cards — an abbreviation would read as a stat/code at that
// size, a full word reads as a caption.
function dayOfWeekLabel(timestamp: string) {
  return new Date(timestamp).toLocaleDateString('en-US', { weekday: 'long' });
}

function localIsoDate(timestamp: string) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ISO-8601 week number — matches the mockup's "Week 31" style week block
// title (mobile Activity Journal only; the desktop pill keeps its own
// "This week"/"Last week"/date-range label untouched).
function getWeekNumber(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// Compact "Jul 21 – 27" (single month name) matching the mockup's
// .activity-range — the shared weekLabel() below instead spells out both
// month names ("Jul 20 – Jul 26") for the desktop pill, which stays as-is.
function formatWeekRangeCompact(weekStart: number) {
  const start = new Date(weekStart);
  const end = new Date(weekStart + 6 * 24 * 60 * 60 * 1000);
  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  return startMonth === endMonth
    ? `${startMonth} ${start.getDate()} – ${end.getDate()}`
    : `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}`;
}

// Month layout's calendar pages — one entry per calendar month present in
// `activities`, always including the current month even when it has no
// activities yet, ascending (oldest first) so "previous month" sits to the
// left of the current one in the swipeable pager.
// The week's Effort counting up from 0 when the page opens. Counts once per
// mount; a later refresh shows the new figure straight away.
function CountUpNumber({ value, style }: { value: number; style: any }) {
  const [shown, setShown] = useState(Platform.OS === 'web' ? 0 : value);
  const done = useRef(Platform.OS !== 'web');
  useEffect(() => {
    if (done.current) { setShown(value); return; }
    // Nothing loaded yet: wait for the real figure rather than "counting" to 0.
    if (value === 0) { setShown(0); return; }
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / 1200);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else done.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const decimals = Number.isInteger(value) ? 0 : 1;
  return <Text style={style}>{shown.toFixed(decimals)}</Text>;
}

// Activity cards rise in one after another (web; keyframes in global.css).
// The mask keeps Safari clipping the rounded corners while a card animates
// or the page re-lays out; without it they could flash square.
// This week's Effort, a little smaller on the shorter card.
const thisWeekEffortStyle = { ...weekEffortStyle, fontSize: 28, lineHeight: 32 };
// A card's width in a week row: two to a phone's width, as the grid was.
const ROW_CARD_W = 160;

const cardIn = (i: number): any => (Platform.OS === 'web' ? {
  WebkitMaskImage: '-webkit-radial-gradient(white, black)', isolation: 'isolate',
  animationName: 'rivalRowIn', animationDuration: '450ms', animationTimingFunction: 'ease-out',
  animationDelay: `${150 + Math.min(i, 8) * 60}ms`, animationFillMode: 'both',
} : null);

function computeMonthGroups(activities: Activity[]): MonthGroup[] {
  const keys = new Set<string>();
  const now = new Date();
  keys.add(`${now.getFullYear()}-${now.getMonth()}`);
  for (const a of activities) {
    const d = new Date(a.started_at);
    keys.add(`${d.getFullYear()}-${d.getMonth()}`);
  }

  const groups: MonthGroup[] = Array.from(keys).map((key) => {
    const [yearStr, monthStr] = key.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const label = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const byDay = new Map<number, Activity[]>();
    let total = 0, count = 0, seconds = 0, km = 0;
    for (const a of activities) {
      const d = new Date(a.started_at);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const day = d.getDate();
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(a);
      total += a.effort_score || 0;
      count += 1;
      seconds += a.duration_seconds || 0;
      km += (a.distance_meters || 0) / 1000;
    }

    return { year, month, label, startWeekday, daysInMonth, byDay, total: Math.round(total * 10) / 10, count, seconds, km };
  });

  groups.sort((x, y) => x.year - y.year || x.month - y.month);
  return groups;
}

// Strava auto-names imported activities "Morning Run", "Afternoon Ride" etc.
// — the mobile Activity Journal card is small enough that the type alone
// ("Run", "Ride") reads better than a truncated "Morni…"/"Afternoo…". Only
// strips a LEADING time-of-day word, so a user's own custom title (e.g.
// "Morning coffee run with Jane") is left alone.
const TIME_OF_DAY_PREFIX = /^(morning|afternoon|evening|night)\s+/i;
function cardDisplayName(name: string | null | undefined, activityType: string) {
  const raw = name || activityType;
  return raw.replace(TIME_OF_DAY_PREFIX, '') || activityType;
}

function getMondayStart(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Same collapsed-pill/expand-to-stat-grid pattern as the "This Week"/"This
// Month" hero cards, for every OTHER (non-current) week — used in both the
// Weekly pager and Rows layout. A top-level component (not inlined in the
// .map()) so each rendered week gets its own independent expand state,
// unlike the hero cards' one shared flag (only one hero is ever on screen
// at a time; Rows can show a dozen of these pills at once).
function WeekStatPill({ title, dateRange, activities, prevEffort, bestDays, bestTitles, event }: {
  title: string; dateRange: string; activities: Activity[];
  prevEffort: number; bestDays: Set<number>; bestTitles: string[];
  event: { name: string; legs: { key: string; type: string; text: string }[]; days: Set<number> } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = Math.round(activities.reduce((s, a) => s + (a.effort_score || 0), 0) * 10) / 10;
  const count = activities.length;
  const seconds = activities.reduce((s, a) => s + (a.duration_seconds || 0), 0);
  const km = activities.reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000;
  // Same columns as this week, so a past week reads as the same card, finished.
  const dayEffort = [0, 0, 0, 0, 0, 0, 0];
  activities.forEach((a) => { dayEffort[(new Date(a.started_at).getDay() + 6) % 7] += a.effort_score || 0; });
  const upPct = prevEffort > 0 && total > prevEffort ? Math.round((total - prevEffort) / prevEffort * 100) : null;
  // The week's main activity, e.g. "3 runs". Types without a simple plural
  // fall back to "Weights × 2".
  const byType: Record<string, number> = {};
  activities.forEach((a) => { byType[a.activity_type] = (byType[a.activity_type] || 0) + 1; });
  const [mainType, mainCount] = Object.entries(byType).sort((x, y) => y[1] - x[1])[0] ?? [null, 0];
  const PLURALS: Record<string, [string, string]> = {
    Run: ['run', 'runs'], Ride: ['ride', 'rides'], Walk: ['walk', 'walks'], Swim: ['swim', 'swims'],
    Hike: ['hike', 'hikes'], Rowing: ['row', 'rows'], Yoga: ['yoga class', 'yoga classes'],
  };
  const done = mainType
    ? PLURALS[mainType] ? `${mainCount} ${PLURALS[mainType][mainCount === 1 ? 0 : 1]}` : `${activityTypeLabel(mainType)} × ${mainCount}`
    : null;
  const best = bestTitles.length === 1 ? bestTitles[0] : bestTitles.length > 1 ? `${bestTitles.length} personal bests` : null;
  return (
    <WeekCard
      compact
      kicker={event ? `Event week · ${dateRange}` : dateRange}
      title={event ? event.name : title}
      event={!!event}
      effort={<Text style={weekEffortCompactStyle}>{total}</Text>}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      {event ? <EventLegs legs={event.legs} /> : null}
      <DayColumns effort={dayEffort} bests={bestDays} today={null} events={event?.days} />
      <WeekEarned upPct={upPct} done={done} best={best} />
      {expanded ? (
        <WeekNumbers count={count} seconds={seconds} km={km} />
      ) : null}
    </WeekCard>
  );
}

export default function MyActivitiesScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // Below this, RivalTopNav shows its floating bottom tab bar instead of the
  // desktop link row — the FAB needs to clear it, not sit underneath it.
  // This is also the mobile/desktop layout gate for this whole screen: the
  // Activity Journal redesign (hero card, horizontal weekly rows, full-
  // screen diary viewer) only replaces the MOBILE presentation. Desktop
  // keeps its existing layout completely unchanged (mobile-only scope).
  const mobileNav = windowWidth < BREAKPOINT_MOBILE_NAV;
  // Two-up card grid only kicks in with room for it; below this everything stacks.
  const wide = windowWidth >= BREAKPOINT_TWO_UP_GRID;
  // Inline gallery placement needs real room beside the stat column, which
  // only the widest cards have. In the 2-up grid (48% flexBasis + flexGrow),
  // the only card that renders full-row is the LAST card of a week with an
  // odd activity count — that's decidable at render time, no measuring needed.
  const spaciousWindow = windowWidth >= BREAKPOINT_SPACIOUS_GALLERY;
  const [allActivities, setAllActivities] = useSnapState<Activity[]>('journal.allActivities', []);
  const [thisWeekTotal, setThisWeekTotal] = useSnapState('journal.thisWeekTotal', 0);
  const [pbs, setPbs] = useSnapState<Record<string, string>>('journal.pbs', {});
  // For each personal best, the best it beat (metres or seconds), for the
  // activity page's personal-best band (Ricky, 2026-10-14).
  const [pbPrev, setPbPrev] = useSnapState<Record<string, number>>('journal.pbPrev', {});
  // Lift personal bests by activity (lib/liftPb.ts): heaviest yet, or a
  // first-time lift marked as one.
  const [liftPbs, setLiftPbs] = useSnapState<Record<string, LiftPb>>('journal.liftPbs', {});
  // Runs that set a new fastest 400 m to marathon (lib/bestEfforts.ts).
  const [fastest, setFastest] = useSnapState<Record<string, FastestBest[]>>('journal.fastest', {});
  const [loading, setLoading] = useSnapState('journal.loading', true);
  const [userId, setUserId] = useSnapState('journal.userId', '');
  // Respect from other people on each activity, for the past-week cards.
  const [respectOn, setRespectOn] = useState<Record<string, string[]>>({});
  const [givers, setGivers] = useState<Record<string, { name: string; uri: string | null }>>({});
  useEffect(() => {
    if (!userId || !allActivities.length) return;
    fetchReactionsOn(allActivities.map((a) => a.id)).then((rows) => {
      const by: Record<string, string[]> = {};
      rows.forEach((r) => { if (r.user_id !== userId && r.emoji !== 'inspired') (by[r.target_id] ||= []).push(r.user_id); });
      setRespectOn(by);
      // Who they are: past-week cards name them and show their faces.
      const ids = [...new Set(Object.values(by).flat())];
      if (ids.length) {
        supabase.from('users').select('id, display_name, avatar_url').in('id', ids).then(({ data }) => {
          const p: Record<string, { name: string; uri: string | null }> = {};
          (data ?? []).forEach((u: any) => { p[u.id] = { name: formatDisplayName(u).split(' ')[0], uri: u.avatar_url }; });
          setGivers(p);
        }, () => {});
      }
    }, () => {});
  }, [userId, allActivities]);
  // Training toward: the next event you're entered in, beside Personal bests.
  // First visit (no activities yet): which getting-started steps are done.
  const [hasTeam, setHasTeam] = useSnapState('journal.hasTeam', false);
  const [hasFocus, setHasFocus] = useSnapState('journal.hasFocus', false);
  // Every event (race) by id, so an event week can be headlined by it.
  const [races, setRaces] = useSnapState<Record<string, { name: string; race_type: string; actual_finish_time?: string | null }>>('journal.races', {});
  const [nextEvent, setNextEvent] = useSnapState<{ name: string; race_date: string; location: string | null } | null>('journal.nextEvent', null);
  const [uploading, setUploading] = useState<string | null>(null);
  // Files done / total while new photos and videos upload, for the overlay
  // that holds the screen until they are in (Ricky, 2026-10-11).
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  // A new cover is positioned BEFORE anything uploads, so Cancel on the crop
  // step really cancels (Ricky, 2026-10-11: it used to upload first and only
  // then ask, and Cancel left the photo on).
  const [pendingCrop, setPendingCrop] = useState<{ activityId: string; items: MediaItem[]; url: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadErrorActivityId, setUploadErrorActivityId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [mediaMap, setMediaMap] = useSnapState<Record<string, MediaRow[]>>('journal.mediaMap', {});
  // The ordering sheet, open between the phone's picker and the upload.
  const [mediaPicker, setMediaPicker] = useState<{ activityId: string; items: MediaItem[]; notice?: string; arrangeOnly?: boolean; focus?: string } | null>(null);
  // Phones position each photo in the picker itself, so there is no crop
  // step after it; the wider layout keeps its crop step for the cover.
  const pickerPositions = !sidePageWide(windowWidth);
  const [enlargedPhoto, setEnlargedPhoto] = useState<string | null>(null);
  // Effort badge height should track the stat column's height (not the photo's,
  // which can stand taller) — measured directly since flex stretch can't single
  // out two of three row siblings.
  const [statColHeights, setStatColHeights] = useState<Record<string, number>>({});
  // Web-only hover tooltip for the ×N multiplier badge — `title` isn't reliably
  // forwarded to the DOM by react-native-web, so we render our own popup.
  const [hoveredMultiplierId, setHoveredMultiplierId] = useState<string | null>(null);
  const [hoveredToolbarBtn, setHoveredToolbarBtn] = useState<string | null>(null);
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig | null>(null);

  const [filterType, setFilterType] = useState('All');
  const [sortOrder, setSortOrder] = useState<'latest' | 'oldest'>('latest');
  const [prOnly, setPrOnly] = useState(false);
  // Starred activities only, and the Filter pop-up (Ricky, 2026-10-16).
  const [starredOnly, setStarredOnly] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  // Mobile Activity Journal's "search by date" — ISO YYYY-MM-DD, matched
  // against started_at's date portion. Entered via a plain prompt (YYYY-MM-DD,
  // this app's display format) rather than a full calendar picker.
  const [dateFilter, setDateFilter] = useState<string | null>(null);

  // Mobile Activity Journal's full-screen diary viewer — a flat, continuously
  // ordered list of activities (most-recent-first, matching the horizontal
  // rows' own order) plus which index within it is currently open.
  const [diaryList, setDiaryList] = useState<DiaryActivity[] | null>(null);
  // Tapping the Activity tab again closes the open activity and photo (Ricky, 2026-10-11).
  const [tabReselects, setTabReselects] = useState(0);
  // With nothing open, it goes back to the start: this week, this month, the
  // top of the year (Ricky, 2026-10-14).
  const weekPagerRef = useRef<ScrollView>(null);
  // This week's row, opened at today (renderWeekRow).
  const thisWeekRowRef = useRef<ScrollView | null>(null);
  const monthScrollRef = useRef<ScrollView>(null);
  const yearScrollRef = useRef<ScrollView>(null);
  const somethingOpen = useRef(false);
  const backToStart = useRef(() => {});
  useEffect(() => onTabReselect('/my-activities', () => {
    if (somethingOpen.current) { setTabReselects((n) => n + 1); setEnlargedPhoto(null); return; }
    backToStart.current();
  }), []);
  // A just-uploaded cover photo — shown behind the crop-positioner overlay
  // until the user confirms a focal point or skips (keeping the center
  // default). Separate from the upload flow itself so it works whether the
  // upload happened from the card grid or from inside the open diary viewer.
  const [positioningPhoto, setPositioningPhoto] = useState<{
    activityId: string; url: string;
    previousUrl: string | null; previousFocalX: number | null; previousFocalY: number | null;
  } | null>(null);
  const [diaryIndex, setDiaryIndex] = useState(0);
  // Mobile Activity Journal's full-screen weekly pager — each week is sized to
  // exactly this height (measured off the pager's own onLayout) so one week
  // fills the screen and vertical swipe/scroll snaps to the next, retro-app
  // style. Falls back to a generous flex fill before the first layout pass.
  const [pagerHeight, setPagerHeight] = useState(0);
  // How many weeks are drawn. More are added as you near the bottom. Drawing
  // every week at once (a year or more of photo cards) held the phone for
  // seconds on opening and on every switch back to Week.
  const [weeksShown, setWeeksShown] = useState(4);
  // Where each week starts in the list, for "Go to last week".
  const weekTops = useRef<Record<string, number>>({});
  // Mobile Activity Journal's 3-way layout switch — Rows (horizontal
  // per-week scroll), Weekly (full-screen one-week-per-page swipe, the
  // previous default), Month (calendar grid, swipe between months). Kept
  // in-memory only for now; not persisted across reloads.
  const [journalLayout, setJournalLayout] = useState<'weekly' | 'month' | 'year'>('weekly');
  // Hero stat card (This Week/This Month/etc.) — resting state shows just
  // the title + Effort total; tapping expands the stat grid/quote/momentum/
  // filter buttons. One shared flag rather than per-card state: only one of
  // Rows/Week/Month is on screen at a time, and for Month's multiple mounted
  // pages, keeping them in sync when you swipe reads as more consistent than
  // each page remembering its own expand state independently.
  const [heroExpanded, setHeroExpanded] = useState(false);
  const monthPagerRef = useRef<ScrollView>(null);
  const [monthPagerWidth, setMonthPagerWidth] = useState(0);
  const hasScrolledMonthPager = useRef(false);
  // Which month's CALENDAR is currently centered in the horizontal peek
  // carousel — only the calendar card swipes; the stat card above it is a
  // single fixed instance that re-renders off this index instead of being
  // duplicated per month (that duplication was also the source of a real
  // bug: each month page had its own independent vertical ScrollView, so
  // mid-swipe you could see two pages at different, desynced scroll
  // positions — one real vertical scroll instead of N of them fixes that
  // structurally, not just visually).
  const [visibleMonthIndex, setVisibleMonthIndex] = useState(0);
  // While an arrow is sliding the calendar to a month, the positions it passes
  // through mustn't change the card above (it flickered back to the old month).
  const monthArrowTarget = useRef<number | null>(null);
  const goToMonth = (idx: number) => {
    monthArrowTarget.current = idx;
    setVisibleMonthIndex(idx);
    monthPagerRef.current?.scrollTo({ x: idx * monthStride, animated: true });
    setTimeout(() => { if (monthArrowTarget.current === idx) monthArrowTarget.current = null; }, 700);
  };
  // Re-snap to the current month every time you switch INTO Month view, not
  // just once ever — otherwise switching to Rows/Week and back leaves you
  // wherever you'd previously scrolled, which reads as random rather than
  // "here's now" the way the Week hero always resets to this week.
  useEffect(() => {
    if (journalLayout === 'month') {
      hasScrolledMonthPager.current = false;
      // Straight to the latest month, so the card never shows the oldest
      // one while the pager is still measuring.
      if (monthGroups.length) setVisibleMonthIndex(monthGroups.length - 1);
    }
  }, [journalLayout]);

  // Scoring config is small, cached in effort.ts, and only feeds the ×N badge,
  // so a failure here just falls back to DEFAULT_MULTIPLIER rather than
  // blocking the page.
  useEffect(() => {
    loadScoringConfig().then(setScoringConfig).catch(() => {});
  }, []);
  // Measured width of the calendar's 7-column grid (post-padding), used to
  // size each day cell exactly. `width: '13%'` per cell (91%) plus the row's
  // 6px gaps (36px across 7 columns) used to overflow the container by a few
  // px, silently wrapping the grid to 6 columns and leaving a large empty
  // gap before day 1 — this sidesteps percentage/gap math entirely.
  const [calGridWidth, setCalGridWidth] = useState(0);
  const calCellSize = calGridWidth > 0 ? (calGridWidth - 24 - 6 * 6) / 7 : 0;

  // A Share from the feed or a team: open that activity with its share up,
  // once it's among the loaded activities; done, it goes back to Teams.
  const [shareFromTeams, setShareFromTeams] = useState<string | null>(null);
  useEffect(() => {
    const take = () => {
      const id = pendingShare();
      if (!id || !allActivities.some((a) => a.id === id)) return;
      clearShareRequest();
      openDiary(allActivities, id);
      setShareFromTeams(id);
    };
    take();
    return onShareRequest(take);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allActivities]);

  // Deleted from Manual entry: close its card and drop it at once.
  useEffect(() => onActivityDeleted((id) => {
    setDiaryList((prev) => (prev?.some((a) => a.id === id) ? null : prev));
    setAllActivities((prev) => prev.filter((a) => a.id !== id));
  }), []);

  // Bumped on every visit; keys the week's Effort so it counts up each time.
  const [journalVisit, setJournalVisit] = useState(0);
  useFocusEffect(useCallback(() => {
    // Only arriving from another tab: closing a page over Activity leaves it as it was.
    if (arrivedFromTab('/my-activities')) setJournalVisit((v) => v + 1);
    loadActivities();
  }, []));

  async function loadActivities() {
    let { data: { user } } = await getAuthUser();
    if (!user) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      user = refreshed.user;
    }
    if (!user) { setLoading(false); return; }
    setUserId(user.id);
    const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    getMyTeamIds(user.id).then((ids) => setHasTeam(ids.length > 0)).catch(() => {});
    supabase.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('end_date', todayIso)
      .then(({ count }) => setHasFocus((count ?? 0) > 0));
    supabase.from('races').select('name, race_date, location').eq('user_id', user.id)
      .gte('race_date', todayIso).order('race_date', { ascending: true }).limit(1).maybeSingle()
      .then(({ data }) => setNextEvent(data ?? null));
    supabase.from('races').select('id, name, race_type, actual_finish_time').eq('user_id', user.id)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, { name: string; race_type: string; actual_finish_time?: string | null }> = {};
        data.forEach((r) => { map[r.id] = { name: r.name, race_type: r.race_type, actual_finish_time: r.actual_finish_time }; });
        setRaces(map);
      });

    // The whole history, not a slice. This page groups activities into weekly,
    // month and year views entirely client-side, so anything not fetched simply
    // vanishes from the calendar — a flat .limit(100) here silently truncated
    // the journal at the 100th most recent activity (roughly five months for an
    // active account) while the older data sat in the table untouched.
    const data = await fetchAllActivities(
      user.id,
      'id, name, activity_type, started_at, utc_offset_seconds, duration_seconds, distance_meters, elevation_meters, effort_score, photo_url, photo_focal_x, photo_focal_y, exercises, race_id, notes, location, companions, shared_from_activity_id, pinned, effort_confirmed',
    );
    if (data) {
      setAllActivities(data);

      const currentWeekStart = getMondayStart(new Date());

      const { pbs: pbMap, prev: prevMap, lifts: liftMap } = activityPbs(data, user.id);
      setPbs(pbMap);
      setPbPrev(prevMap);
      setLiftPbs(liftMap);

      // Fastest times need each run's best efforts, which the shared history
      // leaves out; runs only, so this stays small.
      selectAll((from, to) => supabase.from('activities')
        .select('id, activity_type, started_at, distance_meters, duration_seconds, best_efforts')
        .eq('user_id', user.id)
        .in('activity_type', [...RUN_TYPES])
        .order('started_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to))
        .then((runs) => setFastest(fastestBests(runs, getPrefs().units === 'imperial')));

      const thisWeek = data.filter(a => getMondayStart(new Date(a.started_at)) === currentWeekStart);
      setThisWeekTotal(Math.round(thisWeek.reduce((s, a) => s + (a.effort_score || 0), 0) * 10) / 10);

      // The journal can show now; photos fill in when they arrive.
      setLoading(false);

      const activityIds = data.map(a => a.id);
      if (activityIds.length > 0) {
        // In batches: every id goes into the request's web address, and a long
        // history (hundreds of ids) made one address too long to be accepted,
        // so no photos loaded at all. Batches run side by side.
        const batches: string[][] = [];
        for (let i = 0; i < activityIds.length; i += 120) batches.push(activityIds.slice(i, i + 120));
        const results = await Promise.all(batches.map((ids) => supabase
          .from('activity_media')
          .select(MEDIA_COLUMNS)
          .in('activity_id', ids)
          .order('created_at', { ascending: true })));
        const mediaData = results.flatMap((r) => (r.data as MediaRow[] | null) ?? []);

        const newMediaMap: Record<string, MediaRow[]> = {};
        mediaData.forEach((m: MediaRow) => {
          if (!newMediaMap[m.activity_id]) newMediaMap[m.activity_id] = [];
          newMediaMap[m.activity_id].push(m);
        });
        // Saved order, not upload order — the order set in the picker.
        Object.keys(newMediaMap).forEach((id) => { newMediaMap[id] = sortMedia(newMediaMap[id]); });
        setMediaMap(newMediaMap);
      }
    }
    setLoading(false);
  }

  const { scrollProps: pullProps, indicator: pullIndicator } = usePullToRefresh(() => loadActivities());

  // Size and count limits live in MediaPicker, shared with manual entry, so
  // an activity has one limit however its photos arrive.

  function reportUploadError(activityId: string, msg: string) {
    setUploadErrorActivityId(activityId);
    setUploadError(msg);
  }

  // Adding media is two steps, Instagram-style. First the phone's own picker,
  // opened straight from the tap — mobile browsers refuse to open one that a
  // tap did not start. Then the ordering sheet, where every item is numbered
  // in the order it will post.
  async function uploadPhoto(activityId: string) {
    setUploadError(null);
    setUploadErrorActivityId(null);
    const { items, rejected } = await pickMediaFiles();
    if (!items.length) {
      if (rejected.length) reportUploadError(activityId, rejected[0]);
      return;
    }
    // What is already posted comes first, selected and numbered in its saved
    // order, with the new picks after it — so the whole set can be
    // rearranged in one place, not just the part being added.
    const act = allActivities.find(a => a.id === activityId);
    const existing = existingAsItems(mediaMap[activityId] || [], act?.photo_url ?? null, { x: act?.photo_focal_x ?? null, y: act?.photo_focal_y ?? null });
    setMediaPicker({ activityId, items: [...existing, ...items], notice: rejected[0] });
  }

  // Reorder (or remove) what is already posted, without picking anything new.
  // `focus` opens it on that photo, for positioning it.
  function arrangeMedia(activityId: string, focus?: string) {
    const act = allActivities.find(a => a.id === activityId);
    const items = existingAsItems(mediaMap[activityId] || [], act?.photo_url ?? null, { x: act?.photo_focal_x ?? null, y: act?.photo_focal_y ?? null });
    setMediaPicker({ activityId, items, arrangeOnly: true, focus });
  }

  // Saves the whole arranged set — removals, new uploads and the new order —
  // and makes #1 the cover. See saveArrangement in lib/activityMedia.ts.
  async function uploadMedia(activityId: string, items: MediaItem[], focal?: { x: number; y: number }) {
    if (!userId) return;
    setUploading(activityId);
    try {
      const previousUrl = allActivities.find(a => a.id === activityId)?.photo_url ?? null;

      const result = await saveArrangement({
        activityId,
        userId,
        items,
        existing: mediaMap[activityId] || [],
        currentCover: previousUrl,
        onProgress: (done, total) => setUploadProgress(total > 0 ? { done, total } : null),
      });
      if (result.errors.length) reportUploadError(activityId, result.errors[0]);

      setMediaMap(prev => ({ ...prev, [activityId]: result.rows }));

      if (result.coverChanged && focal && result.cover) {
        // Positioned before upload: save that crop with the new cover.
        const patch = { photo_url: result.cover, photo_focal_x: focal.x, photo_focal_y: focal.y };
        const { error: focalErr } = await supabase.from('activities').update({ photo_focal_x: focal.x, photo_focal_y: focal.y }).eq('id', activityId);
        if (focalErr) notify("Couldn't save the photo position", focalErr.message);
        setAllActivities(prev => prev.map(a => (a.id === activityId ? { ...a, ...patch } : a)));
        setDiaryList(prev => prev ? prev.map(a => (a.id === activityId ? { ...a, ...patch } : a)) : prev);
      } else if (pickerPositions) {
        // Positions were set in the picker and saved with the set.
        const patch = { photo_url: result.cover, photo_focal_x: result.coverFocal.x, photo_focal_y: result.coverFocal.y };
        setAllActivities(prev => prev.map(a => (a.id === activityId ? { ...a, ...patch } : a)));
        setDiaryList(prev => prev ? prev.map(a => (a.id === activityId ? { ...a, ...patch } : a)) : prev);
      } else if (result.coverChanged) {
        const patch = { photo_url: result.cover, photo_focal_x: null, photo_focal_y: null };
        setAllActivities(prev => prev.map(a => (a.id === activityId ? { ...a, ...patch } : a)));
        // diaryList is a separate snapshot the open viewer renders from — it
        // has to be patched too, or the viewer keeps showing the old cover.
        setDiaryList(prev => prev ? prev.map(a => (a.id === activityId ? { ...a, ...patch } : a)) : prev);
        // A new cover gets the same crop step a first photo always has.
        // Cancelling it now means "skip cropping", not "undo": the cover is
        // whatever is #1, and the old one may have just been deleted.
        if (result.cover) {
          setPositioningPhoto({ activityId, url: result.cover, previousUrl: result.cover, previousFocalX: null, previousFocalY: null });
        }
      }
    } finally {
      setUploading(null);
      setUploadProgress(null);
    }
  }

  function startEditing(activity: Activity) {
    setEditingId(activity.id);
    setEditingName(activity.name || activity.activity_type);
  }

  async function saveName(activityId: string) {
    const trimmed = editingName.trim();
    if (!trimmed) { setEditingId(null); return; }

    const { error } = await supabase
      .from('activities')
      .update({ name: trimmed, name_locked: true })
      .eq('id', activityId);

    if (!error) {
      setAllActivities(prev => prev.map(a =>
        a.id === activityId ? { ...a, name: trimmed } : a
      ));
    }
    setEditingId(null);
  }

  // Patches a single activity in local state — used by the diary viewer so
  // edits (name/location/notes/pinned) reflect on the card grid
  // immediately, without waiting on a reload. The viewer does its own
  // (debounced) Supabase writes; this is purely local-state sync.
  function updateActivityLocal(id: string, patch: Partial<Activity>) {
    setAllActivities(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  }

  function toDiaryActivity(a: Activity): DiaryActivity {
    return {
      id: a.id,
      name: a.name,
      activity_type: a.activity_type,
      started_at: a.started_at,
      duration_seconds: a.duration_seconds,
      distance_meters: a.distance_meters,
      elevation_meters: a.elevation_meters,
      effort_score: a.effort_score,
      photo_url: a.photo_url,
      photo_focal_x: a.photo_focal_x,
      photo_focal_y: a.photo_focal_y,
      notes: a.notes,
      location: a.location,
      companions: a.companions,
      shared_from_activity_id: a.shared_from_activity_id,
      pinned: a.pinned,
      race_id: a.race_id,
      isPb: !!pbs[a.id],
      pbPrev: liftPbs[a.id] ? liftPbs[a.id].prevKg : pbPrev[a.id] ?? null,
      pbLift: liftPbs[a.id]?.lift ?? null,
      fastest: fastest[a.id] ?? null,
      pbStood: (() => { const title = headlinePbTitle(a); return title ? pbStood.get(`${title}|${a.id}`) ?? null : null; })(),
      utc_offset_seconds: a.utc_offset_seconds ?? null,
      pbKind: liftPbs[a.id] ? 'lift' : DISTANCE_SPORTS.has(a.activity_type) ? 'distance' : 'time',
      effort_confirmed: a.effort_confirmed,
      exercises: a.exercises,
    };
  }

  // First visit: bring past training in from a device (the fastest way to a
  // full page), or add one by scan or by hand; then a three-step list.
  function renderFirstVisit() {
    const steps = [
      { key: 'first', title: 'Add the first activity', sub: 'Scan it or type it in', done: false, onPress: () => router.push('/add-workout') },
      { key: 'team', title: 'Join a team', sub: 'Train alongside friends', done: hasTeam, onPress: () => router.push('/discover-leagues') },
      { key: 'focus', title: 'Set a focus', sub: 'One goal for the next 4 weeks', done: hasFocus, onPress: () => router.push({ pathname: '/goals', params: { add: 'true' } }) },
    ];
    const doneCount = steps.filter((st) => st.done).length;
    return (
      <View style={styles.fvWrap}>
        <View style={styles.fvHero}>
          {Platform.OS === 'web' && <View style={[styles.fvHeroGlow, { pointerEvents: 'none' }]} />}
          <Text style={styles.fvTitle}>Past activities count.</Text>
          <Text style={styles.fvSub}>Import an archive to bring it in, with Effort.</Text>
          <View style={styles.fvStats}>
            {['Effort', 'Activities', 'Hours'].map((l) => (
              <View key={l} style={styles.fvStat}>
                <Text style={styles.fvStatNum}>–</Text>
                <Text style={styles.fvStatLabel}>{l.toUpperCase()}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.fvCta} activeOpacity={0.85} onPress={() => router.push('/import-archive')}>
            <Text style={styles.fvCtaText}>Import activity history</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.fvOr}>
          <View style={styles.fvOrLine} /><Text style={styles.fvOrText}>OR</Text><View style={styles.fvOrLine} />
        </View>
        <View style={styles.fvTiles}>
          {[
            { key: 'scan', icon: 'camera' as const, label: 'Scan workout', to: windowWidth >= BREAKPOINT_WIDE_LAYOUT ? '/scan-workout' : '/add-workout' },
            { key: 'manual', icon: 'manual' as const, label: 'Manual entry', to: '/manual-entry' },
          ].map((t) => (
            <TouchableOpacity key={t.key} style={styles.fvTile} activeOpacity={0.85} onPress={() => router.push(t.to as any)}>
              <View style={styles.fvBadge}><RivalIcon name={t.icon} size={17} color="#1a0d08" /></View>
              <Text style={styles.fvTileText}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.fvListTitle}>Getting started</Text>
        <View style={styles.fvBar}><View style={[styles.fvBarFill, { width: `${(doneCount / steps.length) * 100}%` as any }]} /></View>
        <Text style={styles.fvCount}>{doneCount} of {steps.length} done</Text>
        <View style={styles.fvSteps}>
          {steps.map((st, i) => (
            <TouchableOpacity
              key={st.key}
              style={[styles.fvStep, i > 0 && styles.fvStepBorder]}
              activeOpacity={0.8}
              onPress={st.done ? undefined : st.onPress}
              disabled={st.done}
            >
              <View style={[styles.fvNum, st.done && styles.fvNumDone]}>
                {st.done
                  ? <RivalIcon name="check" size={15} color="#1a0d08" />
                  : <Text style={styles.fvNumText}>{i + 1}</Text>}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.fvStepTitle, st.done && styles.fvStepTitleDone]}>{st.title}</Text>
                <Text style={styles.fvStepSub}>{st.done ? 'Done' : st.sub}</Text>
              </View>
              {!st.done && <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  function openDiary(flatActivities: Activity[], activityId: string) {
    const list = flatActivities.map(toDiaryActivity);
    const idx = list.findIndex((a) => a.id === activityId);
    if (idx < 0) return;
    setDiaryList(list);
    setDiaryIndex(idx);
  }

  function weekLabel(weekStart: number, currentWeekStart: number) {
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    if (weekStart === currentWeekStart) return 'This week';
    if (weekStart === currentWeekStart - oneWeek) return 'Last week';
    const start = new Date(weekStart);
    const end = new Date(weekStart + 6 * 24 * 60 * 60 * 1000);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
  }

  function computeGroups(activities: Activity[], order: 'latest' | 'oldest'): WeekGroup[] {
    const currentWeekStart = getMondayStart(new Date());
    const map = new Map<number, Activity[]>();
    // Always keep a slot for the current week, even if a filter (PBs only,
    // activity type) leaves it empty — otherwise the Weekly pager's hero page
    // vanishes entirely when the filter excludes every activity this week.
    map.set(currentWeekStart, []);
    for (const activity of activities) {
      const ws = getMondayStart(new Date(activity.started_at));
      if (!map.has(ws)) map.set(ws, []);
      map.get(ws)!.push(activity);
    }

    const weekGroups: WeekGroup[] = [];
    const sortedWeeks = Array.from(map.keys()).sort((a, b) => order === 'latest' ? b - a : a - b);
    for (const ws of sortedWeeks) {
      const acts = map.get(ws)!.slice().sort((x, y) => {
        const dx = new Date(x.started_at).getTime();
        const dy = new Date(y.started_at).getTime();
        return order === 'latest' ? dy - dx : dx - dy;
      });
      const total = Math.round(acts.reduce((s, a) => s + (a.effort_score || 0), 0) * 10) / 10;
      weekGroups.push({ label: weekLabel(ws, currentWeekStart), weekStart: ws, activities: acts, total });
    }
    return weekGroups;
  }

  // Worked out once per change of data or filter, not on every render: the
  // page re-renders as you scroll, and each pass walked the whole history.
  const activityTypes = useMemo(() => Array.from(new Set(allActivities.map(a => a.activity_type))).sort(), [allActivities]);
  const filteredActivities = useMemo(() => allActivities.filter(a =>
    (filterType === 'All' || a.activity_type === filterType) &&
    (!prOnly || !!pbs[a.id] || !!fastest[a.id]) &&
    (!starredOnly || !!a.pinned) &&
    (!dateFilter || localIsoDate(a.started_at) === dateFilter)
  ), [allActivities, filterType, prOnly, pbs, fastest, starredOnly, dateFilter]);
  const groups = useMemo(() => computeGroups(filteredActivities, sortOrder), [filteredActivities, sortOrder]);
  // Flat, continuously-ordered list matching the rows' own display order —
  // what the diary viewer tap-through navigates across.
  const flatOrdered = groups.flatMap((g) => g.activities);
  // Week layout: with a filter on, matches show as one grid (see below).
  const filtering = filterType !== 'All' || prOnly || starredOnly || !!dateFilter;

  // Personal bests by record ("Farthest run", "Fastest 5 km", "Heaviest
  // bench press"), newest first in each. The newest is the current record;
  // the rest are earlier PBs it has since beaten.
  function groupPbs(list: Activity[]): { title: string; acts: Activity[] }[] {
    const by = new Map<string, Activity[]>();
    const add = (title: string, a: Activity) => { const l = by.get(title) ?? []; l.push(a); by.set(title, l); };
    for (const a of list) {
      const label = pbs[a.id];
      if (label) add(label.startsWith('Heaviest') ? label : `${label.split(' ')[0]} ${activityDisplayName(a.activity_type).toLowerCase()}`, a);
      for (const b of fastest[a.id] ?? []) add(fastestTitle(b), a);
    }
    const at = (a: Activity) => new Date(a.started_at).getTime();
    return [...by].map(([title, acts]) => ({ title, acts: acts.sort((x, y) => at(y) - at(x)) }))
      .sort((x, y) => at(y.acts[0]) - at(x.acts[0]));
  }
  const pbGroups = useMemo(() => (prOnly ? groupPbs(filteredActivities) : []), [prOnly, filteredActivities, pbs, fastest]);
  // Current against the whole history, not only what a filter leaves.
  const allPbGroups = useMemo(() => groupPbs(allActivities), [allActivities, pbs, fastest]);
  const currentPbIds = useMemo(() => new Set(allPbGroups.map((g) => g.acts[0].id)), [allPbGroups]);
  // "title|activity id" → how long that PB stood before the next one beat
  // it. The current record has none.
  const pbStood = useMemo(() => {
    const out = new Map<string, string>();
    for (const g of allPbGroups) {
      for (let i = 1; i < g.acts.length; i++) {
        out.set(`${g.title}|${g.acts[i].id}`, pbStoodText(new Date(g.acts[i - 1].started_at).getTime() - new Date(g.acts[i].started_at).getTime()));
      }
    }
    return out;
  }, [allPbGroups]);
  // The record a card or the viewer names first: the PB label, else the
  // longest fastest time (the viewer's own order).
  function headlinePbTitle(a: Activity): string | null {
    const label = pbs[a.id];
    if (label) return label.startsWith('Heaviest') ? label : `${label.split(' ')[0]} ${activityDisplayName(a.activity_type).toLowerCase()}`;
    const top = fastest[a.id]?.[0];
    return top ? fastestTitle(top) : null;
  }
  const [openPbGroups, setOpenPbGroups] = useState<Set<string>>(new Set());

  // The Personal bests filter: a section per record, the current PB and the
  // one before it, the rest folded (Ricky, 2026-10-24, mockup approved).
  function renderPbGroups() {
    return pbGroups.map((g) => {
      const open = openPbGroups.has(g.title);
      const shown = open ? g.acts : g.acts.slice(0, 2);
      const hidden = g.acts.length - 2;
      return (
        <View key={g.title} style={styles.pbSection}>
          <View style={styles.pbSectionHead}>
            <Text style={styles.pbSectionTitle}>{g.title}</Text>
            <Text style={styles.pbSectionCount}>{g.acts.length} {g.acts.length === 1 ? 'PB' : 'PBs'}</Text>
          </View>
          <View style={styles.jGrid}>
            {shown.map((a, ci) => renderJournalCard(a, ci))}
          </View>
          {hidden > 0 ? (
            <TouchableOpacity
              style={styles.pbMore}
              activeOpacity={0.8}
              onPress={() => setOpenPbGroups((cur) => { const next = new Set(cur); if (next.has(g.title)) next.delete(g.title); else next.add(g.title); return next; })}
              accessibilityRole="button"
            >
              <Text style={styles.pbMoreText}>{open ? 'Show fewer' : `${hidden} earlier ${hidden === 1 ? 'PB' : 'PBs'}`}</Text>
              <RivalIcon name={open ? 'chevronUp' : 'chevronDown'} size={18} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          ) : null}
        </View>
      );
    });
  }

  // A PB card on the Activity tab: the current record in full gold, one
  // that has since been beaten in faded gold (Ricky, 2026-10-24).
  function renderJournalCard(activity: Activity, ci: number, inRow = false) {
    const pbLabel = pbs[activity.id];
    // Fastest times are PBs too, and get the same ring.
    const badgeKind: 'pb' | 'race' | null = pbLabel || fastest[activity.id]?.length ? 'pb' : activity.race_id ? 'race' : null;
    // Phones: events in ivory with a small label (Ricky, 2026-10-16, C1);
    // desktop keeps its red.
    const currentPb = badgeKind === 'pb' && currentPbIds.has(activity.id);
    const ringColor = badgeKind === 'pb' ? (currentPb ? RivalColors.rankAnchors.unrivaled : 'rgba(255,215,0,0.32)') : badgeKind === 'race' ? (mobileNav ? RivalColors.event : '#ff5c5c') : 'transparent';
    const race = mobileNav && activity.race_id ? races[activity.race_id] : undefined;
    const raceTag = race ? (['Triathlon', 'HYROX', 'CrossFit'].includes(race.race_type) ? race.race_type : 'Event') : null;
    // Phones: a personal best gets a small gold PB label in the corner, as an
    // event does in ivory. A race that was also a PB has both, event on top,
    // and its edge runs ivory into gold (Ricky, 2026-10-27). Beaten since:
    // faded gold, as its ring.
    const pbTag = mobileNav && badgeKind === 'pb';
    const cornerTag = !!raceTag || pbTag;
    const eventPb = !!raceTag && pbTag;
    const cardDistance = formatDistance(activity.distance_meters, activity.activity_type);
    const cardStat = cardDistance || (activity.duration_seconds > 0 ? formatDurationClock(activity.duration_seconds) : '');
    return (
      <TouchableOpacity
        key={activity.id}
        style={[styles.jGridCard, inRow && styles.jRowCard, cardIn(ci)]}
        activeOpacity={0.85}
        onPress={() => openDiary(flatOrdered, activity.id)}
      >
        {activity.photo_url ? (
          <CoverImage
            uri={activity.photo_url}
            focalX={activity.photo_focal_x}
            focalY={activity.photo_focal_y}
            style={styles.jCardPhoto}
          />
        ) : (
          <View style={styles.jCardArt}>
            {/* Phones: the sky for the hour it started, with the icon
                large and faint over it (Ricky, 2026-10-14). */}
            {wide ? null : <SkyBackdrop startedAt={activity.started_at} utcOffsetSeconds={activity.utc_offset_seconds} />}
            {/* In a View: a drawn icon (CrossFit, HYROX) is a bare <svg> on
                web, which painted under the positioned sky and vanished. */}
            <View>
              {wide
                ? <RivalIcon name={activityIconName(activity.activity_type)} size={48} color={RivalColors.accentText} />
                : <RivalIcon name={activityIconName(activity.activity_type)} size={128} color="rgba(255,255,255,0.16)" />}
            </View>
          </View>
        )}
        <View style={[styles.jCardScrim, { pointerEvents: 'none' }]} />
        {cornerTag ? (
          <View style={[styles.jCardTags, { pointerEvents: 'none' }]}>
            {raceTag ? (
              <View style={styles.jCardEventTag}>
                <RivalIcon name="flag" size={10} color="#2a2116" />
                <Text style={styles.jCardEventTagText}>{raceTag}</Text>
              </View>
            ) : null}
            {pbTag ? (
              <View style={[styles.jCardEventTag, styles.jCardPbTag, !currentPb && styles.jCardPbTagFaded]}>
                <RivalIcon name="trophy" size={10} color={currentPb ? '#2a2116' : RivalColors.rankAnchors.unrivaled} />
                <Text style={[styles.jCardEventTagText, !currentPb && { color: RivalColors.rankAnchors.unrivaled }]}>PB</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={[styles.jCardDayBadge, cornerTag && [styles.jCardDayBadgeSide, activity.pinned && { right: 36 }], { pointerEvents: 'none' }]}>
          <Text style={styles.jCardDayText}>{filtering
            ? new Date(activity.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
            : cornerTag ? dayOfWeekLabel(activity.started_at).slice(0, 3) : dayOfWeekLabel(activity.started_at)}</Text>
        </View>
        {activity.pinned && (
          <View style={styles.jCardPin}>
            <GoldStar size={18} />
          </View>
        )}
        {prOnly && currentPb ? (
          <View style={[styles.jCardCurrent, { pointerEvents: 'none' }]}><Text style={styles.jCardCurrentText}>Current</Text></View>
        ) : null}
        <View style={styles.jCardBody}>
          <View style={{ flex: 1 }}>
            {/* Phones: the distance leads and the title steps back, the
                two styles swapped (Ricky, 2026-10-11). */}
            <Text style={wide ? styles.jCardName : [styles.jCardStat, { marginTop: 0, color: RivalColors.accentText }]} numberOfLines={1}>{cardDisplayName(activity.name, activity.activity_type)}</Text>
            {!!cardStat && <Text style={wide ? styles.jCardStat : [styles.jCardName, { marginTop: 2 }]}>{cardStat}</Text>}
          </View>
          <View style={styles.jCardEffort}>
            {/* Phones: the label above the number (Ricky, 2026-10-11). */}
            {!wide ? <Text style={styles.jCardEffortLabel}>Effort</Text> : null}
            <Text style={styles.jCardEffortNum}>{activity.effort_score}</Text>
            {wide ? <Text style={styles.jCardEffortLabel}>Effort</Text> : null}
          </View>
        </View>
        {badgeKind && <View style={[styles.jCardRing, eventPb ? styles.jCardRingEventPb : { borderColor: ringColor }, { pointerEvents: 'none' }]} />}
      </TouchableOpacity>
    );
  }

  // Month layout's calendar pages — one per calendar month present in
  // allActivities (capped at 100 rows, so realistically the last few
  // months), always including the current month even if it's empty yet.
  // Ascending order (oldest first) so "previous month" sits to the left and
  // the pager can be scrolled to the last (current) page on mount.
  // Unfiltered, like Week's thisWk/thisWeekTotal — the "This Month" header
  // numbers stay put when a filter is toggled; only the calendar cells below
  // react (via filteredMonthByKey).
  const monthGroups = useMemo(() => computeMonthGroups(allActivities), [allActivities]);
  // Type/PBs-only/date-filtered version, keyed by "year-month", so the
  // calendar day cells can react to the same corner-button filters as
  // Week's and Rows' card grids without touching the header stats above.
  const filteredMonthByKey = useMemo(() => new Map(
    computeMonthGroups(filteredActivities).map((g) => [`${g.year}-${g.month}`, g])
  ), [filteredActivities]);

  // Full-width paging (chevron buttons are the swipe affordance instead of
  // a peek carousel) — each month card is exactly the pager's width.
  const monthPageWidth = monthPagerWidth;
  const monthStride = monthPageWidth;
  // Single fixed stat card's data — driven by `visibleMonthIndex` (which
  // month is currently centered in the calendar carousel), not duplicated
  // per month like the calendar cards themselves.
  const activeMg = monthGroups[Math.min(visibleMonthIndex, monthGroups.length - 1)] ?? monthGroups[monthGroups.length - 1];
  const activeMonthPrevDate = new Date(activeMg.year, activeMg.month - 1, 1);
  const activeMonthPrevTotal = monthGroups.find(
    (g) => g.year === activeMonthPrevDate.getFullYear() && g.month === activeMonthPrevDate.getMonth()
  )?.total ?? 0;
  const activeMonthEffortDelta = activeMonthPrevTotal > 0 ? Math.round((activeMg.total - activeMonthPrevTotal) / activeMonthPrevTotal * 100) : null;
  const activeMonthContextLine = ((): { highlight: string; rest: string } | null => {
    if (activeMg.count === 0) return null;
    const earned = formatDuration(activeMg.seconds);
    const candidates: Array<{ highlight: string; rest: string }> = [];
    if (activeMonthPrevTotal > 0) {
      const gap = Math.round((activeMonthPrevTotal - activeMg.total) * 10) / 10;
      if (gap > 0) candidates.push({ highlight: `${gap} Effort`, rest: ' until you match last month.' });
      else candidates.push({ highlight: `You've already beaten last month's Effort`, rest: ' — keep it up.' });
    }
    const bestMonthEver = Math.max(0, ...monthGroups.filter((g) => !(g.year === activeMg.year && g.month === activeMg.month)).map((g) => g.total));
    if (bestMonthEver > 0 && activeMg.total < bestMonthEver) {
      const gap = Math.round((bestMonthEver - activeMg.total) * 10) / 10;
      candidates.push({ highlight: `${gap} Effort`, rest: ' until your strongest month.' });
    }
    if (candidates.length === 0) {
      return { highlight: `You've earned ${earned}`, rest: ' this month. Every activity counts.' };
    }
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000));
    return candidates[dayOfYear % candidates.length];
  })();
  const activeMonthToday = new Date();
  const activeLastMonthDate = new Date(activeMonthToday.getFullYear(), activeMonthToday.getMonth() - 1, 1);
  const activeRecapTitleText =
    activeMg.year === activeMonthToday.getFullYear() && activeMg.month === activeMonthToday.getMonth() ? 'This Month'
    : activeMg.year === activeLastMonthDate.getFullYear() && activeMg.month === activeLastMonthDate.getMonth() ? 'Last Month'
    : 'Month Total';
  // Performs the actual re-snap-to-current-month scroll once the carousel's
  // width is known (the reset effect near the top just clears the guard so
  // this fires again on every re-entry into Month view).
  useEffect(() => {
    if (journalLayout !== 'month' || hasScrolledMonthPager.current || !monthPagerWidth) return;
    hasScrolledMonthPager.current = true;
    const targetIndex = monthGroups.length - 1;
    setVisibleMonthIndex(targetIndex);
    monthPagerRef.current?.scrollTo({ x: targetIndex * monthStride, animated: false });
  }, [journalLayout, monthPagerWidth, monthGroups.length, monthStride]);

  somethingOpen.current = !!diaryList || !!enlargedPhoto;
  backToStart.current = () => {
    weekPagerRef.current?.scrollTo({ y: 0, animated: true });
    const last = monthGroups.length - 1;
    if (last >= 0) {
      setVisibleMonthIndex(last);
      monthPagerRef.current?.scrollTo({ x: last * monthStride, animated: true });
    }
    monthScrollRef.current?.scrollTo({ y: 0, animated: true });
    yearScrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const currentWeekStartForHero = getMondayStart(new Date());
  // Last Monday on the calendar (not 7 x 24 hours back, which misses by an
  // hour in a week the clocks change).
  const lastWeekStart = (() => { const d = new Date(currentWeekStartForHero); d.setDate(d.getDate() - 7); return getMondayStart(d); })();
  // allActivities is capped at 100 most-recent rows (see loadActivities) — plenty
  // for a streak read, which only ever looks a handful of weeks back.
  const streak = useMemo(() => calculateStreak(allActivities), [allActivities]);

  // Weekly momentum — the hero tells a story (this week vs last), not just a number.
  function weekAgg(weekStart: number) {
    const acts = allActivities.filter(a => getMondayStart(new Date(a.started_at)) === weekStart);
    return {
      count: acts.length,
      effort: acts.reduce((s, a) => s + (a.effort_score || 0), 0),
      seconds: acts.reduce((s, a) => s + (a.duration_seconds || 0), 0),
      km: acts.reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000,
      elevationM: acts.reduce((s, a) => s + (a.elevation_meters || 0), 0),
    };
  }
  const thisWk = weekAgg(currentWeekStartForHero);
  const lastWk = weekAgg(lastWeekStart);
  const thisWeekCount = thisWk.count;
  const effortDelta = lastWk.effort > 0 ? Math.round((thisWk.effort - lastWk.effort) / lastWk.effort * 100) : null;

  // One real, computed line of encouragement — never generic filler, always
  // tied to this week's actual numbers.
  // Split into a highlighted lead-in (rendered in accent color) + the rest, so
  // the nudge carries the same visual weight as the delta stat above it instead
  // of reading as a muted footnote.
  // Several angles can all be true at once (behind last week, below your best
  // week, below your monthly average, mid-streak) — rotate between whichever
  // apply so the hero doesn't say the exact same thing every day. The pick is
  // seeded by the day-of-year so it's stable within a day, not random per render.
  function weekContextLine(): { highlight: string; rest: string } | null {
    if (thisWk.count === 0) return null; // heroDeltaMuted already covers the empty case
    const earned = formatDuration(thisWk.seconds);

    const candidates: Array<{ highlight: string; rest: string }> = [];

    if (lastWk.effort > 0) {
      const gap = Math.round((lastWk.effort - thisWk.effort) * 10) / 10;
      if (gap > 0) candidates.push({ highlight: `${gap} Effort`, rest: ' until you match last week.' });
      else candidates.push({ highlight: `You've already beaten last week's Effort`, rest: ' — keep it up.' });
    }

    // All-time best week (excluding this one in progress).
    const weeklyEffort = new Map<number, number>();
    allActivities.forEach((a) => {
      const ws = getMondayStart(new Date(a.started_at));
      if (ws === currentWeekStartForHero) return;
      weeklyEffort.set(ws, (weeklyEffort.get(ws) || 0) + (a.effort_score || 0));
    });
    const bestWeekEver = Math.max(0, ...weeklyEffort.values());
    if (bestWeekEver > 0 && thisWk.effort < bestWeekEver) {
      const gap = Math.round((bestWeekEver - thisWk.effort) * 10) / 10;
      candidates.push({ highlight: `${gap} Effort`, rest: ' until your strongest week.' });
    }

    // Average weekly effort so far this calendar month (excluding this week).
    const now = new Date();
    const monthWeeks = Array.from(weeklyEffort.entries()).filter(([ws]) => {
      const d = new Date(ws);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    if (monthWeeks.length > 0) {
      const monthlyAvg = monthWeeks.reduce((s, [, e]) => s + e, 0) / monthWeeks.length;
      if (monthlyAvg > 0 && thisWk.effort >= monthlyAvg) {
        const ahead = Math.round((thisWk.effort - monthlyAvg) * 10) / 10;
        candidates.push({ highlight: `${ahead} Effort`, rest: ' ahead of your monthly average.' });
      }
    }

    if (streak.current > 0) {
      candidates.push({ highlight: `Keep your ${streak.current}-week streak`, rest: ' alive.' });
    }

    if (candidates.length === 0) {
      return { highlight: `You've earned ${earned}`, rest: ' this week. Every activity counts.' };
    }

    const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000));
    return candidates[dayOfYear % candidates.length];
  }
  const contextLine = weekContextLine();

  // The week card's ladder (Ricky, 2026-10-16): last week, the monthly
  // average, the best week this month and the strongest week ever, each a
  // rung to pass. Weeks are the finished ones, never this week itself.
  const weekCheckpoints: Checkpoint[] = (() => {
    const totals = new Map<number, number>();
    allActivities.forEach((a) => {
      const ws = getMondayStart(new Date(a.started_at));
      if (ws === currentWeekStartForHero) return;
      totals.set(ws, (totals.get(ws) || 0) + (a.effort_score || 0));
    });
    const now = new Date();
    const monthWeeks = [...totals.entries()]
      .filter(([ws]) => { const d = new Date(ws); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); })
      .map(([, e]) => e);
    const out: Checkpoint[] = [];
    if (lastWk.effort > 0) out.push({ key: 'last', label: 'Last week', value: lastWk.effort });
    if (monthWeeks.length > 1) out.push({ key: 'avg', label: 'Monthly average', value: monthWeeks.reduce((a, b) => a + b, 0) / monthWeeks.length });
    const strongest = Math.max(0, ...totals.values());
    const monthBest = Math.max(0, ...monthWeeks);
    const yearBest = Math.max(0, ...[...totals.entries()].filter(([ws]) => new Date(ws).getFullYear() === now.getFullYear()).map(([, e]) => e));
    if (monthBest > 0 && monthBest < strongest) out.push({ key: 'month', label: 'Best week this month', value: monthBest });
    if (yearBest > 0 && yearBest < strongest) out.push({ key: 'year', label: 'Best week this year', value: yearBest });
    if (strongest > 0) out.push({ key: 'top', label: 'Strongest week', value: strongest });
    // Two rungs at the same figure read as one; keep the plainer, earlier name
    // ("Last week" over "Best week this month").
    return out.filter((c, i) => !out.some((o, j) => j < i && Math.abs(o.value - c.value) < 0.05));
  })();

  // Empty-week comparison — shown in place of the (otherwise nonexistent)
  // grid when this week has no activities yet, so Monday reads as a fresh
  // scoreboard rather than a broken/blank page.
  // Empty week (option C): a line for the new week, then the most recent
  // activities, faded. Last week's if there were any; otherwise the last
  // three whenever they were, so a quiet stretch still shows the rhythm.
  // The empty This week card: only lines short enough for one line on a
  // phone (Ricky, 2026-10-19).
  const weekLine = (() => {
    const pool = QUOTES.filter((q) => (q.category === 'consistency' || q.category === 'longterm' || q.category === 'progress') && q.text.length <= 27);
    const src = pool.length ? pool : QUOTES;
    return src[hashStr(String(currentWeekStartForHero)) % src.length];
  })();
  const weekQuote = (() => {
    const pool = QUOTES.filter((q) => q.category === 'consistency' || q.category === 'longterm' || q.category === 'progress');
    const src = pool.length ? pool : QUOTES;
    return src[hashStr(String(currentWeekStartForHero)) % src.length];
  })();
  const lastWeekActs = allActivities.filter((a) => {
    const t = new Date(a.started_at).getTime();
    return t >= lastWeekStart && t < currentWeekStartForHero;
  });

  const emptyWeekLine = lastWk.count > 0
    ? `Last week: ${Math.round(lastWk.effort)} Effort across ${lastWk.count} ${lastWk.count === 1 ? 'activity' : 'activities'}.`
    : 'Every week is a fresh start.';

  // Monthly PB snapshot — a calendar-month roundup of every record set (both
  // cardio distance/duration PBs from `pbs` and lift PRs tagged on exercises),
  // not just this week's. Reuses data already loaded, no extra query.
  const now = new Date();
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });
  type MonthlyPb = { id: string; eyebrow: string; title: string; value: string; unit: string; progress: string | null; date: string };
  const monthlyPbs: MonthlyPb[] = [];
  allActivities.forEach((a) => {
    const d = new Date(a.started_at);
    if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return;
    if (pbs[a.id] && !liftPbs[a.id]) {
      const useDistance = DISTANCE_SPORTS.has(a.activity_type);
      // Second-best of the same type gives the "how much better" delta line.
      const rivals = allActivities.filter(o => o.activity_type === a.activity_type && o.id !== a.id);
      if (useDistance) {
        const prev = Math.max(0, ...rivals.map(o => o.distance_meters || 0));
        const deltaM = (a.distance_meters || 0) - prev;
        const deltaLabel = deltaM >= 1000 ? `${(deltaM / 1000).toFixed(1)}KM` : `${Math.round(deltaM)}M`;
        const useMeters = METERS_SPORTS.has(a.activity_type);
        monthlyPbs.push({
          id: a.id, eyebrow: 'RECORD DISTANCE', title: a.activity_type,
          value: useMeters ? `${Math.round(a.distance_meters || 0)}` : ((a.distance_meters || 0) / 1000).toFixed(1),
          unit: useMeters ? 'M' : 'KM',
          progress: prev > 0 ? `+${deltaLabel} IMPROVEMENT` : null,
          date: a.started_at,
        });
      } else {
        const prev = Math.max(0, ...rivals.map(o => o.duration_seconds || 0));
        const deltaMin = Math.round(((a.duration_seconds || 0) - prev) / 60);
        monthlyPbs.push({
          id: a.id, eyebrow: 'RECORD DURATION', title: a.activity_type,
          value: formatDuration(a.duration_seconds), unit: '',
          progress: prev > 0 && deltaMin > 0 ? `+${deltaMin} MIN IMPROVEMENT` : null,
          date: a.started_at,
        });
      }
    }
    // A lift PB by the shared rule (lib/liftPb.ts); every tagged lift used to
    // count here, PB or not.
    const lp = liftPbs[a.id];
    if (lp) {
      const delta = lp.prevKg ? Math.round((lp.weightKg - lp.prevKg) * 10) / 10 : null;
      monthlyPbs.push({
        id: `${a.id}-${lp.lift}`, eyebrow: 'NEW PEAK REACHED', title: lp.lift,
        value: `${lp.weightKg}`, unit: 'KG',
        progress: delta && delta > 0 ? `+${delta}KG IMPROVEMENT` : null,
        date: a.started_at,
      });
    }
  });
  monthlyPbs.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());

  // The phone's month bests (Ricky, 2026-10-16, option B): what, the day and
  // what it beat, with the new fastest times included.
  const monthBests: MonthBest[] = [];
  allActivities.forEach((a) => {
    const d = new Date(a.started_at);
    if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return;
    const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const noun = activityTypeLabel(a.activity_type).toLowerCase();
    const icon = activityIconName(a.activity_type);
    if (pbs[a.id]) {
      const prev = pbPrev[a.id];
      if (DISTANCE_SPORTS.has(a.activity_type)) {
        const shown = formatActivityDistance(a.distance_meters, a.activity_type) ?? '';
        const [value, unit] = shown.split(' ');
        monthBests.push({
          key: `${a.id}-far`, activityId: a.id, icon, title: `Farthest ${noun}`,
          sub: day, was: prev ? formatActivityDistance(prev, a.activity_type) ?? undefined : undefined,
          value, unit, date: a.started_at,
        });
      } else {
        monthBests.push({
          key: `${a.id}-long`, activityId: a.id, icon, title: `Longest ${noun}`,
          sub: day, was: prev ? formatDurationClock(prev) : undefined,
          value: formatDurationClock(a.duration_seconds), date: a.started_at,
        });
      }
    }
    (fastest[a.id] ?? []).forEach((b) => {
      monthBests.push({
        key: `${a.id}-${b.meters}`, activityId: a.id, icon, title: fastestTitle(b),
        sub: day, was: formatDurationClock(b.prevSeconds),
        value: formatDurationClock(b.seconds), date: a.started_at,
      });
    });
    (a.exercises || []).forEach((ex) => {
      if (!ex.prLift) return;
      // The figure that made it a best: the weight, or for a lift done
      // without one, sets × reps. Compared with the same lift logged before;
      // the first time it is logged there is nothing struck through.
      const started = d.getTime();
      const volume = (e: { sets?: number | null; reps?: number | null }) => (e.sets || 1) * (e.reps || 0);
      let prev: { weight: number; sets?: number | null; reps?: number | null } | null = null;
      allActivities.forEach((o) => {
        if (new Date(o.started_at).getTime() >= started) return;
        (o.exercises || []).forEach((oe) => {
          if (oe.prLift !== ex.prLift) return;
          const better = ex.weight
            ? (oe.weight || 0) > (prev?.weight ?? 0)
            : volume(oe) > (prev ? volume(prev) : 0);
          if (better) prev = { weight: oe.weight || 0, sets: oe.sets, reps: oe.reps };
        });
      });
      const p = prev as { weight: number; sets?: number | null; reps?: number | null } | null;
      // Bodyweight bests read as total reps, the figure that decides them;
      // sets × reps is the detail under the name (Ricky, 2026-10-16).
      const weighted = !!ex.weight;
      const was = weighted ? (p?.weight ? formatWeight(p.weight) : null) : (p && volume(p) > 0 ? String(volume(p)) : null);
      const split = !weighted && ex.sets && ex.sets > 1 && ex.reps ? ` · ${ex.sets} × ${ex.reps}` : '';
      monthBests.push({
        key: `${a.id}-${ex.prLift}`, activityId: a.id, icon: 'weights', title: ex.prLift,
        sub: `${day}${split}`, was: was ?? undefined,
        value: weighted ? formatWeight(ex.weight!).split(' ')[0] : ex.reps ? String(volume(ex)) : '—',
        unit: weighted ? formatWeight(ex.weight!).split(' ')[1] : ex.reps ? ' reps' : undefined,
        date: a.started_at,
      });
    });
  });
  // A first entry has nothing to beat, so it isn't a best; only the ones
  // with a figure they improved on count (Ricky, 2026-10-16).
  const monthBestsShown = monthBests.filter((b) => !!b.was);
  monthBestsShown.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());

  function ordinalDay(day: number): string {
    if (day % 10 === 1 && day !== 11) return `${day}st`;
    if (day % 10 === 2 && day !== 12) return `${day}nd`;
    if (day % 10 === 3 && day !== 13) return `${day}rd`;
    return `${day}th`;
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    const month = d.toLocaleDateString('en-US', { month: 'long' });
    return `${weekday}, ${month} ${ordinalDay(d.getDate())}`;
  }

  function formatExerciseLine(ex: ExerciseEntry) {
    const parts: string[] = [];
    if (ex.sets) parts.push(`${ex.sets}x${ex.reps ?? ''}`.replace(/x$/, ''));
    else if (ex.reps) parts.push(`${ex.reps} reps`);
    if (ex.weight) parts.push(formatWeight(ex.weight).replace(' ', ''));
    if (ex.distanceMeters) parts.push(`${toDisplayDistance(ex.distanceMeters / 1000).toFixed(1)}${distanceUnit()}`);
    return `${ex.name}${parts.length > 0 ? ` — ${parts.join(' · ')}` : ''}`;
  }

  // Sport-appropriate pace: cycling reads as speed (km/h), swimming as /100m,
  // everything else as min/km.
  function formatPace(meters: number, seconds: number, activityType: string): string | null {
    if (!DISTANCE_SPORTS.has(activityType) || !meters || meters < 100 || !seconds) return null;
    return formatSpeedOrPace(meters, seconds, activityType);
  }

  function formatDistance(meters: number, activityType?: string) {
    return formatActivityDistance(meters, activityType, 100);
  }

  // Title — rendered as leading content INSIDE each layout's own scrollable
  // region (rather than fixed above it) so the whole page, title included,
  // scrolls as one continuous unit under the true top nav.
  // Page title in the Today style: white serif, one plain line under it.
  const journalTitle = (
    <View style={styles.jTitleBlockB}>
      <Text style={styles.jTitleB}>Activity</Text>
      <View style={styles.jSubtitleRow}>
        <View style={styles.jSubtitleRule} />
        <Text style={styles.jSubtitleB}>Every effort tells a story</Text>
        <View style={styles.jSubtitleRule} />
      </View>
    </View>
  );

  const todayIdx = (new Date().getDay() + 6) % 7;
  // Effort per day this week (Monday = 0), for the week card's columns.
  const weekDayEffort = [0, 0, 0, 0, 0, 0, 0];
  allActivities
    .filter((a) => getMondayStart(new Date(a.started_at)) === getMondayStart(new Date()))
    .forEach((a) => { weekDayEffort[(new Date(a.started_at).getDay() + 6) % 7] += a.effort_score || 0; });
  // Days this week with a personal best get the faded gold of the Effort
  // numbers instead of the usual dot (Ricky, 2026-10-14).
  const weekPbDays = new Set(
    allActivities
      .filter((a) => ((pbs[a.id] && pbPrev[a.id]) || fastest[a.id]) && getMondayStart(new Date(a.started_at)) === getMondayStart(new Date()))
      .map((a) => (new Date(a.started_at).getDay() + 6) % 7),
  );

  // The week's event, if it had one: its name, its legs in order, and the
  // days it fell on (Ricky, 2026-10-16, event weeks W2).
  const weekEvent = (acts: Activity[]) => {
    const raceId = acts.find((a) => a.race_id && races[a.race_id])?.race_id;
    if (!raceId) return null;
    const legs = acts.filter((a) => a.race_id === raceId)
      .sort((x, y) => new Date(x.started_at).getTime() - new Date(y.started_at).getTime());
    return {
      name: formatRaceName(races[raceId].name),
      tag: ['Triathlon', 'HYROX', 'CrossFit'].includes(races[raceId].race_type) ? races[raceId].race_type : 'Event',
      legs: legs.map((a) => ({
        key: a.id, type: a.activity_type,
        text: formatDistance(a.distance_meters, a.activity_type) || formatDurationClock(a.duration_seconds),
      })),
      days: new Set(legs.map((a) => (new Date(a.started_at).getDay() + 6) % 7)),
    };
  };
  const thisWeekEvent = weekEvent(allActivities.filter((a) => getMondayStart(new Date(a.started_at)) === getMondayStart(new Date())));

  // Weeks off aren't pages of their own; the swipe skips them and the next
  // older week says how many there were (Ricky, 2026-10-16, "Off B").
  // The gaps are measured between the week cards themselves (the same
  // remembered week starts), never against week starts worked out again now:
  // after a trip across time zones with the app open, the two sets sat an
  // hour apart, nothing matched, and every gap ran on to today ("6 weeks off"
  // between two active weeks, Ricky 2026-10-22). Rounding to whole weeks also
  // absorbs the hour a clock change adds or takes away.
  const WEEK_MS = 7 * 86400000;
  const activeWeekStarts = groups.filter((g) => g.activities.length > 0).map((g) => g.weekStart).sort((a, b) => a - b);
  const weeksOff = (ws: number, dir: 1 | -1) => {
    const neighbour = dir === 1
      ? activeWeekStarts.find((w) => w > ws + 3 * 86400000) ?? currentWeekStartForHero
      : [...activeWeekStarts].reverse().find((w) => w < ws - 3 * 86400000);
    if (neighbour === undefined) return 0;
    return Math.max(0, Math.round(Math.abs(neighbour - ws) / WEEK_MS) - 1);
  };
  const weeksOffText = (ws: number, n: number) => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    // From midday, so an hour either way never tips onto the day before.
    const from = new Date(ws + 12 * 3600000);
    from.setDate(from.getDate() + 7);
    const to = new Date(from);
    to.setDate(to.getDate() + 7 * (n - 1) + 6);
    return `${n === 1 ? '1 week' : `${n} weeks`} off · ${from.toLocaleDateString(undefined, opts)} – ${to.toLocaleDateString(undefined, opts)}`;
  };

  // Past weeks: stats only, no cover photo (Ricky, 2026-10-18).
  // A week with a personal best, by the same test as the gold ring on its
  // cards (renderJournalCard).
  const weekHasPb = (acts: Activity[]) => acts.some((a) => !!pbs[a.id] || !!fastest[a.id]?.length);

  const renderWeekCover = (group: WeekGroup, label: string, afterGap = false) => {
    const acts = group.activities;
    const seconds = acts.reduce((s, a) => s + (a.duration_seconds || 0), 0);
    const meters = acts.reduce((s, a) => s + (a.distance_meters || 0), 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    // Which of the week's seven days had an activity, Monday first.
    // Each day of the week, Monday first: the event's day in ivory, a day
    // with a personal best in gold, any other active day lit.
    const ev = weekEvent(acts);
    const wb = weekBests(acts);
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => (ev?.days.has(i) ? 'event' as const
      : wb.days.has(i) ? 'best' as const
      : acts.some((a) => (new Date(a.started_at).getDay() + 6) % 7 === i) ? 'on' as const : null));
    const bests = wb.titles;
    // A best when there is one, otherwise the Respect the week received: never
    // a comparison with the week before (Ricky, 2026-10-18).
    // Each person once, most Respect first.
    const counts = new Map<string, number>();
    acts.forEach((a) => (respectOn[a.id] ?? []).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
    const people = [...counts.keys()].sort((x, y) => counts.get(y)! - counts.get(x)!)
      .map((id) => givers[id] ?? { name: 'Someone', uri: null });
    // One best named with its figure; more than one, the first named and the
    // rest counted (Ricky, 2026-10-19).
    const chip = bests.length ? { text: bests[0], figure: wb.figures[0] || undefined, more: bests.length - 1, best: true }
      : people.length ? { text: '', people }
      : null;
    const dist = meters >= 100 ? (formatActivityDistance(meters, 'Run') ?? '').split(' ') : null;
    const totals = [
      // Time, distance, activities, as on This week.
      { parts: h > 0 ? [{ value: String(h), unit: 'h' }, { value: String(m).padStart(2, '0'), unit: 'm' }] : [{ value: String(m), unit: 'min' }], label: 'Time' },
      ...(dist ? [{ parts: [{ value: dist[0], unit: dist[1] }], label: 'Distance' }] : []),
      { parts: [{ value: String(acts.length) }], label: acts.length === 1 ? 'Activity' : 'Activities' },
    ];
    // Week rows (Ricky, 2026-10-27): no card around a past week, just its
    // heading, Effort and three tiles in the Add an activity pop-up's grey,
    // then its days as one row underneath (renderWeekRow).
    void days; void chip;
    return (
      <View style={[styles.pwHead, afterGap && styles.pwHeadAfterGap]}>
        <View style={styles.pwHeadRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.pwKicker, ev && { color: RivalColors.event }]}>{ev ? `${label} · ${formatWeekRangeCompact(group.weekStart)}` : formatWeekRangeCompact(group.weekStart)}</Text>
            <Text style={styles.pwTitle}>{ev ? ev.name : label}</Text>
            {/* Phones: an event's label and a PB label under the week's
                name, as on their cards; PB solid while one of its records
                still stands (Ricky, 2026-10-27). */}
            {!wide && (ev || weekHasPb(acts)) ? <View style={styles.pwTitleRow}>
              {ev ? (
                <View style={styles.pwEventTag}>
                  <RivalIcon name="flag" size={10} color="#2a2116" />
                  <Text style={styles.jCardEventTagText}>{ev.tag}</Text>
                </View>
              ) : null}
              {weekHasPb(acts) ? (() => {
                const standing = acts.some((a) => currentPbIds.has(a.id));
                return (
                  <View style={[styles.pwPbTag, !standing && styles.jCardPbTagFaded]}>
                    <RivalIcon name="trophy" size={10} color={standing ? '#2a2116' : RivalColors.rankAnchors.unrivaled} />
                    <Text style={[styles.jCardEventTagText, !standing && { color: RivalColors.rankAnchors.unrivaled }]}>PB</Text>
                  </View>
                );
              })() : null}
            </View> : null}
          </View>
          <View style={styles.pwEffort}>
            <Text style={styles.pwEffortNum}>{Math.round(group.total).toLocaleString()}</Text>
            <Text style={styles.pwEffortLabel}>Effort</Text>
          </View>
        </View>
        <View style={styles.pwTiles}>
          {totals.map((t) => (
            <View key={t.label} style={styles.pwTile}>
              <Text style={styles.pwTileFig}>
                {(t.parts as { value: string; unit?: string }[]).map((p, pi) => (
                  <Text key={pi}>{p.value}{p.unit ? <Text style={styles.pwTileUnit}>{p.unit}</Text> : null}{pi < t.parts.length - 1 ? ' ' : ''}</Text>
                ))}
              </Text>
              <Text style={styles.pwTileLabel}>{t.label}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  // A week as one row in day order, Monday first (Ricky, 2026-10-27, Week
  // rows): each day's activities as the usual cards, a day with nothing as a
  // thin, darker card with its date, which opens Add an activity for that day.
  // This week runs to today and ends with today's card.
  const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const DAY_SHORT_UP = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  function renderWeekRow(acts: Activity[], weekStart: number, current: boolean) {
    const dayOf = (a: Activity) => (new Date(a.started_at).getDay() + 6) % 7;
    const sorted = [...acts].sort((x, y) => new Date(x.started_at).getTime() - new Date(y.started_at).getTime());
    // Phones: an event's activities leave the row for one full-width card
    // under it, and each of its days is marked in the row (Ricky, 2026-10-27,
    // option 3).
    const events: { raceId: string; legs: Activity[]; pb: boolean }[] = [];
    if (mobileNav) {
      sorted.forEach((a) => {
        if (!a.race_id || !races[a.race_id]) return;
        let ev = events.find((e) => e.raceId === a.race_id);
        if (!ev) { ev = { raceId: a.race_id, legs: [], pb: false }; events.push(ev); }
        ev.legs.push(a);
        if (pbs[a.id] || fastest[a.id]?.length) ev.pb = true;
      });
    }
    const eventDay = new Map<number, (typeof events)[number]>();
    events.forEach((ev) => ev.legs.forEach((a) => { if (!eventDay.has(dayOf(a))) eventDay.set(dayOf(a), ev); }));
    const byDay: Activity[][] = [[], [], [], [], [], [], []];
    sorted.filter((a) => !(mobileNav && a.race_id && races[a.race_id])).forEach((a) => byDay[dayOf(a)].push(a));
    const lastDay = current ? todayIdx : 6;
    const cells: ReactNode[] = [];
    let ci = 0;
    for (let i = 0; i <= lastDay; i++) {
      // By the calendar, not by adding hours, so a clock change can't shift it.
      const day = new Date(weekStart + 12 * 3600000);
      day.setDate(day.getDate() + i);
      const ev = eventDay.get(i);
      if (ev) {
        cells.push(
          <TouchableOpacity
            key={`event-${i}`}
            style={[styles.restDay, styles.eventDay]}
            activeOpacity={0.8}
            onPress={() => openDiary(flatOrdered, ev.legs[0].id)}
            accessibilityRole="button"
            accessibilityLabel={`${formatRaceName(races[ev.raceId].name)}, ${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`}
          >
            <RivalIcon name="flag" size={12} color={RivalColors.event} />
            <Text style={[styles.restDayNum, { color: RivalColors.event }]}>{day.getDate()}</Text>
            <Text style={[styles.restDayName, { color: RivalColors.event }]}>{DAY_SHORT_UP[i]}</Text>
            <View style={[styles.eventDayEdge, ev.pb ? styles.eventEdgePb : null, { pointerEvents: 'none' }]} />
          </TouchableOpacity>,
        );
      }
      if (byDay[i].length) {
        byDay[i].forEach((a) => cells.push(renderJournalCard(a, ci++, true)));
      } else if (ev) {
        continue;
      } else if (current && i === todayIdx) {
        continue;
      } else {
        const iso = isoOf(day);
        cells.push(
          <Pressable
            key={`rest-${iso}`}
            style={({ pressed }) => [styles.restDay, pressed && styles.restDayPressed]}
            onPress={() => router.push(`/add-workout?date=${iso}`)}
            accessibilityRole="button"
            accessibilityLabel={`Add an activity on ${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`}
          >
            {({ pressed }) => (
              <>
                <RivalIcon name="add" size={16} color={pressed ? 'rgba(255,181,158,0.8)' : 'transparent'} style={styles.restDayPlus} />
                <Text style={styles.restDayNum}>{day.getDate()}</Text>
                <Text style={styles.restDayName}>{DAY_SHORT_UP[i]}</Text>
              </>
            )}
          </Pressable>,
        );
      }
    }
    if (current) {
      const now = new Date();
      cells.push(
        <TouchableOpacity key="today" style={styles.todayCard} activeOpacity={0.85} onPress={() => router.push('/add-workout')} accessibilityRole="button" accessibilityLabel="Add an activity today">
          <Text style={styles.todayLabel}>{now.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}</Text>
          <Text style={styles.todayNum}>{now.getDate()}</Text>
          <Text style={[styles.todayLabel, { color: 'rgba(255,255,255,0.55)' }]}>TODAY</Text>
          <View style={styles.todayPlus}><RivalIcon name="add" size={22} color={RivalButtonColors.label(RivalColors.onAccentFill)} /></View>
        </TouchableOpacity>,
      );
    }
    const row = (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.weekRow}
        contentContainerStyle={styles.weekRowInner}
        // This week opens at today, at the end of the row.
        onContentSizeChange={current ? () => thisWeekRowRef.current?.scrollToEnd({ animated: false }) : undefined}
        ref={current ? (r) => { thisWeekRowRef.current = r; } : undefined}
      >
        {cells}
      </ScrollView>
    );
    if (!events.length) return row;
    return (
      <>
        {row}
        {events.map((ev) => renderEventCard(ev))}
      </>
    );
  }

  // An event in one full-width card under its week's row: its photo on the
  // left; its legs (one day) or its days (several) on the right; the finish
  // time and its Effort added up. Its edge is ivory, running into gold when
  // one of its activities was a PB (Ricky, 2026-10-27, option 3).
  function renderEventCard(ev: { raceId: string; legs: Activity[]; pb: boolean }) {
    const race = races[ev.raceId];
    const tag = ['Triathlon', 'HYROX', 'CrossFit'].includes(race.race_type) ? race.race_type : 'Event';
    const legs = ev.legs;
    const cover = legs.find((a) => a.photo_url);
    const dayIdx = (a: Activity) => (new Date(a.started_at).getDay() + 6) % 7;
    const days = [...new Set(legs.map(dayIdx))];
    const multiDay = days.length > 1;
    const dayName = (i: number) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i];
    const effort = Math.round(legs.reduce((t, a) => t + (Number(a.effort_score) || 0), 0) * 10) / 10;
    const seconds = legs.reduce((t, a) => t + (a.duration_seconds || 0), 0);
    const result = !multiDay && race.actual_finish_time ? race.actual_finish_time
      : multiDay ? `${legs.length} ${legs.length === 1 ? 'activity' : 'activities'}`
      : formatDurationClock(seconds);
    const shownLegs = legs.slice(0, 3);
    const shownDays = days.slice(0, 4);
    return (
      <TouchableOpacity
        key={`eventcard-${ev.raceId}`}
        style={styles.eventCard}
        activeOpacity={0.88}
        onPress={() => openDiary(flatOrdered, legs[0].id)}
        accessibilityRole="button"
        accessibilityLabel={formatRaceName(race.name)}
      >
        <View style={styles.eventPhoto}>
          {cover?.photo_url ? (
            <CoverImage uri={cover.photo_url} focalX={cover.photo_focal_x} focalY={cover.photo_focal_y} style={styles.jCardPhoto} />
          ) : (
            <View style={styles.jCardArt}>
              <SkyBackdrop startedAt={legs[0].started_at} utcOffsetSeconds={legs[0].utc_offset_seconds} />
              <RivalIcon name="flag" size={72} color="rgba(255,255,255,0.16)" />
            </View>
          )}
        </View>
        <View style={styles.eventPanel}>
          <View style={styles.eventTop}>
            <View style={styles.eventTags}>
              <View style={styles.jCardEventTag}>
                <RivalIcon name="flag" size={10} color="#2a2116" />
                <Text style={styles.jCardEventTagText}>{tag}</Text>
              </View>
              {ev.pb ? (
                <View style={[styles.jCardEventTag, styles.jCardPbTag]}>
                  <RivalIcon name="trophy" size={10} color="#2a2116" />
                  <Text style={styles.jCardEventTagText}>PB</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.eventWhen}>{multiDay ? `${dayName(days[0])} – ${dayName(days[days.length - 1])}` : dayName(days[0])}</Text>
          </View>
          {multiDay ? (
            <View style={styles.eventChips}>
              {shownDays.map((d) => {
                const dayLegs = legs.filter((a) => dayIdx(a) === d);
                const dayEffort = Math.round(dayLegs.reduce((t, a) => t + (Number(a.effort_score) || 0), 0));
                return (
                  <View key={d} style={styles.eventChip}>
                    <Text style={styles.eventChipDay}>{dayName(d).toUpperCase()}</Text>
                    <Text style={styles.eventChipNum}>{dayEffort}</Text>
                    <Text style={styles.eventChipSub}>{dayLegs.length === 1 ? '1 activity' : `${dayLegs.length} activities`}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.eventLegs}>
              {shownLegs.map((a) => (
                <View key={a.id} style={styles.eventLeg}>
                  <RivalIcon name={activityIconName(a.activity_type)} size={13} color={RivalColors.accentText} />
                  <Text style={styles.eventLegDist} numberOfLines={1}>{formatDistance(a.distance_meters, a.activity_type) || activityTypeLabel(a.activity_type)}</Text>
                  <Text style={styles.eventLegTime}>{a.duration_seconds > 0 ? formatDurationClock(a.duration_seconds) : ''}</Text>
                </View>
              ))}
              {legs.length > shownLegs.length ? <Text style={styles.eventMore}>{`${legs.length - shownLegs.length} more`}</Text> : null}
            </View>
          )}
          <View style={styles.eventFoot}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.eventName}>{formatRaceName(race.name)}</Text>
              <Text style={styles.eventResult}>{result}</Text>
            </View>
            <View style={styles.jCardEffort}>
              <Text style={styles.jCardEffortLabel}>Effort</Text>
              <Text style={styles.jCardEffortNum}>{effort}</Text>
            </View>
          </View>
        </View>
        <View style={[styles.eventEdge, ev.pb ? styles.eventEdgePb : null, { pointerEvents: 'none' }]} />
      </TouchableOpacity>
    );
  }

  // For past week cards: the week's bests.
  const weekBests = (acts: Activity[]) => {
    const days = new Set<number>();
    const titles: string[] = [];
    // The figure that set each best, in the same order as titles.
    const figures: string[] = [];
    acts.forEach((a) => {
      const noun = activityTypeLabel(a.activity_type).toLowerCase();
      const pb = !!pbs[a.id] && !!pbPrev[a.id];
      if (pb) {
        const far = DISTANCE_SPORTS.has(a.activity_type);
        titles.push(far ? `Farthest ${noun}` : `Longest ${noun}`);
        figures.push(far ? (formatDistance(a.distance_meters, a.activity_type) ?? '') : formatDuration(a.duration_seconds));
      }
      (fastest[a.id] ?? []).forEach((b) => { titles.push(fastestTitle(b)); figures.push(formatDurationClock(b.seconds)); });
      if (pb || fastest[a.id]?.length) days.add((new Date(a.started_at).getDay() + 6) % 7);
    });
    return { days, titles, figures };
  };

  // 3-way layout switch (Rows/Week/Month) — sits directly below the stat
  // card (tight, via negative margin, matching the filterBarTight pattern
  // just below it — `wide` picks the right negative-margin variant for
  // whichever container gap it's sitting in, jWeekPage vs jContent). One
  // shared function to avoid the triplication (and drift) that came from
  // copy-pasting this into all three layout blocks previously.
  function renderJournalToggle(wide: boolean, withAdd = false) {
    // Filter sits beside Week, Month and Year; what is on shows underneath
    // (Ricky, 2026-10-16, option A).
    return (
      <View>
      <View style={[styles.jLayoutToggleRow, styles.jLayoutToggleRowSplit, wide ? styles.jLayoutToggleRowTightWide : styles.jLayoutToggleRowTight]}>
        <View style={styles.jLayoutToggle}>
          {([
            { key: 'weekly' as const, icon: 'calendar' as const, label: 'Week' },
            { key: 'month' as const, icon: 'calendarMonth' as const, label: 'Month' },
            { key: 'year' as const, icon: 'stats' as const, label: 'Year' },
          ]).map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.jLayoutToggleItem, journalLayout === opt.key && styles.jLayoutToggleItemActive]}
              onPress={() => setJournalLayout(opt.key)}
            >
              <RivalIcon name={opt.icon} size={13} color={journalLayout === opt.key ? '#fff' : 'rgba(255,255,255,0.6)'} />
              <Text style={[styles.jLayoutToggleLabel, journalLayout === opt.key && styles.jLayoutToggleLabelActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {withAdd ? (
          // Filter drops its word so the + fits beside it (Ricky, 2026-10-27).
          <View style={styles.toggleRight}>
            <FilterButton count={filterCount(activityFilters)} onPress={() => setFilterSheetOpen(true)} iconOnly />
            <TouchableOpacity style={styles.addRound} activeOpacity={0.85} onPress={() => router.push('/add-workout')} accessibilityRole="button" accessibilityLabel="Add activity">
              <RivalIcon name="add" size={20} color={RivalButtonColors.label(RivalColors.onAccentFill)} />
            </TouchableOpacity>
          </View>
        ) : (
          <FilterButton count={filterCount(activityFilters)} onPress={() => setFilterSheetOpen(true)} />
        )}
      </View>
      <ShowingLine filters={activityFilters} onChange={setActivityFilters} />
      </View>
    );
  }

  const activityFilters: ActivityFilters = { starred: starredOnly, bests: prOnly, type: filterType, date: dateFilter };
  function setActivityFilters(f: ActivityFilters) {
    setStarredOnly(f.starred);
    setPrOnly(f.bests);
    setFilterType(f.type);
    setDateFilter(f.date);
  }

  return (
    <View style={styles.root}>
      {/* Phones: the photo only behind the top of the page, darkened and
          fading into the page colour before the cards (Ricky's pick, option A,
          2026-09-28). Desktop keeps the full-page photo. */}
      {mobileNav ? (
        <View style={[styles.photoBand, { pointerEvents: 'none' }]}>
          <Image
            source={require('../../../assets/images/backgrounds/optimized/a-single-solo-athlete-standing-on.jpg')}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          <View style={[StyleSheet.absoluteFill, styles.photoBandFade]} />
        </View>
      ) : (
        <>
          <RivalFixedBackground
            source={require('../../../assets/images/backgrounds/optimized/a-single-solo-athlete-standing-on.jpg')}
            focalPoint="50% 42%"
          />
          <View style={styles.scrim} />
        </>
      )}
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {/* Today's mobile screen has no photo at all behind its top nav (flat
            #131313), so its translucent bar reads as solid dark. This screen's
            photo (bright sky/cloud, brightest right at the top) shows through
            the same translucent bar instead — the uniform page `scrim` above
            isn't dark enough there on its own. Matches Today's look with a
            solid dark backing sized to just the nav strip, rather than
            touching the shared RivalTopNav or losing the photo further down.
            Rendered as a sibling INSIDE `container` (not outside it) so it
            shares the nav's own stacking context — `container` itself
            (position:relative + zIndex:0) otherwise traps the nav's zIndex:100
            and hides anything outside it that has a higher zIndex than
            container's own. Its zIndex here (50) only needs to beat the
            photo/scrim behind it and stay under the nav's 100. */}
        {/* Height tracks the nav's real extent: RivalTopNav now reaches UP
            through the status-bar inset (so its own background runs edge to
            edge instead of leaving a bare strip above it), which means this
            backing has to cover that inset too. Left at a flat 62 it stopped
            short, and this screen's bright sky photo showed through the top of
            the bar — reading as a nav that didn't match the strip above it. */}
        {mobileNav && <View style={[styles.navBacking, { height: insets.top + 62 }]} />}
        <RivalTopNav active="activity" />

        {mobileNav ? (
          <>
          <FilterSheet
            visible={filterSheetOpen}
            filters={activityFilters}
            onChange={setActivityFilters}
            types={activityTypes}
            shownCount={filteredActivities.length}
            dateText={dateFilter ? isoToDisplayDate(dateFilter) : null}
            onClose={() => setFilterSheetOpen(false)}
          />
          {journalLayout === 'weekly' && (
          // Weeks stacked in one continuous scroll (Ricky, 2026-10-21). It was
          // a snap pager, one week a screen, each week scrolling on its own:
          // a long week needed one swipe to reach its end and another to move
          // on, and the two scroll areas fought each other.
          <ScrollView
            ref={weekPagerRef}
            style={styles.jPager}
            contentContainerStyle={styles.jWeekList}
            onLayout={(e) => setPagerHeight(e.nativeEvent.layout.height)}
            scrollEventThrottle={64}
            onScroll={(e) => {
              const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
              if (contentOffset.y + layoutMeasurement.height * 2.5 < contentSize.height) return;
              setWeeksShown((n) => (n < groups.length ? n + 4 : n));
            }}
            showsVerticalScrollIndicator={false}
          >
            {loading && (
              <View style={[styles.jWeekPage, pagerHeight ? { height: pagerHeight } : null]}>
                <Text style={styles.emptyText}>Loading…</Text>
              </View>
            )}

            {!loading && groups.length === 0 && (
              <View style={[styles.jWeekPage, pagerHeight ? { height: pagerHeight } : null]}>
                {allActivities.length === 0 ? (
                  // A first-time visitor: say what goes here and give both ways in.
                  <View style={[rm.card, styles.firstEmpty]}>
                    <View style={rm.iconCircle}><RivalIcon name="pulse" size={20} color={RivalColors.accentText} /></View>
                    <Text style={rm.serifTitleSm}>No activities yet</Text>
                    <Text style={[rm.hint, { textAlign: 'center' }]}>Every activity you add appears here, week by week, with the Effort it earned.</Text>
                    <TouchableOpacity style={[rm.primary, styles.firstEmptyBtn]} onPress={() => router.push('/add-workout')}>
                      <Text style={rm.primaryText}>Add activity</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[rm.ghost, styles.firstEmptyBtn]} onPress={() => router.push('/import-archive')}>
                      <Text style={rm.ghostText}>Import activity history</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.emptyText}>No activities match this filter.</Text>
                )}
              </View>
            )}

            {!loading && groups.slice(0, weeksShown).map((group) => {
              const isCurrentWeek = group.weekStart === currentWeekStartForHero;
              // With a filter on, every match is one grid under this week's
              // card: no week cards or stats in between (Ricky, 2026-10-24).
              if (filtering && !isCurrentWeek) return null;
              const gridActs = filtering && isCurrentWeek ? flatOrdered : group.activities;
              // Nothing logged yet: the first-visit page instead of an empty week.
              if (isCurrentWeek && allActivities.length === 0) {
                return (
                  <View key={group.weekStart} style={[styles.jWeekPage, pagerHeight ? { minHeight: pagerHeight } : null]}>
                    {journalTitle}
                    {renderFirstVisit()}
                  </View>
                );
              }
              return (
                <View
                  key={group.weekStart}
                  style={styles.jWeekPage}
                  onLayout={(e) => { weekTops.current[group.weekStart] = e.nativeEvent.layout.y; }}
                >
                  {isCurrentWeek ? (
                    <>
                      {journalTitle}
                      {/* What isn't set up yet, as tiles at the top. */}
                      {SHOW_TRAINING_TOWARD && (
                      <View style={styles.startWrap}>
                        <RivalStartTiles
                          tiles={[
                            ...(!nextEvent ? [{ key: 'event', icon: 'flag' as const, label: 'Add event', onPress: () => router.push('/races?add=true') }] : []),
                          ]}
                        />
                      </View>
                      )}
                      {/* Hero recap card — "This Week", 3-stat grid, quote. Matches the
                          mockup's .recap-card exactly. */}
                      {/* This week: title and Effort on one row, a dot per day
                          underneath. Tap it for the details (time, distance,
                          filters). Add activity sits straight under the card. */}
                      <WeekCard
                        kicker={thisWeekEvent ? `Event week · ${formatWeekRangeCompact(currentWeekStartForHero)}` : thisWeekCount === 0 ? 'This week' : formatWeekRangeCompact(currentWeekStartForHero)}
                        title={thisWeekEvent ? thisWeekEvent.name : thisWeekCount === 0 ? '' : 'This week'}
                        event={!!thisWeekEvent}
                        effort={<CountUpNumber key={journalVisit} value={thisWeekTotal} style={thisWeekEffortStyle} />}
                        expanded={heroExpanded}
                        onToggle={() => setHeroExpanded((v) => !v)}
                        still={thisWeekCount === 0}
                        // Week rows: shorter, in the pop-up's grey, no arrow
                        // (Ricky, 2026-10-27: "looks very sad on a Monday").
                        compact
                        popup
                        noArrow
                      >
                        {thisWeekCount === 0 ? (() => {
                          // Nothing logged yet: the month so far instead of empty columns.
                          const now = new Date();
                          const inMonth = (y: number, mo: number) => allActivities.filter((a) => { const d = new Date(a.started_at); return d.getFullYear() === y && d.getMonth() === mo; });
                          // Early in a month with nothing yet: last month, whole.
                          const thisMonth = inMonth(now.getFullYear(), now.getMonth());
                          const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                          const whole = thisMonth.length === 0;
                          const monthActs = whole ? inMonth(lastStart.getFullYear(), lastStart.getMonth()) : thisMonth;
                          return (
                            <EmptyWeek
                              quote={weekLine.text}
                              whole={whole}
                              month={(whole ? lastStart : now).toLocaleDateString(undefined, { month: 'long' })}
                              count={monthActs.length}
                              seconds={monthActs.reduce((t, a) => t + (a.duration_seconds || 0), 0)}
                              meters={monthActs.reduce((t, a) => t + (a.distance_meters || 0), 0)}
                              dayOfMonth={now.getDate()}
                              daysInMonth={new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}
                            />
                          );
                        })() : <>
                        {thisWeekEvent ? <EventLegs legs={thisWeekEvent.legs} /> : null}
                        <DayColumns effort={weekDayEffort} bests={weekPbDays} today={todayIdx} events={thisWeekEvent?.days} short />
                        {heroExpanded && (
                          <>
                            {/* Each figure carries its own change on last week, so
                                the "% vs last week" line is no longer needed. */}
                            <WeekNumbers count={thisWeekCount} seconds={thisWk.seconds} km={thisWk.km} prev={lastWk} />
                            <WeekLadder effort={thisWk.effort} checkpoints={weekCheckpoints} />
                          </>
                        )}
                        </>}
                      </WeekCard>
                      {/* Add activity is the + beside Filter, today's card
                          and each empty day now (Week rows, 2026-10-27). */}
                      {/* Training toward: the next event (or Add event), then
                          Personal bests. Your own goals-to-come, kept off Today. */}
                      {SHOW_TRAINING_TOWARD && <>
                      <Text style={styles.towardLabel}>{nextEvent ? 'Working toward' : 'Records'}</Text>
                      <View style={styles.towardCard}>
                        {nextEvent && (
                        <>
                        <TouchableOpacity
                          style={styles.towardRow}
                          activeOpacity={0.8}
                          onPress={() => router.push(nextEvent ? '/races' : '/races?add=true')}
                        >
                          <View style={[styles.towardBadge, !nextEvent && styles.towardBadgeQuiet]}>
                            <RivalIcon name="flag" size={16} color={nextEvent ? RivalColors.surfaceLowest : 'rgba(255,255,255,0.6)'} />
                          </View>
                          <View style={styles.towardText}>
                            <Text style={styles.towardTitle} numberOfLines={1}>{nextEvent ? formatRaceName(nextEvent.name) : 'No event scheduled'}</Text>
                            <Text style={styles.towardSub} numberOfLines={1}>
                              {nextEvent
                                ? `${new Date(nextEvent.race_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${nextEvent.location ? ` · ${nextEvent.location}` : ''}`
                                : 'A race or competition to train for'}
                            </Text>
                          </View>
                          {nextEvent ? (() => {
                            const days = Math.max(0, Math.round((new Date(nextEvent.race_date + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime()) / 86400000));
                            return (
                              <View style={styles.towardDays}>
                                <Text style={styles.towardDaysNum}>{days === 0 ? 'Today' : days}</Text>
                                {days > 0 && <Text style={styles.towardDaysLabel}>{days === 1 ? 'DAY' : 'DAYS'}</Text>}
                              </View>
                            );
                          })() : (
                            <Text style={styles.towardAdd}>Add event</Text>
                          )}
                        </TouchableOpacity>
                        <View style={styles.towardDivider} />
                        </>
                        )}
                        <TouchableOpacity style={styles.towardRow} activeOpacity={0.8} onPress={() => router.push('/lifts')}>
                          <View style={[styles.towardBadge, styles.towardBadgeQuiet]}>
                            <RivalIcon name="trophy" size={16} color="rgba(255,255,255,0.6)" />
                          </View>
                          <View style={styles.towardText}>
                            <Text style={styles.towardTitle}>Personal bests</Text>
                            <Text style={styles.towardSub}>Lifts and best times</Text>
                          </View>
                          <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
                        </TouchableOpacity>
                      </View>
                      </>}
                      {renderJournalToggle(false, true)}

                      <MonthBests month={monthName} bests={monthBestsShown} onOpen={(id) => openDiary(allActivities, id)} />
                    </>
                  ) : (
                    <>
                    {filterCount(activityFilters) === 0 && weeksOff(group.weekStart, 1) > 0 ? (
                      <View style={[styles.weeksOff, !wide && styles.weeksOffRows]}>
                        <View style={styles.weeksOffRule} />
                        <Text style={styles.weeksOffText}>{weeksOffText(group.weekStart, weeksOff(group.weekStart, 1))}</Text>
                        <View style={styles.weeksOffRule} />
                      </View>
                    ) : null}
                    {/* Every past week the same, one activity or several: the
                        week card, then its activities (Ricky, 2026-10-18, A). */}
                    {renderWeekCover(
                      group,
                      group.weekStart === lastWeekStart ? 'Last week' : `Week ${getWeekNumber(new Date(group.weekStart))}`,
                      !wide && filterCount(activityFilters) === 0 && weeksOff(group.weekStart, 1) > 0,
                    )}
                    </>
                  )}

                  {/* Card grid — scrolls together with the hero/header above as
                      one continuous page (not a separately-clipped region). */}
                  {!filtering ? renderWeekRow(group.activities, group.weekStart, isCurrentWeek) : (
                  <View style={styles.jGridContent}>
                    {isCurrentWeek && gridActs.length === 0 ? (
                      // Monday (or any day before the first activity lands) —
                      // a lone "Add Activity" card on an otherwise-empty grid
                      // read as broken. Show a real comparison to last week
                      // instead so the page still feels alive.
                      <View style={styles.jWeekEmptyWrap}>
                        {SHOW_WEEK_QUOTE && (
                          <>
                            <Text style={styles.nwKicker}>A new week</Text>
                            <Text style={styles.nwQuote}>{`\u201C${weekQuote.text}\u201D`}</Text>
                          </>
                        )}
                        {filterCount(activityFilters) > 0 ? (
                          // Filtered: say so, rather than the new-week pointer
                          // to last week, which read as part of the filter
                          // (Ricky, 2026-10-24).
                          <Text style={styles.jWeekEmptySub}>No activities match the filter.</Text>
                        ) : lastWeekActs.length > 0 ? (
                          // Nothing here: last week's page follows below, so
                          // the card pointing to it went (Ricky, 2026-10-26).
                          null
                        ) : (
                          <Text style={styles.jWeekEmptySub}>Every activity you add or sync appears here, week by week.</Text>
                        )}
                      </View>
                    ) : (
                    <View style={styles.jGrid}>
                      {prOnly ? renderPbGroups() : gridActs.map((activity, ci) => renderJournalCard(activity, ci))}
                      {false && isCurrentWeek && (
                        // Replaced by the Add activity pill in the week card; kept.
                        // Wrapped in a full grid-column slot (matches jGridCard's
                        // flexBasis) so it lands in whichever column the wrap
                        // naturally puts it — e.g. under the 2nd card when a lone
                        // 3rd photo card takes the 1st column on the last row.
                        <View style={styles.jAddCardSlot}>
                          <TouchableOpacity
                            style={styles.jAddCard}
                            activeOpacity={0.7}
                            onPress={() => router.push('/add-workout')}
                          >
                            <RivalIcon name="add" size={22} color="rgba(255,255,255,0.6)" style={{ marginTop: -15 }} />
                            <Text style={styles.jAddCardText}>Add Activity</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    )}
                  </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          )}

          {journalLayout === 'month' && (
          // Only the calendar CARD swipes horizontally, as a peek carousel
          // (next/previous month's edge stays visible — the swipe
          // affordance). The stat card above it is a single fixed instance
          // driven by `activeMg` (= monthGroups[visibleMonthIndex]), updated
          // via onMomentumScrollEnd — not duplicated per month like before.
          // That duplication was also the source of a real bug: each month
          // page had its own independent vertical ScrollView, so mid-swipe
          // you could see two pages at different, desynced scroll positions.
          // One real vertical scroll for the whole layout fixes that
          // structurally.
          <ScrollView
            contentContainerStyle={styles.jContent}
            showsVerticalScrollIndicator={false}
            {...pullProps}
            ref={(n: any) => { monthScrollRef.current = n; (pullProps as any).ref?.(n); }}
          >
            {pullIndicator}
            {journalTitle}
            {mobileNav ? (() => {
              // Phones (Ricky, 2026-10-20, A): the month card in This week's
              // form: dates, title, Effort, a column per week, then the three
              // tiles. No comparisons with other months.
              const first = new Date(activeMg.year, activeMg.month, 1);
              const last = new Date(activeMg.year, activeMg.month, activeMg.daysInMonth);
              const monthActs = allActivities.filter((a) => { const d = new Date(a.started_at); return d.getFullYear() === activeMg.year && d.getMonth() === activeMg.month; });
              const weeks: { label: string; effort: number; current: boolean; best: boolean; event: boolean }[] = [];
              // Step by calendar weeks, not 7×24 hours: across a clock change
              // the hour-based step would miss the Monday and lose that week.
              for (const d = new Date(getMondayStart(first)); d.getTime() <= last.getTime(); d.setDate(d.getDate() + 7)) {
                const ws = d.getTime();
                // The days of the month this week covers: "5–11", "26–31".
                const start = new Date(Math.max(ws, first.getTime()));
                // By the calendar, not by adding hours, so a clock change can't shift it.
                const sunday = new Date(ws); sunday.setDate(sunday.getDate() + 6);
                const end = sunday.getTime() > last.getTime() ? last : sunday;
                const weekActs = monthActs.filter((a) => getMondayStart(new Date(a.started_at)) === ws);
                weeks.push({
                  label: start.getDate() === end.getDate() ? String(start.getDate()) : `${start.getDate()}–${end.getDate()}`,
                  effort: weekActs.reduce((t, a) => t + (a.effort_score || 0), 0),
                  best: weekBests(weekActs).titles.length > 0,
                  event: !!weekEvent(weekActs),
                  current: ws === getMondayStart(new Date()),
                });
              }
              const kicker = `${first.toLocaleDateString(undefined, { month: 'short' })} 1 – ${activeMg.daysInMonth}`;
              // Older months by name ("August", "March 2025"), not "Month Total".
              const title = activeRecapTitleText === 'This Month' ? 'This month' : activeRecapTitleText === 'Last Month' ? 'Last month'
                : first.toLocaleDateString(undefined, activeMg.year === new Date().getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
              return (
                <WeekCard kicker={kicker} title={title} effort={<Text style={weekEffortStyle}>{Math.round(activeMg.total).toLocaleString()}</Text>} expanded onToggle={() => {}} fixed>
                  <Text style={styles.monthByWeek}>By week</Text>
                  <MonthWeekColumns weeks={weeks} />
                  <WeekNumbers count={activeMg.count} seconds={activeMg.seconds} km={activeMg.km} />
                </WeekCard>
              );
            })() : (
            <WeekCard
              title={activeRecapTitleText}
              sub={activeMg.count === 1 ? '1 activity' : `${activeMg.count} activities`}
              effort={<Text style={weekEffortStyle}>{activeMg.total}</Text>}
              expanded={heroExpanded}
              onToggle={() => setHeroExpanded((v) => !v)}
            >
              {heroExpanded && (
                <>
                  <WeekNumbers count={activeMg.count} seconds={activeMg.seconds} km={activeMg.km} />
                  <WeekNote highlight={activeMonthContextLine?.highlight} rest={activeMonthContextLine?.rest} delta={null} />
                  {activeMonthEffortDelta !== null ? (
                    <Text style={styles.monthDelta}>{`${Math.abs(activeMonthEffortDelta)}% vs last month`}</Text>
                  ) : null}
                </>
              )}
            </WeekCard>
            )}
            {renderJournalToggle(true)}

            <View>
            <ScrollView
              ref={monthPagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onLayout={(e) => setMonthPagerWidth(Math.round(e.nativeEvent.layout.width))}
              // The page is tracked as it scrolls, not when the swipe settles:
              // react-native-web never fires onMomentumScrollEnd (there is no
              // such browser event), so a swipe never told the app which month
              // was showing. Months two away from the stale one were never drawn
              // (a black page) and Month Total stayed on the old month.
              scrollEventThrottle={50}
              onScroll={(e) => {
                if (monthStride <= 0) return;
                const idx = Math.max(0, Math.min(monthGroups.length - 1, Math.round(e.nativeEvent.contentOffset.x / monthStride)));
                if (monthArrowTarget.current !== null) {
                  if (idx === monthArrowTarget.current) monthArrowTarget.current = null;
                  return;
                }
                setVisibleMonthIndex((cur) => (cur === idx ? cur : idx));
              }}
            >
              {monthGroups.map((mg, mi) => {
                // Only the months near the one showing are drawn in full; two
                // either side, so a quick double swipe lands on a drawn month.
                if (Math.abs(mi - visibleMonthIndex) > 2) {
                  return <View key={`${mg.year}-${mg.month}`} style={monthPageWidth ? { width: monthPageWidth } : styles.jMonthPageFallback} />;
                }
                // Phones start the week on Monday, as everywhere else in the app.
                const leadingBlanks = mobileNav ? (mg.startWeekday + 6) % 7 : mg.startWeekday;
                const dayCells: Array<{ day: number } | null> = [
                  ...Array.from({ length: leadingBlanks }, () => null),
                  ...Array.from({ length: mg.daysInMonth }, (_, i) => ({ day: i + 1 })),
                ];
                const filteredByDay = filteredMonthByKey.get(`${mg.year}-${mg.month}`)?.byDay;
                return (
                  <View key={`${mg.year}-${mg.month}`} style={monthPageWidth ? { width: monthPageWidth } : styles.jMonthPageFallback}>
                    <View style={[styles.jMonthCard, mobileNav && styles.jMonthCardPhone]}>
                      <View style={styles.jMonthHeader}>
                        {/* Phones: the year only when it isn't this one. */}
                        <Text style={[styles.jMonthTitle, mobileNav && styles.jMonthTitlePhone]}>{mobileNav && mg.year === new Date().getFullYear() ? mg.label.replace(/\s*\d{4}$/, '') : mg.label}</Text>
                        {/* Fades to transparent at both tips instead of a hard-cut
                            border, so the line reads as tapering to a point
                            rather than just stopping. */}
                        {mobileNav ? null : <View style={styles.jMonthTitleUnderline} />}
                      </View>
                      <View style={styles.jDowRow}>
                        {(mobileNav ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']).map((d, i) => (
                          <Text key={i} style={styles.jDow}>{d}</Text>
                        ))}
                      </View>
                      <View style={styles.jCalGrid} onLayout={(e) => setCalGridWidth(e.nativeEvent.layout.width)}>
                        {dayCells.map((cell, idx) => {
                          const sizeOverride = calCellSize > 0 ? { width: calCellSize } : null;
                          if (!cell) return <View key={`blank-${idx}`} style={[styles.jCalCellEmpty, mobileNav && styles.jCalCellPhone, sizeOverride]} />;
                          const dayActs = filteredByDay?.get(cell.day) || [];
                          const isFuture = new Date(mg.year, mg.month, cell.day) > new Date();
                          const nowD = new Date();
                          const isToday = mobileNav && mg.year === nowD.getFullYear() && mg.month === nowD.getMonth() && cell.day === nowD.getDate();
                          if (dayActs.length === 0) {
                            // Today-or-earlier empty days are a quick "log this day"
                            // shortcut into manual entry, prefilled with the tapped
                            // date. Future days stay inert — can't log ahead of time.
                            if (!isFuture) {
                              const isoDate = `${mg.year}-${String(mg.month + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
                              return (
                                <TouchableOpacity
                                  key={cell.day}
                                  style={[styles.jCalCellRest, mobileNav && styles.jCalCellPhone, mobileNav && styles.jCalCellQuiet, sizeOverride]}
                                  activeOpacity={0.7}
                                  onPress={() => router.push(`/manual-entry?date=${isoDate}`)}
                                >
                                  <View style={styles.jCalIconSlot} />
                                  <Text style={[styles.jCalDaynum, isToday && styles.jCalDaynumToday]}>{cell.day}</Text>
                                </TouchableOpacity>
                              );
                            }
                            return (
                              <View key={cell.day} style={[styles.jCalCellFuture, mobileNav && styles.jCalCellPhone, mobileNav && styles.jCalCellQuiet, sizeOverride]}>
                                <View style={styles.jCalIconSlot} />
                                <Text style={styles.jCalDaynumFuture}>{cell.day}</Text>
                              </View>
                            );
                          }
                          const withPb = dayActs.find((a) => pbs[a.id]);
                          const withRace = dayActs.find((a) => a.race_id);
                          const withPhoto = dayActs.find((a) => a.photo_url);
                          const badgeStyle = withPb ? styles.jCalCellPb : withRace ? styles.jCalCellRace : null;
                          return (
                            <TouchableOpacity
                              key={cell.day}
                              style={[styles.jCalCellActive, mobileNav && styles.jCalCellPhone, mobileNav && styles.jCalCellActivePhone, badgeStyle, mobileNav && badgeStyle && styles.jCalCellBadgePhone, sizeOverride]}
                              activeOpacity={0.85}
                              onPress={() => openDiary(flatOrdered, dayActs[0].id)}
                            >
                              {/* Phones: no photo means the day's own sky, as on the
                                  day tiles (Ricky, 2026-10-20: never salmon). */}
                              {mobileNav && !withPhoto?.photo_url ? (
                                <View style={[styles.jCalCellPhoto, { pointerEvents: 'none' }]}>
                                  <SkyBackdrop startedAt={dayActs[0].started_at} utcOffsetSeconds={dayActs[0].utc_offset_seconds} />
                                </View>
                              ) : null}
                              {withPhoto?.photo_url && (
                                <CoverImage
                                  uri={withPhoto.photo_url}
                                  focalX={withPhoto.photo_focal_x}
                                  focalY={withPhoto.photo_focal_y}
                                  style={styles.jCalCellPhoto}
                                />
                              )}
                              {/* Fixed-height slot (icon or empty) ABOVE the day number,
                                  always reserved so the number lands in the same spot
                                  whether the cell shows a photo, a fallback icon, or
                                  neither — previously the number visibly jumped around
                                  depending on what else was in the cell. */}
                              <View style={styles.jCalIconSlot}>
                                {!withPhoto?.photo_url && (
                                  <RivalIcon name={activityIconName(dayActs[0].activity_type)} size={mobileNav ? 20 : 22} color={mobileNav ? 'rgba(255,255,255,0.75)' : RivalColors.accentText} style={mobileNav ? undefined : { opacity: 0.55 }} />
                                )}
                              </View>
                              <Text style={[withPhoto || mobileNav ? styles.jCalDaynumPhoto : styles.jCalDaynumActive, isToday && styles.jCalDaynumToday]}>{cell.day}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <View style={styles.jCalLegend}>
                        <View style={styles.jCalLegendItem}>
                          <View style={[styles.jCalLegendSwatch, styles.jCalLegendSwatchPb]} />
                          <Text style={styles.jCalLegendText}>Personal Best</Text>
                        </View>
                        <View style={styles.jCalLegendItem}>
                          <View style={[styles.jCalLegendSwatch, styles.jCalLegendSwatchRace, mobileNav && { backgroundColor: RivalColors.event }]} />
                          <Text style={styles.jCalLegendText}>Event</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.jMonthChevron, styles.jMonthChevronLeft, mobileNav && styles.jMonthChevronPhone]}
              activeOpacity={0.7}
              disabled={visibleMonthIndex <= 0}
              onPress={() => {
                goToMonth(Math.max(0, visibleMonthIndex - 1));
              }}
            >
              <RivalIcon name="monthBack" size={18} color={visibleMonthIndex <= 0 ? (mobileNav ? 'rgba(255,255,255,0.25)' : RivalColors.textSecondary) : mobileNav ? 'rgba(255,255,255,0.7)' : RivalColors.accentText} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.jMonthChevron, styles.jMonthChevronRight, mobileNav && styles.jMonthChevronPhone]}
              activeOpacity={0.7}
              disabled={visibleMonthIndex >= monthGroups.length - 1}
              onPress={() => {
                goToMonth(Math.min(monthGroups.length - 1, visibleMonthIndex + 1));
              }}
            >
              <RivalIcon name="monthForward" size={18} color={visibleMonthIndex >= monthGroups.length - 1 ? (mobileNav ? 'rgba(255,255,255,0.25)' : RivalColors.textSecondary) : mobileNav ? 'rgba(255,255,255,0.7)' : RivalColors.accentText} />
            </TouchableOpacity>
            </View>
          </ScrollView>
          )}

          {journalLayout === 'year' && (
          // The year at a glance, from the activities already loaded here.
          // Extra room at the end, like the other journal views, so the last
          // button clears the floating bottom nav.
          <ScrollView contentContainerStyle={[styles.jWeekPage, styles.jYearPage]} {...pullProps} ref={(n: any) => { yearScrollRef.current = n; (pullProps as any).ref?.(n); }}>
            {pullIndicator}
            {journalTitle}
            {renderJournalToggle(false)}
            <JournalYearView activities={allActivities as any} onOpenActivity={(id) => openDiary(allActivities, id)} />
          </ScrollView>
          )}
          </>
        ) : (
        <ScrollView contentContainerStyle={styles.content}>

        {/* Hero — this week's momentum, not just a number. Two columns on wide
            screens: the score/stats story on the left, Lifts link + this
            month's PB snapshot on the right (was empty space before). */}
        <View style={styles.hero}>
          <View style={[styles.heroBody, wide && styles.heroBodyWide]}>
            <View style={styles.heroMain}>
              <Text style={styles.heroEyebrow}>THIS WEEK</Text>
              <View style={styles.heroScoreRow}>
                <Text style={styles.heroScore}>{thisWeekTotal}</Text>
                <View style={styles.heroScoreSide}>
                  <Text style={styles.heroScoreUnit}>EFFORT</Text>
                  {effortDelta !== null ? (
                    <Text style={[styles.heroDelta, { color: effortDelta >= 0 ? RivalColors.success : RivalColors.textSecondary }]}>
                      {effortDelta >= 0 ? '↑' : '↓'} {Math.abs(effortDelta)}% vs last week
                    </Text>
                  ) : (
                    <Text style={styles.heroDeltaMuted}>{thisWk.count > 0 ? 'Building momentum' : 'Log your first activity this week'}</Text>
                  )}
                </View>
              </View>

              <View style={styles.heroStatsRow}>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>{thisWeekCount}</Text>
                  <Text style={styles.heroStatLabel}>Activities</Text>
                </View>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>{formatDuration(thisWk.seconds) || '0m'}</Text>
                  <Text style={styles.heroStatLabel}>Earned</Text>
                </View>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>{thisWk.km >= 0.1 ? `${thisWk.km.toFixed(1)}` : '0'}</Text>
                  <Text style={styles.heroStatLabel}>km</Text>
                </View>
                <View style={styles.heroStat}>
                  <Text style={styles.heroStatValue}>{thisWk.elevationM >= 1 ? Math.round(thisWk.elevationM) : '0'}</Text>
                  <Text style={styles.heroStatLabel}>Elevation (m)</Text>
                </View>
                <View style={styles.heroStat}>
                  <Text style={[styles.heroStatValue, streak.current > 0 && { color: RivalColors.accentText }]}>{streak.current}w</Text>
                  <Text style={styles.heroStatLabel}>Streak</Text>
                </View>
              </View>

              {contextLine && (
                <Text style={styles.contextLine}>
                  <Text style={styles.contextLineHighlight}>{contextLine.highlight}</Text>
                  {contextLine.rest}
                </Text>
              )}
            </View>

            <View style={[styles.heroSide, wide && styles.heroSideWide]}>
              <TouchableOpacity style={styles.liftsLink} onPress={() => router.push('/lifts')}>
                <RivalIcon name="target" size={16} color={RivalColors.textSecondary} />
                <Text style={styles.liftsLinkText}>View Personal Bests</Text>
                <RivalIcon name="forward" size={14} color={RivalColors.accentText} />
              </TouchableOpacity>

              <View style={styles.monthlyPbCard}>
                <View style={styles.monthlyPbHeader}>
                  <Text style={styles.monthlyPbTitle}>{monthName} PBs</Text>
                  {monthlyPbs.length > 0 && (
                    <View style={styles.monthlyPbCount}>
                      <Text style={styles.monthlyPbCountText}>{monthlyPbs.length}</Text>
                    </View>
                  )}
                </View>
                {monthlyPbs.length === 0 ? (
                  <Text style={styles.monthlyPbEmpty}>No PBs this month.</Text>
                ) : (
                  <ScrollView style={styles.monthlyPbScroll} contentContainerStyle={styles.monthlyPbList} showsVerticalScrollIndicator={false}>
                    {monthlyPbs.map((pb) => (
                      <View key={pb.id} style={styles.monthlyPbEntry}>
                        <Text style={styles.monthlyPbName} numberOfLines={1}>{pb.title}</Text>
                        <View style={styles.monthlyPbValueRow}>
                          <Text style={styles.monthlyPbValue}>{pb.value}</Text>
                          {!!pb.unit && <Text style={styles.monthlyPbUnit}>{pb.unit}</Text>}
                        </View>
                        {!!pb.progress && (
                          <View style={styles.monthlyPbProgressRow}>
                            <RivalIcon name="trendUp" size={14} color={RivalColors.accentText} />
                            <Text style={styles.monthlyPbProgress}>{pb.progress}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Section header — no "Back" link: the top nav already shows Activity as the active tab.
            Controls collapse into a compact icon toolbar so the cards start almost
            immediately after the hero, instead of five full-size buttons first. */}
        <View style={styles.sectionHeader}>
          <Text style={styles.title}>Activity</Text>
          <View style={styles.toolbarRow}>
            {([
              { key: 'refresh', icon: 'check' as const, label: 'Refresh', active: false, onPress: () => loadActivities() },
              { key: 'logweek', icon: 'calendar' as const, label: 'Multi-day scan', active: false, onPress: () => router.push('/weekly-scan') },
              { key: 'filter', icon: 'search' as const, label: filterType === 'All' ? 'Filter by type' : `Filtered: ${filterType}`, active: filterType !== 'All', onPress: () => setShowTypeFilter(!showTypeFilter) },
              { key: 'sort', icon: sortOrder === 'latest' ? 'trendDown' as const : 'trendUp' as const, label: sortOrder === 'latest' ? 'Sorted: Latest first' : 'Sorted: Oldest first', active: false, onPress: () => setSortOrder(sortOrder === 'latest' ? 'oldest' : 'latest') },
              { key: 'prs', icon: 'fire' as const, label: 'PBs only', active: prOnly, onPress: () => setPrOnly(!prOnly) },
            ]).map(btn => (
              <View
                key={btn.key}
                style={styles.toolbarBtnWrap}
                {...({
                  onMouseEnter: () => setHoveredToolbarBtn(btn.key),
                  onMouseLeave: () => setHoveredToolbarBtn(id => id === btn.key ? null : id),
                } as any)}
              >
                <TouchableOpacity
                  style={[styles.toolbarBtn, btn.active && styles.toolbarBtnActive]}
                  onPress={btn.onPress}
                >
                  <RivalIcon name={btn.icon} size={16} color={btn.active ? RivalColors.accentText : RivalColors.textSecondary} />
                </TouchableOpacity>
                {hoveredToolbarBtn === btn.key && (
                  <View style={[styles.toolbarTooltip, { pointerEvents: 'none' }]}>
                    <Text style={styles.toolbarTooltipText}>{btn.label}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.filterBar}>
          {(filterType !== 'All' || prOnly) && !showTypeFilter && (
            <View style={styles.activeFiltersRow}>
              {filterType !== 'All' && (
                <TouchableOpacity style={styles.activeFilterChip} onPress={() => setFilterType('All')}>
                  <RivalIcon name={activityIconName(filterType)} size={12} color={RivalColors.accentText} />
                  <Text style={styles.activeFilterChipText}>{filterType}</Text>
                  <RivalIcon name="close" size={12} color={RivalColors.textSecondary} />
                </TouchableOpacity>
              )}
              {prOnly && (
                <TouchableOpacity style={styles.activeFilterChip} onPress={() => setPrOnly(false)}>
                  <RivalIcon name="fire" size={12} color={RivalColors.accentText} />
                  <Text style={styles.activeFilterChipText}>PBs only</Text>
                  <RivalIcon name="close" size={12} color={RivalColors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {showTypeFilter && (
            <View style={styles.typeFilterRow}>
              <TouchableOpacity
                style={[styles.typeFilterChip, filterType === 'All' && styles.typeFilterChipActive]}
                onPress={() => { setFilterType('All'); setShowTypeFilter(false); }}
              >
                <Text style={[styles.typeFilterChipText, filterType === 'All' && styles.typeFilterChipTextActive]}>All</Text>
              </TouchableOpacity>
              {activityTypes.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeFilterChip, filterType === t && styles.typeFilterChipActive]}
                  onPress={() => { setFilterType(t); setShowTypeFilter(false); }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <RivalIcon name={activityIconName(t)} size={13} color={filterType === t ? RivalColors.accentText : RivalColors.textSecondary} />
                    <Text style={[styles.typeFilterChipText, filterType === t && styles.typeFilterChipTextActive]}>{t}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {loading && <Text style={styles.emptyText}>Loading…</Text>}

        {!loading && groups.length === 0 && (
          <Text style={styles.emptyText}>
            {allActivities.length === 0 ? 'No activities yet. Add an activity to begin.' : 'No activities match this filter.'}
          </Text>
        )}

        {groups.map((group) => (
          <View key={group.weekStart} style={styles.weekSection}>
            <View style={styles.weekHeader}>
              <View style={styles.weekLabelPill}>
                <Text style={styles.weekLabel}>{group.label}</Text>
              </View>
              <View style={styles.weekTotalPill}>
                <Text style={styles.weekTotal}>{group.total} Effort</Text>
              </View>
            </View>

            <View style={styles.list}>
              {group.activities.map((activity) => {
                const distance = formatDistance(activity.distance_meters, activity.activity_type);
                const pace = formatPace(activity.distance_meters, activity.duration_seconds, activity.activity_type);
                const multiplier = scoringConfig?.multipliers[activity.activity_type] ?? DEFAULT_MULTIPLIER;
                const pbLabel = pbs[activity.id];
                const isUploading = uploading === activity.id;
                const insight = computeActivityInsight(activity, allActivities, !!pbLabel);
                const hasMedia = (mediaMap[activity.id]?.length ?? 0) > 0;
                const hasExercises = (activity.exercises?.length ?? 0) > 0;
                const hasDuration = activity.duration_seconds > 0;
                const idx = group.activities.indexOf(activity);
                const isFullRow = wide && group.activities.length % 2 === 1 && idx === group.activities.length - 1;
                const cardIsSpacious = spaciousWindow && isFullRow;
                return (
                  <View
                    key={activity.id}
                    style={[styles.activityCard, wide && styles.cardHalf, pbLabel && styles.activityCardBest]}
                  >
                    {/* Header: icon · name/type · multiplier */}
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, pbLabel && styles.iconBoxBest]}>
                        <RivalIcon
                          name={activityIconName(activity.activity_type)}
                          size={22}
                          color={pbLabel ? RivalColors.rankAnchors.unrivaled : RivalColors.accentText}
                        />
                      </View>
                      <View style={styles.cardHeaderInfo}>
                        {editingId === activity.id ? (
                          <TextInput
                            style={styles.nameInput}
                            value={editingName}
                            onChangeText={setEditingName}
                            autoFocus
                            onSubmitEditing={() => saveName(activity.id)}
                            onBlur={() => saveName(activity.id)}
                          />
                        ) : (
                          <TouchableOpacity style={styles.typeRow} onPress={() => startEditing(activity)}>
                            <Text style={styles.activityType} numberOfLines={1}>{activity.name || activity.activity_type}</Text>
                            <RivalIcon name="edit" size={11} color={RivalColors.textSecondary} />
                          </TouchableOpacity>
                        )}
                        <Text style={styles.activityTypeSub}>{activity.activity_type}</Text>
                      </View>
                      <View
                        style={styles.multiplierBadgeWrap}
                        {...({
                          onMouseEnter: () => setHoveredMultiplierId(activity.id),
                          onMouseLeave: () => setHoveredMultiplierId(id => id === activity.id ? null : id),
                        } as any)}
                      >
                        <View style={styles.multiplierBadge}>
                          <Text style={styles.multiplierBadgeText}>×{multiplier}</Text>
                        </View>
                        {hoveredMultiplierId === activity.id && (
                          <View style={[styles.multiplierTooltip, { pointerEvents: 'none' }]}>
                            <Text style={styles.multiplierTooltipText}>Effort multiplier</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {pbLabel && (
                      <View style={styles.bestBadge}>
                        <RivalIcon name="fire" size={12} color={RivalColors.rankAnchors.unrivaled} />
                        <Text style={styles.bestBadgeText}>{pbLabel}</Text>
                      </View>
                    )}

                    {activity.race_id && (
                      <View style={styles.raceBadge}>
                        <RivalIcon name="flag" size={12} color="#ff5c5c" />
                        <Text style={styles.raceBadgeText}>Event</Text>
                      </View>
                    )}

                    {/* Stat mini-cards + exercises stacked on the left, Effort badge +
                        action icons on the right. The right column is measured to match
                        the LEFT column's full height (stats + exercises together, not
                        just stats) — a workout with a long exercise list previously left
                        the Effort badge sized to the stats alone, floating with a gap
                        above the exercise list beside it.
                        No labels — the values (date/duration/distance) are self-explanatory. */}
                    {/* Spacious cards: everything tops-out together (no centring gap
                        below the PB badge) and the Effort badge stretches to the full
                        photo height so the space beside the photo doesn't sit empty. */}
                    <View style={[styles.statsAndEffortRow, cardIsSpacious && hasMedia && styles.statsAndEffortRowSpacious]}>
                      <View
                        style={styles.statAndExerciseColumn}
                        onLayout={(e) => {
                          const h = e.nativeEvent.layout.height;
                          setStatColHeights(prev => prev[activity.id] === h ? prev : { ...prev, [activity.id]: h });
                        }}
                      >
                        <View style={styles.statColumn}>
                          <View style={styles.statTile}>
                            <Text style={styles.statTileValue}>{formatDate(activity.started_at)}</Text>
                          </View>
                          {hasDuration && (
                            <View style={styles.statTile}>
                              <Text style={styles.statTileValue}>{formatDurationClock(activity.duration_seconds)}</Text>
                            </View>
                          )}
                          {distance && (
                            <View style={styles.statTile}>
                              <Text style={styles.statTileValue}>{distance}</Text>
                            </View>
                          )}
                          {pace && (
                            <View style={styles.statTile}>
                              <Text style={styles.statTileValue}>{pace}</Text>
                            </View>
                          )}
                          {/* ↑ marks the value as elevation gain — tiles have no labels,
                              so a bare metres figure would read as distance. */}
                          {(activity.elevation_meters || 0) > 0 && !WATER_SPORTS.has(activity.activity_type) && (
                            <View style={styles.statTile}>
                              <Text style={styles.statTileValue}>↑ {Math.round(activity.elevation_meters!)} m</Text>
                            </View>
                          )}
                        </View>

                        {hasExercises && (
                          <View style={styles.exerciseBreakdown}>
                            {activity.exercises!.map((ex, exi) => (
                              <View key={exi} style={styles.exerciseRow}>
                                <RivalIcon name="weights" size={13} color={RivalColors.accentText} />
                                <Text style={styles.exerciseRowText}>{formatExerciseLine(ex)}</Text>
                                {ex.prLift && (
                                  <View style={styles.exercisePrTag}>
                                    <RivalIcon name="fire" size={10} color={RivalColors.rankAnchors.unrivaled} />
                                    <Text style={styles.exercisePrTagText}>PB</Text>
                                  </View>
                                )}
                              </View>
                            ))}
                          </View>
                        )}
                      </View>

                      {/* On genuinely wide cards (measured, not assumed from window
                          width), media fills the gap between stats and Effort instead
                          of stacking below. Narrower cards keep the gallery below. */}
                      {cardIsSpacious && hasMedia && (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          // The lift lives on the CONTAINER, not the image — the
                          // horizontal ScrollView clips children, so a negative margin
                          // on the image just cuts its top off instead of raising it.
                          // Photo spans from the PB-badge line down to the stat column's
                          // bottom: statColHeight + offset tall, shifted up by offset.
                          style={[styles.galleryInline, pbLabel && { marginTop: -PB_BADGE_OFFSET }, { marginBottom: -INSIGHT_ROW_OVERHANG }]}
                          contentContainerStyle={styles.galleryRow}
                        >
                          {mediaMap[activity.id].map((m) => (
                            m.media_type === 'video' ? (
                              <video
                                key={m.id}
                                src={m.media_url}
                                controls
                                style={{ width: 200, height: '100%', borderRadius: 10, backgroundColor: '#2A2A2A' } as any}
                              />
                            ) : (
                              <TouchableOpacity key={m.id} onPress={() => setEnlargedPhoto(m.media_url)}>
                                <Image
                                  source={{ uri: cardPhoto(m.media_url) }}
                                  style={[
                                    styles.galleryPhotoInline,
                                    statColHeights[activity.id]
                                      ? { height: statColHeights[activity.id] + (pbLabel ? PB_BADGE_OFFSET : 0) + INSIGHT_ROW_OVERHANG }
                                      : null,
                                  ]}
                                  resizeMode="cover"
                                />
                              </TouchableOpacity>
                            )
                          ))}
                        </ScrollView>
                      )}

                      {/* Same height as the stat column always; on spacious cards it
                          also grows WIDE to absorb the leftover space beside the photo,
                          with the number scaled up to suit the larger canvas. */}
                      <View
                        style={[
                          styles.effortBadge,
                          pbLabel && styles.effortBadgeBest,
                          statColHeights[activity.id] ? { height: statColHeights[activity.id] } : null,
                          // Grows to use the free width but capped near-square
                          // (slightly wider than tall) so it reads as a tile, not a bar.
                          cardIsSpacious && hasMedia && { flexGrow: 1, maxWidth: Math.max(200, (statColHeights[activity.id] || 0) * 1.15) },
                        ]}
                      >
                        <Text style={[styles.points, cardIsSpacious && hasMedia && styles.pointsLarge, pbLabel && { color: RivalColors.rankAnchors.unrivaled }]}>
                          {activity.effort_score}
                        </Text>
                        <Text style={[styles.pointsUnit, cardIsSpacious && hasMedia && styles.pointsUnitLarge, pbLabel && { color: RivalColors.rankAnchors.unrivaled }]}>EFFORT</Text>
                      </View>
                    </View>

                    {/* Insight (if any) always shares this row with the action icons,
                        so the icons land in the same place whether or not an insight
                        line is present — never stacked under Effort inside the taller
                        stats row above. */}
                    <View style={styles.insightFooterRow}>
                      {insight ? (
                        <View style={styles.insightRow}>
                          <RivalIcon name={INSIGHT_ICON[insight.tone]} size={12} color={INSIGHT_COLOR[insight.tone]} />
                          <Text style={[styles.insightText, { color: INSIGHT_COLOR[insight.tone] }]}>{insight.text}</Text>
                        </View>
                      ) : <View />}
                      <View style={styles.rightColBtnRow}>
                        <TouchableOpacity style={styles.cameraBtn} onPress={() => uploadPhoto(activity.id)} disabled={isUploading}>
                          <RivalIcon name={isUploading ? 'timer' : 'camera'} size={18} color={RivalColors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.cameraBtn} onPress={() => router.push(`/scan-workout?activityId=${activity.id}`)}>
                          <RivalIcon name="settings" size={18} color={RivalColors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {uploadErrorActivityId === activity.id && uploadError && (
                      <Text style={styles.inlineUploadError}>{uploadError}</Text>
                    )}

                    {/* Media gallery — only stacked here on narrow cards; wide cards
                        show it inline in the stats row above instead. */}
                    {hasMedia && !cardIsSpacious && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryRow}>
                        {mediaMap[activity.id].map((m) => (
                          m.media_type === 'video' ? (
                            <video
                              key={m.id}
                              src={m.media_url}
                              controls
                              style={{ width: 220, height: 220, borderRadius: 10, backgroundColor: '#2A2A2A' } as any}
                            />
                          ) : (
                            <TouchableOpacity key={m.id} onPress={() => setEnlargedPhoto(m.media_url)}>
                              <Image
                                source={{ uri: cardPhoto(m.media_url) }}
                                style={styles.galleryPhoto}
                                resizeMode="cover"
                              />
                            </TouchableOpacity>
                          )
                        ))}
                      </ScrollView>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        </ScrollView>
        )}

        {!mobileNav && (
          <TouchableOpacity style={styles.fab} onPress={() => router.push('/add-workout')}>
            <RivalIcon name="add" size={18} color={RivalColors.onAccentFill} />
            <Text style={styles.fabText}>Add Activity</Text>
          </TouchableOpacity>
        )}

        {/* Photo lightbox — click any card photo to view it full size; click
            anywhere (or ✕) to dismiss. */}
        {enlargedPhoto && (
          <TouchableOpacity style={styles.lightbox} activeOpacity={1} onPress={() => setEnlargedPhoto(null)}>
            <Image source={{ uri: fullPhoto(enlargedPhoto) }} style={styles.lightboxImage} resizeMode="contain" />
            <TouchableOpacity style={styles.lightboxClose} onPress={() => setEnlargedPhoto(null)}>
              <RivalIcon name="close" size={22} color={RivalColors.textPrimary} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* Mobile Activity Journal's full-screen diary viewer. */}
        {diaryList && (
          <ActivityDiaryViewer
            activities={diaryList}
            startIndex={diaryIndex}
            onClose={() => { setDiaryList(null); setShareFromTeams(null); }}
            closeSignal={tabReselects}
            openShareFor={shareFromTeams}
            onShareDone={() => { setShareFromTeams(null); setDiaryList(null); goToTab('/team-feed'); }}
            onUpdate={(id, patch) => {
              updateActivityLocal(id, patch as Partial<Activity>);
              setDiaryList((prev) => prev ? prev.map((a) => a.id === id ? { ...a, ...patch } : a) : prev);
            }}
            onUploadPhoto={uploadPhoto}
            onArrangeMedia={arrangeMedia}
            onPositionPhoto={(id, url) => {
              if (pickerPositions) { arrangeMedia(id, url); return; }
              const a = allActivities.find((x) => x.id === id);
              if (a?.photo_url) setPositioningPhoto({ activityId: id, url: a.photo_url, previousUrl: a.photo_url, previousFocalX: a.photo_focal_x ?? null, previousFocalY: a.photo_focal_y ?? null });
            }}
            mediaById={Object.fromEntries(Object.entries(mediaMap).map(([id, rows]) => [
              id,
              rows.map((m) => ({ url: m.media_url, type: m.media_type, focalX: m.focal_x, focalY: m.focal_y })),
            ]))}
          />
        )}

        {mediaPicker && (
          <MediaPicker
            initial={mediaPicker.items}
            initialFocus={mediaPicker.focus}
            initialNotice={mediaPicker.notice}
            title="Photos and videos"
            // Adding new photos says what happens; reordering what's already
            // posted is just a save (Ricky, 2026-10-11).
            doneLabel={mediaPicker.arrangeOnly ? 'Save' : 'Add to activity'}
            onCancel={() => setMediaPicker(null)}
            onDone={(items) => {
              const { activityId } = mediaPicker;
              setMediaPicker(null);
              // A new photo becoming the cover is cropped first, from the
              // file still on the phone; nothing uploads until it's confirmed.
              const firstPhoto = items.find((i) => i.type === 'photo');
              if (!pickerPositions && firstPhoto && !firstPhoto.existingId) {
                setPendingCrop({ activityId, items, url: firstPhoto.uri });
                return;
              }
              uploadMedia(activityId, items);
            }}
          />
        )}

        {/* While new photos upload: hold the screen with what's happening, so
            nothing seems stuck and nothing else gets started meanwhile. */}
        {uploadProgress && (
          <Modal visible transparent animationType="fade">
            <View style={styles.uploadHold}>
              <View style={styles.uploadCard}>
                <ActivityIndicator color={RivalColors.accentText} />
                <Text style={styles.uploadTitle}>Adding to activity</Text>
                <Text style={styles.uploadSub}>
                  {uploadProgress.done < uploadProgress.total
                    ? `${uploadProgress.done} of ${uploadProgress.total} uploaded`
                    : 'Finishing up'}
                </Text>
                <View style={styles.uploadTrack}>
                  <View style={[styles.uploadFill, { width: `${Math.max(6, Math.round((uploadProgress.done / uploadProgress.total) * 100))}%` }]} />
                </View>
              </View>
            </View>
          </Modal>
        )}

        {/* Crop step for a new cover, before upload. Cancel drops the whole
            add: nothing has been uploaded yet. */}
        {pendingCrop && (
          <PhotoPositioner
            key={pendingCrop.url}
            photoUrl={pendingCrop.url}
            choices={pendingCrop.items.filter((i) => i.type === 'photo').map((i) => i.uri)}
            // Choosing another cover moves it to #1, the cover's place, and
            // starts its crop fresh.
            onChooseCover={(uri) => setPendingCrop((cur) => {
              if (!cur) return cur;
              const chosen = cur.items.find((i) => i.uri === uri);
              if (!chosen) return cur;
              return { ...cur, url: uri, items: [chosen, ...cur.items.filter((i) => i !== chosen)] };
            })}
            onCancel={() => setPendingCrop(null)}
            onConfirm={(x, y) => {
              const { activityId, items } = pendingCrop;
              setPendingCrop(null);
              uploadMedia(activityId, items, { x, y });
            }}
          />
        )}

        {/* Crop positioner — shown after a cover changes to a photo that was
            already uploaded (e.g. reordering). */}
        {positioningPhoto && (
          <PhotoPositioner
            photoUrl={positioningPhoto.url}
            initialX={positioningPhoto.previousFocalX ?? 0.5}
            initialY={positioningPhoto.previousFocalY ?? 0.5}
            onCancel={async () => {
              const { activityId, previousUrl, previousFocalX, previousFocalY } = positioningPhoto;
              setPositioningPhoto(null);
              setAllActivities(prev => prev.map(a =>
                a.id === activityId ? { ...a, photo_url: previousUrl, photo_focal_x: previousFocalX, photo_focal_y: previousFocalY } : a
              ));
              setDiaryList(prev => prev ? prev.map(a =>
                a.id === activityId ? { ...a, photo_url: previousUrl, photo_focal_x: previousFocalX, photo_focal_y: previousFocalY } : a
              ) : prev);
              const { error: revertErr } = await supabase.from('activities').update({ photo_url: previousUrl, photo_focal_x: previousFocalX, photo_focal_y: previousFocalY }).eq('id', activityId);
              if (revertErr) notify("Couldn't undo that photo change", revertErr.message);
            }}
            onConfirm={async (x, y) => {
              const { activityId } = positioningPhoto;
              setPositioningPhoto(null);
              setAllActivities(prev => prev.map(a =>
                a.id === activityId ? { ...a, photo_focal_x: x, photo_focal_y: y } : a
              ));
              setDiaryList(prev => prev ? prev.map(a =>
                a.id === activityId ? { ...a, photo_focal_x: x, photo_focal_y: y } : a
              ) : prev);
              const { error: focalErr } = await supabase.from('activities').update({ photo_focal_x: x, photo_focal_y: y }).eq('id', activityId);
              if (focalErr) notify("Couldn't save the photo position", focalErr.message);
            }}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// Activity tab "Training toward" card (next event + Personal bests) and its
// start tiles. Off (Ricky, 2026-09-30): the page is back to how it was.
const SHOW_TRAINING_TOWARD = false;
// The weekly line above an empty week's recent activities. Off (Ricky, 2026-09-30).
const SHOW_WEEK_QUOTE = false;

const styles = StyleSheet.create({
  startWrap: { marginTop: 4, marginBottom: 12 },
  towardLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary, textTransform: 'uppercase', marginTop: 16, marginBottom: 8, marginLeft: 2 },
  towardCard: { backgroundColor: '#262220', borderRadius: 16, borderWidth: 1, borderColor: RivalColors.surfaceBright, paddingHorizontal: 12, marginBottom: 6 },
  towardRow: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 58 },
  towardDivider: { height: 1, backgroundColor: RivalColors.surfaceBright, opacity: 0.6 },
  towardBadge: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  towardBadgeQuiet: { backgroundColor: 'rgba(255,255,255,0.06)', ...(Platform.OS === 'web' ? { backgroundImage: 'none' } : {}) } as any,
  towardText: { flex: 1, minWidth: 0, gap: 2 },
  towardTitle: { fontSize: 14.5, fontWeight: '600', color: '#fff' },
  towardSub: { fontSize: 12, color: RivalColors.textSecondary },
  towardDays: { alignItems: 'flex-end' },
  towardDaysNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, color: RivalColors.accentText, lineHeight: 23 },
  towardDaysLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary },
  towardAdd: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
  firstEmpty: { alignItems: 'center', marginTop: 24, paddingVertical: 24 },
  firstEmptyBtn: { alignSelf: 'stretch' },
  root: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  photoBand: { position: 'absolute', top: 0, left: 0, right: 0, height: 360, overflow: 'hidden' },
  photoBandFade: {
    backgroundColor: 'rgba(17,14,12,0.6)',
    ...(Platform.OS === 'web' ? { backgroundColor: 'transparent', backgroundImage: 'linear-gradient(180deg, rgba(17,14,12,0.35) 0%, rgba(17,14,12,0.72) 55%, #131313 100%)' } : {}),
  } as any,
  jTitleBlockB: { alignItems: 'center', marginTop: 10, marginBottom: 4 },
  jTitleB: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, color: '#fff' },
  jSubtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  jSubtitleRule: { width: 26, height: 1, backgroundColor: 'rgba(255,181,158,0.4)' },
  jSubtitleB: { fontSize: 10.5, fontWeight: '800', letterSpacing: 2.2, textTransform: 'uppercase', color: RivalColors.accentText },
  weekHero: {
    borderRadius: 18, paddingTop: 14, paddingBottom: 14, paddingHorizontal: 16, overflow: 'hidden', gap: 12,
    backgroundColor: '#1b1512', borderWidth: 1, borderColor: 'rgba(255,209,190,0.10)',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(217,119,87,0.14), rgba(217,119,87,0) 80%)',
      borderWidth: 0,
    } : {}),
  } as any,
  weekHeroEdge: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 18, padding: 1,
    backgroundImage: 'linear-gradient(180deg, rgba(255,209,190,0.30), rgba(255,209,190,0.09) 45%, rgba(255,209,190,0.05))',
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
  } as any,
  weekHeroRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weekHeroTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, color: '#fff' },
  weekHeroSub: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  weekHeroEffort: { alignItems: 'flex-end' },
  // Serif italic like every hero number on Today; the label is the plain caps.
  weekHeroNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 28, lineHeight: 32, fontWeight: '700', color: '#fff' },
  weekHeroLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: RivalColors.accentText, marginTop: 1 },
  weekDots: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  weekDotCol: { alignItems: 'center', gap: 5 },
  weekDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: 'rgba(255,255,255,0.12)' },
  weekDotOn: {
    backgroundColor: RivalColors.accentFill,
    ...(Platform.OS === 'web' ? { backgroundImage: `linear-gradient(135deg, ${RivalColors.accentFill}, ${RivalColors.accentText})` } : {}),
  } as any,
  weekDotPb: {
    backgroundColor: '#f5b759',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #ffe6b0, #f5b759)' } : {}),
  } as any,
  weekDotToday: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,181,158,0.6)' },
  weekDotLabel: { fontSize: 9.5, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  scrim: { position: 'fixed' as any, top: 0, left: 0, right: 0, height: '100vh' as any, backgroundColor: 'rgba(14,14,14,0.55)' },
  // Solid backing behind just the top nav strip on mobile — see the comment
  // where this is rendered. Matches home.tsx's mobile flat-background color
  // (#131313) so the nav reads the same on both screens.
  // 62 = the nav bar's own rendered height (rowNarrow padding 14*2 + ~34 of
  // content) — sized to just the bar, not the content below it.
  navBacking: { position: 'fixed' as any, top: 0, left: 0, right: 0, height: 62, backgroundColor: '#131313', zIndex: 50 },
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 100, maxWidth: 900, width: '100%', alignSelf: 'center' },

  // Hero
  hero: { backgroundColor: 'rgba(24,24,24,0.6)', borderWidth: 1, borderColor: 'rgba(163,140,133,0.15)', borderLeftWidth: 4, borderLeftColor: RivalColors.accentFill, borderRadius: RivalRadius.xl, padding: 28, marginBottom: 20 },
  heroBody: { flexDirection: 'column', gap: 20 },
  heroBodyWide: { flexDirection: 'row', alignItems: 'stretch' },
  heroMain: { flex: 1, justifyContent: 'space-between' },
  heroSide: { gap: 12, width: '100%' },
  heroSideWide: { width: '28%', minWidth: 220, maxWidth: 320, flexGrow: 0, flexShrink: 0 },
  heroEyebrow: { ...RivalType.labelCaps, fontSize: 11, letterSpacing: 3, color: RivalColors.accentText, marginBottom: 6 },
  heroScoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, marginBottom: 22 },
  heroScore: { ...RivalType.displayHero, fontSize: 100, lineHeight: 96, color: RivalColors.textPrimary },
  heroScoreSide: { paddingBottom: 12, gap: 4 },
  heroScoreUnit: { ...RivalType.labelCaps, fontSize: 12, letterSpacing: 2, color: RivalColors.textSecondary },
  heroDelta: { fontSize: 13, fontWeight: '700' },
  heroDeltaMuted: { fontSize: 13, fontWeight: '600', color: RivalColors.textSecondary },
  heroStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 32, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 20 },
  heroStat: { gap: 3 },
  heroStatValue: { fontSize: 24, fontWeight: '700', color: RivalColors.textPrimary },
  heroStatLabel: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary },

  // Section header
  contextLine: { fontSize: 16, color: RivalColors.textSecondary, marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  contextLineHighlight: { fontWeight: '800', color: RivalColors.accentText },
  sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 14, marginBottom: 12 },
  title: { ...RivalType.headlineLg, fontSize: 22, color: RivalColors.textPrimary, textTransform: 'uppercase', letterSpacing: 1 },
  liftsLink: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: `${RivalColors.rankAnchors.unrivaled}14`, borderWidth: 1, borderColor: `${RivalColors.rankAnchors.unrivaled}55`, borderRadius: RivalRadius.DEFAULT, paddingVertical: 10, paddingHorizontal: 16 },
  liftsLinkText: { color: RivalColors.rankAnchors.unrivaled, fontSize: 13, fontWeight: '600' },

  // Monthly PB snapshot — fills what used to be empty space beside the hero stats.
  monthlyPbCard: { backgroundColor: `${RivalColors.rankAnchors.unrivaled}0D`, borderWidth: 1, borderColor: `${RivalColors.rankAnchors.unrivaled}40`, borderRadius: RivalRadius.DEFAULT, padding: 14, gap: 10 },
  monthlyPbHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  monthlyPbTitle: { ...RivalType.labelCaps, fontSize: 14, letterSpacing: 1, color: RivalColors.textPrimary, textAlign: 'center' },
  monthlyPbCount: { backgroundColor: `${RivalColors.rankAnchors.unrivaled}22`, borderRadius: RivalRadius.full, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  monthlyPbCountText: { fontSize: 13, fontWeight: '800', color: RivalColors.rankAnchors.unrivaled },
  monthlyPbEmpty: { fontSize: 12, color: RivalColors.textSecondary, lineHeight: 17 },
  monthlyPbScroll: { maxHeight: 168 },
  monthlyPbList: { gap: 12 },
  monthlyPbRow: { flexDirection: 'row', gap: 12 },
  monthlyPbEntry: { borderLeftWidth: 2, borderLeftColor: `${RivalColors.rankAnchors.unrivaled}55`, paddingLeft: 10, gap: 1, minWidth: 100 },
  monthlyPbName: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, color: RivalColors.textSecondary, textTransform: 'uppercase' },
  monthlyPbValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  monthlyPbValue: { fontSize: 28, fontWeight: '800', color: RivalColors.textPrimary, lineHeight: 32 },
  monthlyPbValueSerif: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700' },
  monthlyPbUnit: { fontSize: 12, fontWeight: '700', fontStyle: 'italic', color: RivalColors.textSecondary },
  monthlyPbProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  monthlyPbProgress: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4, color: RivalColors.rankAnchors.unrivaled },
  // Compact icon toolbar — replaces the old row of 5 full-size buttons so the
  // cards start right after the hero instead of behind a wall of controls.
  toolbarRow: { flexDirection: 'row', gap: 6 },
  toolbarBtnWrap: { position: 'relative' },
  toolbarBtn: { width: 34, height: 34, borderRadius: RivalRadius.DEFAULT, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  toolbarBtnActive: { backgroundColor: `${RivalColors.accentFill}1a`, borderColor: RivalColors.accentFill },
  // Mobile Activity Journal's own toolbar button — same as toolbarBtn but no
  // border, kept separate so desktop's toolbar (which shares toolbarBtn) is
  // untouched.
  jToolbarBtn: { width: 34, height: 34, borderRadius: RivalRadius.DEFAULT, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  recapCornerBtnRow: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', gap: 6 },
  recapFilterBtn: {
    width: 26, height: 26, borderRadius: RivalRadius.sm,
    backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center',
  },
  toolbarTooltip: { position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, backgroundColor: RivalColors.surfaceContainerHighest, borderRadius: RivalRadius.sm, paddingHorizontal: 8, paddingVertical: 5, zIndex: 10 },
  toolbarTooltipText: { fontSize: 11, fontWeight: '600', color: RivalColors.textPrimary },

  filterBar: { marginBottom: 8 },
  // Pulls the filter bar flush against the stat card's bottom edge instead of
  // sitting a full container `gap` below it (Mobile Activity Journal only).
  // Two variants because the two container gaps differ: jWeekPage's `gap: 14`
  // (Weekly pager) vs jContent's `gap: 18` (Rows/Month).
  filterBarTight: { marginTop: -14 },
  filterBarTightWide: { marginTop: -14 },
  activeFiltersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  activeFilterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${RivalColors.accentFill}1a`, borderWidth: 1, borderColor: RivalColors.accentFill, borderRadius: RivalRadius.full, paddingVertical: 6, paddingHorizontal: 10 },
  activeFilterChipText: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  typeFilterLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: RivalColors.textSecondary, marginBottom: 6 },
  typeFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  // Matches the hero/card family's warm dark tone (#211c19, same as jCard)
  // rather than the harsher neutral surfaceLowest grey.
  // Matches the hero card's own warm brown fill (recapCard's #2d241f), not
  // the darker near-black #211c19 other small chips (jCard) use — the first
  // pass here was still reading too close to black against this screen's
  // brighter background.
  typeFilterChip: { backgroundColor: '#2d241f', borderRadius: RivalRadius.sm, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,181,158,0.14)' },
  typeFilterChipActive: { backgroundColor: `${RivalColors.accentFill}1a`, borderColor: RivalColors.accentFill },
  typeFilterChipText: { fontSize: 11, fontWeight: '600', color: RivalColors.textSecondary },
  typeFilterChipTextActive: { color: RivalColors.accentText },

  emptyText: { color: RivalColors.textSecondary, fontSize: 15, textAlign: 'center', paddingVertical: 24 },

  weekSection: { marginBottom: 28 },
  weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10 },
  weekLabelPill: {
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'rgba(20,20,20,0.35)', borderRadius: RivalRadius.DEFAULT,
    borderLeftWidth: 3, borderLeftColor: RivalColors.accentFill,
  },
  weekTotalPill: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(20,20,20,0.35)', borderRadius: RivalRadius.DEFAULT },
  weekLabel: { fontSize: 16, fontWeight: '700', color: RivalColors.textPrimary },
  weekTotal: { fontSize: 16, fontWeight: '800', color: RivalColors.accentText },

  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' },

  activityCard: { flexBasis: '100%', backgroundColor: 'rgba(20,20,20,0.35)', borderRadius: RivalRadius.lg, padding: 18, borderWidth: 1, borderColor: 'rgba(163,140,133,0.15)', gap: 14 },
  // Simple activities tile 2-up on wide screens; minWidth keeps them from getting cramped.
  cardHalf: { flexBasis: '48%', flexGrow: 1, minWidth: 300 },
  activityCardBest: { borderColor: `${RivalColors.rankAnchors.unrivaled}66`, borderWidth: 1.5 },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardHeaderInfo: { flex: 1, gap: 2 },
  iconBox: { width: 46, height: 46, borderRadius: RivalRadius.DEFAULT, backgroundColor: `${RivalColors.accentFill}1a`, borderWidth: 1, borderColor: `${RivalColors.accentFill}33`, alignItems: 'center', justifyContent: 'center' },
  iconBoxBest: { backgroundColor: `${RivalColors.rankAnchors.unrivaled}1a`, borderColor: `${RivalColors.rankAnchors.unrivaled}4d` },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activityType: { fontSize: 18, fontWeight: '700', color: RivalColors.textPrimary, flexShrink: 1 },
  activityTypeSub: { fontSize: 12, color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
  nameInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 10, paddingVertical: 6, color: RivalColors.textPrimary, fontSize: 16, fontWeight: '700', borderWidth: 1, borderColor: RivalColors.accentFill },
  multiplierBadgeWrap: { position: 'relative' },
  multiplierBadge: { backgroundColor: `${RivalColors.accentFill}1a`, borderRadius: RivalRadius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  multiplierTooltip: { position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, backgroundColor: RivalColors.surfaceContainerHighest, borderRadius: RivalRadius.sm, paddingHorizontal: 8, paddingVertical: 5, zIndex: 10 },
  multiplierTooltipText: { fontSize: 11, fontWeight: '600', color: RivalColors.textPrimary },
  multiplierBadgeText: { fontSize: 13, fontWeight: '800', color: RivalColors.accentText },

  bestBadge: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 4, backgroundColor: `${RivalColors.rankAnchors.unrivaled}22`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RivalRadius.sm },
  bestBadgeText: { fontSize: 11, fontWeight: '700', color: RivalColors.rankAnchors.unrivaled },
  // Race badge — a checkered-flag red kept deliberately distinct from the PB
  // gold above (not added to rivalTheme.ts; that file is only for confirmed
  // DESIGN.md tokens, see its header comment).
  raceBadge: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 4, backgroundColor: '#ff5c5c22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: RivalRadius.sm },
  raceBadgeText: { fontSize: 11, fontWeight: '700', color: '#ff5c5c' },

  // Compact pills that hug their content — no more stretched tiles with dead space.
  // Stat mini-cards stacked on the left, Effort badge prominent on the right.
  // Centered, not stretched: the photo is its own element and may stand taller
  // than the stat column and Effort badge — they keep their natural size and
  // sit vertically centred beside it instead of inflating to match.
  statsAndEffortRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statsAndEffortRowSpacious: { alignItems: 'flex-start' },
  statAndExerciseColumn: { flex: 1, gap: 10 },
  statColumn: { gap: 8 },
  statTile: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 10 },
  statTileValue: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },

  insightRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  insightFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  lightbox: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  lightboxImage: { width: '92%', height: '92%' },
  lightboxClose: { position: 'absolute', top: 24, right: 24, width: 44, height: 44, borderRadius: RivalRadius.full, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  insightText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  // Exercises as standout rows (icon + name/weight + PR tag) instead of plain bullet text.
  exerciseBreakdown: { gap: 6 },
  exerciseRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 10, paddingVertical: 8 },
  exerciseRowText: { flex: 1, fontSize: 13, fontWeight: '600', color: RivalColors.textPrimary },
  exercisePrTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: `${RivalColors.rankAnchors.unrivaled}22`, borderRadius: RivalRadius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  exercisePrTagText: { fontSize: 10, fontWeight: '800', color: RivalColors.rankAnchors.unrivaled },

  rightColBtnRow: { flexDirection: 'row', gap: 6 },
  effortBadge: { backgroundColor: `${RivalColors.accentFill}22`, borderWidth: 1, borderColor: `${RivalColors.accentFill}55`, borderRadius: RivalRadius.md, paddingHorizontal: 20, paddingVertical: 26, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
  effortBadgeBest: { backgroundColor: `${RivalColors.rankAnchors.unrivaled}22`, borderColor: `${RivalColors.rankAnchors.unrivaled}66` },
  points: { fontSize: 28, fontWeight: '800', color: RivalColors.accentText, lineHeight: 30 },
  pointsUnit: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: RivalColors.accentText, marginTop: 2 },
  pointsLarge: { fontSize: 44, lineHeight: 48 },
  pointsUnitLarge: { fontSize: 13, letterSpacing: 2, marginTop: 4 },
  cameraBtn: { padding: 6, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: RivalRadius.DEFAULT },

  galleryRow: { gap: 8 },
  galleryPhoto: { width: 220, height: 220, borderRadius: 10, backgroundColor: RivalColors.surfaceContainerHigh },
  // Hugs the photo width (no flex-grow) so the Effort badge can claim the
  // remaining row width instead.
  galleryInline: { flexGrow: 0, flexShrink: 0 },
  // Fixed height sized to dominate the card body (the Effort badge and stat
  // column stretch to match); width follows from the aspect ratio so the
  // photo keeps its proportions (cover-crops inside the frame, never stretches).
  galleryPhotoInline: { height: 320, aspectRatio: 0.8, borderRadius: 10, backgroundColor: RivalColors.surfaceContainerHigh },

  inlineUploadError: { color: RivalColors.error, fontSize: 12, fontWeight: '600' },

  // `fixed` (not `absolute`) so it stays pinned to the viewport — on web,
  // `absolute` here was relative to a container whose height grows with
  // scrollable content, so the button drifted upward as the page scrolled
  // instead of staying put. Same fix as RivalTopNav's bottom tab bar.
  fab: { position: 'fixed' as any, bottom: 28, right: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 20, borderRadius: RivalRadius.full, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, boxShadow: '0px 4px 12px rgba(0,0,0,0.4)', elevation: 6, zIndex: 150 },
  fabText: { fontSize: 15, fontWeight: '700', color: RivalButtonColors.label(RivalColors.onAccentFill) },

  // ===== Mobile Activity Journal (ported from the Claude mockup) =====
  // Full-screen weekly pager — see the render-site comment for how RNW's
  // `pagingEnabled` gives CSS scroll-snap for free. `flex: 1` gives this
  // ScrollView a definite bounded height (rest of the screen below the top
  // nav), which is what makes `pagerHeight` from its onLayout meaningful and
  // lets each week page's explicit pixel height actually take effect.
  jPager: { flex: 1 },
  // Room under the last week for the bottom nav.
  jWeekList: { paddingBottom: 120 },
  jWeekPage: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14, gap: 14 },
  uploadHold: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 },
  uploadCard: { width: '100%', maxWidth: 320, alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 22, borderRadius: 20, backgroundColor: RivalColors.surfaceHigh, borderWidth: 1, borderColor: RivalColors.surfaceBright },
  uploadTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, color: '#fff', marginTop: 4 },
  uploadSub: { fontSize: 13, color: RivalColors.textSecondary },
  uploadTrack: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 6 },
  uploadFill: { height: 4, borderRadius: 2, backgroundColor: RivalColors.accentText },
  // Room at the end of a scrolling page for the floating bottom nav.
  jYearPage: { paddingBottom: 120 },
  jGridContent: { marginTop: 4, paddingBottom: 32, gap: 10 },
  // justifyContent centers items on a wrap-line that doesn't fill the row —
  // the flexGrow:1 photo cards still stretch to consume any leftover space
  // on their own lines, so this only visibly centers the narrower, non-growing
  // jAddCard when it lands alone on the last line.
  jGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  jTitleBlock: { alignSelf: 'center', marginTop: 16, marginBottom: 16, paddingVertical: 8, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' },
  jTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '500', fontSize: 17, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  jSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.32)', textAlign: 'center', marginTop: 2 },
  jToolbarRow: { flexDirection: 'row', gap: 6, alignSelf: 'center' },

  // 3-way layout switch (Rows / Weekly / Month).
  // marginTop pulls it up against the stat card (or its filter bar, when
  // shown) instead of sitting a full container `gap` below — same trick as
  // filterBarTight.
  jLayoutToggleRow: { flexDirection: 'row', justifyContent: 'center', paddingTop: 12, paddingBottom: 4, marginTop: -10 },
  // Sits directly below the stat card — cancels the container's own `gap`
  // (jWeekPage:14 vs jContent:18) so it hugs the card instead of floating a
  // full gap below it, same technique as filterBarTight/filterBarTightWide.
  jLayoutToggleRowTight: { marginTop: -18 },
  // Week, Month and Year on the left, Filter on the right.
  jLayoutToggleRowSplit: { justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  monthDelta: { marginTop: -8, fontSize: 12.5, color: 'rgba(255,255,255,0.5)' },
  jLayoutToggleRowTightWide: { marginTop: -18 },
  // Matches the Filter button beside it: a clear pill, the chosen one lit
  // in white (Ricky, 2026-10-16).
  jLayoutToggle: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 999, padding: 3, gap: 2 },
  jLayoutToggleItem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: 'transparent' },
  jLayoutToggleItemActive: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.55)' },
  jLayoutToggleLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  jLayoutToggleLabelActive: { color: '#fff' },

  // Rows layout — continuous vertical scroll, hero once at top, each week's
  // cards in their own horizontally-scrolling row.
  // Same paddingTop/gap as jWeekPage (Weekly layout's container) — Rows and
  // Month used to use a slightly larger gap (18 vs 14), which visibly shifted
  // the stat card's position when toggling between layouts.
  jContent: { paddingTop: 14, paddingBottom: 100, gap: 14, paddingHorizontal: 16 },
  jWeeksContainer: { gap: 22 },
  jWeekBlock: { gap: 10 },
  jActivityRow: { gap: 12, paddingRight: 4 },
  jCard: { width: 150, aspectRatio: 3 / 4, borderRadius: 20, overflow: 'hidden', backgroundColor: '#211c19', position: 'relative' },

  // Month layout — swipeable calendar grid.
  jMonthPageFallback: { width: '100%' },
  // Swipe affordance for the month pager — a tap target is also just more
  // discoverable than a bare swipe gesture on its own. Aligned with the
  // month title row (jMonthCard's border + jMonthHeader's paddingTop + half
  // the title's line height), not vertically centered on the whole card —
  // reads as calendar nav (‹ July 2026 ›) instead of floating mid-grid.
  jMonthChevron: {
    position: 'absolute', top: 13, width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(19,19,19,0.55)', borderWidth: 1, borderColor: '#323232',
  },
  jMonthChevronLeft: { left: 6 },
  // Phones (Ricky, 2026-10-20, A): the calendar on the same plain card as the
  // week cards, no underline or salmon edge; quiet empty days; grey arrows.
  monthByWeek: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: -6 },
  jMonthCardPhone: {
    borderRadius: 22, borderWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: RivalGhost.ground, paddingBottom: 14,
    ...(Platform.OS === 'web' ? { backgroundImage: 'none' } as any : {}),
  },
  jMonthTitlePhone: { fontWeight: '700', fontSize: 23, color: '#fff' },
  jCalCellQuiet: { backgroundColor: 'rgba(255,255,255,0.035)' },
  jMonthChevronPhone: { top: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 0 },
  jMonthChevronRight: { right: 6 },
  jMonthCard: {
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,181,158,0.14)',
    borderBottomWidth: 2, borderBottomColor: RivalColors.accentFill,
    backgroundColor: '#2d241f', paddingBottom: 10, overflow: 'hidden',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(135deg, rgba(45,36,31,0.88) 0%, rgba(59,40,33,0.88) 100%)',
    } as any : {}),
  },
  jMonthHeader: { alignItems: 'center', paddingTop: 16, paddingBottom: 10, paddingHorizontal: 16 },
  jMonthTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '600', fontSize: 20, color: 'rgba(255,255,255,0.92)' },
  // A plain border can't fade, so this is a separate bar with a transparent-
  // to-color-to-transparent gradient (web) — tapers to a point at each tip
  // instead of the hard-cut edge a borderBottomWidth would give.
  jMonthTitleUnderline: {
    width: 190, height: 1.5, marginTop: 7, marginBottom: 4,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(90deg, rgba(217,119,87,0) 0%, rgba(217,119,87,0.8) 50%, rgba(217,119,87,0) 100%)',
    } as any : { backgroundColor: 'rgba(217,119,87,0.8)' }),
  },
  jDowRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 6 },
  jDow: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '800', letterSpacing: 0.4, color: 'rgba(255,255,255,0.3)' },
  jCalGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 6 },
  jCalCellEmpty: { width: '13%', aspectRatio: 3 / 4 },
  jCalCellRest: { width: '13%', aspectRatio: 3 / 4, borderRadius: 9, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', backgroundColor: '#211b18' },
  // Plain dark cell, no dashed outline — dashes read as an empty form field
  // to fill in, which fights the "dead" feeling rather than fixing it.
  jCalCellFuture: { width: '13%', aspectRatio: 3 / 4, borderRadius: 9, backgroundColor: '#2a2320', alignItems: 'center', justifyContent: 'center' },
  jCalCellActive: { width: '13%', aspectRatio: 3 / 4, borderRadius: 9, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', backgroundColor: '#3b2f27', overflow: 'hidden' },
  // Phones: square days, a little rounder; today ringed in white.
  jCalCellPhone: { aspectRatio: 1, borderRadius: 11 },
  // Today: its date in salmon (Ricky, 2026-10-20, 1). Not a ring, which is
  // kept for a best or an event, and white read as an event's ivory.
  jCalDaynumToday: { color: RivalColors.accentText, opacity: 1, fontWeight: '900' },
  // No frame round an active day: the photo or sky runs to the edge. Only a
  // best, an event or today draws a ring.
  jCalCellActivePhone: { borderWidth: 0, backgroundColor: 'transparent' },
  jCalCellBadgePhone: { borderWidth: 1.5 },
  jCalCellPb: { borderColor: RivalColors.rankAnchors.unrivaled },
  jCalCellRace: { borderColor: RivalColors.event },
  jCalCellPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  // Reserved space above the day number — see the comment at its call sites.
  jCalIconSlot: { height: 22, alignItems: 'center', justifyContent: 'center' },
  jCalDaynum: { fontSize: 12, fontWeight: '800', color: RivalColors.accentText, opacity: 0.35 },
  jCalDaynumFuture: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.28)' },
  jCalDaynumActive: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.85)' },
  jCalDaynumPhoto: { fontSize: 12, fontWeight: '800', color: '#fff', ...rivalTextShadow('rgba(0,0,0,0.8)', 0, 1, 4) },
  jCalLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16, paddingTop: 14 },
  jCalLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  jCalLegendSwatch: { width: 11, height: 11, borderRadius: 3, backgroundColor: '#3b2f27' },
  jCalLegendSwatchPb: { backgroundColor: RivalColors.rankAnchors.unrivaled },
  jCalLegendSwatchRace: { backgroundColor: '#ff5c5c' },
  jCalLegendText: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 11, fontWeight: '500', color: RivalColors.textSecondary },

  // Hero recap card — matches mockup .recap-card exactly.
  recapCard: {
    marginTop: -10,
    borderRadius: 12, paddingTop: 13, paddingHorizontal: 15, paddingBottom: 15,
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.14)',
    borderLeftWidth: 3, borderLeftColor: RivalColors.accentFill,
    borderRightWidth: 3, borderRightColor: RivalColors.accentFill,
    backgroundColor: '#2d241f',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'radial-gradient(circle at -10% -15%, rgba(255,209,190,0.14) 0%, rgba(255,209,190,0) 70%), linear-gradient(135deg, #231e1b 0%, #2d241f 55%, #3b2821 100%)',
    } as any : {}),
    gap: 9,
  },
  // Collapsed, the card is just the title row — tighter padding reads as a
  // sleek pill instead of a mostly-empty full-size card.
  recapCardCollapsed: { paddingTop: 8, paddingHorizontal: 12, paddingBottom: 8 },
  recapTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  recapTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '500', fontSize: 20, color: RivalColors.textPrimary },
  recapEffortInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recapEffortNumCol: { alignItems: 'flex-end' },
  recapEffortNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 24, lineHeight: 28, fontWeight: '700', color: RivalColors.textPrimary },
  recapEffortLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: RivalColors.accentText, marginTop: 1 },
  recapChevronOpen: { transform: [{ rotate: '180deg' }] },
  recapStatgrid: { flexDirection: 'row', backgroundColor: 'rgba(19,19,19,0.55)', borderWidth: 1, borderColor: '#323232', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 3 },
  recapStatcell: { flex: 1, alignItems: 'center', gap: 6, paddingHorizontal: 3 },
  recapStatcellDivider: { borderLeftWidth: 1, borderLeftColor: 'rgba(50,50,50,0.6)' },
  recapStatValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 21, fontWeight: '700', color: RivalColors.textPrimary, lineHeight: 22 },
  recapStatUnit: { fontSize: 10, fontWeight: '700', color: RivalColors.textSecondary, marginLeft: 2 },
  recapStatTitle: { fontSize: 9, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: RivalColors.textSecondary },
  recapQuote: { fontSize: 11, fontStyle: 'italic', fontWeight: '700', color: RivalColors.accentText, paddingTop: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },

  // Momentum strip (streak/delta) — not in the mockup, kept so real signal isn't lost.
  momentumRow: { flexDirection: 'row', gap: 8, marginTop: -4 },
  momentumChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  momentumChipText: { fontSize: 11, fontStyle: 'italic', color: RivalColors.textSecondary },

  jWeekDateRange: { fontSize: 11, fontWeight: '600', color: RivalColors.textSecondary },

  // Bigger 2-up grid tile (was a fixed 132×192 horizontal-scroll tile) — each
  // takes roughly half the row width and keeps the mockup's 3:4 aspect ratio,
  // so photos stand out more in the extra space the full-screen week frees up.
  // flexGrow:0 keeps every card at a uniform 48% width — a lone odd card on
  // the last line used to flexGrow:1 and stretch to fill the row, which read
  // as inconsistent card sizing (and threw off jAddCard sharing that line).
  jGridCard: { flexBasis: '48%', flexGrow: 0, flexShrink: 0, minWidth: 140, aspectRatio: 3 / 4, borderRadius: 20, overflow: 'hidden', backgroundColor: '#211c19', position: 'relative' },
  // Week rows (Ricky, 2026-10-27): each week one sideways row in day order.
  jRowCard: { flexBasis: 'auto', width: ROW_CARD_W, minWidth: 0 },
  weekRow: { marginHorizontal: -20, flexGrow: 0 },
  weekRowInner: { paddingHorizontal: 20, gap: 8, alignItems: 'flex-start' },
  // A day with nothing logged: thin and darker, with its date.
  restDay: {
    width: 30, height: ROW_CARD_W * 4 / 3, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
  },
  // A day of an event: the same thin card, marked in ivory (Ricky,
  // 2026-10-27, option 3).
  eventDay: { backgroundColor: '#1c1a17', borderColor: 'transparent', position: 'relative' },
  eventDayEdge: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, borderWidth: 1.5, borderColor: RivalColors.event },
  // The event's edge: ivory, or ivory running into gold with a PB. On web the
  // gradient fills the ring and the mask keeps only its border.
  eventEdgePb: Platform.OS === 'web' ? {
    borderColor: 'transparent',
    backgroundImage: `linear-gradient(160deg, ${RivalColors.event} 0%, ${RivalColors.event} 35%, ${RivalColors.rankAnchors.unrivaled} 75%)`,
    backgroundOrigin: 'border-box', backgroundClip: 'border-box',
    WebkitMask: 'linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor', maskComposite: 'exclude',
  } as any : { borderColor: RivalColors.rankAnchors.unrivaled },
  eventCard: {
    flexDirection: 'row', height: ROW_CARD_W * 4 / 3, marginTop: 10, borderRadius: 20, overflow: 'hidden',
    backgroundColor: RivalColors.surfaceHigh, position: 'relative',
  },
  eventEdge: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, borderWidth: 2, borderColor: RivalColors.event },
  eventPhoto: { width: '45%', position: 'relative', overflow: 'hidden', backgroundColor: '#211c19' },
  eventPanel: { flex: 1, paddingHorizontal: 12, paddingVertical: 11, gap: 8 },
  eventTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 },
  eventTags: { alignItems: 'flex-start', gap: 4 },
  eventWhen: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '500', fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  eventLegs: { gap: 4 },
  eventLeg: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventLegDist: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  eventLegTime: { fontSize: 12, fontWeight: '700', color: '#fff' },
  eventMore: { fontSize: 11, fontWeight: '600', color: RivalColors.textSecondary },
  eventChips: { flexDirection: 'row', gap: 5 },
  eventChip: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 12, backgroundColor: RivalColors.surfaceBright },
  eventChipDay: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8, color: RivalColors.event },
  eventChipNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, lineHeight: 19, color: '#fff' },
  eventChipSub: { fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  eventFoot: { marginTop: 'auto', flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  eventName: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  eventResult: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '800', fontSize: 20, lineHeight: 24, color: '#fff' },
  restDayPressed: { backgroundColor: 'rgba(255,181,158,0.08)', borderColor: 'rgba(255,181,158,0.35)' },
  restDayPlus: { position: 'absolute', top: 10 },
  restDayNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 14, color: 'rgba(255,255,255,0.3)' },
  restDayName: {
    fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: 'rgba(255,255,255,0.25)',
    ...(Platform.OS === 'web' ? { writingMode: 'vertical-rl', transform: 'rotate(180deg)' } as any : {}),
  },
  // Today, waiting at the end of this week's row: one tap to log it.
  todayCard: {
    width: ROW_CARD_W, aspectRatio: 3 / 4, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: RivalColors.surfaceHigh, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.6)',
  },
  todayLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: RivalColors.accentText },
  todayNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 64, lineHeight: 70, color: 'rgba(255,255,255,0.9)' },
  todayPlus: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: 8,
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  } as any,
  // A past week's heading: a rule above, then dates, title and Effort, and
  // three tiles in the Add an activity pop-up's grey.
  pwHead: { paddingTop: 22, marginTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', gap: 12 },
  // After a weeks-off line, that line is the divider: no rule of its own
  // (Ricky, 2026-10-27).
  pwHeadAfterGap: { borderTopWidth: 0, paddingTop: 0, marginTop: 0 },
  pwHeadRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  pwKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: RivalColors.accentText, marginBottom: 2 },
  // The event and PB pills, always on their own line under the week's name
  // (Ricky, 2026-10-27).
  pwTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  pwEventTag: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: 999, backgroundColor: RivalColors.event },
  pwPbTag: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: 999, backgroundColor: RivalColors.rankAnchors.unrivaled },
  pwTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, lineHeight: 26, color: '#fff' },
  pwEffort: { alignItems: 'center' },
  pwEffortNum: { ...weekEffortStyle, fontSize: 28, lineHeight: 32 },
  pwEffortLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2.2, textTransform: 'uppercase', color: RivalColors.accentText, marginTop: 1 },
  pwTiles: { flexDirection: 'row', gap: 6 },
  pwTile: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 14, backgroundColor: RivalColors.surfaceHigh, borderWidth: 1, borderColor: RivalColors.surfaceBright },
  pwTileFig: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, lineHeight: 24, color: '#fff' },
  pwTileUnit: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontWeight: '600', fontSize: 12, color: RivalColors.accentText },
  pwTileLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  // Activity's + beside Filter, in place of the Add activity bar.
  addRound: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  } as any,
  toggleRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Occupies a full grid column (matches jGridCard's flexBasis) so the
  // narrower jAddCard centers within whichever column the wrap naturally
  // puts it in, instead of hugging the left edge of a shared row.
  jAddCardSlot: { flexBasis: '48%', flexGrow: 0, flexShrink: 0, minWidth: 140, alignItems: 'center', justifyContent: 'center' },
  // Empty-week state (no activities logged yet this week) — a comparison
  // card in place of the bare grid, so Monday reads as a scoreboard rather
  // than a broken page.
  jWeekEmptyWrap: { alignItems: 'center', paddingTop: 8 },
  fvWrap: { paddingTop: 4, paddingBottom: 24 },
  fvHero: {
    borderRadius: 20, padding: 18, gap: 12, overflow: 'hidden',
    backgroundColor: '#1b1512', borderWidth: 1, borderColor: 'rgba(255,209,190,0.14)',
  },
  fvHeroGlow: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 200,
    backgroundImage: 'radial-gradient(ellipse 80% 90% at 50% 0%, rgba(217,119,87,0.28), rgba(217,119,87,0) 70%)',
  } as any,
  fvTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 23, lineHeight: 28, color: '#fff', textAlign: 'center' },
  fvSub: { fontSize: 13, lineHeight: 19, color: RivalColors.textSecondary, textAlign: 'center' },
  fvStats: { flexDirection: 'row', gap: 7 },
  fvStat: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.14)' },
  fvStatNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, color: 'rgba(255,255,255,0.35)' },
  fvStatLabel: { fontSize: 8.5, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary, marginTop: 2 },
  fvCta: { borderRadius: 999, paddingVertical: 14, alignItems: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  fvCtaText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  fvOr: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 14 },
  fvOrLine: { flex: 1, height: 1, backgroundColor: '#2a2a2a' },
  fvOrText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary },
  fvTiles: { flexDirection: 'row', gap: 8 },
  fvTile: {
    flex: 1, alignItems: 'center', gap: 7, paddingVertical: 14, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #2a1d18 0%, #1c1a19 70%)' } : { backgroundColor: '#241b17' }),
  } as any,
  fvBadge: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  fvTileText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  fvListTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, color: '#fff', marginTop: 24, marginBottom: 10 },
  fvBar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  fvBarFill: { height: '100%', backgroundColor: RivalColors.accentText, ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, #D97757, #ffb59e)' } : {}) } as any,
  fvCount: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 6, marginBottom: 10 },
  fvSteps: { backgroundColor: '#262220', borderRadius: 16, borderWidth: 1, borderColor: RivalColors.surfaceBright, paddingHorizontal: 12 },
  fvStep: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 60 },
  fvStepBorder: { borderTopWidth: 1, borderTopColor: 'rgba(50,50,50,0.8)' },
  fvNum: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,181,158,0.5)' },
  fvNumDone: {
    borderWidth: 0, backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  fvNumText: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 13, color: RivalColors.accentText },
  fvStepTitle: { fontSize: 14, fontWeight: '600', color: '#fff' },
  fvStepTitleDone: { color: RivalColors.textSecondary, textDecorationLine: 'line-through' },
  fvStepSub: { fontSize: 11.5, color: RivalColors.textSecondary, marginTop: 1 },
  nwKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 2, color: RivalColors.accentText, textTransform: 'uppercase', marginTop: 6 },
  nwQuote: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '600', fontSize: 18, lineHeight: 25, color: 'rgba(255,255,255,0.88)', textAlign: 'center', marginTop: 8, marginBottom: 18, paddingHorizontal: 12 },
  lwCard: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden',
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18,
    backgroundColor: RivalGhost.ground, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  lwGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 80, backgroundImage: 'radial-gradient(ellipse 75% 100% at 50% 0%, rgba(232,131,95,0.14), rgba(232,131,95,0) 70%)' } as any,
  lwPhotos: { flexDirection: 'row' },
  lwPhoto: { width: 44, height: 44, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: RivalGhost.ground, backgroundColor: '#2a2522' },
  lwPhotoOverlap: { marginLeft: -12 },
  lwSky: Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #2c3846, #4d5f72)' } as any : { backgroundColor: '#3a4a5c' },
  lwPhotoImg: { width: '100%', height: '100%' },
  lwKicker: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: '#fff' },
  lwDates: { fontFamily: RivalFontFamily, fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  nwLabel: { alignSelf: 'flex-start', fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary, textTransform: 'uppercase', marginBottom: 8, marginLeft: 2 },
  nwList: { alignSelf: 'stretch', gap: 8, opacity: 0.6 },
  nwRow: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, borderRadius: 14, backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: '#2a2a2a' },
  nwTile: {
    width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(225deg, #FFB86B 0%, #FF8773 100%)' } : {}),
  } as any,
  nwText: { flex: 1, minWidth: 0, gap: 2 },
  nwName: { fontSize: 14, fontWeight: '600', color: '#fff' },
  nwMeta: { fontSize: 12, color: RivalColors.textSecondary },
  nwEffort: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: RivalColors.accentText },
  jWeekEmptyCard: {
    width: '100%', borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 22, paddingHorizontal: 20, alignItems: 'center', gap: 6, marginBottom: 4,
  },
  jWeekEmptyTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 16, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  jWeekEmptySub: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
  // width is relative to the slot now (was flexBasis relative to the grid) —
  // 81% preserves the same visual size as before (38.88% of the old 48% grid
  // column). Height unchanged.
  jAddCard: {
    width: '81%', minWidth: 113, aspectRatio: 2.7 / 2.4948, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 24,
  },
  // Same serif family/italic as jCardName ("Swim"/"Ride" titles), but kept
  // at the original size/weight — just the font, not the bold treatment.
  jAddCardText: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '500', fontSize: 15, letterSpacing: 0.3, color: 'rgba(255,255,255,0.6)' },
  jCardPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  jCardArt: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2d241f',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'radial-gradient(ellipse 90% 60% at 50% 40%, rgba(255,209,190,0.10) 0%, rgba(19,19,19,0) 65%), linear-gradient(160deg, #231e1b 0%, #2d241f 55%, #3b2821 100%)',
    } as any : {}),
  },
  jCardScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0) 42%, rgba(8,8,8,0.88) 100%)' } as any : { backgroundColor: 'rgba(8,8,8,0.35)' }),
  },
  jCardDayBadge: { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' },
  jCardDayText: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '500', fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  jCardBody: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6 },
  jCardName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '800', fontSize: 16, letterSpacing: 0.3, color: '#fff', lineHeight: 19 },
  jCardStat: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  jCardEffort: { alignItems: 'center', gap: 1 },
  jCardEffortNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 16, fontWeight: '700', color: '#fff', lineHeight: 18 },
  jCardEffortLabel: { fontSize: 7, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  jCardPin: { position: 'absolute', top: 10, right: 10, zIndex: 4 },
  weeksOff: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  // Phones: midway between the week above and the card below (Ricky,
  // 2026-10-21). 60 above it otherwise (grid 32 + page 14 + page 14), 16 under.
  weeksOffCentred: { marginTop: -19, marginBottom: 21 },
  // Week rows: clear of the row above, before the next week's rule.
  weeksOffRows: { marginTop: 10, marginBottom: 24 },
  weeksOffRule: { flex: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)' },
  weeksOffText: { fontSize: 11.5, fontWeight: '700', color: '#fff' },
  jCardTags: { position: 'absolute', top: 9, left: 9, zIndex: 3, alignItems: 'flex-start', gap: 4 },
  jCardEventTag: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: 999, backgroundColor: RivalColors.event },
  jCardEventTagText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: '#2a2116' },
  jCardPbTag: { backgroundColor: RivalColors.rankAnchors.unrivaled },
  jCardPbTagFaded: { backgroundColor: 'rgba(255,215,0,0.18)', borderWidth: 1, borderColor: 'rgba(255,215,0,0.45)' },
  jCardDayBadgeSide: { left: undefined, right: 12, alignItems: 'flex-end' },
  jCardRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2.5, borderRadius: 20 },
  // A race that was also a PB: the edge runs ivory into gold. On web the
  // gradient fills the ring and the mask keeps only its border.
  jCardRingEventPb: Platform.OS === 'web' ? {
    borderColor: 'transparent',
    backgroundImage: `linear-gradient(160deg, ${RivalColors.event} 0%, ${RivalColors.event} 35%, ${RivalColors.rankAnchors.unrivaled} 75%)`,
    backgroundOrigin: 'border-box', backgroundClip: 'border-box',
    WebkitMask: 'linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor', maskComposite: 'exclude',
  } as any : { borderColor: RivalColors.rankAnchors.unrivaled },
  jCardCurrent: { position: 'absolute', top: 32, left: 0, right: 0, alignItems: 'center' },
  jCardCurrentText: { overflow: 'hidden', backgroundColor: RivalColors.rankAnchors.unrivaled, color: '#2a2116', fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  pbSection: { width: '100%', marginBottom: 22 },
  pbSectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginHorizontal: 2, marginBottom: 10 },
  pbSectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: RivalColors.accentText },
  pbSectionCount: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  pbMore: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  pbMoreText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
});
