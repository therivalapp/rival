import { useEffect, useState, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, Share, Platform, ScrollView, Image, TextInput, Linking, Alert, ImageBackground, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Asset } from 'expo-asset';
import { supabase, getAuthUser } from '../lib/supabase';
import { invalidateUnreadChats } from '../lib/unreadChats';
import { notify } from '../lib/notify';
import { squareImage } from '../lib/imageResize';
import { getLevel } from '../lib/xp';
import { formatDisplayName, formatTeamName } from '../lib/identity';
import { isoToDisplayDate, displayToIsoDate } from '../lib/dateFormat';
import { getSeasonStartISO, daysUntilSeasonEnd } from '../lib/season';
import { matchCanonicalLift } from '../lib/lifts';
import { RivalColors, RivalSerifFamily, RivalButtonColors } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { ACTIVITY_ICONS } from '../constants/activityIcons';
import { formatDuration } from '../lib/format';
import { computeActivityInsight, ActivityInsight, InsightActivity, InsightTone } from '../lib/activityInsights';
import { RivalIcon, RivalFixedBackground, RivalTopNav, RivalProgressBar, RivalAvatar, RivalBackButton, RivalDateField } from '../components/rival';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';

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

type MediaRow = { id: string; activity_id: string; media_url: string; media_type: 'photo' | 'video' };

type FeedItem =
  | { kind: 'activity'; id: string; userId: string; name: string; activityType: string; activityName: string | null; durationSeconds: number; distanceMeters: number; xp: number; ts: string; pbLift: string | null; insight: ActivityInsight | null }
  | { kind: 'race'; id: string; userId: string; name: string; raceName: string; raceDate: string; ts: string }
  | { kind: 'session'; id: string; userId: string; ts: string; name: string; message: ChatMessage };

// Deterministic per-person fallback colours (see the hash below). Six hues are
// still needed to tell teammates apart at a glance; these are drawn from a warm
// palette that sits alongside Refined Ember, rather than the old brand magenta
// and lime which now read as artefacts of the previous design.
const AVATAR_COLORS = ['#D97757', '#F5B759', '#C2694A', '#E8A87C', '#A85638', '#8C6E54'];

function avatarColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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

function formatDateTime(ts: string): string {
  const d = new Date(ts);
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

function todayLocalStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type Member = {
  user_id: string;
  role: string;
  users: { email: string; display_name: string | null; avatar_url: string | null };
  total_score: number;
  last_week_score: number;
  all_time_xp: number;
  rank_change: number | null; // positive = moved up, negative = moved down, null = no prior data
  isHot: boolean;
  week_time_minutes: number;
  personal_goal: string | null;
};

type League = {
  id: string;
  name: string;
  invite_code: string;
  is_private: boolean;
  created_by: string;
  created_at: string;
  logo_url: string | null;
  race_id: string | null;
  goal_metric: Challenge['metric'] | null;
  goal_target: number | null;
  goal_target_date: string | null;
};

// Journeys: a league with a race attached is a shared destination — see
// project_rival_journeys_concept.md. This is the race's own info, fetched separately
// since leagues.race_id just points at it (no join needed elsewhere).
type JourneyRace = { id: string; name: string; race_date: string; race_type: string };

function daysUntilRace(dateStr: string): number {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

type ChatMessage = {
  id: string;
  user_id: string;
  kind: 'text' | 'session';
  body: string | null;
  activity_type: string | null;
  scheduled_at: string | null;
  location: string | null;
  created_at: string;
};

const SESSION_TYPES = ['Run', 'Ride', 'Swim', 'CrossFit', 'Hike', 'WeightTraining', 'Workout'];

type Challenge = {
  id: string;
  challenger_id: string;
  opponent_id: string;
  metric: 'xp' | 'distance' | 'activities' | 'elevation' | 'duration';
  start_date: string;
  end_date: string;
  status: 'pending' | 'active' | 'declined' | 'completed';
  winner_id: string | null;
  created_at: string;
};

type LeagueVsChallenge = {
  id: string;
  challenger_league_id: string;
  opponent_league_id: string;
  created_by: string;
  metric: Challenge['metric'];
  start_date: string;
  end_date: string;
  status: 'pending' | 'active' | 'declined' | 'completed';
  winner_league_id: string | null;
  created_at: string;
};

const CHALLENGE_METRICS: Array<{ value: Challenge['metric']; label: string }> = [
  { value: 'xp', label: 'Effort earned' },
  { value: 'distance', label: 'Distance (km)' },
  { value: 'elevation', label: 'Elevation (m)' },
  { value: 'duration', label: 'Time (hours)' },
  { value: 'activities', label: 'Activities Logged' },
];
// Short unit suffix for the Team Challenge ring/stat labels — CHALLENGE_METRICS'
// own labels are too long to sit next to a number ("Distance (km)" vs "km").
const GOAL_METRIC_UNIT: Record<Challenge['metric'], string> = {
  xp: 'effort', distance: 'km', elevation: 'm', duration: 'hrs', activities: 'activities',
};

// react-native's View.backgroundColor can't express a gradient — same
// limitation as TeamChallengePhoto/RivalFixedBackground above. Web renders
// the real CSS gradient via a raw style prop; native falls back to a flat
// approximation passed as the base style (CARD_BG / paceCard's own
// backgroundColor) so nothing breaks, it's just flatter there.
const warmCardWeb =
  Platform.OS === 'web'
    ? ({
        backgroundImage:
          'radial-gradient(circle at -10% -15%, rgba(255,209,190,0.14) 0%, rgba(255,209,190,0) 70%), linear-gradient(135deg, #231e1b 0%, #2d241f 55%, #3b2821 100%)',
      } as any)
    : null;
const paceCardWeb =
  Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(135deg, rgba(217,119,87,0.16), rgba(217,119,87,0.05))' } as any)
    : null;

// Same SVG-ring technique as the Team Hub challenge ring — a stroked
// circle, transform applied only to the Svg element itself so it can't leak
// onto sibling content.
function TeamChallengeRing({ pct, value, unit, size = 176, thickness = 13 }: { pct: number; value: number; unit: string; size?: number; thickness?: number }) {
  const clamped = Math.max(0, Math.min(1, pct));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <LinearGradient id="teamChallengeRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={RivalColors.accentFill} />
            <Stop offset="100%" stopColor={RivalColors.accentText} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={thickness} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke="url(#teamChallengeRingGrad)" strokeWidth={thickness} fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
        />
      </Svg>
      <RivalIcon name="flag" size={20} color={RivalColors.accentText} style={{ marginBottom: 4 }} />
      <Text style={{ fontSize: 30, fontWeight: '800', color: '#fff', letterSpacing: -0.6 }}>{value.toLocaleString()}</Text>
      <Text style={{ fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 }}>{unit}</Text>
    </View>
  );
}

const TEAM_CHALLENGE_PHOTO = require('../../assets/images/backgrounds/optimized/coastal-highway-triathlete-dusk-3.jpg');

// Same technique as RivalFixedBackground (see that file's comment for the
// full explanation of why): react-native-web's ImageBackground hardcodes
// backgroundPosition/no gradient support on the div that actually paints
// the photo, so the focal point + fade-to-card gradient go on a plain View
// via raw CSS on web instead. Scoped to just this card's hero strip (not
// position:fixed — this sits inline, unlike the page's own ambient photo).
function TeamChallengePhoto({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'web') {
    const uri = Asset.fromModule(TEAM_CHALLENGE_PHOTO).uri;
    return (
      <View
        style={[
          styles.teamChallengePhoto,
          {
            backgroundImage: [
              'linear-gradient(180deg, rgba(20,14,10,0.1) 0%, rgba(19,19,19,0.55) 55%, rgba(19,19,19,0.96) 92%)',
              'radial-gradient(120% 70% at 50% 0%, rgba(217,119,87,0.25) 0%, rgba(217,119,87,0) 60%)',
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
    <ImageBackground source={TEAM_CHALLENGE_PHOTO} style={styles.teamChallengePhoto} resizeMode="cover">
      {children}
    </ImageBackground>
  );
}
// Two reactions, words not emoji: Respect is everyday acknowledgment
// ("I saw the work"); Inspired is rare and means someone's effort actually
// moved you to act. Only 'inspired' counts toward the recipient's Impact
// stat (see profile.tsx) — Respect is casual acknowledgment, no Impact effect.
const REACTION_OPTIONS = [
  { value: 'respect', label: 'Respect' },
  { value: 'inspired', label: 'Inspired' },
];
const ENCOURAGE_PRESETS = ["💪 You've got this", '🔥 Go get it', '👏 Proud of you', "🚀 Let's go!", '❤️ Keep showing up'];

function feedTargetKey(type: string, id: string) {
  return `${type}:${id}`;
}

export default function LeagueScreen() {
  const { id, tab: initialTabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [journeyRace, setJourneyRace] = useState<JourneyRace | null>(null);
  // Team Target: cumulative team-wide goal — see leagues_team_goal.sql. Summed
  // across every active member's activities since the team was created,
  // mutually exclusive with journeyRace (enforced by a DB check constraint).
  const [goalProgress, setGoalProgress] = useState(0);
  const [goalContributors, setGoalContributors] = useState<{ userId: string; value: number }[]>([]);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  // Team Challenge composer (admin-only) — creates/edits the shared goal
  // (leagues.goal_metric/goal_target/goal_target_date), distinct from the
  // per-member race-day goal above (editingGoal/goalDraft).
  const [showGoalComposer, setShowGoalComposer] = useState(false);
  const [goalMetricDraft, setGoalMetricDraft] = useState<Challenge['metric']>('distance');
  const [goalTargetDraft, setGoalTargetDraft] = useState('');
  const [goalDateDraft, setGoalDateDraft] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [mvpUserId, setMvpUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeCopied, setCodeCopied] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedMediaMap, setFeedMediaMap] = useState<Record<string, MediaRow[]>>({});
  const [feedAvatarMap, setFeedAvatarMap] = useState<Record<string, string | null>>({});
  const seasonDaysLeft = daysUntilSeasonEnd();

  // Chat lives on its own screen (/chat) — it needs a full-height composer and
  // a keyboard-aware layout that a tab inside a scrolling team page can't give
  // it. A ?tab=chat link from anywhere older lands on Feed rather than 404ing.
  const VALID_TABS = ['feed', 'sessions', 'challenges'] as const;
  const [activeTab, setActiveTab] = useState<'feed' | 'sessions' | 'challenges'>(
    VALID_TABS.includes(initialTabParam as any) ? (initialTabParam as any) : 'feed'
  );
  const [sessionsView, setSessionsView] = useState<'upcoming' | 'history'>('upcoming');
  const [allSessions, setAllSessions] = useState<ChatMessage[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [rsvpMap, setRsvpMap] = useState<Record<string, string[]>>({});
  const [showSessionComposer, setShowSessionComposer] = useState(false);
  const [sessionType, setSessionType] = useState('Run');
  const [sessionDate, setSessionDate] = useState(isoToDisplayDate(todayLocalStr()));
  const [sessionTime, setSessionTime] = useState('07:00');
  const [sessionLocation, setSessionLocation] = useState('');
  const [sessionNote, setSessionNote] = useState('');
  const [postingSession, setPostingSession] = useState(false);
  const [showQuickTrain, setShowQuickTrain] = useState(false);
  const [quickTrainType, setQuickTrainType] = useState('Run');
  const [quickTrainMinutes, setQuickTrainMinutes] = useState(30);
  const [quickTrainLocation, setQuickTrainLocation] = useState('');
  const [postingQuickTrain, setPostingQuickTrain] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [reactionsMap, setReactionsMap] = useState<Record<string, Array<{ user_id: string; emoji: string }>>>({});
  const [commentsMap, setCommentsMap] = useState<Record<string, Array<{ id: string; user_id: string; body: string; created_at: string }>>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [expandedEncourage, setExpandedEncourage] = useState<Set<string>>(new Set());
  const [encourageDrafts, setEncourageDrafts] = useState<Record<string, string>>({});
  const [sendingEncourage, setSendingEncourage] = useState<Set<string>>(new Set());
  const [encouragedToday, setEncouragedToday] = useState<Set<string>>(new Set());
  const [encourageErrors, setEncourageErrors] = useState<Record<string, string>>({});
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengesLoading, setChallengesLoading] = useState(true);
  const [challengeProgress, setChallengeProgress] = useState<Record<string, { challenger: number; opponent: number }>>({});
  const [challengeModalFor, setChallengeModalFor] = useState<string | null>(null);
  const [challengeMetric, setChallengeMetric] = useState<Challenge['metric']>('xp');
  const [challengeDays, setChallengeDays] = useState(7);
  const [postingChallenge, setPostingChallenge] = useState(false);
  const [customChallenDays, setCustomChallengeDays] = useState('');
  const [lvlChallenges, setLvlChallenges] = useState<LeagueVsChallenge[]>([]);
  const [lvlProgress, setLvlProgress] = useState<Record<string, { challenger: number; opponent: number }>>({});
  const [showLvlModal, setShowLvlModal] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [allLeaguesForPicker, setAllLeaguesForPicker] = useState<Array<{ id: string; name: string; logo_url: string | null }>>([]);
  const [lvlTargetLeague, setLvlTargetLeague] = useState<string | null>(null);
  const [lvlMetric, setLvlMetric] = useState<Challenge['metric']>('xp');
  const [lvlDays, setLvlDays] = useState(7);
  const [lvlCustomDays, setLvlCustomDays] = useState('');
  const [postingLvl, setPostingLvl] = useState(false);
  const [lvlSearch, setLvlSearch] = useState('');

  useEffect(() => { loadLeague(); }, [id]);
  useEffect(() => { if (currentUserId) loadEncouragedToday(); }, [currentUserId]);
  useEffect(() => { if (id && activeTab === 'sessions') loadSessions(); }, [id, activeTab]);
  useEffect(() => {
    if (id && activeTab === 'challenges') {
      loadChallenges();
      loadLvlChallenges();
    }
  }, [id, activeTab]);

  useEffect(() => {
    if (!id || activeTab !== 'sessions') return;
    const refresh = () => loadSessions();
    const channel = supabase
      .channel(`league-chat-${id}-${activeTab}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'league_messages', filter: `league_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'league_session_rsvps' }, refresh)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, activeTab]);
  useEffect(() => { if (!loading) loadWeekScores(); }, [weekOffset]);

  function getWeekWindow(offset: number) {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() + diff);
    thisMonday.setHours(0, 0, 0, 0);
    const start = new Date(thisMonday);
    start.setDate(thisMonday.getDate() + offset * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }

  function weekLabel(offset: number) {
    if (offset === 0) return "This week's standings";
    if (offset === -1) return "Last week's standings";
    const { start, end } = getWeekWindow(offset);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const endDay = new Date(end);
    endDay.setDate(endDay.getDate() - 1);
    return `${start.toLocaleDateString('en-US', opts)} – ${endDay.toLocaleDateString('en-US', opts)}`;
  }

  async function saveGoal() {
    const { error } = await supabase.from('league_members').update({ personal_goal: goalDraft.trim() || null }).eq('league_id', id).eq('user_id', currentUserId);
    if (error) {
      notify("Couldn't save goal", error.message);
      return;
    }
    setMembers(prev => prev.map(m => m.user_id === currentUserId ? { ...m, personal_goal: goalDraft.trim() || null } : m));
    setEditingGoal(false);
  }

  function leaveTeam() {
    if (!currentUserId) return;
    setShowLeaveConfirm(true);
  }

  async function confirmLeaveTeam() {
    setShowLeaveConfirm(false);
    const { error } = await supabase.rpc('leave_league', { p_league_id: id });
    if (error) {
      notify("Couldn't leave team", error.message);
      return;
    }
    goToTab('/home');
  }

  async function loadLeague() {
    const { data: { user } } = await getAuthUser();
    if (user) {
      setCurrentUserId(user.id);
      const { data: myMembership } = await supabase
        .from('league_members').select('status').eq('league_id', id).eq('user_id', user.id).maybeSingle();
      if (myMembership?.status === 'pending') {
        notify('Request pending', "Your request to join this team hasn't been approved by an admin yet.");
        goToTab('/home');
        return;
      }
    }

    const { data: leagueData } = await supabase.from('leagues').select('*').eq('id', id).single();
    if (leagueData) setLeague(leagueData);

    if (leagueData?.race_id) {
      const { data: raceData } = await supabase.from('races').select('id, name, race_date, race_type').eq('id', leagueData.race_id).maybeSingle();
      setJourneyRace(raceData ?? null);
    } else {
      setJourneyRace(null);
    }

    const { data: membersData } = await supabase
      .from('league_members')
      .select('user_id, role, personal_goal, users(display_name, avatar_url)')
      .eq('league_id', id)
      .eq('status', 'active');

    if (user && membersData) {
      const adminCheck = membersData.find((m: any) => m.user_id === user.id);
      setIsAdmin(adminCheck?.role === 'admin');
    }

    if (leagueData?.goal_metric && membersData) {
      const { total, byUser } = await computeTeamGoalProgress(
        membersData.map((m: any) => m.user_id),
        leagueData.goal_metric,
        leagueData.created_at,
      );
      setGoalProgress(total);
      setGoalContributors(
        Object.entries(byUser)
          .map(([userId, value]) => ({ userId, value: Math.round(value * 10) / 10 }))
          .sort((a, b) => b.value - a.value)
      );
    } else {
      setGoalContributors([]);
    }

    if (membersData) {
      await scoreMembers(membersData, 0);
      await loadFeed(membersData, leagueData?.created_at);
    }
    setLoading(false);
  }

  async function loadFeed(membersData: any[], leagueCreatedAt?: string) {
    setFeedLoading(true);

    const nameMap: Record<string, string> = {};
    const avatarMap: Record<string, string | null> = {};
    membersData.forEach((m: any) => {
      nameMap[m.user_id] = formatDisplayName(m.users);
      avatarMap[m.user_id] = m.users?.avatar_url || null;
    });
    setFeedAvatarMap(avatarMap);

    const memberIds = membersData.map((m: any) => m.user_id);
    // Feed starts no earlier than the league's own creation — a brand-new league
    // shouldn't dump everyone's pre-existing workout history on day one. Falls back
    // to the normal 2-week window for established leagues (created_at is older).
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const feedStart = leagueCreatedAt && new Date(leagueCreatedAt) > twoWeeksAgo ? new Date(leagueCreatedAt) : twoWeeksAgo;
    const today = todayLocalStr();

    // Per-member trailing history for micro-insights ("Longest run in 3 months",
    // "4th swim this week") — a separate, wider window than the feed itself so
    // record/pace comparisons have enough history to be meaningful. Bounded to
    // a year and a modest row cap since this is scoped to one team's members.
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);

    const [feedActivitiesRes, feedRacesRes, liftEntriesRes, feedSessionsRes, insightHistoryRes] = await Promise.all([
      supabase.from('activities')
        .select('id, user_id, name, activity_type, started_at, duration_seconds, distance_meters, effort_score, exercises')
        .in('user_id', memberIds)
        .gte('started_at', feedStart.toISOString())
        .order('started_at', { ascending: false })
        .limit(60),
      supabase.from('races')
        .select('id, user_id, name, race_date, created_at')
        .in('user_id', memberIds)
        .gte('race_date', today)
        .gte('created_at', feedStart.toISOString())
        .order('race_date', { ascending: false })
        .limit(20),
      supabase.from('exercise_entries')
        .select('user_id, exercise_name, weight_kg')
        .in('user_id', memberIds),
      supabase.from('league_messages')
        .select('id, user_id, kind, body, activity_type, scheduled_at, location, created_at')
        .eq('league_id', id)
        .eq('kind', 'session')
        .gte('scheduled_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('activities')
        .select('user_id, activity_type, started_at, duration_seconds, distance_meters, elevation_meters')
        .in('user_id', memberIds)
        .gte('started_at', oneYearAgo.toISOString())
        .order('started_at', { ascending: false })
        .limit(500),
    ]);

    const insightHistoryByUser: Record<string, InsightActivity[]> = {};
    (insightHistoryRes.data || []).forEach((a: any) => {
      (insightHistoryByUser[a.user_id] ??= []).push(a);
    });

    // Current all-time best per (user, lift) — used to flag which feed activity actually set it
    const liftMaxMap = new Map<string, number>();
    (liftEntriesRes.data || []).forEach((e: any) => {
      const key = `${e.user_id}|${e.exercise_name}`;
      liftMaxMap.set(key, Math.max(liftMaxMap.get(key) ?? 0, e.weight_kg));
    });

    function findPbLift(userId: string, exercises: any[] | null): string | null {
      if (!exercises) return null;
      for (const ex of exercises) {
        const canonical = matchCanonicalLift(ex.name) || ex.prLift;
        if (!canonical || !ex.weight) continue;
        if (ex.weight >= (liftMaxMap.get(`${userId}|${canonical}`) ?? 0)) return canonical;
      }
      return null;
    }

    const feedActivityIds = (feedActivitiesRes.data || []).map((a: any) => a.id);
    if (feedActivityIds.length > 0) {
      const { data: mediaData } = await supabase
        .from('activity_media')
        .select('id, activity_id, media_url, media_type')
        .in('activity_id', feedActivityIds)
        .order('created_at', { ascending: true });

      const newMediaMap: Record<string, MediaRow[]> = {};
      (mediaData || []).forEach((m: MediaRow) => {
        if (!newMediaMap[m.activity_id]) newMediaMap[m.activity_id] = [];
        newMediaMap[m.activity_id].push(m);
      });
      setFeedMediaMap(newMediaMap);
    }

    const items: FeedItem[] = [];

    feedActivitiesRes.data?.forEach((a: any) => {
      if (!a.started_at) return;
      const pbLift = findPbLift(a.user_id, a.exercises);
      const insight = computeActivityInsight(
        { activity_type: a.activity_type, started_at: a.started_at, duration_seconds: a.duration_seconds, distance_meters: a.distance_meters, elevation_meters: a.elevation_meters },
        insightHistoryByUser[a.user_id] || [],
        !!pbLift,
      );
      items.push({
        kind: 'activity', id: a.id, userId: a.user_id,
        name: nameMap[a.user_id] ?? 'Athlete',
        activityType: a.activity_type,
        activityName: a.name,
        durationSeconds: a.duration_seconds,
        distanceMeters: a.distance_meters,
        xp: Math.round((a.effort_score || 0) * 10) / 10,
        ts: a.started_at,
        pbLift,
        insight,
      });
    });

    feedRacesRes.data?.forEach((r: any) => {
      const ts = r.created_at || r.race_date;
      if (!ts) return;
      items.push({
        kind: 'race', id: r.id, userId: r.user_id,
        name: nameMap[r.user_id] ?? 'Athlete',
        raceName: r.name,
        raceDate: r.race_date,
        ts,
      });
    });

    const feedSessions = feedSessionsRes.data || [];
    feedSessions.forEach((s: any) => {
      items.push({ kind: 'session', id: s.id, userId: s.user_id, ts: s.created_at, name: nameMap[s.user_id] ?? 'Athlete', message: s });
    });

    const sessionIds = feedSessions.map((s: any) => s.id);
    if (sessionIds.length > 0) {
      const { data: rsvps } = await supabase
        .from('league_session_rsvps')
        .select('message_id, user_id')
        .in('message_id', sessionIds);
      setRsvpMap(prev => {
        const next = { ...prev };
        (rsvps || []).forEach((r: any) => {
          if (!next[r.message_id]) next[r.message_id] = [];
          if (!next[r.message_id].includes(r.user_id)) next[r.message_id].push(r.user_id);
        });
        return next;
      });
    }

    const socialIds = items.filter(it => it.kind === 'activity' || it.kind === 'race').map(it => it.id);
    if (socialIds.length > 0) {
      const [reactionsRes, commentsRes] = await Promise.all([
        supabase.from('feed_reactions').select('target_type, target_id, user_id, emoji').in('target_id', socialIds),
        supabase.from('feed_comments').select('id, target_type, target_id, user_id, body, created_at').in('target_id', socialIds).order('created_at', { ascending: true }),
      ]);
      const newReactionsMap: Record<string, Array<{ user_id: string; emoji: string }>> = {};
      (reactionsRes.data || []).forEach((r: any) => {
        const key = feedTargetKey(r.target_type, r.target_id);
        if (!newReactionsMap[key]) newReactionsMap[key] = [];
        newReactionsMap[key].push({ user_id: r.user_id, emoji: r.emoji });
      });
      setReactionsMap(newReactionsMap);

      const newCommentsMap: Record<string, Array<{ id: string; user_id: string; body: string; created_at: string }>> = {};
      (commentsRes.data || []).forEach((c: any) => {
        const key = feedTargetKey(c.target_type, c.target_id);
        if (!newCommentsMap[key]) newCommentsMap[key] = [];
        newCommentsMap[key].push({ id: c.id, user_id: c.user_id, body: c.body, created_at: c.created_at });
      });
      setCommentsMap(newCommentsMap);
    }

    items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    setFeedItems(items.slice(0, 40));
    setFeedLoading(false);
  }

  async function loadWeekScores() {
    const { data: membersData } = await supabase
      .from('league_members')
      .select('user_id, role, personal_goal, users(display_name, avatar_url)')
      .eq('league_id', id)
      .eq('status', 'active');
    if (membersData) await scoreMembers(membersData, weekOffset);
  }

  async function scoreMembers(membersData: any[], offset: number) {
    const { start, end } = getWeekWindow(offset);
    const { start: lastStart, end: lastEnd } = getWeekWindow(offset - 1);

    // Three queries for the whole team, not three PER MEMBER. This previously
    // fanned out inside a map — a twenty-person team fired sixty requests at
    // once, which is slow to settle and heavy on the connection pool. Effort
    // rows carry user_id, so the same numbers come back from one query per
    // window and a group-by in memory.
    const memberIds = membersData.map((m: any) => m.user_id);
    const sumBy = (rows: any[] | null | undefined, field = 'effort_score') => {
      const acc: Record<string, number> = {};
      (rows || []).forEach((r: any) => {
        acc[r.user_id] = (acc[r.user_id] || 0) + (r[field] || 0);
      });
      return acc;
    };

    const [weekRes, prevRes, allRes] = await Promise.all([
      supabase.from('activities').select('user_id, effort_score, duration_seconds').in('user_id', memberIds)
        .gte('started_at', start.toISOString()).lt('started_at', end.toISOString()),
      supabase.from('activities').select('user_id, effort_score').in('user_id', memberIds)
        .gte('started_at', lastStart.toISOString()).lt('started_at', lastEnd.toISOString()),
      supabase.from('activities').select('user_id, effort_score').in('user_id', memberIds)
        .gte('started_at', getSeasonStartISO()),
    ]);

    const weekByUser = sumBy(weekRes.data);
    const weekSecondsByUser = sumBy(weekRes.data, 'duration_seconds');
    const prevByUser = sumBy(prevRes.data);
    const allByUser = sumBy(allRes.data);

    const membersWithScores = membersData.map((m: any) => {
      const total = weekByUser[m.user_id] || 0;
      return {
        ...m,
        total_score: Math.round(total * 10) / 10,
        last_week_score: Math.round((prevByUser[m.user_id] || 0) * 10) / 10,
        all_time_xp: allByUser[m.user_id] || 0,
        rank_change: null as number | null,
        isHot: false,
        week_time_minutes: Math.round((weekSecondsByUser[m.user_id] || 0) / 60),
      };
    });

    // MVP = highest scorer in the prior week
    const mvp = [...membersWithScores]
      .filter((m) => m.last_week_score > 0)
      .sort((a, b) => b.last_week_score - a.last_week_score)[0];
    setMvpUserId(mvp?.user_id ?? null);

    // Compute rank change: diff between last week's rank order and this week's
    const lastWeekRanked = [...membersWithScores].sort((a, b) => b.last_week_score - a.last_week_score);
    const lastWeekRankMap: Record<string, number> = {};
    lastWeekRanked.forEach((m, i) => { if (m.last_week_score > 0) lastWeekRankMap[m.user_id] = i; });

    membersWithScores.sort((a, b) => b.total_score - a.total_score);

    membersWithScores.forEach((m, i) => {
      const lastRank = lastWeekRankMap[m.user_id];
      m.rank_change = lastRank !== undefined ? lastRank - i : null;
      m.isHot = m.total_score > 0 && m.last_week_score > 0;
    });

    setMembers(membersWithScores);
  }

  function getDisplayName(member: Member) {
    return formatDisplayName(member.users);
  }

  function goToProfile(userId: string) {
    // Another member's "profile" is their stats showcase — /profile is now
    // your own settings only (it self-redirects for other users anyway).
    router.push(`/stats?userId=${userId}`);
  }

  async function fireChallengeNotification(type: string, challengeId: string, extra?: Record<string, unknown>) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/challenge-notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ type, challengeId, ...extra }),
      }).catch(() => {});
    } catch {}
  }

  async function uploadLeagueLogo() {
    if (Platform.OS !== 'web' || !league) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingLogo(true);
      try {
        const image = await squareImage(file);
        const resized = image !== file;
        const ext = resized ? 'jpg' : (file.name.split('.').pop() || 'jpg');
        const path = `leagues/${id}/logo.${ext}`;
        const { error: storageErr } = await supabase.storage
          .from('avatars')
          .upload(path, image, { contentType: resized ? 'image/jpeg' : file.type, upsert: true });
        if (!storageErr) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
          urlData.publicUrl = `${urlData.publicUrl}?v=${Date.now()}`;
          const { error: logoErr } = await supabase.from('leagues').update({ logo_url: urlData.publicUrl }).eq('id', id);
          if (logoErr) notify("Couldn't update the team logo", logoErr.message);
          setLeague(prev => prev ? { ...prev, logo_url: urlData.publicUrl } : prev);
        }
      } finally {
        setUploadingLogo(false);
      }
    };
    input.click();
  }

  function renderMessageBody(body: string | null) {
    if (!body) return null;
    const names = members.map(getDisplayName).filter(Boolean).sort((a, b) => b.length - a.length);
    if (names.length === 0) return <Text style={styles.chatBubbleText}>{body}</Text>;

    const escaped = names.map(n => n.replace(/\s+/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`@(${escaped.join('|')})\\b`, 'g');
    const parts = body.split(regex);

    return (
      <Text style={styles.chatBubbleText}>
        {parts.map((part, i) =>
          i % 2 === 1 ? <Text key={i} style={styles.mentionText}>@{part}</Text> : part
        )}
      </Text>
    );
  }

  function getRankEmoji(index: number) {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return `${index + 1}.`;
  }

  function RankArrow({ change }: { change: number | null }) {
    if (change === null || change === 0) return <Text style={styles.rankArrowNeutral}>—</Text>;
    if (change > 0) return <Text style={styles.rankArrowUp}>↑{change}</Text>;
    return <Text style={styles.rankArrowDown}>↓{Math.abs(change)}</Text>;
  }

  async function copyInviteCode() {
    if (!league) return;
    if (Platform.OS === 'web' && navigator.clipboard) {
      await navigator.clipboard.writeText(league.invite_code);
    } else {
      await Share.share({ message: `Join my RIVAL team with code: ${league.invite_code}` });
    }
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  async function loadSessions() {
    setSessionsLoading(true);
    const { data } = await supabase
      .from('league_messages')
      .select('id, user_id, kind, body, activity_type, scheduled_at, location, created_at')
      .eq('league_id', id)
      .eq('kind', 'session')
      .order('scheduled_at', { ascending: true })
      .limit(200);

    setAllSessions(data || []);

    const sessionIds = (data || []).map(m => m.id);
    if (sessionIds.length > 0) {
      const { data: rsvps } = await supabase
        .from('league_session_rsvps')
        .select('message_id, user_id')
        .in('message_id', sessionIds);
      const map: Record<string, string[]> = {};
      (rsvps || []).forEach((r: any) => {
        if (!map[r.message_id]) map[r.message_id] = [];
        map[r.message_id].push(r.user_id);
      });
      setRsvpMap(map);
    }
    setSessionsLoading(false);
  }

  // Sums one metric across every active member since the team formed —
  // same per-metric scoring as computeChallengeProgress below, just summed
  // across the whole roster instead of two challengers.
  async function computeTeamGoalProgress(memberIds: string[], metric: Challenge['metric'], sinceIso: string): Promise<{ total: number; byUser: Record<string, number> }> {
    if (memberIds.length === 0) return { total: 0, byUser: {} };
    const { data } = await supabase
      .from('activities')
      .select('user_id, effort_score, distance_meters, elevation_meters, duration_seconds')
      .in('user_id', memberIds)
      .gte('started_at', sinceIso);

    let total = 0;
    const byUser: Record<string, number> = {};
    (data || []).forEach((a: any) => {
      let value = 0;
      if (metric === 'xp') value = a.effort_score || 0;
      else if (metric === 'distance') value = (a.distance_meters || 0) / 1000;
      else if (metric === 'elevation') value = a.elevation_meters || 0;
      else if (metric === 'duration') value = (a.duration_seconds || 0) / 3600;
      else value = 1;
      total += value;
      byUser[a.user_id] = (byUser[a.user_id] || 0) + value;
    });
    return { total: Math.round(total * 10) / 10, byUser };
  }

  async function saveTeamGoal() {
    const target = parseFloat(goalTargetDraft);
    if (!target || target <= 0) { notify('Set a target', 'Enter a positive number.'); return; }
    const iso = displayToIsoDate(goalDateDraft);
    if (!iso) { notify('Set a target date', 'Use YYYY-MM-DD.'); return; }
    setSavingGoal(true);
    const { error } = await supabase
      .from('leagues')
      .update({ goal_metric: goalMetricDraft, goal_target: target, goal_target_date: iso })
      .eq('id', id);
    setSavingGoal(false);
    if (error) { notify("Couldn't save the team challenge", error.message); return; }
    setShowGoalComposer(false);
    loadLeague();
  }

  async function computeChallengeProgress(challenge: Challenge): Promise<{ challenger: number; opponent: number }> {
    const startIso = new Date(`${challenge.start_date}T00:00:00`).toISOString();
    const endIso = new Date(new Date(`${challenge.end_date}T00:00:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase
      .from('activities')
      .select('user_id, effort_score, distance_meters, elevation_meters, duration_seconds')
      .in('user_id', [challenge.challenger_id, challenge.opponent_id])
      .gte('started_at', startIso)
      .lt('started_at', endIso);

    let challengerScore = 0, opponentScore = 0;
    (data || []).forEach((a: any) => {
      const isChallenger = a.user_id === challenge.challenger_id;
      let value = 0;
      if (challenge.metric === 'xp') value = a.effort_score || 0;
      else if (challenge.metric === 'distance') value = (a.distance_meters || 0) / 1000;
      else if (challenge.metric === 'elevation') value = a.elevation_meters || 0;
      else if (challenge.metric === 'duration') value = (a.duration_seconds || 0) / 3600;
      else value = 1;
      if (isChallenger) challengerScore += value; else opponentScore += value;
    });

    return {
      challenger: Math.round(challengerScore * 10) / 10,
      opponent: Math.round(opponentScore * 10) / 10,
    };
  }

  async function loadChallenges() {
    setChallengesLoading(true);
    const { data } = await supabase
      .from('league_challenges')
      .select('*')
      .eq('league_id', id)
      .order('created_at', { ascending: false });

    const rows = (data || []) as Challenge[];
    setChallenges(rows);

    const today = todayLocalStr();
    const progressEntries = await Promise.all(
      rows
        .filter(c => c.status === 'active' || c.status === 'pending')
        .map(async (c) => [c.id, await computeChallengeProgress(c)] as const)
    );
    const progressMap: Record<string, { challenger: number; opponent: number }> = {};
    progressEntries.forEach(([cid, p]) => { progressMap[cid] = p; });
    setChallengeProgress(progressMap);

    // Auto-complete challenges whose end date has passed
    for (const c of rows) {
      if (c.status === 'active' && c.end_date < today) {
        const progress = progressMap[c.id];
        const winnerId = !progress || progress.challenger === progress.opponent
          ? null
          : progress.challenger > progress.opponent ? c.challenger_id : c.opponent_id;
        // Background sweep that settles finished challenges on load. Logs
        // rather than interrupts: it retries on the next visit anyway.
        const { error: doneErr } = await supabase.from('league_challenges').update({ status: 'completed', winner_id: winnerId }).eq('id', c.id);
        if (doneErr) console.error('Challenge completion failed:', doneErr.message);
        setChallenges(prev => prev.map(x => x.id === c.id ? { ...x, status: 'completed', winner_id: winnerId } : x));
      }
    }
    setChallengesLoading(false);
  }

  async function createChallenge() {
    if (!currentUserId || !challengeModalFor || !id) return;
    const days = challengeDays === -1 ? parseInt(customChallenDays, 10) : challengeDays;
    if (!days || days < 1) return;
    const today = todayLocalStr();
    const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const [ey, em, ed] = [end.getFullYear(), end.getMonth() + 1, end.getDate()];
    const endDateStr = `${ey}-${String(em).padStart(2, '0')}-${String(ed).padStart(2, '0')}`;

    setPostingChallenge(true);
    const { data: inserted, error: insErr } = await supabase.from('league_challenges').insert({
      league_id: id,
      challenger_id: currentUserId,
      opponent_id: challengeModalFor,
      metric: challengeMetric,
      start_date: today,
      end_date: endDateStr,
      status: 'pending',
    }).select('id').single();
    if (insErr) {
      setPostingChallenge(false);
      notify("Couldn't create that challenge", insErr.message);
      return;
    }
    setPostingChallenge(false);
    setChallengeModalFor(null);
    if (inserted) fireChallengeNotification('1v1_sent', inserted.id);
    loadChallenges();
  }

  async function respondToChallenge(challengeId: string, accept: boolean) {
    if (!accept) {
      const { error: decErr } = await supabase.from('league_challenges').update({ status: 'declined' }).eq('id', challengeId);
      if (decErr) { notify("Couldn't decline that challenge", decErr.message); return; }
    } else {
      const { error: accErr } = await supabase.from('league_challenges').update({ status: 'active' }).eq('id', challengeId);
      if (accErr) { notify("Couldn't accept that challenge", accErr.message); return; }
    }
    fireChallengeNotification('1v1_response', challengeId, { accept });
    loadChallenges();
  }

  async function computeLvlProgress(c: LeagueVsChallenge): Promise<{ challenger: number; opponent: number }> {
    const startIso = new Date(`${c.start_date}T00:00:00`).toISOString();
    const endIso = new Date(new Date(`${c.end_date}T00:00:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();

    const [challengerMembersRes, opponentMembersRes] = await Promise.all([
      supabase.from('league_members').select('user_id').eq('league_id', c.challenger_league_id).eq('status', 'active'),
      supabase.from('league_members').select('user_id').eq('league_id', c.opponent_league_id).eq('status', 'active'),
    ]);
    const challengerIds = (challengerMembersRes.data || []).map((m: any) => m.user_id);
    const opponentIds = (opponentMembersRes.data || []).map((m: any) => m.user_id);
    const allIds = [...challengerIds, ...opponentIds];
    if (allIds.length === 0) return { challenger: 0, opponent: 0 };

    const { data } = await supabase.from('activities')
      .select('user_id, effort_score, distance_meters, elevation_meters, duration_seconds')
      .in('user_id', allIds)
      .gte('started_at', startIso)
      .lt('started_at', endIso);

    let challengerScore = 0, opponentScore = 0;
    const challengerSet = new Set(challengerIds);
    (data || []).forEach((a: any) => {
      let value = 0;
      if (c.metric === 'xp') value = a.effort_score || 0;
      else if (c.metric === 'distance') value = (a.distance_meters || 0) / 1000;
      else if (c.metric === 'elevation') value = a.elevation_meters || 0;
      else if (c.metric === 'duration') value = (a.duration_seconds || 0) / 3600;
      else value = 1;
      if (challengerSet.has(a.user_id)) challengerScore += value; else opponentScore += value;
    });
    return { challenger: Math.round(challengerScore * 10) / 10, opponent: Math.round(opponentScore * 10) / 10 };
  }

  async function loadLvlChallenges() {
    const { data } = await supabase.from('league_vs_league_challenges').select('*')
      .or(`challenger_league_id.eq.${id},opponent_league_id.eq.${id}`)
      .order('created_at', { ascending: false });
    const rows = (data || []) as LeagueVsChallenge[];
    setLvlChallenges(rows);

    const today = todayLocalStr();
    const progress = await Promise.all(
      rows.filter(c => c.status === 'active' || c.status === 'pending')
        .map(async c => [c.id, await computeLvlProgress(c)] as const)
    );
    const map: Record<string, { challenger: number; opponent: number }> = {};
    progress.forEach(([cid, p]) => { map[cid] = p; });
    setLvlProgress(map);

    for (const c of rows) {
      if (c.status === 'active' && c.end_date < today) {
        const p = map[c.id];
        const winnerId = !p || p.challenger === p.opponent ? null
          : p.challenger > p.opponent ? c.challenger_league_id : c.opponent_league_id;
        // Background sweep that settles finished challenges on load. Logs
        // rather than interrupts: it retries on the next visit anyway.
        const { error: doneErr } = await supabase.from('league_vs_league_challenges').update({ status: 'completed', winner_league_id: winnerId }).eq('id', c.id);
        if (doneErr) console.error('Challenge completion failed:', doneErr.message);
        setLvlChallenges(prev => prev.map(x => x.id === c.id ? { ...x, status: 'completed', winner_league_id: winnerId } : x));
      }
    }
  }

  async function openLvlModal() {
    const { data } = await supabase.from('leagues').select('id, name, logo_url').neq('id', id).order('name');
    setAllLeaguesForPicker((data || []) as any);
    setShowLvlModal(true);
  }

  async function sendLvlChallenge() {
    if (!currentUserId || !lvlTargetLeague || !id) return;
    const days = lvlDays === -1 ? parseInt(lvlCustomDays, 10) : lvlDays;
    if (!days || days < 1) return;
    const today = todayLocalStr();
    const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const [ey, em, ed] = [end.getFullYear(), end.getMonth() + 1, end.getDate()];
    const endDateStr = `${ey}-${String(em).padStart(2, '0')}-${String(ed).padStart(2, '0')}`;
    setPostingLvl(true);
    const { data: inserted, error: insErr } = await supabase.from('league_vs_league_challenges').insert({
      challenger_league_id: id, opponent_league_id: lvlTargetLeague,
      created_by: currentUserId, metric: lvlMetric,
      start_date: today, end_date: endDateStr, status: 'pending',
    }).select('id').single();
    if (insErr) {
      setPostingLvl(false);
      notify("Couldn't create that challenge", insErr.message);
      return;
    }
    setPostingLvl(false);
    setShowLvlModal(false);
    setLvlTargetLeague(null);
    if (inserted) fireChallengeNotification('lvl_sent', inserted.id);
    loadLvlChallenges();
  }

  async function respondToLvlChallenge(challengeId: string, accept: boolean) {
    await supabase.from('league_vs_league_challenges')
      .update({ status: accept ? 'active' : 'declined' }).eq('id', challengeId);
    fireChallengeNotification('lvl_response', challengeId, { accept });
    loadLvlChallenges();
  }

  async function postSession() {
    if (!currentUserId) return;
    const isoDate = displayToIsoDate(sessionDate);
    const [h, min] = sessionTime.split(':').map(Number);
    // Number('3O') is NaN, and NaN == null is false — an explicit range check is
    // the only guard that keeps an Invalid Date out of toISOString() below.
    if (!isoDate || !Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) {
      notify('Check the time', 'Use 24h HH:MM format, e.g. 07:30.');
      return;
    }
    const [y, m, d] = isoDate.split('-').map(Number);
    const scheduledAt = new Date(y, m - 1, d, h, min);

    setPostingSession(true);
    const { data: inserted, error } = await supabase.from('league_messages').insert({
      league_id: id, user_id: currentUserId, kind: 'session',
      activity_type: sessionType, scheduled_at: scheduledAt.toISOString(),
      location: sessionLocation.trim() || null, body: sessionNote.trim() || null,
    }).select('id').single();
    setPostingSession(false);

    if (error || !inserted) {
      notify("Couldn't post the activity", error?.message || 'Please try again.');
      return;
    }
    // Auto-RSVP the creator to their own session. Non-fatal: the session
    // exists, they can tap to join like anyone else.
    const { error: selfRsvpErr } = await supabase.from('league_session_rsvps').insert({ message_id: inserted.id, user_id: currentUserId });
    if (selfRsvpErr) console.error('Creator auto-RSVP failed:', selfRsvpErr.message);
    setShowSessionComposer(false);
    setSessionLocation('');
    setSessionNote('');
    loadSessions();
    loadFeed(members, league?.created_at);
  }

  async function postQuickTrain() {
    if (!currentUserId) return;
    const scheduledAt = new Date(Date.now() + quickTrainMinutes * 60 * 1000);

    setPostingQuickTrain(true);
    const { data: inserted, error: insErr } = await supabase.from('league_messages').insert({
      league_id: id, user_id: currentUserId, kind: 'session',
      activity_type: quickTrainType, scheduled_at: scheduledAt.toISOString(),
      location: quickTrainLocation.trim() || null,
    }).select('id').single();
    if (insErr) {
      // Must clear the spinner too — an early return that skips it leaves the
      // button stuck in its posting state with no way back.
      setPostingQuickTrain(false);
      notify("Couldn't plan that activity", insErr.message);
      return;
    }

    if (inserted) {
      // Auto-RSVP the creator to their own session. Non-fatal: the session
    // exists, they can tap to join like anyone else.
    const { error: selfRsvpErr } = await supabase.from('league_session_rsvps').insert({ message_id: inserted.id, user_id: currentUserId });
    if (selfRsvpErr) console.error('Creator auto-RSVP failed:', selfRsvpErr.message);

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/session-invite-notifications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({ messageId: inserted.id }),
        }).catch(() => {});
      }
    }

    setPostingQuickTrain(false);
    setShowQuickTrain(false);
    setQuickTrainLocation('');
    loadSessions();
    loadFeed(members, league?.created_at);
  }

  async function toggleRsvp(messageId: string) {
    if (!currentUserId) return;
    const joined = (rsvpMap[messageId] || []).includes(currentUserId);
    if (joined) {
      const { error: rsvpOutErr } = await supabase.from('league_session_rsvps').delete().eq('message_id', messageId).eq('user_id', currentUserId);
      if (rsvpOutErr) { notify("Couldn't update RSVP", rsvpOutErr.message); loadSessions(); return; }
      setRsvpMap(prev => ({ ...prev, [messageId]: (prev[messageId] || []).filter(u => u !== currentUserId) }));
    } else {
      const { error: rsvpInErr } = await supabase.from('league_session_rsvps').insert({ message_id: messageId, user_id: currentUserId });
      if (rsvpInErr) { notify("Couldn't update RSVP", rsvpInErr.message); loadSessions(); return; }
      setRsvpMap(prev => ({ ...prev, [messageId]: [...(prev[messageId] || []), currentUserId] }));
    }
  }

  function memberName(userId: string): string {
    const m = members.find(mm => mm.user_id === userId);
    return m ? formatDisplayName(m.users) : 'Athlete';
  }

  function memberAvatar(userId: string): string | null {
    const m = members.find(mm => mm.user_id === userId);
    return m?.users?.avatar_url || null;
  }

  function openInMaps(location: string) {
    const url = Platform.OS === 'ios'
      ? `https://maps.apple.com/?q=${encodeURIComponent(location)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
    Linking.openURL(url);
  }

  async function toggleReaction(targetType: 'activity' | 'race', targetId: string, emoji: string) {
    if (!currentUserId || !id) return;
    const key = feedTargetKey(targetType, targetId);
    const existing = (reactionsMap[key] || []).find(r => r.user_id === currentUserId);

    if (existing && existing.emoji === emoji) {
      // Reactions are a quiet, high-frequency tap — resync rather than
      // interrupting with a dialog, but never leave the UI showing a reaction
      // the server rejected.
      const { error: unreactErr } = await supabase.from('feed_reactions').delete().eq('target_type', targetType).eq('target_id', targetId).eq('user_id', currentUserId);
      if (unreactErr) loadFeed(members, league?.created_at);
      setReactionsMap(prev => ({ ...prev, [key]: (prev[key] || []).filter(r => r.user_id !== currentUserId) }));
    } else {
      const { error: reactErr } = await supabase.from('feed_reactions').upsert(
        { league_id: id, target_type: targetType, target_id: targetId, user_id: currentUserId, emoji },
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

  async function postComment(targetType: 'activity' | 'race', targetId: string) {
    if (!currentUserId || !id) return;
    const key = feedTargetKey(targetType, targetId);
    const text = (commentDrafts[key] || '').trim();
    if (!text) return;

    setCommentDrafts(prev => ({ ...prev, [key]: '' }));
    const { data: inserted } = await supabase.from('feed_comments')
      .insert({ league_id: id, target_type: targetType, target_id: targetId, user_id: currentUserId, body: text })
      .select('id, user_id, body, created_at')
      .single();
    if (inserted) {
      setCommentsMap(prev => ({ ...prev, [key]: [...(prev[key] || []), inserted] }));
    }
  }

  function toggleEncourage(key: string) {
    setExpandedEncourage(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Populates encouragedToday from the DB (not just this session) so the
  // "✓ Encouraged" state survives a page reload instead of silently letting
  // you try again and hit the server-side daily cap with no visible reason.
  async function loadEncouragedToday() {
    if (!currentUserId) return;
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('encouragements')
      .select('to_user_id')
      .eq('from_user_id', currentUserId)
      .gte('created_at', todayStart.toISOString());
    setEncouragedToday(new Set((data || []).map((r: any) => r.to_user_id)));
  }

  async function sendEncouragement(toUserId: string, key: string) {
    const message = (encourageDrafts[key] || '').trim();
    if (!message) return;
    setSendingEncourage(prev => new Set(prev).add(key));
    setEncourageErrors(prev => ({ ...prev, [key]: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-encouragement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ toUserId, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEncourageErrors(prev => ({ ...prev, [key]: data.error || "Couldn't send. Try again later." }));
        if (res.status === 429) setEncouragedToday(prev => new Set(prev).add(toUserId));
        return;
      }
      setEncouragedToday(prev => new Set(prev).add(toUserId));
      setEncourageDrafts(prev => ({ ...prev, [key]: '' }));
      setExpandedEncourage(prev => { const next = new Set(prev); next.delete(key); return next; });
    } catch {
      setEncourageErrors(prev => ({ ...prev, [key]: 'Check your connection and try again.' }));
    } finally {
      setSendingEncourage(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  }

  function renderFeedSocialRow(targetType: 'activity' | 'race', targetId: string, ownerId: string) {
    const key = feedTargetKey(targetType, targetId);
    const reactions = reactionsMap[key] || [];
    const comments = commentsMap[key] || [];
    const myReaction = currentUserId ? reactions.find(r => r.user_id === currentUserId)?.emoji : undefined;
    const isExpanded = expandedComments.has(key);
    const isEncourageOpen = expandedEncourage.has(key);
    const canEncourage = !!currentUserId && ownerId !== currentUserId;
    const alreadyEncouragedToday = encouragedToday.has(ownerId);
    const isSending = sendingEncourage.has(key);

    const counts: Record<string, number> = {};
    reactions.forEach(r => { counts[r.emoji] = (counts[r.emoji] || 0) + 1; });

    return (
      <View style={styles.socialBlock}>
        <View style={styles.reactionRow}>
          {REACTION_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.reactionChip, myReaction === opt.value && styles.reactionChipActive]}
              onPress={() => toggleReaction(targetType, targetId, opt.value)}
            >
              <Text style={styles.reactionChipText}>{opt.label}{counts[opt.value] ? ` ${counts[opt.value]}` : ''}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => toggleComments(key)}>
            <Text style={styles.commentToggle}>💬 {comments.length > 0 ? comments.length : 'Comment'}</Text>
          </TouchableOpacity>
          {canEncourage && (
            <TouchableOpacity onPress={() => toggleEncourage(key)} disabled={alreadyEncouragedToday}>
              <Text style={[styles.commentToggle, alreadyEncouragedToday && { color: '#444444' }]}>
                {alreadyEncouragedToday ? '✓ Encouraged' : '📣 Encourage'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {isEncourageOpen && (
          <View style={styles.commentsBlock}>
            <View style={styles.encouragePresetRow}>
              {ENCOURAGE_PRESETS.map(preset => (
                <TouchableOpacity
                  key={preset}
                  style={styles.encouragePresetChip}
                  onPress={() => setEncourageDrafts(prev => ({ ...prev, [key]: preset }))}
                >
                  <Text style={styles.encouragePresetText}>{preset}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                value={encourageDrafts[key] || ''}
                onChangeText={(v) => setEncourageDrafts(prev => ({ ...prev, [key]: v }))}
                placeholder="Send a quick word of encouragement…"
                placeholderTextColor="#555"
                onSubmitEditing={() => sendEncouragement(ownerId, key)}
              />
              <TouchableOpacity onPress={() => sendEncouragement(ownerId, key)} disabled={isSending || !(encourageDrafts[key] || '').trim()}>
                <BusyText busy={!!(isSending)} style={styles.commentSendText}>{isSending ? '…' : 'Send'}</BusyText>
              </TouchableOpacity>
            </View>
            {!!encourageErrors[key] && <Text style={styles.encourageErrorText}>{encourageErrors[key]}</Text>}
          </View>
        )}

        {isExpanded && (
          <View style={styles.commentsBlock}>
            {comments.map(c => (
              <View key={c.id} style={styles.commentRow}>
                <Text style={styles.commentAuthor}>{memberName(c.user_id)}</Text>
                <Text style={styles.commentBody}>{c.body}</Text>
              </View>
            ))}
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                value={commentDrafts[key] || ''}
                onChangeText={(v) => setCommentDrafts(prev => ({ ...prev, [key]: v }))}
                placeholder="Add a comment…"
                placeholderTextColor="#555"
                onSubmitEditing={() => postComment(targetType, targetId)}
              />
              <TouchableOpacity onPress={() => postComment(targetType, targetId)} disabled={!(commentDrafts[key] || '').trim()}>
                <Text style={styles.commentSendText}>Post</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  function renderSessionCard(msg: ChatMessage) {
    const name = memberName(msg.user_id);
    const color = avatarColor(name);
    const avatar = memberAvatar(msg.user_id);
    const joiners = rsvpMap[msg.id] || [];
    const joined = currentUserId ? joiners.includes(currentUserId) : false;

    return (
      <View key={msg.id} style={styles.sessionCard}>
        <View style={styles.feedUserRow}>
          <TouchableOpacity style={styles.feedUserTapArea} onPress={() => goToProfile(msg.user_id)}>
            <View style={[styles.feedAvatar, { backgroundColor: color + '33', borderColor: color }]}>
              {avatar ? <Image source={{ uri: avatar }} style={styles.feedAvatarImg} /> : <Text style={[styles.feedAvatarText, { color }]}>{name.slice(0, 2).toUpperCase()}</Text>}
            </View>
            <Text style={styles.feedUserName}>{name}</Text>
          </TouchableOpacity>
          <Text style={styles.feedTimeAgo}>{timeAgo(msg.created_at)}</Text>
        </View>
        <Text style={styles.sessionCardTitle}>
          {ACTIVITY_ICONS[msg.activity_type || ''] || '🏅'} {msg.body || `${msg.activity_type} activity`}
        </Text>
        {msg.body && <Text style={styles.sessionCardSubtype}>{msg.activity_type}</Text>}
        <Text style={styles.sessionCardWhen}>{msg.scheduled_at ? formatDateTime(msg.scheduled_at) : ''}</Text>
        {msg.location && (
          <TouchableOpacity onPress={() => openInMaps(msg.location!)}>
            <Text style={styles.sessionCardLocation}>📍 {msg.location} <Text style={styles.sessionCardLocationLink}>(open in Maps)</Text></Text>
          </TouchableOpacity>
        )}
        <View style={styles.rsvpRow}>
          <Text style={[styles.rsvpStatus, joined && styles.rsvpStatusJoined]}>
            {joined
              ? `✓ You're in · ${joiners.length} ${joiners.length === 1 ? 'person' : 'people'} going`
              : `${joiners.length} ${joiners.length === 1 ? 'person' : 'people'} going`}
          </Text>
          <TouchableOpacity
            style={[styles.rsvpBtn, joined && styles.rsvpBtnLeave]}
            onPress={() => toggleRsvp(msg.id)}
          >
            <Text style={[styles.rsvpBtnText, joined && styles.rsvpBtnTextLeave]}>
              {joined ? 'Leave' : 'Join'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Desktop = the Stitch 3-column Team Hub; narrow = the existing stacked mobile layout.
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= BREAKPOINT_WIDE_LAYOUT;

  if (loading) {
    return (
      <SafeAreaView style={styles.flatContainer} edges={['top', 'left', 'right']}>
        <View style={styles.centered}><Text style={styles.loadingText}>Loading...</Text></View>
      </SafeAreaView>
    );
  }

  if (!league) {
    return (
      <SafeAreaView style={styles.flatContainer} edges={['top', 'left', 'right']}>
        <View style={styles.centered}><Text style={styles.loadingText}>Team not found.</Text></View>
      </SafeAreaView>
    );
  }

  // Shared layout blocks — rendered in different slots on mobile vs desktop.
  const mobileHeaderBlock = (
    <>
        <View style={styles.header}>
          {/* Prefer real history: the Team hub is reached from Team Feed, the
              Team Hub screen, Messages, Discover and Today's Weekly Leader, so
              no single hardcoded destination is right for all of them. Falls
              back to the Teams tab rather than Today — this screen belongs to
              that section. */}
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : goToTab('/team-feed'))} color={RivalColors.accentFill} />
          {isAdmin && (
            <TouchableOpacity onPress={() => router.push({ pathname: '/league-settings', params: { id } })}>
              <Text style={styles.settingsLink}>⚙️ Settings</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.leagueHeaderRow}>
          <TouchableOpacity onPress={uploadLeagueLogo} disabled={uploadingLogo} style={styles.leagueLogoWrap}>
            {league.logo_url ? (
              <Image source={{ uri: league.logo_url }} style={styles.leagueLogoImg} />
            ) : (
              <View style={styles.leagueLogoPlaceholder}>
                <Text style={styles.leagueLogoPlaceholderText}>🏟️</Text>
              </View>
            )}
            <View style={styles.leagueLogoEditBadge}>
              <Text style={styles.leagueLogoEditText}>{uploadingLogo ? '⏳' : '📷'}</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.leagueName}>{formatTeamName(league.name)}</Text>
        </View>
    </>
  );
  const infoBanners = (
    <>
        {journeyRace && (
          <View style={styles.journeyBanner}>
            <Text style={styles.journeyBannerIcon}>🚩</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.journeyBannerTitle}>
                {(() => { const d = daysUntilRace(journeyRace.race_date); return d === 0 ? 'Race day' : d > 0 ? `${d} days to ${journeyRace.name}` : `${journeyRace.name} — done!`; })()}
              </Text>
              <Text style={styles.journeyBannerSub}>Everyone here is training toward this together — different goals, same destination.</Text>
            </View>
          </View>
        )}

        {league.goal_metric && league.goal_target && league.goal_target_date ? (
          (() => {
            const target = league.goal_target!;
            const unit = GOAL_METRIC_UNIT[league.goal_metric!];
            const pct = target ? goalProgress / target : 0;
            const daysLeft = daysUntilRace(league.goal_target_date!);
            // Real elapsed time, no floor-to-1 — a challenge created minutes ago
            // has ~0 days elapsed, and forcing that to "1" produced a false
            // "100% behind pace" reading on day one. hasPaceData gates the
            // whole pace comparison off until there's actually enough signal.
            const realDaysElapsed = (Date.now() - new Date(league.created_at).getTime()) / 86400000;
            const hasPaceData = realDaysElapsed >= 1 && goalProgress > 0;
            const avgPerDay = hasPaceData ? goalProgress / realDaysElapsed : 0;
            const remaining = Math.max(0, target - goalProgress);
            const neededPerDay = daysLeft > 0 ? remaining / daysLeft : remaining;
            const paceDeltaPct = hasPaceData && neededPerDay > 0 ? Math.round(((avgPerDay - neededPerDay) / neededPerDay) * 100) : 0;
            const topValue = goalContributors[0]?.value || 1;
            const metricLabel = CHALLENGE_METRICS.find(m => m.value === league.goal_metric)?.label;
            return (
              <View style={styles.teamChallengeCard}>
                <TeamChallengePhoto>
                  <View style={styles.teamChallengeHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.teamChallengeEyebrow}>TEAM CHALLENGE</Text>
                      <Text style={styles.teamChallengeTitle}>{metricLabel}</Text>
                    </View>
                    {isAdmin && (
                      <TouchableOpacity
                        style={styles.teamChallengeEditBtn}
                        onPress={() => {
                          setGoalMetricDraft(league.goal_metric!);
                          setGoalTargetDraft(String(target));
                          setGoalDateDraft(isoToDisplayDate(league.goal_target_date!));
                          setShowGoalComposer(true);
                        }}
                      >
                        <Text style={styles.teamChallengeEdit}>Edit</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={styles.teamChallengeRingWrap}>
                    <TeamChallengeRing pct={pct} value={Math.round(goalProgress)} unit={`/ ${target.toLocaleString()} ${unit}`} />
                  </View>

                  <View style={styles.teamChallengeMetaRow}>
                    <Text style={styles.teamChallengeMeta}><Text style={styles.teamChallengeMetaBold}>{Math.round(pct * 100)}%</Text> complete</Text>
                    <Text style={styles.teamChallengeMeta}>
                      <Text style={styles.teamChallengeMetaBold}>{daysLeft > 0 ? daysLeft : 0}</Text> {daysLeft === 1 ? 'day' : 'days'} left
                    </Text>
                  </View>
                </TeamChallengePhoto>

                <View style={styles.teamChallengeBody}>
                  <View style={[styles.paceCard, paceCardWeb]}>
                    <View style={styles.paceIcon}>
                      <RivalIcon name="bolt" size={18} color={RivalColors.accentText} />
                    </View>
                    <View style={{ flex: 1 }}>
                      {!hasPaceData ? (
                        <>
                          <Text style={styles.paceTitle}>Just getting started</Text>
                          <Text style={styles.paceSub}>Every activity logged from here counts toward the goal.</Text>
                        </>
                      ) : paceDeltaPct >= 0 ? (
                        <>
                          <Text style={styles.paceTitle}>Ahead of pace</Text>
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
                    {hasPaceData && <RivalIcon name={paceDeltaPct >= 0 ? 'trendUp' : 'trendDown'} size={20} color={RivalColors.accentFill} />}
                  </View>

                  <View style={styles.statMiniRow}>
                    <View style={[styles.statMiniCard, warmCardWeb]}>
                      <Text style={styles.statMiniVal}>{hasPaceData ? (Math.round(avgPerDay * 10) / 10).toLocaleString() : '—'}</Text>
                      <Text style={styles.statMiniLbl}>{unit}/DAY{'\n'}TEAM AVG</Text>
                    </View>
                    <View style={[styles.statMiniCard, warmCardWeb]}>
                      <Text style={styles.statMiniVal}>{(Math.round(remaining * 10) / 10).toLocaleString()}</Text>
                      <Text style={styles.statMiniLbl}>{unit} TO GO</Text>
                    </View>
                    <View style={[styles.statMiniCard, warmCardWeb]}>
                      <Text style={styles.statMiniVal}>{daysLeft > 0 ? daysLeft : 0}</Text>
                      <Text style={styles.statMiniLbl}>DAYS LEFT</Text>
                    </View>
                  </View>

                  {goalContributors.length > 0 && (
                    <View style={styles.teamChallengeContributors}>
                      <Text style={styles.teamChallengeSectionTitle}>Top Contributors</Text>
                      {goalContributors.slice(0, 5).map((c, i) => {
                        const member = members.find(m => m.user_id === c.userId);
                        if (!member) return null;
                        const name = getDisplayName(member);
                        return (
                          <TouchableOpacity key={c.userId} style={styles.contribRow} onPress={() => goToProfile(c.userId)}>
                            <Text style={styles.contribRank}>{i + 1}</Text>
                            <View style={{ position: 'relative' }}>
                              {i === 0 && (
                                <View style={styles.contribCrown}>
                                  <RivalIcon name="crown" size={14} color={RivalColors.accentGold} />
                                </View>
                              )}
                              <RivalAvatar uri={member.users?.avatar_url} name={name} size={32} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[styles.contribName, i === 0 && styles.contribGold]}>{name}</Text>
                              <View style={{ marginTop: 4 }}>
                                <RivalProgressBar pct={c.value / topValue} height={4} />
                              </View>
                            </View>
                            <Text style={[styles.contribValue, i === 0 && styles.contribGold]}>{c.value.toLocaleString()} {unit}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
            );
          })()
        ) : isAdmin && !journeyRace ? (
          <TouchableOpacity
            style={[styles.teamChallengeEmpty, warmCardWeb]}
            onPress={() => {
              setGoalMetricDraft('distance');
              setGoalTargetDraft('');
              setGoalDateDraft('');
              setShowGoalComposer(true);
            }}
          >
            <View style={styles.paceIcon}>
              <RivalIcon name="target" size={20} color={RivalColors.accentText} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamChallengeEmptyTitle}>Start a Team Challenge</Text>
              <Text style={styles.teamChallengeEmptySub}>Set a shared distance, effort, or elevation target — everyone's activity counts toward it.</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {showGoalComposer && (
          <View style={styles.sessionComposer}>
            <Text style={styles.challengeModalTitle}>🎯 Team Challenge</Text>
            <Text style={styles.composerLabel}>Metric</Text>
            <View style={styles.typeChipRow}>
              {CHALLENGE_METRICS.map(m => (
                <TouchableOpacity key={m.value} style={[styles.typeChip, goalMetricDraft === m.value && styles.typeChipActive]} onPress={() => setGoalMetricDraft(m.value)}>
                  <Text style={[styles.typeChipText, goalMetricDraft === m.value && styles.typeChipTextActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.composerLabel}>Target ({GOAL_METRIC_UNIT[goalMetricDraft]})</Text>
            <TextInput
              style={styles.composerInput}
              value={goalTargetDraft}
              onChangeText={setGoalTargetDraft}
              placeholder="e.g. 1000"
              placeholderTextColor="#555"
              keyboardType="numeric"
            />
            <Text style={styles.composerLabel}>Target date</Text>
            <RivalDateField value={goalDateDraft} onChangeText={setGoalDateDraft} inputStyle={styles.composerInput} />
            <View style={styles.editModalButtons}>
              <TouchableOpacity style={styles.editCancelButton} onPress={() => setShowGoalComposer(false)}>
                <Text style={styles.editCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.postSessionBtn} onPress={saveTeamGoal} disabled={savingGoal}>
                <BusyText busy={!!(savingGoal)} style={styles.postSessionBtnText}>{savingGoal ? 'Saving…' : 'Save Challenge'}</BusyText>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {seasonDaysLeft <= 30 && seasonDaysLeft > 0 && (
          <View style={styles.seasonBanner}>
            <RivalIcon name="timerOutline" size={18} color={RivalColors.accentText} />
            <Text style={styles.seasonBannerText}>{seasonDaysLeft === 1 ? 'Last day of the year' : `${seasonDaysLeft} days left in the year`} · ranks reset 1 January</Text>
          </View>
        )}
    </>
  );
  const standingsBlock = (
    <>
        {/* Week navigator */}
        <View style={styles.weekNav}>
          <TouchableOpacity onPress={() => setWeekOffset(weekOffset - 1)} style={styles.weekArrow}>
            <Text style={styles.weekArrowText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.weekLabel}>{weekLabel(weekOffset)}</Text>
          <TouchableOpacity
            onPress={() => setWeekOffset(Math.min(0, weekOffset + 1))}
            style={styles.weekArrow}
            disabled={weekOffset === 0}
          >
            <Text style={[styles.weekArrowText, weekOffset === 0 && { color: '#3A3A3A' }]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Plan week shortcut */}
        {weekOffset === 0 && (
          <TouchableOpacity style={styles.planLink} onPress={() => router.push('/plan')}>
            <Text style={styles.planLinkText}>📋 Plan your week → see where you'll land</Text>
          </TouchableOpacity>
        )}

        {/* Leaderboard */}
        <View style={styles.leaderboard}>
          {members.length === 0 && (
            <Text style={styles.emptyText}>No activity this week yet.</Text>
          )}
          {members.map((member, index) => {
            const lvl = getLevel(member.all_time_xp ?? 0);
            return (
              <TouchableOpacity
                key={member.user_id}
                style={[
                  styles.memberRow,
                  member.user_id === currentUserId && styles.memberRowSelf,
                ]}
                onPress={() => goToProfile(member.user_id)}
              >
                {/* Rank position */}
                <Text style={styles.rankEmoji}>{getRankEmoji(index)}</Text>

                {/* Avatar */}
                {member.users?.avatar_url ? (
                  <Image source={{ uri: member.users.avatar_url }} style={styles.memberAvatar} />
                ) : (
                  <View style={styles.memberAvatarFallback}>
                    <Text style={styles.memberAvatarText}>
                      {getDisplayName(member)[0].toUpperCase()}
                    </Text>
                  </View>
                )}

                {/* Name + badges */}
                <View style={styles.memberInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.memberName}>
                      {getDisplayName(member)}
                    </Text>
                    {member.isHot && <Text style={styles.hotBadge}>🔥</Text>}
                    {member.user_id === mvpUserId && <Text style={styles.mvpBadge}>👑 MVP</Text>}
                  </View>
                  <View style={styles.badgeRow}>
                    <View style={[styles.lvlBadge, { backgroundColor: lvl.color + '22', borderColor: lvl.color + '55' }]}>
                      <Text style={[styles.lvlBadgeText, { color: lvl.color }]}>LVL {lvl.level}</Text>
                    </View>
                    {member.role === 'admin' && <Text style={styles.adminBadge}>Admin</Text>}
                  </View>
                  {journeyRace && member.user_id === currentUserId && (
                    editingGoal ? (
                      <View style={styles.goalEditRow} onStartShouldSetResponder={() => true}>
                        <TextInput
                          style={styles.goalInput}
                          value={goalDraft}
                          onChangeText={setGoalDraft}
                          placeholder="e.g. sub-3 hours"
                          placeholderTextColor="#666666"
                          autoFocus
                          onSubmitEditing={saveGoal}
                          onBlur={saveGoal}
                          maxLength={40}
                        />
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation?.(); setGoalDraft(member.personal_goal ?? ''); setEditingGoal(true); }}
                      >
                        <Text style={styles.goalText}>
                          🎯 {member.personal_goal || 'Set your goal for this race'}
                        </Text>
                      </TouchableOpacity>
                    )
                  )}
                  {journeyRace && member.user_id !== currentUserId && member.personal_goal && (
                    <Text style={styles.goalText}>🎯 {member.personal_goal}</Text>
                  )}
                </View>

                {/* Score + rank change + challenge */}
                <View style={styles.scoreBlock}>
                  <Text style={[styles.score, member.total_score === 0 && { color: '#444444' }]}>
                    {member.total_score > 0 ? `${member.total_score} Effort` : '—'}
                  </Text>
                  {member.week_time_minutes > 0 && (
                    <Text style={styles.memberTimeEarned}>
                      ⏱ {Math.floor(member.week_time_minutes / 60) > 0 ? `${Math.floor(member.week_time_minutes / 60)}h ` : ''}{member.week_time_minutes % 60}m
                    </Text>
                  )}
                  <RankArrow change={member.rank_change} />
                  {member.user_id !== currentUserId && (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setChallengeModalFor(member.user_id); }} style={styles.challengeIconBtn}>
                      <Text style={styles.challengeIconText}>⚔️</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
    </>
  );
  const letsTrainBlock = (
    <>
        {/* Let's Train — instant invite */}
        <TouchableOpacity style={styles.letsTrainBtn} onPress={() => setShowQuickTrain(!showQuickTrain)}>
          <Text style={styles.letsTrainBtnText}>{showQuickTrain ? 'Cancel' : 'Train together now'}</Text>
        </TouchableOpacity>

        {showQuickTrain && (
          <View style={styles.quickTrainCard}>
            <Text style={styles.composerLabel}>Activity</Text>
            <View style={styles.typeChipRow}>
              {SESSION_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, quickTrainType === t && styles.typeChipActive]}
                  onPress={() => setQuickTrainType(t)}
                >
                  <Text style={[styles.typeChipText, quickTrainType === t && styles.typeChipTextActive]}>
                    {ACTIVITY_ICONS[t] || '🏅'} {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.composerLabel}>Starting in</Text>
            <View style={styles.typeChipRow}>
              {[0, 15, 30, 60].map((mins) => (
                <TouchableOpacity
                  key={mins}
                  style={[styles.typeChip, quickTrainMinutes === mins && styles.typeChipActive]}
                  onPress={() => setQuickTrainMinutes(mins)}
                >
                  <Text style={[styles.typeChipText, quickTrainMinutes === mins && styles.typeChipTextActive]}>
                    {mins === 0 ? 'Now' : `${mins} min`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.composerLabel}>Location (optional)</Text>
            <TextInput style={styles.composerInput} value={quickTrainLocation} onChangeText={setQuickTrainLocation} placeholder="e.g. Coastal Track car park, Mission Bay" placeholderTextColor="#555" />
            <TouchableOpacity style={styles.postSessionBtn} onPress={postQuickTrain} disabled={postingQuickTrain}>
              <BusyText busy={!!(postingQuickTrain)} style={styles.postSessionBtnText}>{postingQuickTrain ? 'Sending…' : "Notify the team 🔔"}</BusyText>
            </TouchableOpacity>
          </View>
        )}
    </>
  );
  const tabSwitcherBlock = (
    <>
        {/* Tab switcher */}
        <View style={styles.tabSwitchRow}>
          <TouchableOpacity
            style={[styles.tabSwitchBtn, activeTab === 'feed' && styles.tabSwitchBtnActive]}
            onPress={() => setActiveTab('feed')}
          >
            <Text style={[styles.tabSwitchText, activeTab === 'feed' && styles.tabSwitchTextActive]}>Feed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabSwitchBtn, activeTab === 'sessions' && styles.tabSwitchBtnActive]}
            onPress={() => setActiveTab('sessions')}
          >
            <Text style={[styles.tabSwitchText, activeTab === 'sessions' && styles.tabSwitchTextActive]}>📅 Activities</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabSwitchBtn, activeTab === 'challenges' && styles.tabSwitchBtnActive]}
            onPress={() => setActiveTab('challenges')}
          >
            <Text style={[styles.tabSwitchText, activeTab === 'challenges' && styles.tabSwitchTextActive]}>⚔️</Text>
          </TouchableOpacity>
        </View>
    </>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Fixed viewport-covering background — decoupled from content height on
          purpose (matches the mockup's own `position: fixed; inset: 0`), so a
          long feed scrolling taller than one screen never outgrows the photo. */}
      <RivalFixedBackground
        source={require('../../assets/images/backgrounds/optimized/ridge-runners-hazy-backlit.jpg')}
        focalPoint="55% 65%"
      />
      <View style={styles.scrim} />
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Shared persistent nav, matching every other screen — this page had
          grown its own bespoke desktop-only nav bar (different logo styling,
          wrong Teams link pointing at /home, no avatar/rank, hidden on
          mobile) instead of the one every other screen uses. */}
      <RivalTopNav active="teams" />
      <View style={wide ? styles.bodyRow : styles.bodyFill}>
        {wide && (
          <View style={styles.sidebar}>
            <View style={styles.sidebarTeamRow}>
              <TouchableOpacity onPress={uploadLeagueLogo} disabled={uploadingLogo}>
                {league.logo_url ? (
                  <Image source={{ uri: league.logo_url }} style={styles.sidebarLogoImg} />
                ) : (
                  <View style={styles.sidebarLogoPh}><Text>🏟️</Text></View>
                )}
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.sidebarTeamName} numberOfLines={1}>{formatTeamName(league.name)}</Text>
                <Text style={styles.sidebarTeamLabel}>TEAM HUB</Text>
              </View>
            </View>

            <TouchableOpacity style={[styles.sideNavItem, activeTab === 'feed' && styles.sideNavItemActive]} onPress={() => setActiveTab('feed')}>
              <Text style={[styles.sideNavText, activeTab === 'feed' && styles.sideNavTextActive]}>Team Feed</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sideNavItem, activeTab === 'sessions' && styles.sideNavItemActive]} onPress={() => setActiveTab('sessions')}>
              <Text style={[styles.sideNavText, activeTab === 'sessions' && styles.sideNavTextActive]}>Activities</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sideNavItem, activeTab === 'challenges' && styles.sideNavItemActive]} onPress={() => setActiveTab('challenges')}>
              <Text style={[styles.sideNavText, activeTab === 'challenges' && styles.sideNavTextActive]}>Challenges</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sideNavItem} onPress={() => goToTab('/my-activities')}>
              <Text style={styles.sideNavText}>Activity</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            <TouchableOpacity style={styles.sideInvite} onPress={copyInviteCode}>
              <Text style={styles.sideInviteLabel}>INVITE CODE</Text>
              <Text style={styles.sideInviteCode}>{league.invite_code}  ⧉</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sideAddBtn} onPress={() => router.push('/add-workout')}>
              <Text style={styles.sideAddBtnText}>+ Add Workout</Text>
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity style={styles.sideQuiet} onPress={() => router.push({ pathname: '/league-settings', params: { id } })}>
                <Text style={styles.sideQuietText}>⚙️ Settings</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.sideQuiet} onPress={leaveTeam}>
              <Text style={[styles.sideQuietText, { color: RivalColors.error }]}>Leave Team</Text>
            </TouchableOpacity>
          </View>
        )}

        <ScrollView style={styles.centerScroll} contentContainerStyle={wide ? styles.contentWide : styles.content}>
        {wide && (
          <View style={styles.centerHeader}>
            <Text style={styles.centerTitle}>
              {activeTab === 'feed' ? 'Team Feed' : activeTab === 'sessions' ? 'Activities' : 'Challenges'}
            </Text>
            <Text style={styles.centerSub}>{formatTeamName(league.name)} · {members.length} {members.length === 1 ? 'member' : 'members'}</Text>
          </View>
        )}
        {!wide && (
          <>
            {mobileHeaderBlock}
            {infoBanners}
            {standingsBlock}
            {letsTrainBlock}
            {tabSwitcherBlock}
          </>
        )}
        {activeTab === 'feed' && (
        <>
        {/* League feed */}
        {!wide && (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Team Feed</Text>
        </View>
        )}

        {feedLoading ? (
          <Text style={styles.feedLoadingText}>Loading…</Text>
        ) : feedItems.length === 0 ? (
          <View style={styles.feedEmpty}>
            <Text style={styles.feedEmptyIcon}>🏋️</Text>
            <Text style={styles.feedEmptyText}>No activity yet</Text>
            <Text style={styles.feedEmptySubText}>Activities from this team's members will show up here.</Text>
          </View>
        ) : (
          <View style={styles.feedList}>
            {feedItems.map(item => {
              const color = avatarColor(item.name);
              const initials = item.name.slice(0, 2).toUpperCase();
              const isMe = item.userId === currentUserId;
              const displayedName = item.name;

              const userRow = (
                <View style={styles.feedUserRow}>
                  <TouchableOpacity style={styles.feedUserTapArea} onPress={() => goToProfile(item.userId)}>
                    <View style={[styles.feedAvatar, { backgroundColor: color + '33', borderColor: color }]}>
                      {feedAvatarMap[item.userId] ? (
                        <Image source={{ uri: feedAvatarMap[item.userId]! }} style={styles.feedAvatarImg} />
                      ) : (
                        <Text style={[styles.feedAvatarText, { color }]}>{initials}</Text>
                      )}
                    </View>
                    <Text style={styles.feedUserName}>{displayedName}</Text>
                  </TouchableOpacity>
                  <View style={styles.feedTimeCol}>
                    <Text style={styles.feedTimeAgo}>{timeAgo(item.ts)}</Text>
                    <Text style={styles.feedDateTime}>{formatDateTime(item.ts)}</Text>
                  </View>
                </View>
              );

              if (item.kind === 'activity') {
                const icon = ACTIVITY_ICONS[item.activityType] ?? '🏅';
                const distKm = item.distanceMeters > 100
                  ? ` · ${(item.distanceMeters / 1000).toFixed(1)} km`
                  : '';
                return (
                  <View key={`act-${item.id}`} style={[styles.feedCard, item.pbLift && styles.feedCardPb]}>
                    {userRow}
                    {item.pbLift && (
                      <View style={styles.feedPbBanner}>
                        <Text style={styles.feedPbBannerText}>🏆 New PB — {item.pbLift}</Text>
                      </View>
                    )}
                    <View style={styles.feedActivityRow}>
                      <Text style={styles.feedActivityIcon}>{icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.feedActivityType}>{item.activityName || item.activityType}</Text>
                        <Text style={styles.feedActivityMeta}>{formatDuration(item.durationSeconds)}{distKm}</Text>
                        {item.insight && (
                          <View style={styles.feedInsightRow}>
                            <RivalIcon name={INSIGHT_ICON[item.insight.tone]} size={11} color={INSIGHT_COLOR[item.insight.tone]} />
                            <Text style={[styles.feedInsightText, { color: INSIGHT_COLOR[item.insight.tone] }]}>{item.insight.text}</Text>
                          </View>
                        )}
                      </View>
                      {item.xp > 0 && (
                        <View style={styles.feedXpPill}>
                          <Text style={styles.feedXpText}>+{item.xp} Effort</Text>
                        </View>
                      )}
                      {isMe && (
                        <TouchableOpacity
                          style={styles.feedEditBtn}
                          onPress={() => router.push(`/scan-workout?activityId=${item.id}`)}
                        >
                          <Text style={styles.feedEditBtnText}>✏️</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {(feedMediaMap[item.id]?.length ?? 0) > 0 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.feedGalleryRow}>
                        {feedMediaMap[item.id].map((m) => (
                          m.media_type === 'video' ? (
                            <video
                              key={m.id}
                              src={m.media_url}
                              controls
                              style={{ width: 260, height: 260, borderRadius: 10, backgroundColor: '#2A2A2A' } as any}
                            />
                          ) : (
                            <Image key={m.id} source={{ uri: m.media_url }} style={styles.feedGalleryPhoto} resizeMode="cover" />
                          )
                        ))}
                      </ScrollView>
                    )}
                    {renderFeedSocialRow('activity', item.id, item.userId)}
                  </View>
                );
              }

              if (item.kind === 'session') {
                return renderSessionCard(item.message);
              }

              if (item.kind === 'race') {
                const raceDateLabel = new Date(item.raceDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                return (
                  <View key={`race-${item.id}`} style={[styles.feedCard, styles.feedCardRace]}>
                    {userRow}
                    <Text style={styles.feedRaceAction}>🏁 signed up for a race</Text>
                    <Text style={styles.feedRaceName}>{item.raceName}</Text>
                    <Text style={styles.feedRaceDate}>{raceDateLabel}</Text>
                    {renderFeedSocialRow('race', item.id, item.userId)}
                  </View>
                );
              }

              return null;
            })}
          </View>
        )}
        </>
        )}


        {activeTab === 'sessions' && (() => {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          const upcoming = allSessions
            .filter(s => !s.scheduled_at || new Date(s.scheduled_at).getTime() >= cutoff)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          const history = allSessions
            .filter(s => s.scheduled_at && new Date(s.scheduled_at).getTime() < cutoff)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          const list = sessionsView === 'upcoming' ? upcoming : history;

          return (
            <View style={styles.chatSection}>
              <View style={styles.sessionsViewRow}>
                <TouchableOpacity
                  style={[styles.sessionsViewBtn, sessionsView === 'upcoming' && styles.sessionsViewBtnActive]}
                  onPress={() => setSessionsView('upcoming')}
                >
                  <Text style={[styles.sessionsViewText, sessionsView === 'upcoming' && styles.sessionsViewTextActive]}>Upcoming</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sessionsViewBtn, sessionsView === 'history' && styles.sessionsViewBtnActive]}
                  onPress={() => setSessionsView('history')}
                >
                  <Text style={[styles.sessionsViewText, sessionsView === 'history' && styles.sessionsViewTextActive]}>History</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.planSessionBtn} onPress={() => setShowSessionComposer(!showSessionComposer)}>
                <Text style={styles.planSessionBtnText}>{showSessionComposer ? '✕ Cancel' : '📅 Plan an Activity'}</Text>
              </TouchableOpacity>

              {showSessionComposer && (
                <View style={styles.sessionComposer}>
                  <Text style={styles.composerLabel}>Activity</Text>
                  <View style={styles.typeChipRow}>
                    {SESSION_TYPES.map((t) => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.typeChip, sessionType === t && styles.typeChipActive]}
                        onPress={() => setSessionType(t)}
                      >
                        <Text style={[styles.typeChipText, sessionType === t && styles.typeChipTextActive]}>
                          {ACTIVITY_ICONS[t] || '🏅'} {t}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.composerLabel}>Title</Text>
                  <TextInput style={styles.composerInput} value={sessionNote} onChangeText={setSessionNote} placeholder="e.g. Saturday Sunrise Run" placeholderTextColor="#555" />
                  <View style={styles.composerRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.composerLabel}>Date</Text>
                      <RivalDateField value={sessionDate} onChangeText={setSessionDate} inputStyle={styles.composerInput} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.composerLabel}>Time</Text>
                      <TextInput style={styles.composerInput} value={sessionTime} onChangeText={setSessionTime} placeholder="HH:MM" placeholderTextColor="#555" />
                    </View>
                  </View>
                  <Text style={styles.composerLabel}>Location (optional)</Text>
                  <TextInput style={styles.composerInput} value={sessionLocation} onChangeText={setSessionLocation} placeholder="e.g. Coastal Track car park, Mission Bay" placeholderTextColor="#555" />
                  <Text style={styles.composerHint}>Tappable in Maps — include the suburb/city so it finds the right spot.</Text>
                  <TouchableOpacity style={styles.postSessionBtn} onPress={async () => { await postSession(); loadSessions(); }} disabled={postingSession}>
                    <BusyText busy={!!(postingSession)} style={styles.postSessionBtnText}>{postingSession ? 'Posting…' : 'Post activity'}</BusyText>
                  </TouchableOpacity>
                </View>
              )}

              {sessionsLoading ? (
                <Text style={styles.feedLoadingText}>Loading…</Text>
              ) : list.length === 0 ? (
                <View style={styles.feedEmpty}>
                  <Text style={styles.feedEmptyIcon}>📅</Text>
                  <Text style={styles.feedEmptyText}>{sessionsView === 'upcoming' ? 'No activities planned' : 'No past activities'}</Text>
                  <Text style={styles.feedEmptySubText}>
                    {sessionsView === 'upcoming' ? 'Plan a run, ride, or workout together.' : 'Activities move here a day after they happen.'}
                  </Text>
                </View>
              ) : (
                <View style={styles.chatList}>
                  {list.map(s => renderSessionCard(s))}
                </View>
              )}
            </View>
          );
        })()}

        {activeTab === 'challenges' && (
          <View style={styles.chatSection}>
            {challengeModalFor && (
              <View style={styles.sessionComposer}>
                <Text style={styles.challengeModalTitle}>⚔️ Challenge {memberName(challengeModalFor)}</Text>
                <Text style={styles.composerLabel}>Metric</Text>
                <View style={styles.typeChipRow}>
                  {CHALLENGE_METRICS.map(m => (
                    <TouchableOpacity key={m.value} style={[styles.typeChip, challengeMetric === m.value && styles.typeChipActive]} onPress={() => setChallengeMetric(m.value)}>
                      <Text style={[styles.typeChipText, challengeMetric === m.value && styles.typeChipTextActive]}>{m.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.composerLabel}>Duration</Text>
                <View style={styles.typeChipRow}>
                  {[3, 7, 14].map(d => (
                    <TouchableOpacity key={d} style={[styles.typeChip, challengeDays === d && styles.typeChipActive]} onPress={() => { setChallengeDays(d); setCustomChallengeDays(''); }}>
                      <Text style={[styles.typeChipText, challengeDays === d && styles.typeChipTextActive]}>{d} days</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[styles.typeChip, challengeDays === -1 && styles.typeChipActive]} onPress={() => setChallengeDays(-1)}>
                    <Text style={[styles.typeChipText, challengeDays === -1 && styles.typeChipTextActive]}>Custom</Text>
                  </TouchableOpacity>
                </View>
                {challengeDays === -1 && (
                  <TextInput
                    style={styles.composerInput}
                    value={customChallenDays}
                    onChangeText={setCustomChallengeDays}
                    placeholder="Number of days"
                    placeholderTextColor="#555"
                    keyboardType="number-pad"
                  />
                )}
                <View style={styles.editModalButtons}>
                  <TouchableOpacity style={styles.editCancelButton} onPress={() => setChallengeModalFor(null)}>
                    <Text style={styles.editCancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.postSessionBtn} onPress={createChallenge} disabled={postingChallenge}>
                    <BusyText busy={!!(postingChallenge)} style={styles.postSessionBtnText}>{postingChallenge ? 'Sending…' : 'Send Challenge'}</BusyText>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {challengesLoading ? (
              <Text style={styles.feedLoadingText}>Loading…</Text>
            ) : (
              <>
                {challenges.filter(c => c.status === 'pending').length > 0 && (
                  <View>
                    <Text style={styles.challengeSectionTitle}>Pending</Text>
                    {challenges.filter(c => c.status === 'pending').map(c => {
                      const isChallenger = c.challenger_id === currentUserId;
                      const other = isChallenger ? c.opponent_id : c.challenger_id;
                      return (
                        <View key={c.id} style={styles.challengeCard}>
                          <Text style={styles.challengeVsText}>
                            {isChallenger ? `You challenged ${memberName(other)}` : `${memberName(other)} challenged you`}
                          </Text>
                          <Text style={styles.challengeDetail}>
                            {CHALLENGE_METRICS.find(m => m.value === c.metric)?.label} · {c.start_date} → {c.end_date}
                          </Text>
                          {!isChallenger && (
                            <View style={styles.typeChipRow}>
                              <TouchableOpacity style={styles.postSessionBtn} onPress={() => respondToChallenge(c.id, true)}>
                                <Text style={styles.postSessionBtnText}>Accept</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.editCancelButton} onPress={() => respondToChallenge(c.id, false)}>
                                <Text style={styles.editCancelButtonText}>Decline</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                          {isChallenger && <Text style={styles.challengePending}>Waiting for response…</Text>}
                        </View>
                      );
                    })}
                  </View>
                )}

                {challenges.filter(c => c.status === 'active').length > 0 && (
                  <View>
                    <Text style={styles.challengeSectionTitle}>Active</Text>
                    {challenges.filter(c => c.status === 'active').map(c => {
                      const p = challengeProgress[c.id] || { challenger: 0, opponent: 0 };
                      const max = Math.max(p.challenger, p.opponent, 1);
                      const metricLabel = CHALLENGE_METRICS.find(m => m.value === c.metric)?.label ?? c.metric;
                      return (
                        <View key={c.id} style={styles.challengeCard}>
                          <Text style={styles.challengeVsText}>{memberName(c.challenger_id)} vs {memberName(c.opponent_id)}</Text>
                          <Text style={styles.challengeDetail}>{metricLabel} · ends {c.end_date}</Text>
                          <View style={styles.challengeProgressBlock}>
                            <Text style={styles.challengeProgressLabel}>{memberName(c.challenger_id)}</Text>
                            <View style={styles.challengeTrack}>
                              <View style={[styles.challengeBar, { width: `${Math.round((p.challenger / max) * 100)}%`, backgroundColor: RivalColors.accentFill } as any]} />
                            </View>
                            <Text style={styles.challengeProgressScore}>{p.challenger}</Text>
                          </View>
                          <View style={styles.challengeProgressBlock}>
                            <Text style={styles.challengeProgressLabel}>{memberName(c.opponent_id)}</Text>
                            <View style={styles.challengeTrack}>
                              <View style={[styles.challengeBar, { width: `${Math.round((p.opponent / max) * 100)}%`, backgroundColor: '#4FC3F7' } as any]} />
                            </View>
                            <Text style={styles.challengeProgressScore}>{p.opponent}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {challenges.filter(c => c.status === 'completed').length > 0 && (
                  <View>
                    <Text style={styles.challengeSectionTitle}>History</Text>
                    {challenges.filter(c => c.status === 'completed').map(c => {
                      const metricLabel = CHALLENGE_METRICS.find(m => m.value === c.metric)?.label ?? c.metric;
                      const winnerName = c.winner_id ? memberName(c.winner_id) : null;
                      return (
                        <View key={c.id} style={styles.challengeCard}>
                          <Text style={styles.challengeVsText}>{memberName(c.challenger_id)} vs {memberName(c.opponent_id)}</Text>
                          <Text style={styles.challengeDetail}>{metricLabel} · {c.start_date} → {c.end_date}</Text>
                          <Text style={[styles.challengeWinner, { color: winnerName ? '#FFC940' : '#999999' }]}>
                            {winnerName ? `🏆 ${winnerName} won` : '🤝 Draw'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {challenges.length === 0 && (
                  <View style={styles.feedEmpty}>
                    <Text style={styles.feedEmptyIcon}>⚔️</Text>
                    <Text style={styles.feedEmptyText}>No challenges yet</Text>
                    <Text style={styles.feedEmptySubText}>Tap ⚔️ next to a member to challenge them.</Text>
                  </View>
                )}
              </>
            )}

            {/* Team vs Team */}
            <Text style={styles.challengeSectionTitle}>🏟️ Team vs Team</Text>
            <TouchableOpacity style={styles.lvlChallengeBtn} onPress={openLvlModal}>
              <Text style={styles.lvlChallengeBtnText}>⚔️ Challenge another team</Text>
            </TouchableOpacity>

            {showLvlModal && (
              <View style={styles.sessionComposer}>
                <Text style={styles.challengeModalTitle}>Challenge a Team</Text>
                <TextInput style={styles.composerInput} value={lvlSearch} onChangeText={setLvlSearch} placeholder="Search teams…" placeholderTextColor="#555" />
                <View style={styles.lvlLeaguePickerList}>
                  {allLeaguesForPicker.filter(l => l.name.toLowerCase().includes(lvlSearch.toLowerCase())).map(l => (
                    <TouchableOpacity
                      key={l.id}
                      style={[styles.lvlLeaguePickerRow, lvlTargetLeague === l.id && styles.lvlLeaguePickerRowActive]}
                      onPress={() => setLvlTargetLeague(l.id)}
                    >
                      <Text style={styles.lvlLeaguePickerText}>{formatTeamName(l.name)}</Text>
                      {lvlTargetLeague === l.id && <Text style={{ color: RivalColors.accentText }}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.composerLabel}>Metric</Text>
                <View style={styles.typeChipRow}>
                  {CHALLENGE_METRICS.map(m => (
                    <TouchableOpacity key={m.value} style={[styles.typeChip, lvlMetric === m.value && styles.typeChipActive]} onPress={() => setLvlMetric(m.value)}>
                      <Text style={[styles.typeChipText, lvlMetric === m.value && styles.typeChipTextActive]}>{m.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.composerLabel}>Duration</Text>
                <View style={styles.typeChipRow}>
                  {[3, 7, 14].map(d => (
                    <TouchableOpacity key={d} style={[styles.typeChip, lvlDays === d && styles.typeChipActive]} onPress={() => { setLvlDays(d); setLvlCustomDays(''); }}>
                      <Text style={[styles.typeChipText, lvlDays === d && styles.typeChipTextActive]}>{d} days</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[styles.typeChip, lvlDays === -1 && styles.typeChipActive]} onPress={() => setLvlDays(-1)}>
                    <Text style={[styles.typeChipText, lvlDays === -1 && styles.typeChipTextActive]}>Custom</Text>
                  </TouchableOpacity>
                </View>
                {lvlDays === -1 && (
                  <TextInput style={styles.composerInput} value={lvlCustomDays} onChangeText={setLvlCustomDays} placeholder="Number of days" placeholderTextColor="#555" keyboardType="number-pad" />
                )}
                <View style={styles.editModalButtons}>
                  <TouchableOpacity style={styles.editCancelButton} onPress={() => setShowLvlModal(false)}>
                    <Text style={styles.editCancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.postSessionBtn, (!lvlTargetLeague || postingLvl) && { opacity: 0.5 }]} onPress={sendLvlChallenge} disabled={!lvlTargetLeague || postingLvl}>
                    <BusyText busy={!!(postingLvl)} style={styles.postSessionBtnText}>{postingLvl ? 'Sending…' : 'Send Challenge'}</BusyText>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {lvlChallenges.filter(c => c.status === 'pending').map(c => {
              const isChallenger = c.challenger_league_id === id;
              const otherLeague = allLeaguesForPicker.find(l => l.id === (isChallenger ? c.opponent_league_id : c.challenger_league_id));
              const otherName = otherLeague ? formatTeamName(otherLeague.name) : (isChallenger ? c.opponent_league_id : c.challenger_league_id);
              return (
                <View key={c.id} style={styles.challengeCard}>
                  <Text style={styles.challengeVsText}>
                    {isChallenger ? `You challenged ${otherName}` : `${otherName} challenged your team`}
                  </Text>
                  <Text style={styles.challengeDetail}>{CHALLENGE_METRICS.find(m => m.value === c.metric)?.label} · {c.start_date} → {c.end_date}</Text>
                  {!isChallenger && isAdmin && (
                    <View style={styles.typeChipRow}>
                      <TouchableOpacity style={styles.postSessionBtn} onPress={() => respondToLvlChallenge(c.id, true)}>
                        <Text style={styles.postSessionBtnText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.editCancelButton} onPress={() => respondToLvlChallenge(c.id, false)}>
                        <Text style={styles.editCancelButtonText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {!isChallenger && !isAdmin && (
                    <Text style={styles.challengePending}>Your team admin can accept or decline this.</Text>
                  )}
                  {isChallenger && <Text style={styles.challengePending}>Waiting for their admin to respond…</Text>}
                </View>
              );
            })}

            {lvlChallenges.filter(c => c.status === 'active').map(c => {
              const p = lvlProgress[c.id] || { challenger: 0, opponent: 0 };
              const max = Math.max(p.challenger, p.opponent, 1);
              const challengerName = league ? formatTeamName(league.name) : 'Us';
              const otherLeague = allLeaguesForPicker.find(l => l.id === (c.challenger_league_id === id ? c.opponent_league_id : c.challenger_league_id));
              const opponentName = otherLeague ? formatTeamName(otherLeague.name) : 'Them';
              const metricLabel = CHALLENGE_METRICS.find(m => m.value === c.metric)?.label ?? c.metric;
              const ourScore = c.challenger_league_id === id ? p.challenger : p.opponent;
              const theirScore = c.challenger_league_id === id ? p.opponent : p.challenger;
              return (
                <View key={c.id} style={styles.challengeCard}>
                  <Text style={styles.challengeVsText}>🏟️ {challengerName} vs {opponentName}</Text>
                  <Text style={styles.challengeDetail}>{metricLabel} · ends {c.end_date}</Text>
                  <View style={styles.challengeProgressBlock}>
                    <Text style={styles.challengeProgressLabel}>{challengerName}</Text>
                    <View style={styles.challengeTrack}>
                      <View style={[styles.challengeBar, { width: `${Math.round((ourScore / max) * 100)}%`, backgroundColor: RivalColors.accentFill } as any]} />
                    </View>
                    <Text style={styles.challengeProgressScore}>{ourScore}</Text>
                  </View>
                  <View style={styles.challengeProgressBlock}>
                    <Text style={styles.challengeProgressLabel}>{opponentName}</Text>
                    <View style={styles.challengeTrack}>
                      <View style={[styles.challengeBar, { width: `${Math.round((theirScore / max) * 100)}%`, backgroundColor: '#4FC3F7' } as any]} />
                    </View>
                    <Text style={styles.challengeProgressScore}>{theirScore}</Text>
                  </View>
                </View>
              );
            })}

            {lvlChallenges.filter(c => c.status === 'completed').map(c => {
              const isWinner = c.winner_league_id === id;
              const otherLeague = allLeaguesForPicker.find(l => l.id === (c.challenger_league_id === id ? c.opponent_league_id : c.challenger_league_id));
              return (
                <View key={c.id} style={styles.challengeCard}>
                  <Text style={styles.challengeVsText}>🏟️ {league ? formatTeamName(league.name) : ''} vs {otherLeague ? formatTeamName(otherLeague.name) : '?'}</Text>
                  <Text style={styles.challengeDetail}>{CHALLENGE_METRICS.find(m => m.value === c.metric)?.label} · {c.start_date} → {c.end_date}</Text>
                  <Text style={[styles.challengeWinner, { color: c.winner_league_id ? (isWinner ? '#FFC940' : '#f87171') : '#999999' }]}>
                    {c.winner_league_id === null ? '🤝 Draw' : isWinner ? '🏆 Your team won!' : '💪 Tough one — better luck next time'}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {!wide && (<>
        {/* Invite code */}
        <View style={styles.inviteCard}>
          <Text style={styles.inviteLabel}>Invite code</Text>
          <Text style={styles.inviteCode}>{league.invite_code}</Text>
          <TouchableOpacity style={styles.copyButton} onPress={copyInviteCode}>
            <Text style={styles.copyButtonText}>{codeCopied ? '✓ Copied!' : 'Copy & Share'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.leaveTeamButton} onPress={leaveTeam}>
          <Text style={styles.leaveTeamText}>Leave Team</Text>
        </TouchableOpacity>
        </>)}

      </ScrollView>

        {wide && (
          <ScrollView style={styles.rightRail} contentContainerStyle={styles.rightRailContent}>
            {infoBanners}
            {standingsBlock}
            {letsTrainBlock}
          </ScrollView>
        )}
      </View>

      </SafeAreaView>

      {/* window.confirm renders as the browser's own "localhost says" dialog
          — reads as Chrome chrome, not the app. A plain conditional overlay
          (same fix as RivalFixedBackground/create-league's modal) gives a
          confirmation that actually looks like RIVAL. */}
      {showLeaveConfirm && (
        <View style={styles.leaveConfirmOverlay}>
          <View style={styles.leaveConfirmCard}>
            <Text style={styles.leaveConfirmTitle}>
              {members.length <= 1 ? 'Delete this team?' : 'Leave team?'}
            </Text>
            <Text style={styles.leaveConfirmBody}>
              {members.length <= 1
                ? `You're the last member of ${league ? formatTeamName(league.name) : 'this team'}. Leaving will permanently delete it — chat, feed, and challenge history included. This can't be undone.`
                : `Leave ${league ? formatTeamName(league.name) : 'this team'}? You'll need an invite (or to request to join again) to come back.`}
            </Text>
            <View style={styles.leaveConfirmActions}>
              <TouchableOpacity style={styles.editCancelButton} onPress={() => setShowLeaveConfirm(false)}>
                <Text style={styles.editCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.leaveConfirmDangerBtn} onPress={confirmLeaveTeam}>
                <Text style={styles.leaveConfirmDangerBtnText}>{members.length <= 1 ? 'Delete Team' : 'Leave Team'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  scrim: { position: 'fixed' as any, top: 0, left: 0, right: 0, height: '100vh' as any, backgroundColor: 'rgba(14,14,14,0.55)' },
  container: { flex: 1 },
  flatContainer: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: RivalColors.textSecondary, fontSize: 16 },

  header: { marginBottom: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  settingsLink: { color: RivalColors.textSecondary, fontSize: 14 },

  leagueHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  leagueLogoWrap: { position: 'relative' },
  leagueLogoImg: { width: 52, height: 52, borderRadius: 12 },
  leagueLogoPlaceholder: { width: 52, height: 52, borderRadius: 12, backgroundColor: RivalColors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  leagueLogoPlaceholderText: { fontSize: 24 },
  leagueLogoEditBadge: { position: 'absolute', bottom: -4, right: -4, backgroundColor: RivalColors.accentFill, borderRadius: 10, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: RivalColors.surfaceLow },
  leagueLogoEditText: { fontSize: 10 },
  leagueName: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, flex: 1 },

  seasonBanner: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, borderWidth: 1, borderColor: `${RivalColors.accentFill}55` },
  seasonBannerIcon: { fontSize: 16 },
  seasonBannerText: { fontSize: 13, fontWeight: '700', color: RivalColors.textPrimary },

  journeyBanner: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, borderWidth: 1, borderColor: `${RivalColors.success}55` },
  journeyBannerIcon: { fontSize: 22 },
  journeyBannerTitle: { fontSize: 14, fontWeight: '800', color: RivalColors.textPrimary },
  journeyBannerSub: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },

  // Team Challenge (leagues.goal_metric/goal_target/goal_target_date)
  teamChallengeCard: {
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: `${RivalColors.accentText}33`,
    overflow: 'hidden',
    backgroundColor: '#2a211d',
  },
  teamChallengePhoto: { padding: 16, paddingBottom: 20 },
  teamChallengeHead: { flexDirection: 'row', alignItems: 'flex-start' },
  teamChallengeEyebrow: {
    fontSize: 10.5, fontWeight: '700', letterSpacing: 1, color: RivalColors.accentText, textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  teamChallengeTitle: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#fff', marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  teamChallengeEditBtn: { backgroundColor: 'rgba(20,20,20,0.55)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  teamChallengeEdit: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  teamChallengeRingWrap: { alignItems: 'center', marginTop: 12 },
  teamChallengeMetaRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 12 },
  teamChallengeMeta: { fontSize: 13, color: 'rgba(255,255,255,0.8)', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  teamChallengeMetaBold: { fontWeight: '800', color: '#fff' },
  teamChallengeBody: { padding: 16, paddingTop: 14, gap: 14 },

  paceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(217,119,87,0.1)', borderWidth: 1, borderColor: 'rgba(217,119,87,0.25)',
    borderRadius: 14, padding: 12,
  },
  paceIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(217,119,87,0.22)', alignItems: 'center', justifyContent: 'center' },
  paceTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 14, color: '#fff' },
  paceSub: { fontSize: 12, color: RivalColors.onSurfaceVariant, marginTop: 2 },
  paceSubBold: { fontWeight: '800', color: '#fff' },

  statMiniRow: { flexDirection: 'row', gap: 8 },
  statMiniCard: { flex: 1, backgroundColor: '#2a211d', borderWidth: 1, borderColor: `${RivalColors.accentText}24`, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  statMiniVal: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  statMiniLbl: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 9, letterSpacing: 0.4, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', textAlign: 'center', marginTop: 4 },

  teamChallengeContributors: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 12, gap: 2 },
  teamChallengeSectionTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 14, color: '#fff', marginBottom: 6 },
  contribRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  contribRank: { width: 14, textAlign: 'center', color: RivalColors.textSecondary, fontSize: 12, fontWeight: '700' },
  contribCrown: { position: 'absolute', top: -10, left: '50%', transform: [{ translateX: -7 }], zIndex: 2 },
  contribName: { fontSize: 13.5, fontWeight: '700', color: '#fff' },
  contribValue: { fontSize: 12.5, fontWeight: '700', color: RivalColors.textSecondary },
  contribGold: { color: RivalColors.accentGold },
  teamChallengeEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#2a211d',
    borderRadius: 14, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: `${RivalColors.accentText}33`,
  },
  teamChallengeEmptyTitle: { fontSize: 14, fontWeight: '800', color: RivalColors.textPrimary },
  teamChallengeEmptySub: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  goalText: { fontSize: 12, color: RivalColors.success, marginTop: 4, fontWeight: '600' },
  goalEditRow: { marginTop: 4 },
  goalInput: { backgroundColor: RivalColors.surfaceLow, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 12, color: RivalColors.textPrimary, borderWidth: 1, borderColor: RivalColors.success },

  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  weekArrow: { padding: 8 },
  weekArrowText: { fontSize: 28, color: RivalColors.accentFill, lineHeight: 30 },
  weekLabel: { fontSize: 13, color: RivalColors.textSecondary, flex: 1, textAlign: 'center' },

  leaderboard: { gap: 10, marginBottom: 32 },
  emptyText: { color: RivalColors.textSecondary, fontSize: 15, textAlign: 'center', paddingVertical: 24 },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: RivalColors.surfaceContainerHigh,
  },
  memberRowSelf: {
    borderColor: RivalColors.accentFill,
    backgroundColor: RivalColors.surfaceContainer,
  },

  rankEmoji: { fontSize: 20, width: 32, textAlign: 'center' },
  memberAvatar: { width: 36, height: 36, borderRadius: 18 },
  memberAvatarFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: RivalColors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 14, fontWeight: '800', color: RivalColors.textSecondary },

  memberInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  memberName: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  hotBadge: { fontSize: 14 },
  mvpBadge: {
    fontSize: 11, fontWeight: '700', color: RivalColors.rankAnchors.unrivaled,
    backgroundColor: `${RivalColors.rankAnchors.unrivaled}22`, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6, overflow: 'hidden',
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lvlBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  lvlBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  adminBadge: { fontSize: 11, color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },

  scoreBlock: { alignItems: 'flex-end', gap: 4 },
  memberTimeEarned: { fontSize: 10, color: RivalColors.success, fontWeight: '600' },
  score: { fontSize: 17, fontWeight: '800', color: RivalColors.textPrimary },
  rankArrowUp: { fontSize: 12, fontWeight: '800', color: RivalColors.success },
  rankArrowDown: { fontSize: 12, fontWeight: '800', color: RivalColors.error },
  rankArrowNeutral: { fontSize: 12, color: RivalColors.textSecondary },

  planLink: {
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: `${RivalColors.success}33`,
    alignItems: 'center',
  },
  planLinkText: { color: RivalColors.success, fontSize: 13, fontWeight: '600' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: RivalColors.textPrimary },

  feedList: { gap: 0 },
  feedLoadingText: { color: RivalColors.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  feedEmpty: { paddingVertical: 36, alignItems: 'center', gap: 8 },
  feedEmptyIcon: { fontSize: 36, marginBottom: 4 },
  feedEmptyText: { fontSize: 15, fontWeight: '700', color: RivalColors.textSecondary },
  feedEmptySubText: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center' },

  feedCard: { backgroundColor: RivalColors.surfaceHigh, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, gap: 10 },
  feedCardPb: { borderColor: RivalColors.rankAnchors.unrivaled, borderWidth: 2, backgroundColor: `${RivalColors.rankAnchors.unrivaled}14`, shadowColor: RivalColors.rankAnchors.unrivaled, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  feedPbBanner: { backgroundColor: `${RivalColors.rankAnchors.unrivaled}22`, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, alignSelf: 'flex-start' },
  feedPbBannerText: { color: RivalColors.rankAnchors.unrivaled, fontSize: 13, fontWeight: '800' },
  feedCardRace: { borderColor: `${RivalColors.success}55` },

  socialBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: RivalColors.surfaceContainerHigh, gap: 8 },
  reactionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  reactionChip: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  reactionChipActive: { backgroundColor: RivalColors.surfaceContainer, borderColor: RivalColors.accentFill },
  reactionChipText: { fontSize: 13, color: RivalColors.onSurface },
  commentToggle: { fontSize: 12, color: RivalColors.textSecondary, fontWeight: '600' },
  commentsBlock: { gap: 6, marginTop: 4 },
  commentRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  commentAuthor: { fontSize: 12, fontWeight: '700', color: RivalColors.accentFill },
  commentBody: { fontSize: 12, color: RivalColors.onSurface, flexShrink: 1 },
  commentInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  commentInput: { flex: 1, backgroundColor: RivalColors.surfaceLowest, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, color: RivalColors.textPrimary, fontSize: 12, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  commentSendText: { color: RivalColors.accentFill, fontWeight: '700', fontSize: 12 },
  encouragePresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  encouragePresetChip: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  encouragePresetText: { fontSize: 12, color: RivalColors.onSurface },
  encourageErrorText: { fontSize: 12, color: RivalColors.error, marginTop: 4 },

  challengeIconBtn: { marginTop: 4 },
  challengeIconText: { fontSize: 14 },
  challengeModalTitle: { fontSize: 16, fontWeight: '800', color: RivalColors.textPrimary, marginBottom: 4 },
  challengeSectionTitle: { fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 16 },
  challengeCard: { backgroundColor: RivalColors.surfaceHigh, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, gap: 8 },
  challengeVsText: { fontSize: 15, fontWeight: '800', color: RivalColors.textPrimary },
  challengeDetail: { fontSize: 12, color: RivalColors.textSecondary },
  challengePending: { fontSize: 12, color: RivalColors.textSecondary, fontStyle: 'italic' },
  challengeProgressBlock: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  challengeProgressLabel: { fontSize: 12, color: RivalColors.onSurface, width: 70 },
  challengeTrack: { flex: 1, height: 8, backgroundColor: RivalColors.surfaceContainerHigh, borderRadius: 4, overflow: 'hidden' },
  challengeBar: { height: '100%', borderRadius: 4 },
  challengeProgressScore: { fontSize: 12, fontWeight: '700', color: RivalColors.textPrimary, width: 40, textAlign: 'right' },
  challengeWinner: { fontSize: 14, fontWeight: '800' },
  lvlChallengeBtn: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: RivalColors.accentFill, marginBottom: 8 },
  lvlChallengeBtnText: { color: RivalColors.accentFill, fontWeight: '700', fontSize: 14 },
  lvlLeaguePickerList: { maxHeight: 200, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, borderRadius: 10, overflow: 'hidden', marginBottom: 4 },
  lvlLeaguePickerRow: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceHigh },
  lvlLeaguePickerRowActive: { backgroundColor: RivalColors.surfaceContainer },
  lvlLeaguePickerText: { color: RivalColors.onSurface, fontSize: 14, fontWeight: '600' },
  editModalButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  editCancelButton: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  editCancelButtonText: { color: RivalColors.textSecondary, fontWeight: '700', fontSize: 14 },

  feedUserRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  feedUserTapArea: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  feedAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  feedAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  feedAvatarText: { fontSize: 13, fontWeight: '800' },
  feedUserName: { flex: 1, fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  feedTimeCol: { alignItems: 'flex-end' },
  feedTimeAgo: { fontSize: 12, color: RivalColors.textSecondary },
  feedDateTime: { fontSize: 11, color: RivalColors.textSecondary },

  feedActivityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  feedActivityIcon: { fontSize: 26 },
  feedActivityType: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  feedActivityMeta: { fontSize: 13, color: RivalColors.textSecondary, marginTop: 2 },
  feedInsightRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  feedInsightText: { fontSize: 12, fontWeight: '700' },
  feedXpPill: { backgroundColor: `${RivalColors.success}22`, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: `${RivalColors.success}55` },
  feedXpText: { fontSize: 12, fontWeight: '800', color: RivalColors.success },
  feedEditBtn: { padding: 4 },
  feedEditBtnText: { fontSize: 16 },

  feedGalleryRow: { gap: 8 },
  feedGalleryPhoto: { width: 260, height: 260, borderRadius: 10, backgroundColor: RivalColors.surfaceContainerHigh },

  feedRaceAction: { fontSize: 13, color: RivalColors.success, fontWeight: '600' },
  feedRaceName: { fontSize: 16, fontWeight: '800', color: RivalColors.textPrimary },
  feedRaceDate: { fontSize: 13, color: RivalColors.textSecondary },

  inviteCard: {
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: RivalColors.success,
  },
  inviteLabel: { fontSize: 13, color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 2 },
  inviteCode: { fontSize: 36, fontWeight: '900', color: RivalColors.textPrimary, letterSpacing: 8 },
  copyButton: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 10, marginTop: 4 },
  copyButtonText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontSize: 16, fontWeight: '700' },
  leaveTeamButton: { borderWidth: 1, borderColor: RivalColors.error, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  leaveTeamText: { color: RivalColors.error, fontSize: 15, fontWeight: '700' },

  // ── Desktop Team Hub shell (Stitch 3-column layout) ──
  bodyRow: { flex: 1, flexDirection: 'row', width: '100%', maxWidth: 1400, marginHorizontal: 'auto', gap: 14, paddingHorizontal: 16, paddingTop: 16 },
  bodyFill: { flex: 1 },
  sidebar: { width: '18%', minWidth: 160, maxWidth: 220, flexGrow: 0, flexShrink: 0, paddingBottom: 24, gap: 6 },
  sidebarTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  sidebarLogoImg: { width: 40, height: 40, borderRadius: 10 },
  sidebarLogoPh: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  sidebarTeamName: { fontSize: 15, fontWeight: '700', color: RivalColors.accentText },
  sidebarTeamLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: RivalColors.textSecondary },
  sideNavItem: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10 },
  sideNavItemActive: { backgroundColor: RivalColors.accentFill },
  sideNavText: { fontSize: 14, fontWeight: '600', color: RivalColors.textSecondary },
  sideNavTextActive: { color: RivalColors.onAccentFill, fontWeight: '700' },
  sideInvite: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 8 },
  sideInviteLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: RivalColors.textSecondary },
  sideInviteCode: { fontSize: 16, fontWeight: '800', letterSpacing: 3, color: RivalColors.textPrimary, marginTop: 2 },
  sideAddBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 6 },
  sideAddBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontWeight: '700', fontSize: 14 },
  sideQuiet: { paddingVertical: 8, paddingHorizontal: 14 },
  sideQuietText: { fontSize: 12, fontWeight: '600', color: RivalColors.textSecondary },
  centerScroll: { flex: 1 },
  contentWide: { paddingBottom: 80, paddingHorizontal: 4, maxWidth: 820, width: '100%', alignSelf: 'center' },
  centerHeader: { marginBottom: 14 },
  centerTitle: { fontSize: 28, fontWeight: '700', color: RivalColors.textPrimary, fontFamily: 'Manrope' },
  centerSub: { fontSize: 14, color: RivalColors.onSurfaceVariant, marginTop: 2 },
  rightRail: { width: '24%', minWidth: 220, flexGrow: 0, flexShrink: 0, maxWidth: 300 },
  rightRailContent: { paddingBottom: 80, gap: 4 },
  chatPill: { position: 'absolute', bottom: 28, right: 28, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(20,20,20,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 18, paddingHorizontal: 22, paddingVertical: 16 },
  chatPillIcon: { fontSize: 22 },
  chatPillText: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },

  letsTrainBtn: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: RivalColors.success },
  letsTrainBtnText: { color: RivalColors.success, fontWeight: '800', fontSize: 15 },
  quickTrainCard: { backgroundColor: RivalColors.surfaceHigh, borderRadius: 14, padding: 16, gap: 4, marginBottom: 20, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  tabSwitchRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  tabSwitchBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: RivalColors.surfaceHigh, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  tabSwitchBtnActive: { backgroundColor: RivalColors.surfaceContainer, borderColor: RivalColors.accentFill },
  tabSwitchText: { color: RivalColors.textSecondary, fontWeight: '700', fontSize: 14 },
  tabSwitchTextActive: { color: RivalColors.accentFill },

  chatSection: { gap: 12 },
  sessionsViewRow: { flexDirection: 'row', gap: 8 },
  sessionsViewBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: RivalColors.surfaceHigh, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  sessionsViewBtnActive: { backgroundColor: `${RivalColors.rankAnchors.unrivaled}14`, borderColor: RivalColors.rankAnchors.unrivaled },
  sessionsViewText: { color: RivalColors.textSecondary, fontWeight: '700', fontSize: 13 },
  sessionsViewTextActive: { color: RivalColors.rankAnchors.unrivaled },
  planSessionBtn: { backgroundColor: `${RivalColors.rankAnchors.unrivaled}14`, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: `${RivalColors.rankAnchors.unrivaled}33` },
  planSessionBtnText: { color: RivalColors.rankAnchors.unrivaled, fontWeight: '700', fontSize: 14 },

  sessionComposer: { backgroundColor: RivalColors.surfaceHigh, borderRadius: 14, padding: 16, gap: 4, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  composerLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary, marginTop: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  composerHint: { fontSize: 11, color: RivalColors.textSecondary, marginTop: 4 },
  composerInput: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 10, padding: 12, color: RivalColors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  composerRow: { flexDirection: 'row', gap: 10 },
  typeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  typeChipActive: { backgroundColor: RivalColors.surfaceContainer, borderColor: RivalColors.accentFill },
  typeChipText: { fontSize: 12, fontWeight: '600', color: RivalColors.textSecondary },
  typeChipTextActive: { color: RivalColors.accentFill },
  postSessionBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  postSessionBtnText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontWeight: '700', fontSize: 14 },

  chatScrollArea: { maxHeight: 420, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, borderRadius: 14, backgroundColor: RivalColors.surfaceContainer },
  unreadDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  unreadDividerLine: { flex: 1, height: 1, backgroundColor: RivalColors.accentFill },
  unreadDividerText: { color: RivalColors.accentFill, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  chatList: { gap: 10, padding: 10 },

  sessionCard: { backgroundColor: `${RivalColors.rankAnchors.unrivaled}14`, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: `${RivalColors.rankAnchors.unrivaled}33`, gap: 6 },
  sessionCardTitle: { fontSize: 15, fontWeight: '800', color: RivalColors.textPrimary, marginTop: 4 },
  sessionCardWhen: { fontSize: 13, color: RivalColors.rankAnchors.unrivaled, fontWeight: '700' },
  sessionCardLocation: { fontSize: 13, color: RivalColors.onSurface },
  sessionCardLocationLink: { fontSize: 12, color: RivalColors.tertiary, fontWeight: '600' },
  sessionCardSubtype: { fontSize: 12, color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600', marginTop: -4 },
  rsvpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 10 },
  rsvpStatus: { fontSize: 12, color: RivalColors.textSecondary, fontWeight: '600', flex: 1 },
  rsvpStatusJoined: { color: RivalColors.success, fontWeight: '700' },
  rsvpBtn: { backgroundColor: RivalColors.success, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: RivalColors.success },
  rsvpBtnLeave: { backgroundColor: 'transparent', borderColor: RivalColors.textSecondary },
  rsvpBtnText: { color: RivalColors.surfaceLowest, fontWeight: '700', fontSize: 13 },
  rsvpBtnTextLeave: { color: RivalColors.textSecondary },

  chatBubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '90%' },
  chatBubbleRowMe: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  chatAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  chatBubble: { backgroundColor: RivalColors.surfaceHigh, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  chatBubbleMe: { backgroundColor: RivalColors.surfaceContainer, borderColor: RivalColors.accentFill },
  chatBubbleName: { fontSize: 11, fontWeight: '700', color: RivalColors.textSecondary, marginBottom: 2 },
  chatBubbleText: { fontSize: 14, color: RivalColors.textPrimary },
  chatBubbleTime: { fontSize: 10, color: RivalColors.textSecondary, marginTop: 4, textAlign: 'right' },

  mentionText: { color: RivalColors.accentFill, fontWeight: '700' },
  mentionSuggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: RivalColors.surfaceHigh, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  mentionChip: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: RivalColors.accentFill },
  mentionChipText: { color: RivalColors.accentFill, fontWeight: '700', fontSize: 13 },
  mentionNoMatch: { color: RivalColors.textSecondary, fontSize: 12 },
  chatInputRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  chatInput: { flex: 1, backgroundColor: RivalColors.surfaceHigh, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  chatSendBtn: { backgroundColor: RivalColors.accentFill, borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center' },
  chatSendBtnText: { color: RivalColors.textPrimary, fontWeight: '700', fontSize: 14 },

  leaveConfirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20, ...(Platform.OS === 'web' ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 } as any : {}) },
  leaveConfirmCard: { backgroundColor: RivalColors.surfaceHigh, borderRadius: 16, padding: 24, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  leaveConfirmTitle: { fontSize: 18, fontWeight: '800', color: RivalColors.textPrimary, marginBottom: 10 },
  leaveConfirmBody: { fontSize: 14, color: RivalColors.textSecondary, lineHeight: 20 },
  leaveConfirmActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  leaveConfirmDangerBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: RivalColors.error },
  leaveConfirmDangerBtnText: { color: RivalColors.surfaceLowest, fontWeight: '800', fontSize: 14 },
});
