import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { rankSheen, rankTileFill, RANK_TILE_INK } from '../../constants/rankSheen';
import { onActivityDeleted } from '../../lib/activityEvents';
import { activityPbs, DISTANCE_SPORTS } from '../../lib/activityPbs';
import { formatDurationClock } from '../../lib/format';
import { formatRaceName } from '../../lib/identity';
import { distanceNumber, distanceUnit, elevationNumber, elevationUnit, formatActivityDistance, formatDistance, formatWeight } from '../../lib/units';
import { milestoneWords, monthDays, monthsSince, profileBests, profileMilestones, yearTotals, type NextMilestone, type ProfileActivity } from '../../lib/profilePage';
import { activityDisplayName } from '../../lib/yearReview';
import { ActivityDiaryViewer, type DiaryActivity } from './ActivityDiaryViewer';
import { CoverImage } from './CoverImage';
import { RivalBackButton } from './RivalBackButton';
import { GreyPrimary, GreyRow, GreyRows, GreySheet } from './RivalGreySheet';
import { RivalIcon, activityIconName, type RivalIconName } from './RivalIcon';
import { SkyBackdrop } from './SkyBackdrop';

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
const GOLD = '#d4a72c';

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
              <Text style={s.calTitle}>{title}</Text>
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
                      {pb || event ? <View style={[s.fill, s.calEdge, { borderColor: pb ? GOLD : RivalColors.event, pointerEvents: 'none' }]} /> : null}
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

export function ProfilePage({
  userId, isOwn, name, avatarUrl, mindset, memberSince, level, rankName, activities, races, runs,
  respect, inspired, people, lifetime, km, elevation, weekEffort, streakWeeks, pastYears, year,
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
  onBack: () => void;
  onChanged: () => void;
  pullProps: object;
  pullIndicator: ReactNode;
  footer?: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [statsOpen, setStatsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [patches, setPatches] = useState<Record<string, Partial<DiaryActivity>>>({});
  const [diaryIndex, setDiaryIndex] = useState<number | null>(null);
  const [media, setMedia] = useState<Record<string, { url: string; type: 'photo' | 'video'; focalX?: number | null; focalY?: number | null }[]>>({});

  const newest = useMemo(() => activities.slice().sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()), [activities]);
  const totals = useMemo(() => yearTotals(activities, year), [activities, year]);
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

  const addEvent = () => { setEventsOpen(false); router.push('/races?add=true&then=back' as any); };

  const now = new Date();
  const upcoming = useMemo(() => races.filter((r) => r.race_date && daysUntil(r.race_date, now) >= 0).sort((a, b) => a.race_date!.localeCompare(b.race_date!)), [races]);
  const past = useMemo(() => races.filter((r) => r.race_date && daysUntil(r.race_date, now) < 0).sort((a, b) => b.race_date!.localeCompare(a.race_date!)), [races]);
  const completed = useMemo(() => past
    .map((race) => ({ race, legs: newest.filter((a) => a.race_id === race.id).reverse() })), [past, newest]);

  const coverPhoto = avatarUrl ?? pinned.find((a) => a.photo_url)?.photo_url ?? newest.find((a) => a.photo_url)?.photo_url ?? null;
  const coverHeight = coverPhoto ? Math.round(width * 1.32) : 260 + insets.top;
  const calendarWidth = width - 16;
  const hours = Math.floor(activities.reduce((t, a) => t + (a.duration_seconds || 0), 0) / 3600);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.page} {...pullProps}>
        {pullIndicator}
        <View style={{ height: coverHeight }}>
          {coverPhoto ? <CoverImage uri={coverPhoto} full style={s.fill} focalY={0.3} /> : null}
          <View style={[s.coverShade, { pointerEvents: 'none' }]} />
          <View style={s.coverFoot}>
            <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/ranks')} style={[s.rank, rankTileFill(level)]} accessibilityRole="button" accessibilityLabel={`${rankName} rank`}>
              <RivalIcon name={`rank${rankName}` as RivalIconName} size={14} color={RANK_TILE_INK} />
              <Text style={s.rankText}>{rankName}</Text>
            </TouchableOpacity>
            <Text style={[s.name, name.length > 14 && s.nameLong]}>{name}</Text>
            {mindset ? <Text style={s.quote}>“{mindset}”</Text> : null}
            {memberSince ? <Text style={s.member}>Member since {memberSince}</Text> : null}
          </View>
        </View>

        <View style={s.pad}>
          <View style={s.stats}>
            <View style={s.nums}>
              {[
                { v: totals.hours.toLocaleString(), u: 'h', l: `${year} Time earned` },
                { v: totals.effort.toLocaleString(), u: '', l: `${year} Effort` },
                { v: totals.activities.toLocaleString(), u: '', l: `${year} Activities` },
              ].map((n, i) => (
                <View key={n.l} style={[s.num, i > 0 && s.numRule]}>
                  <Text style={s.numValue} numberOfLines={1}>{n.v}{n.u ? <Text style={s.numUnit}>{n.u}</Text> : null}</Text>
                  <Text style={s.numLabel} numberOfLines={1}>{n.l}</Text>
                </View>
              ))}
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
          ) : null}

          {upcoming.length > 0 || completed.length > 0 || isOwn ? (
            <>
              <Label right={upcoming.length + past.length > 0 ? `All ${upcoming.length + past.length}` : undefined} onPress={() => setEventsOpen(true)}>Events</Label>
              {upcoming[0] ? (
                <TouchableOpacity style={s.ticket} activeOpacity={0.85} onPress={() => setEventsOpen(true)} accessibilityRole="button">
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
                      <TouchableOpacity key={race.id} style={[s.event, pb && { borderColor: GOLD }]} activeOpacity={0.88} onPress={() => (legs[0] ? open(legs[0].id) : setEventsOpen(true))} accessibilityRole="button" accessibilityLabel={formatRaceName(race.name)}>
                        <View style={s.eventPhoto}>
                          {cover?.photo_url ? <CoverImage uri={cover.photo_url} focalX={cover.photo_focal_x} focalY={cover.photo_focal_y} style={s.fill} /> : (
                            <View style={[s.fill, s.tileArt]}><SkyBackdrop startedAt={legs[0]?.started_at ?? race.race_date} /><RivalIcon name="flag" size={56} color="rgba(255,255,255,0.16)" /></View>
                          )}
                        </View>
                        <View style={s.eventPanel}>
                          <View style={s.eventTop}>
                            <View style={s.eventTags}>
                              <View style={s.tag}><RivalIcon name="flag" size={10} color="#2a2116" /><Text style={s.tagText}>{tag}</Text></View>
                              {pb ? <View style={[s.tag, { backgroundColor: GOLD }]}><RivalIcon name="trophy" size={10} color="#2a2116" /><Text style={s.tagText}>PB</Text></View> : null}
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
          ) : null}

          {earned.length > 0 || (next && next.current > 0) ? (
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
              </Row>
            </>
          ) : null}

          {footer}
        </View>
      </ScrollView>

      <RivalBackButton onPress={onBack} color="#fff" style={[s.back, { top: insets.top + 12 }]} />

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
        <GreySheet kicker={name} title="Events" onClose={() => setEventsOpen(false)} footer={isOwn ? <GreyPrimary label="Add event" onPress={addEvent} /> : null}>
          <GreyRows>
            {upcoming.map((r) => <GreyRow key={r.id} icon="flag" label={formatRaceName(r.name)} value={shortDate(r.race_date!)} />)}
            {past.map((r) => <GreyRow key={r.id} icon="checkCircle" label={formatRaceName(r.name)} value={r.actual_finish_time || shortDate(r.race_date!)} />)}
          </GreyRows>
        </GreySheet>
        </View>
      ) : null}

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

const s = StyleSheet.create({
  page: { paddingBottom: 56 },
  pad: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dim: { backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 9 },
  back: { position: 'absolute', left: 16, zIndex: 5, backgroundColor: 'rgba(14,13,12,0.55)' },

  coverShade: {
    position: 'absolute', left: 0, right: 0, bottom: 0, top: '35%',
    ...(Platform.OS === 'web' ? { backgroundImage: `linear-gradient(180deg, rgba(27,26,25,0), #1b1a19)` } as any : {}),
  },
  coverFoot: { position: 'absolute', left: 18, right: 18, bottom: 10 },
  rank: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 0 },
  rankText: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RANK_TILE_INK },
  name: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 46, lineHeight: 50, color: '#fff', marginTop: 8 },
  nameLong: { fontSize: 36, lineHeight: 40 },
  quote: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 15, lineHeight: 21, color: '#fff', marginTop: 4 },
  member: { fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 7 },

  stats: { backgroundColor: '#232120', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 16 },
  nums: { flexDirection: 'row' },
  num: { flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 2 },
  numRule: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.08)' },
  numValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, lineHeight: 26, color: '#fff' },
  numUnit: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  numLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
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
  goldEdge: { borderRadius: 18, borderWidth: 2.5, borderColor: GOLD },

  pb: { width: 142, backgroundColor: '#232120', borderWidth: 1, borderColor: 'rgba(212,167,44,0.4)', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 12 },
  pbTitle: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: GOLD },
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
  calTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 23, color: '#fff', textAlign: 'center', marginBottom: 8 },
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
