import { getMyTeamRows } from '../../lib/myTeams';
import { fitPhoto } from '../../lib/imageResize';
import { ROUTE_MAPS_ENABLED } from '../../lib/features';
import { formatActivityDistance } from '../../lib/units';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, Platform, ScrollView, Image, ImageBackground, TouchableOpacity, TextInput } from 'react-native';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import { buildDayRollups, mergeRollups, rollsUpIntoDayCard, type DayRollup, type RollupRow } from '@/lib/dayRollup';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Asset } from 'expo-asset';
import { supabase, getAuthUser } from '../../lib/supabase';
import { confirmAction, notify } from '../../lib/notify';
import { formatDisplayName, formatTeamName, formatRaceName } from '../../lib/identity';
import { formatDuration } from '../../lib/format';
import { computeActivityInsight, ActivityInsight, InsightActivity, InsightTone } from '../../lib/activityInsights';
import { matchCanonicalLift } from '../../lib/lifts';
import { RivalTopNav, RivalIcon, RivalIconName, activityIconName, TrainingPartners, RouteMap } from '../../components/rival';
import { withinTagWindow } from '../../lib/tagWindow';
import { RivalColors, RivalSerifFamily, RivalButtonColors } from '../../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../../constants/breakpoints';
import { BusyText } from '../../components/rival/BusyText';

// Combined multi-team activity feed — separate destination from league.tsx's
// existing per-team feed tab (per the Team architecture split: Feed = watch,
// Chat = talk, Standings = compete, Sessions = train, Team Hub = manage).
// Ports the visual design from the approved mockup
// (claude.ai/code/artifact/1c9da88e-...), now wired to real data: every team
// you're an active member of, combined, reusing the same activities/races/
// feed_reactions/feed_comments model league.tsx's single-team feed already
// uses in production.

const INSIGHT_ICON: Record<InsightTone, RivalIconName> = { record: 'trophy', streak: 'fire', comeback: 'trendUp' };
const INSIGHT_COLOR: Record<InsightTone, string> = {
  record: RivalColors.rankAnchors.unrivaled,
  streak: RivalColors.accentText,
  comeback: RivalColors.tertiary,
};

// Warm, muted per-identity tints (distinct from league.tsx's brighter
// AVATAR_COLORS palette) — matches this screen's warm-dark card aesthetic.
const TINTS = [
  { bg: '#8a6a5a33', color: '#c99a86' },
  { bg: '#5a7a8a33', color: '#8fb0c2' },
  { bg: '#8a5a7a33', color: '#c286b0' },
  { bg: '#7a8a5a33', color: '#a8bd83' },
  { bg: '#5a8a7a33', color: '#7fc2ab' },
];
function tintFor(name: string): { bg: string; color: string } {
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return TINTS[Math.abs(hash) % TINTS.length];
}

// 'dayRoll' is the UI's name for the kind; 'day_roll' is what the reaction and
// comment tables accept. Convert here so neither side has to know the other's
// spelling.
//
// A rollup's id is a synthetic "roll:<user>:<date>" spanning several
// activities rather than pointing at one row, which is why target_id is text
// rather than uuid on both tables — see
// supabase/reactions_target_id_to_text.sql.
function reactionTargetType(kind: FeedPost['kind']): 'activity' | 'race' | 'day_roll' {
  return kind === 'dayRoll' ? 'day_roll' : kind;
}

function feedTargetKey(type: string, id: string) {
  return `${type}:${id}`;
}

const HERO_PHOTO = require('../../../assets/images/backgrounds/optimized/team-feed-hero-dusk-ridge-2.jpg');

// Same react-native-web workaround as team-hub.tsx's HeroPhoto — ImageBackground
// hardcodes backgroundPosition/no gradients on the div that actually paints
// the photo, so web renders raw CSS instead.
function HeroPhoto({ style, children }: { style?: any; children?: React.ReactNode }) {
  if (Platform.OS === 'web') {
    const uri = Asset.fromModule(HERO_PHOTO).uri;
    return (
      <View
        style={[
          style,
          {
            backgroundImage: [
              'linear-gradient(180deg, rgba(20,14,10,0.1) 0%, rgba(19,19,19,0.28) 63%, rgba(19,19,19,0.78) 85%, rgba(19,19,19,1) 98%)',
              'radial-gradient(120% 70% at 50% 0%, rgba(217,119,87,0.22) 0%, rgba(217,119,87,0) 55%)',
              `url(${uri})`,
            ].join(', '),
            backgroundPosition: '0 0, 0 0, center 20%',
            backgroundSize: 'auto, auto, cover',
            backgroundRepeat: 'no-repeat, no-repeat, no-repeat',
          } as any,
        ]}
      >
        {children}
      </View>
    );
  }
  return (
    <ImageBackground source={HERO_PHOTO} style={style} resizeMode="cover">
      {children}
    </ImageBackground>
  );
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function todayLocalStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Team = { id: string; name: string; logoUrl: string | null; memberCount: number };

type FeedPost =
  | {
      kind: 'activity';
      id: string;
      userId: string;
      name: string;
      activityType: string;
      activityName: string | null;
      durationSeconds: number;
      distanceMeters: number;
      xp: number;
      ts: string;
      notes: string | null;
      photoUrl: string | null;
      pbLift: string | null;
      insight: ActivityInsight | null;
      teamIds: string[];
      teamNames: string[];
      // Who else confirmed they were on the session, as the database keeps it
      // (see sync_activity_companions). Null when nobody has been added.
      companions: string | null;
      // A copy someone received by being tagged: a record of who they were
      // with, never a session they can add people to.
      isSharedCopy: boolean;
    }
  | {
      // One card per person per day gathering their auto-synced walks,
      // instead of a feed row each. Nothing is hidden — every walk still earns
      // its Effort and still appears here — it just shares a card with the
      // rest of that day's walks rather than pushing everyone else's training
      // down the feed.
      kind: 'dayRoll';
      rollup: DayRollup;
      id: string;
      userId: string;
      name: string;
      count: number;
      totalSeconds: number;
      xp: number;
      typeLabel: string;
      ts: string;
      teamIds: string[];
      teamNames: string[];
    }
  | {
      kind: 'race';
      id: string;
      userId: string;
      name: string;
      raceName: string;
      raceDate: string;
      ts: string;
      teamIds: string[];
      teamNames: string[];
    };

// One page of activities. The feed used to fetch a single fixed batch capped
// three separate ways — a 14-day window, .limit(60), and a .slice(0, 40) — all
// of them shared across EVERY member of every team you're in. On an active
// team a few prolific members exhausted that budget, so your own recent
// activities could vanish from your feed and nothing older than a fortnight
// was reachable at all. Replaced with cursor pagination: no time window, and
// scrolling loads the next page from where the last one ended.
const PAGE_SIZE = 20;

// A session this short is usually an accident: a watch that lost GPS and was
// restarted, a recording stopped seconds after it began, a stray tap. It is
// only ever an OFFER, shown to the activity's owner alone — short is
// suspicious, not impossible, and plenty of real sessions are brief (a sprint,
// a test, a warm-up someone wants on the record). Overlapping activities are
// resolved automatically in the importer instead, because two activities at
// the same time genuinely cannot both have happened.
const LIKELY_MISTAKE_UNDER_SECONDS = 3 * 60;

// Everything a feed row needs that is NOT the row itself — resolved once per
// refresh and reused by every subsequent page, so paging doesn't re-query the
// roster/lift/insight data on every scroll.
type FeedContext = {
  memberIds: string[];
  teamsForUser: Record<string, string[]>;
  teamNameById: Record<string, string>;
  nameMap: Record<string, string>;
  liftMaxMap: Map<string, number>;
  insightHistoryByUser: Record<string, InsightActivity[]>;
  // False while the lift and history data are still on their way: posts show
  // without PB badges and insights, then are rebuilt once it arrives, rather
  // than the whole feed waiting for it (or showing a wrong badge meanwhile).
  ready: boolean;
};

function findPbLift(ctx: FeedContext, userId: string, exercises: any[] | null): string | null {
  if (!exercises) return null;
  for (const ex of exercises) {
    const canonical = matchCanonicalLift(ex.name) || ex.prLift;
    if (!canonical || !ex.weight) continue;
    if (ex.weight >= (ctx.liftMaxMap.get(`${userId}|${canonical}`) ?? 0)) return canonical;
  }
  return null;
}

// Rollup grouping, merging and the walk/auto-sync rule live in
// src/lib/dayRollup.ts so they can be tested — the merge in particular has a
// failure mode (folding the same page in twice must not double a count) that
// cannot be checked by eye once it is tangled up with React state. This wraps
// the plain rollups in the display fields a feed card needs.
function postsForPage(ctx: FeedContext, rows: any[]): FeedPost[] {
  const own: FeedPost[] = [];
  const toRoll: RollupRow[] = [];
  for (const a of rows) {
    if (!ctx.teamsForUser[a.user_id]?.length) continue;
    if (rollsUpIntoDayCard(a)) toRoll.push(a as RollupRow);
    else { const p = activityRowToPost(ctx, a); if (p) own.push(p); }
  }
  return [...own, ...buildDayRollups(toRoll).map((r) => rollupToPost(ctx, r))];
}

function rollupToPost(ctx: FeedContext, r: DayRollup): FeedPost {
  const posterTeams = ctx.teamsForUser[r.userId] ?? [];
  return {
    kind: 'dayRoll',
    rollup: r,
    id: r.id,
    userId: r.userId,
    name: ctx.nameMap[r.userId] ?? 'Athlete',
    count: r.count,
    totalSeconds: r.totalSeconds,
    xp: r.xp,
    typeLabel: r.typeLabel,
    ts: r.ts,
    teamIds: posterTeams,
    teamNames: posterTeams.map((tid) => ctx.teamNameById[tid] ?? ''),
  };
}

function activityRowToPost(ctx: FeedContext, a: any): FeedPost | null {
  const posterTeams = ctx.teamsForUser[a.user_id];
  if (!a.started_at || !posterTeams?.length) return null;
  const pbLift = ctx.ready ? findPbLift(ctx, a.user_id, a.exercises) : null;
  const insight = ctx.ready ? computeActivityInsight(
    { activity_type: a.activity_type, started_at: a.started_at, duration_seconds: a.duration_seconds, distance_meters: a.distance_meters },
    ctx.insightHistoryByUser[a.user_id] || [],
    !!pbLift,
  ) : null;
  return {
    kind: 'activity', id: a.id, userId: a.user_id,
    name: ctx.nameMap[a.user_id] ?? 'Athlete',
    activityType: a.activity_type,
    activityName: a.name,
    durationSeconds: a.duration_seconds,
    distanceMeters: a.distance_meters,
    xp: Math.round((a.effort_score || 0) * 10) / 10,
    ts: a.started_at,
    notes: a.notes,
    photoUrl: a.photo_url,
    pbLift,
    insight,
    teamIds: posterTeams,
    teamNames: posterTeams.map((tid) => ctx.teamNameById[tid] ?? ''),
    companions: a.companions ?? null,
    isSharedCopy: !!a.shared_from_activity_id,
  };
}

function raceRowToPost(ctx: FeedContext, r: any): FeedPost | null {
  const posterTeams = ctx.teamsForUser[r.user_id];
  const ts = r.created_at || r.race_date;
  if (!ts || !posterTeams?.length) return null;
  return {
    kind: 'race', id: r.id, userId: r.user_id,
    name: ctx.nameMap[r.user_id] ?? 'Athlete',
    raceName: r.name, raceDate: r.race_date, ts,
    teamIds: posterTeams,
    teamNames: posterTeams.map((tid) => ctx.teamNameById[tid] ?? ''),
  };
}

const byNewestFirst = (a: FeedPost, b: FeedPost) => new Date(b.ts).getTime() - new Date(a.ts).getTime();

// Fetches PAGE_SIZE+1 rows: the extra one is how we know whether a further
// page exists without a second count query. `cursor` is the started_at of the
// last row already shown, so paging is stable even if new activities land
// mid-scroll (an offset would shift and duplicate rows; a cursor won't).
async function fetchActivityPage(ctx: FeedContext, cursor: string | null) {
  let q = supabase.from('activities')
    .select('id, user_id, name, activity_type, provider, started_at, duration_seconds, distance_meters, effort_score, exercises, notes, photo_url, companions, shared_from_activity_id')
    .in('user_id', ctx.memberIds)
    .order('started_at', { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (cursor) q = q.lt('started_at', cursor);
  const { data } = await q;
  const rows = data || [];
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  return { page, more, nextCursor: page.length ? page[page.length - 1].started_at : null };
}

// The feed as last shown. Coming back to Teams draws it straight away and
// refreshes behind it, instead of starting from "Loading" on every visit.
type FeedSnapshot = {
  userId: string;
  teams: Team[];
  items: FeedPost[];
  avatarMap: Record<string, string | null>;
  nameMap: Record<string, string>;
  reactionsMap: Record<string, Array<{ user_id: string; emoji: string }>>;
  commentsMap: Record<string, Array<{ id: string; user_id: string; body: string; created_at: string }>>;
  hasMore: boolean;
  ctx: FeedContext | null;
  cursor: string | null;
};
let feedSnap: FeedSnapshot | null = null;

export default function TeamFeedScreen() {
  const { width } = useWindowDimensions();
  const mobile = width < BREAKPOINT_WIDE_LAYOUT;

  const { scrollProps: pullProps, indicator: pullIndicator } = usePullToRefresh(() => loadFeed());
  const [loading, setLoading] = useState(() => !feedSnap);
  const [currentUserId, setCurrentUserId] = useState(() => feedSnap?.userId ?? '');
  const [teams, setTeams] = useState<Team[]>(() => feedSnap?.teams ?? []);
  const [items, setItems] = useState<FeedPost[]>(() => feedSnap?.items ?? []);
  const [avatarMap, setAvatarMap] = useState<Record<string, string | null>>(() => feedSnap?.avatarMap ?? {});
  const [nameMap, setNameMap] = useState<Record<string, string>>(() => feedSnap?.nameMap ?? {});
  // Route maps, only for people who chose to share them with their teams.
  const [routesMap, setRoutesMap] = useState<Record<string, string>>({});
  const [reactionsMap, setReactionsMap] = useState<Record<string, Array<{ user_id: string; emoji: string }>>>(() => feedSnap?.reactionsMap ?? {});
  const [commentsMap, setCommentsMap] = useState<Record<string, Array<{ id: string; user_id: string; body: string; created_at: string }>>>(() => feedSnap?.commentsMap ?? {});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());

  const [hasMore, setHasMore] = useState(() => feedSnap?.hasMore ?? false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Refs, not state: these are read inside loadMore's async body, where a
  // stale closure over state would page from the wrong place.
  const ctxRef = useRef<FeedContext | null>(feedSnap?.ctx ?? null);
  const cursorRef = useRef<string | null>(feedSnap?.cursor ?? null);

  // Keep the snapshot current with whatever is on screen, including a
  // reaction or comment just added, so a revisit shows exactly this.
  useEffect(() => {
    if (loading || !currentUserId) return;
    feedSnap = { userId: currentUserId, teams, items, avatarMap, nameMap, reactionsMap, commentsMap, hasMore, ctx: ctxRef.current, cursor: cursorRef.current };
  }, [loading, currentUserId, teams, items, avatarMap, nameMap, reactionsMap, commentsMap, hasMore]);

  // Reactions/comments are fetched per visible page. `replace` distinguishes a
  // refresh (drop what was there) from appending a page (merge, so the social
  // state of already-rendered posts survives).
  const loadSocialFor = useCallback(async (posts: FeedPost[], replace: boolean) => {
    const ids = posts.map((p) => p.id);
    if (ids.length === 0) {
      if (replace) { setReactionsMap({}); setCommentsMap({}); }
      return;
    }
    const [reactionsRes, commentsRes] = await Promise.all([
      supabase.from('feed_reactions').select('target_type, target_id, user_id, emoji').in('target_id', ids),
      supabase.from('feed_comments').select('id, target_type, target_id, user_id, body, created_at').in('target_id', ids).order('created_at', { ascending: true }),
    ]);
    const newReactions: Record<string, Array<{ user_id: string; emoji: string }>> = {};
    (reactionsRes.data || []).forEach((r: any) => {
      (newReactions[feedTargetKey(r.target_type, r.target_id)] ??= []).push({ user_id: r.user_id, emoji: r.emoji });
    });
    const newComments: Record<string, Array<{ id: string; user_id: string; body: string; created_at: string }>> = {};
    (commentsRes.data || []).forEach((c: any) => {
      (newComments[feedTargetKey(c.target_type, c.target_id)] ??= []).push({ id: c.id, user_id: c.user_id, body: c.body, created_at: c.created_at });
    });
    setReactionsMap((prev) => (replace ? newReactions : { ...prev, ...newReactions }));
    setCommentsMap((prev) => (replace ? newComments : { ...prev, ...newComments }));
    if (ROUTE_MAPS_ENABLED) loadRoutesFor(posts, replace);
  }, []);

  // Routes are shown only for posters with share_routes on — the database lets
  // teammates read nothing else, and the owner's own unshared routes stay off
  // the feed so it never looks like they're visible to the team.
  const loadRoutesFor = useCallback(async (posts: FeedPost[], replace: boolean) => {
    const activityPosts = posts.filter((p) => p.kind === 'activity' && !p.photoUrl);
    const posterIds = [...new Set(activityPosts.map((p) => p.userId))];
    if (!posterIds.length) { if (replace) setRoutesMap({}); return; }
    const { data: sharers, error: sharersErr } = await supabase.from('users').select('id').in('id', posterIds).eq('share_routes', true);
    if (sharersErr) return;
    const sharing = new Set((sharers ?? []).map((u: any) => u.id));
    const ids = activityPosts.filter((p) => sharing.has(p.userId)).map((p) => p.id);
    const next: Record<string, string> = {};
    if (ids.length) {
      const { data: routes } = await supabase.from('activity_routes').select('activity_id, polyline').in('activity_id', ids);
      (routes ?? []).forEach((r: any) => { next[r.activity_id] = r.polyline; });
    }
    setRoutesMap((prev) => (replace ? next : { ...prev, ...next }));
  }, []);

  const loadFeed = useCallback(async () => {
    // Coming back to the tab keeps the feed on screen and refreshes it behind
    // the scenes; only a first visit shows the loading state.
    if (!ctxRef.current) setLoading(true);
    const { data: { user } } = await getAuthUser();
    if (!user) { setLoading(false); return; }
    // Someone else's snapshot must never show, even for a moment.
    if (feedSnap && feedSnap.userId !== user.id) { feedSnap = null; ctxRef.current = null; setItems([]); setTeams([]); setLoading(true); }
    setCurrentUserId(user.id);

    // Every team this account is an active member of.
    const myMemberships = await getMyTeamRows(user.id).catch(() => []);

    const myTeams: Team[] = (myMemberships || [])
      .map((m: any) => m.leagues)
      .filter(Boolean)
      .map((l: any) => ({ id: l.id, name: formatTeamName(l.name), logoUrl: l.logo_url, memberCount: 0 }));

    if (myTeams.length === 0) {
      setTeams(myTeams);
      setItems([]);
      setHasMore(false);
      ctxRef.current = null;
      cursorRef.current = null;
      setLoading(false);
      return;
    }

    const teamIds = myTeams.map((t) => t.id);
    const teamNameById: Record<string, string> = {};
    myTeams.forEach((t) => { teamNameById[t.id] = t.name; });

    // Roster across all those teams — a member's post is attributed to EVERY
    // one of your teams they're also on (not just the first found), so one
    // activity shows up in each of your shared teams' filtered views, same
    // as it would if you viewed that activity from either team directly.
    const { data: memberRows } = await supabase
      .from('league_members')
      .select('league_id, user_id, users(display_name, avatar_url)')
      .in('league_id', teamIds)
      .eq('status', 'active');

    const nameMap: Record<string, string> = {};
    const avatars: Record<string, string | null> = {};
    const teamsForUser: Record<string, string[]> = {};
    const memberIdSet = new Set<string>();
    const memberCountByTeam: Record<string, number> = {};
    (memberRows || []).forEach((m: any) => {
      memberIdSet.add(m.user_id);
      if (!nameMap[m.user_id]) nameMap[m.user_id] = formatDisplayName(m.users);
      if (avatars[m.user_id] === undefined) avatars[m.user_id] = m.users?.avatar_url || null;
      (teamsForUser[m.user_id] ??= []).push(m.league_id);
      memberCountByTeam[m.league_id] = (memberCountByTeam[m.league_id] || 0) + 1;
    });
    setAvatarMap(avatars);
    setNameMap(nameMap);
    setTeams(myTeams.map((t) => ({ ...t, memberCount: memberCountByTeam[t.id] || 0 })));
    const memberIds = Array.from(memberIdSet);

    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);
    const today = todayLocalStr();

    // Context queries — run once per refresh, not per page. Races stay a
    // first-page-only set: they are UPCOMING events (race_date >= today), a
    // small forward-looking list rather than a backlog to page through.
    // The first page of posts only needs the member list, so it loads with the
    // context queries instead of waiting for them. (fetchActivityPage reads
    // nothing but memberIds from the context.)
    // The first page and upcoming races are all the feed needs to show. Lift
    // maxima and a year of history (for PB badges and insights) are larger
    // downloads, so they follow and the posts are rebuilt when they land.
    const extrasP = Promise.all([
      supabase.from('exercise_entries').select('user_id, exercise_name, weight_kg').in('user_id', memberIds),
      supabase.from('activities')
        .select('user_id, activity_type, started_at, duration_seconds, distance_meters, elevation_meters')
        .in('user_id', memberIds)
        .gte('started_at', oneYearAgo.toISOString())
        .order('started_at', { ascending: false })
        .limit(500),
    ]);
    const [racesRes, firstPage] = await Promise.all([
      supabase.from('races')
        .select('id, user_id, name, race_date, created_at')
        .in('user_id', memberIds)
        .gte('race_date', today)
        .order('race_date', { ascending: false })
        .limit(20),
      fetchActivityPage({ memberIds } as FeedContext, null),
    ]);

    const buildPosts = (ctx: FeedContext) => {
      const built: FeedPost[] = [];
      built.push(...postsForPage(ctx, firstPage.page));
      (racesRes.data || []).forEach((r: any) => { const p = raceRowToPost(ctx, r); if (p) built.push(p); });
      built.sort(byNewestFirst);
      return built;
    };

    const partial: FeedContext = { memberIds, teamsForUser, teamNameById, nameMap, liftMaxMap: new Map(), insightHistoryByUser: {}, ready: false };
    // A revisit already has a full feed on screen; keep it until the full
    // rebuild below rather than briefly dropping its badges.
    const revisit = !!ctxRef.current?.ready;
    if (!revisit) {
      ctxRef.current = partial;
      const built = buildPosts(partial);
      setItems(built);
      setLoading(false);
      loadSocialFor(built, true);
    }

    const [liftEntriesRes, insightHistoryRes] = await extrasP;
    const insightHistoryByUser: Record<string, InsightActivity[]> = {};
    (insightHistoryRes.data || []).forEach((a: any) => { (insightHistoryByUser[a.user_id] ??= []).push(a); });

    const liftMaxMap = new Map<string, number>();
    (liftEntriesRes.data || []).forEach((e: any) => {
      const key = `${e.user_id}|${e.exercise_name}`;
      liftMaxMap.set(key, Math.max(liftMaxMap.get(key) ?? 0, e.weight_kg));
    });

    const ctx: FeedContext = { ...partial, liftMaxMap, insightHistoryByUser, ready: true };
    ctxRef.current = ctx;

    const { more, nextCursor } = firstPage;
    cursorRef.current = nextCursor;
    // Paging waits for the full context, so later pages never lack badges.
    setHasMore(more);

    const built = buildPosts(ctx);
    setItems(built);
    setLoading(false);
    if (!revisit) return;
    await loadSocialFor(built, true);
  }, [loadSocialFor]);

  // Appends the next page. Guarded on loadingMore/hasMore so the scroll
  // handler firing repeatedly near the bottom can't stack duplicate fetches.
  const loadMore = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { page, more, nextCursor } = await fetchActivityPage(ctx, cursorRef.current);
    cursorRef.current = nextCursor;
    setHasMore(more);

    const newPosts: FeedPost[] = postsForPage(ctx, page);
    setItems((prev) => {
      // A day's short activities can straddle a page boundary, so a rollup
      // already on screen has to absorb the later page's rows rather than
      // appear twice. Totals add; `ts` keeps the earliest so the card doesn't
      // move once placed.
      const byId = new Map(prev.map((p) => [`${p.kind}-${p.id}`, p]));
      for (const p of newPosts) {
        const key = `${p.kind}-${p.id}`;
        const existing = byId.get(key);
        if (!existing) { byId.set(key, p); continue; }
        if (existing.kind === 'dayRoll' && p.kind === 'dayRoll') {
          byId.set(key, rollupToPost(ctx, mergeRollups(existing.rollup, p.rollup)));
        }
      }
      const merged = [...byId.values()];
      merged.sort(byNewestFirst);
      return merged;
    });
    await loadSocialFor(newPosts, false);
    setLoadingMore(false);
  }, [hasMore, loadingMore, loadSocialFor]);

  useFocusEffect(useCallback(() => { loadFeed(); }, [loadFeed]));

  async function toggleReaction(targetType: 'activity' | 'race' | 'day_roll', targetId: string, teamId: string, emoji: 'respect' | 'inspired') {
    if (!currentUserId) return;
    const key = feedTargetKey(targetType, targetId);
    const existing = (reactionsMap[key] || []).find((r) => r.user_id === currentUserId);
    if (existing?.emoji === emoji) {
      const { error } = await supabase.from('feed_reactions').delete().eq('target_type', targetType).eq('target_id', targetId).eq('user_id', currentUserId);
      // A rejected tap on a reaction isn't worth a dialog, but the UI must not
      // keep asserting a state the server refused.
      if (error) return;
      setReactionsMap((prev) => ({ ...prev, [key]: (prev[key] || []).filter((r) => r.user_id !== currentUserId) }));
    } else {
      const { error } = await supabase.from('feed_reactions').upsert(
        { league_id: teamId, target_type: targetType, target_id: targetId, user_id: currentUserId, emoji },
        { onConflict: 'target_type,target_id,user_id' },
      );
      if (error) return;
      setReactionsMap((prev) => ({
        ...prev,
        [key]: [...(prev[key] || []).filter((r) => r.user_id !== currentUserId), { user_id: currentUserId, emoji }],
      }));
    }
  }

  function toggleComments(key: string) {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function postComment(targetType: 'activity' | 'race' | 'day_roll', targetId: string, teamId: string) {
    if (!currentUserId) return;
    const key = feedTargetKey(targetType, targetId);
    const text = (commentDrafts[key] || '').trim();
    if (!text) return;

    setCommentDrafts((prev) => ({ ...prev, [key]: '' }));
    const { data: inserted, error: cErr } = await supabase.from('feed_comments')
      .insert({ league_id: teamId, target_type: targetType, target_id: targetId, user_id: currentUserId, body: text })
      .select('id, user_id, body, created_at')
      .single();
    if (cErr) {
      // The draft was cleared optimistically — hand the text back rather than
      // losing a comment they just wrote.
      setCommentDrafts((prev) => ({ ...prev, [key]: text }));
      notify("Couldn't post that comment", cErr.message);
      return;
    }
    if (inserted) {
      setCommentsMap((prev) => ({ ...prev, [key]: [...(prev[key] || []), inserted] }));
    }
  }

  const posts = items;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.mBgFixed} />
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <RivalTopNav
          active="teams"
          action={{ icon: 'search', label: 'Find a team', onPress: () => router.push('/discover-leagues') }}
        />
        <ScrollView
          contentContainerStyle={[styles.content, mobile && styles.contentMobile]}
          style={Platform.OS === 'web' ? ({ WebkitOverflowScrolling: 'touch' } as any) : undefined}
          // Infinite scroll. Fires while still ~600px short of the end so the
          // next page is usually already in place by the time you reach it,
          // rather than bottoming out onto a spinner. loadMore self-guards
          // against the repeat calls this necessarily produces.
          scrollEventThrottle={16}
          onScroll={({ nativeEvent }) => {
            const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
            const fromEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
            if (fromEnd < 600) loadMore();
          }}
          {...pullProps}
        >
          {pullIndicator}
          <HeroPhoto style={styles.hero}>
            <View style={styles.heroTextBlock}>
              <View style={styles.heroGlyphRow}>
                <View style={styles.heroRule} />
                <RivalIcon name="elevation" size={22} color={RivalColors.accentText} />
                <View style={styles.heroRule} />
              </View>
              <Text style={styles.heroTitle}>All Teams Feed</Text>
              <Text style={styles.heroTagline}>Every Effort, Together</Text>
              <View style={styles.heroTaglineUnderline} />
            </View>

            {teams.length > 0 && (
              <View style={styles.railWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rail} contentContainerStyle={styles.railContent}>
                {teams.map((t) => {
                  const tint = tintFor(t.name);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => router.push({ pathname: '/team-hub', params: { id: t.id } })}
                      style={styles.teamLogoBtn}
                    >
                      {t.logoUrl ? (
                        <View style={styles.teamLogoFrame}>
                          <Image source={{ uri: t.logoUrl }} style={styles.teamLogoImgFull} resizeMode="cover" />
                        </View>
                      ) : (
                        <View style={[styles.teamLogoFallback, { backgroundColor: tint.bg }]}>
                          <Text style={[styles.teamCardIconText, { color: tint.color }]}>{t.name[0]?.toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={Platform.OS === 'web' ? styles.teamLogoUnderlineWeb : styles.teamLogoUnderline} />
                    </TouchableOpacity>
                  );
                })}

              </ScrollView>
              {/* Discovery is NOT in this rail. Anything shaped like a team
                  logo in a row of team logos either hides among them or
                  shoves them aside — it lives in the top bar's action slot
                  instead, on this screen only. */}
              </View>
            )}
          </HeroPhoto>

          <View style={styles.belowHero}>
          {loading ? (
            <Text style={styles.stateText}>Loading…</Text>
          ) : teams.length === 0 ? (
            <View style={styles.emptyState}>
              <RivalIcon name="groups" size={28} color={RivalColors.accentText} />
              <Text style={styles.emptyTitle}>No team yet</Text>
              <Text style={styles.emptyBody}>Join or create a team to see team activity here.</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/discover-leagues')}>
                <Text style={styles.emptyBtnText}>Find a team</Text>
              </TouchableOpacity>
            </View>
          ) : posts.length === 0 ? (
            <Text style={styles.stateText}>No activity yet. Team activity appears here.</Text>
          ) : (
            <View style={{ gap: 20 }}>
              {posts.map((post) => (
                <PostCard
                  key={`${post.kind}-${post.id}`}
                  post={post}
                  currentUserId={currentUserId}
                  avatarUrl={avatarMap[post.userId] ?? null}
                  routePolyline={routesMap[post.id] ?? null}
                  reactions={reactionsMap[feedTargetKey(reactionTargetType(post.kind), post.id)] || []}
                  comments={commentsMap[feedTargetKey(reactionTargetType(post.kind), post.id)] || []}
                  nameMap={nameMap}
                  onReact={(emoji) => toggleReaction(reactionTargetType(post.kind), post.id, post.teamIds[0], emoji)}
                  isCommentsOpen={expandedComments.has(feedTargetKey(reactionTargetType(post.kind), post.id))}
                  onToggleComments={() => toggleComments(feedTargetKey(reactionTargetType(post.kind), post.id))}
                  commentDraft={commentDrafts[feedTargetKey(reactionTargetType(post.kind), post.id)] || ''}
                  onChangeCommentDraft={(v) => setCommentDrafts((prev) => ({ ...prev, [feedTargetKey(reactionTargetType(post.kind), post.id)]: v }))}
                  onPostComment={() => postComment(reactionTargetType(post.kind), post.id, post.teamIds[0])}
                  onDeleted={() => setItems((prev) => prev.filter((it) => it.id !== post.id))}
                  onPhotoAdded={(id, url) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, photoUrl: url } : it)))}
                />
              ))}
              {loadingMore && <Text style={styles.stateText}>Loading more…</Text>}
              {!hasMore && !loadingMore && <Text style={styles.stateText}>You're all caught up.</Text>}
            </View>
          )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function PostCard({
  post, currentUserId, avatarUrl, routePolyline, reactions, comments, nameMap, onReact,
  isCommentsOpen, onToggleComments, commentDraft, onChangeCommentDraft, onPostComment, onDeleted, onPhotoAdded,
}: {
  post: FeedPost;
  currentUserId: string;
  avatarUrl: string | null;
  routePolyline: string | null;
  reactions: Array<{ user_id: string; emoji: string }>;
  comments: Array<{ id: string; user_id: string; body: string; created_at: string }>;
  nameMap: Record<string, string>;
  onReact: (emoji: 'respect' | 'inspired') => void;
  isCommentsOpen: boolean;
  onToggleComments: () => void;
  commentDraft: string;
  onChangeCommentDraft: (v: string) => void;
  onPostComment: () => void;
  onDeleted: () => void;
  onPhotoAdded: (activityId: string, url: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Own-post-only, straight to the activity's single cover photo (photo_url) —
  // the feed just needs a fast way to add the one photo that shows here, not
  // the full multi-photo gallery my-activities.tsx's diary view manages.
  function addPhotoFromFeed() {
    if (Platform.OS !== 'web' || post.kind !== 'activity' || post.userId !== currentUserId || uploadingPhoto) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingPhoto(true);
      const up = await fitPhoto({ blob: file, mimeType: file.type, ext: file.name.split('.').pop() || 'jpg' });
      const path = `${currentUserId}/${post.id}-${Date.now()}.${up.ext}`;
      const { error: storageErr } = await supabase.storage
        .from('activity-photos')
        .upload(path, up.blob, { contentType: up.mimeType, upsert: true });
      if (storageErr) {
        setUploadingPhoto(false);
        if (Platform.OS === 'web') window.alert(`Photo upload failed: ${storageErr.message}`);
        return;
      }
      const { data: urlData } = supabase.storage.from('activity-photos').getPublicUrl(path);
      const { error: dbErr } = await supabase.from('activities').update({ photo_url: urlData.publicUrl }).eq('id', post.id);
      setUploadingPhoto(false);
      if (dbErr) {
        if (Platform.OS === 'web') window.alert(`Couldn't save photo: ${dbErr.message}`);
        return;
      }
      onPhotoAdded(post.id, urlData.publicUrl);
    };
    input.click();
  }

  async function deleteThisActivity() {
    if (post.kind !== 'activity') return;
    if (!(await confirmAction({ title: 'Delete this activity?', message: "This can't be undone.", confirmLabel: 'Delete', destructive: true }))) return;
    setMenuOpen(false);
    setDeleting(true);
    const { error, count } = await supabase.from('activities').delete({ count: 'exact' }).eq('id', post.id);
    if (error || !count) {
      setDeleting(false);
      if (Platform.OS === 'web') window.alert(error ? `Delete failed: ${error.message}` : 'The activity could not be deleted. Try again.');
      return;
    }
    // Stays in the deleting state until the post is removed, so it never
    // flickers back to normal first.
    onDeleted();
  }

  const tint = tintFor(post.name);
  const primaryTeamName = post.teamNames[0];
  const extraTeamCount = post.teamNames.length - 1;
  const isPb = post.kind === 'activity' && (!!post.pbLift || post.insight?.tone === 'record');
  const isEvent = post.kind === 'race';
  const accent: 'default' | 'pb' | 'event' = isPb ? 'pb' : isEvent ? 'event' : 'default';
  const accentColor = accent === 'pb' ? RivalColors.rankAnchors.unrivaled : accent === 'event' ? '#ff5c5c' : RivalColors.accentFill;
  const myReaction = reactions.find((r) => r.user_id === currentUserId)?.emoji;
  const respectCount = reactions.filter((r) => r.emoji === 'respect').length;
  const inspiredCount = reactions.filter((r) => r.emoji === 'inspired').length;
  const displayedName = post.name;
  const initials = post.name.slice(0, 2).toUpperCase();

  let badge: { icon: RivalIconName; label: string; color: string } | null = null;
  if (post.kind === 'activity') {
    if (post.pbLift) badge = { icon: 'trophy', label: `New PB — ${post.pbLift}`, color: RivalColors.rankAnchors.unrivaled };
    else if (post.insight) badge = { icon: INSIGHT_ICON[post.insight.tone], label: post.insight.text, color: INSIGHT_COLOR[post.insight.tone] };
  }

  const statsLine = post.kind === 'activity'
    ? [formatActivityDistance(post.distanceMeters, post.activityType, 100), formatDuration(post.durationSeconds)].filter(Boolean).join(' · ')
    : post.kind === 'dayRoll'
      ? formatDuration(post.totalSeconds)
      : '';

  return (
    <View style={styles.post}>
      {deleting && (
        <View style={styles.postDeleting} accessibilityLiveRegion="polite">
          <ActivityIndicator color={RivalColors.accentText} />
          <Text style={styles.postDeletingText}>Deleting activity…</Text>
        </View>
      )}
      {Platform.OS === 'web' ? (
        <>
          <View style={[styles.postAccentBar, styles.postAccentBarLeft, { backgroundImage: `linear-gradient(180deg, transparent 0%, ${accentColor} 25%, ${accentColor} 75%, transparent 100%)` } as any]} />
          <View style={[styles.postAccentBar, styles.postAccentBarRight, { backgroundImage: `linear-gradient(180deg, transparent 0%, ${accentColor} 25%, ${accentColor} 75%, transparent 100%)` } as any]} />
        </>
      ) : (
        <>
          <View style={[styles.postAccentBarNative, styles.postAccentBarLeft, { backgroundColor: accentColor }]} />
          <View style={[styles.postAccentBarNative, styles.postAccentBarRight, { backgroundColor: accentColor }]} />
        </>
      )}

      <View style={styles.postHeader}>
        <TouchableOpacity onPress={() => router.push(`/stats?userId=${post.userId}` as any)} style={[styles.postAvatar, { backgroundColor: tint.bg, borderColor: tint.color }]}>
          {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.postAvatarImg} /> : <Text style={[styles.postAvatarText, { color: tint.color }]}>{initials}</Text>}
        </TouchableOpacity>
        {/* The name opens their profile too, not just the small avatar — but
            only the name. This used to be one flex:1 touchable holding the name
            AND the meta line, which made the whole header strip, edge to edge,
            a profile link. The meta line describes the activity, not the
            person, so it is not a link at all. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <TouchableOpacity style={styles.postNameHit} activeOpacity={0.7} onPress={() => router.push(`/stats?userId=${post.userId}` as any)}>
            <Text style={styles.postName}>{displayedName}</Text>
          </TouchableOpacity>
          <Text style={styles.postMeta}>
            {post.kind === 'race'
              ? 'Signed up for an event'
              : post.kind === 'dayRoll'
                ? `${post.count} ${post.typeLabel}`
                : (post.activityName || post.activityType)} · {timeAgo(post.ts)}
            {post.userId !== currentUserId ? (
              <> · <Text style={styles.postTeamTag}>{primaryTeamName}{extraTeamCount > 0 ? ` +${extraTeamCount}` : ''}</Text></>
            ) : null}
          </Text>
        </View>
        {post.kind === 'activity' && post.userId === currentUserId && (
          <View style={styles.postMoreWrap}>
            <TouchableOpacity style={styles.postMoreBtn} onPress={() => setMenuOpen((v) => !v)} disabled={deleting}>
              <RivalIcon name="more" size={20} color={RivalColors.textSecondary} />
            </TouchableOpacity>
            {menuOpen && (
              <>
                {/* Full-screen tap-catcher to close the menu on outside press —
                    sits below the menu itself in z-order. */}
                <TouchableOpacity style={styles.postMoreBackdrop} onPress={() => setMenuOpen(false)} />
                <View style={styles.postMoreMenu}>
                  <TouchableOpacity
                    style={styles.postMoreMenuItem}
                    onPress={() => { setMenuOpen(false); router.push(`/manual-entry?editId=${post.id}` as any); }}
                  >
                    <RivalIcon name="edit" size={16} color={RivalColors.onSurface} />
                    <Text style={styles.postMoreMenuText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.postMoreMenuItem}
                    onPress={() => { setMenuOpen(false); router.push(`/ai-share?activityId=${post.id}` as any); }}
                  >
                    <RivalIcon name="camera" size={16} color={RivalColors.onSurface} />
                    <Text style={styles.postMoreMenuText}>Save as image</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.postMoreMenuItem} onPress={deleteThisActivity}>
                    <RivalIcon name="delete" size={16} color="#ff5c5c" />
                    <Text style={[styles.postMoreMenuText, { color: '#ff5c5c' }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}
      </View>

      {post.kind === 'dayRoll' ? (
        <View style={styles.noPhotoPanel}>
          <RivalIcon name="walk" size={28} color={RivalColors.accentText} />
          <Text style={styles.rollupCount}>{post.count} {post.typeLabel}</Text>
          <Text style={styles.noPhotoBody}>{formatDuration(post.totalSeconds)} of movement</Text>
        </View>
      ) : post.kind === 'race' ? (
        <View style={styles.noPhotoPanel}>
          <RivalIcon name="flag" size={28} color="#ff5c5c" />
          <Text style={styles.eventAction}>Signed up for an event</Text>
          <Text style={styles.eventName}>{formatRaceName(post.raceName)}</Text>
          <Text style={styles.eventDate}>{new Date(post.raceDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
        </View>
      ) : post.photoUrl ? (
        <View style={[styles.postPhotoWrap, isPb && styles.postPhotoWrapPb]}>
          <Image source={{ uri: post.photoUrl }} style={styles.postPhoto} />
        </View>
      ) : routePolyline ? (
        <View style={styles.routeWrap}>
          <RouteMap polyline={routePolyline} />
          {post.userId === currentUserId && (
            <TouchableOpacity style={styles.routeAddPhoto} onPress={addPhotoFromFeed} disabled={uploadingPhoto} accessibilityRole="button">
              <RivalIcon name="addPhoto" size={14} color={RivalColors.accentText} />
              <BusyText busy={!!(uploadingPhoto)} style={styles.routeAddPhotoText}>{uploadingPhoto ? 'Uploading…' : 'Add a photo'}</BusyText>
            </TouchableOpacity>
          )}
        </View>
      ) : post.userId === currentUserId ? (
        <TouchableOpacity style={[styles.noPhotoPanel, styles.addPhotoPanel]} activeOpacity={0.85} onPress={addPhotoFromFeed} disabled={uploadingPhoto}>
          <View style={styles.addPhotoCircle}>
            <RivalIcon name="addPhoto" size={22} color={RivalColors.accentText} />
          </View>
          <BusyText busy={!!(uploadingPhoto)} style={styles.addPhotoTitle}>{uploadingPhoto ? 'Uploading…' : 'Add a photo'}</BusyText>
          {!uploadingPhoto && <Text style={styles.addPhotoSub}>Photos bring the team feed to life.</Text>}
        </TouchableOpacity>
      ) : (
        <View style={styles.noPhotoPanel}>
          <RivalIcon name={activityIconName(post.activityType)} size={28} color={RivalColors.accentText} />
          <Text style={styles.noPhotoBody}>No photo this time, still counts.</Text>
        </View>
      )}

      {(post.kind === 'activity' || post.kind === 'dayRoll') && (
        <>
          <View style={styles.postFooterRow}>
            {badge ? (
              <View style={styles.badgeLine}>
                <RivalIcon name={badge.icon} size={13} color={badge.color} />
                <Text style={[styles.badgeLineText, { color: badge.color }]} numberOfLines={1}>{badge.label}</Text>
              </View>
            ) : (
              <Text style={styles.statsLine}>{statsLine}</Text>
            )}
            {post.xp > 0 && (
              <View style={styles.effortLine}>
                <Text style={[styles.effortNum, isPb && { color: RivalColors.rankAnchors.unrivaled }]}>{post.xp}</Text>
                <Text style={styles.effortUnit}>Effort</Text>
              </View>
            )}
          </View>
          {badge && statsLine ? <Text style={styles.statsLine}>{statsLine}</Text> : null}
          {post.kind === 'activity'
            && post.userId === currentUserId
            && post.durationSeconds > 0
            && post.durationSeconds < LIKELY_MISTAKE_UNDER_SECONDS ? (
            <TouchableOpacity onPress={deleteThisActivity} disabled={deleting} activeOpacity={0.7}>
              <BusyText busy={deleting} style={styles.tooShortOffer}>
                {deleting ? 'Removing…' : 'Remove short activity'}
              </BusyText>
            </TouchableOpacity>
          ) : null}
        </>
      )}

      {/* Who else was there. The owner can add people for as long as the
          database allows tagging; everyone else sees the confirmed names. */}
      {post.kind === 'activity' ? (
        post.userId === currentUserId && !post.isSharedCopy && withinTagWindow(post.ts) ? (
          <TrainingPartners activityId={post.id} startedAt={post.ts} companions={post.companions} />
        ) : post.companions ? (
          <View style={styles.partnersLine}>
            <RivalIcon name="groups" size={12} color="rgba(255,255,255,0.5)" />
            <Text style={styles.partnersText} numberOfLines={2}>with {post.companions}</Text>
          </View>
        ) : null
      ) : null}

      {post.kind === 'activity' && post.notes ? <Text style={styles.caption}>{post.notes}</Text> : null}

      <View style={styles.reactionRow}>
        <TouchableOpacity style={styles.reactionItem} onPress={() => onReact('respect')}>
          <RivalIcon name={myReaction === 'respect' ? 'star' : 'starOutline'} size={15} color={myReaction === 'respect' ? RivalColors.accentText : RivalColors.onSurface} />
          <Text style={[styles.reactionLabel, myReaction === 'respect' && { color: RivalColors.accentText }]}>Respect</Text>
          <Text style={[styles.reactionCount, respectCount > 0 && styles.reactionCountActive]}>{respectCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reactionItem} onPress={() => onReact('inspired')}>
          <RivalIcon name="bolt" size={15} color={myReaction === 'inspired' ? RivalColors.rankAnchors.unrivaled : RivalColors.onSurface} />
          <Text style={[styles.reactionLabel, myReaction === 'inspired' && { color: RivalColors.rankAnchors.unrivaled }]}>Inspired</Text>
          <Text style={[styles.reactionCount, inspiredCount > 0 && styles.reactionCountActive]}>{inspiredCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.commentCount} onPress={onToggleComments}>
          <RivalIcon name="chat" size={15} color={RivalColors.onSurface} />
          <Text style={[styles.commentCountText, comments.length === 0 && styles.commentCountTextFaint]}>{comments.length}</Text>
        </TouchableOpacity>
      </View>

      {isCommentsOpen && (
        <View style={styles.commentsBlock}>
          {comments.map((c) => (
            <View key={c.id} style={styles.commentRow}>
              <Text style={styles.commentAuthor}>{nameMap[c.user_id] ?? 'Athlete'}</Text>
              <Text style={styles.commentBody}>{c.body}</Text>
            </View>
          ))}
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              value={commentDraft}
              onChangeText={onChangeCommentDraft}
              placeholder="Add a comment…"
              placeholderTextColor="rgba(255,255,255,0.4)"
              onSubmitEditing={onPostComment}
            />
            <TouchableOpacity onPress={onPostComment} disabled={!commentDraft.trim()}>
              <Text style={[styles.commentSendText, !commentDraft.trim() && { opacity: 0.4 }]}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mBgFixed: {
    position: 'fixed' as any, top: 0, left: 0, right: 0, width: '100%',
    height: '100vh' as any,
    backgroundColor: '#131313',
    ...(Platform.OS === 'web' ? { backgroundImage: 'radial-gradient(ellipse 140% 90% at 88% 105%, rgba(217,119,87,0.10) 0%, rgba(19,19,19,0) 55%)' } as any : {}),
  },
  container: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 48, gap: 20, width: '100%', maxWidth: 640, marginHorizontal: 'auto' },
  contentMobile: { paddingTop: 16, paddingBottom: 120 },

  hero: { marginHorizontal: -18, marginTop: -16, paddingTop: 18, paddingBottom: 104, backgroundColor: '#1c1512' },
  belowHero: { marginTop: -95 },
  heroTextBlock: { alignItems: 'center', gap: 4, paddingHorizontal: 18, marginTop: 6 },
  heroGlyphRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  heroRule: { width: 40, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  heroTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '600', fontSize: 22, color: '#fff' },
  heroTagline: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  heroTaglineUnderline: { width: 102, height: 1, marginTop: 8, backgroundColor: 'rgba(255,255,255,0.3)' },

  stateText: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 20 },
  emptyTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: '#fff', marginTop: 4 },
  emptyBody: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center' },
  emptyBtn: { marginTop: 8, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 },
  emptyBtnText: { fontSize: 13, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },

  railWrap: { position: 'relative', marginTop: 10 },
  rail: { flexGrow: 0 },
  railContent: { gap: 6, paddingVertical: 2, paddingHorizontal: 18 },
  railArrow: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: 44,
    alignItems: 'flex-end', justifyContent: 'center', paddingRight: 4,
  },

  teamCardIconText: { fontSize: 15, fontWeight: '800' },

  teamLogoBtn: { width: 88, alignItems: 'center' },
  teamLogoFrame: {
    width: 88, height: 88, borderRadius: 16,
    overflow: 'hidden', alignItems: 'center',
  },
  // Crests are generated with a badge/shield + title banner near the bottom
  // edge, leaving more open background at the top — a symmetric center-crop
  // reads as extra dead space above the badge. Crop more off the top than
  // the bottom instead of centering, so the badge itself sits centered.
  teamLogoImgFull: { width: 108, height: 108, marginTop: -12 },
  teamLogoUnderline: { width: 56, height: 1, marginTop: 6, backgroundColor: 'rgba(217,119,87,0.35)' },
  teamLogoUnderlineWeb: {
    width: 56, height: 1, marginTop: 6,
    backgroundImage: 'linear-gradient(90deg, rgba(217,119,87,0) 0%, rgba(217,119,87,0.55) 50%, rgba(217,119,87,0) 100%)',
  } as any,
  teamLogoFallback: {
    width: 88, height: 88, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },

  post: {
    position: 'relative',
    borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.14)',
    backgroundColor: '#2d241f',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'radial-gradient(circle at -10% -15%, rgba(255,209,190,0.14) 0%, rgba(255,209,190,0) 70%), linear-gradient(135deg, #231e1b 0%, #2d241f 55%, #3b2821 100%)',
    } as any : {}),
    padding: 12,
    gap: 11,
  },
  postAccentBar: { position: 'absolute', top: 6, bottom: 6, width: 3 },
  postAccentBarNative: { position: 'absolute', top: 6, bottom: 6, width: 3, opacity: 0.7 },
  postAccentBarLeft: { left: -1, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 },
  postAccentBarRight: { right: -1, borderTopRightRadius: 3, borderBottomRightRadius: 3 },

  // zIndex so the dropdown menu (anchored in here) paints above the photo/
  // no-photo panel below it — RN Web gives every View position:relative by
  // default, so later siblings otherwise win stacking order regardless of
  // the menu's own zIndex.
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, zIndex: 5 },
  postMoreWrap: { marginLeft: 'auto', position: 'relative' },
  postMoreBtn: { padding: 4 },
  postMoreBackdrop: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute',
    top: -1000, left: -1000, right: -1000, bottom: -1000,
  },
  postMoreMenu: {
    position: 'absolute', top: 30, right: 0, zIndex: 10, minWidth: 168,
    borderRadius: 12, paddingVertical: 6, backgroundColor: '#2a221e',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    ...(Platform.OS === 'web' ? { boxShadow: '0px 8px 20px rgba(0,0,0,0.45)' } as any : {
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
    }),
  },
  postMoreMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 14 },
  postMoreMenuText: { fontSize: 13.5, fontWeight: '600', color: RivalColors.onSurface },
  postAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
  postAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  postAvatarText: { fontSize: 12.5, fontWeight: '800' },
  // Shrinks to the name's own width instead of stretching across the row.
  postNameHit: { alignSelf: 'flex-start' },
  postName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: '#fff' },
  postMeta: { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 1 },
  postTeamTag: { color: RivalColors.accentText, fontWeight: '600' },

  postPhotoWrap: { position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: 4 / 5, backgroundColor: '#211c19' },
  postPhotoWrapPb: { borderWidth: 2.5, borderColor: RivalColors.rankAnchors.unrivaled },
  postPhoto: { width: '100%', height: '100%' },

  postFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  badgeLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  badgeLineText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', flexShrink: 1 },
  statsLine: { fontSize: 14.5, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  effortLine: { alignItems: 'flex-end' },
  effortNum: { fontSize: 19, fontWeight: '800', color: RivalColors.accentText, lineHeight: 20 },
  effortUnit: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 9, letterSpacing: 0.4, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', marginTop: 1 },

  partnersLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  partnersText: { flex: 1, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  caption: { fontSize: 12.5, color: RivalColors.onSurface, lineHeight: 18, paddingHorizontal: 2 },

  routeWrap: { position: 'relative' },
  routeAddPhoto: {
    position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(17,14,12,0.75)',
    borderWidth: 1, borderColor: 'rgba(255,209,190,0.28)',
  },
  routeAddPhotoText: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  postDeleting: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50,
    alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: 16, backgroundColor: 'rgba(17,14,12,0.78)',
  },
  postDeletingText: { fontSize: 14, fontWeight: '700', color: RivalColors.accentText },
  noPhotoPanel: {
    position: 'relative', borderRadius: 14, overflow: 'hidden', padding: 20, alignItems: 'center', gap: 8,
    backgroundColor: '#2d241f',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'radial-gradient(ellipse 90% 60% at 50% 40%, rgba(255,209,190,0.10) 0%, rgba(19,19,19,0) 65%), linear-gradient(160deg, #231e1b 0%, #2d241f 55%, #3b2821 100%)',
    } as any : {}),
  },
  noPhotoBody: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 13, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  addPhotoPanel: { borderWidth: 1.5, borderColor: 'rgba(255,209,190,0.35)', borderStyle: 'dashed' as any },
  addPhotoTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 15, fontWeight: '700', color: '#fff', textAlign: 'center' },
  addPhotoSub: { fontSize: 12.5, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  addPhotoCircle: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: RivalColors.accentText, alignItems: 'center', justifyContent: 'center' },
  // Same weight as the event label but in the app's own accent rather than
  // race red — a day of walks is ordinary training, not an occasion.
  rollupCount: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: RivalColors.accentText },
  // Offered, never insisted on: the same muted weight as the stats line rather
  // than anything that reads as a warning, and only the owner ever sees it.
  tooShortOffer: { marginTop: 8, fontSize: 12, color: RivalColors.textSecondary, textDecorationLine: 'underline' },
  eventAction: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: '#ff5c5c' },
  eventName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#fff', marginTop: 2 },
  eventDate: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 },

  reactionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 2 },
  reactionItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reactionLabel: { fontSize: 12.5, fontWeight: '700', color: RivalColors.onSurface },
  reactionCount: { fontSize: 11.5, fontWeight: '400', color: RivalColors.textSecondary },
  reactionCountActive: { fontWeight: '800', color: RivalColors.onSurface },
  commentCount: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentCountText: { fontSize: 12.5, fontWeight: '800', color: RivalColors.onSurface },
  commentCountTextFaint: { fontWeight: '400', color: RivalColors.textSecondary },

  commentsBlock: { gap: 8, paddingHorizontal: 2 },
  commentRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  commentAuthor: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  commentBody: { fontSize: 12.5, color: RivalColors.onSurface, flexShrink: 1 },
  commentInputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  commentInput: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, color: RivalColors.onSurface, fontSize: 12.5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  commentSendText: { color: RivalColors.accentText, fontWeight: '700', fontSize: 12.5 },
});
