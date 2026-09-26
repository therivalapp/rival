import { getMyTeamRows } from '../lib/myTeams';
import { distanceNumber, distanceUnit, elevationUnit, formatDistanceWhole, toDisplayDistance, toDisplayElevation } from '../lib/units';
import { useState, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, Platform, ScrollView, Image, ImageBackground, useWindowDimensions, Animated } from 'react-native';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import Svg, { Defs, Line, LinearGradient, Polygon, Stop } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { connectStrava } from '../lib/strava';
import { fetchAllActivities } from '../lib/fetchAllActivities';
import { notify } from '../lib/notify';
import { getMondayOfWeek, calculateStreak } from '../lib/streak';
import { getCurrentSeasonYear, daysUntilSeasonEnd, getSeasonStartISO, deviceTimeZone } from '../lib/season';
import { getLevel, xpProgressInLevel, LEVELS } from '../lib/xp';
import { fetchReactionsOn, impactTotals } from '../lib/reactions';
import { computeGoalProgress, goalUnit, GoalRow } from '../lib/goalProgress';
// Same set as my-activities.tsx/team-hub.tsx's METERS_SPORTS — those short
// distances read as near-zero once rounded to km ("0.7km" is really "700m").
// Distance goals always store/compute progress and target in km regardless
// of activity (goalUnit() is unconditional), so the Focus card converts back
// to metres at display time only, for these activity types only.
const METERS_SPORTS = new Set(['Swim', 'Rowing']);
import { formatTeamName, formatRaceName } from '../lib/identity';
import { LaurelWreath } from '../components/rival/LaurelWreath';
import { useSnapState } from '../lib/snapState';
import { RivalButton, RivalCard, RivalProgressBar, RivalChallengeRing, RivalIcon, RivalTopNav, rm, activityIconName, type RivalIconName } from '../components/rival';
import { RivalColors, RivalRadius, RivalType, RivalFontFamily, RivalSerifFamily, RivalButtonColors } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';

type League = { id: string; name: string; invite_code: string; logo_url: string | null; recentCount?: number };
type NextRace = { name: string; race_date: string } | null;
type WeeklyLeaderEntry = { userId: string; name: string; avatarUrl: string | null; points: number; isSelf: boolean };
type WeeklyLeader = {
  leagueId: string;
  teamName: string;
  daysRemaining: number;
  // Full ranked list (points > 0 only), so the card can tell the viewer's
  // own story even when they're not #1 — not just the top 3.
  standings: WeeklyLeaderEntry[];
};
type MomentumTrainers = { leagueId: string; names: string[]; totalCount: number; selfTrained: boolean };
type MomentumContent = { message: string; cta: string };

// The card's whole point is answering "what do I need to do to move up" —
// so the headline is always about the viewer's own rank relative to
// whoever's next, not just "who's winning." rankIcon/rankLabel picks the
// badge (crown for #1, medal for #2/#3, plain "4th" text below that).
// before/gap/after split the sentence so the gap number can be rendered at
// a different size than the surrounding words — gap is null when there's
// simply no rival yet (leading with nobody else on the board).
type RankStory = { rankIcon: 'crown' | 'medal' | null; rankLabel: string | null; before: string; gap: number | null; after: string };
// First name + last initial (e.g. "Ricky J.") — kept short for the pillar's
// tight width, not a general display-name style (there's no such concept
// anymore; identity.ts always returns the real name everywhere else).
function weeklyLeaderName(profile: { display_name?: string | null; email?: string | null } | undefined): string {
  const raw = profile?.display_name || profile?.email?.split('@')[0] || 'Athlete';
  const parts = raw.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

// First name only — Team Momentum's "Sandy, Emma and 3 others" is a casual
// nudge from people, not a formal standing, so it skips the last-initial
// weeklyLeaderName uses for the leaderboard.
function firstNameOnly(profile: { display_name?: string | null; email?: string | null } | undefined): string {
  const raw = profile?.display_name || profile?.email?.split('@')[0] || 'Someone';
  return raw.trim().split(/\s+/)[0];
}

function weeklyRankStory(standings: WeeklyLeaderEntry[], selfIndex: number): RankStory {
  const leader = standings[0];
  if (selfIndex === 0) {
    const second = standings[1];
    if (!second) return { rankIcon: 'medal', rankLabel: null, before: "You're leading", gap: null, after: '' };
    const gap = Math.round(leader.points - second.points);
    return gap === 0
      ? { rankIcon: 'medal', rankLabel: null, before: 'Level at the top', gap: null, after: '' }
      : { rankIcon: 'medal', rankLabel: null, before: 'Leading by ', gap, after: '' };
  }
  // Everyone else compares to whoever's directly ahead of them, not always
  // the leader — e.g. 3rd place should see the gap to 2nd, not to 1st, and
  // 5th place should see the gap to 4th, not to 3rd/the podium cutoff.
  const front = standings[selfIndex - 1];
  const gap = Math.round(front.points - standings[selfIndex].points);
  const rankIcon = selfIndex <= 2 ? 'medal' : null;
  const rankLabel = selfIndex <= 2 ? null : `${selfIndex + 1}th`;
  if (gap === 0) return { rankIcon, rankLabel, before: `Tied with ${front.name}`, gap: null, after: '' };
  // Kept by name on purpose (Ricky, 2026-09-25): "7 behind Sandy" is the
  // friendly rivalry RIVAL is about — a real person just ahead is what gets
  // you out the door. Tone rules still apply to everything around it.
  return { rankIcon, rankLabel, before: '', gap, after: ` Behind ${front.name}` };
}

// Mobile Weekly Leader podium — mockup's exact left-to-right arrangement is
// silver(2nd)/gold(1st)/bronze(3rd), NOT rank order. A slot is null (renders
// as empty flex space) when standings.length is under 3, rather than
// fabricating a slot.
type PodiumSlot = { entry: WeeklyLeaderEntry; rank: 0 | 1 | 2 } | null;
function podiumSlots(standings: WeeklyLeaderEntry[]): PodiumSlot[] {
  const slot = (i: number, rank: 0 | 1 | 2): PodiumSlot => (standings[i] ? { entry: standings[i], rank } : null);
  return [slot(1, 1), slot(0, 0), slot(2, 2)];
}
// Gradient fill (top→bottom, matching mockup's 165deg .km-shard-* CSS
// gradients exactly) + glow color/radius per rank, plus label/height/avatar
// sizing. avatarGlow is the avatar circle's own soft drop-shadow, separate
// from the shard's glow — the mockup gives each avatar one too. maxH matches
// the mockup's fixed reference heights (189/131/107) exactly so a big lead
// looks as tall as the mockup; minH is a floor for low scorers, not a mockup
// value (the mockup's heights are static demo numbers, ours scale with
// real points — an intentional deviation, see the port's design plan).
// Sized at 85% of the mockup's literal px values — Ricky asked to shrink the
// whole Weekly Leader card ~15% after seeing it next to the other cards.
const PODIUM_RANK_STYLE = [
  {
    gradFrom: 'rgba(255,215,0,0.4)', gradTo: 'rgba(180,140,10,0.1)', glow: 'rgba(255,215,0,0.28)', glowRadius: 10,
    avatarGlow: 'rgba(255,215,0,0.25)', avatarGlowRadius: 7,
    tint: '#FFD700', ptsColor: '#FFD700', ptsTint: 'rgba(255,215,0,0.7)', minH: 119, maxH: 161, avatarSize: 64, nameSize: 11, nameLetterSpacing: 1.5, ptsSize: 31, padTop: 29, padBottom: 20,
  },
  {
    gradFrom: 'rgba(150,130,110,0.32)', gradTo: 'rgba(60,50,45,0.08)', glow: 'rgba(180,150,120,0.18)', glowRadius: 7,
    avatarGlow: 'rgba(255,181,158,0.3)', avatarGlowRadius: 5,
    tint: RivalColors.accentText, ptsColor: '#FFFFFF', ptsTint: 'rgba(255,181,158,0.7)', minH: 81, maxH: 111, avatarSize: 51, nameSize: 10, nameLetterSpacing: 1.5, ptsSize: 20, padTop: 26, padBottom: 14,
  },
  {
    gradFrom: 'rgba(94,218,199,0.25)', gradTo: 'rgba(0,80,71,0.05)', glow: 'rgba(217,119,87,0.15)', glowRadius: 7,
    avatarGlow: 'rgba(94,218,199,0.15)', avatarGlowRadius: 5,
    tint: RivalColors.tertiary, ptsColor: '#FFFFFF', ptsTint: 'rgba(94,218,199,0.6)', minH: 66, maxH: 91, avatarSize: 51, nameSize: 10, nameLetterSpacing: 1.5, ptsSize: 20, padTop: 26, padBottom: 14,
  },
] as const;
// Sloped-top-edge fraction pairs [topLeft, topRight] per column position
// (0=left/silver, 1=center/gold, 2=right/bronze) — same angles as the
// mockup's CSS clip-path shards, reproduced as an SVG polygon since RN has
// no clip-path equivalent.
const SHARD_SLOPE: Record<number, [number, number]> = { 0: [0, 0.20], 1: [0.15, 0], 2: [0.25, 0] };
// A 6-point lens polygon reads as faceted/cut at the tip — more points along
// a curve gets closer to an actual tapered point without the hard facets.
const PODIUM_LENS_CLIP =
  'polygon(0% 50%, 2% 32%, 5% 16%, 10% 6%, 18% 1%, 30% 0%, 70% 0%, 82% 1%, 90% 6%, 95% 16%, 98% 32%, 100% 50%, 98% 68%, 95% 84%, 90% 94%, 82% 99%, 70% 100%, 30% 100%, 18% 99%, 10% 94%, 5% 84%, 2% 68%)';
// Podium motion (web). The pillars rise into place when the card appears —
// third, then second, then first, so the leader lands last — the avatars
// settle onto them, a slow band of light passes across each pillar every few
// seconds, and the crown drifts. The keyframes live in global.css (react-
// native-web drops inline keyframes); native keeps the still podium. Skipped entirely for
// anyone who has asked their device for reduced motion.
const PODIUM_MOTION = Platform.OS === 'web' && typeof window !== 'undefined'
  && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const RISE_DELAY_MS: Record<0 | 1 | 2, number> = { 0: 420, 1: 260, 2: 100 };

// Sparkles that rise out of the top of the leader's pillar and fade — only
// ever on first place. Fixed positions and timings (not random) so the effect
// is identical on every render and never clumps. Web only, like the rest of
// the podium motion; hidden for reduced motion in global.css.
const SPARKS: { left: string; delay: number; dur: number; size: number; star: boolean; dir: 'L' | 'R' }[] = [
  { left: '16%', delay: 0.0, dur: 2.8, size: 4, star: false, dir: 'L' },
  { left: '30%', delay: 1.1, dur: 3.2, size: 12, star: true, dir: 'L' },
  { left: '46%', delay: 0.5, dur: 2.6, size: 4, star: false, dir: 'R' },
  { left: '58%', delay: 2.0, dur: 3.0, size: 10, star: true, dir: 'L' },
  { left: '70%', delay: 1.6, dur: 3.4, size: 12, star: true, dir: 'R' },
  { left: '82%', delay: 0.9, dur: 2.9, size: 4, star: false, dir: 'R' },
  { left: '24%', delay: 2.4, dur: 3.1, size: 3, star: false, dir: 'L' },
  { left: '64%', delay: 2.8, dur: 2.7, size: 3, star: false, dir: 'R' },
  { left: '40%', delay: 3.3, dur: 3.3, size: 9, star: true, dir: 'R' },
];

// Where the sparkles start: the top face of the pillar, or its foot, rising up
// the whole face. Set from the podium workbench, 2026-09-26.
const SPARK_ORIGIN: 'top' | 'base' = 'top';
// Below 1 slows the whole effect: longer rise, sparkles spaced further apart.
const SPARK_SPEED = 0.6;

function PodiumSparkles({ slope, height }: { slope: [number, number]; height: number }) {
  if (!PODIUM_MOTION) return null;
  const base = SPARK_ORIGIN === 'base';
  // From the top, each sparkle is born on the pillar's 3D top face itself:
  // part way across it and part way back, following its slant, so they rise
  // out of the surface rather than appearing in the air above it.
  const [tl, tr] = slope;
  const xr = 100 - PILLAR_SIDE;
  const onTop = (i: number, leftPct: number) => {
    const fx = (leftPct / 100) * xr;
    const back = 0.25 + (i % 3) * 0.25; // how far back across the top face
    return { x: fx + back * PILLAR_SIDE, y: tl * height + (tr - tl) * height * (fx / 100) + (1 - back) * PILLAR_DEPTH };
  };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: base ? `${PILLAR_SIDE}%` : 0, ...(base ? { bottom: 2 } : { top: 0 }), height: 0 } as any}>
      {SPARKS.map((sp, i) => {
        const at = base ? null : onTop(i, parseFloat(sp.left));
        return (
        <View
          key={i}
          style={{
            position: 'absolute', left: (at ? `${at.x}%` : sp.left) as any, top: at ? at.y : 0,
            width: sp.size, height: sp.size, marginLeft: -sp.size / 2, marginTop: at ? -sp.size / 2 : 0,
            animationName: `rivalSparkRise${base ? 'Base' : ''}${sp.dir}`,
            // Further to travel from the foot, so a little slower.
            animationDuration: `${((base ? sp.dur * 1.6 : sp.dur) / SPARK_SPEED).toFixed(2)}s`,
            // Held back until the pillar has risen and the avatar settled.
            animationDelay: `${(1.6 + sp.delay / SPARK_SPEED).toFixed(2)}s`,
            animationIterationCount: 'infinite',
            animationTimingFunction: 'ease-out',
            animationFillMode: 'both',
          } as any}
        >
          {sp.star ? (
            <Svg width={sp.size} height={sp.size} viewBox="0 0 10 10" style={{ filter: 'drop-shadow(0 0 3px rgba(255,215,0,0.9))' } as any}>
              <Polygon points="5,0 6,4 10,5 6,6 5,10 4,6 0,5 4,4" fill="#FFF3C4" />
            </Svg>
          ) : (
            <View style={{ width: sp.size, height: sp.size, borderRadius: sp.size, backgroundColor: '#FFF6CF', boxShadow: '0 0 6px 2px rgba(255,215,0,0.7)' } as any} />
          )}
        </View>
        );
      })}
    </View>
  );
}

function podiumRise(effRank: 0 | 1 | 2): any {
  if (!PODIUM_MOTION) return null;
  return {
    animationName: 'rivalPodiumRise',
    animationDuration: '760ms',
    animationDelay: `${RISE_DELAY_MS[effRank]}ms`,
    animationTimingFunction: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
    animationFillMode: 'both',
    transformOrigin: 'bottom',
  };
}

function podiumSettle(effRank: 0 | 1 | 2): any {
  if (!PODIUM_MOTION) return null;
  return {
    animationName: 'rivalPodiumSettle',
    animationDuration: '520ms',
    animationDelay: `${RISE_DELAY_MS[effRank] + 520}ms`,
    animationTimingFunction: 'cubic-bezier(0.3, 1.4, 0.5, 1)',
    animationFillMode: 'both',
  };
}

// The band of light: runs across in the first quarter of a 7s loop, then
// rests, so it reads as light catching the pillar rather than a loading bar.
function podiumSheen(effRank: 0 | 1 | 2): any {
  if (!PODIUM_MOTION) return null;
  return {
    animationName: 'rivalPodiumSheen',
    animationDuration: '7000ms',
    animationDelay: `${1600 + effRank * 700}ms`,
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out',
    animationFillMode: 'both',
  };
}

// A soft gold halo that breathes behind the leader's picture (web only).
const LEADER_HALO: any = PODIUM_MOTION ? {
  animationName: 'rivalHaloPulse',
  animationDuration: '3200ms',
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-in-out',
} : null;

// '#rrggbb' → 'rgba(r,g,b,a)'.
function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// A picture-less avatar: the rank colour glowing up from the lower left of a
// deep warm disc, and the initial set in the serif italic like the scores.
function initialBackdrop(tint: string): any {
  return Platform.OS === 'web'
    ? { backgroundImage: `radial-gradient(circle at 30% 22%, ${hexAlpha(tint, 0.34)} 0%, ${hexAlpha(tint, 0.1)} 45%, rgba(0,0,0,0) 72%), linear-gradient(160deg, #3a2f29 0%, #1c1613 100%)` }
    : { backgroundColor: '#2a221e' };
}
function initialGlow(tint: string): any {
  return Platform.OS === 'web' ? { textShadow: `0 0 10px ${hexAlpha(tint, 0.55)}` } : null;
}

// The picture's ring: a thin metallic band in the rank colour, catching light
// at two points. Drawn as a gradient behind a 1px inset (web); a plain ring on
// native.
const AVATAR_RING = 1;
function avatarRing(tint: string): any {
  return Platform.OS === 'web'
    ? { backgroundImage: `conic-gradient(from 210deg, ${tint}, #fff8e0, ${hexAlpha(tint, 0.5)}, ${tint}, #fff8e0, ${tint})` }
    : { backgroundColor: tint };
}

// The pillar as a solid block: a front face, a lit top face and a shaded right
// side, drawn in the pillar's 0–100 wide viewBox. DEPTH is in pixels (the y
// axis is 1:1), SIDE in viewBox x-units (~11px on an 82px pillar).
const PILLAR_DEPTH = 8;
const PILLAR_SIDE = 14;
function pillarFaces(slope: [number, number], h: number) {
  const [tl, tr] = slope;
  const xr = 100 - PILLAR_SIDE;
  const yAt = (x: number) => tl * h + (tr - tl) * h * (x / 100); // the shard's slanted top line
  const fL = yAt(0) + PILLAR_DEPTH;   // front face, top-left
  const fR = yAt(xr) + PILLAR_DEPTH;  // front face, top-right
  const bR = yAt(xr);                 // back edge, above the front's right corner
  const bL = yAt(0);
  return {
    front: `0,${fL} ${xr},${fR} ${xr},${h} 0,${h}`,
    top: `0,${fL} ${xr},${fR} 100,${bR} ${PILLAR_SIDE},${bL}`,
    side: `${xr},${fR} 100,${bR} 100,${h - PILLAR_DEPTH} ${xr},${h}`,
    frontEdge: { x1: 0, y1: fL, x2: xr, y2: fR },
    // The front face as a CSS clip-path, for the band of light.
    frontClip: `polygon(0% ${(fL / h) * 100}%, ${xr}% ${(fR / h) * 100}%, ${xr}% 100%, 0% 100%)`,
  };
}

// Team Momentum's status line — reuses the same weeklyLeader standings the
// Weekly Leader card computes for this same team (leagues[0], the most
// active one) instead of firing a second query. Priority: leading is the
// most exciting thing that can be true, a specific gap is more motivating
// than a headcount, and named teammates ("Sandy, Emma and 3 others") pull
// harder than a raw count when you're not on the board yet. The "haven't
// trained" case is framed as an invite ("Add activity"), never a callout —
// AGENTS.md's voice rule is encourage, never pressure or shame.
function momentumStory(trainers: MomentumTrainers | null, weeklyLeader: WeeklyLeader | null, leagueId: string): MomentumContent {
  if (weeklyLeader && weeklyLeader.leagueId === leagueId && weeklyLeader.standings.length > 0) {
    const selfIndex = weeklyLeader.standings.findIndex((e) => e.isSelf);
    if (selfIndex === 0) return { message: "You're leading this week", cta: 'View team' };
    if (selfIndex > 0) {
      const gap = Math.round(weeklyLeader.standings[0].points - weeklyLeader.standings[selfIndex].points);
      return { message: `${gap} Effort to 1st this week`, cta: 'View team' };
    }
  }
  if (trainers && trainers.leagueId === leagueId && trainers.names.length > 0) {
    const { names, totalCount } = trainers;
    const list =
      totalCount === 1
        ? names[0]
        : totalCount === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, 2).join(', ')} and ${totalCount - 2} ${totalCount - 2 === 1 ? 'other' : 'others'}`;
    if (trainers.selfTrained) return { message: `${list} also trained today`, cta: 'View team' };
    return { message: `${list} trained today`, cta: 'Join them' };
  }
  return { message: 'No activities logged this week', cta: 'Add activity' };
}
type FeaturedGoal = {
  id: string;
  title: string;
  // Bare activity name ("Run"), no "• target unit" suffix — the mobile Focus
  // card's mockup shows the target only once, in the hero number row, so it
  // reuses this instead of `title` (which desktop's card still uses as-is).
  activityLabel: string;
  progress: number;
  target: number;
  unit: string;
  pct: number;
  daysLeft: number;
};

function todayLocalStr(): string {
  return dateLocalStr(new Date());
}

function dateLocalStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const race = new Date(y, m - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.ceil((race.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// "Sun 25 Oct" — mobile Next Event card's date format (no existing formatter
// in dateFormat.ts covers this shape; that file handles typed date input, not
// display).
function formatRaceDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday} ${d} ${month}`;
}

// Scales the hero number down as it gets longer so "186h 10m" still fits on
// one line at hero scale, instead of wrapping onto a stacked second line
// (looked broken, not "impressive," on a real account's accumulated total).
// "Run · Distance" reads as metadata, not something someone chose — the
// Today card's title leads with the actual target instead (e.g. "100 km
// Run"), goalProgress.ts's goalTitle() stays as-is for goals.tsx's own list
// (badge + label already covers the type there, so it doesn't need this).
// A goal's number in the units chosen in Profile (goals are stored metric).
function shownGoal(type: 'distance' | 'elevation' | 'gym_sessions', v: number): { value: number; unit: string } {
  if (type === 'distance') return { value: Math.round(toDisplayDistance(v) * 10) / 10, unit: distanceUnit() };
  if (type === 'elevation') return { value: Math.round(toDisplayElevation(v)), unit: elevationUnit() };
  return { value: v, unit: goalUnit(type) };
}

function featuredGoalTitle(goal: { goal_type: 'distance' | 'elevation' | 'gym_sessions'; activity_filter: string | null; target_value: number }): string {
  if (goal.goal_type === 'gym_sessions') return `Gym activities • ${goal.target_value}`;
  const activity = goal.activity_filter ?? 'All Activities';
  const shown = shownGoal(goal.goal_type, goal.target_value);
  return `${activity} • ${shown.value} ${shown.unit}`;
}

// Staged copy by raw progress (not time-based pace — see the "single 80km
// session" conversation: this only ever claims "how much is left," never
// anything about being ahead/behind schedule).
function focusProgressPhrase(pct: number): string {
  if (pct >= 1) return 'YOU EARNED THIS';
  if (pct >= 0.9) return 'So close';
  if (pct >= 0.65) return 'Stay focused';
  if (pct >= 0.5) return "You're over halfway";
  if (pct >= 0.3) return 'Keep showing up';
  return "Let's do this";
}

// Rough advance width for a single glyph at a given font size — digits/"h"/"m"
// in this typeface run about 0.58em wide on average. Good enough to size
// against without an actual text-measurement pass.
const CHAR_WIDTH_RATIO = 0.58;

// Length-based buckets alone assumed a wide desktop card; on a narrow phone
// the same string ("188h 33m") can overflow the card at that bucket's font
// size and get clipped by the value's numberOfLines={1}. Start from the same
// buckets, then shrink further if the estimate still doesn't fit the card's
// actual available width.
function heroValueFontSize(text: string, availableWidth: number): number {
  let size = text.length <= 4 ? 132 : text.length <= 6 ? 114 : text.length <= 8 ? 94 : text.length <= 10 ? 76 : 60;
  while (size > 40 && text.length * size * CHAR_WIDTH_RATIO > availableWidth) {
    size -= 2;
  }
  return size;
}



// Loading state for the phone layout: the page's own shapes — podium card,
// Add activity pill, Today row, Focus ring, Legacy — as softly pulsing warm
// blocks, so the layout doesn't jump when real data arrives.
function useSkeletonPulse() {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.45, duration: 800, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return pulse;
}

function SkeletonBar({ width, height, radius = 6, style }: { width: number | `${number}%`; height: number; radius?: number; style?: any }) {
  const pulse = useSkeletonPulse();
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: 'rgba(255,209,190,0.10)', opacity: pulse }, style]} />;
}

function MobileHomeSkeleton() {
  const pulse = useSkeletonPulse();
  const block = (st: any) => <Animated.View style={[styles.mSkel, st, { opacity: pulse }]} />;
  return (
    <View accessibilityLabel="Loading" style={{ gap: 0 }}>
      <View style={[styles.mLeaderCard, styles.mSkelLeader]}>
        {block({ width: 150, height: 12, borderRadius: 6 })}
        <View style={styles.mSkelPodium}>
          {block({ width: 72, height: 70, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderRadius: 0 })}
          {block({ width: 72, height: 104, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderRadius: 0 })}
          {block({ width: 72, height: 52, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderRadius: 0 })}
        </View>
        {block({ width: 190, height: 22, borderRadius: 8, marginTop: 22 })}
        {block({ width: 150, height: 10, borderRadius: 5, marginTop: 12 })}
      </View>
      {block({ alignSelf: 'center', width: '70%', height: 48, borderRadius: 999, marginTop: 4 })}
      {block({ height: 92, borderRadius: 16, marginTop: 14, marginHorizontal: -8 })}
      <View style={{ alignItems: 'center', marginTop: 34 }}>
        {block({ width: 90, height: 22, borderRadius: 8 })}
        {block({ width: 200, height: 200, borderRadius: 100, marginTop: 22, backgroundColor: 'transparent', borderWidth: 14, borderColor: 'rgba(255,209,190,0.08)' })}
      </View>
      <View style={{ alignItems: 'center', marginTop: 48 }}>
        {block({ width: 110, height: 22, borderRadius: 8 })}
        {block({ width: 180, height: 44, borderRadius: 10, marginTop: 20 })}
        {block({ alignSelf: 'stretch', height: 92, borderRadius: 16, marginTop: 28, marginHorizontal: -8 })}
      </View>
    </View>
  );
}

// Legacy: the closest lifetime milestone, so the section always points at
// something just ahead rather than only reporting totals. Each candidate is
// measured as progress through its own step (the last 100 km, the last 50
// activities, the current rank) and the one furthest along wins.
type Milestone = { title: string; toGo: string; pct: number };
function nextMilestone(km: number, activities: number, elevM: number, seasonEffort: number, respect: number): Milestone {
  const step = (value: number, size: number) => {
    const next = (Math.floor(value / size) + 1) * size;
    return { next, pct: (value - (next - size)) / size, left: next - value };
  };
  // Milestones fall on round numbers in whichever units are chosen.
  const dist = Math.round(toDisplayDistance(km));
  const climb = Math.round(toDisplayElevation(elevM));
  const du = distanceUnit(), eu = elevationUnit();
  const d = step(dist, dist < 100 ? 25 : 100);
  const a = step(activities, activities < 100 ? 10 : 50);
  const e = eu === 'ft' ? step(climb, climb < 30000 ? 3000 : 15000) : step(climb, climb < 10000 ? 1000 : 5000);
  const candidates: Milestone[] = [
    { title: `${d.next.toLocaleString()} ${du} lifetime`, toGo: `${d.left.toLocaleString()} ${du} to go`, pct: d.pct },
    { title: `${a.next.toLocaleString()} activities`, toGo: `${a.left.toLocaleString()} to go`, pct: a.pct },
    { title: `${e.next.toLocaleString()} ${eu} climbed`, toGo: `${e.left.toLocaleString()} ${eu} to go`, pct: e.pct },
  ];
  // Recognition from other people is a milestone too — only once someone has
  // given some, so a new account isn't pointed at a number it can't move.
  if (respect > 0) {
    const rs = step(respect, respect < 100 ? 25 : respect < 1000 ? 100 : 250);
    candidates.push({ title: `${rs.next.toLocaleString()} Respect received`, toGo: `${rs.left.toLocaleString()} to go`, pct: rs.pct });
  }
  const level = getLevel(seasonEffort);
  const nextLevel = LEVELS.find((l) => l.level === level.level + 1);
  if (nextLevel) {
    const p = xpProgressInLevel(seasonEffort);
    candidates.push({ title: `${nextLevel.name} rank`, toGo: `${Math.ceil(p.needed - p.current).toLocaleString()} Effort to go`, pct: p.pct });
  }
  return candidates.reduce((best, c) => (c.pct > best.pct ? c : best));
}

// "Run", "Weight training" — Strava's CamelCase type as a short display name.
function activityShortName(type: string | null | undefined): string {
  if (!type) return 'Activity';
  if (type === 'WeightTraining') return 'Lift';
  if (/^[A-Z]{2,}$/.test(type) || type === 'CrossFit') return type;
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0) + words.slice(1).toLowerCase();
}

// "Today", "Yesterday", "Tue", then a short date once it's over a week —
// short forms, since it sits in a third-width stat cell.
function relativeDayLabel(iso: string): string {
  const then = new Date(iso); then.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.round((now.getTime() - then.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: 'short' });
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// The lifetime total counts up from 90% the first time it scrolls into view
// (and again whenever it changes), so the biggest number on Home lands with
// some weight instead of just sitting there. Respects reduced motion.
function CountUpText({ value, style }: { value: number; style: any }) {
  const [shown, setShown] = useState(value);
  const ref = useRef<any>(null);
  const played = useRef<number | null>(null);
  useEffect(() => {
    if (played.current === value) { setShown(value); return; }
    const reduced = Platform.OS === 'web' && typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || value <= 0) { played.current = value; setShown(value); return; }
    let raf = 0;
    let io: IntersectionObserver | null = null;
    const run = () => {
      played.current = value;
      const from = Math.round(value * 0.9);
      const start = Date.now();
      const tick = () => {
        const p = Math.min(1, (Date.now() - start) / 900);
        setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const node = ref.current;
    if (Platform.OS === 'web' && node instanceof Element && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { io?.disconnect(); run(); }
      }, { threshold: 0.6 });
      io.observe(node);
    } else {
      run();
    }
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, [value]);
  return <Text ref={ref} style={style}>{shown.toLocaleString()}</Text>;
}

// The heading every mobile Home section opens with — the same pairing as the
// Weekly Leader's "You're leading" line: a serif italic title, then a small
// spaced-caps line set between two fading hairlines. One component so the
// sections can't drift apart in size again.
function MHeading({ title, subtitle, icon }: { title?: string; subtitle?: string | null; icon?: RivalIconName }) {
  return (
    <View style={styles.mHeading}>
      {title ? <Text style={styles.mStatusHeadline}>{title}</Text> : null}
      {subtitle ? (
        <View style={styles.mStatusCountdown}>
          <View style={[styles.mStatusRule, styles.mStatusRuleLeft]} />
          {icon ? <RivalIcon name={icon} size={12} color="rgba(255,181,158,0.7)" /> : null}
          <Text style={styles.mStatusCountdownText}>{subtitle}</Text>
          <View style={[styles.mStatusRule, styles.mStatusRuleRight]} />
        </View>
      ) : null}
    </View>
  );
}

function WeeklyLeaderCardBody({ leader }: { leader: WeeklyLeader | null }) {
  return (
    <>
                <View style={styles.mLeaderHead}>
                  {leader
                    ? <MHeading title={leader.teamName} subtitle="Weekly leader" />
                    : <MHeading subtitle="Weekly leader" />}
                </View>

                {leader === null || leader.standings.length === 0 ? (
                  <View style={styles.mLeaderEmpty}>
                    {/* An empty podium waiting to be filled — the same three
                        pillars as a live board, drawn as faint outlines with
                        the medal over first place, instead of a lone icon. */}
                    <View style={styles.mGhostPodium}>
                      {[{ place: 2, h: 62 }, { place: 1, h: 92 }, { place: 3, h: 46 }].map(({ place, h }) => (
                        <View key={place} style={[styles.mGhostPillar, { height: h }, place === 1 && styles.mGhostPillarFirst, podiumRise((place - 1) as 0 | 1 | 2)]}>
                          {place === 1 && (
                            <View style={[styles.medalRing, styles.mGhostMedal]}><RivalIcon name="medal" size={26} color="#ECC654" /></View>
                          )}
                          <Text style={styles.mGhostPlace}>{place}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.mGhostStage} />
                    {leader === null ? (
                      // Not in a team yet: the podium needs people, so the way
                      // forward is finding them rather than earning Effort.
                      <>
                        <MHeading title="Train together" subtitle="Join a team to fill the podium" />
                        <TouchableOpacity style={[rm.ghost, styles.mLeaderFindTeam]} onPress={() => router.push('/discover-leagues')}>
                          <Text style={rm.ghostText}>Find a team</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <MHeading title="Take the lead" subtitle="Earn the first Effort" />
                    )}
                  </View>
                ) : (() => {
                  const { standings, daysRemaining } = leader;
                  const selfIndex = standings.findIndex((e) => e.isSelf);
                  const endsLabel = daysRemaining === 0 ? 'Last Day' : daysRemaining === 1 ? 'Ends Tomorrow' : `${daysRemaining} Days Remaining`;
                  const slots = podiumSlots(standings);
                  const maxPoints = standings[0]?.points || 1;
                  // A tie for 1st consumes two of the podium's three "places" — the
                  // next distinct score along is really 2nd place, not 3rd, even
                  // though it still renders in the visually-3rd (right) column.
                  const tiedForFirstCount = standings.filter((s) => s.points === maxPoints).length;
                  const rankShift = Math.max(0, tiedForFirstCount - 1);
                  // Always use the fixed-width column treatment (never the
                  // flex:1-across-3-columns one) — Ricky wants pillars at
                  // the same generous width regardless of headcount, matching
                  // how they looked with just 2 people on the board.
                  const activeCount = slots.filter(Boolean).length;
                  const sparse = true;
                  return (
                    <>
                      {/* Capped/centered to match mPodiumGrid's own cap — otherwise the
                          absolutely-positioned stage line (inset relative to THIS wrapper)
                          would stay full bleed-width while the pillars sit centered and
                          narrower, drifting out of alignment on wide viewports. */}
                      <View style={{ position: 'relative', maxWidth: 360, alignSelf: 'center' }}>
                        {(() => {
                          // The static left:20/right:20 inset is tuned for the full
                          // 3-column row. When sparse, the pillars are centered at a
                          // fixed width with empty flex space on either side, so that
                          // same inset stretched the line far past the actual pillar
                          // footprint. Size and center it to the real footprint instead.
                          if (!sparse) return <View style={styles.mPodiumStageLine} pointerEvents="none" />;
                          const COLUMN_W = 82;
                          const GAP = 12;
                          const BLEED = 36;
                          const footprint = activeCount * COLUMN_W + Math.max(0, activeCount - 1) * GAP + BLEED * 2;
                          const sparseInset: any = { left: '50%', right: undefined, width: footprint, marginLeft: -footprint / 2 };
                          return <View style={[styles.mPodiumStageLine, sparseInset]} pointerEvents="none" />;
                        })()}
                        <View style={[styles.mPodiumGrid, sparse && styles.mPodiumGridSparse]}>
                        {slots.map((slot, colIdx) => {
                          if (!slot) return sparse ? null : <View key={colIdx} style={{ flex: 1 }} />;
                          const { entry, rank } = slot;
                          // A tie for 1st should read as two co-leaders, not "1st place and a
                          // runner-up who happens to match its score" — promote the tied slot to
                          // the same gold styling/height/crown as rank 0. Column position (left/
                          // center/right) and its shard slant are unaffected, only the rank-based
                          // visual treatment.
                          const isTiedForFirst = rank !== 0 && entry.points === maxPoints;
                          // Shift a non-tied entry's style down by however many extra
                          // places the tie ate (e.g. two tied for 1st → the 3rd-column
                          // entry shows as 2nd-place styling, not 3rd).
                          const effRank = (isTiedForFirst ? 0 : Math.max(0, rank - rankShift)) as 0 | 1 | 2;
                          const rankStyle = PODIUM_RANK_STYLE[effRank];
                          const heightPct = Math.max(0.35, entry.points / maxPoints);
                          const pillarHeight = Math.round(rankStyle.minH + (rankStyle.maxH - rankStyle.minH) * heightPct);
                          // Mockup floats the crown a fixed distance above the
                          // avatar (not in normal flow, doesn't push it down)
                          // — same ~0.44x-of-avatar-size ratio as the mockup's
                          // 30px-above-a-68px-avatar spacing, scaled to ours.
                          // padTop is tuned for this rank's mockup-reference height, but a
                          // real-data pillar can end up much shorter (e.g. a 3rd-place entry
                          // far behind 1st) — clamp it so the name+points+"pts" stack always
                          // has room, instead of squeezing the name text to ~0px tall.
                          const MIN_CONTENT_H = effRank === 0 ? 64 : 50;
                          // The shard's top edge is slanted (SHARD_SLOPE), not flat — on the
                          // lower corner the colored fill doesn't start until partway down.
                          // padTop must clear that corner or the centered text renders partly
                          // in the empty wedge above the fill instead of inside the pillar.
                          // Tied-for-1st pillars use a matched slope magnitude (rank 0's own
                          // 0.15) on whichever corner faces the other tied pillar — the default
                          // per-column slopes differ (0.20/0.15/0.25), so two "equal height"
                          // pillars with mismatched slopes still looked uneven at the edge
                          // where they meet.
                          const shardSlope: [number, number] = isTiedForFirst
                            ? (colIdx === 0 ? [0, 0.15] : colIdx === 2 ? [0.15, 0] : SHARD_SLOPE[colIdx])
                            : SHARD_SLOPE[colIdx];
                          const [shardTl, shardTr] = shardSlope;
                          const slantClearance = Math.ceil(Math.max(shardTl, shardTr) * pillarHeight) + PILLAR_DEPTH + 4;
                          const faces = pillarFaces(shardSlope, pillarHeight);
                          const effPadTop = Math.max(slantClearance, Math.min(rankStyle.padTop, pillarHeight - MIN_CONTENT_H - rankStyle.padBottom));
                          // Raising padTop to clear the slant can eat back into the room the
                          // MIN_CONTENT_H clamp above just freed up — give padBottom first
                          // before the content stack itself gets squeezed again.
                          const effPadBottom = Math.max(8, Math.min(rankStyle.padBottom, pillarHeight - effPadTop - MIN_CONTENT_H));
                          return (
                            <View key={entry.userId} style={[styles.mPodiumColumn, sparse && styles.mPodiumColumnSparse]}>
                              {/* The leader's glow is its own layer beneath the picture's
                                  wrapper, not inside it: inside a filtered, animated
                                  wrapper Safari drew it over the photo. */}
                              {effRank === 0 && Platform.OS === 'web' && (
                                <View
                                  pointerEvents="none"
                                  style={[
                                    styles.mPodiumHalo,
                                    {
                                      top: rankStyle.avatarSize / 2,
                                      width: rankStyle.avatarSize * 1.9, height: rankStyle.avatarSize * 1.9,
                                      marginLeft: -rankStyle.avatarSize * 0.95, marginTop: -rankStyle.avatarSize * 0.95,
                                      borderRadius: rankStyle.avatarSize,
                                      zIndex: 0,
                                    },
                                    LEADER_HALO,
                                  ]}
                                />
                              )}
                              <View
                                style={[
                                  // Above the pillar, so the leader's sparkles pass behind the picture.
                                  { position: 'relative', zIndex: 2 },
                                  Platform.OS === 'web' ? ({ filter: `drop-shadow(0 0 ${rankStyle.avatarGlowRadius}px ${rankStyle.avatarGlow})` } as any) : null,
                                  podiumSettle(effRank),
                                ]}
                              >
                                {effRank === 0 && <LaurelWreath avatarSize={rankStyle.avatarSize} />}
                                <View
                                  style={[
                                    {
                                      width: rankStyle.avatarSize, height: rankStyle.avatarSize, borderRadius: rankStyle.avatarSize / 2,
                                      padding: AVATAR_RING,
                                      // Above the glow behind it — an animated layer can
                                      // otherwise be drawn on top in some browsers.
                                      position: 'relative', zIndex: 2,
                                      transform: [{ rotate: colIdx === 0 ? '-7deg' : colIdx === 2 ? '7deg' : '0deg' }],
                                    },
                                    avatarRing(rankStyle.tint),
                                  ]}
                                >
                                  <View
                                    style={[
                                      styles.mPodiumAvatar,
                                      { flex: 1, borderRadius: rankStyle.avatarSize / 2, overflow: 'hidden' },
                                      // No photo: a warm glow of the rank colour, lit from
                                      // the top left, instead of a flat grey disc.
                                      !entry.avatarUrl && initialBackdrop(rankStyle.tint),
                                    ]}
                                  >
                                    {entry.avatarUrl ? (
                                      <Image
                                        source={{ uri: entry.avatarUrl }}
                                        style={{ width: rankStyle.avatarSize - AVATAR_RING * 2, height: rankStyle.avatarSize - AVATAR_RING * 2, borderRadius: rankStyle.avatarSize / 2 }}
                                      />
                                    ) : (
                                      <Text style={[styles.mPodiumInitial, { color: rankStyle.tint, fontSize: rankStyle.avatarSize * 0.46, lineHeight: rankStyle.avatarSize * 0.56 }, initialGlow(rankStyle.tint)]}>
                                        {(entry.name[0] || '?').toUpperCase()}
                                      </Text>
                                    )}
                                  </View>
                                </View>
                              </View>
                              <View
                                style={[
                                  { width: '100%', height: pillarHeight, marginTop: 2 },
                                  Platform.OS === 'web' ? ({ filter: `drop-shadow(0 0 ${rankStyle.glowRadius}px ${rankStyle.glow})` } as any) : null,
                                  podiumRise(effRank),
                                ]}
                              >
                                <Svg width="100%" height="100%" viewBox={`0 0 100 ${pillarHeight}`} preserveAspectRatio="none" style={{ position: 'absolute' }}>
                                  <Defs>
                                    <LinearGradient id={`podiumGrad${colIdx}`} x1="0" y1="0" x2="0" y2="1">
                                      <Stop offset="0" stopColor={rankStyle.gradFrom} />
                                      <Stop offset="1" stopColor={rankStyle.gradTo} />
                                    </LinearGradient>
                                    {/* Side light: brighter on the left face, shaded on the
                                        right, so the pillar reads as a solid block, not a flat card. */}
                                    <LinearGradient id={`podiumFacet${colIdx}`} x1="0" y1="0" x2="1" y2="0">
                                      <Stop offset="0" stopColor="#ffffff" stopOpacity={0.14} />
                                      <Stop offset="0.45" stopColor="#ffffff" stopOpacity={0} />
                                      <Stop offset="1" stopColor="#000000" stopOpacity={0.28} />
                                    </LinearGradient>
                                  </Defs>
                                  {/* Side face: the pillar's colour, shaded. */}
                                  <Polygon points={faces.side} fill={`url(#podiumGrad${colIdx})`} />
                                  <Polygon
                                    points={faces.side}
                                    fill="#000000" fillOpacity={0.42}
                                    stroke={rankStyle.tint} strokeOpacity={0.35} strokeWidth={1}
                                    strokeLinejoin="miter" vectorEffect="non-scaling-stroke"
                                  />
                                  {/* Top face: catches the light. */}
                                  <Polygon points={faces.top} fill={rankStyle.tint} fillOpacity={effRank === 0 ? 0.42 : 0.3} />
                                  <Polygon
                                    points={faces.top}
                                    fill="#ffffff" fillOpacity={0.12}
                                    stroke={rankStyle.tint} strokeOpacity={0.6} strokeWidth={1}
                                    strokeLinejoin="miter" vectorEffect="non-scaling-stroke"
                                  />
                                  {/* Front face. */}
                                  <Polygon
                                    points={faces.front}
                                    fill={`url(#podiumGrad${colIdx})`}
                                    stroke={rankStyle.tint}
                                    strokeWidth={1.25}
                                    strokeOpacity={0.85}
                                    strokeLinejoin="miter"
                                    // The viewBox's non-uniform x/y scaling (preserveAspectRatio="none")
                                    // otherwise stretches the stroke unevenly, blunting the sharp
                                    // corners instead of a clean miter point.
                                    vectorEffect="non-scaling-stroke"
                                  />
                                  <Polygon points={faces.front} fill={`url(#podiumFacet${colIdx})`} />
                                  {/* The lit front edge, where the top face meets the front. */}
                                  <Line
                                    {...faces.frontEdge}
                                    stroke="#ffffff" strokeOpacity={effRank === 0 ? 0.75 : 0.5} strokeWidth={1.5}
                                    vectorEffect="non-scaling-stroke"
                                  />
                                </Svg>
                                {/* The sweep of light crosses every pillar, one after another. */}
                                {PODIUM_MOTION && (
                                  <View
                                    pointerEvents="none"
                                    style={[
                                      styles.mPodiumSheenClip,
                                      { clipPath: faces.frontClip } as any,
                                    ]}
                                  >
                                    <View style={[styles.mPodiumSheen, podiumSheen(effRank)]} />
                                  </View>
                                )}
                                <View style={{ flex: 1, alignItems: 'center', paddingTop: effPadTop, paddingBottom: effPadBottom, marginRight: `${PILLAR_SIDE}%` }}>
                                  <Text style={[styles.mPodiumName, { color: rankStyle.tint, fontSize: rankStyle.nameSize, lineHeight: Math.round(rankStyle.nameSize * 1.15), letterSpacing: rankStyle.nameLetterSpacing }]} numberOfLines={1}>
                                    {entry.name}
                                  </Text>
                                  <Text style={[styles.mPodiumPoints, { fontSize: rankStyle.ptsSize, lineHeight: Math.round(rankStyle.ptsSize * 1.15), color: rankStyle.ptsColor }]}>{entry.points}</Text>
                                  <Text style={{ fontSize: 10, lineHeight: 12, color: rankStyle.ptsTint, fontWeight: '500', flexShrink: 0 }}>Effort</Text>
                                </View>
                                {effRank === 0 && <PodiumSparkles slope={shardSlope} height={pillarHeight} />}
                              </View>
                            </View>
                          );
                        })}
                        </View>
                      </View>

                      {(() => {
                        const story = selfIndex !== -1 ? weeklyRankStory(standings, selfIndex) : null;
                        // The gap is always salmon, leading or chasing (Ricky,
                        // 2026-09-26).
                        const numberStyle = [styles.mStatusNumber, { color: RivalColors.accentText }];
                        return (
                          // No capsule: a grey bordered box read as a generic
                          // UI chip bolted onto the podium. This is a headline
                          // in the brand serif, with the countdown set between
                          // hairlines that echo the stage line above.
                          <View style={styles.mStatus}>
                            {/* Number and words as siblings in a centred row, not
                                one nested Text: nested spans share a baseline, so
                                the words sat level with the foot of the big number
                                instead of across its middle. */}
                            {story ? (
                              <View style={styles.mStatusLine}>
                                {story.gap !== null && story.before === '' ? (
                                  <>
                                    <Text style={numberStyle}>{story.gap}</Text>
                                    <Text style={[styles.mStatusHeadline, styles.mStatusBeside]}>{story.after.trim()}</Text>
                                  </>
                                ) : (
                                  <>
                                    <Text style={[styles.mStatusHeadline, story.gap !== null && styles.mStatusBeside]}>{story.before.trim()}</Text>
                                    {story.gap !== null ? <Text style={numberStyle}>{story.gap}</Text> : null}
                                  </>
                                )}
                              </View>
                            ) : null}
                            <View style={styles.mStatusCountdown}>
                              <View style={[styles.mStatusRule, styles.mStatusRuleLeft]} />
                              <Text style={styles.mStatusCountdownText}>{endsLabel}</Text>
                              <View style={[styles.mStatusRule, styles.mStatusRuleRight]} />
                            </View>
                          </View>
                        );
                      })()}
                    </>
                  );
                })()}
    </>
  );
}

export default function HomeScreen() {
  const [stravaConnected, setStravaConnected] = useSnapState('home.stravaConnected', true);
  const [leagues, setLeagues] = useSnapState<League[]>('home.leagues', []);
  // Populated by loadAll() below from real account data.
  // One entry per team the user belongs to (mobile Weekly Leader card swipes
  // across all of them); `weeklyLeader` below stays the most-active team's
  // data, same as before this became a list, so every other reader of it
  // (desktop Focus card, Momentum status line) is unaffected.
  const [weeklyLeaders, setWeeklyLeaders] = useSnapState<WeeklyLeader[]>('home.weeklyLeaders', []);
  const [leaderCardIndex, setLeaderCardIndex] = useState(0);
  const leaderScrollRef = useRef<ScrollView>(null);
  const weeklyLeader = weeklyLeaders[0] ?? null;
  const [momentumTrainers, setMomentumTrainers] = useSnapState<MomentumTrainers | null>('home.momentumTrainers', null);
  const [nextRace, setNextRace] = useSnapState<NextRace>('home.nextRace', null);
  const [totalDistanceKm, setTotalDistanceKm] = useSnapState('home.totalDistanceKm', 0);
  const [totalElevationM, setTotalElevationM] = useSnapState('home.totalElevationM', 0);
  const [totalTimeMinutes, setTotalTimeMinutes] = useSnapState('home.totalTimeMinutes', 0);
  // Lifetime effort/activity counts — kept separate from totalXp (season-
  // scoped, drives getLevel()) so the LEGACY card's four numbers are all the
  // same timeframe without changing what powers the user's rank.
  const [lifetimeXp, setLifetimeXp] = useSnapState('home.lifetimeXp', 0);
  const [lifetimeActivityCount, setLifetimeActivityCount] = useSnapState('home.lifetimeActivityCount', 0);
  const [weeklyStreak, setWeeklyStreak] = useSnapState('home.weeklyStreak', 0);
  // Today-only Effort — new, mobile Legacy section's "Effort today" stat.
  // Derived from the same `activities` array loadAll() already fetches, not
  // a new query.
  const [todayEffort, setTodayEffort] = useSnapState('home.todayEffort', 0);
  const [rankName, setRankName] = useSnapState<string | null>('home.rankName', null);
  // Legacy: what moved this week, the most recent session, and this season's
  // Effort (for the rank milestone) — all from the activities already loaded.
  const [legacyWeek, setLegacyWeek] = useSnapState('home.legacyWeek', { effort: 0, count: 0, km: 0, elevM: 0 });
  const [lastActivity, setLastActivity] = useSnapState<{ type: string | null; startedAt: string } | null>('home.lastActivity', null);
  const [seasonEffortTotal, setSeasonEffortTotal] = useSnapState('home.seasonEffortTotal', 0);
  // Lifetime recognition received — Legacy's Impact page and a milestone.
  const [respectReceived, setRespectReceived] = useSnapState('home.respectReceived', 0);
  const [impact, setImpact] = useSnapState('home.impact', { respect: 0, inspired: 0, people: 0 });
  // The same totals for this week alone — the Impact page's "+N this week".
  const [impactWeek, setImpactWeek] = useSnapState('home.impactWeek', { respect: 0, inspired: 0, people: 0 });
  const hasImpact = impact.respect + impact.inspired > 0;
  const [legacyBoxWidth, setLegacyBoxWidth] = useState(0);
  const [legacyPage, setLegacyPage] = useState(0);
  // The Legacy headline figure swipes between lifetime Effort and this year's.
  const [heroWidth, setHeroWidth] = useState(0);
  const [heroPage, setHeroPage] = useState(0);
  const heroScrollRef = useRef<ScrollView>(null);
  const legacyScrollRef = useRef<ScrollView>(null);
  const [featuredGoal, setFeaturedGoal] = useSnapState<FeaturedGoal | null>('home.featuredGoal', null);
  // False until the first load finishes. Every figure above starts empty, not
  // with example numbers, and the phone layout shows a skeleton until then —
  // so nobody ever sees placeholder figures that look like someone's real data.
  // Later reloads (returning to the tab, pull to refresh) keep the last data up.
  const [loaded, setLoaded] = useSnapState('home.loaded', false);
  const [goalsCardHovered, setGoalsCardHovered] = useState(false);
  const [leaderCardHovered, setLeaderCardHovered] = useState(false);
  const [momentumCardHovered, setMomentumCardHovered] = useState(false);
  const [statsCardHovered, setStatsCardHovered] = useState(false);
  const [addActivityHovered, setAddActivityHovered] = useState(false);
  const [avatarUrl, setAvatarUrl] = useSnapState<string | null>('home.avatarUrl', null);

  useFocusEffect(useCallback(() => {
    loadAll();
  }, []));

  const { scrollProps: pullProps, indicator: pullIndicator } = usePullToRefresh(() => loadAll());

  async function loadAll() {
    try {
      await loadAllData();
    } finally {
      setLoaded(true);
    }
  }

  async function loadImpact(uId: string, activities: any[]) {
    const all = await fetchReactionsOn(activities.map((a) => a.id));
    const totals = impactTotals(all, uId);
    setRespectReceived(totals.respect);
    setImpact(totals);
    const weekStart = getMondayOfWeek(new Date()).getTime();
    setImpactWeek(impactTotals(all.filter((r) => new Date(r.created_at).getTime() >= weekStart), uId));

  }

  async function loadAllData() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;

    const uId = user.id;

    const today = todayLocalStr();

    // Phase 1: own data + strava status
    // Every request is a round trip to the database, so nothing waits on
    // anything it doesn't need: the team standings only need the list of
    // teams, so they start the moment that arrives, alongside the person's
    // own history rather than after it. Promise.resolve runs the query once —
    // a query builder is a thenable that runs again on every .then.
    const leaguesP = getMyTeamRows(uId).then((data) => ({ data }), () => ({ data: [] as any[] }));
    const teamsDone = leaguesP.then((res) => loadTeams(uId, res.data ?? [])).catch(() => {});

    const [stravaRes, activitiesRes, leaguesRes, raceRes, userProfileRes, goalsRes] = await Promise.all([
      supabase.from('fitness_connections').select('user_id').eq('user_id', uId).eq('provider', 'strava').maybeSingle(),
      fetchAllActivities(uId, 'id, started_at, effort_score, distance_meters, elevation_meters, activity_type, duration_seconds'),
      leaguesP,
      supabase.from('races').select('name, race_date').eq('user_id', uId).gte('race_date', today).order('race_date', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('users').select('avatar_url').eq('id', uId).single(),
      supabase.from('goals').select('*').eq('user_id', uId),
    ]);

    // The season ends at midnight on 1 January where the person is, and the
    // server's end-of-season snapshot needs to know where that is. The column
    // is write-only to the app (it would reveal roughly where someone lives),
    // so the device remembers what it last sent and writes only on a change.
    // Never awaited: a failure here must not hold up Home.
    const tz = deviceTimeZone();
    if (tz) {
      const key = `rival.tz.${uId}`;
      let sent: string | null = null;
      try { sent = globalThis.localStorage?.getItem(key) ?? null; } catch {}
      if (sent !== tz) {
        supabase.from('users').update({ timezone: tz }).eq('id', uId).then(({ error }) => {
          if (!error) { try { globalThis.localStorage?.setItem(key, tz); } catch {} }
        }, () => {});
      }
    }

    setStravaConnected(!!stravaRes.data);
    setNextRace(raceRes.data ?? null);
    const myAvatarUrl: string | null = userProfileRes.data?.avatar_url || null;
    setAvatarUrl(myAvatarUrl);

    if (!leaguesRes.data?.length) setLeagues([]);

    const activities = activitiesRes;
    setTotalDistanceKm(Math.round(activities.reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000));
    setTotalElevationM(Math.round(activities.reduce((s, a) => s + (a.elevation_meters || 0), 0)));
    setTotalTimeMinutes(Math.round(activities.reduce((s, a) => s + (a.duration_seconds || 0), 0) / 60));
    setLifetimeXp(activities.reduce((s, a) => s + (a.effort_score || 0), 0));
    setLifetimeActivityCount(activities.length);
    setWeeklyStreak(calculateStreak(activities).current);
    // Same local-day-boundary approach as the league "recentCount" teaser
    // below — additive filter over the array already fetched above, no new query.
    setTodayEffort(activities.filter(a => dateLocalStr(new Date(a.started_at)) === today).reduce((s, a) => s + (a.effort_score || 0), 0));

    // Rank = level from this season's Effort — same definition the nav bar uses.
    const seasonStart = new Date(getSeasonStartISO());
    const seasonEffort = activities.filter(a => new Date(a.started_at) >= seasonStart).reduce((s, a) => s + (a.effort_score || 0), 0);
    setRankName(getLevel(seasonEffort).name);
    setSeasonEffortTotal(seasonEffort);

    const legacyWeekStart = getMondayOfWeek(new Date());
    const thisWeek = activities.filter(a => new Date(a.started_at) >= legacyWeekStart);
    setLegacyWeek({
      effort: Math.round(thisWeek.reduce((s, a) => s + (a.effort_score || 0), 0)),
      count: thisWeek.length,
      km: Math.round(thisWeek.reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000),
      elevM: Math.round(thisWeek.reduce((s, a) => s + (a.elevation_meters || 0), 0)),
    });
    const latest = activities.reduce<any>((best, a) => (!best || a.started_at > best.started_at ? a : best), null);
    setLastActivity(latest ? { type: latest.activity_type ?? null, startedAt: latest.started_at } : null);

    // Impact (Legacy's second page) loads alongside the rest of Home rather
    // than holding it up. Individual reactions are notifications, in the inbox.
    loadImpact(uId, activities).catch(() => {});

    // Featured goal: the ACTIVE goal nearest its deadline (tie-break: most
    // complete). One goal on the dashboard, deliberately — Ricky's call:
    // showing several dilutes focus; the card links to /goals for the rest.
    const now = new Date();
    type GoalRowFull = GoalRow & { id: string; target_value: number; period_type: 'week' | 'month' | 'custom'; pinned?: boolean };
    const allGoals = (goalsRes.data ?? []) as GoalRowFull[];
    const activeGoals = allGoals
      .filter(g => { const end = new Date(g.end_date); end.setHours(23, 59, 59, 999); return end >= now; })
      .map(g => {
        const progress = computeGoalProgress(g, activities);
        const end = new Date(g.end_date); end.setHours(23, 59, 59, 999);
        return {
          endMs: end.getTime(),
          goal: g,
          progress,
          pct: g.target_value > 0 ? Math.min(1, progress / g.target_value) : 0,
        };
      })
      // Pinned goal wins outright, ahead of the nearest-deadline sort —
      // that sort is only the fallback for when nothing's been pinned.
      .sort((a, b) => (b.goal.pinned ? 1 : 0) - (a.goal.pinned ? 1 : 0) || a.endMs - b.endMs || b.pct - a.pct);
    if (activeGoals.length > 0) {
      const top = activeGoals[0];
      const unit = goalUnit(top.goal.goal_type);
      const useMeters = unit === 'km' && top.goal.activity_filter != null && METERS_SPORTS.has(top.goal.activity_filter);
      setFeaturedGoal({
        id: top.goal.id,
        title: featuredGoalTitle(top.goal),
        activityLabel: top.goal.goal_type === 'gym_sessions' ? 'Gym activities' : (top.goal.activity_filter ?? 'All Activities'),
        progress: useMeters ? Math.round(top.progress * 1000) : shownGoal(top.goal.goal_type, top.progress).value,
        target: useMeters ? Math.round(top.goal.target_value * 1000) : shownGoal(top.goal.goal_type, top.goal.target_value).value,
        unit: useMeters ? 'm' : shownGoal(top.goal.goal_type, 0).unit,
        pct: top.pct,
        daysLeft: Math.max(0, Math.ceil((top.endMs - now.getTime()) / (1000 * 60 * 60 * 24))),
      });
    } else {
      // No active goal — the "ended, not hit" encouragement + Try Again
      // action lives only on the Goals page (goals.tsx's isGoalEnded/
      // endedMessage), not here. Today's card just invites setting a new
      // one either way.
      setFeaturedGoal(null);
    }

    // Teams load alongside everything above rather than after it.
    await teamsDone;
  }

  async function loadTeams(uId: string, memberships: any[]) {
    const leagueList: League[] = memberships.map((m: any) => m.leagues).filter(Boolean);
    const leagueIds: string[] = memberships.map((m: any) => m.league_id);
    setLeagues(leagueList);

    // Per-league "new activity" teaser count — powers the Team Pulse card.
    // Local calendar-day boundary (midnight in the viewer's own device
    // timezone), not a rolling 24h window — a rolling window still calls
    // yesterday-afternoon's workout "today" if it's under 24h old, which is
    // exactly the mismatch a rolling window can't avoid. This runs
    // client-side so it's automatically each viewer's own "today", no
    // matter what country they're in.
    if (leagueIds.length > 0) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const { data: leagueMembersData } = await supabase
        .from('league_members')
        .select('league_id, user_id')
        .in('league_id', leagueIds)
        .eq('status', 'active');

      const memberIdsByLeague: Record<string, string[]> = {};
      (leagueMembersData || []).forEach((m: any) => {
        if (!memberIdsByLeague[m.league_id]) memberIdsByLeague[m.league_id] = [];
        memberIdsByLeague[m.league_id].push(m.user_id);
      });

      const allMemberIds = [...new Set((leagueMembersData || []).map((m: any) => m.user_id as string))];

      // Today's activity (Momentum) and this week's Effort (Weekly Leader)
      // come from one request: the week always contains today (weeks start
      // on Monday), so today's activities are the tail of the week's.
      const weekStart = getMondayOfWeek(new Date());
      // Every teammate's name and picture alongside the week's activities, not
      // after them: waiting to learn who ranked before asking for names cost a
      // whole extra round trip, and teams are small enough to ask for everyone.
      const [{ data: weekActivities }, { data: memberProfiles }] = allMemberIds.length > 0
        ? await Promise.all([
            Promise.resolve(supabase
              .from('activities')
              .select('user_id, started_at, effort_score')
              .in('user_id', allMemberIds)
              .gte('started_at', weekStart.toISOString())
              .order('started_at', { ascending: false })),
            Promise.resolve(supabase.from('users').select('id, display_name, avatar_url').in('id', allMemberIds)),
          ])
        : [{ data: [] as any[] }, { data: [] as any[] }];
      const recentActivities = (weekActivities || []).filter((a: any) => new Date(a.started_at) >= startOfToday);

      const leagueListWithCounts = leagueList.map((l: League) => {
        const memberIds = new Set(memberIdsByLeague[l.id] || []);
        const count = (recentActivities || []).filter((a: any) => a.user_id !== uId && memberIds.has(a.user_id)).length;
        return { ...l, recentCount: count };
      });
      // Most-active teams first — Momentum is "who's training right now", and
      // only the top few show by default (mockup keeps this card compact).
      leagueListWithCounts.sort((a: League, b: League) => (b.recentCount ?? 0) - (a.recentCount ?? 0));
      setLeagues(leagueListWithCounts);

      // Who's actually moved, not just how many — "Sandy, Emma and 3 others"
      // reads as a nudge from people, not a stat. Most-recent-first, dedup'd,
      // for the same top team the rest of Momentum/Weekly Leader focus on.
      const hotLeague = leagueListWithCounts[0];
      const hotMemberIds = new Set(memberIdsByLeague[hotLeague.id] || []);
      const trainerIds: string[] = [];
      let selfTrained = false;
      (recentActivities || []).forEach((a: any) => {
        if (a.user_id === uId) { selfTrained = true; return; }
        if (hotMemberIds.has(a.user_id) && !trainerIds.includes(a.user_id)) {
          trainerIds.push(a.user_id);
        }
      });
      // Their names come from the same profile request as the standings below.

      // Weekly Leader: standings for EVERY team you're in, this calendar week
      // (Monday-start, same boundary streak.ts uses) — one entry per team,
      // most-active first (leagueListWithCounts is already sorted that way),
      // so the mobile card can swipe across all of them. A single big session
      // can't win the whole day-to-day this way — it has to hold up over the
      // week, and laggards can see exactly how much Effort they need to catch
      // the leader instead of just "some number."
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      const daysRemaining = Math.max(0, Math.ceil((weekEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

      // Batched, not per-league. This used to run TWO awaited queries inside a
      // loop over every team — activities, then profiles — so an athlete in
      // four teams waited on eight sequential round trips before Today could
      // render. Effort for the week is per-user and independent of team, so it
      // can all be fetched once and grouped in memory; the teams only decide
      // WHICH users appear in each list.
      // allMemberIds is already in scope above — every member across every team.
      const leaders: WeeklyLeader[] = [];
      if (allMemberIds.length > 0) {
        const pointsByUser: Record<string, number> = {};
        (weekActivities || []).forEach((a: any) => {
          pointsByUser[a.user_id] = (pointsByUser[a.user_id] || 0) + (a.effort_score || 0);
        });

        // Work out every ranked athlete across every team first, so their
        // profiles come back in a single request too.
        const rankedByLeague: Record<string, string[]> = {};
        const everyRankedId = new Set<string>();
        for (const league of leagueListWithCounts) {
          // A team where nobody has scored yet this week still gets an entry —
          // an empty list, not a missing one. Dropping it removed the team from
          // the carousel entirely, so someone in three teams saw one card and
          // no way to swipe, as if the other two didn't exist.
          const ids = (memberIdsByLeague[league.id] || [])
            .filter((id) => (pointsByUser[id] || 0) > 0)
            .sort((a, b) => pointsByUser[b] - pointsByUser[a]);
          rankedByLeague[league.id] = ids;
          ids.forEach((id) => everyRankedId.add(id));
        }

        // One profile request for everyone Home names: today's trainers
        // (Momentum) and everyone on a podium.
        const profileById: Record<string, any> = {};
        (memberProfiles || []).forEach((p: any) => { profileById[p.id] = p; });
        setMomentumTrainers(trainerIds.length > 0
          ? { leagueId: hotLeague.id, names: trainerIds.map((id) => firstNameOnly(profileById[id])), totalCount: trainerIds.length, selfTrained }
          : null);

        for (const league of leagueListWithCounts) {
          const rankedIds = rankedByLeague[league.id] ?? [];
          // First name + last initial, always — see weeklyLeaderName above.
          const standings: WeeklyLeaderEntry[] = rankedIds.map((id) => ({
            userId: id,
            name: weeklyLeaderName(profileById[id]),
            avatarUrl: profileById[id]?.avatar_url || null,
            points: Math.round(pointsByUser[id]),
            isSelf: id === uId,
          }));
          leaders.push({ leagueId: league.id, teamName: formatTeamName(league.name), daysRemaining, standings });
        }
      }
      // Lead with the board that has the most people on it this week — a
      // podium with teammates on it is the story, a solo board is just you.
      // Then the team with the most members, so when nobody else has scored
      // yet the real team still comes before a team of one. The sort is
      // stable, so remaining ties keep the most-active-first order.
      const memberCount = (id: string) => (memberIdsByLeague[id] || []).length;
      leaders.sort((a, b) =>
        b.standings.length - a.standings.length || memberCount(b.leagueId) - memberCount(a.leagueId));
      setWeeklyLeaders(leaders);
    } else {
      setWeeklyLeaders([]);
    }
  }

  function handleConnectStrava() {
    connectStrava(loadAll);
  }

  // The mockup's 4-card row must stay 4-across on desktop — explicit quarter
  // widths above the breakpoint, natural wrapping (2-up/stacked) below it.
  const { width: windowWidth } = useWindowDimensions();
  const fourUp = windowWidth >= BREAKPOINT_WIDE_LAYOUT;
  // Mobile-only redesign branch — see rival/design/today-redesign. Desktop
  // (below) is untouched: same width check the 4-up grid already uses, just
  // inverted, so the two never overlap.
  const mobile = windowWidth < BREAKPOINT_WIDE_LAYOUT;
  const gridCardStyle = fourUp ? [styles.gridCard, styles.gridCardQuarter] : styles.gridCard;
  const days = nextRace ? daysUntil(nextRace.race_date) : null;
  const seasonYear = getCurrentSeasonYear();
  const seasonDaysLeft = daysUntilSeasonEnd();
  const heroHours = Math.floor(totalTimeMinutes / 60);
  const heroMins = totalTimeMinutes % 60;
  const heroTimeText = `${heroHours > 0 ? `${heroHours}h ` : ''}${heroMins}m`;
  // `content`'s horizontal padding (24 each side) minus heroCard's own maxWidth
  // (92%) and internal padding (16 each side) — see styles below.
  const heroCardAvailableWidth = Math.min(windowWidth - 48, 1200) * 0.92 - 32;

  return (
    <View style={{ flex: 1 }}>
      {/* Fixed viewport-covering background, decoupled from content height —
          a long team/stats list scrolling taller than one screen must never
          outgrow the photo (same fix as league.tsx). Desktop only — the
          mockup's mobile redesign has no hero photo, just a flat dark
          background (#131313 + a subtle warm radial glow), so mobile skips
          both the photo and its scrim entirely. */}
      {!mobile && (
        <>
          <ImageBackground
            source={require('../../assets/images/backgrounds/optimized/a-single-solo-athlete-standing-on.jpg')}
            style={styles.bgFixed}
            resizeMode="cover"
          />
          <View style={styles.scrim} />
        </>
      )}
      {mobile && <View style={styles.mBgFixed} />}
      {/* edges omits 'bottom': the default bottom edge pads this container by
          the home-indicator inset (34pt on device), which ended the scrollable
          region at 818 instead of the true 852 screen bottom and clipped the
          last card there. The bottom nav is a floating overlay, not in-flow,
          so content is meant to run underneath it all the way to the edge —
          the clearance that keeps the last card clear of the pill is
          contentMobile's own paddingBottom, not a padded container. */}
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <RivalTopNav
          active="today"
          centerSlot={mobile ? (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.mTimeEarnedLabel}>TOTAL TIME EARNED</Text>
              {/* Split number/unit, same pattern as the Focus card's hero
                  number — a single string in the serif italic style rendered
                  "h"/"m" as oversized swash letters welded onto the digits
                  instead of reading as units. */}
              {!loaded ? <SkeletonBar width={72} height={18} style={{ marginTop: 5 }} /> : (
              <Text numberOfLines={1}>
                {heroHours > 0 && (
                  <>
                    <Text style={styles.mTimeEarnedValue}>{heroHours}</Text>
                    <Text style={styles.mTimeEarnedUnit}>h </Text>
                  </>
                )}
                <Text style={styles.mTimeEarnedValue}>{heroMins}</Text>
                <Text style={styles.mTimeEarnedUnit}>m</Text>
              </Text>
              )}
            </View>
          ) : undefined}
        />

        <ScrollView
          contentContainerStyle={[styles.content, mobile && styles.contentMobile]}
          // iOS standalone (home-screen) web apps have a known WebKit quirk:
          // position:fixed siblings of a nested SCROLLING div (this one —
          // the actual page <body> deliberately doesn't scroll, see
          // +html.tsx) can fail to stay pinned to the viewport during/after
          // that div's scroll. This is the standard compositing fix for
          // that exact case.
          style={Platform.OS === 'web' ? ({ WebkitOverflowScrolling: 'touch' } as any) : undefined}
          {...pullProps}
        >
          {pullIndicator}

          {mobile && !loaded ? (
            <MobileHomeSkeleton />
          ) : mobile ? (
            <>
              {/* Weekly Leader podium — swipeable across every team you're in
                  (Instagram-style: drag either direction, snaps to the next
                  card). The card's own background (gradient + smoke glow) is
                  painted ONCE by this single outer RivalCard — only the
                  podium/text content pages across on top of it, so there's
                  no second independently-painted background to ever show a
                  seam against. No dot indicators.
                  Page width is computed directly from windowWidth and the
                  card's own known fixed horizontal padding (16 a side) —
                  NOT measured via onLayout. Measuring would recreate the
                  exact circular-collapse bug hit earlier: this card's
                  alignItems:'center' shrinks any child with no explicit
                  size to its own content width, and a page whose width
                  comes FROM that same measurement starts at 0, so it never
                  has any content to measure a nonzero size from. */}
              <RivalCard style={styles.mLeaderCard}>
                {/* Painted once here, outside/behind the swiping ScrollView,
                    so it never travels with the content — only the podium/
                    text pages across on top of this fixed backdrop. */}
                <Image
                  source={require('../../assets/images/backgrounds/optimized/podium-smoke.jpg')}
                  style={styles.mPodiumSmoke}
                  resizeMode="cover"
                />
                {weeklyLeaders.length > 1 ? (
                  <>
                    <ScrollView
                      ref={leaderScrollRef}
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      style={{ width: windowWidth - 32 }}
                      // Both handlers on purpose. onMomentumScrollEnd alone is
                      // the natural fit, but react-native-web only synthesises
                      // it from a scroll-idle timer, and a trackpad or a slow
                      // drag can settle without ever firing one — the arrows
                      // then point the wrong way, or vanish, on a card that did
                      // move. onScroll keeps the index honest whatever the
                      // input device; momentum end is the cheap confirmation.
                      scrollEventThrottle={16}
                      onScroll={(e) => {
                        const idx = Math.round(e.nativeEvent.contentOffset.x / (windowWidth - 32));
                        setLeaderCardIndex((cur) => (cur === idx ? cur : idx));
                      }}
                      onMomentumScrollEnd={(e) => {
                        const idx = Math.round(e.nativeEvent.contentOffset.x / (windowWidth - 32));
                        setLeaderCardIndex(idx);
                      }}
                    >
                      {weeklyLeaders.map((leader) => (
                        <View key={leader.leagueId} style={{ width: windowWidth - 32, alignItems: 'center' }}>
                          <WeeklyLeaderCardBody leader={leader} />
                        </View>
                      ))}
                    </ScrollView>
                    {/* One dot per team, like the photo dots in the activity
                        viewer. The current one stretches into a short pill and
                        slides as you swipe, so the count and your place in it
                        are both readable at a glance. */}
                    <View style={styles.mLeaderDots}>
                      {weeklyLeaders.map((leader, i) => (
                        <View key={leader.leagueId} style={[styles.mLeaderDot, i === leaderCardIndex && styles.mLeaderDotActive]} />
                      ))}
                    </View>
                    {/* Swipe affordance — nothing else on this card hints that
                        it pages across teams, so a first-time user with more
                        than one team never discovers the other boards. Sits
                        OUTSIDE the paging ScrollView (a sibling, absolutely
                        positioned over the card) so the chevrons stay put
                        while the podium slides underneath. Each one hides at
                        its end of the run rather than sitting there dead, so
                        the pair also reads as a position indicator. Tappable
                        as well as decorative — same gesture, one less swipe. */}
                    {[0, 1].map((side) => {
                      const isLeft = side === 0;
                      const target = leaderCardIndex + (isLeft ? -1 : 1);
                      if (target < 0 || target > weeklyLeaders.length - 1) return null;
                      return (
                        <TouchableOpacity
                          key={side}
                          style={[styles.mLeaderArrow, isLeft ? styles.mLeaderArrowLeft : styles.mLeaderArrowRight]}
                          hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                          onPress={() => {
                            setLeaderCardIndex(target);
                            leaderScrollRef.current?.scrollTo({ x: target * (windowWidth - 32), animated: true });
                          }}
                        >
                          <RivalIcon name={isLeft ? 'monthBack' : 'monthForward'} size={26} color="rgba(255,181,158,0.55)" />
                        </TouchableOpacity>
                      );
                    })}
                  </>
                ) : (
                  <WeeklyLeaderCardBody leader={weeklyLeaders[0] ?? null} />
                )}
              </RivalCard>

              {/* Add Activity */}
              <RivalButton
                label="Add activity"
                onPress={() => router.push('/add-workout')}
                style={[styles.addWorkoutPill, styles.mAddActivityOverride]}
                labelStyle={styles.mAddActivityLabel}
              />

              {/* Today — sits with the day's actions, just under Add activity,
                  so Legacy below it is purely lifetime. */}
              <View style={[styles.mLegacyStatBox, styles.mTodayRow]}>
                {/* A quiet day shows the last session rather than "+0" —
                    the same information, without reading as an empty score. */}
                <View style={[styles.mLegacyStatCell, styles.mLegacyStatCellBorder]}>
                  {todayEffort > 0 || !lastActivity ? (
                    <>
                      <RivalIcon name="bolt" size={16} color={RivalColors.accentFill} />
                      <Text style={[styles.mLegacyStatValue, styles.mLegacyStatValueLg]}>
                        <Text style={{ position: 'relative', top: 0, left: 1 }}>+</Text>
                        <Text style={{ marginLeft: 3 }}>{Math.round(todayEffort)}</Text>
                      </Text>
                      <Text style={[styles.mLegacyStatLabel, styles.mLegacyStatLabelLg]}>Effort today</Text>
                    </>
                  ) : (
                    <>
                      <RivalIcon name={activityIconName(lastActivity.type)} size={16} color={RivalColors.accentFill} />
                      <Text style={[styles.mLegacyStatValue, styles.mLegacyStatValueSerif]} numberOfLines={1}>{activityShortName(lastActivity.type)}</Text>
                      <Text style={[styles.mLegacyStatLabel, styles.mLegacyStatLabelLg]} numberOfLines={1}>Last · {relativeDayLabel(lastActivity.startedAt)}</Text>
                    </>
                  )}
                </View>
                <View style={[styles.mLegacyStatCell, styles.mLegacyStatCellBorder]}>
                  <RivalIcon name="doubleChevronUp" size={16} color="#FFD700" />
                  <Text style={[styles.mLegacyStatValue, styles.mLegacyStatValueGold]} numberOfLines={1}>{rankName || '—'}</Text>
                  <Text style={[styles.mLegacyStatLabel, styles.mLegacyStatLabelLg]}>{seasonYear} rank</Text>
                  <Text style={styles.mRankDaysLeft}>{seasonDaysLeft === 1 ? '1 day left' : `${seasonDaysLeft} days left`}</Text>
                </View>
                <View style={styles.mLegacyStatCell}>
                  <RivalIcon name="fire" size={16} color={RivalColors.accentFill} />
                  {weeklyStreak > 0 ? (
                    <>
                      <Text style={[styles.mLegacyStatValue, styles.mLegacyStatValueLg]}>{weeklyStreak}</Text>
                      <Text style={[styles.mLegacyStatLabel, styles.mLegacyStatLabelLg]}>Week streak</Text>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.mLegacyStatValue, styles.mLegacyStatValueSerif, styles.mLegacyStatValueSerifSm]} numberOfLines={1} adjustsFontSizeToFit>Next activity</Text>
                      <Text style={[styles.mLegacyStatLabel, styles.mLegacyStatLabelLg]}>Starts streak</Text>
                    </>
                  )}
                </View>
              </View>

              {/* The year, made visible. In December, a countdown to the rank
                  reset with the Effort still needed for the next rank; through
                  January, last year's review. Neither shows the rest of the year. */}
              {seasonDaysLeft <= 30 && (() => {
                const lvl = getLevel(seasonEffortTotal);
                const nextLvl = LEVELS.find((l) => l.level === lvl.level + 1);
                const p = xpProgressInLevel(seasonEffortTotal);
                return (
                  <View style={styles.mYearCard}>
                    <MHeading
                      title={seasonDaysLeft <= 1 ? `The last day of ${seasonYear}` : `${seasonYear} closes in ${seasonDaysLeft} days`}
                      subtitle={nextLvl ? `${Math.ceil(p.needed - p.current).toLocaleString()} Effort to ${nextLvl.name}` : `${lvl.name} · the top rank`}
                    />
                    <View style={styles.mYearTrack}>
                      <View style={[styles.mYearFill, { width: `${Math.max(3, Math.round(Math.min(1, p.pct) * 100))}%` }]} />
                    </View>
                    <Text style={styles.mYearNote}>Rank resets 1 January. Lifetime totals never reset.</Text>
                    <TouchableOpacity onPress={() => router.push({ pathname: '/year-review', params: { year: String(seasonYear) } })}>
                      <Text style={[styles.mFocusViewLink, { textAlign: 'center' }]}>View {seasonYear} so far →</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
              {new Date().getMonth() === 0 && (
                <TouchableOpacity
                  style={styles.mYearCard}
                  activeOpacity={0.85}
                  onPress={() => router.push({ pathname: '/year-review', params: { year: String(seasonYear - 1) } })}
                >
                  <MHeading title={`Your ${seasonYear - 1}`} subtitle="Year in review" />
                  <Text style={styles.mYearNote}>Final rank, total Effort, and every activity from the year.</Text>
                  <Text style={[styles.mFocusViewLink, { textAlign: 'center' }]}>View the year →</Text>
                </TouchableOpacity>
              )}

              {/* Focus — no card chrome, same as the Team Challenge hero in
                  team-hub.tsx: content sits directly on the page background
                  rather than boxed in its own tinted card. */}
              <View style={styles.mFocusFree}>
                {featuredGoal ? (
                  <>
                    <View style={styles.mFocusHead}>
                      <MHeading title={featuredGoal.activityLabel} subtitle="Focus" />
                    </View>
                    {/* Same ring used by the Team Challenge card (team-hub.tsx) —
                        Ricky asked for this card to match it. RivalChallengeRing
                        decides decimal-vs-whole-number display from the
                        target's own magnitude (see its formatRingValue) —
                        pass the raw progress, not a pre-rounded one. */}
                    <RivalChallengeRing
                      pct={featuredGoal.pct}
                      value={featuredGoal.progress}
                      target={featuredGoal.target}
                      unit={`/ ${featuredGoal.target.toLocaleString()} ${featuredGoal.unit}`}
                      size={200}
                      thickness={14}
                    />
                    {/* Two figures in the brand serif over spaced caps, split
                        by a hairline — the same voice as the section headings,
                        instead of a line of small body text. */}
                    <View style={styles.mFocusRingMetaRow}>
                      <View style={styles.mFocusMetaCell}>
                        <Text style={styles.mFocusMetaNumber}>{Math.round(featuredGoal.pct * 100)}%</Text>
                        <Text style={styles.mFocusMetaLabel}>Complete</Text>
                      </View>
                      <View style={styles.mFocusMetaDivider} />
                      <View style={styles.mFocusMetaCell}>
                        <Text style={styles.mFocusMetaNumber}>{featuredGoal.daysLeft}</Text>
                        <Text style={styles.mFocusMetaLabel}>{featuredGoal.daysLeft === 1 ? 'Day left' : 'Days left'}</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => router.push('/goals')}>
                      <Text style={styles.mFocusViewLink}>View focus →</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <View style={styles.mFocusEmptyHead}>
                      <MHeading title="Choose something worth chasing." subtitle="Focus" />
                    </View>
                    <TouchableOpacity onPress={() => router.push('/goals')}>
                      <Text style={styles.mFocusViewLink}>Set focus →</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>

              {/* Legacy section — borderless, shared warm glow background.
                  Same smoke texture as Weekly Leader (Ricky's call,
                  2026-08-24) — same style works unmodified since this
                  section shares that card's paddingHorizontal:16, which is
                  what mPodiumSmoke's baked-in bleed margins are sized for. */}
              <View style={styles.mLegacySection}>
                <Image
                  source={require('../../assets/images/backgrounds/optimized/podium-smoke.jpg')}
                  style={styles.mLegacySmoke}
                  resizeMode="cover"
                />
                <View style={{ marginTop: 8 }}>
                  <MHeading title="Legacy" subtitle={heroPage === 0 ? "Lifetime of Effort" : `${seasonYear} so far`} />
                </View>

                {/* Two figures you can swipe between: everything ever earned,
                    and this year's — the number rank is built on. */}
                <View style={{ marginTop: 26 }} onLayout={(e) => setHeroWidth(Math.round(e.nativeEvent.layout.width))}>
                  <ScrollView
                    ref={heroScrollRef}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScroll={(e) => {
                      if (!heroWidth) return;
                      const idx = Math.round(e.nativeEvent.contentOffset.x / heroWidth);
                      setHeroPage((cur) => (cur === idx ? cur : idx));
                    }}
                  >
                    <View style={[styles.mLegacyHeroPage, heroWidth ? { width: heroWidth } : null]}>
                      <CountUpText value={Math.round(lifetimeXp)} style={styles.mLegacyHeroNumber} />
                      <Text style={styles.mLegacyHeroLabel}>Total Effort</Text>
                      {legacyWeek.effort > 0 && (
                        <View style={styles.mLegacyWeekChip}>
                          <RivalIcon name="trendUp" size={13} color={RivalColors.accentText} />
                          <Text style={styles.mLegacyWeekChipText}>+{legacyWeek.effort.toLocaleString()} this week</Text>
                        </View>
                      )}
                    </View>
                    <View style={[styles.mLegacyHeroPage, heroWidth ? { width: heroWidth } : null]}>
                      <CountUpText value={Math.round(seasonEffortTotal)} style={styles.mLegacyHeroNumber} />
                      <Text style={styles.mLegacyHeroLabel}>{seasonYear} Effort</Text>
                      <TouchableOpacity style={styles.mLegacyWeekChip} onPress={() => router.push('/ranks')} activeOpacity={0.8}>
                        <RivalIcon name="doubleChevronUp" size={13} color={RivalColors.accentText} />
                        <Text style={styles.mLegacyWeekChipText}>{rankName ? `${rankName} · ` : ''}{seasonDaysLeft} days left</Text>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                  <View style={[styles.mLeaderDots, { marginTop: 14 }]}>
                    {[0, 1].map((i) => (
                      <TouchableOpacity
                        key={i}
                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                        accessibilityLabel={i === 0 ? 'Show lifetime Effort' : `Show ${seasonYear} Effort`}
                        onPress={() => { setHeroPage(i); heroScrollRef.current?.scrollTo({ x: i * heroWidth, animated: true }); }}
                      >
                        <View style={[styles.mLeaderDot, i === heroPage && styles.mLeaderDotActive]} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {(() => {
                  const m = nextMilestone(totalDistanceKm, lifetimeActivityCount, totalElevationM, seasonEffortTotal, respectReceived);
                  return (
                    <View style={styles.mMilestone}>
                      <View style={styles.mMilestoneHead}>
                        <Text style={styles.mMilestoneLabel}>Next milestone</Text>
                        <Text style={styles.mMilestoneToGo}>{m.toGo}</Text>
                      </View>
                      <Text style={styles.mMilestoneTitle}>{m.title}</Text>
                      <View style={styles.mMilestoneTrack}>
                        <View style={[styles.mMilestoneFill, { width: `${Math.max(3, Math.min(100, Math.round(m.pct * 100)))}%` }]} />
                      </View>
                    </View>
                  );
                })()}

                {/* Two pages you can swipe between: the training record, then
                    how other people have recognised it. Impact gets its place on
                    Home without adding height. The second page appears once
                    someone has given you Respect or been Inspired. */}
                <View
                  style={[styles.mLegacyStatBox, styles.mLegacyCarouselBox]}
                  onLayout={(e) => setLegacyBoxWidth(Math.round(e.nativeEvent.layout.width) - 2)}
                >
                  <ScrollView
                    ref={legacyScrollRef}
                    horizontal
                    pagingEnabled
                    scrollEnabled={hasImpact}
                    showsHorizontalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScroll={(e) => {
                      if (!legacyBoxWidth) return;
                      const idx = Math.round(e.nativeEvent.contentOffset.x / legacyBoxWidth);
                      setLegacyPage((cur) => (cur === idx ? cur : idx));
                    }}
                  >
                  <View style={[styles.mLegacyPage, legacyBoxWidth ? { width: legacyBoxWidth } : null]}>
                      <View style={[styles.mLegacyStatCell, styles.mLegacyStatCellBorder]}>
                        <RivalIcon name="fire" size={16} color={RivalColors.accentFill} />
                        <Text style={styles.mLegacyStatValue}>{lifetimeActivityCount.toLocaleString()}</Text>
                        {legacyWeek.count > 0 && <Text style={styles.mLegacyStatGain}>{`+${legacyWeek.count} this week`}</Text>}
                        <Text style={styles.mLegacyStatLabel}>Activities</Text>
                      </View>
                      <View style={[styles.mLegacyStatCell, styles.mLegacyStatCellBorder]}>
                        <RivalIcon name="distance" size={16} color={RivalColors.accentFill} />
                        <Text style={styles.mLegacyStatValue}>{distanceNumber(totalDistanceKm)} <Text style={styles.mLegacyStatUnit}>{distanceUnit()}</Text></Text>
                        {legacyWeek.count > 0 && <Text style={styles.mLegacyStatGain}>{`+${formatDistanceWhole(legacyWeek.km)}`}</Text>}
                        <Text style={styles.mLegacyStatLabel}>Distance</Text>
                      </View>
                      <View style={styles.mLegacyStatCell}>
                        <RivalIcon name="elevation" size={16} color={RivalColors.accentFill} />
                        <Text style={styles.mLegacyStatValue}>{totalElevationM.toLocaleString()} <Text style={styles.mLegacyStatUnit}>m</Text></Text>
                        {legacyWeek.count > 0 && <Text style={styles.mLegacyStatGain}>{`+${legacyWeek.elevM.toLocaleString()} m`}</Text>}
                        <Text style={styles.mLegacyStatLabel}>Elevation</Text>
                      </View>
                  </View>
                  {hasImpact && (
                    <View style={[styles.mLegacyPage, legacyBoxWidth ? { width: legacyBoxWidth } : null]}>
                      <View style={[styles.mLegacyStatCell, styles.mLegacyStatCellBorder]}>
                        <RivalIcon name="respect" size={16} color={RivalColors.accentFill} />
                        <Text style={styles.mLegacyStatValue}>{impact.respect.toLocaleString()}</Text>
                        {impactWeek.respect > 0
                          ? <Text style={styles.mLegacyStatGain}>{`+${impactWeek.respect} this week`}</Text>
                          : <Text style={styles.mLegacyStatQuiet}>received</Text>}
                        <Text style={styles.mLegacyStatLabel}>Respect</Text>
                      </View>
                      <View style={[styles.mLegacyStatCell, styles.mLegacyStatCellBorder]}>
                        <RivalIcon name="impact" size={16} color={RivalColors.accentFill} />
                        <Text style={styles.mLegacyStatValue}>{impact.inspired.toLocaleString()}</Text>
                        {impactWeek.inspired > 0
                          ? <Text style={styles.mLegacyStatGain}>{`+${impactWeek.inspired} this week`}</Text>
                          : <Text style={styles.mLegacyStatQuiet}>by your training</Text>}
                        <Text style={styles.mLegacyStatLabel}>Inspired</Text>
                      </View>
                      <View style={styles.mLegacyStatCell}>
                        <RivalIcon name="groups" size={16} color={RivalColors.accentFill} />
                        <Text style={styles.mLegacyStatValue}>{impact.people.toLocaleString()}</Text>
                        {impactWeek.people > 0
                          ? <Text style={styles.mLegacyStatGain}>{`+${impactWeek.people} this week`}</Text>
                          : <Text style={styles.mLegacyStatQuiet}>recognised you</Text>}
                        <Text style={styles.mLegacyStatLabel}>People</Text>
                      </View>
                    </View>
                  )}
                  </ScrollView>
                </View>
                {hasImpact && (
                  <View style={[styles.mLeaderDots, { marginTop: 12 }]}>
                    {[0, 1].map((i) => (
                      <TouchableOpacity
                        key={i}
                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                        accessibilityLabel={i === 0 ? 'Show training totals' : 'Show recognition'}
                        onPress={() => { setLegacyPage(i); legacyScrollRef.current?.scrollTo({ x: i * legacyBoxWidth, animated: true }); }}
                      >
                        <View style={[styles.mLeaderDot, i === legacyPage && styles.mLeaderDotActive]} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

              </View>

              {/* Next Event — only when a race is booked; races are added from
                  the Races page, so an empty card here was just taking room. */}
              {nextRace && (
              <RivalCard style={styles.mNextEventCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mNextEventKicker}>NEXT EVENT</Text>
                  {nextRace ? (
                    <>
                      <Text style={styles.mNextEventName}>{formatRaceName(nextRace.name)}</Text>
                      <Text style={styles.mNextEventDate}>{formatRaceDateShort(nextRace.race_date)}</Text>
                    </>
                  ) : (
                    <TouchableOpacity onPress={() => router.push('/races?add=true')}>
                      <Text style={styles.mNextEventEmptyLine}>No race scheduled</Text>
                      <Text style={styles.mFocusViewLink}>Add race →</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {nextRace && days !== null && (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={styles.mNextEventDaysNumber}>{days}</Text>
                    <Text style={styles.mNextEventDaysLabel}>Days</Text>
                  </View>
                )}
              </RivalCard>
              )}
            </>
          ) : (
          <>
          {/* Hero: Total Time Earned — narrower + centered like the mockup */}
          <RivalCard glass style={styles.heroCard}>
            <Text style={[styles.heroLabel, { marginBottom: 4 }]}>TOTAL TIME EARNED</Text>
            <Text
              style={[styles.heroValue, { fontSize: heroValueFontSize(heroTimeText, heroCardAvailableWidth), lineHeight: heroValueFontSize(heroTimeText, heroCardAvailableWidth) * 1.1 }]}
              numberOfLines={1}
            >
              {heroHours > 0 && (
                <>
                  {heroHours}
                  <Text style={[styles.heroValueUnit, { fontSize: heroValueFontSize(heroTimeText, heroCardAvailableWidth) * 0.42 }]}>h</Text>
                  {' '}
                </>
              )}
              {heroMins}
              <Text style={[styles.heroValueUnit, { fontSize: heroValueFontSize(heroTimeText, heroCardAvailableWidth) * 0.42 }]}>m</Text>
            </Text>
            <View style={{ marginTop: -10, alignItems: 'center' }}>
              <Text style={styles.heroSub}>Every minute here is yours.</Text>
            </View>
          </RivalCard>

          <RivalButton
            label="Add activity"
            onPress={() => router.push('/add-workout')}
            style={[styles.addWorkoutPill, addActivityHovered && styles.gridCardHovered]}
            {...(Platform.OS === 'web'
              ? { onMouseEnter: () => setAddActivityHovered(true), onMouseLeave: () => setAddActivityHovered(false) }
              : {})}
          />

          {/* Season countdown (last 30 days of the year only) */}
          {seasonDaysLeft <= 30 && seasonDaysLeft > 0 && (
            <TouchableOpacity style={styles.seasonBanner} onPress={() => router.push('/ranks')}>
              <Text style={styles.bannerIcon}>⏳</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>{seasonDaysLeft} days left in the {seasonYear} season</Text>
                <Text style={styles.bannerSub}>Push your rank now, Effort resets Jan 1</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* 4-card grid */}
          <View style={styles.cardRow}>

            {/* Featured goal — nearest deadline; card named after the goal itself.
                Empty state (no active goal — an ended-but-unhit one is only
                surfaced with its own "Try Again" flow on the Goals page, not
                here) becomes one big glass button — nothing to review yet,
                just an invite to set one — with the same hover "pop" as the
                team crest cards. */}
            {(() => {
              const goalsEmpty = !featuredGoal;
              return (
                <TouchableOpacity
                  activeOpacity={goalsEmpty ? 0.85 : 1}
                  disabled={!goalsEmpty}
                  onPress={() => router.push('/goals')}
                  style={gridCardStyle}
                  {...(Platform.OS === 'web'
                    ? { onMouseEnter: () => setGoalsCardHovered(true), onMouseLeave: () => setGoalsCardHovered(false) } as any
                    : {})}
                >
                  <RivalCard
                    glass
                    style={[
                      { flex: 1 },
                      goalsCardHovered && styles.gridCardHovered,
                      // Border-brighten scoped to just this card, not the
                      // shared gridCardHovered (also used by the Add Activity
                      // button, which has no border to brighten).
                      goalsCardHovered && { borderColor: 'rgba(255,255,255,0.22)' },
                    ]}
                  >
                    {featuredGoal ? (
                      // Same shape as the empty state below: small tracked
                      // "FOCUS" label, the goal itself as the hero content
                      // (title + real progress/bar, not a generic countdown),
                      // then a minimal text link at the bottom instead of a
                      // filled pill — consistent visual weight either way.
                      <View style={{ flex: 1, paddingBottom: 24 }}>
                        {/* Group 1: what is it — anchored to the top, its own
                            block so it can move independently of group 2. */}
                        <View style={styles.focusActiveTopGroup}>
                          <Text style={styles.focusLabel}>FOCUS</Text>
                          <Text style={[styles.focusGoalTitle, styles.focusActiveTitleGap]}>{featuredGoal.title}</Text>
                        </View>

                        {/* Spacer above group 2 too — slightly smaller than
                            the one below (0.8 vs 1) so this block sits a
                            touch above dead-center rather than perfectly
                            centered in the space between the top group and
                            the CTA. */}
                        <View style={{ flex: 0.8 }} />

                        {/* Group 2: how am I doing — clustered tight, own block */}
                        <View style={styles.focusActiveMidGroup}>
                          <Text style={styles.gridCardValue}>
                            {featuredGoal.progress.toLocaleString()}
                            <Text style={[styles.gridCardValueSub, { color: RivalColors.textPrimary }]}> / {featuredGoal.target.toLocaleString()} {featuredGoal.unit}</Text>
                          </Text>
                          <View style={[styles.focusProgressBarWrap, styles.focusActiveBarGap]}>
                            <RivalProgressBar pct={featuredGoal.pct} height={10} />
                            <Text style={styles.focusProgressPctOnBar}>{Math.round(featuredGoal.pct * 100)}%</Text>
                          </View>
                          <Text style={[styles.gridCardMeta, styles.focusActiveMetaGap, { color: RivalColors.textPrimary }]} numberOfLines={2}>
                            {focusProgressPhrase(featuredGoal.pct)}
                            {'  •  '}
                            <Text style={{ color: RivalColors.accentText }}>
                              {featuredGoal.daysLeft === 0 ? 'Last day' : `${featuredGoal.daysLeft} day${featuredGoal.daysLeft === 1 ? '' : 's'} left`}
                            </Text>
                          </Text>
                        </View>

                        {/* Flexible spacer — pins group 3 to the bottom of
                            the card regardless of how groups 1/2 are positioned. */}
                        <View style={{ flex: 1 }} />

                        {/* Group 3: what next — same hover treatment as the
                            empty state's "Set Focus →" link. */}
                        <View style={[styles.focusEmptyLinkRow, styles.focusEmptyLinkBottom]}>
                          <TouchableOpacity onPress={() => router.push('/goals')}>
                            <Text
                              style={[
                                styles.focusEmptyLink,
                                goalsCardHovered && { color: RivalColors.textPrimary },
                                Platform.OS === 'web' ? ({ transition: 'color 0.2s ease' } as any) : {},
                              ]}
                            >
                              View Focus
                            </Text>
                          </TouchableOpacity>
                          <Text
                            style={[
                              styles.focusEmptyLink,
                              goalsCardHovered && { color: RivalColors.textPrimary, transform: [{ translateX: 3 }] },
                              Platform.OS === 'web' ? ({ transition: 'color 0.2s ease, transform 0.2s ease' } as any) : {},
                            ]}
                          >
                            {' '}→
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <View style={{ flex: 1, paddingBottom: 24 }}>
                        <View style={styles.goalsEmptyCentered}>
                          <Text style={styles.focusLabel}>FOCUS</Text>
                          <Text style={styles.goalsEmptyTitle}>Choose something worth chasing.</Text>
                        </View>
                        <View style={[styles.focusEmptyLinkRow, styles.focusEmptyLinkBottom]}>
                          <Text
                            style={[
                              styles.focusEmptyLink,
                              goalsCardHovered && { color: RivalColors.textPrimary },
                              Platform.OS === 'web' ? ({ transition: 'color 0.2s ease' } as any) : {},
                            ]}
                          >
                            Set Focus
                          </Text>
                          <Text
                            style={[
                              styles.focusEmptyLink,
                              goalsCardHovered && { color: RivalColors.textPrimary, transform: [{ translateX: 3 }] },
                              Platform.OS === 'web' ? ({ transition: 'color 0.2s ease, transform 0.2s ease' } as any) : {},
                            ]}
                          >
                            {' '}→
                          </Text>
                        </View>
                      </View>
                    )}
                  </RivalCard>
                </TouchableOpacity>
              );
            })()}

            {/* Weekly Leader — same top-anchored label+title anatomy as the
                Focus card, but the middle group is the standing leader and
                the bottom holds a compact 2nd/3rd podium (shown as "how far
                behind the leader", not raw totals — the gap is what makes
                catching up feel possible) plus a link to full standings. */}
            <View
              style={gridCardStyle}
              {...(Platform.OS === 'web'
                ? { onMouseEnter: () => setLeaderCardHovered(true), onMouseLeave: () => setLeaderCardHovered(false) } as any
                : {})}
            >
            <RivalCard
              glass
              style={[
                { flex: 1 },
                leaderCardHovered && styles.gridCardHovered,
                leaderCardHovered && { borderColor: 'rgba(255,255,255,0.22)' },
              ]}
            >
              {weeklyLeader ? (() => {
                const { standings } = weeklyLeader;
                const selfIndex = standings.findIndex((e) => e.isSelf);
                const endsLabel = weeklyLeader.daysRemaining === 0 ? 'Last day' : weeklyLeader.daysRemaining === 1 ? 'Ends tomorrow' : `${weeklyLeader.daysRemaining} days remaining`;

                // Not on the board yet (0 Effort this week) — no rank to
                // brag or worry about, just who to catch and by how much.
                // Same anatomy as the no-leader-at-all empty state (label,
                // medal, big title, accent subtitle, link) instead of a
                // plain paragraph — the leader already exists here, so the
                // medal is a muted textSecondary, not gold, since it's not
                // your achievement yet.
                if (selfIndex === -1) {
                  const leader = standings[0];
                  return (
                    <View style={{ flex: 1, paddingBottom: 24 }}>
                      <View style={styles.focusActiveTopGroup}>
                        <Text style={styles.focusLabel}>WEEKLY LEADER</Text>
                      </View>

                      {/* Fixed-offset block, not flex-sandwiched — the icon
                          and title's position no longer depends on how many
                          lines the subtitle below wraps to. Only the flex:1
                          spacer after the subtitle absorbs that variance. */}
                      <View style={[styles.focusActiveMidGroup, { marginTop: 56 }]}>
                        <View style={styles.medalRing}>
                          <RivalIcon name="medal" size={30} color={RivalColors.textSecondary} />
                        </View>
                        <Text style={[styles.leaderEmptyTitle, { marginTop: 10, textTransform: 'uppercase' }]} numberOfLines={1}>
                          {leader.name} leads
                        </Text>
                      </View>
                      <Text style={styles.leaderEmptySub} numberOfLines={2}>
                        <Text
                          style={[
                            styles.pulseStoryNumber,
                            { color: RivalColors.textPrimary },
                            Platform.OS === 'web' ? ({ position: 'relative', top: 1.5 } as any) : {},
                          ]}
                        >
                          {leader.points}
                        </Text>{' '}
                        Effort this week
                      </Text>

                      <View style={{ flex: 1 }} />

                      <View style={[styles.focusEmptyLinkRow, styles.focusEmptyLinkBottom]}>
                        <TouchableOpacity onPress={() => router.push({ pathname: '/team-hub', params: { id: weeklyLeader.leagueId } })}>
                          <Text
                            style={[
                              styles.focusEmptyLink,
                              leaderCardHovered && { color: RivalColors.textPrimary },
                              Platform.OS === 'web' ? ({ transition: 'color 0.2s ease' } as any) : {},
                            ]}
                          >
                            View Leaderboard
                          </Text>
                        </TouchableOpacity>
                        <Text
                          style={[
                            styles.focusEmptyLink,
                            leaderCardHovered && { color: RivalColors.textPrimary, transform: [{ translateX: 3 }] },
                            Platform.OS === 'web' ? ({ transition: 'color 0.2s ease, transform 0.2s ease' } as any) : {},
                          ]}
                        >
                          {' '}→
                        </Text>
                      </View>
                    </View>
                  );
                }

                const story = weeklyRankStory(standings, selfIndex);
                const selfPoints = standings[selfIndex].points;
                const podium = standings.slice(0, 3);

                return (
                  <View style={{ flex: 1, paddingBottom: 24 }}>
                    <View style={styles.focusActiveTopGroup}>
                      <Text style={styles.focusLabel}>WEEKLY LEADER</Text>
                      <View style={[styles.pulseNameRow, styles.focusActiveTitleGap, styles.pulseMedalNudgeDown]}>
                        {story.rankIcon ? (
                          <RivalIcon
                            name={story.rankIcon}
                            size={19}
                            color={selfIndex === 0 ? RivalColors.accentText : RivalColors.textSecondary}
                          />
                        ) : (
                          <Text style={styles.podiumRank}>{story.rankLabel}</Text>
                        )}
                      </View>
                    </View>

                    <View style={{ flex: 0.8 }} />

                    <View style={styles.focusActiveMidGroup}>
                      <Text style={[styles.gridCardValue, styles.pulseValueShrink, styles.pulseValueNudgeUp, { color: RivalColors.textPrimary }]}>
                        {selfPoints}
                        <Text style={[styles.gridCardValueSub, { color: RivalColors.textPrimary }]}> Effort</Text>
                      </Text>
                      <Text style={[styles.gridCardMeta, styles.pulseStoryMessage]} numberOfLines={2}>
                        {story.before}
                        {story.gap !== null && <Text style={styles.pulseStoryNumber}>{story.gap}</Text>}
                        {story.after}
                      </Text>
                      <Text style={styles.gridCardMeta} numberOfLines={1}>
                        {weeklyLeader.teamName}
                      </Text>
                    </View>

                    <View style={styles.podiumWrap}>
                      {podium.map((entry, i) => (
                        <View key={entry.userId} style={styles.podiumRow}>
                          <RivalIcon
                            name={i === 0 ? 'crown' : 'medal'}
                            size={i === 0 ? 15 : 12}
                            color={i === 0 ? '#ECC654' : i === 1 ? '#C0C0C0' : '#CD7F32'}
                          />
                          <Text
                            style={[styles.podiumName, i === 0 && styles.podiumNameFirst, entry.isSelf && styles.podiumNameSelf]}
                            numberOfLines={1}
                          >
                            {entry.name}
                          </Text>
                          <Text style={[styles.podiumGap, entry.isSelf && styles.podiumGapSelf, i === 0 && styles.podiumGapFirst]}>
                            {entry.points}
                          </Text>
                        </View>
                      ))}
                      <Text style={styles.podiumFooterMeta}>{endsLabel}</Text>
                    </View>

                    <View style={{ flex: 1 }} />

                    <View style={[styles.focusEmptyLinkRow, styles.focusEmptyLinkBottom]}>
                      <TouchableOpacity onPress={() => router.push({ pathname: '/team-hub', params: { id: weeklyLeader.leagueId } })}>
                        <Text
                          style={[
                            styles.focusEmptyLink,
                            leaderCardHovered && { color: RivalColors.textPrimary },
                            Platform.OS === 'web' ? ({ transition: 'color 0.2s ease' } as any) : {},
                          ]}
                        >
                          View Leaderboard
                        </Text>
                      </TouchableOpacity>
                      <Text
                        style={[
                          styles.focusEmptyLink,
                          leaderCardHovered && { color: RivalColors.textPrimary, transform: [{ translateX: 3 }] },
                          Platform.OS === 'web' ? ({ transition: 'color 0.2s ease, transform 0.2s ease' } as any) : {},
                        ]}
                      >
                        {' '}→
                      </Text>
                    </View>
                  </View>
                );
              })() : (
                <View style={{ flex: 1, paddingBottom: 24 }}>
                  <View style={styles.focusActiveTopGroup}>
                    <Text style={styles.focusLabel}>WEEKLY LEADER</Text>
                  </View>

                  {/* Fixed-offset block — see the selfIndex === -1 branch
                      above for why this doesn't use flex-sandwiched spacers. */}
                  <View style={[styles.focusActiveMidGroup, { marginTop: 56 }]}>
                    <View style={styles.medalRing}>
                      <RivalIcon name="medal" size={30} color="#ECC654" />
                    </View>
                    <Text style={[styles.leaderEmptyTitle, { marginTop: 10 }]} numberOfLines={1}>LEAD THIS WEEK</Text>
                  </View>
                  <Text style={styles.leaderEmptySub} numberOfLines={2}>
                    Earn the first Effort
                  </Text>

                  <View style={{ flex: 1 }} />

                  <View style={[styles.focusEmptyLinkRow, styles.focusEmptyLinkBottom]}>
                    <TouchableOpacity onPress={() => router.push('/add-workout')}>
                      <Text
                        style={[
                          styles.focusEmptyLink,
                          leaderCardHovered && { color: RivalColors.textPrimary },
                          Platform.OS === 'web' ? ({ transition: 'color 0.2s ease' } as any) : {},
                        ]}
                      >
                        Claim the Lead
                      </Text>
                    </TouchableOpacity>
                    <Text
                      style={[
                        styles.focusEmptyLink,
                        leaderCardHovered && { color: RivalColors.textPrimary, transform: [{ translateX: 3 }] },
                        Platform.OS === 'web' ? ({ transition: 'color 0.2s ease, transform 0.2s ease' } as any) : {},
                      ]}
                    >
                      {' '}→
                    </Text>
                  </View>
                </View>
              )}
            </RivalCard>
            </View>

            {/* Team Momentum — same anatomy as Focus/Weekly Leader: a single
                team (the most active one) instead of a flat directory, since
                the Teams tab already covers "browse all your teams." The
                status line reuses weeklyLeader's standings for this same
                team when available, so it doesn't fire a second query. */}
            <View
              style={gridCardStyle}
              {...(Platform.OS === 'web'
                ? { onMouseEnter: () => setMomentumCardHovered(true), onMouseLeave: () => setMomentumCardHovered(false) } as any
                : {})}
            >
            <RivalCard
              glass
              style={[
                { flex: 1 },
                momentumCardHovered && styles.gridCardHovered,
                momentumCardHovered && { borderColor: 'rgba(255,255,255,0.22)' },
              ]}
            >
              {leagues.length === 0 ? (
                <View style={{ flex: 1, paddingBottom: 24 }}>
                  <View style={styles.focusActiveTopGroup}>
                    <Text style={styles.focusLabel}>TEAM PULSE</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <View style={styles.goalsEmptyCentered}>
                    <Text style={styles.goalsEmptyTitle}>Training is better together.</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <View style={[styles.focusEmptyLinkRow, styles.focusEmptyLinkBottom]}>
                    <TouchableOpacity onPress={() => router.push('/create-league')}>
                      <Text style={styles.focusEmptyLink}>Create team</Text>
                    </TouchableOpacity>
                    <Text style={styles.focusEmptyLink}> →</Text>
                  </View>
                </View>
              ) : (() => {
                const hotTeam = leagues[0];
                const story = momentumStory(momentumTrainers, weeklyLeader, hotTeam.id);

                return (
                  <View style={{ flex: 1, paddingBottom: 24 }}>
                    <View style={styles.focusActiveTopGroup}>
                      <Text style={styles.focusLabel}>TEAM PULSE</Text>
                    </View>

                    {/* Fixed-offset block — see Weekly Leader's selfIndex
                        === -1 branch for why this doesn't use flex-
                        sandwiched spacers. Crest/name position is now
                        independent of how long the story line rolls. */}
                    <View style={[styles.focusActiveMidGroup, { marginTop: 56 }]}>
                      {hotTeam.logo_url ? (
                        <Image source={{ uri: hotTeam.logo_url }} style={styles.momentumHeroLogo} />
                      ) : (
                        <View style={styles.momentumHeroAvatar}>
                          <Text style={styles.momentumAvatarText}>{hotTeam.name.slice(0, 2).toUpperCase()}</Text>
                        </View>
                      )}
                      <Text style={[styles.leaderEmptyTitle, { marginTop: 10, textTransform: 'uppercase' }]} numberOfLines={1}>{formatTeamName(hotTeam.name)}</Text>
                    </View>
                    <Text style={styles.leaderEmptySub} numberOfLines={2}>{story.message}</Text>

                    <View style={{ flex: 1 }} />

                    <View style={[styles.focusEmptyLinkRow, styles.focusEmptyLinkBottom]}>
                      <TouchableOpacity onPress={() => router.push({ pathname: '/team-hub', params: { id: hotTeam.id } })}>
                        <Text
                          style={[
                            styles.focusEmptyLink,
                            momentumCardHovered && { color: RivalColors.textPrimary },
                            Platform.OS === 'web' ? ({ transition: 'color 0.2s ease' } as any) : {},
                          ]}
                        >
                          {story.cta}
                        </Text>
                      </TouchableOpacity>
                      <Text
                        style={[
                          styles.focusEmptyLink,
                          momentumCardHovered && { color: RivalColors.textPrimary, transform: [{ translateX: 3 }] },
                          Platform.OS === 'web' ? ({ transition: 'color 0.2s ease, transform 0.2s ease' } as any) : {},
                        ]}
                      >
                        {' '}→
                      </Text>
                    </View>
                  </View>
                );
              })()}
            </RivalCard>
            </View>

            {/* Stats Snapshot */}
            <View
              style={gridCardStyle}
              {...(Platform.OS === 'web'
                ? { onMouseEnter: () => setStatsCardHovered(true), onMouseLeave: () => setStatsCardHovered(false) } as any
                : {})}
            >
              <RivalCard
                glass
                style={[
                  { flex: 1, position: 'relative', overflow: 'hidden' },
                  statsCardHovered && styles.gridCardHovered,
                  statsCardHovered && { borderColor: 'rgba(255,255,255,0.22)' },
                ]}
              >
                <View
                  style={[
                    statsCardHovered && Platform.OS === 'web' ? ({ filter: 'blur(4px)', transition: 'filter 0.2s ease' } as any) : (Platform.OS === 'web' ? ({ transition: 'filter 0.2s ease' } as any) : {}),
                  ]}
                >
                  <TouchableOpacity onPress={() => router.push('/stats')}>
                    <Text style={[styles.focusLabel, { textAlign: 'center' }]}>LEGACY</Text>
                    <Text style={[styles.focusGoalTitle, styles.focusActiveTitleGap, { textAlign: 'center' }]}>Everything you've Earned</Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1, justifyContent: 'center', gap: 10, marginTop: 11 }}>
                    <TouchableOpacity style={styles.snapshotRow} onPress={() => router.push('/stats')}>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={[styles.snapshotHeroValue, styles.snapshotHeroValueLead]}>{Math.round(lifetimeXp).toLocaleString()}</Text>
                        <Text style={styles.gridCardLabel}>EFFORT</Text>
                      </View>
                    </TouchableOpacity>
                    <View style={styles.snapshotDivider} />
                    <TouchableOpacity style={[styles.snapshotRow, { marginTop: 16 }]} onPress={() => router.push('/stats')}>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={styles.snapshotHeroValue}>{totalDistanceKm.toLocaleString()}</Text>
                        <Text style={styles.gridCardLabel}>DISTANCE</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.snapshotRow} onPress={() => router.push('/stats')}>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={styles.snapshotHeroValue}>{totalElevationM.toLocaleString()}</Text>
                        <Text style={styles.gridCardLabel}>CLIMBED</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.snapshotRow} onPress={() => router.push('/my-activities')}>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={styles.snapshotHeroValue}>{lifetimeActivityCount.toLocaleString()}</Text>
                        <Text style={styles.gridCardLabel}>ACTIVITIES</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
                {statsCardHovered && Platform.OS === 'web' && (
                  <TouchableOpacity
                    style={styles.snapshotHoverOverlay}
                    onPress={() => router.push('/stats')}
                  >
                    <Text style={[styles.focusEmptyLink, { color: RivalColors.textPrimary }]}>View all →</Text>
                  </TouchableOpacity>
                )}
              </RivalCard>
            </View>
          </View>

          {/* Momentum strip */}
          <RivalCard glass style={styles.seasonWrap}>
            <View style={styles.seasonWrapRow}>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.gridCardLabel}>NEXT RACE</Text>
                {days !== null ? (
                  <TouchableOpacity onPress={() => router.push('/races')}>
                    <Text style={styles.seasonWrapValue}>{days} Days</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.addRaceBtn} onPress={() => router.push('/races?add=true')}>
                    <RivalIcon name="add" size={13} color={RivalColors.accentText} />
                    <Text style={styles.addRaceBtnText}>Add Race</Text>
                  </TouchableOpacity>
                )}
              </View>
              {rankName && (
                <TouchableOpacity onPress={() => router.push('/ranks')} style={{ alignItems: 'center' }}>
                  <Text style={styles.gridCardLabel}>RIVAL RANK</Text>
                  <Text
                    style={[
                      styles.seasonWrapValue,
                      { color: '#D8A81D', fontStyle: 'italic', letterSpacing: 1.5, fontSize: 26, lineHeight: 24 },
                      ...(Platform.OS === 'web' ? [{
                        backgroundImage: 'linear-gradient(180deg, #FFE48A, #D8A81D)',
                        backgroundClip: 'text',
                        WebkitBackgroundClip: 'text',
                        color: 'transparent',
                      } as any] : []),
                    ]}
                  >
                    {rankName.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              )}
              <View style={{ alignItems: 'center' }}><Text style={styles.gridCardLabel}>WEEKLY STREAK</Text><Text style={styles.seasonWrapValue}>{weeklyStreak}</Text></View>
            </View>
          </RivalCard>
          </>
          )}

          {/* Strava connection prompt — only shown pre-connection. Once
              connected, status/sync/disconnect live on the profile page
              (Connected Apps panel) instead of taking up home real estate
              on every visit. */}
          {!stravaConnected && (
            <TouchableOpacity style={styles.stravaCard} onPress={handleConnectStrava}>
              <View>
                <Text style={styles.stravaCardTitle}>Connect Strava</Text>
                <Text style={styles.stravaCardSub}>Link an account to earn Effort from synced workouts.</Text>
              </View>
              <Text style={styles.stravaCardArrow}>→</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
    </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  bgFixed: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  scrim: { position: 'fixed' as any, top: 0, left: 0, right: 0, height: '100vh' as any, backgroundColor: 'rgba(14,14,14,0.55)' },
  // Mobile Today's flat background — mockup has no hero photo, just #131313
  // plus a subtle warm radial glow anchored bottom-right.
  mBgFixed: {
    position: 'fixed' as any, top: 0, left: 0, right: 0, width: '100%',
    // 100vh, not 100%/bottom:0 — confirmed via on-device Web Inspector that
    // standalone iOS PWAs still have the small/large viewport split despite
    // having no browser chrome to explain it (window.innerHeight comes back
    // 59px short of the real screen). height:100% resolves against the
    // small one and stops 59px above the true bottom edge; 100vh is the
    // large one and reaches it. Same fix already used by bgFixed/scrim
    // below and RivalFixedBackground.tsx — this was the one style that
    // deviated from that pattern.
    height: '100vh' as any,
    backgroundColor: '#131313',
    ...(Platform.OS === 'web' ? { backgroundImage: 'radial-gradient(ellipse 140% 90% at 88% 105%, rgba(217,119,87,0.10) 0%, rgba(19,19,19,0) 55%)' } as any : {}),
  },
  container: { flex: 1 },
  // Max-width + auto margins keep desktop content centered with the photo
  // breathing on both sides, like the mockup (Yoga supports 'auto' margins).
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, gap: 20, width: '100%', maxWidth: 1200, marginHorizontal: 'auto' },
  // Mobile's bottom nav is a floating pill overlaying content (RivalTopNav),
  // not part of the layout flow, so the scroll content needs its own
  // clearance or the last card ends up hidden behind it — the 48 above is
  // sized for desktop, which has no floating nav to clear.
  // paddingTop:0 (not `content`'s shared 16) — the Weekly Leader card is the
  // first thing in the mobile feed and sits flush against the nav bar, no
  // gap. An earlier 6px "breathing room" value read as cramped in isolation
  // but on-device showed as exactly the visible seam this comment already
  // warned about (plain background peeking through above the card's
  // texture) — Ricky's call (2026-08-24), flush wins.
  contentMobile: { paddingTop: 0, paddingBottom: 120 },

  navBar: { width: '100%', backgroundColor: 'rgba(14,14,14,0.65)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 1200, marginHorizontal: 'auto', paddingHorizontal: 24, paddingVertical: 12 },
  logo: { ...RivalType.titleMd, color: RivalColors.accentText, letterSpacing: 4, fontWeight: '800' },
  navLinks: { flexDirection: 'row', gap: 20 },
  navLink: { ...RivalType.bodyMd, fontSize: 14, color: RivalColors.textSecondary },
  navLinkActive: { color: RivalColors.textPrimary, fontWeight: '700' },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rankBadge: { alignItems: 'flex-end' },
  rankBadgeLabel: { ...RivalType.labelCaps, fontSize: 9, color: RivalColors.textSecondary },
  rankBadgeValue: { fontSize: 13, fontWeight: '700' },
  headerAvatar: { width: 34, height: 34, borderRadius: 17 },
  headerAvatarFallback: { width: 34, height: 34, borderRadius: 17, backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { fontSize: 14, fontWeight: '800', color: RivalColors.onAccentFill },

  // maxWidth pulled in from 660 — the card was a wide box with a narrow
  // centered column inside it, leaving big flanking gaps. Hugging the
  // content width instead reads as one solid hero, not a box floating in a box.
  // No fixed width — alignSelf: 'center' with no width/maxWidth means the
  // card hugs whichever line (the subtitle sentence or the number) is
  // currently widest, instead of a manually-tuned width that either leaves
  // dead space beside short numbers or clips long ones. maxWidth is only a
  // safety cap for narrow mobile viewports, not a target size.
  heroCard: { alignItems: 'center', gap: 6, alignSelf: 'center', maxWidth: '92%', marginTop: 24, paddingVertical: 28, borderRadius: 28 },
  iconDisc: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  // Swapped from marginTop:40 — that made the button sit farther from the
  // hero card (60 total: 20 parent gap + 40) and closer to the row below
  // (20, just the parent gap). marginBottom does the same 60/20 split in
  // the opposite direction: closer to the hero card above, farther from
  // the cards below.
  addWorkoutPill: { alignSelf: 'center', paddingHorizontal: 33, borderRadius: RivalRadius.full, minWidth: 180, marginBottom: 56 },
  // Wide tracking matches the "Your Event" card's title treatment
  // (create-league.tsx's previewName) — scaled down from that 0.5em ratio
  // since this label has more characters to fit in the same card width.
  heroLabel: { ...RivalType.labelCaps, fontSize: 20, letterSpacing: 4.36, color: RivalColors.textPrimary },
  // Blown up well past displayHero's base 48px, plus the same glow recipe as
  // the race countdown number (textShadow, since it needs to hug the glyphs)
  // — this is the number of the whole page, it should hit like one.
  // Subtle top-to-bottom gradient instead of a flat fill — web-only (CSS
  // background-clip: text has no RN-native equivalent without pulling in a
  // gradient/masking library), same Platform.OS guard pattern used elsewhere
  // in this file for web-only CSS. Native falls back to the flat mid-tone.
  heroValue: {
    ...RivalType.displayHero, fontSize: 96, lineHeight: 100, color: '#D8A81D',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(180deg, #FFE48A, #D8A81D)',
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      color: 'transparent',
    } as any : {}),
  },
  // Same digits-vs-unit split as the streak card's "WEEKS" suffix — smaller,
  // lighter weight, muted color — so "186h 10m" reads as two number+unit
  // pairs instead of the "h"/"m" fusing into the digits around them.
  heroValueUnit: { fontWeight: '600', color: RivalColors.textPrimary },
  heroSub: { ...RivalType.bodyMd, fontSize: 18, letterSpacing: 3, textTransform: 'uppercase', color: RivalColors.textPrimary, textAlign: 'center' },

  seasonBanner: { backgroundColor: 'rgba(20,20,20,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: RivalRadius.DEFAULT, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerIcon: { fontSize: 22 },
  bannerTitle: { ...RivalType.bodyMd, fontWeight: '700', color: RivalColors.textPrimary },
  bannerSub: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },

  cardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridCard: { flex: 1, minWidth: 230, minHeight: 320, gap: 8 },
  gridCardQuarter: { flexBasis: '22%', minWidth: 0 },
  // Same recipe as discover-leagues.tsx's team crest cards (gridCardHovered
  // there) — scale + lifted shadow, web-only (no hover concept natively).
  gridCardHovered: { transform: [{ scale: 1.03 }], ...(Platform.OS === 'web' ? { boxShadow: '0 12px 28px rgba(0,0,0,0.35)' } as any : {}) },
  goalsEmptyCentered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  // The message is the hero here, not the "FOCUS" tag above it — normal
  // weight, not a heading, matching the reference's "message > title" note.
  goalsEmptyTitle: { ...RivalType.bodyMd, fontSize: 15, lineHeight: 19, color: RivalColors.textPrimary, textAlign: 'center' },
  // Weekly Leader empty state title — same weight/scale as the populated
  // card's "210 Effort" value, so the card doesn't feel lesser before you're on the board.
  leaderEmptyTitle: { fontSize: 14, fontWeight: '500', lineHeight: 17, color: RivalColors.textPrimary, textAlign: 'center', letterSpacing: 3 },
  leaderEmptySub: { fontSize: 11, fontWeight: '500', color: '#ffcabb', letterSpacing: 1, marginTop: 3, textAlign: 'center', lineHeight: 14 },
  // Shared between the empty and active Focus card states — same small
  // tracked label either way.
  focusLabel: { ...RivalType.labelCaps, fontSize: 10, letterSpacing: 1.5, color: 'rgba(255,255,255,0.7)' },
  focusGoalTitle: { ...RivalType.bodyMd, fontSize: 13, color: RivalColors.onSurfaceVariant, marginTop: 2 },
  // Minimal text link, not a filled pill — the whole card is already the tap
  // target (with its own hover pop), so a heavy CTA button here would be
  // redundant with that.
  focusEmptyLink: { fontSize: 11, fontWeight: '600', letterSpacing: 1.5, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  focusEmptyLinkBottom: { alignSelf: 'center', marginTop: 0, marginBottom: 10 },
  focusEmptyLinkRow: { flexDirection: 'row' },
  gridCardLabel: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary },
  gridCardValue: { fontSize: 38, fontWeight: '300', color: RivalColors.accentText },
  gridCardValueSub: { fontSize: 14, color: RivalColors.textSecondary },
  focusProgressBarWrap: { width: '100%', justifyContent: 'center' },
  // Thinner (10 vs 16) and the % muted further — was fighting the fill for
  // attention; this labels the bar instead of competing with the progress
  // number above it.
  focusProgressPctOnBar: {
    position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 9, fontWeight: '600', color: 'rgba(255,255,255,0.4)',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  // Active-goal card: left-aligned instead of centered (goalsEmptyCentered's
  // default), since a full-width progress bar can only share a left edge
  // with the number above it under left alignment, not centered text of a
  // different width. gap:0 because spacing between these is hand-tuned per
  // element below (3 clusters — what/how/next — not one even rhythm).
  focusActiveTopGroup: { alignItems: 'center', paddingTop: 4 },
  focusActiveMidGroup: { alignItems: 'center' },
  focusActiveTitleGap: { marginTop: 2 },
  focusActiveBarGap: { marginTop: 4 },
  focusActiveMetaGap: { marginTop: 4 },
  gridCardMeta: { fontSize: 11, color: RivalColors.textSecondary },

  pulseNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pulseValueShrink: { fontSize: 28, lineHeight: 32 },
  // transform is visual-only in RN — moves just this number closer to the
  // medal above without shifting the message/team-name/podium/link below it.
  pulseValueNudgeUp: { transform: [{ translateY: -8 }] },
  // transform-only (visual, doesn't affect layout flow) — nudges just the
  // medal down, closer to evenly splitting the gap between the title above
  // and "210 Effort" below, without shifting the title, Effort, podium, or
  // link, all of which stay anchored to their existing flex positions.
  pulseMedalNudgeDown: { transform: [{ translateY: 1 }] },
  pulseStoryMessage: { fontSize: 15, fontWeight: '600', color: RivalColors.accentText, letterSpacing: 1.5, marginTop: 8, textAlign: 'center' },
  pulseStoryNumber: { fontSize: 16 },
  podiumWrap: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', gap: 6 },
  podiumRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  podiumRank: { fontSize: 10, fontWeight: '700', color: RivalColors.textSecondary, width: 22 },
  podiumName: { flex: 1, fontSize: 14, color: RivalColors.textPrimary },
  podiumGap: { fontSize: 14, fontWeight: '600', color: RivalColors.textSecondary },
  podiumNameFirst: { fontSize: 16 },
  podiumGapFirst: { fontSize: 16, color: '#ECC654' },
  podiumNameSelf: { fontWeight: '700' },
  podiumGapSelf: { color: RivalColors.accentText },
  podiumFooterMeta: { fontSize: 11, color: RivalColors.textSecondary, marginTop: 0 },

  // Hero crest for the single highlighted team — ~15% larger than the old
  // list-row logo (30px) per the "make the crests shine" note.
  momentumHeroLogo: { width: 56, height: 56, borderRadius: 28 },
  momentumHeroAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: RivalColors.tertiaryContainer, alignItems: 'center', justifyContent: 'center' },
  medalRing: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: 'rgba(236,198,84,0.5)', alignItems: 'center', justifyContent: 'center' },
  momentumAvatarText: { fontSize: 14, color: RivalColors.textPrimary, fontWeight: '700' },

  snapshotRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  snapshotHeroValue: { fontSize: 17, fontWeight: '700', color: RivalColors.textPrimary },
  snapshotDivider: { height: 1, width: '70%', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: -3 },
  snapshotHoverOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  snapshotHeroValueLead: { fontSize: 25, color: RivalColors.accentText },

  seasonWrap: { gap: 14, width: '50%', alignSelf: 'center' },
  seasonWrapRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  seasonWrapValue: { fontSize: 20, fontWeight: '600', color: RivalColors.textPrimary, marginTop: 4 },
  addRaceBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: RivalRadius.full, backgroundColor: 'rgba(255,181,158,0.12)', borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)' },
  addRaceBtnText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },

  stravaCard: { backgroundColor: 'rgba(20,20,20,0.55)', borderRadius: RivalRadius.DEFAULT, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: RivalColors.outlineVariant },
  stravaCardTitle: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  stravaCardSub: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  stravaCardArrow: { fontSize: 20, color: RivalColors.accentText },

  // ===== Mobile Today redesign (base-mockup-v3-warm-light-source.html) =====
  // `m`-prefixed to avoid colliding with the desktop style keys above, since
  // both trees coexist in this one StyleSheet.

  // Header center slot
  // labelCaps bakes in a fixed lineHeight:16 sized for its default 12px —
  // left as-is at fontSize:9 it pads ~5px of unwanted extra header height.
  mTimeEarnedLabel: { ...RivalType.labelCaps, fontSize: 9, lineHeight: 11, letterSpacing: 1, color: RivalColors.textSecondary },
  mTimeEarnedValue: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 24, fontWeight: '700', lineHeight: 26, letterSpacing: 0.2, color: RivalColors.accentFill,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(100deg, #D97757 0%, #ffb59e 45%, #F5B759 100%)',
      backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent',
    } as any : {}),
  },
  // Unit letters (h/m) — deliberately NOT the serif/italic/gradient of the
  // number: at the number's size, "h"/"m" rendered as giant swash letters
  // welded onto the digits. Small, upright, sans. Matched lineHeight to the
  // number (not its own smaller size) so it doesn't compress against it and
  // read as cramped; the trailing space alone wasn't enough room between
  // segments, so marginHorizontal adds real breathing space either side.
  mTimeEarnedUnit: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', lineHeight: 26, color: RivalColors.accentFill, marginHorizontal: 1 },

  // Focus — chrome-free, content floats directly on the page background
  // (Ricky's call, 2026-08-24: match the Team Challenge hero's look, which
  // has no card box of its own either). Same vertical padding as the old
  // card retained so spacing to the sections above/below doesn't jump.
  // Same warm radial treatment as mLegacySection, but off to one side — a
  mFocusFree: { paddingTop: 20, paddingBottom: 24, paddingHorizontal: 16, alignItems: 'center' },
  mFocusHead: { alignSelf: 'stretch', marginBottom: 18 },
  mFocusEmptyHead: { alignSelf: 'stretch', marginTop: 4, marginBottom: 14 },
  // Ring meta row ("43% complete   129 days left") — same styling as
  // team-hub.tsx's ringMetaRow/ringMeta/ringMetaBold, this card's own copy
  // since that one is scoped private to team-hub.tsx.
  mFocusRingMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28, marginTop: 18, marginBottom: 14 },
  mFocusMetaCell: { alignItems: 'center', minWidth: 84 },
  mFocusMetaNumber: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 28, fontWeight: '700', lineHeight: 32, color: RivalColors.accentText },
  mFocusMetaLabel: { fontFamily: RivalFontFamily, fontSize: 10.5, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,181,158,0.75)', marginTop: 4 },
  mFocusMetaDivider: {
    width: 1, height: 38,
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'linear-gradient(180deg, rgba(255,181,158,0) 0%, rgba(255,181,158,0.45) 50%, rgba(255,181,158,0) 100%)' } as any)
      : { backgroundColor: 'rgba(255,181,158,0.3)' }),
  },
  mFocusViewLink: { fontFamily: RivalFontFamily, fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText, marginTop: 8 },

  // Weekly Leader podium
  // Layers the Legacy section's warm radial glow (CSS supports comma-separated
  // background-image layers) on top of the card's existing dark gradient —
  // Ricky asked for the same background treatment as Legacy on this card too.
  // Also borderless and bled edge-to-edge like Legacy (marginHorizontal
  // cancels the ScrollView content's 24px padding — same technique as
  // mLegacySection) rather than staying a bordered, inset card.
  mLeaderCard: {
    borderRadius: 0, borderWidth: 0,
    marginHorizontal: -24, paddingHorizontal: 16, paddingTop: 17, paddingBottom: 38, alignItems: 'center',
    backgroundColor: '#181312',
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'radial-gradient(ellipse 90% 65% at 50% 55%, rgba(217,119,87,0.16) 0%, rgba(19,19,19,0) 75%), linear-gradient(135deg, #111214 0%, #181312 100%)' } as any
      : {}),
  },
  // Vertically centred on the card, hugging the edges — the podium is capped
  // at 360 wide and centred, so on a phone there's empty card either side of
  // it for these to sit in without ever overlapping a pillar.
  mLeaderArrow: {
    position: 'absolute', top: '50%', marginTop: -18,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
  },
  mLeaderArrowLeft: { left: 2 },
  mLeaderArrowRight: { right: 2 },
  mLeaderHead: { alignSelf: 'stretch', marginTop: 4, marginBottom: 22 },
  // Capped at the mockup's own reference width — without this, a wide
  // "mobile" viewport (the mobile branch covers anything under 840px, which
  // includes tablets) stretches the flex:1 columns wide while pillarHeight
  // stays a fixed px value, squashing the shard shapes' proportions.
  mPodiumGrid: { flexDirection: 'row', alignItems: 'flex-end', width: '100%', maxWidth: 360, alignSelf: 'center', gap: 5, paddingTop: 31, minHeight: 221 },
  // Warm stage-light pool the pillars sit on — a wide soft radial glow plus
  // a brighter, tighter gradient line right at the pillar bases, instead of
  // a flat uniform border (which read as a plain ruled line, not a stage).
  // Tighter, brighter pool than a first pass — reference is a saturated,
  // well-defined spotlight, not a wide hazy wash. Narrower ellipse + a hot
  // near-white/gold core keeps it reading as an actual light source.
  // Bled slightly past the pillars' own edges (negative inset) and dropped a
  // little below their base (negative bottom) — Ricky wants it read as a
  // stage the pillars sit ON, not a rule flush against their bottom edge.
  // One shape, one gradient, one clip-path — a separate highlight/line/face
  // stacked as independent clipped layers never quite lined up at the
  // tapered tip (each shape's curve is computed against its own bounding
  // box), leaving a visible seam. Baking the specular sheen in as the
  // gradient's own top stop guarantees every layer shares the same edge.
  mPodiumStageLine: {
    position: 'absolute', left: -18, right: -18, bottom: -12, height: 6,
    ...(Platform.OS === 'web'
      ? {
          // Radial, anchored at top-center, so it reads as one glow source
          // brightest at the top and fading outward in every direction,
          // rather than a horizontal band with a separate vertical fade.
          // More tonal steps between the bright core and the transparent
          // edge (rather than a straight two-stop fade) reads as a glow
          // with real depth instead of a flat disc dimming outward.
          backgroundImage:
            'radial-gradient(ellipse 70% 130% at 50% 0%, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.65) 22%, rgba(255,255,255,0.55) 40%, rgba(255,255,255,0.33) 58%, rgba(255,255,255,0.13) 75%, rgba(255,255,255,0) 100%)',
          clipPath: PODIUM_LENS_CLIP,
          // clip-path always cuts a hard edge, no matter how faded the color
          // is right at the boundary — blur feathers that edge into a soft
          // glow instead of a visible outline.
          filter: 'blur(1.5px)',
        } as any
      : { backgroundColor: 'rgba(255,205,90,0.4)' }),
  },
  // Real smoke photo behind the whole Weekly Leader card, kept subtle (low
  // opacity) — bleeds all the way to the card's outer edges and up under
  // the title, not just boxed around the pillars.
  // RN's Image doesn't size itself from inset offsets alone — without an
  // explicit width/height it renders at the source's native pixel size
  // (1024x1024 here), so width/height:100% is required. That 100% is
  // computed against the card's PADDED content box though, so reaching the
  // true outer edge needs negative margins matching the card's own padding
  // (paddingHorizontal:16, paddingTop:17, paddingBottom:38) on top of that,
  // the same bleed technique mLeaderCard itself uses against the ScrollView.
  // Height is a measured constant (title + podium down to the stage glow),
  // not '100%' of the card — the card's own box also contains the capsule
  // text below the pillars, so 100% stretched this well past the glow into
  // the capsule area. Since the source is square and this box is much
  // taller than wide, cover-fit scales to match the box's HEIGHT with no
  // vertical cropping at all — the full image height always maps across
  // whatever height is given, so getting the glow-aligned bottom edge right
  // requires sizing the box itself, not an objectPosition crop-anchor (which
  // has nothing to shift when nothing is being cropped vertically).
  mPodiumSmoke: {
    // Taller than the card and pulled well above it, because the photo's own
    // top third is nearly black (sampled: brightness ~30/255 down to 30% in,
    // ~103 by the midpoint). At 0.28 opacity that dead zone is
    // indistinguishable from the card behind it, so the smoke appeared to
    // start a third of the way down and the space above it read as a black
    // band under the top nav. Pulling the dark third up behind the nav puts
    // the actual smoke at the seam. resizeMode can't do this instead — RN-web
    // renders this image with object-fit:fill, so the whole photo is always
    // shown and there is no crop to reposition.
    position: 'absolute', width: '100%', height: 480,
    marginLeft: -16, marginRight: -16, marginTop: -150,
    opacity: 0.28,
    // The box's own bottom edge was a hard cutoff against the card's dark
    // bg — a mask-image fade (not just lowering opacity further, which
    // would dim the whole photo) fades out just the bottom ~30% so it
    // blends into the surrounding card instead of reading as a cropped photo.
    ...(Platform.OS === 'web'
      ? ({
          maskImage: 'linear-gradient(to bottom, black 0%, black 65%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 65%, transparent 100%)',
        } as any)
      : {}),
  },
  // Legacy's own copy of mPodiumSmoke — same photo, same bleed, but faded on
  // BOTH edges. mPodiumSmoke's single bottom-only fade left a hard top
  // cutoff, invisible on Weekly Leader (nothing sits above that card, it's
  // first in the feed) but a visible seam here, where the stat tiles sit
  // directly above this section.
  mLegacySmoke: {
    position: 'absolute', width: '100%', height: 353,
    marginLeft: -16, marginRight: -16, marginTop: -26,
    opacity: 0.28,
    // Widened from an earlier 15/40 split (Ricky: "still see a seam", twice)
    // — a narrow fully-opaque band leaves a sharp opacity jump right where
    // the stat box (sitting on top of this image) ends and the unobstructed
    // texture begins. A long fade on both sides with barely any flat middle
    // reads as soft throughout instead of having an edge anywhere.
    ...(Platform.OS === 'web'
      ? ({
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 35%, black 55%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 35%, black 55%, transparent 100%)',
        } as any)
      : {}),
  },
  // Fewer than 3 people on the board — center the real column(s) at a fixed
  // width instead of stretching flex:1 across the full card width.
  mPodiumGridSparse: { justifyContent: 'center', gap: 12 },
  mPodiumColumn: { flex: 1, alignItems: 'center' },
  // Must override ALL THREE longhand flex properties, not just grow/shrink —
  // the base mPodiumColumn's `flex: 1` shorthand expands to `flexBasis: 0%`,
  // and an explicit flexBasis wins over `width` for main-axis sizing in CSS.
  // Without resetting it to 'auto' here, that inherited 0% survived the style
  // merge and silently zeroed this column's width regardless of `width: 110`.
  mPodiumColumnSparse: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: 82 },
  mPodiumAvatar: { backgroundColor: '#332e2a', alignItems: 'center', justifyContent: 'center' },
  mPodiumInitial: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', textAlign: 'center', marginTop: 2 },
  mPodiumHalo: {
    position: 'absolute', left: '50%', top: '50%',
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'radial-gradient(circle, rgba(255,215,0,0.35) 0%, rgba(255,215,0,0.12) 40%, rgba(255,215,0,0) 70%)' } as any)
      : {}),
  },
  // Floats above the avatar without pushing it down — same technique as the
  // mockup's absolutely-positioned crown (`top` offset set inline per avatar size).
  mPodiumSheenClip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  mPodiumSheen: {
    position: 'absolute', top: 0, bottom: 0, width: '45%',
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 50%, rgba(255,255,255,0) 100%)' } as any)
      : {}),
  },
  // flexShrink:0 matters here — a flex child with overflow:hidden (which
  // numberOfLines={1} sets under the hood) defaults to a min-height of 0 in
  // CSS flexbox, so a tight column was squeezing this text well below its
  // natural glyph height (clipping the tops of letters) instead of just
  // overflowing the box. Refusing to shrink keeps it fully legible.
  mPodiumName: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 },
  mPodiumPoints: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 18, fontWeight: '700', color: RivalColors.textPrimary, marginTop: 2, flexShrink: 0 },
  // Pill wrapping the "X pts behind Y" + "Ends tomorrow" lines — a subtle
  // dark capsule matching the card's own palette, so this reads as a piece
  // of the podium rather than two loose lines floating under it.
  // Matches the Legacy section's stat-box treatment (wide rounded rect,
  // visible hairline border) instead of a tight pill — same family look as
  // the rest of the card, per Ricky's reference.
  // Sized to its content (not full-width) — shrinks the box's own footprint
  // instead of leaving a lot of empty padding around a short line of text.
  // marginTop clears the platform's own footprint (an absolutely-positioned
  // sibling that extends 19px below the pillar row) plus real breathing
  // room — the platform doesn't affect layout since it's out of flow, so
  // this has to be sized by hand rather than a plain small gap.
  mStatus: { alignItems: 'center', marginTop: 22, gap: 10 },
  mHeading: { alignItems: 'center', gap: 10, alignSelf: 'stretch', paddingHorizontal: 8 },
  mStatusHeadline: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22, fontWeight: '700', color: '#fff', textAlign: 'center', letterSpacing: 0.2 },
  mStatusBeside: { position: 'relative', top: 4 },
  // Baseline-aligned, then the words dropped a few pixels. Georgia only has
  // old-style numerals — 3, 4, 5, 7 and 9 hang below the line like a
  // descender (there is no lining-figure alternative to switch to) — so on a
  // shared baseline the words sat level with the top of a "7" and read as
  // floating. Lowered, they sit across the middle of the hanging digits, which
  // are most of them; short digits like 1, 2 and 0 end up within a pixel.
  mStatusLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  mStatusNumber: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 34, fontWeight: '700' },
  mStatusCountdown: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  mStatusCountdownText: { fontFamily: RivalFontFamily, fontSize: 10.5, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,181,158,0.75)' },
  mStatusRule: { width: 34, height: 1 },
  mStatusRuleLeft: Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,181,158,0) 0%, rgba(255,181,158,0.5) 100%)' } as any)
    : { backgroundColor: 'rgba(255,181,158,0.3)' },
  mStatusRuleRight: Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,181,158,0.5) 0%, rgba(255,181,158,0) 100%)' } as any)
    : { backgroundColor: 'rgba(255,181,158,0.3)' },
  mLeaderDots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 22 },
  mLeaderDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)',
    ...(Platform.OS === 'web' ? ({ transition: 'width 220ms ease, background-color 220ms ease' } as any) : {}),
  },
  mLeaderDotActive: { width: 18, backgroundColor: RivalColors.accentText },

  // Next Event card
  mNextEventCard: {
    borderRadius: RivalRadius.lg, paddingVertical: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.14)',
    backgroundColor: '#241c17',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #1c1a19 0%, #241c17 100%)' } as any : {}),
  },
  mNextEventKicker: { fontFamily: RivalFontFamily, fontSize: 10.5, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,181,158,0.75)' },
  mNextEventName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 20, fontWeight: '700', lineHeight: 26, color: RivalColors.textPrimary, marginTop: 6 },
  mNextEventDate: { fontFamily: RivalFontFamily, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 3 },
  mNextEventDaysNumber: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 30, fontWeight: '700', color: RivalColors.accentText, lineHeight: 30 },
  // Mockup's "DAYS" label has no explicit font-weight (regular, unlike the
  // bold orange kickers) — labelCaps defaults to 700, reset it here.
  mNextEventDaysLabel: { ...RivalType.labelCaps, fontSize: 10, fontWeight: '400', color: RivalColors.textSecondary, marginTop: 2 },
  mNextEventEmptyLine: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 18, fontWeight: '700', lineHeight: 24, color: RivalColors.textPrimary, marginTop: 6, marginBottom: 4 },

  // Add Activity override — mockup's accentText pill (not the default
  // accentFill primary), sized/padded/spaced to the mockup's exact spec
  // rather than the shared desktop pill's (width 80%, uniform 13px padding,
  // 16px bottom margin instead of the desktop-tuned 56px).
  // Negative marginTop pulls this up specifically closer to the Weekly
  // Leader card above it — content's own gap:20 is shared by every card on
  // this screen, so trim just this one gap here rather than globally.
  mAddActivityOverride: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderWidth: 0, width: '80%', minWidth: 0, paddingHorizontal: 13, paddingVertical: 13, marginBottom: 16, marginTop: -43 },
  // The base label style's lineHeight:28 (sized for titleMd's 20px font)
  // survives unless reset here, padding the pill out ~10px taller than the
  // mockup's tightly-set 15px text.
  mAddActivityLabel: { fontFamily: RivalFontFamily, fontSize: 15, fontWeight: '700', lineHeight: 18, color: RivalButtonColors.label(RivalColors.onAccentFill) },

  // Legacy borderless section
  // Mockup bleeds this section edge-to-edge (`margin:0 -16px` against its
  // 16px-padded parent) — the ScrollView content pads 24px, so cancel that.
  mLegacySection: {
    marginHorizontal: -24, paddingTop: 40, paddingHorizontal: 16, paddingBottom: 30,
    // Web: gradient-only, no flat backgroundColor underneath — a flat color
    // there would fill the whole rect uniformly and show as a hard edge
    // where the gradient itself has faded to transparent. Native has no
    // backgroundImage support, so it keeps a flat (much subtler) tint.
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'radial-gradient(ellipse 90% 65% at 50% 55%, rgba(217,119,87,0.16) 0%, rgba(19,19,19,0) 75%)' } as any
      : { backgroundColor: 'rgba(217,119,87,0.05)' }),
  },
  mLegacyStatBox: { flexDirection: 'row', backgroundColor: 'rgba(29,23,20,0.72)', borderWidth: 1, borderColor: 'rgba(255,209,190,0.10)', borderRadius: RivalRadius.lg, paddingVertical: 20 },
  mLegacyStatCell: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  mLegacyStatCellBorder: { borderRightWidth: 1, borderRightColor: 'rgba(255,209,190,0.08)' },
  mLegacyStatIcon: { marginBottom: 8 },
  // Row 2 (Activities/Distance/Elevation) default size — mockup uses smaller
  // type here than row 1 (Effort Today/Rank/Week Streak), not one shared size.
  // lineHeight:24 explicit on this AND mLegacyStatValueLg/Gold below — the
  // serif family's natural line metrics differ from the sans one, so without
  // a shared explicit value the "Rank" label sat at a different height than
  // "Effort Today"/"Week Streak" (Ricky: "the word rank moved position").
  mLegacyStatValue: { fontFamily: RivalFontFamily, fontSize: 17, fontWeight: '700', lineHeight: 24, color: RivalColors.textPrimary, marginTop: 8 },
  mLegacyStatValueLg: { fontSize: 20, fontWeight: '800', lineHeight: 24 },
  // Literal #FFD700 (same gold as the podium's #1 rank) — NOT accentGold
  // (#F5B759), which is a softer peach-gold used for gradient stops
  // elsewhere. Mockup's "LEGEND" text is pure gold.
  mLegacyStatValueGold: { fontFamily: RivalSerifFamily, fontWeight: '700', fontStyle: 'italic', textTransform: 'uppercase', color: '#FFD700', fontSize: 18, lineHeight: 24, letterSpacing: 1.44 },
  mLegacyStatUnit: { fontFamily: RivalFontFamily, fontSize: 9, color: RivalColors.textSecondary, fontWeight: '700' },
  // Mockup's small gray labels are regular weight, not bold — labelCaps
  // defaults to 700, so both label styles explicitly reset it to 400.
  mLegacyStatLabel: { ...RivalType.labelCaps, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(255,255,255,0.55)', marginTop: 6 },
  mLegacyStatLabelLg: { fontSize: 10.5, letterSpacing: 1 },
  mLegacyStatValueSerif: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, lineHeight: 24, paddingHorizontal: 2 },
  mSkel: { backgroundColor: 'rgba(255,209,190,0.08)' },
  mSkelLeader: { gap: 0, minHeight: 360, justifyContent: 'flex-start' },
  mSkelPodium: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 70 },
  // Warm card fill, like the app's other cards — off the smoke backdrop the
  // grey see-through box read as flat.
  mRankDaysLeft: { fontFamily: RivalFontFamily, fontSize: 10.5, fontWeight: '600', color: RivalColors.accentText, marginTop: 3 },
  mYearCard: {
    marginTop: 14, marginHorizontal: -8, paddingVertical: 22, paddingHorizontal: 18, gap: 14,
    backgroundColor: '#1d1714', borderWidth: 1, borderColor: 'rgba(255,209,190,0.10)', borderRadius: RivalRadius.lg,
  },
  mYearTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  mYearFill: { height: 6, borderRadius: 3, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient } as any,
  mYearNote: { fontFamily: RivalFontFamily, fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
  mLegacyCarouselBox: { flexDirection: 'column', paddingVertical: 0, overflow: 'hidden' },
  mLegacyPage: { flexDirection: 'row', paddingVertical: 20 },
  mTodayRow: { marginTop: 14, marginHorizontal: -8, backgroundColor: '#1d1714', borderColor: 'rgba(255,209,190,0.10)' },
  mLegacyStatValueSerifSm: { fontSize: 14.5, letterSpacing: -0.2 },
  mLegacyStatQuiet: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  mLegacyStatGain: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '600', color: RivalColors.accentText, marginTop: 2 },
  mLegacyWeekChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12,
    paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)', backgroundColor: 'rgba(255,181,158,0.06)',
  },
  mLegacyWeekChipText: { fontFamily: RivalFontFamily, fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  mMilestone: { marginTop: 34, marginBottom: 28, marginHorizontal: 10 },
  mMilestoneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mMilestoneLabel: { fontFamily: RivalFontFamily, fontSize: 10.5, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' },
  mMilestoneToGo: { fontFamily: RivalFontFamily, fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  mMilestoneTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 18, fontWeight: '700', lineHeight: 24, color: '#fff', marginTop: 4, marginBottom: 10 },
  mMilestoneTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  mMilestoneFill: { height: 6, borderRadius: 3, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient } as any,
  mLegacyHeroPage: { alignItems: 'center' },
  mLegacyHeroNumber: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 46, fontWeight: '700', color: RivalColors.accentFill,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #D97757 150%)',
      backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent',
    } as any : {}),
  },
  mLegacyHeroLabel: { ...RivalType.labelCaps, fontSize: 11, fontWeight: '800', letterSpacing: 2, color: RivalColors.accentFill },
  mLegacyDivider: { width: 1, height: 56, alignSelf: 'center', backgroundColor: RivalColors.accentFill, opacity: 0.4, marginTop: 8, marginBottom: 6 },
  // Half the Legacy divider's length — leads the eye down toward the Add
  // Activity button below the empty-state card instead of just floating copy.
  // The carousel pages every team through one shared height — the tallest
  // card's. That has to stay: resizing per team would make Add Activity slide
  // up and down under your thumb as you swipe. So the empty state doesn't
  // shrink the card, it fills it — flex:1 claims the leftover space and centres
  // in it, instead of sitting at the top leaving the whole surplus as one dead
  // gap above the button.
  //
  // minHeight is the fallback for when this page is the ONLY one (a single team
  // with no Effort yet), where there's no taller sibling to stretch against and
  // flex:1 has nothing to claim. It's the populated podium's own content height:
  // mPodiumGrid's 221 (31 of which is its paddingTop) plus the meta capsule's
  // 19 marginTop + 5/8 padding + ~32 of two text lines.
  mLeaderEmpty: { flex: 1, minHeight: 285, alignItems: 'center', justifyContent: 'flex-end', gap: 0, paddingBottom: 8 },
  mLeaderFindTeam: { alignSelf: 'center', paddingHorizontal: 28, marginTop: 14 },
  mGhostPodium: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 56 },
  mGhostPillar: {
    width: 72, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 10,
    borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(255,209,190,0.14)',
    borderTopLeftRadius: 10, borderTopRightRadius: 10,
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'linear-gradient(180deg, rgba(255,209,190,0.07) 0%, rgba(255,209,190,0) 100%)' } as any)
      : { backgroundColor: 'rgba(255,209,190,0.04)' }),
  },
  mGhostPillarFirst: { borderColor: 'rgba(236,198,84,0.28)' },
  mGhostMedal: { position: 'absolute', top: -70, backgroundColor: 'rgba(236,198,84,0.06)' },
  mGhostPlace: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 20, fontWeight: '700', color: 'rgba(255,209,190,0.28)' },
  mGhostStage: {
    width: 280, height: 1, marginBottom: 22,
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,181,158,0) 0%, rgba(255,181,158,0.45) 50%, rgba(255,181,158,0) 100%)' } as any)
      : { backgroundColor: 'rgba(255,181,158,0.3)' }),
  },

});
