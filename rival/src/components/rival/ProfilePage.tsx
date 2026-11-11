import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { RivalButtonColors, RivalColors, RivalGhost, RivalSerifFamily } from '../../constants/rivalTheme';
import { rankSheen, rankTileFill, RANK_TILE_INK } from '../../constants/rankSheen';
import { onActivityDeleted } from '../../lib/activityEvents';
import { activityPbs, DISTANCE_SPORTS } from '../../lib/activityPbs';
import { formatDurationClock } from '../../lib/format';
import { formatRaceName } from '../../lib/identity';
import { distanceNumber, distanceUnit, elevationNumber, elevationUnit, formatActivityDistance, formatDistance, formatWeight } from '../../lib/units';
import { milestoneWords, monthDays, monthsSince, profileBests, profileMilestones, yearTotals, type NextMilestone, type ProfileActivity } from '../../lib/profilePage';
import { activityDisplayName } from '../../lib/yearReview';
import { ActivityDiaryViewer, type DiaryActivity } from './ActivityDiaryViewer';
import { ProfileTeams } from './ProfileTeams';
import { CoverImage } from './CoverImage';
import { RivalBackButton } from './RivalBackButton';
import { GreyArtTile, GreyRow, GreyRows, GreySheet } from './RivalGreySheet';
import { RivalAvatar } from './RivalAvatar';
import { updatePrefs, usePrefs } from '../../lib/prefs';
import { notify } from '../../lib/notify';
import { PROFILE_STAT_KEYS, readProfileStats, type ProfileStatKey } from '../../lib/profileStats';
import { RivalIcon, activityIconName, type RivalIconName } from './RivalIcon';
import { SkyBackdrop } from './SkyBackdrop';
import { EventSheet } from './EventSheet';
import { useBlockedIds, openReport, openBlock, unblockMember, firstName } from '../../lib/safety';

// A person's profile on phones: what a teammate sees when they tap someone
// (Ricky, 2026-10-30, the cover). Cover, the year's numbers, Highlights,
// Personal bests, Events, the calendar, then Milestones.

export type ProfileRow = ProfileActivity & {
  notes: string | null;
  location: string | null;
  companions: string | null;
  shared_from_activity_id: string | null;
  pinned: boolean;
  race_id: string | null;
  effort_confirmed?: boolean;
};

export type ProfileRace = {
  id: string;
  name: string;
  race_type: string | null;
  race_date: string | null;
  location: string | null;
  actual_finish_time: string | null;
};

const HIGHLIGHTS_SHOWN = 12;
const NEAR_OPENED = 20;
const MONTHS_DRAWN = 2;
// The same gold as personal best tags on the Activity page.
const PB_COLOR = RivalColors.rankAnchors.unrivaled;

const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const weekday = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });
const dayOf = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d); };
const daysUntil = (date: string, now: Date) =>
  Math.round((dayOf(date).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
const shortDate = (date: string) => dayOf(date).toLocaleDateString(undefined,
  dayOf(date).getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });

function headline(a: ProfileActivity): string {
  return formatActivityDistance(a.distance_meters, a.activity_type) || formatDurationClock(a.duration_seconds) || '';
}

function Label({ children, right, onPress }: { children: string; right?: string; onPress?: () => void }) {
  return (
    <View style={s.lab}>
      <Text style={s.labText}>{children}</Text>
      {right ? (
        <TouchableOpacity disabled={!onPress} onPress={onPress} activeOpacity={0.7}><Text style={s.labRight}>{right}</Text></TouchableOpacity>
      ) : null}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.rowScroll} contentContainerStyle={s.row}>{children}</ScrollView>;
}

// The name stays on one line (Ricky, 2026-10-31): measured in the page's own
// serif and set smaller to fit. Native goes by about 0.6 of the size per letter.
function nameFit(name: string, screen: number) {
  const room = screen - 40;
  let perSize = Math.max(name.length, 1) * 0.6;
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `italic 700 100px ${RivalSerifFamily}`;
      perSize = ctx.measureText(name).width / 100 || perSize;
    }
  }
  const size = Math.min(46, Math.floor(room / perSize));
  return { fontSize: size, lineHeight: Math.round(size * 1.15) };
}

function PhotoTile({ a, stamp, title, value, gold, big, onPress, width, height }: {
  a: ProfileActivity; stamp: string; title: string; value: string; gold?: boolean;
  /** A milestone: the number leads, large, with its words under it. */
  big?: boolean;
  onPress: () => void; width: number; height: number;
}) {
  return (
    <TouchableOpacity style={[s.tile, { width, height }]} activeOpacity={0.88} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title} ${value}`}>
      {a.photo_url ? <CoverImage uri={a.photo_url} focalX={a.photo_focal_x} focalY={a.photo_focal_y} style={s.fill} /> : (
        <View style={[s.fill, s.tileArt]}><SkyBackdrop startedAt={a.started_at} /><RivalIcon name={activityIconName(a.activity_type)} size={64} color="rgba(255,255,255,0.16)" /></View>
      )}
      <View style={[s.fill, s.tileShade, { pointerEvents: 'none' }]} />
      <View style={s.stampWrap}><Text style={s.stamp} numberOfLines={1}>{stamp}</Text></View>
      <View style={s.tileFoot}>
        {big ? null : <Text style={s.tileTitle} numberOfLines={1}>{title}</Text>}
        <Text style={[s.tileValue, big && s.nextValue]} numberOfLines={1}>{value}</Text>
        {big ? <Text style={s.tileTitle} numberOfLines={1}>{title}</Text> : null}
      </View>
      {gold ? <View style={[s.fill, s.goldEdge, { pointerEvents: 'none' }]} /> : null}
    </TouchableOpacity>
  );
}

function NextTile({ next }: { next: NextMilestone }) {
  const left = next.target - next.current;
  const unit = next.kind === 'elevation' ? ' m' : next.kind === 'km' ? ' km' : next.kind === 'hours' ? ' hours' : left === 1 ? ' activity' : ' activities';
  return (
    <View style={[s.tile, s.nextTile]}>
      <Text style={s.kick}>Next</Text>
      <View style={{ marginTop: 'auto' }}>
        <Text style={s.nextValue}>{next.target.toLocaleString()}</Text>
        <Text style={s.nextWords}>{milestoneWords(next.kind)}</Text>
        <View style={s.bar}><View style={[s.barFill, { width: `${Math.min(100, Math.round(next.current / next.target * 100))}%` as any }]} /></View>
        <Text style={s.nextLeft}>{left.toLocaleString()}{unit} to go</Text>
      </View>
    </View>
  );
}

function Calendar({ activities, bestIds, width, onOpen }: { activities: ProfileRow[]; bestIds: Set<string>; width: number; onOpen: (id: string) => void }) {
  const first = useMemo(() => activities.reduce<string | null>((m, a) => (!m || a.started_at < m ? a.started_at : m), null), [activities]);
  const months = useMemo(() => monthsSince(first), [first]);
  const [shown, setShown] = useState(months.length - 1);
  // Each month as tall as its own weeks, so a five-week month leaves no gap.
  const [heights, setHeights] = useState<Record<number, number>>({});
  const pager = useRef<ScrollView>(null);
  const placed = useRef(false);
  useEffect(() => { setShown(months.length - 1); placed.current = false; }, [months.length]);

  const cell = Math.floor((width - 16 - 2 - 18) / 7);
  const now = new Date();
  const thisYear = now.getFullYear();

  const lastMonth = months.length - 1;
  // A year's jump lands straight on the month: the months between aren't drawn.
  const jump = (to: number, animated: boolean) => {
    const i = Math.max(0, Math.min(lastMonth, to));
    setShown(i);
    pager.current?.scrollTo({ x: i * width, animated });
  };
  const nav = (icon: 'yearBack' | 'monthBack' | 'monthForward' | 'yearForward', label: string, on: boolean, go: () => void) => (
    <TouchableOpacity style={[s.calNav, !on && s.calNavOff]} disabled={!on} onPress={go} hitSlop={4} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !on }}>
      <RivalIcon name={icon} size={18} color="rgba(255,255,255,0.6)" />
    </TouchableOpacity>
  );

  return (
    <ScrollView
      ref={pager}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={50}
      style={{ width, height: heights[shown] }}
      contentContainerStyle={{ alignItems: 'flex-start' }}
      // The newest month first: older months are a swipe back.
      onContentSizeChange={() => {
        if (placed.current) return;
        placed.current = true;
        pager.current?.scrollToEnd({ animated: false });
      }}
      onScroll={(e) => {
        const i = Math.round(e.nativeEvent.contentOffset.x / width);
        setShown((cur) => (cur === i ? cur : Math.max(0, Math.min(months.length - 1, i))));
      }}
    >
      {months.map(({ year, month }, mi) => {
        if (Math.abs(mi - shown) > MONTHS_DRAWN) return <View key={`${year}-${month}`} style={{ width }} />;
        const days = monthDays(activities, year, month);
        const blanks = (new Date(year, month, 1).getDay() + 6) % 7;
        const count = new Date(year, month + 1, 0).getDate();
        const title = new Date(year, month, 1).toLocaleDateString(undefined, year === thisYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
        return (
          <View key={`${year}-${month}`} style={{ width }}>
            <View style={s.calCard} onLayout={(e) => { const h = e.nativeEvent.layout.height; setHeights((cur) => (cur[mi] === h ? cur : { ...cur, [mi]: h })); }}>
              <View style={s.calHead}>
                <View style={s.calNavs}>
                  {nav('yearBack', 'Previous year', mi > 0, () => jump(mi - 12, false))}
                  {nav('monthBack', 'Previous month', mi > 0, () => jump(mi - 1, true))}
                </View>
                <Text style={s.calTitle} numberOfLines={1}>{title}</Text>
                <View style={s.calNavs}>
                  {nav('monthForward', 'Next month', mi < lastMonth, () => jump(mi + 1, true))}
                  {nav('yearForward', 'Next year', mi < lastMonth, () => jump(mi + 12, false))}
                </View>
              </View>
              <View style={s.calGrid}>
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <Text key={i} style={[s.calDow, { width: cell }]}>{d}</Text>)}
              </View>
              <View style={[s.calGrid, { marginTop: 6 }]}>
                {Array.from({ length: blanks }, (_, i) => <View key={`b${i}`} style={{ width: cell, height: cell * 4 / 3 }} />)}
                {Array.from({ length: count }, (_, i) => {
                  const day = i + 1;
                  const acts = days.get(day) ?? [];
                  const photo = acts.find((a) => a.photo_url);
                  const pb = acts.some((a) => bestIds.has(a.id));
                  const event = acts.some((a) => a.race_id);
                  return (
                    <TouchableOpacity
                      key={day}
                      disabled={!acts.length}
                      activeOpacity={0.8}
                      onPress={() => onOpen(acts[0].id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${title} ${day}, ${acts.length} ${acts.length === 1 ? 'activity' : 'activities'}`}
                      style={[s.calCell, { width: cell, height: cell * 4 / 3 }, acts.length > 0 && s.calCellOn]}
                    >
                      {photo?.photo_url ? <CoverImage uri={photo.photo_url} focalX={photo.photo_focal_x} focalY={photo.photo_focal_y} style={s.fill} /> : acts[0] ? (
                        // No photo: the day's own sky and what was done, as on Activity.
                        <View style={[s.fill, s.tileArt]}>
                          <SkyBackdrop startedAt={acts[0].started_at} />
                          <RivalIcon name={activityIconName(acts[0].activity_type)} size={20} color="rgba(255,255,255,0.75)" />
                        </View>
                      ) : null}
                      <Text style={[s.calDay, acts.length > 0 && s.calDayOn, !!photo && s.calDayPhoto]}>{day}</Text>
                      {pb || event ? <View style={[s.fill, s.calEdge, { borderColor: pb ? PB_COLOR : RivalColors.event, pointerEvents: 'none' }]} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const EMPTY_COVER = require('../../../assets/images/backgrounds/optimized/a-vast-sun-drenched-alpine.jpg');
// The first milestone: by then a member has settled in, so the card goes.
const BUILD_CARD_UNTIL = 10;
const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** A tile that shows the shape of what's coming: icon centred, words bottom left. */
function GhostTile({ icon, stamp, title, value, width, height, gold, big }: {
  icon: RivalIconName; stamp: string; title: string; value: string; width: number; height: number; gold?: boolean; big?: boolean;
}) {
  return (
    <View style={[s.tile, s.ghostTile, gold && s.ghostGold, { width, height }]}>
      <View style={[s.fill, s.tileArt, { pointerEvents: 'none' }]}><RivalIcon name={icon} size={64} color="rgba(255,255,255,0.16)" /></View>
      <View style={s.stampWrap}><Text style={s.stamp} numberOfLines={1}>{stamp}</Text></View>
      <View style={s.tileFoot}>
        {big ? null : <Text style={s.tileTitle}>{title}</Text>}
        <Text style={[s.tileValue, big && s.nextValue, gold && s.ghostValue]}>{value}</Text>
        {big ? <Text style={[s.tileTitle, s.ghostValue]}>{title}</Text> : null}
      </View>
    </View>
  );
}

function BuildProfile({ steps, done, onHide }: { steps: { key: string; label: string; icon: RivalIconName; onPress: () => void }[]; done: number; onHide: () => void }) {
  const total = done + steps.length;
  return (
    <View style={s.mainCard}>
      <Text style={[s.kick, s.center]}>Get started</Text>
      <Text style={s.mainTitle}>Build profile</Text>
      <Text style={s.mainSub}>{done} of {total} complete</Text>
      <View style={s.mainBar}><View style={[s.barFill, { width: `${Math.round(done / total * 100)}%` as any }]} /></View>
      <View style={s.mainTiles}>
        {steps.map((t, i) => <GreyArtTile key={t.key} label={t.label} icon={t.icon} on={i === 0} style={[s.mainTile, i > 0 && s.mainTileGrey]} onPress={t.onPress} />)}
      </View>
      <TouchableOpacity onPress={onHide} style={s.hide} accessibilityRole="button"><Text style={s.moreText}>Hide</Text></TouchableOpacity>
    </View>
  );
}

function ThisWeek() {
  const now = new Date();
  const today = (now.getDay() + 6) % 7;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return (
    <View style={s.week}>
      {Array.from({ length: today }, (_, i) => {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - today + i);
        return (
          <TouchableOpacity key={i} style={s.restDay} activeOpacity={0.8} onPress={() => router.push(`/add-workout?date=${iso(day)}` as any)} accessibilityRole="button" accessibilityLabel={`Add an activity on ${WEEK_DAYS[i]}`}>
            <Text style={s.restNum}>{day.getDate()}</Text>
            <Text style={s.restName}>{WEEK_DAYS[i]}</Text>
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity style={s.today} activeOpacity={0.85} onPress={() => router.push('/add-workout')} accessibilityRole="button" accessibilityLabel="Add an activity today">
        <Text style={s.todayLabel}>{now.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}</Text>
        <Text style={s.todayNum}>{now.getDate()}</Text>
        <Text style={s.todayLabel}>TODAY</Text>
        <View style={s.todayPlus}><RivalIcon name="add" size={22} color={RivalButtonColors.label(RivalColors.onAccentFill)} /></View>
      </TouchableOpacity>
    </View>
  );
}

/** A teammate's view of someone who hasn't logged anything yet. */
export type ProfileWelcome = { teamId: string; teamName: string; teamLogo: string | null; joinedAt: string; inviterId: string | null; inviterName: string | null; inviterAvatar: string | null };

export function ProfilePage({
  userId, isOwn, name, avatarUrl, mindset, memberSince, level, rankName, activities, races, runs,
  respect, inspired, people, lifetime, km, elevation, weekEffort, streakWeeks, pastYears, year, teamCount, profileStats, welcome,
  onBack, onChanged, pullProps, pullIndicator, footer,
}: {
  userId: string;
  isOwn: boolean;
  name: string;
  avatarUrl: string | null;
  mindset: string;
  memberSince: string;
  level: number;
  rankName: string;
  activities: ProfileRow[];
  races: ProfileRace[];
  runs: Parameters<typeof profileBests>[1];
  respect: number;
  inspired: number;
  people: number;
  lifetime: number;
  km: number;
  elevation: number;
  weekEffort: number;
  streakWeeks: number;
  pastYears: { year: number; final_xp: number; final_rank_name: string }[];
  year: number;
  teamCount: number;
  profileStats: string[] | null;
  welcome?: ProfileWelcome | null;
  onBack: () => void;
  onChanged: () => void;
  pullProps: object;
  pullIndicator: ReactNode;
  footer?: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [statsOpen, setStatsOpen] = useState(false);
  const [chosenStats, setChosenStats] = useState(() => readProfileStats(profileStats));
  useEffect(() => { setChosenStats(readProfileStats(profileStats)); }, [profileStats]);
  // Which side's stat is being changed: 0 left, 1 right.
  const [pickingStat, setPickingStat] = useState<0 | 1 | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [patches, setPatches] = useState<Record<string, Partial<DiaryActivity>>>({});
  const [diaryIndex, setDiaryIndex] = useState<number | null>(null);
  // A one-day event opens its own page (Ricky, 2026-11-04, design/event-compare-v9.png).
  const [openEvent, setOpenEvent] = useState<{ raceId: string; legs: ProfileActivity[] } | null>(null);
  const [media, setMedia] = useState<Record<string, { url: string; type: 'photo' | 'video'; focalX?: number | null; focalY?: number | null }[]>>({});

  const newest = useMemo(() => activities.slice().sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()), [activities]);
  const totals = useMemo(() => yearTotals(activities, year), [activities, year]);
  const statInfo: Record<ProfileStatKey, { icon: RivalIconName; label: string; cardLabel: string; value: string; unit: string; longUnit?: string }> = {
    time: { icon: 'timer', label: 'Time earned', cardLabel: `${year} Time earned`, value: totals.hours.toLocaleString(), unit: 'h' },
    activities: { icon: 'calendar', label: 'Activities', cardLabel: `${year} Activities`, value: totals.activities.toLocaleString(), unit: '' },
    distance: { icon: 'distance', label: 'Distance', cardLabel: `${year} Distance`, value: distanceNumber(totals.km), unit: ` ${distanceUnit()}` },
    elevation: { icon: 'elevation', label: 'Elevation', cardLabel: `${year} Elevation`, value: elevationNumber(totals.elevation), unit: ` ${elevationUnit()}` },
    streak: { icon: 'fire', label: 'Streak', cardLabel: 'Streak', value: streakWeeks.toLocaleString(), unit: ' wk', longUnit: streakWeeks === 1 ? ' week' : ' weeks' },
    lifetime: { icon: 'trophy', label: 'Lifetime Effort', cardLabel: 'Lifetime Effort', value: Math.round(lifetime).toLocaleString(), unit: '' },
  };
  const chooseStat = async (key: ProfileStatKey) => {
    if (pickingStat === null) return;
    const before = chosenStats;
    const next: typeof chosenStats = pickingStat === 0 ? [key, before[1]] : [before[0], key];
    setPickingStat(null);
    if (key === before[pickingStat]) return;
    setChosenStats(next);
    const { data, error } = await supabase.from('users').update({ profile_stats: next }).eq('id', userId).select('id');
    if (error || !data?.length) {
      setChosenStats(before);
      notify('The stat could not be saved. Try again.');
    }
  };
  const { pbs, prev, lifts } = useMemo(() => activityPbs(activities, userId), [activities, userId]);
  const bests = useMemo(() => profileBests(activities, runs), [activities, runs]);
  const bestIds = useMemo(() => new Set(bests.filter((b) => b.kind !== 'distance').map((b) => b.activityId)), [bests]);
  const { earned, next } = useMemo(() => profileMilestones(activities), [activities]);
  const pinned = useMemo(() => newest.filter((a) => a.pinned), [newest]);
  const byId = useMemo(() => new Map(newest.map((a) => [a.id, a])), [newest]);

  const diaryList = useMemo<DiaryActivity[]>(() => newest.map((a) => ({
    id: a.id,
    name: a.name ?? null,
    activity_type: a.activity_type,
    started_at: a.started_at,
    duration_seconds: a.duration_seconds || 0,
    distance_meters: a.distance_meters || 0,
    elevation_meters: a.elevation_meters,
    effort_score: a.effort_score || 0,
    photo_url: a.photo_url ?? null,
    photo_focal_x: a.photo_focal_x ?? null,
    photo_focal_y: a.photo_focal_y ?? null,
    notes: a.notes,
    location: a.location,
    companions: a.companions,
    shared_from_activity_id: a.shared_from_activity_id,
    pinned: a.pinned,
    race_id: a.race_id,
    isPb: !!pbs[a.id],
    pbPrev: lifts[a.id] ? lifts[a.id].prevKg : prev[a.id] ?? null,
    pbLift: lifts[a.id]?.lift ?? null,
    pbKind: lifts[a.id] ? 'lift' : DISTANCE_SPORTS.has(a.activity_type) ? 'distance' : 'time',
    effort_confirmed: a.effort_confirmed,
    exercises: (a.exercises ?? null) as DiaryActivity['exercises'],
    ...patches[a.id],
  })), [newest, pbs, prev, lifts, patches]);

  // Deleted from its edit page: nothing left to show open.
  useEffect(() => onActivityDeleted(() => setDiaryIndex(null)), []);

  function open(id: string) {
    const i = newest.findIndex((a) => a.id === id);
    if (i < 0) return;
    setDiaryIndex(i);
    // The extra photos of what is near the one opened; the rest of the
    // history stays unloaded.
    const ids = newest.slice(Math.max(0, i - NEAR_OPENED), i + NEAR_OPENED + 1).map((a) => a.id);
    supabase.from('activity_media').select('activity_id, media_url, media_type, focal_x, focal_y, position').in('activity_id', ids).order('position', { ascending: true })
      .then(({ data, error }) => {
        if (error || !data) return;
        const next: typeof media = {};
        for (const m of data as any[]) (next[m.activity_id] ??= []).push({ url: m.media_url, type: m.media_type, focalX: m.focal_x, focalY: m.focal_y });
        setMedia((cur) => ({ ...cur, ...next }));
      });
  }

  const addEvent = () => router.push('/races?add=true&then=back' as any);
  // Your own events open the full page, where each can be edited or deleted.
  // A teammate's show as a list here.
  const openEvents = () => (isOwn ? router.push('/races') : setEventsOpen(true));

  const now = new Date();
  const upcoming = useMemo(() => races.filter((r) => r.race_date && daysUntil(r.race_date, now) >= 0).sort((a, b) => a.race_date!.localeCompare(b.race_date!)), [races]);
  const past = useMemo(() => races.filter((r) => r.race_date && daysUntil(r.race_date, now) < 0).sort((a, b) => b.race_date!.localeCompare(a.race_date!)), [races]);
  const completed = useMemo(() => past
    .map((race) => ({ race, legs: newest.filter((a) => a.race_id === race.id).reverse() })), [past, newest]);

  const coverPhoto = avatarUrl ?? pinned.find((a) => a.photo_url)?.photo_url ?? newest.find((a) => a.photo_url)?.photo_url ?? null;
  const coverHeight = coverPhoto ? Math.round(width * 1.32) : 293 + insets.top;
  const prefs = usePrefs();
  const brandNew = activities.length === 0;
  const allSteps: { key: string; label: string; icon: RivalIconName; done: boolean; onPress: () => void }[] = [
    { key: 'log', label: 'Log an activity', icon: 'add', done: !brandNew, onPress: () => router.push('/add-workout') },
    { key: 'import', label: 'Import history', icon: 'history', done: !brandNew, onPress: () => router.push('/import-archive') },
    { key: 'photo', label: 'Add photo', icon: 'addPhoto', done: !!avatarUrl, onPress: () => router.push('/profile?tab=personal' as any) },
    { key: 'mindset', label: 'Add mindset', icon: 'formatQuote', done: !!mindset, onPress: () => router.push('/profile?tab=personal' as any) },
    { key: 'event', label: 'Add event', icon: 'flag', done: races.length > 0, onPress: addEvent },
    { key: 'team', label: 'Join a team', icon: 'groups', done: teamCount > 0, onPress: () => router.push('/join-league') },
  ];
  const steps = allSteps.filter((t) => !t.done);
  const building = isOwn && !prefs.hideBuildProfile && activities.length < BUILD_CARD_UNTIL && steps.length > 0;
  const calendarWidth = width - 16;
  const hours = Math.floor(activities.reduce((t, a) => t + (a.duration_seconds || 0), 0) / 3600);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.page} {...pullProps}>
        {pullIndicator}
        <View style={{ height: coverHeight }}>
          {coverPhoto ? <CoverImage uri={coverPhoto} full style={s.fill} focalY={0.3} /> : <View style={[s.fill, { overflow: 'hidden' }]}><Image source={EMPTY_COVER} style={{ width, height: coverHeight }} resizeMode="cover" /></View>}
          <View style={[s.coverShade, { pointerEvents: 'none' }]} />
          <View style={s.coverFoot}>
            <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/ranks')} style={[s.rank, rankTileFill(level)]} accessibilityRole="button" accessibilityLabel={`${rankName} rank`}>
              <RivalIcon name={`rank${rankName}` as RivalIconName} size={14} color={RANK_TILE_INK} />
              <Text style={s.rankText}>{rankName}</Text>
            </TouchableOpacity>
            <Text style={[s.name, nameFit(name, width)]}>{name}</Text>
            {mindset ? <Text style={s.quote}>“{mindset}”</Text> : null}
            {memberSince ? <Text style={s.member}>Member since {memberSince}</Text> : null}
          </View>
        </View>

        <View style={s.pad}>
          <View style={s.stats}>
            <View style={s.nums}>
              {[
                { side: 0 as const, v: statInfo[chosenStats[0]].value, u: statInfo[chosenStats[0]].unit, l: statInfo[chosenStats[0]].cardLabel },
                { side: null, v: totals.effort.toLocaleString(), u: '', l: `${year} Effort` },
                { side: 1 as const, v: statInfo[chosenStats[1]].value, u: statInfo[chosenStats[1]].unit, l: statInfo[chosenStats[1]].cardLabel },
              ].map((n, i) => {
                const canChange = isOwn && n.side !== null;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[s.num, i > 0 && s.numRule]}
                    disabled={!canChange}
                    activeOpacity={0.7}
                    onPress={() => setPickingStat(n.side)}
                    accessibilityRole={canChange ? 'button' : undefined}
                    accessibilityLabel={canChange ? `Change ${n.l}` : undefined}
                  >
                    <Text style={s.numValue} numberOfLines={1}>{n.v}{n.u ? <Text style={s.numUnit}>{n.u}</Text> : null}</Text>
                    <View style={s.numLabelRow}>
                      <Text style={s.numLabel}>{n.l}</Text>
                      {canChange ? <RivalIcon name="chevronDown" size={10} color={RivalColors.accentText} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={s.impact}>
              {[
                { icon: 'respect' as const, v: respect, l: 'Respect' },
                { icon: 'impact' as const, v: inspired, l: 'Inspired' },
                { icon: 'groups' as const, v: people, l: 'People' },
              ].map((f) => (
                <View key={f.l} style={s.impactItem}>
                  <RivalIcon name={f.icon} size={13} color={RivalColors.accentText} />
                  <Text style={s.impactValue}>{f.v.toLocaleString()}</Text>
                  <Text style={s.impactLabel}>{f.l}</Text>
                </View>
              ))}
            </View>
          </View>
          <TouchableOpacity activeOpacity={0.7} onPress={() => setStatsOpen(true)} style={s.more}><Text style={s.moreText}>All stats</Text></TouchableOpacity>

          {building ? <BuildProfile steps={steps} done={allSteps.length - steps.length} onHide={() => { updatePrefs({ hideBuildProfile: true }); }} /> : null}

          {!isOwn && brandNew && welcome ? (
            <View style={s.mainCard}>
              <Text style={[s.kick, s.center]}>New to RIVAL</Text>
              <Text style={s.mainTitle}>{name.trim().split(/\s+/)[0]} just joined</Text>
              <Text style={s.mainSub}>Their first activity will show here.</Text>
              <TouchableOpacity style={s.link} activeOpacity={0.8} onPress={() => router.push({ pathname: '/team-hub', params: { id: welcome.teamId } })} accessibilityRole="button">
                {welcome.teamLogo ? <Image source={{ uri: welcome.teamLogo }} style={s.linkLogo} resizeMode="contain" /> : <View style={s.linkLogo} />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.linkName} numberOfLines={1}>{welcome.teamName}</Text>
                  <Text style={s.linkLine} numberOfLines={1}>Teammates since {new Date(welcome.joinedAt).toLocaleDateString(undefined, { month: 'long' })}</Text>
                </View>
                <RivalIcon name="chevronRight" size={20} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
              {welcome.inviterId && welcome.inviterName ? (
                <TouchableOpacity style={s.link} activeOpacity={0.8} onPress={() => router.push(`/stats?userId=${welcome.inviterId}` as any)} accessibilityRole="button">
                  <RivalAvatar uri={welcome.inviterAvatar} name={welcome.inviterName} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.linkName} numberOfLines={1}>Invited by {welcome.inviterName}</Text>
                    <Text style={s.linkLine}>Teammate</Text>
                  </View>
                  <RivalIcon name="chevronRight" size={20} color="rgba(255,255,255,0.4)" />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {pinned.length > 0 ? (
            <>
              <Label right={`${pinned.length} starred`}>Highlights</Label>
              <Row>
                {pinned.slice(0, HIGHLIGHTS_SHOWN).map((a) => (
                  <PhotoTile
                    key={a.id}
                    a={a}
                    width={170}
                    height={228}
                    gold={!!pbs[a.id]}
                    stamp={pbs[a.id] ? 'Personal best' : weekday(a.started_at)}
                    title={a.name || activityDisplayName(a.activity_type)}
                    value={headline(a)}
                    onPress={() => open(a.id)}
                  />
                ))}
              </Row>
            </>
          ) : building ? (
            <>
              <Label>Highlights</Label>
              <Row>
                <GhostTile icon="starOutline" stamp="Highlight" title="Star an activity" value="First highlight" width={170} height={228} />
                <GhostTile icon="camera" stamp="Highlight" title="Add a photo" value="Second highlight" width={170} height={228} />
              </Row>
            </>
          ) : null}

          {bests.length > 0 ? (
            <>
              <Label right={`${bests.length} total`}>Personal bests</Label>
              <Row>
                {bests.map((b) => (
                  <TouchableOpacity key={b.key} style={s.pb} activeOpacity={0.85} onPress={() => open(b.activityId)} accessibilityRole="button">
                    <Text style={s.pbTitle} numberOfLines={1}>{b.kind === 'distance' ? `Farthest ${activityDisplayName(b.key.slice(4))}` : b.title}</Text>
                    <Text style={s.pbValue} numberOfLines={1}>
                      {b.kind === 'time' ? formatDurationClock(b.value) : b.kind === 'weight' ? formatWeight(b.value) : formatDistance(b.value / 1000)}
                    </Text>
                    <Text style={s.pbDate}>{monthYear(b.date)}</Text>
                  </TouchableOpacity>
                ))}
              </Row>
            </>
          ) : building ? (
            <>
              <Label>Personal bests</Label>
              <Row>
                {[['Fastest 5 km', '--:--'], ['Bench press', '-- kg'], ['Farthest run', '-- km']].map(([t, v]) => (
                  <View key={t} style={[s.pb, s.pbGhost]}>
                    <Text style={[s.pbTitle, s.pbTitleGhost]} numberOfLines={1}>{t}</Text>
                    <Text style={[s.pbValue, s.pbValueGhost]} numberOfLines={1}>{v}</Text>
                    <Text style={s.pbDate}>Set automatically</Text>
                  </View>
                ))}
              </Row>
            </>
          ) : null}

          {upcoming.length > 0 || completed.length > 0 || isOwn ? (
            <>
              <Label right={upcoming.length + past.length > 0 ? `All ${upcoming.length + past.length}` : undefined} onPress={openEvents}>Events</Label>
              {upcoming[0] ? (
                <TouchableOpacity style={s.ticket} activeOpacity={0.85} onPress={openEvents} accessibilityRole="button">
                  <View style={s.ticketMain}>
                    <Text style={s.kick}>Next event</Text>
                    <Text style={s.ticketName} numberOfLines={2}>{formatRaceName(upcoming[0].name)}</Text>
                    <Text style={s.ticketDate} numberOfLines={1}>{shortDate(upcoming[0].race_date!)}{upcoming[0].location ? ` · ${upcoming[0].location}` : ''}</Text>
                  </View>
                  <View style={s.tear} />
                  <View style={s.stub}>
                    {daysUntil(upcoming[0].race_date!, now) === 0 ? <Text style={s.stubToday}>Today</Text> : (
                      <>
                        <Text style={s.stubDays}>{daysUntil(upcoming[0].race_date!, now)}</Text>
                        <Text style={s.stubLabel}>{daysUntil(upcoming[0].race_date!, now) === 1 ? 'Day' : 'Days'}</Text>
                      </>
                    )}
                  </View>
                </TouchableOpacity>
              ) : null}
              {completed.length > 0 || isOwn ? (
                <Row>
                  {completed.map(({ race, legs }) => {
                    const cover = legs.find((a) => a.photo_url);
                    const pb = legs.some((a) => bestIds.has(a.id));
                    const seconds = legs.reduce((t, a) => t + (a.duration_seconds || 0), 0);
                    const effort = Math.round(legs.reduce((t, a) => t + (a.effort_score || 0), 0));
                    const tag = race.race_type && ['Triathlon', 'HYROX', 'CrossFit'].includes(race.race_type) ? race.race_type : 'Event';
                    return (
                      <TouchableOpacity key={race.id} style={[s.event, pb && { borderColor: PB_COLOR }]} activeOpacity={0.88} onPress={() => (!legs[0] ? openEvents() : setOpenEvent({ raceId: race.id, legs }))} accessibilityRole="button" accessibilityLabel={formatRaceName(race.name)}>
                        <View style={s.eventPhoto}>
                          {cover?.photo_url ? <CoverImage uri={cover.photo_url} focalX={cover.photo_focal_x} focalY={cover.photo_focal_y} style={s.fill} /> : (
                            <View style={[s.fill, s.tileArt]}><SkyBackdrop startedAt={legs[0]?.started_at ?? race.race_date} /><RivalIcon name="flag" size={56} color="rgba(255,255,255,0.16)" /></View>
                          )}
                        </View>
                        <View style={s.eventPanel}>
                          <View style={s.eventTop}>
                            <View style={s.eventTags}>
                              <View style={s.tag}><RivalIcon name="flag" size={10} color="#2a2116" /><Text style={s.tagText}>{tag}</Text></View>
                              {pb ? <View style={[s.tag, { backgroundColor: PB_COLOR }]}><RivalIcon name="trophy" size={10} color="#2a2116" /><Text style={s.tagText}>PB</Text></View> : null}
                            </View>
                            <Text style={s.eventWhen}>{monthYear(race.race_date!)}</Text>
                          </View>
                          <View style={{ gap: 4 }}>
                            {legs.slice(0, 3).map((a) => (
                              <View key={a.id} style={s.leg}>
                                <RivalIcon name={activityIconName(a.activity_type)} size={13} color={RivalColors.accentText} />
                                <Text style={s.legDist} numberOfLines={1}>{formatActivityDistance(a.distance_meters, a.activity_type) || activityDisplayName(a.activity_type)}</Text>
                                <Text style={s.legTime}>{a.duration_seconds ? formatDurationClock(a.duration_seconds) : ''}</Text>
                              </View>
                            ))}
                          </View>
                          <View style={s.eventFoot}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={s.eventName} numberOfLines={1}>{formatRaceName(race.name)}</Text>
                              <Text style={s.eventResult} numberOfLines={1}>{race.actual_finish_time || (seconds ? formatDurationClock(seconds) : 'Completed')}</Text>
                            </View>
                            {legs.length > 0 ? (
                              <View style={{ alignItems: 'center' }}>
                                <Text style={s.effortLabel}>Effort</Text>
                                <Text style={s.effortNum}>{effort}</Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {isOwn ? (
                    <TouchableOpacity style={s.addEvent} activeOpacity={0.8} onPress={addEvent} accessibilityRole="button" accessibilityLabel="Add event">
                      <RivalIcon name="add" size={24} color={RivalColors.accentText} />
                      <Text style={s.addEventText}>Add event</Text>
                    </TouchableOpacity>
                  ) : null}
                </Row>
              ) : null}
            </>
          ) : null}

          {activities.length > 0 ? (
            <>
              <Label>History</Label>
              <View style={s.calWrap}><Calendar activities={newest} bestIds={bestIds} width={calendarWidth} onOpen={open} /></View>
            </>
          ) : building ? (
            <>
              <Label>History</Label>
              <ThisWeek />
            </>
          ) : null}

          {earned.length > 0 || (next && (next.current > 0 || building || (!isOwn && brandNew && !!welcome))) ? (
            <>
              <Label right={earned.length > 0 ? `${earned.length} earned` : undefined}>Milestones</Label>
              <Row>
                {next ? <NextTile next={next} /> : null}
                {earned.map((m) => (
                  <PhotoTile
                    key={m.key}
                    a={m.activity}
                    width={150}
                    height={200}
                    gold
                    big
                    stamp={monthYear(m.activity.started_at)}
                    title={milestoneWords(m.kind)}
                    value={m.target.toLocaleString()}
                    onPress={() => open(m.activity.id)}
                  />
                ))}
                {earned.length === 0 && activities.length < BUILD_CARD_UNTIL ? [25, 50].map((n) => (
                  <GhostTile key={n} icon="medal" stamp="Ahead" title="activities" value={String(n)} width={150} height={200} gold big />
                )) : null}
              </Row>
            </>
          ) : null}

          <ProfileTeams userId={userId} isOwn={isOwn} name={name} label={(text) => <Label>{text}</Label>} />

          {footer}
        </View>
      </ScrollView>

      <RivalBackButton onPress={onBack} color="#fff" style={[s.back, { top: insets.top + 12 }]} />
      {isOwn ? (
        <TouchableOpacity onPress={() => router.push('/profile')} style={[s.settings, { top: insets.top + 12 }]} accessibilityRole="button" accessibilityLabel="Settings">
          <RivalIcon name="settings" size={18} color="#fff" />
        </TouchableOpacity>
      ) : userId ? (
        // Someone else's profile: Report and Block, top right (Mockup 27 v8).
        <MemberMenu userId={userId} name={name} top={insets.top + 12} />
      ) : null}

      {pickingStat !== null ? (
        <View style={[s.fill, s.dim]}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setPickingStat(null)} accessibilityLabel="Close" />
        <GreySheet title="Profile stats" sub="Shown on the profile, next to Effort." onClose={() => setPickingStat(null)} footer={null}>
          <View style={s.statTiles}>
            {PROFILE_STAT_KEYS.map((key) => {
              const info = statInfo[key];
              const on = key === chosenStats[pickingStat];
              const taken = key === chosenStats[pickingStat === 0 ? 1 : 0];
              return (
                <TouchableOpacity
                  key={key}
                  style={[s.statTile, on ? s.statTileOn : s.statTileOff, taken && { opacity: 0.38 }]}
                  disabled={taken}
                  activeOpacity={0.85}
                  onPress={() => chooseStat(key)}
                  accessibilityRole="button"
                  accessibilityLabel={info.label}
                  accessibilityState={{ selected: on, disabled: taken }}
                >
                  <View style={[s.statTileIcon, { pointerEvents: 'none' }]}>
                    <RivalIcon name={info.icon} size={44} color={on ? 'rgba(255,255,255,0.26)' : 'rgba(255,181,158,0.12)'} />
                  </View>
                  <Text style={[s.statTileValue, on && s.statTileInk]}>
                    {info.value}{info.unit ? <Text style={[s.statTileUnit, on && s.statTileUnitOn]}>{info.longUnit ?? info.unit}</Text> : null}
                  </Text>
                  <Text style={[s.statTileLabel, on && s.statTileLabelOn]}>{key === 'lifetime' ? 'Lifetime' : info.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </GreySheet>
        </View>
      ) : null}

      {statsOpen ? (
        <View style={[s.fill, s.dim]}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setStatsOpen(false)} accessibilityLabel="Close" />
        <GreySheet kicker={name} title="All stats" onClose={() => setStatsOpen(false)} footer={null}>
          <GreyRows>
            <GreyRow icon="stats" label="This week" value={`${weekEffort.toLocaleString()} Effort`} />
            <GreyRow icon="trophy" label="Lifetime" value={`${Math.round(lifetime).toLocaleString()} Effort`} />
            <GreyRow icon="calendar" label="Activities" value={activities.length.toLocaleString()} />
            <GreyRow icon="timer" label="Time earned" value={`${hours.toLocaleString()}h`} />
            <GreyRow icon="distance" label="Distance" value={`${distanceNumber(km)} ${distanceUnit()}`} />
            <GreyRow icon="elevation" label="Elevation" value={`${elevationNumber(elevation)} ${elevationUnit()}`} />
            <GreyRow icon="fire" label="Streak" value={streakWeeks === 1 ? '1 week' : `${streakWeeks} weeks`} />
            {pastYears.map((p) => <GreyRow key={p.year} icon="medal" label={String(p.year)} value={`${p.final_rank_name} · ${Math.round(p.final_xp).toLocaleString()}`} />)}
          </GreyRows>
        </GreySheet>
        </View>
      ) : null}

      {eventsOpen ? (
        <View style={[s.fill, s.dim]}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setEventsOpen(false)} accessibilityLabel="Close" />
        <GreySheet kicker={name} title="Events" onClose={() => setEventsOpen(false)} footer={null}>
          <GreyRows>
            {upcoming.map((r) => <GreyRow key={r.id} icon="flag" label={formatRaceName(r.name)} value={shortDate(r.race_date!)} />)}
            {past.map((r) => <GreyRow key={r.id} icon="checkCircle" label={formatRaceName(r.name)} value={r.actual_finish_time || shortDate(r.race_date!)} />)}
          </GreyRows>
        </GreySheet>
        </View>
      ) : null}

      <EventSheet
        raceId={openEvent?.raceId ?? null}
        legs={openEvent?.legs ?? []}
        pbLegIds={new Set((openEvent?.legs ?? []).filter((a) => bestIds.has(a.id)).map((a) => a.id))}
        onClose={() => setOpenEvent(null)}
        onOpenLeg={(id) => { setOpenEvent(null); open(id); }}
      />

      {diaryIndex !== null ? (
        <ActivityDiaryViewer
          activities={diaryList}
          startIndex={diaryIndex}
          viewOnly={!isOwn}
          mediaById={media}
          onClose={() => { setDiaryIndex(null); if (Object.keys(patches).length) { setPatches({}); onChanged(); } }}
          onUpdate={(id, patch) => setPatches((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }))}
        />
      ) : null}
    </View>
  );
}

function MemberMenu({ userId, name, top }: { userId: string; name: string; top: number }) {
  const [open, setOpen] = useState(false);
  const blocked = useBlockedIds().has(userId);
  const first = firstName(name);
  return (
    <View style={[s.settings, { top, backgroundColor: 'transparent' }]}>
      <TouchableOpacity onPress={() => setOpen((v) => !v)} style={s.menuBtn} accessibilityRole="button" accessibilityLabel="More">
        <RivalIcon name="moreHoriz" size={20} color="#fff" />
      </TouchableOpacity>
      {open ? (
        <>
          <TouchableOpacity style={s.menuBackdrop} activeOpacity={1} onPress={() => setOpen(false)} />
          <View style={[s.menu, Platform.OS === 'web' ? ({ animationName: 'rivalMenuIn', animationDuration: '160ms', animationTimingFunction: 'ease-out' } as any) : null]}>
            <View style={[s.menuCaret, { pointerEvents: 'none' }]} />
            <TouchableOpacity style={s.menuItem} onPress={() => { setOpen(false); openReport({ kind: 'member', userId, name }); }}>
              <RivalIcon name="flag" size={16} color={RivalColors.accentGold} />
              <Text style={[s.menuText, { color: RivalColors.accentGold }]}>Report</Text>
            </TouchableOpacity>
            {blocked ? (
              <TouchableOpacity
                style={s.menuItem}
                onPress={async () => { setOpen(false); const msg = await unblockMember(userId); if (msg) notify(msg); }}
              >
                <RivalIcon name="block" size={16} color={RivalColors.onSurface} />
                <Text style={s.menuText}>Unblock {first}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.menuItem} onPress={() => { setOpen(false); openBlock({ userId, name }); }}>
                <RivalIcon name="block" size={16} color={RivalColors.danger} />
                <Text style={[s.menuText, { color: RivalColors.danger }]}>Block {first}</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  page: { paddingBottom: 56 },
  pad: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dim: { backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 9 },
  center: { textAlign: 'center' },
  mainCard: {
    backgroundColor: '#282828', borderRadius: 22, borderWidth: 1, paddingTop: 15, paddingHorizontal: 14, paddingBottom: 12,
    borderTopColor: 'rgba(255,209,190,0.26)', borderLeftColor: 'rgba(255,209,190,0.09)', borderRightColor: 'rgba(255,209,190,0.09)', borderBottomColor: 'rgba(255,209,190,0.03)',
    ...(Platform.OS === 'web' ? { backgroundImage: 'radial-gradient(ellipse 70% 220px at 50% 0%, rgba(217,119,87,0.17), rgba(217,119,87,0.035) 60%, rgba(217,119,87,0) 85%)', backgroundRepeat: 'no-repeat', backgroundOrigin: 'border-box' } as any : {}),
  },
  mainTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, lineHeight: 29, color: '#fff', textAlign: 'center', marginTop: 3 },
  mainSub: { fontSize: 12.5, color: '#A0A0A0', textAlign: 'center', marginTop: 2, marginBottom: 10 },
  mainBar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 12, overflow: 'hidden' },
  mainTiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  mainTile: { width: '48.8%' },
  mainTileGrey: { backgroundColor: '#32312f' },
  hide: { alignSelf: 'center', marginTop: 10, paddingVertical: 2, paddingHorizontal: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#32312f', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  linkLogo: { width: 38, height: 38 },
  linkName: { fontSize: 13.5, fontWeight: '700', color: '#fff' },
  linkLine: { fontSize: 11.5, color: '#A0A0A0' },
  ghostTile: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.3)' },
  ghostGold: { borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,215,0,0.3)' },
  ghostValue: { color: 'rgba(255,255,255,0.55)' },
  pbGhost: { borderColor: 'rgba(255,215,0,0.26)' },
  pbTitleGhost: { color: 'rgba(255,215,0,0.75)' },
  pbValueGhost: { color: 'rgba(255,255,255,0.3)' },
  week: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginHorizontal: -16, paddingRight: 16, overflow: 'hidden' },
  restDay: { width: 30, height: 213, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  restNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 14, color: 'rgba(255,255,255,0.3)' },
  restName: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: 'rgba(255,255,255,0.25)', ...(Platform.OS === 'web' ? { writingMode: 'vertical-rl', transform: 'rotate(180deg)' } as any : {}) },
  today: { width: 160, height: 213, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: RivalColors.surfaceHigh, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.6)' },
  todayLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: RivalColors.accentText },
  todayNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 64, lineHeight: 70, color: 'rgba(255,255,255,0.9)' },
  todayPlus: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: 8, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient } as any,
  back: { position: 'absolute', left: 16, zIndex: 5, backgroundColor: 'rgba(14,13,12,0.55)' },
  settings: { position: 'absolute', right: 16, zIndex: 5, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,13,12,0.55)' },
  // The activity page's three-dot menu (ActivityDiaryViewer), for Report and Block.
  menuBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,13,12,0.55)' },
  menuBackdrop: { position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute', top: -2000, left: -2000, right: -2000, bottom: -2000 },
  menu: {
    position: 'absolute', top: 44, right: 0, minWidth: 190,
    borderRadius: 14, paddingVertical: 6, backgroundColor: RivalColors.surfaceHigh,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    ...(Platform.OS === 'web' ? { boxShadow: '0px 10px 24px rgba(0,0,0,0.45)', transformOrigin: 'top right' } as any : {}),
  },
  menuCaret: {
    position: 'absolute', top: -6, right: 12, width: 12, height: 12,
    backgroundColor: RivalColors.surfaceHigh, borderTopWidth: 1, borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    transform: [{ rotate: '45deg' }],
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  menuText: { fontSize: 14, fontWeight: '600', color: RivalColors.onSurface },

  coverShade: {
    position: 'absolute', left: 0, right: 0, bottom: 0, top: '35%',
    ...(Platform.OS === 'web' ? { backgroundImage: `linear-gradient(180deg, rgba(27,26,25,0), #1b1a19)` } as any : {}),
  },
  coverFoot: { position: 'absolute', left: 18, right: 18, bottom: 10 },
  rank: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 0 },
  rankText: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RANK_TILE_INK },
  name: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 46, lineHeight: 50, color: '#fff', marginTop: 8, ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' } as any : {}) },
  quote: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 15, lineHeight: 21, color: '#fff', marginTop: 4 },
  member: { fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 7 },

  stats: { backgroundColor: '#232120', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 16 },
  nums: { flexDirection: 'row' },
  num: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 12 },
  numRule: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.08)' },
  numValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, lineHeight: 26, color: '#fff' },
  numUnit: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  numLabelRow: { flexDirection: 'row', alignItems: 'center', height: 12 },
  numLabel: { fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 0.4, ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' } as any : {}), textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  statTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  statTile: { flexGrow: 1, flexBasis: '30%', height: 92, borderRadius: 16, paddingHorizontal: 9, paddingBottom: 10, justifyContent: 'flex-end', overflow: 'hidden' },
  statTileOff: { borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)', backgroundColor: RivalGhost.fill },
  statTileOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  statTileIcon: { position: 'absolute', top: 2, right: 2 },
  statTileValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, lineHeight: 26, color: '#fff', ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' } as any : {}) },
  statTileUnit: { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  statTileUnitOn: { color: 'rgba(92,25,2,0.7)' },
  statTileInk: { color: '#5c1902' },
  statTileLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginTop: 3 },
  statTileLabelOn: { color: 'rgba(92,25,2,0.75)' },
  impact: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  impactItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  impactValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 14, color: '#fff' },
  impactLabel: { fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  more: { alignSelf: 'center', marginTop: -3, paddingVertical: 2, paddingHorizontal: 8 },
  moreText: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },

  lab: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: -2, marginHorizontal: 4 },
  labText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: '#A0A0A0' },
  labRight: { fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3, color: RivalColors.accentText },
  rowScroll: { marginRight: -16 },
  row: { gap: 8, paddingRight: 16 },
  kick: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: RivalColors.accentText },

  tile: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#232120', position: 'relative' },
  tileArt: { alignItems: 'center', justifyContent: 'center' },
  tileShade: Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, rgba(10,9,8,0) 40%, rgba(10,9,8,0.85))' } as any : { backgroundColor: 'rgba(0,0,0,0.25)' },
  stampWrap: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' },
  stamp: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 13, color: '#fff', paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(14,13,12,0.55)', overflow: 'hidden' },
  tileFoot: { position: 'absolute', left: 12, right: 12, bottom: 10 },
  tileTitle: { fontSize: 13, fontWeight: '700', color: '#fff' },
  tileValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, lineHeight: 25, color: '#fff' },
  goldEdge: { borderRadius: 18, borderWidth: 2.5, borderColor: PB_COLOR },

  pb: { width: 142, backgroundColor: '#232120', borderWidth: 1, borderColor: 'rgba(255,215,0,0.7)', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 12 },
  pbTitle: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: PB_COLOR },
  pbValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, lineHeight: 30, color: '#fff' },
  pbDate: { fontSize: 11.5, color: '#A0A0A0' },

  ticket: { flexDirection: 'row', alignItems: 'stretch', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,209,190,0.10)', backgroundColor: '#232120' },
  ticketMain: { flex: 1, minWidth: 0, paddingVertical: 13, paddingLeft: 16, paddingRight: 12 },
  ticketName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, lineHeight: 24, color: '#fff', marginTop: 4 },
  ticketDate: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  tear: { width: 0, marginVertical: 10, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,209,190,0.15)' },
  stub: { width: 84, alignItems: 'center', justifyContent: 'center' },
  stubDays: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 34, lineHeight: 36, color: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #ffffff, #D97757 170%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } as any : {}),
  },
  stubLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: RivalColors.accentText, marginTop: 3 },
  stubToday: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, color: RivalColors.accentText },

  event: { width: 326, height: 213, flexDirection: 'row', borderRadius: 20, overflow: 'hidden', backgroundColor: '#232120', borderWidth: 2, borderColor: RivalColors.event },
  eventPhoto: { width: '45%', position: 'relative', overflow: 'hidden', backgroundColor: '#211c19' },
  eventPanel: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 11, gap: 8 },
  eventTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 },
  eventTags: { alignItems: 'flex-start', gap: 4 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: 999, backgroundColor: RivalColors.event },
  tagText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: '#2a2116' },
  eventWhen: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '500', fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legDist: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  legTime: { fontSize: 12, fontWeight: '700', color: '#fff' },
  eventFoot: { marginTop: 'auto', flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  eventName: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  eventResult: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '800', fontSize: 20, lineHeight: 24, color: '#fff' },
  effortLabel: { fontSize: 7, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  effortNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 16, lineHeight: 18, color: '#fff' },

  calWrap: { marginHorizontal: -8 },
  calCard: { backgroundColor: '#232120', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 20, paddingTop: 14, paddingHorizontal: 8, paddingBottom: 10 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calNavs: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  calNav: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  calNavOff: { opacity: 0.3 },
  calTitle: { flex: 1, minWidth: 0, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, color: '#fff', textAlign: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  calDow: { textAlign: 'center', fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.4)' },
  calCell: { borderRadius: 9, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.035)', paddingVertical: 4, paddingHorizontal: 5, position: 'relative' },
  calCellOn: { backgroundColor: '#3b2f27' },
  calDay: { fontSize: 10.5, fontWeight: '800', color: 'rgba(255,255,255,0.3)' },
  calDayOn: { color: 'rgba(255,255,255,0.85)' },
  calDayPhoto: { color: '#fff', ...(Platform.OS === 'web' ? { textShadow: '0 1px 4px rgba(0,0,0,0.8)' } as any : {}) },
  calEdge: { borderRadius: 9, borderWidth: 1.5 },

  addEvent: { width: 110, height: 213, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.35)', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addEventText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },

  nextTile: { width: 150, height: 200, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', paddingVertical: 14, paddingHorizontal: 12 },
  nextValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 32, lineHeight: 36, color: '#fff' },
  nextWords: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 10 },
  bar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: RivalColors.accentText },
  nextLeft: { fontSize: 11.5, color: '#A0A0A0', marginTop: 6 },
});
