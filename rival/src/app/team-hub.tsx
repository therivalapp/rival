import { useSnapState } from '../lib/snapState';
import { formatActivityDistance } from '../lib/units';
// Real Team Hub — exact visual port of the "Team Hub v3" mockup Ricky
// reviewed and signed off on, wired to live Supabase data.
// This is now the real destination when tapping a team from team-feed.tsx
// (replaces the old /league entry point for that flow). /league itself is
// untouched and still reachable directly — its Chat/Sessions/1v1-Challenges
// features aren't rebuilt here yet, so the Challenges tab below deep-links
// back into /league rather than duplicating that logic.
//
// Feed tab now renders the exact same post card as team-feed.tsx (photo/no-
// photo panel, PB/insight badge, notes, Respect/Inspired reactions, comments,
// own-post edit/save-as-image/delete menu) against this team's activities —
// same feed_reactions/feed_comments tables, same PB + insight computation.
//
// Standings filter chips (Overall/Run/Ride/Swim/Strength) now really filter
// Top Contributors by activity-type category, computed client-side from the
// same goal-window activities query (no schema change needed). The Team
// Challenge total/ring/pace still reflect the whole team regardless of filter
// — the chips slice the leaderboard view, not the goal itself.
import { useEffect, useState, useId } from 'react';
import { Asset } from 'expo-asset';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Image, ImageBackground, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { supabase, getAuthUser } from '../lib/supabase';
import { confirmAction, notify } from '../lib/notify';
import { formatDisplayName, formatTeamName } from '../lib/identity';
import { formatDuration } from '../lib/format';
import { computeActivityInsight, ActivityInsight, InsightActivity, InsightTone } from '../lib/activityInsights';
import { RivalAvatar } from '../components/rival/RivalAvatar';
import { RivalIcon, RivalIconName, activityIconName } from '../components/rival/RivalIcon';
import { RivalBackButton } from '../components/rival/RivalBackButton';
import { RivalTopNav } from '../components/rival/RivalTopNav';
import { PlanSessionSheet, EditableSession } from '../components/rival/PlanSessionSheet';
import { copyText } from '../lib/clipboard';
import { SessionCard } from '../components/rival/SessionCard';
import { TeamChallengesTab, ChallengeTeammateSheet } from '../components/rival/team/TeamChallengesTab';
import { WeeklyStandings } from '../components/rival/team/WeeklyStandings';
import { EncourageSheet, loadEncouragedToday } from '../components/rival/team/EncourageSheet';
import { RivalColors, RivalSerifFamily, RivalButtonColors } from '../constants/rivalTheme';
import { matchCanonicalLift } from '../lib/lifts';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';

// Matches chat.tsx's SESSION_GRACE_MS — a session stays "upcoming" for 12
// hours past its start, since sessions carry no duration.
const SESSION_GRACE_MS = 12 * 60 * 60 * 1000;

const INSIGHT_ICON: Record<InsightTone, RivalIconName> = { record: 'trophy', streak: 'fire', comeback: 'trendUp' };
const INSIGHT_COLOR: Record<InsightTone, string> = {
  record: RivalColors.rankAnchors.unrivaled,
  streak: RivalColors.accentText,
  comeback: RivalColors.tertiary,
};
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

const SERIF = RivalSerifFamily;
const HERO_PHOTO = require('../../assets/images/backgrounds/optimized/coastal-highway-triathlete-dusk-3.jpg');

// Swim/Rowing distances are shown in metres, not km — same convention as
// my-activities.tsx's formatDistance/METERS_SPORTS.
const METERS_SPORTS = new Set(['Swim', 'Rowing']);
function formatDistance(meters: number | null | undefined, activityType?: string | null): string | null {
  return formatActivityDistance(meters, activityType);
}

type StandingsFilter = 'all' | 'run' | 'ride' | 'swim' | 'strength';
const STANDINGS_FILTERS: { key: StandingsFilter; icon: RivalIconName }[] = [
  { key: 'all', icon: 'star' },
  { key: 'run', icon: 'run' },
  { key: 'ride', icon: 'ride' },
  { key: 'swim', icon: 'swim' },
  { key: 'strength', icon: 'weights' },
];
const RUN_TYPES = new Set(['Run', 'VirtualRun', 'TrailRun']);
const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide']);
const SWIM_TYPES = new Set(['Swim']);
const STRENGTH_TYPES = new Set(['WeightTraining', 'CrossFit', 'Hyrox', 'HIIT', 'Bootcamp', 'Workout']);
function matchesStandingsFilter(activityType: string, filter: StandingsFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'run') return RUN_TYPES.has(activityType);
  if (filter === 'ride') return RIDE_TYPES.has(activityType);
  if (filter === 'swim') return SWIM_TYPES.has(activityType);
  return STRENGTH_TYPES.has(activityType);
}

function feedTargetKey(id: string) {
  return `activity:${id}`;
}

type GoalMetric = 'xp' | 'distance' | 'elevation' | 'duration' | 'activities';
const GOAL_METRIC_UNIT: Record<GoalMetric, string> = {
  xp: 'effort', distance: 'km', elevation: 'm', duration: 'hrs', activities: 'activities',
};
const GOAL_METRIC_LABEL: Record<GoalMetric, string> = {
  xp: 'Effort earned', distance: 'Distance', elevation: 'Elevation', duration: 'Time', activities: 'Activities Logged',
};
function goalValue(a: { effort_score: number | null; distance_meters: number | null; elevation_meters: number | null; duration_seconds: number | null }, metric: GoalMetric): number {
  if (metric === 'xp') return a.effort_score || 0;
  if (metric === 'distance') return (a.distance_meters || 0) / 1000;
  if (metric === 'elevation') return a.elevation_meters || 0;
  if (metric === 'duration') return (a.duration_seconds || 0) / 3600;
  return 1;
}

type League = {
  id: string; name: string; created_at: string; logo_url: string | null; invite_code: string | null;
  goal_metric: GoalMetric | null; goal_target: number | null; goal_target_date: string | null;
  description?: string | null;
  created_by?: string;
};
type Member = { user_id: string; role: string; users: { display_name: string | null; avatar_url: string | null } };
type ActivityRow = {
  id: string; user_id: string; name: string | null; activity_type: string; started_at: string;
  duration_seconds: number | null; distance_meters: number | null; effort_score: number | null;
  exercises: any[] | null; notes: string | null; photo_url: string | null;
  pbLift: string | null; insight: ActivityInsight | null;
};
type GoalActivityRow = { user_id: string; activity_type: string; effort_score: number | null; distance_meters: number | null; elevation_meters: number | null; duration_seconds: number | null };
type BoardPost = { id: string; user_id: string; title: string | null; body: string; pinned: boolean; created_at: string };
function boardTargetKey(id: string) {
  return `board:${id}`;
}
const BOARD_PIN_COLORS = [RivalColors.accentFill, RivalColors.accentGold];

// Monday-start week window, same algorithm as league.tsx's standings.
function getWeekWindow(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

// Same react-native-web workaround as RivalFixedBackground/HeroPhoto
// elsewhere: ImageBackground hardcodes backgroundPosition/no gradients on
// the div that actually paints the photo, so web renders raw CSS instead.
function HeroPhoto({ style, children }: { style?: any; children?: React.ReactNode }) {
  if (Platform.OS === 'web') {
    const uri = Asset.fromModule(HERO_PHOTO).uri;
    return (
      <View
        style={[
          style,
          {
            backgroundImage: [
              'linear-gradient(180deg, rgba(20,14,10,0.15) 0%, rgba(19,19,19,0.62) 50%, rgba(19,19,19,0.97) 86%)',
              'radial-gradient(120% 70% at 50% 0%, rgba(217,119,87,0.28) 0%, rgba(217,119,87,0) 60%)',
              `url(${uri})`,
            ].join(', '),
            backgroundPosition: '0 0, 0 0, center 45%',
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

const warmCardWeb = Platform.OS === 'web'
  ? ({ backgroundImage: 'radial-gradient(circle at -10% -15%, rgba(255,209,190,0.14) 0%, rgba(255,209,190,0) 70%), linear-gradient(135deg, #231e1b 0%, #2d241f 55%, #3b2821 100%)' } as any)
  : null;
const paceCardWeb = Platform.OS === 'web'
  ? ({ backgroundImage: 'linear-gradient(135deg, rgba(217,119,87,0.16), rgba(217,119,87,0.05))' } as any)
  : null;
const heroScrimWeb = Platform.OS === 'web'
  ? ({ backgroundImage: 'linear-gradient(0deg, rgba(19,19,19,0.95) 0%, transparent 45%)', backgroundColor: 'transparent' } as any)
  : null;
const barFillWeb = Platform.OS === 'web'
  ? ({ backgroundImage: `linear-gradient(90deg, ${RivalColors.accentFill}, ${RivalColors.accentText})` } as any)
  : null;
const chipActiveWeb = Platform.OS === 'web'
  ? ({ backgroundImage: `linear-gradient(135deg, ${RivalColors.accentFill}, ${RivalColors.accentText})` } as any)
  : null;

function ChallengeRing({ pct, value, unit, size = 200, thickness = 14 }: { pct: number; value: number; unit: string; size?: number; thickness?: number }) {
  const clamped = Math.max(0, Math.min(1, pct));
  const ringId = `ringGrad${useId().replace(/[^a-zA-Z0-9]/g, '')}`; // unique per ring on the page
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <LinearGradient id={ringId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={RivalColors.accentFill} />
            <Stop offset="100%" stopColor={RivalColors.accentText} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={thickness} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={`url(#${ringId})`} strokeWidth={thickness} fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
        />
      </Svg>
      <RivalIcon name="flag" size={22} color={RivalColors.accentText} style={{ marginBottom: 4 }} />
      <Text style={styles.ringValue}>{value.toLocaleString()}</Text>
      <Text style={styles.ringTarget}>{unit}</Text>
    </View>
  );
}

const TABS = ['Overview', 'Posts', 'Challenges', 'Members'] as const;
type Tab = (typeof TABS)[number];

type SessionRow = {
  id: string;
  user_id: string;
  activity_type: string | null;
  body: string | null;
  scheduled_at: string | null;
  location: string | null;
};

export default function TeamHub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The data below is remembered per team (lib/snapState.ts), so returning to
  // a team draws its last state at once and refreshes behind it.
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [league, setLeague] = useSnapState<League | null>(`hub.${id}.league`, null);
  const [members, setMembers] = useSnapState<Member[]>(`hub.${id}.members`, []);
  const [currentUserId, setCurrentUserId] = useSnapState(`hub.${id}.currentUserId`, '');
  const [isAdmin, setIsAdmin] = useSnapState(`hub.${id}.isAdmin`, false);
  const [loading, setLoading] = useSnapState(`hub.${id}.loading`, true);
  const [goalProgress, setGoalProgress] = useSnapState(`hub.${id}.goalProgress`, 0);
  const [goalActivitiesRaw, setGoalActivitiesRaw] = useSnapState<GoalActivityRow[]>(`hub.${id}.goalActivitiesRaw`, []);
  const [weeklyActivitiesRaw, setWeeklyActivitiesRaw] = useSnapState<GoalActivityRow[]>(`hub.${id}.weeklyActivitiesRaw`, []);
  const [standingsFilter, setStandingsFilter] = useState<StandingsFilter>('all');
  const [noGoalPeriod, setNoGoalPeriod] = useState<'week' | 'alltime'>('week');
  const [boardPosts, setBoardPosts] = useSnapState<BoardPost[]>(`hub.${id}.boardPosts`, []);
  const [boardComposeOpen, setBoardComposeOpen] = useState(false);
  const [boardTitleDraft, setBoardTitleDraft] = useState('');
  // The note open in the full-size viewer, and its edit state. Notes open on
  // tap rather than carrying pin/delete icons: 13px icons in a card corner are
  // too small to hit reliably with a thumb.
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [noteTitleDraft, setNoteTitleDraft] = useState('');
  const [noteBodyDraft, setNoteBodyDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  // The open note shows its two latest comments; the comment count expands the rest.
  const [noteCommentsExpanded, setNoteCommentsExpanded] = useState(false);
  const [boardBodyDraft, setBoardBodyDraft] = useState('');
  const [postingBoard, setPostingBoard] = useState(false);
  const [boardError, setBoardError] = useState('');
  const [boardReactionsMap, setBoardReactionsMap] = useSnapState<Record<string, Array<{ user_id: string; emoji: string }>>>(`hub.${id}.boardReactionsMap`, {});
  const [boardCommentsMap, setBoardCommentsMap] = useSnapState<Record<string, Array<{ id: string; user_id: string; body: string; created_at: string }>>>(`hub.${id}.boardCommentsMap`, {});
  const [boardCommentDrafts, setBoardCommentDrafts] = useState<Record<string, string>>({});
  const [expandedBoardComments, setExpandedBoardComments] = useState<Set<string>>(new Set());
  const [recentActivity, setRecentActivity] = useSnapState<ActivityRow[]>(`hub.${id}.recentActivity`, []);
  const [sessions, setSessions] = useSnapState<SessionRow[]>(`hub.${id}.sessions`, []);
  const [sessionRsvps, setSessionRsvps] = useSnapState<Record<string, string[]>>(`hub.${id}.sessionRsvps`, {});
  // Every session ever planned, not just the three shown — so "See all" can
  // appear when there's history to see even though nothing is coming up.
  const [sessionTotal, setSessionTotal] = useSnapState(`hub.${id}.sessionTotal`, 0);
  const [planning, setPlanning] = useState(false);
  // Members tab: who you've encouraged today, and who an Encourage / Challenge
  // sheet is open for. Challenges tab reloads when a challenge is sent from
  // the Members tab (challengesRefresh).
  const [encouragedIds, setEncouragedIds] = useState<Set<string>>(new Set());
  const [encourageTarget, setEncourageTarget] = useState<{ id: string; name: string } | null>(null);
  const [challengeTarget, setChallengeTarget] = useState<{ id: string; name: string } | null>(null);
  const [challengesRefresh, setChallengesRefresh] = useState(0);
  const [codeCopied, setCodeCopied] = useState(false);
  useEffect(() => {
    if (currentUserId) loadEncouragedToday(currentUserId).then(setEncouragedIds);
  }, [currentUserId]);
  // Which session's location was just copied, so its card can confirm it.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyLocation(id: string, text: string) {
    if (!(await copyText(text))) return;
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
  }
  const [editingSession, setEditingSession] = useState<EditableSession | null>(null);
  const [feedActivity, setFeedActivity] = useSnapState<ActivityRow[]>(`hub.${id}.feedActivity`, []);
  const [reactionsMap, setReactionsMap] = useSnapState<Record<string, Array<{ user_id: string; emoji: string }>>>(`hub.${id}.reactionsMap`, {});
  const [commentsMap, setCommentsMap] = useSnapState<Record<string, Array<{ id: string; user_id: string; body: string; created_at: string }>>>(`hub.${id}.commentsMap`, {});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());

  useEffect(() => { load(); }, [id]);

  // Only what's still ahead. The same 12-hour grace the chat screen uses, so a
  // morning session doesn't drop off Overview while people are still at it —
  // one rule, defined once, rather than two screens disagreeing about whether
  // a session is over.
  async function loadSessions() {
    const cutoff = new Date(Date.now() - SESSION_GRACE_MS).toISOString();
    const { data } = await supabase
      .from('league_messages')
      .select('id, user_id, activity_type, body, scheduled_at, location')
      .eq('league_id', id)
      .eq('kind', 'session')
      .gte('scheduled_at', cutoff)
      .order('scheduled_at', { ascending: true })
      .limit(3);
    const rows = (data ?? []) as SessionRow[];
    setSessions(rows);

    const { count } = await supabase
      .from('league_messages')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', id)
      .eq('kind', 'session');
    setSessionTotal(count ?? 0);

    if (rows.length > 0) {
      const { data: rsvps } = await supabase
        .from('league_session_rsvps')
        .select('message_id, user_id')
        .in('message_id', rows.map(r => r.id));
      const map: Record<string, string[]> = {};
      (rsvps ?? []).forEach((r: any) => {
        (map[r.message_id] ||= []).push(r.user_id);
      });
      setSessionRsvps(map);
    } else {
      setSessionRsvps({});
    }
  }

  async function toggleSessionRsvp(messageId: string) {
    if (!currentUserId) return;
    const joined = (sessionRsvps[messageId] || []).includes(currentUserId);
    if (joined) {
      const { error } = await supabase.from('league_session_rsvps')
        .delete().eq('message_id', messageId).eq('user_id', currentUserId);
      if (error) { notify("Couldn't update RSVP", error.message); loadSessions(); return; }
      setSessionRsvps(prev => ({ ...prev, [messageId]: (prev[messageId] || []).filter(u => u !== currentUserId) }));
    } else {
      const { error } = await supabase.from('league_session_rsvps')
        .insert({ message_id: messageId, user_id: currentUserId });
      if (error) { notify("Couldn't update RSVP", error.message); loadSessions(); return; }
      setSessionRsvps(prev => ({ ...prev, [messageId]: [...(prev[messageId] || []), currentUserId] }));
    }
  }

  // Everything this page needs, in as few round trips as possible. It used to
  // be a chain of about nine requests each waiting on the one before —
  // members, then the feed, then sessions, then reactions, then challenge
  // totals, then this week, then the board, then the board's reactions —
  // although most only need the member list. Now it's three rounds: who's in
  // the team, everything that depends only on that (all at once), then the
  // reactions and comments for whatever the feed and board returned.
  // Another member's profile is their stats page. /profile is your own
  // settings and redirects for anyone else, which is why tapping a teammate
  // here used to go nowhere useful.
  function openProfile(userId: string) {
    router.push(`/stats?userId=${userId}` as any);
  }

  async function copyInviteCode() {
    if (!league?.invite_code) return;
    if (!(await copyText(league.invite_code))) return;
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1800);
  }

  async function endTeamGoal() {
    if (!league) return;
    const ok = await confirmAction({
      title: 'End the team challenge?',
      message: 'The challenge is removed for everyone. Activities and Effort are not affected.',
      confirmLabel: 'End challenge',
      destructive: true,
    });
    if (!ok) return;
    const { data, error } = await supabase
      .from('leagues')
      .update({ goal_metric: null, goal_target: null, goal_target_date: null })
      .eq('id', league.id)
      .select('id');
    if (error || !data?.length) { notify("Couldn't end the challenge", error?.message ?? 'Only team admins can do this.'); return; }
    setLeague({ ...league, goal_metric: null, goal_target: null, goal_target_date: null });
  }

  async function leaveTeam() {
    if (!league) return;
    const last = members.length <= 1;
    const ok = await confirmAction({
      title: `Leave ${formatTeamName(league.name)}?`,
      message: last
        ? "You're the last member. Leaving will permanently delete the team, including its chat, posts and challenge history."
        : league.created_by === currentUserId
          ? 'You are the founder. The team passes to the longest-standing admin, or the longest-standing member if there are no other admins. To choose who, use Make founder in Team settings first.'
          : 'You can rejoin later with the invite code.',
      confirmLabel: last ? 'Leave and delete' : 'Leave team',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('leave_league', { p_league_id: id });
    if (error) { notify("Couldn't leave the team", error.message); return; }
    goToTab('/team-feed');
  }

  const { scrollProps: pullProps, indicator: pullIndicator } = usePullToRefresh(() => load());

  async function load() {
    // A refresh of the team already on screen keeps it there; only opening a
    // different team (or the first open) shows the loading state.
    if (!league || league.id !== id) setLoading(true);
    const [{ data: { user } }, { data: leagueData }, { data: membersData }] = await Promise.all([
      getAuthUser(),
      // select('*'): a named column the database doesn't have yet fails the whole
      // query, which would blank the team page.
      supabase.from('leagues').select('*').eq('id', id).single(),
      supabase
        .from('league_members')
        .select('user_id, role, users(display_name, avatar_url)')
        .eq('league_id', id)
        .eq('status', 'active'),
    ]);
    if (user) setCurrentUserId(user.id);
    if (!leagueData) { setLoading(false); return; }
    setLeague(leagueData as League);

    const memberList = (membersData || []) as unknown as Member[];
    setMembers(memberList);

    if (user) {
      const me = memberList.find(m => m.user_id === user.id);
      setIsAdmin(me?.role === 'admin');
    }

    const memberIds = memberList.map(m => m.user_id);
    if (memberIds.length > 0) {
      const oneYearAgo = new Date();
      oneYearAgo.setDate(oneYearAgo.getDate() - 365);
      const { start: weekStart, end: weekEnd } = getWeekWindow();

      const [
        { data: activities },
        { data: liftEntries },
        { data: insightHistory },
        { data: sinceCreationActivities },
        { data: weeklyActivities },
        { data: board },
      ] = await Promise.all([
        supabase
          .from('activities')
          .select('id, user_id, name, activity_type, started_at, distance_meters, effort_score, duration_seconds, exercises, notes, photo_url')
          .in('user_id', memberIds)
          .order('started_at', { ascending: false })
          .limit(30),
        supabase.from('exercise_entries').select('user_id, exercise_name, weight_kg').in('user_id', memberIds),
        supabase.from('activities')
          .select('user_id, activity_type, started_at, duration_seconds, distance_meters, elevation_meters')
          .in('user_id', memberIds)
          .gte('started_at', oneYearAgo.toISOString())
          .order('started_at', { ascending: false })
          .limit(500),
        // Fetched unconditionally (not just when a Team Challenge exists) so it
        // can double as the "All Time" standings source when there isn't one.
        supabase
          .from('activities')
          .select('user_id, activity_type, effort_score, distance_meters, elevation_meters, duration_seconds')
          .in('user_id', memberIds)
          .gte('started_at', leagueData.created_at),
        // Standings should still show even without an active Team Challenge —
        // ranked by this week's Effort in that case, same basis as the rest of
        // the app's weekly leaderboards.
        supabase
          .from('activities')
          .select('user_id, activity_type, effort_score, distance_meters, elevation_meters, duration_seconds')
          .in('user_id', memberIds)
          .gte('started_at', weekStart.toISOString())
          .lt('started_at', weekEnd.toISOString()),
        supabase
          .from('league_messages')
          .select('id, user_id, title, body, pinned, created_at')
          .eq('league_id', id)
          .eq('kind', 'board')
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(20),
        loadSessions(),
      ]);

      const maxMap = new Map<string, number>();
      (liftEntries || []).forEach((e: any) => {
        const key = `${e.user_id}|${e.exercise_name}`;
        maxMap.set(key, Math.max(maxMap.get(key) ?? 0, e.weight_kg));
      });
      function findPbLift(userId: string, exercises: any[] | null): string | null {
        if (!exercises) return null;
        for (const ex of exercises) {
          const canonical = matchCanonicalLift(ex.name) || ex.prLift;
          if (!canonical || !ex.weight) continue;
          if (ex.weight >= (maxMap.get(`${userId}|${canonical}`) ?? 0)) return canonical;
        }
        return null;
      }
      const insightHistoryByUser: Record<string, InsightActivity[]> = {};
      (insightHistory || []).forEach((a: any) => { (insightHistoryByUser[a.user_id] ??= []).push(a); });

      const feedList: ActivityRow[] = ((activities || []) as any[]).map((a) => {
        const pbLift = findPbLift(a.user_id, a.exercises);
        const insight = computeActivityInsight(
          { activity_type: a.activity_type, started_at: a.started_at, duration_seconds: a.duration_seconds, distance_meters: a.distance_meters },
          insightHistoryByUser[a.user_id] || [],
          !!pbLift,
        );
        return { ...a, pbLift, insight };
      });
      setFeedActivity(feedList);
      setRecentActivity(feedList.slice(0, 8));

      const rows = (sinceCreationActivities || []) as GoalActivityRow[];
      setGoalActivitiesRaw(rows);
      if (leagueData.goal_metric) {
        let total = 0;
        rows.forEach((a) => { total += goalValue(a, leagueData.goal_metric as GoalMetric); });
        setGoalProgress(Math.round(total * 10) / 10);
      } else {
        setGoalProgress(0);
      }

      setWeeklyActivitiesRaw((weeklyActivities || []) as GoalActivityRow[]);

      const boardList = (board || []) as BoardPost[];
      setBoardPosts(boardList);

      // The page is ready to show; reactions and comments fill in a moment
      // later rather than holding everything else behind the loading state.
      setLoading(false);

      // Reactions and comments for the feed AND the board, together.
      const feedIds = feedList.map(a => a.id);
      const boardIds = boardList.map(p => p.id);
      const none = Promise.resolve({ data: [] as any[] });
      const [reactionsRes, commentsRes, boardReactionsRes, boardCommentsRes] = await Promise.all([
        feedIds.length ? supabase.from('feed_reactions').select('target_id, user_id, emoji').eq('target_type', 'activity').in('target_id', feedIds) : none,
        feedIds.length ? supabase.from('feed_comments').select('id, target_id, user_id, body, created_at').eq('target_type', 'activity').in('target_id', feedIds).order('created_at', { ascending: true }) : none,
        boardIds.length ? supabase.from('feed_reactions').select('target_id, user_id, emoji').eq('target_type', 'board').in('target_id', boardIds) : none,
        boardIds.length ? supabase.from('feed_comments').select('id, target_id, user_id, body, created_at').eq('target_type', 'board').in('target_id', boardIds).order('created_at', { ascending: true }) : none,
      ]);

      if (feedIds.length > 0) {
        const newReactionsMap: Record<string, Array<{ user_id: string; emoji: string }>> = {};
        (reactionsRes.data || []).forEach((r: any) => {
          const key = feedTargetKey(r.target_id);
          (newReactionsMap[key] ??= []).push({ user_id: r.user_id, emoji: r.emoji });
        });
        setReactionsMap(newReactionsMap);
        const newCommentsMap: Record<string, Array<{ id: string; user_id: string; body: string; created_at: string }>> = {};
        (commentsRes.data || []).forEach((c: any) => {
          const key = feedTargetKey(c.target_id);
          (newCommentsMap[key] ??= []).push({ id: c.id, user_id: c.user_id, body: c.body, created_at: c.created_at });
        });
        setCommentsMap(newCommentsMap);
      }

      if (boardIds.length > 0) {
        const newBoardReactions: Record<string, Array<{ user_id: string; emoji: string }>> = {};
        (boardReactionsRes.data || []).forEach((r: any) => {
          const key = boardTargetKey(r.target_id);
          (newBoardReactions[key] ??= []).push({ user_id: r.user_id, emoji: r.emoji });
        });
        setBoardReactionsMap(newBoardReactions);
        const newBoardComments: Record<string, Array<{ id: string; user_id: string; body: string; created_at: string }>> = {};
        (boardCommentsRes.data || []).forEach((c: any) => {
          const key = boardTargetKey(c.target_id);
          (newBoardComments[key] ??= []).push({ id: c.id, user_id: c.user_id, body: c.body, created_at: c.created_at });
        });
        setBoardCommentsMap(newBoardComments);
      }
    }

    setLoading(false);
  }

  async function postToBoard() {
    const title = boardTitleDraft.trim();
    const body = boardBodyDraft.trim();
    if (!body || !currentUserId || !id) return;
    setPostingBoard(true);
    setBoardError('');
    const { data: inserted, error } = await supabase
      .from('league_messages')
      .insert({ league_id: id, user_id: currentUserId, kind: 'board', title: title || null, body })
      .select('id, user_id, title, body, pinned, created_at')
      .single();
    setPostingBoard(false);
    if (error || !inserted) {
      setBoardError(error?.message || "Couldn't post. Try again.");
      return;
    }
    setBoardTitleDraft('');
    setBoardBodyDraft('');
    setBoardComposeOpen(false);
    setBoardPosts(prev => [inserted as BoardPost, ...prev].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)));
  }

  async function toggleBoardLike(postId: string) {
    if (!currentUserId || !id) return;
    const key = boardTargetKey(postId);
    const existing = (boardReactionsMap[key] || []).find(r => r.user_id === currentUserId);
    if (existing) {
      const { error } = await supabase.from('feed_reactions').delete().eq('target_type', 'board').eq('target_id', postId).eq('user_id', currentUserId);
      if (error) return;
      setBoardReactionsMap(prev => ({ ...prev, [key]: (prev[key] || []).filter(r => r.user_id !== currentUserId) }));
    } else {
      const { error } = await supabase.from('feed_reactions').upsert(
        { league_id: id, target_type: 'board', target_id: postId, user_id: currentUserId, emoji: 'like' },
        { onConflict: 'target_type,target_id,user_id' }
      );
      if (error) return;
      if (error) return;
      setBoardReactionsMap(prev => ({ ...prev, [key]: [...(prev[key] || []).filter(r => r.user_id !== currentUserId), { user_id: currentUserId, emoji: 'like' }] }));
    }
  }

  function toggleBoardComments(key: string) {
    setExpandedBoardComments(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function postBoardComment(postId: string) {
    if (!currentUserId || !id) return;
    const key = boardTargetKey(postId);
    const text = (boardCommentDrafts[key] || '').trim();
    if (!text) return;
    setBoardCommentDrafts(prev => ({ ...prev, [key]: '' }));
    const { data: inserted, error: cErr } = await supabase.from('feed_comments')
      .insert({ league_id: id, target_type: 'board', target_id: postId, user_id: currentUserId, body: text })
      .select('id, user_id, body, created_at')
      .single();
    if (cErr) {
      setBoardCommentDrafts(prev => ({ ...prev, [key]: text }));
      notify("Couldn't post that comment", cErr.message);
      return;
    }
    if (inserted) setBoardCommentsMap(prev => ({ ...prev, [key]: [...(prev[key] || []), inserted] }));
  }

  function openNote(postId: string) {
    setOpenNoteId(postId);
    setEditingNote(false);
    setNoteCommentsExpanded(false);
  }

  function closeNote() {
    setOpenNoteId(null);
    setEditingNote(false);
  }

  function startEditingNote(post: BoardPost) {
    setNoteTitleDraft(post.title ?? '');
    setNoteBodyDraft(post.body);
    setEditingNote(true);
  }

  async function saveNoteEdit() {
    if (!openNoteId || savingNote) return;
    const title = noteTitleDraft.trim();
    const body = noteBodyDraft.trim();
    if (!body) {
      notify('Message required before saving.');
      return;
    }
    setSavingNote(true);
    const { error } = await supabase
      .from('league_messages')
      .update({ title: title || null, body })
      .eq('id', openNoteId);
    setSavingNote(false);
    if (error) {
      notify("Couldn't save that note", error.message);
      return;
    }
    setBoardPosts(prev => prev.map(p => (p.id === openNoteId ? { ...p, title: title || null, body } : p)));
    setEditingNote(false);
  }

  async function togglePinBoardPost(postId: string, currentlyPinned: boolean) {
    const { error } = await supabase.from('league_messages').update({ pinned: !currentlyPinned }).eq('id', postId);
    if (error) {
      notify(currentlyPinned ? "Couldn't unpin that note" : "Couldn't pin that note", error.message);
      return;
    }
    setBoardPosts(prev =>
      prev.map(p => (p.id === postId ? { ...p, pinned: !currentlyPinned } : p))
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    );
  }

  async function deleteBoardPost(postId: string) {
    const ok = await confirmAction({
      title: 'Delete this note?',
      message: 'It will be removed for the whole team.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('league_messages').delete().eq('id', postId);
    if (error) {
      notify("Couldn't delete that note", error.message);
      return;
    }
    setBoardPosts(prev => prev.filter(p => p.id !== postId));
    closeNote();
  }

  function daysUntil(dateStr: string): number {
    const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  function memberName(userId: string): string {
    const m = members.find(mm => mm.user_id === userId);
    return m ? formatDisplayName(m.users) : 'Someone';
  }
  function memberAvatar(userId: string): string | null {
    return members.find(mm => mm.user_id === userId)?.users?.avatar_url ?? null;
  }
  function timeAgo(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  async function toggleReaction(targetId: string, emoji: string) {
    if (!currentUserId || !id) return;
    const key = feedTargetKey(targetId);
    const existing = (reactionsMap[key] || []).find(r => r.user_id === currentUserId);
    if (existing && existing.emoji === emoji) {
      const { error } = await supabase.from('feed_reactions').delete().eq('target_type', 'activity').eq('target_id', targetId).eq('user_id', currentUserId);
      if (error) return;
      setReactionsMap(prev => ({ ...prev, [key]: (prev[key] || []).filter(r => r.user_id !== currentUserId) }));
    } else {
      const { error } = await supabase.from('feed_reactions').upsert(
        { league_id: id, target_type: 'activity', target_id: targetId, user_id: currentUserId, emoji },
        { onConflict: 'target_type,target_id,user_id' }
      );
      setReactionsMap(prev => ({
        ...prev,
        [key]: [...(prev[key] || []).filter(r => r.user_id !== currentUserId), { user_id: currentUserId, emoji }],
      }));
    }
  }

  function toggleComments(key: string) {
    setExpandedComments(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function postComment(targetId: string) {
    if (!currentUserId || !id) return;
    const key = feedTargetKey(targetId);
    const text = (commentDrafts[key] || '').trim();
    if (!text) return;
    setCommentDrafts(prev => ({ ...prev, [key]: '' }));
    const { data: inserted } = await supabase.from('feed_comments')
      .insert({ league_id: id, target_type: 'activity', target_id: targetId, user_id: currentUserId, body: text })
      .select('id, user_id, body, created_at')
      .single();
    if (inserted) setCommentsMap(prev => ({ ...prev, [key]: [...(prev[key] || []), inserted] }));
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safeArea}><Text style={styles.loadingText}>Loading…</Text></SafeAreaView>
      </View>
    );
  }
  if (!league) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safeArea}><Text style={styles.loadingText}>Team not found.</Text></SafeAreaView>
      </View>
    );
  }

  const hasGoal = !!(league.goal_metric && league.goal_target && league.goal_target_date);
  const target = league.goal_target || 0;
  const unit = league.goal_metric ? GOAL_METRIC_UNIT[league.goal_metric] : '';
  const pct = hasGoal && target ? goalProgress / target : 0;
  const daysLeft = hasGoal ? daysUntil(league.goal_target_date!) : 0;
  const realDaysElapsed = (Date.now() - new Date(league.created_at).getTime()) / 86400000;
  const hasPaceData = hasGoal && realDaysElapsed >= 1 && goalProgress > 0;
  const avgPerDay = hasPaceData ? goalProgress / realDaysElapsed : 0;
  const remaining = hasGoal ? Math.max(0, target - goalProgress) : 0;
  const neededPerDay = hasGoal && daysLeft > 0 ? remaining / daysLeft : remaining;
  const paceDeltaPct = hasPaceData && neededPerDay > 0 ? Math.round(((avgPerDay - neededPerDay) / neededPerDay) * 100) : 0;
  // Your own slice of goalProgress — same goalValue()/metric math the team
  // total already uses, just filtered to this account's rows first. A member
  // who's active elsewhere but hasn't logged anything toward THIS goal yet
  // gets a plain 0, same as any other stat tile shows for "nothing yet" — no
  // special copy needed, since this tile only renders inside the hasGoal
  // branch to begin with (the goalless team already has its own separate
  // Effort/Distance/Time stat row below, so "no team goal" isn't a state
  // this tile itself has to handle).
  const myContribution = hasGoal
    ? Math.round(goalActivitiesRaw.filter((a) => a.user_id === currentUserId).reduce((sum, a) => sum + goalValue(a, league.goal_metric as GoalMetric), 0) * 10) / 10
    : 0;

  // Standings show even without an active Team Challenge — ranked by Effort
  // over the selected period (this week, or all time since the team was
  // created) instead of the (nonexistent) goal metric.
  const noGoalSource = noGoalPeriod === 'week' ? weeklyActivitiesRaw : goalActivitiesRaw;
  const standingsMetric: GoalMetric = hasGoal ? (league.goal_metric as GoalMetric) : 'xp';
  const standingsSource = hasGoal ? goalActivitiesRaw : noGoalSource;
  const standingsUnit = hasGoal ? unit : 'effort';
  const goalContributors = (() => {
    const byUser: Record<string, number> = {};
    standingsSource
      .filter(a => matchesStandingsFilter(a.activity_type, standingsFilter))
      .forEach(a => { byUser[a.user_id] = (byUser[a.user_id] || 0) + goalValue(a, standingsMetric); });
    return Object.entries(byUser)
      .map(([userId, value]) => ({ userId, value: Math.round(value * 10) / 10 }))
      .sort((a, b) => b.value - a.value);
  })();
  const topValue = goalContributors[0]?.value || 1;

  const noGoalTeamEffort = Math.round(noGoalSource.reduce((s, a) => s + (a.effort_score || 0), 0) * 10) / 10;
  const noGoalTeamDistanceKm = Math.round((noGoalSource.reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000) * 10) / 10;
  const noGoalTeamDuration = formatDuration(noGoalSource.reduce((s, a) => s + (a.duration_seconds || 0), 0)) || '0 min';

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        {/* Bottom tab pill only (hideBar): the hero owns the top of this page
            with its own back and settings buttons. You arrive here from the
            Teams tab, so Teams stays lit and the tabs stay one tap away. */}
        <RivalTopNav active="teams" hideBar />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} {...pullProps}>
          {pullIndicator}
          <HeroPhoto style={[styles.hero, activeTab === 'Posts' && styles.heroFit]}>
            <View style={[styles.heroScrim, heroScrimWeb]} />

            <View style={styles.header}>
              <RivalBackButton onPress={() => goToTab('/team-feed')} color="#fff" style={styles.backBtn} />
              {isAdmin && (
                <TouchableOpacity style={styles.settingsBtn} onPress={() => router.push({ pathname: '/league-settings', params: { id } })}>
                  <RivalIcon name="settings" size={18} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.headerTitleBlock}>
              {league.logo_url ? (
                <Image source={{ uri: league.logo_url }} style={styles.teamLogo} />
              ) : (
                <View style={styles.teamLogoPlaceholder}>
                  <Text style={styles.teamLogoPlaceholderText}>🏟️</Text>
                </View>
              )}
              <Text style={styles.teamName}>{formatTeamName(league.name)}</Text>
              <Text style={styles.memberCount}>{members.length} {members.length === 1 ? 'member' : 'members'}</Text>
            </View>

            <View style={styles.tabs}>
              {TABS.map((t) => (
                <TouchableOpacity key={t} onPress={() => setActiveTab(t)} style={[styles.tab, activeTab === t && styles.tabActive]}>
                  <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* The Team Challenge ring belongs to Overview, not Posts. On Posts
                this falls through to the Team Board below — which teams WITH a
                challenge never saw before, because the ring took this slot on
                every tab. */}
            {activeTab !== 'Posts' && hasGoal ? (
              <>
                <View style={styles.heroTextBlock}>
                  <Text style={styles.eyebrow}>Team Challenge</Text>
                  <Text style={styles.heroTitle}>{GOAL_METRIC_LABEL[league.goal_metric!]}</Text>
                  <Text style={styles.heroSub}>Since {new Date(league.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · Due {new Date(league.goal_target_date!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</Text>
                </View>
                {/* For admins the ring itself opens the challenge for editing —
                    no separate button. Everyone else sees it as display only. */}
                <TouchableOpacity
                  style={styles.ringWrap}
                  activeOpacity={0.85}
                  disabled={!isAdmin}
                  onPress={() => router.push({ pathname: '/create-team-challenge', params: { id } })}
                  accessibilityLabel={isAdmin ? 'Edit Team Challenge' : undefined}
                >
                  <ChallengeRing pct={pct} value={Math.round(goalProgress)} unit={`/ ${target.toLocaleString()} ${unit}`} />
                </TouchableOpacity>
                <View style={styles.ringMetaRow}>
                  <Text style={styles.ringMeta}><Text style={styles.ringMetaBold}>{Math.round(pct * 100)}%</Text> complete</Text>
                  <Text style={styles.ringMeta}><Text style={styles.ringMetaBold}>{daysLeft > 0 ? daysLeft : 0}</Text> days left</Text>
                </View>
              </>
            ) : activeTab === 'Posts' ? (
              <View style={styles.boardWrap}>
                <View style={styles.boardHeadRow}>
                  <Text style={styles.boardTitle}>Team Board</Text>
                </View>

                {boardComposeOpen && (
                  <View style={[styles.boardComposeCard, warmCardWeb]}>
                    <TextInput
                      style={styles.boardComposeTitleInput}
                      value={boardTitleDraft}
                      onChangeText={setBoardTitleDraft}
                      placeholder="Title (optional)"
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      autoFocus
                    />
                    <View style={styles.boardComposeRule} />
                    <TextInput
                      style={styles.boardComposeBodyInput}
                      value={boardBodyDraft}
                      onChangeText={setBoardBodyDraft}
                      placeholder="Post a Team note"
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      multiline
                    />
                    <View style={styles.boardComposeBtnRow}>
                      <TouchableOpacity
                        style={styles.boardDiscardBtn}
                        onPress={() => { setBoardComposeOpen(false); setBoardTitleDraft(''); setBoardBodyDraft(''); setBoardError(''); }}
                      >
                        <Text style={styles.boardDiscardBtnText}>Discard</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.boardPostBtn, (!boardBodyDraft.trim() || postingBoard) && { opacity: 0.5 }]}
                        onPress={postToBoard}
                        disabled={postingBoard || !boardBodyDraft.trim()}
                      >
                        <BusyText busy={!!(postingBoard)} style={styles.boardPostBtnText}>{postingBoard ? 'Posting…' : 'Post'}</BusyText>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                {!!boardError && <Text style={styles.boardErrorText}>{boardError}</Text>}

                <View style={styles.boardGrid}>
                  {boardPosts.map((p, i) => {
                      const name = memberName(p.user_id);
                      const key = boardTargetKey(p.id);
                      const reactions = boardReactionsMap[key] || [];
                      const comments = boardCommentsMap[key] || [];
                      return (
                        // The whole card is the button. Pin, edit, delete, like
                        // and comments all live in the full-size viewer it opens.
                        <TouchableOpacity
                          key={p.id}
                          activeOpacity={0.85}
                          onPress={() => openNote(p.id)}
                          style={[styles.boardNote, warmCardWeb]}
                          accessibilityLabel={`Open note from ${name}`}
                        >
                          <View style={[styles.boardPin, { backgroundColor: p.pinned ? RivalColors.accentGold : BOARD_PIN_COLORS[i % BOARD_PIN_COLORS.length] }]} />
                          <View style={styles.boardNoteHead}>
                            <RivalAvatar uri={memberAvatar(p.user_id)} name={name} size={24} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={styles.boardNoteName} numberOfLines={1}>{name}</Text>
                              <Text style={styles.boardNoteTime}>{timeAgo(p.created_at)}</Text>
                            </View>
                          </View>
                          {!!p.title && (
                            <>
                              <Text style={styles.boardNoteTitle}>{p.title}</Text>
                              <View style={styles.boardNoteTitleRule} />
                            </>
                          )}
                          {/* A preview: the full note opens on tap. */}
                          <Text style={styles.boardNoteBody} numberOfLines={4}>{p.body}</Text>
                          <View style={styles.boardNoteFoot}>
                            <View style={styles.boardNoteStat}>
                              <RivalIcon name="chat" size={13} color="rgba(255,255,255,0.5)" />
                              <Text style={styles.boardNoteStatText}>{comments.length}</Text>
                            </View>
                            <View style={styles.boardNoteStat}>
                              <RivalIcon name="starOutline" size={13} color="rgba(255,255,255,0.5)" />
                              <Text style={styles.boardNoteStatText}>{reactions.length}</Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  {!boardComposeOpen && (
                    <TouchableOpacity style={styles.boardAddNote} onPress={() => setBoardComposeOpen(true)}>
                      <RivalIcon name="add" size={14} color="rgba(255,255,255,0.6)" />
                      <Text style={styles.boardAddNoteText}>Pin Note</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : (
              <View style={styles.heroTextBlockNoGoal}>
                {isAdmin && (
                  <TouchableOpacity style={styles.startChallengeBtn} onPress={() => router.push({ pathname: '/create-team-challenge', params: { id } })}>
                    <RivalIcon name="target" size={16} color={RivalColors.accentText} />
                    <Text style={styles.startChallengeBtnText}>Start a Team Challenge</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </HeroPhoto>

          <View style={styles.body}>
            {activeTab === 'Overview' && (
              <>
                {league.description ? <Text style={styles.teamAbout}>{league.description}</Text> : null}
                {hasGoal && (
                  <>
                    <View style={[styles.paceCard, paceCardWeb]}>
                      <View style={styles.paceIcon}>
                        <RivalIcon name="bolt" size={18} color={RivalColors.accentText} />
                      </View>
                      <View style={{ flex: 1 }}>
                        {!hasPaceData ? (
                          <>
                            <Text style={styles.paceTitle}>Challenge started</Text>
                            <Text style={styles.paceSub}>Every logged activity counts toward the goal.</Text>
                          </>
                        ) : paceDeltaPct >= 0 ? (
                          <>
                            <Text style={styles.paceTitle}>On pace</Text>
                            <Text style={styles.paceSub}>
                              <Text style={styles.paceSubBold}>{paceDeltaPct}% ahead</Text> of the pace needed to hit the goal.
                            </Text>
                          </>
                        ) : (
                          <>
                            <Text style={styles.paceTitle}>Behind pace</Text>
                            <Text style={styles.paceSub}>
                              Needs <Text style={styles.paceSubBold}>{(Math.round(neededPerDay * 10) / 10).toLocaleString()} {unit}/day</Text> to hit the goal.
                            </Text>
                          </>
                        )}
                      </View>
                      {hasPaceData && <RivalIcon name={paceDeltaPct >= 0 ? 'trendUp' : 'trendDown'} size={22} color={RivalColors.accentFill} />}
                    </View>

                    <View style={styles.statRow}>
                      <View style={[styles.statCard, warmCardWeb]}>
                        <RivalIcon name="stats" size={16} color={RivalColors.accentText} style={styles.statIcon} />
                        <Text style={styles.statVal}>{hasPaceData ? (Math.round(avgPerDay * 10) / 10).toLocaleString() : '—'}</Text>
                        <Text style={styles.statLbl}>{unit.toUpperCase()}/DAY{'\n'}TEAM AVG</Text>
                      </View>
                      <View style={[styles.statCard, warmCardWeb]}>
                        <RivalIcon name="schedule" size={16} color={RivalColors.accentText} style={styles.statIcon} />
                        <Text style={styles.statVal}>{(Math.round(remaining * 10) / 10).toLocaleString()}</Text>
                        <Text style={styles.statLbl}>{unit.toUpperCase()} TO GO</Text>
                      </View>
                      <View style={[styles.statCard, warmCardWeb]}>
                        <RivalIcon name="person" size={16} color={RivalColors.accentText} style={styles.statIcon} />
                        <Text style={styles.statVal}>{myContribution.toLocaleString()}</Text>
                        <Text style={styles.statLbl}>{unit.toUpperCase()}{'\n'}CONTRIBUTED</Text>
                      </View>
                    </View>
                  </>
                )}

                {!hasGoal && (
                  <>
                    <View style={styles.periodToggleRow}>
                      {(['week', 'alltime'] as const).map((p) => (
                        <TouchableOpacity
                          key={p}
                          style={[styles.periodToggleBtn, noGoalPeriod === p ? [styles.periodToggleBtnActive, chipActiveWeb] : warmCardWeb]}
                          onPress={() => setNoGoalPeriod(p)}
                        >
                          <Text style={[styles.periodToggleText, noGoalPeriod === p && styles.periodToggleTextActive]}>
                            {p === 'week' ? 'This Week' : 'All Time'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.statRow}>
                      <View style={[styles.statCard, warmCardWeb]}>
                        <RivalIcon name="stats" size={16} color={RivalColors.accentText} style={styles.statIcon} />
                        <Text style={styles.statVal}>{noGoalTeamEffort.toLocaleString()}</Text>
                        <Text style={styles.statLbl}>EFFORT{'\n'}{noGoalPeriod === 'week' ? 'THIS WEEK' : 'ALL TIME'}</Text>
                      </View>
                      <View style={[styles.statCard, warmCardWeb]}>
                        <RivalIcon name="run" size={16} color={RivalColors.accentText} style={styles.statIcon} />
                        <Text style={styles.statVal}>{noGoalTeamDistanceKm.toLocaleString()}</Text>
                        <Text style={styles.statLbl}>KM{'\n'}{noGoalPeriod === 'week' ? 'THIS WEEK' : 'ALL TIME'}</Text>
                      </View>
                      <View style={[styles.statCard, warmCardWeb]}>
                        <RivalIcon name="schedule" size={16} color={RivalColors.accentText} style={styles.statIcon} />
                        <Text style={styles.statVal}>{noGoalTeamDuration}</Text>
                        <Text style={styles.statLbl}>TIME{'\n'}{noGoalPeriod === 'week' ? 'THIS WEEK' : 'ALL TIME'}</Text>
                      </View>
                    </View>
                  </>
                )}

                <View style={styles.chipRow}>
                  {STANDINGS_FILTERS.map(({ key, icon }) => {
                    const active = standingsFilter === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.chip, active ? [styles.chipActive, chipActiveWeb] : warmCardWeb]}
                        onPress={() => setStandingsFilter(key)}
                      >
                        <RivalIcon name={icon} size={17} color={active ? '#fff' : 'rgba(255,255,255,0.45)'} />
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {goalContributors.length > 0 && (
                  <>
                    <View style={styles.sectionHead}>
                      <Text style={styles.sectionTitle}>{hasGoal ? 'Top Contributors' : noGoalPeriod === 'week' ? "This Week's Standings" : 'All-Time Standings'}</Text>
                    </View>
                    <View style={[styles.card, warmCardWeb]}>
                      {goalContributors.slice(0, 5).map((c, i) => {
                        const name = memberName(c.userId);
                        return (
                          <TouchableOpacity
                            key={c.userId}
                            style={[styles.contribRow, i === Math.min(4, goalContributors.length - 1) && { borderBottomWidth: 0 }]}
                            onPress={() => router.push(`/stats?userId=${c.userId}` as any)}
                          >
                            <Text style={styles.rankNum}>{i + 1}</Text>
                            <View style={styles.avatarWrap}>
                              {i === 0 && (
                                <View style={styles.crownWrap}>
                                  <RivalIcon name="crown" size={16} color={RivalColors.accentGold} />
                                </View>
                              )}
                              <RivalAvatar uri={memberAvatar(c.userId)} name={name} size={34} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[styles.contribName, i === 0 && styles.gold, c.userId === currentUserId && styles.accentText]}>
                                {name}
                              </Text>
                              <View style={styles.barBg}>
                                <View style={[styles.barFill, barFillWeb, { width: `${(c.value / topValue) * 100}%` }]} />
                              </View>
                            </View>
                            <Text style={[styles.contribKm, i === 0 && styles.gold, c.userId === currentUserId && styles.accentText]}>{c.value.toLocaleString()} {standingsUnit}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {/* The way into Plan Your Week. It used to live only on the old
                    team page, under its leaderboard — without this link the
                    page would be unreachable once that page is retired. */}
                <TouchableOpacity style={[styles.planWeekLink, warmCardWeb]} onPress={() => router.push('/plan')}>
                  <RivalIcon name="stats" size={18} color={RivalColors.accentText} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.planWeekTitle}>Weekly plan</Text>
                    <Text style={styles.planWeekSub}>Projected standings for the week.</Text>
                  </View>
                  <RivalIcon name="chevronRight" size={18} color={RivalColors.textSecondary} />
                </TouchableOpacity>

                {/* Above Recent Activity on purpose: what the team is about to
                    do is more actionable than what it already did. */}
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Upcoming</Text>
                  <TouchableOpacity style={styles.planBtn} onPress={() => setPlanning(true)}>
                    <RivalIcon name="calendar" size={14} color={RivalColors.accentText} />
                    <Text style={styles.planBtnText}>Plan activity</Text>
                  </TouchableOpacity>
                </View>
                {sessions.length === 0 ? (
                  <Text style={styles.emptyText}>No activities planned.</Text>
                ) : (
                  <View style={{ gap: 10 }}>
                    {sessions.map((sn) => (
                      <SessionCard
                        key={sn.id}
                        session={sn}
                        attendeeIds={sessionRsvps[sn.id] || []}
                        currentUserId={currentUserId}
                        nameFor={memberName}
                        compact
                        locationCopied={copiedId === sn.id}
                        onCopyLocation={() => copyLocation(sn.id, sn.location ?? '')}
                        onEdit={() => { setEditingSession(sn); setPlanning(true); }}
                        onToggleRsvp={() => toggleSessionRsvp(sn.id)}
                      />
                    ))}
                  </View>
                )}

                {/* Coming Up deliberately shows only the next three — a hub is
                    a summary, not a diary. This is the way through to the rest,
                    including everything already done, and it appears whenever
                    there IS more than the three above (or any history at all,
                    even with nothing upcoming). */}
                {sessionTotal > sessions.length && (
                  <TouchableOpacity
                    style={styles.seeAllRow}
                    onPress={() => router.push({ pathname: '/team-sessions', params: { id } })}
                  >
                    <Text style={styles.seeAllText}>
                      See all {sessionTotal} planned {sessionTotal === 1 ? 'Activity' : 'Activities'}
                    </Text>
                    <RivalIcon name="chevronRight" size={16} color={RivalColors.accentText} />
                  </TouchableOpacity>
                )}

                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Recent activity</Text>
                </View>
                {recentActivity.length === 0 ? (
                  <Text style={styles.emptyText}>No activity yet.</Text>
                ) : (
                  <View style={[styles.card, warmCardWeb]}>
                    {recentActivity.map((a, i) => {
                      const name = memberName(a.user_id);
                      const dist = formatDistance(a.distance_meters, a.activity_type);
                      return (
                        <View key={a.id} style={[styles.activityRow, i === recentActivity.length - 1 && { borderBottomWidth: 0 }]}>
                          <RivalAvatar uri={memberAvatar(a.user_id)} name={name} size={34} />
                          {/* Two lines that each fit the row: who and when, then what.
                              One run-on sentence ran past the card's edge. */}
                          <View style={styles.activityBody}>
                            <View style={styles.activityTop}>
                              <Text style={[styles.activityText, styles.activityName, styles.activityShrink]} numberOfLines={1}>{name}</Text>
                              <Text style={styles.activityTime}>{timeAgo(a.started_at)}</Text>
                            </View>
                            <Text style={styles.activityWhat} numberOfLines={1}>
                              {a.name || a.activity_type}{dist ? ` · ${dist}` : ''}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            {activeTab === 'Posts' && (
              feedActivity.length === 0 ? (
                <Text style={styles.emptyText}>No activity yet.</Text>
              ) : (
                <View style={{ gap: 20 }}>
                  {feedActivity.map((a) => {
                    const key = feedTargetKey(a.id);
                    return (
                      <ActivityPostCard
                        key={a.id}
                        activity={a}
                        name={memberName(a.user_id)}
                        avatarUrl={memberAvatar(a.user_id)}
                        currentUserId={currentUserId}
                        reactions={reactionsMap[key] || []}
                        comments={commentsMap[key] || []}
                        isCommentsOpen={expandedComments.has(key)}
                        onToggleComments={() => toggleComments(key)}
                        commentDraft={commentDrafts[key] || ''}
                        onChangeCommentDraft={(v) => setCommentDrafts(prev => ({ ...prev, [key]: v }))}
                        onPostComment={() => postComment(a.id)}
                        onReact={(emoji) => toggleReaction(a.id, emoji)}
                        onDeleted={() => setFeedActivity(prev => prev.filter(it => it.id !== a.id))}
                        nameForUser={memberName}
                      />
                    );
                  })}
                </View>
              )
            )}

            {activeTab === 'Challenges' && (
              <TeamChallengesTab
                leagueId={id as string}
                teamName={formatTeamName(league.name)}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                nameFor={memberName}
                refreshKey={challengesRefresh}
                teamGoal={league.goal_metric && league.goal_target && league.goal_target_date ? {
                  title: GOAL_METRIC_LABEL[league.goal_metric],
                  detail: `${league.goal_target.toLocaleString()} ${GOAL_METRIC_UNIT[league.goal_metric]} · Due ${new Date(league.goal_target_date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`,
                } : null}
                onEditTeamGoal={() => router.push({ pathname: '/create-team-challenge', params: { id } })}
                onEndTeamGoal={endTeamGoal}
              />
            )}

            {activeTab === 'Members' && (
              <View style={{ gap: 18 }}>
                {!!league.invite_code && (
                  <View style={[styles.inviteCard, warmCardWeb]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.inviteLabel}>INVITE CODE</Text>
                      <Text style={styles.inviteCode} selectable>{league.invite_code}</Text>
                      <Text style={styles.inviteSub}>Share this code to invite new teammates.</Text>
                    </View>
                    <TouchableOpacity style={styles.inviteBtn} onPress={copyInviteCode} accessibilityLabel="Copy invite code">
                      <Text style={styles.inviteBtnText}>{codeCopied ? 'Copied' : 'Copy'}</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <WeeklyStandings
                  members={members}
                  currentUserId={currentUserId}
                  encouragedIds={encouragedIds}
                  onOpenProfile={openProfile}
                  onEncourage={(uid, name) => setEncourageTarget({ id: uid, name })}
                  onChallenge={(uid, name) => setChallengeTarget({ id: uid, name })}
                />

                <TouchableOpacity style={styles.leaveBtn} onPress={leaveTeam}>
                  <Text style={styles.leaveText}>Leave Team</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {(() => {
        const note = boardPosts.find(bp => bp.id === openNoteId);
        if (!note) return null;
        const key = boardTargetKey(note.id);
        const reactions = boardReactionsMap[key] || [];
        const comments = boardCommentsMap[key] || [];
        const iLiked = currentUserId ? reactions.some(r => r.user_id === currentUserId) : false;
        const mine = note.user_id === currentUserId;
        const name = memberName(note.user_id);
        const draft = boardCommentDrafts[key] || '';
        // Latest two by default. Comments load oldest-first, so slice from the end.
        const shownComments = noteCommentsExpanded ? comments : comments.slice(-2);
        const canExpand = comments.length > 2;
        return (
          <Modal visible transparent animationType="fade" onRequestClose={closeNote}>
            <View style={styles.noteBackdrop}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeNote} />
              <View style={[styles.noteSheet, warmCardWeb]}>
                <View style={styles.noteHead}>
                  <RivalAvatar uri={memberAvatar(note.user_id)} name={name} size={34} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.noteName}>{name}</Text>
                    <Text style={styles.noteTime}>
                      {timeAgo(note.created_at)}{note.pinned ? '  ·  Pinned' : ''}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={closeNote} style={styles.noteClose} accessibilityLabel="Close note">
                    <RivalIcon name="close" size={20} color="rgba(255,255,255,0.7)" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {editingNote ? (
                    <View style={{ gap: 10 }}>
                      <TextInput
                        style={styles.noteTitleInput}
                        value={noteTitleDraft}
                        onChangeText={setNoteTitleDraft}
                        placeholder="Title"
                        placeholderTextColor="rgba(255,255,255,0.35)"
                      />
                      <TextInput
                        style={styles.noteBodyInput}
                        value={noteBodyDraft}
                        onChangeText={setNoteBodyDraft}
                        placeholder="Message"
                        placeholderTextColor="rgba(255,255,255,0.35)"
                        multiline
                        autoFocus
                      />
                    </View>
                  ) : (
                    <>
                      {/* The note itself, in its own bordered panel. For the
                          author the panel IS the edit control — no separate
                          Edit button competing with the actions below. */}
                      <TouchableOpacity
                        style={styles.noteContent}
                        activeOpacity={mine ? 0.8 : 1}
                        disabled={!mine}
                        onPress={() => startEditingNote(note)}
                        accessibilityLabel={mine ? 'Edit note' : undefined}
                      >
                        {!!note.title && <Text style={styles.noteTitle}>{note.title}</Text>}
                        <Text style={styles.noteBody} selectable={!mine}>{note.body}</Text>
                        {mine && <Text style={styles.noteEditHint}>Tap to edit</Text>}
                      </TouchableOpacity>

                      <View style={styles.noteStatsRow}>
                        <TouchableOpacity style={styles.noteStatBtn} onPress={() => toggleBoardLike(note.id)} accessibilityLabel={iLiked ? 'Remove like' : 'Like note'}>
                          <RivalIcon name={iLiked ? 'star' : 'starOutline'} size={20} color={iLiked ? RivalColors.accentGold : 'rgba(255,255,255,0.6)'} />
                          <Text style={[styles.noteStatText, iLiked && { color: RivalColors.accentGold }]}>{reactions.length}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.noteStatBtn}
                          onPress={() => setNoteCommentsExpanded(v => !v)}
                          disabled={!canExpand}
                          accessibilityLabel={noteCommentsExpanded ? 'Show fewer comments' : `Show all ${comments.length} comments`}
                        >
                          <RivalIcon name="chat" size={20} color={noteCommentsExpanded ? RivalColors.accentText : 'rgba(255,255,255,0.6)'} />
                          <Text style={[styles.noteStatText, noteCommentsExpanded && { color: RivalColors.accentText }]}>{comments.length}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Comments in their own panel, one per row with a hairline
                          between. Name on its own line and the comment beneath
                          it, so a one-word comment doesn't hang off the name. */}
                      <View style={styles.noteComments}>
                        {shownComments.map((c, idx) => (
                          <View key={c.id} style={[styles.noteComment, idx > 0 && styles.noteCommentDivided]}>
                            <Text style={styles.noteCommentName}>{memberName(c.user_id)}</Text>
                            <Text style={styles.noteCommentBody}>{c.body}</Text>
                          </View>
                        ))}
                        <View style={[styles.noteCommentInputRow, shownComments.length > 0 && styles.noteCommentDivided]}>
                          <TextInput
                            style={styles.noteCommentInput}
                            value={draft}
                            onChangeText={(v) => setBoardCommentDrafts(prev => ({ ...prev, [key]: v }))}
                            placeholder="Add a comment"
                            placeholderTextColor="rgba(255,255,255,0.35)"
                            onSubmitEditing={() => postBoardComment(note.id)}
                          />
                          <TouchableOpacity
                            style={styles.noteCommentSend}
                            onPress={() => postBoardComment(note.id)}
                            disabled={!draft.trim()}
                            accessibilityLabel="Post comment"
                          >
                            {/* The word, not a paper plane: the plane reads as a
                                private message, and this comment is public. */}
                            <Text style={[styles.commentSendText, !draft.trim() && { opacity: 0.4 }]}>Post</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </>
                  )}
                </ScrollView>

                {/* A divider and real spacing between the comment box and these
                    buttons, so Delete can't be hit on the way to Post. */}
                <View style={styles.noteActionsDivider} />
                <View style={styles.noteActions}>
                  {editingNote ? (
                    <>
                      <TouchableOpacity style={styles.noteActionBtn} onPress={() => setEditingNote(false)}>
                        <Text style={styles.noteActionText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.noteActionBtn, styles.noteActionPrimary]} onPress={saveNoteEdit} disabled={savingNote}>
                        <BusyText busy={!!(savingNote)} style={styles.noteActionPrimaryText}>{savingNote ? 'Saving…' : 'Save'}</BusyText>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity style={styles.noteActionBtn} onPress={() => togglePinBoardPost(note.id, note.pinned)}>
                        <RivalIcon name="pin" size={16} color={note.pinned ? RivalColors.accentGold : 'rgba(255,255,255,0.8)'} />
                        <Text style={styles.noteActionText}>{note.pinned ? 'Unpin' : 'Pin to top'}</Text>
                      </TouchableOpacity>
                      {mine && (
                        <TouchableOpacity style={styles.noteActionBtn} onPress={() => deleteBoardPost(note.id)}>
                          <RivalIcon name="delete" size={16} color="#ff9b8f" />
                          <Text style={[styles.noteActionText, { color: '#ff9b8f' }]}>Delete</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              </View>
            </View>
          </Modal>
        );
      })()}

      <EncourageSheet
        visible={!!encourageTarget}
        toUser={encourageTarget}
        onClose={() => setEncourageTarget(null)}
        onSent={(uid) => setEncouragedIds(prev => new Set(prev).add(uid))}
      />
      <ChallengeTeammateSheet
        visible={!!challengeTarget}
        leagueId={id as string}
        currentUserId={currentUserId}
        opponent={challengeTarget}
        onClose={() => setChallengeTarget(null)}
        onSent={() => setChallengesRefresh(n => n + 1)}
      />

      <PlanSessionSheet
        visible={planning}
        leagueId={id as string}
        currentUserId={currentUserId}
        editing={editingSession}
        onClose={() => { setPlanning(false); setEditingSession(null); }}
        onPosted={loadSessions}
      />
    </View>
  );
}

// Same post card as team-feed.tsx's PostCard, minus the multi-team tag
// (this feed is already scoped to one team) and the race-signup variant
// (this tab only ever shows activities).
function ActivityPostCard({
  activity: a, name, avatarUrl, currentUserId, reactions, comments, nameForUser,
  isCommentsOpen, onToggleComments, commentDraft, onChangeCommentDraft, onPostComment, onReact, onDeleted,
}: {
  activity: ActivityRow;
  name: string;
  avatarUrl: string | null;
  currentUserId: string;
  reactions: Array<{ user_id: string; emoji: string }>;
  comments: Array<{ id: string; user_id: string; body: string; created_at: string }>;
  nameForUser: (userId: string) => string;
  isCommentsOpen: boolean;
  onToggleComments: () => void;
  commentDraft: string;
  onChangeCommentDraft: (v: string) => void;
  onPostComment: () => void;
  onReact: (emoji: 'respect' | 'inspired') => void;
  onDeleted: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteThisActivity() {
    if (!(await confirmAction({ title: 'Delete this activity?', message: "This can't be undone.", confirmLabel: 'Delete', destructive: true }))) return;
    setMenuOpen(false);
    setDeleting(true);
    const { error, count } = await supabase.from('activities').delete({ count: 'exact' }).eq('id', a.id);
    if (error || !count) {
      setDeleting(false);
      if (Platform.OS === 'web') window.alert(error ? `Delete failed: ${error.message}` : 'The activity could not be deleted. Try again.');
      return;
    }
    // Stays in the deleting state until the post is removed, so it never
    // flickers back to normal first.
    onDeleted();
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

  const tint = tintFor(name);
  const isPb = !!a.pbLift || a.insight?.tone === 'record';
  const accentColor = isPb ? RivalColors.rankAnchors.unrivaled : RivalColors.accentFill;
  const myReaction = reactions.find((r) => r.user_id === currentUserId)?.emoji;
  const respectCount = reactions.filter((r) => r.emoji === 'respect').length;
  const inspiredCount = reactions.filter((r) => r.emoji === 'inspired').length;
  const displayedName = name;
  const initials = name.slice(0, 2).toUpperCase();

  let badge: { icon: RivalIconName; label: string; color: string } | null = null;
  if (a.pbLift) badge = { icon: 'trophy', label: `New PB — ${a.pbLift}`, color: RivalColors.rankAnchors.unrivaled };
  else if (a.insight) badge = { icon: INSIGHT_ICON[a.insight.tone], label: a.insight.text, color: INSIGHT_COLOR[a.insight.tone] };

  const dist = formatDistance(a.distance_meters, a.activity_type);
  const statsLine = [dist, formatDuration(a.duration_seconds)].filter(Boolean).join(' · ');

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
        <TouchableOpacity onPress={() => router.push(`/stats?userId=${a.user_id}` as any)} style={[styles.postAvatar, { backgroundColor: tint.bg, borderColor: tint.color }]}>
          {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.postAvatarImg} /> : <Text style={[styles.postAvatarText, { color: tint.color }]}>{initials}</Text>}
        </TouchableOpacity>
        {/* The name opens their profile too, not just the small avatar. */}
        <TouchableOpacity style={{ flex: 1, minWidth: 0 }} activeOpacity={0.7} onPress={() => router.push(`/stats?userId=${a.user_id}` as any)}>
          <Text style={styles.postName}>{displayedName}</Text>
          <Text style={styles.postMeta}>{a.name || a.activity_type} · {timeAgo(a.started_at)}</Text>
        </TouchableOpacity>
        {a.user_id === currentUserId && (
          <View style={styles.postMoreWrap}>
            <TouchableOpacity style={styles.postMoreBtn} onPress={() => setMenuOpen(v => !v)} disabled={deleting}>
              <RivalIcon name="more" size={20} color={RivalColors.textSecondary} />
            </TouchableOpacity>
            {menuOpen && (
              <>
                <TouchableOpacity style={styles.postMoreBackdrop} onPress={() => setMenuOpen(false)} />
                <View style={styles.postMoreMenu}>
                  <TouchableOpacity style={styles.postMoreMenuItem} onPress={() => { setMenuOpen(false); router.push(`/manual-entry?editId=${a.id}` as any); }}>
                    <RivalIcon name="edit" size={16} color={RivalColors.onSurface} />
                    <Text style={styles.postMoreMenuText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.postMoreMenuItem} onPress={() => { setMenuOpen(false); router.push(`/ai-share?activityId=${a.id}` as any); }}>
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

      {a.photo_url ? (
        <View style={[styles.postPhotoWrap, isPb && styles.postPhotoWrapPb]}>
          <Image source={{ uri: a.photo_url }} style={styles.postPhoto} />
        </View>
      ) : (
        <View style={styles.noPhotoPanel}>
          <RivalIcon name={activityIconName(a.activity_type)} size={28} color={RivalColors.accentText} />
          <Text style={styles.noPhotoBody}>No photo added</Text>
        </View>
      )}

      <View style={styles.postFooterRow}>
        {badge ? (
          <View style={styles.badgeLine}>
            <RivalIcon name={badge.icon} size={13} color={badge.color} />
            <Text style={[styles.badgeLineText, { color: badge.color }]} numberOfLines={1}>{badge.label}</Text>
          </View>
        ) : (
          <Text style={styles.statsLine}>{statsLine || '—'}</Text>
        )}
        {a.effort_score ? (
          <View style={styles.effortLine}>
            <Text style={[styles.effortNum, isPb && { color: RivalColors.rankAnchors.unrivaled }]}>{Math.round(a.effort_score * 10) / 10}</Text>
            <Text style={styles.effortUnit}>Effort</Text>
          </View>
        ) : null}
      </View>
      {badge && statsLine ? <Text style={styles.statsLine}>{statsLine}</Text> : null}

      {a.notes ? <Text style={styles.caption}>{a.notes}</Text> : null}

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
              <Text style={styles.commentAuthor}>{nameForUser(c.user_id)}</Text>
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

const CARD_BG = '#2a211d';
const CARD_BORDER = 'rgba(255,181,158,0.14)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  safeArea: { flex: 1 },
  loadingText: { color: RivalColors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 60 },
  hero: { paddingBottom: 24, minHeight: 560 },
  // The 560 floor is sized for the Team Challenge ring. Posts shows the much
  // shorter Team Board in that slot, so there the hero hugs its content —
  // otherwise the floor leaves a screen-height gap before the first post.
  heroFit: { minHeight: 0 },
  heroScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,8,7,0.35)' },

  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(20,20,20,0.55)', alignItems: 'center', justifyContent: 'center' },
  settingsBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(20,20,20,0.55)', alignItems: 'center', justifyContent: 'center' },

  headerTitleBlock: { alignItems: 'center', marginTop: 10, paddingHorizontal: 20 },
  teamLogo: { width: 112, height: 112, borderRadius: 32, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  teamLogoPlaceholder: { width: 112, height: 112, borderRadius: 32, marginBottom: 8, backgroundColor: 'rgba(20,20,20,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  teamLogoPlaceholderText: { fontSize: 24 },
  teamName: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 24, color: '#fff', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  memberCount: { fontSize: 13, color: '#d8d4d2', marginTop: 2, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },

  tabs: { flexDirection: 'row', gap: 4, backgroundColor: 'rgba(20,20,20,0.55)', borderRadius: 14, padding: 4, marginHorizontal: 20, marginTop: 14 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: 'rgba(50,50,50,0.9)' },
  tabText: { fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  tabTextActive: { color: '#fff' },

  heroTextBlock: { alignItems: 'center', marginTop: 20, paddingHorizontal: 20 },
  heroTextBlockNoGoal: { alignItems: 'center', marginTop: 32, paddingHorizontal: 20 },
  boardWrap: { marginTop: 24, paddingHorizontal: 20, gap: 10 },
  boardHeadRow: { alignItems: 'center' },
  boardTitle: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 20, color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  // 60% of the original tile (48.5% wide, 150 tall). The label is 13px, not
  // scaled down with the tile — thin serif italic is hard to read any smaller.
  boardAddNote: { width: '29%', minHeight: 90, alignSelf: 'flex-start', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center', gap: 4 },
  boardAddNoteText: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '500', fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  boardComposeCard: { backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: 14, padding: 14, gap: 4 },
  boardComposeTitleInput: { color: RivalColors.accentText, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', paddingVertical: 4 },
  boardComposeRule: {
    alignSelf: 'flex-start', width: 60, height: 1, marginTop: 2, marginBottom: 8,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, rgba(217,119,87,0) 0%, rgba(217,119,87,0.6) 25%, rgba(217,119,87,0.6) 75%, rgba(217,119,87,0) 100%)' } as any : { backgroundColor: 'rgba(217,119,87,0.6)' }),
  },
  boardComposeBodyInput: { fontFamily: SERIF, fontStyle: 'italic', color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 20, minHeight: 50, textAlignVertical: 'top', paddingVertical: 0 },
  boardComposeBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  boardDiscardBtn: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  boardDiscardBtnText: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
  boardPostBtn: { backgroundColor: 'rgba(217,119,87,0.18)', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(217,119,87,0.35)' },
  boardPostBtnText: { color: RivalColors.accentText, fontSize: 11, fontWeight: '700' },
  boardErrorText: { fontSize: 12, color: '#ff8a8a', textAlign: 'center' },

  // flex-start with a fixed gap, not space-between: space-between pushed a
  // lone Pin Note tile to the far edge, leaving a hole beside the note. Two
  // notes (48.5% + 3% + 48.5%) still fill the row exactly.
  planWeekLink: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18,
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER,
  },
  planWeekTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  planWeekSub: { fontSize: 12.5, color: RivalColors.textSecondary, marginTop: 1 },
  inviteCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20,
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER,
  },
  inviteLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: RivalColors.accentText },
  inviteCode: { fontSize: 24, fontWeight: '800', letterSpacing: 3, color: '#fff', marginTop: 2 },
  inviteSub: { fontSize: 12.5, color: RivalColors.textSecondary, marginTop: 2 },
  inviteBtn: {
    minWidth: 84, minHeight: 44, paddingHorizontal: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  },
  inviteBtnText: { fontSize: 14, fontWeight: '800', color: RivalButtonColors.label(RivalColors.surfaceLowest) },
  leaveBtn: {
    minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,155,143,0.35)',
  },
  leaveText: { fontSize: 14, fontWeight: '700', color: '#ff9b8f' },
  noteBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: 18 },
  noteSheet: {
    backgroundColor: '#1f1b19', borderRadius: 22, borderWidth: 1, borderColor: CARD_BORDER,
    padding: 18, gap: 14, maxHeight: '86%',
  },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  noteTime: { fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 1 },
  // 44px: the smallest target a thumb hits reliably.
  noteClose: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  noteTitle: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 22, color: '#fff' },
  noteBody: { fontFamily: SERIF, fontStyle: 'italic', fontSize: 17, lineHeight: 26, color: 'rgba(255,255,255,0.92)' },
  noteContent: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16, padding: 14, gap: 8,
  },
  noteEditHint: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  noteStatsRow: { flexDirection: 'row', gap: 18, paddingHorizontal: 4 },
  noteComments: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.18)', paddingHorizontal: 14,
  },
  noteComment: { paddingVertical: 11, gap: 3 },
  noteCommentDivided: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  noteCommentName: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  noteActionsDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 4 },
  noteStatBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  noteStatText: { fontSize: 15, color: 'rgba(255,255,255,0.7)' },
  noteCommentBody: { fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 20 },
  noteCommentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  noteCommentInput: {
    flex: 1, minWidth: 0, minHeight: 44, borderRadius: 22, paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff',
    // 16 is the floor iOS Safari zooms below on focus.
    fontSize: 16,
  },
  noteCommentSend: { minWidth: 44, height: 44, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  noteTitleInput: {
    fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#fff',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  noteBodyInput: {
    fontFamily: SERIF, fontStyle: 'italic', fontSize: 16, lineHeight: 24, color: '#fff', minHeight: 140,
    textAlignVertical: 'top', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  noteActions: { flexDirection: 'row', gap: 10 },
  noteActionBtn: {
    flex: 1, minHeight: 48, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  noteActionText: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  noteActionPrimary: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: RivalButtonColors.fill },
  noteActionPrimaryText: { fontSize: 14, fontWeight: '800', color: RivalButtonColors.label(RivalColors.surfaceLowest) },
  boardGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', columnGap: '3%', rowGap: 10 },
  boardNote: { width: '48.5%', backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: 16, padding: 10, gap: 4, position: 'relative' },
  boardPin: { position: 'absolute', top: -5, left: '50%', marginLeft: -5, width: 10, height: 10, borderRadius: 5 },
  boardNoteHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  boardNoteName: { fontSize: 11.5, fontWeight: '700', color: '#fff' },
  boardNoteTime: { fontSize: 9.5, color: 'rgba(255,255,255,0.4)' },
  boardNoteTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: RivalColors.accentText },
  boardNoteTitleRule: {
    alignSelf: 'flex-start', width: 44, height: 1, marginTop: 4, marginBottom: 2,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, rgba(217,119,87,0) 0%, rgba(217,119,87,0.6) 25%, rgba(217,119,87,0.6) 75%, rgba(217,119,87,0) 100%)' } as any : { backgroundColor: 'rgba(217,119,87,0.6)' }),
  },
  boardNoteBody: { fontFamily: SERIF, fontStyle: 'italic', fontSize: 12.5, color: 'rgba(255,255,255,0.85)', lineHeight: 17 },
  boardNoteFoot: { flexDirection: 'row', gap: 12, marginTop: 2 },
  boardNoteStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  boardNoteStatText: { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  boardCommentsBlock: { gap: 6, marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  boardCommentRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  boardCommentAuthor: { fontSize: 10.5, fontWeight: '700', color: RivalColors.accentText },
  boardCommentBody: { fontSize: 10.5, color: 'rgba(255,255,255,0.75)', flexShrink: 1 },
  boardCommentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  boardCommentInput: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, color: '#fff', fontSize: 10.5, borderWidth: 1, borderColor: CARD_BORDER },
  startChallengeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(20,20,20,0.55)', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: `${RivalColors.accentText}55` },
  startChallengeBtnText: { fontSize: 13.5, fontWeight: '700', color: '#fff' },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: RivalColors.accentText, textTransform: 'uppercase', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  heroTitle: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 24, color: '#fff', marginTop: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },

  ringWrap: { alignItems: 'center', marginTop: 20 },
  ringValue: { fontSize: 38, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  ringTarget: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },

  ringMetaRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 20 },
  ringMeta: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  ringMetaBold: { fontWeight: '800', color: '#fff' },

  scroll: { flex: 1 },
  // Clears the floating tab pill so the last card never sits under it —
  // same clearance team-feed.tsx uses.
  scrollContent: { paddingBottom: 120 },
  body: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },

  paceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(217,119,87,0.1)', borderWidth: 1, borderColor: 'rgba(217,119,87,0.25)',
    borderRadius: 18, padding: 14,
  },
  paceIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(217,119,87,0.22)', alignItems: 'center', justifyContent: 'center' },
  paceTitle: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: '#fff' },
  paceSub: { fontSize: 12.5, color: RivalColors.onSurfaceVariant, marginTop: 2 },
  paceSubBold: { fontWeight: '800', color: '#fff' },

  statRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center' },
  statIcon: { marginBottom: 8 },
  statVal: { fontSize: 19, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  statLbl: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 10, letterSpacing: 0.4, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', textAlign: 'center', marginTop: 4 },

  chipRow: { flexDirection: 'row', gap: 8 },
  periodToggleRow: { flexDirection: 'row', gap: 8 },
  periodToggleBtn: { flex: 1, borderRadius: 12, paddingVertical: 9, alignItems: 'center', backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER },
  periodToggleBtnActive: { borderColor: 'transparent' },
  periodToggleText: { fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  periodToggleTextActive: { color: '#fff' },
  chip: { width: 38, height: 38, borderRadius: 12, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: RivalColors.accentFill, borderColor: 'transparent' },

  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: `${RivalColors.accentFill}1f`,
    borderWidth: 1, borderColor: `${RivalColors.accentFill}44`,
  },
  planBtnText: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  seeAllRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 12, marginTop: 2,
  },
  seeAllText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
  sectionTitle: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: '#fff' },

  card: { backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },

  contribRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  rankNum: { width: 16, textAlign: 'center', color: RivalColors.textSecondary, fontSize: 13, fontWeight: '700' },
  avatarWrap: { position: 'relative' },
  crownWrap: { position: 'absolute', top: -12, left: 9, zIndex: 2 },
  contribName: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 14.5, color: '#fff' },
  gold: { color: RivalColors.accentGold },
  accentText: { color: RivalColors.accentText },
  barBg: { height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 5, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2, backgroundColor: RivalColors.accentFill },
  contribKm: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '700' },

  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  activityText: { color: '#fff', fontSize: 14 },
  activityName: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700' },
  activityBody: { flex: 1, minWidth: 0, gap: 2 },
  activityTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  activityShrink: { flexShrink: 1 },
  activityTime: { color: RivalColors.textSecondary, fontSize: 11.5, marginLeft: 'auto' },
  activityWhat: { color: 'rgba(255,255,255,0.72)', fontSize: 13 },
  teamAbout: { fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.72)', textAlign: 'center', paddingHorizontal: 8 },
  emptyText: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 20 },

  // Post card — ported verbatim from team-feed.tsx so the Feed tab here
  // matches the Team Feed page exactly.
  post: {
    position: 'relative', borderRadius: 20, borderWidth: 1, borderColor: CARD_BORDER,
    backgroundColor: '#2d241f',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'radial-gradient(circle at -10% -15%, rgba(255,209,190,0.14) 0%, rgba(255,209,190,0) 70%), linear-gradient(135deg, #231e1b 0%, #2d241f 55%, #3b2821 100%)',
    } as any : {}),
    padding: 12, gap: 11,
  },
  postAccentBar: { position: 'absolute', top: 6, bottom: 6, width: 3 },
  postAccentBarNative: { position: 'absolute', top: 6, bottom: 6, width: 3, opacity: 0.7 },
  postAccentBarLeft: { left: -1, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 },
  postAccentBarRight: { right: -1, borderTopRightRadius: 3, borderBottomRightRadius: 3 },

  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, zIndex: 5 },
  postMoreWrap: { marginLeft: 'auto', position: 'relative' },
  postMoreBtn: { padding: 4 },
  postMoreBackdrop: { position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000 },
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
  postName: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: '#fff' },
  postMeta: { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 1 },

  postPhotoWrap: { position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: 4 / 5, backgroundColor: '#211c19' },
  postPhotoWrapPb: { borderWidth: 2.5, borderColor: RivalColors.rankAnchors.unrivaled },
  postPhoto: { width: '100%', height: '100%' },

  postFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  badgeLine: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  badgeLineText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', flexShrink: 1 },
  statsLine: { fontSize: 14.5, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  effortLine: { alignItems: 'flex-end' },
  effortNum: { fontSize: 19, fontWeight: '800', color: RivalColors.accentText, lineHeight: 20 },
  effortUnit: { fontFamily: SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: 9, letterSpacing: 0.4, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', marginTop: 1 },

  caption: { fontSize: 12.5, color: RivalColors.onSurface, lineHeight: 18, paddingHorizontal: 2 },

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
  noPhotoBody: { fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },

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

  redirectCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: 16, padding: 14 },
  redirectTitle: { fontSize: 14, fontWeight: '800', color: '#fff' },
  redirectSub: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
});
