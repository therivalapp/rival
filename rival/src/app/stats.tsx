import { useSnapState } from '../lib/snapState';
import { distanceNumber, distanceUnit, elevationNumber, elevationUnit } from '../lib/units';
import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Image, Platform, useWindowDimensions } from 'react-native';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { fetchAllActivities } from '../lib/fetchAllActivities';
import { fetchReactionsOn } from '../lib/reactions';
import { getLevel, xpProgressInLevel, LEVELS } from '../lib/xp';
import { calculateStreak, StreakResult } from '../lib/streak';
import { getSeasonStartISO, getCurrentSeasonYear, daysUntilSeasonEnd } from '../lib/season';
import { RivalCard, RivalProgressBar, RivalIcon, RivalTopNav, RivalBackButton, GreyPageHead, GreyLabel, GreyRows, GreyRow, GREY_PAGE_BG } from '../components/rival';
import { goToTab } from '../lib/tabNav';
import { RivalColors, RivalRadius, RivalType, RANK_LEVEL_COLORS, RivalSerifFamily } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';

// Refined Ember rank ramp only has 4 confirmed anchor colors from the Stitch
// export (see rivalTheme.ts) — the interpolated 10-level ramp is provisional.
function rankColorFor(level: number): string {
  return RANK_LEVEL_COLORS[level - 1] ?? RivalColors.accentText;
}

export default function StatsScreen() {
  const { userId: viewedUserId } = useLocalSearchParams<{ userId?: string }>();
  const [currentAuthUserId, setCurrentAuthUserId] = useSnapState(`stats.${viewedUserId ?? 'me'}.currentAuthUserId`, '');
  const isOwnProfile = !viewedUserId || viewedUserId === currentAuthUserId;

  const [displayName, setDisplayName] = useSnapState(`stats.${viewedUserId ?? 'me'}.displayName`, '');
  const [avatarUrl, setAvatarUrl] = useSnapState<string | null>(`stats.${viewedUserId ?? 'me'}.avatarUrl`, null);
  // What gets them through: a quote, a principle, a line they live by.
  // Stored in users.bio; "Mindset" is the name people see.
  const [mindset, setMindset] = useSnapState(`stats.${viewedUserId ?? 'me'}.mindset`, '');
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;
  const [totalPoints, setTotalPoints] = useSnapState(`stats.${viewedUserId ?? 'me'}.totalPoints`, 0);
  const [seasonPoints, setSeasonPoints] = useSnapState(`stats.${viewedUserId ?? 'me'}.seasonPoints`, 0);
  const [pastSeasons, setPastSeasons] = useSnapState<Array<{ year: number; final_xp: number; final_rank_name: string }>>(`stats.${viewedUserId ?? 'me'}.pastSeasons`, []);
  const [totalActivities, setTotalActivities] = useSnapState(`stats.${viewedUserId ?? 'me'}.totalActivities`, 0);
  const [totalTimeMinutes, setTotalTimeMinutes] = useSnapState(`stats.${viewedUserId ?? 'me'}.totalTimeMinutes`, 0);
  const [hardTimeMinutes, setHardTimeMinutes] = useSnapState(`stats.${viewedUserId ?? 'me'}.hardTimeMinutes`, 0);
  const [earnedMilestones, setEarnedMilestones] = useSnapState<string[]>(`stats.${viewedUserId ?? 'me'}.earnedMilestones`, []);
  const [thisWeekPoints, setThisWeekPoints] = useSnapState(`stats.${viewedUserId ?? 'me'}.thisWeekPoints`, 0);
  const [totalDistanceKm, setTotalDistanceKm] = useSnapState(`stats.${viewedUserId ?? 'me'}.totalDistanceKm`, 0);
  const [totalElevationM, setTotalElevationM] = useSnapState(`stats.${viewedUserId ?? 'me'}.totalElevationM`, 0);
  const [streak, setStreak] = useSnapState<StreakResult | null>(`stats.${viewedUserId ?? 'me'}.streak`, null);
  const [inspiredCount, setInspiredCount] = useSnapState(`stats.${viewedUserId ?? 'me'}.inspiredCount`, 0);
  const [inspiredTimes, setInspiredTimes] = useSnapState(`stats.${viewedUserId ?? 'me'}.inspiredTimes`, 0);
  const [respectTimes, setRespectTimes] = useSnapState(`stats.${viewedUserId ?? 'me'}.respectTimes`, 0);
  const [peopleCount, setPeopleCount] = useSnapState(`stats.${viewedUserId ?? 'me'}.peopleCount`, 0);
  const [memberSince, setMemberSince] = useSnapState(`stats.${viewedUserId ?? 'me'}.memberSince`, '');
  const [loading, setLoading] = useSnapState(`stats.${viewedUserId ?? 'me'}.loading`, true);

  useEffect(() => {
    loadStats();
  }, []);

  const { scrollProps: pullProps, indicator: pullIndicator } = usePullToRefresh(() => loadStats());

  async function loadStats() {
    const { data: { user } } = await getAuthUser();
    if (!user) { setLoading(false); return; }
    setCurrentAuthUserId(user.id);

    const targetUserId = viewedUserId || user.id;
    const viewingOther = !!viewedUserId && viewedUserId !== user.id;

    if (!viewingOther && user.created_at) {
      const d = new Date(user.created_at);
      setMemberSince(d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }

    // Milestones, race ids and past seasons don't depend on the activities,
    // so they load alongside them instead of one after another afterwards.
    const [userRes, activitiesRes, { data: milestonesData }, { data: myRaceIdsData }, { data: seasonResultsData }] = await Promise.all([
      supabase.from('users').select('display_name, avatar_url, bio').eq('id', targetUserId).single(),
      fetchAllActivities(targetUserId, 'id, effort_score, started_at, distance_meters, elevation_meters, duration_seconds, activity_type'),
      supabase.from('milestones').select('type').eq('user_id', targetUserId),
      supabase.from('races').select('id').eq('user_id', targetUserId),
      supabase
        .from('season_results')
        .select('final_xp, final_rank_name, seasons(year)')
        .eq('user_id', targetUserId)
        .order('seasons(year)', { ascending: false }),
    ]);

    setDisplayName(userRes.data?.display_name || (!viewingOther ? user.user_metadata?.display_name : '') || 'Athlete');
    setAvatarUrl(userRes.data?.avatar_url || null);
    setMindset((userRes.data?.bio || '').trim());

    const activities = activitiesRes;
    const total = activities.reduce((sum, a) => sum + (a.effort_score || 0), 0);
    setTotalPoints(Math.round(total * 10) / 10);

    const seasonStart = new Date(getSeasonStartISO());
    const seasonTotal = activities
      .filter(a => new Date(a.started_at) >= seasonStart)
      .reduce((sum, a) => sum + (a.effort_score || 0), 0);
    setSeasonPoints(Math.round(seasonTotal * 10) / 10);

    setTotalActivities(activities.length);
    setTotalDistanceKm(Math.round(activities.reduce((sum, a) => sum + (a.distance_meters || 0), 0) / 1000));
    setTotalElevationM(Math.round(activities.reduce((sum, a) => sum + (a.elevation_meters || 0), 0)));
    setTotalTimeMinutes(Math.round(activities.reduce((sum, a) => sum + (a.duration_seconds || 0), 0) / 60));
    const HARD_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT', 'Bootcamp', 'Run', 'Swim', 'Ride', 'WeightTraining', 'Rowing']);
    setHardTimeMinutes(Math.round(activities.filter(a => HARD_TYPES.has(a.activity_type)).reduce((sum, a) => sum + (a.duration_seconds || 0), 0) / 60));

    setEarnedMilestones((milestonesData || []).map((m: any) => m.type));

    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);
    const weekTotal = activities
      .filter((a) => new Date(a.started_at) >= weekStart)
      .reduce((sum, a) => sum + (a.effort_score || 0), 0);
    setThisWeekPoints(Math.round(weekTotal * 10) / 10);

    setStreak(calculateStreak(activities));

    setPastSeasons(
      (seasonResultsData || []).map((r: any) => ({
        year: r.seasons?.year,
        final_xp: r.final_xp,
        final_rank_name: r.final_rank_name,
      }))
    );

    // Everything above is ready; Impact (reactions from other people) fills in
    // a moment later rather than holding the page behind the loading state.
    setLoading(false);

    // Activity ids come from the full fetch above — no second query, and no
    // 1000-row cap undercounting Impact for heavy importers.
    const myActivityIds = activities.map((a: any) => a.id);
    const myRaceIds = (myRaceIdsData || []).map((r: any) => r.id);
    // Activity reactions are fetched in batches (see lib/reactions.ts) — one
    // request with every activity id in it is refused for a long history.
    const [activityReactions, raceReactions] = await Promise.all([
      fetchReactionsOn(myActivityIds),
      myRaceIds.length > 0
        ? supabase.from('feed_reactions').select('user_id, emoji').eq('target_type', 'race').in('target_id', myRaceIds).then((r) => r.data || [])
        : Promise.resolve([] as { user_id: string; emoji: string }[]),
    ]);
    // Impact itself stays Inspired-only (AGENTS.md); "People" on the phone
    // row counts everyone who has reacted at all.
    const people = new Set<string>();
    const inspirers = new Set<string>();
    let inspired = 0;
    let respect = 0;
    [...activityReactions, ...raceReactions].forEach((row: { user_id: string; emoji: string }) => {
      if (row.user_id === targetUserId) return;
      people.add(row.user_id);
      if (row.emoji === 'inspired') { inspired += 1; inspirers.add(row.user_id); } else respect += 1;
    });
    setInspiredCount(inspirers.size);
    setPeopleCount(people.size);
    setInspiredTimes(inspired);
    setRespectTimes(respect);

  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const lvl = getLevel(seasonPoints);
  const rankColor = rankColorFor(lvl.level);
  const { current, needed, pct } = xpProgressInLevel(seasonPoints);
  const isMax = lvl.maxXp === Infinity;
  const seasonYear = getCurrentSeasonYear();
  const seasonDaysLeft = daysUntilSeasonEnd();

  // Phone: the blend from the review — pop-up style header, a compact rank
  // card, the numbers as a grid, and the rest as short cards and link rows.
  if (!wide) {
    const back = () => (router.canGoBack() ? router.back() : goToTab('/home'));
    const streakWeeks = streak?.current ?? 0;
    const streakLine = streakWeeks >= 2
      ? `${streakWeeks} weeks in a row with 3 or more activities.`
      : streakWeeks === 1
        ? 'One more week with 3 or more activities starts a streak.'
        : 'Three activities in a week starts a streak.';
    const hours = Math.floor(totalTimeMinutes / 60);
    const numbers: [string, string, boolean?][] = [
      [thisWeekPoints.toLocaleString(), 'This week'],
      [Math.round(totalPoints).toLocaleString(), 'Lifetime'],
      [totalActivities.toLocaleString(), 'Activities'],
      [distanceNumber(totalDistanceKm), distanceUnit()],
      [elevationNumber(totalElevationM), `${elevationUnit()} climbed`],
      [memberSince || '—', 'Member since', true],
    ];
    const milestones = [
      { type: 'hours_100', icon: 'medal' as const, label: '100 hours' },
      { type: 'hours_500', icon: 'bolt' as const, label: '500 hours' },
      { type: 'hours_1000', icon: 'trophy' as const, label: '1,000 hours' },
      { type: 'hours_5000', icon: 'crown' as const, label: '5,000 hours' },
    ];
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: GREY_PAGE_BG }]} edges={['top', 'left', 'right']}>
        <RivalTopNav active="today" />
        <ScrollView contentContainerStyle={pb.content} {...pullProps}>
          {pullIndicator}
          <GreyPageHead
            kicker={isOwnProfile ? 'PROFILE' : (displayName || 'Teammate').toUpperCase()}
            title="Statistics"
            onBack={back}
          />

          {!isOwnProfile && (avatarUrl || mindset) ? (
            <View style={pb.person}>
              <View style={[pb.avatar, { borderColor: rankColor }]}>
                {avatarUrl
                  ? <Image source={{ uri: avatarUrl }} style={pb.avatarImg} />
                  : <Text style={pb.avatarText}>{displayName ? displayName[0].toUpperCase() : '?'}</Text>}
              </View>
              {mindset ? <Text style={pb.mindset} numberOfLines={3}>“{mindset}”</Text> : null}
            </View>
          ) : null}

          <View style={[pb.card, pb.rank]}>
            <Text style={pb.cap}>{seasonYear} rank</Text>
            <Text style={pb.rankName}>{lvl.name}</Text>
            {!isMax ? (
              <>
                <View style={pb.bar}><View style={[pb.barFill, { width: `${Math.max(2, Math.min(100, pct))}%` as any }]} /></View>
                <Text style={pb.rankSub}>
                  {Math.max(0, Math.ceil(needed - current)).toLocaleString()} Effort to {LEVELS[lvl.level]?.name ?? 'the next rank'}
                  {seasonDaysLeft > 0 ? ` · ${seasonDaysLeft} days left` : ''}
                </Text>
              </>
            ) : (
              <Text style={pb.rankSub}>The top rank for {seasonYear}.</Text>
            )}
          </View>

          <View style={pb.grid}>
            {numbers.map(([value, label, small]) => (
              <View key={label} style={pb.tile}>
                <Text style={[pb.tileValue, small && pb.tileValueSmall]} numberOfLines={1}>{value}</Text>
                <Text style={pb.tileLabel} numberOfLines={1}>{label}</Text>
              </View>
            ))}
          </View>

          <View style={pb.card}>
            <View style={pb.line}>
              <View style={pb.badge}><RivalIcon name="fire" size={15} color={RivalColors.accentText} /></View>
              <View style={{ flex: 1 }}>
                <Text style={pb.cap}>Streak</Text>
                <Text style={pb.lineText}>{streakLine}</Text>
              </View>
              {streakWeeks > 0 ? <Text style={pb.lineValue}>{streakWeeks}w</Text> : null}
            </View>
            {totalTimeMinutes > 0 ? (
              <View style={[pb.line, pb.rule]}>
                <View style={pb.badge}><RivalIcon name="timer" size={15} color={RivalColors.accentText} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={pb.cap}>Time earned</Text>
                  <Text style={pb.lineText}>
                    {hardTimeMinutes > 0 ? `${Math.floor(hardTimeMinutes / 60).toLocaleString()}h ${hardTimeMinutes % 60}m of it hard training.` : 'Every minute of training logged.'}
                  </Text>
                </View>
                <Text style={pb.lineValue}>{hours > 0 ? `${hours.toLocaleString()}h ` : ''}{totalTimeMinutes % 60}m</Text>
              </View>
            ) : null}
          </View>

          <GreyLabel>Impact</GreyLabel>
          <View style={[pb.card, pb.impact]}>
            {[
              { icon: 'respect' as const, value: respectTimes, label: 'Respect' },
              { icon: 'impact' as const, value: inspiredTimes, label: 'Inspired' },
              { icon: 'groups' as const, value: peopleCount, label: 'People' },
            ].map((f, i) => (
              <View key={f.label} style={[pb.impactCell, i > 0 && pb.impactRule]}>
                <RivalIcon name={f.icon} size={15} color={RivalColors.accentText} />
                <Text style={pb.impactValue}>{f.value.toLocaleString()}</Text>
                <Text style={pb.tileLabel}>{f.label}</Text>
              </View>
            ))}
          </View>

          {totalTimeMinutes > 0 ? (
            <>
              <GreyLabel>Milestones</GreyLabel>
              <View style={pb.milestones}>
                {milestones.map((m) => {
                  const earned = earnedMilestones.includes(m.type);
                  return (
                    <View key={m.type} style={[pb.milestone, earned && pb.milestoneOn]}>
                      <View style={[pb.badge, earned && pb.badgeOn]}>
                        <RivalIcon name={earned ? m.icon : 'lock'} size={15} color={earned ? RivalColors.surfaceLowest : 'rgba(255,255,255,0.4)'} />
                      </View>
                      <Text style={[pb.milestoneLabel, earned && { color: '#fff' }]} numberOfLines={1}>{m.label}</Text>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}

          {pastSeasons.length > 0 ? (
            <>
              <GreyLabel>Past years</GreyLabel>
              <GreyRows>
                {pastSeasons.map((ps) => (
                  <GreyRow
                    key={ps.year}
                    icon="calendar"
                    label={String(ps.year)}
                    value={`${ps.final_rank_name} · ${Math.round(ps.final_xp).toLocaleString()}`}
                    onPress={isOwnProfile ? () => router.push({ pathname: '/year-review', params: { year: String(ps.year) } }) : undefined}
                  />
                ))}
              </GreyRows>
            </>
          ) : null}

          {isOwnProfile ? (
            <>
              <GreyLabel>More</GreyLabel>
              <GreyRows>
                <GreyRow icon="trophy" label="Ranks" onPress={() => router.push('/ranks')}>
                  <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
                </GreyRow>
                <GreyRow icon="medal" label="Achievements" onPress={() => router.push('/achievements')}>
                  <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
                </GreyRow>
                <GreyRow icon="stats" label="Monthly recap" onPress={() => router.push('/recap?type=monthly')}>
                  <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
                </GreyRow>
                <GreyRow icon="calendar" label="Year in review" onPress={() => router.push('/year-review')}>
                  <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
                </GreyRow>
              </GreyRows>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content} {...pullProps}>
        {pullIndicator}

        <View style={styles.header}>
          <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
          <Text style={styles.headerTitle}>{isOwnProfile ? 'Statistics' : `${displayName}'s statistics`}</Text>
          <View style={{ width: 48 }} />
        </View>

        {/* Rank hero card */}
        <RivalCard style={[styles.rankCard, { borderColor: rankColor + '55', borderWidth: 1 }]}>
          <View style={[styles.rankAvatar, { borderColor: rankColor }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.rankAvatarImage} />
            ) : (
              <Text style={styles.rankAvatarText}>{displayName ? displayName[0].toUpperCase() : '?'}</Text>
            )}
          </View>
          {/* Mindset sits directly under the face it belongs to, in the
              person's own words — the first thing a teammate reads after
              tapping their name. Mobile only for now. */}
          {!wide && mindset ? (
            <View style={styles.mindset}>
              <Text style={styles.mindsetLabel}>MINDSET</Text>
              <Text style={styles.mindsetText}>“{mindset}”</Text>
            </View>
          ) : !wide && isOwnProfile ? (
            <TouchableOpacity style={styles.mindset} activeOpacity={0.7} onPress={() => router.push('/profile')}>
              <Text style={styles.mindsetLabel}>MINDSET</Text>
              <Text style={styles.mindsetEmpty}>Share your Mindset →</Text>
            </TouchableOpacity>
          ) : null}
          <Text
            style={[
              styles.rankName,
              { color: '#D8A81D' },
              // Same gradient recipe as the hero number / nav / season wrap
              // rank text — web-only, flat gold above is the native fallback.
              ...(Platform.OS === 'web' ? [{
                backgroundImage: 'linear-gradient(180deg, #FFE48A, #D8A81D)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
              } as any] : []),
            ]}
          >
            {lvl.name}
          </Text>
          <View style={[styles.levelPill, { backgroundColor: rankColor + '22', borderColor: rankColor + '55' }]}>
            <Text style={[styles.levelPillText, { color: rankColor }]}>Level {lvl.level} · {Math.round(seasonPoints)} Effort</Text>
          </View>
          <Text style={styles.seasonLabel}>
            {seasonYear}{seasonDaysLeft > 0 ? ` · ${seasonDaysLeft} days left` : ''}
          </Text>
          {!isMax && (
            <View style={styles.xpSection}>
              <RivalProgressBar pct={pct} height={8} />
              <Text style={styles.xpToNext}>{needed - current} Effort to {LEVELS[lvl.level]?.name ?? 'max'}</Text>
            </View>
          )}
          {isMax && <Text style={[styles.xpToNext, { color: rankColor, marginTop: 8 }]}>You are Unrivaled.</Text>}
        </RivalCard>

        {/* Stats row 1 */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard]}>
            <Text style={styles.statValue}>{thisWeekPoints}</Text>
            <Text style={styles.statLabel}>This week Effort</Text>
          </View>
          <View style={[styles.statCard]}>
            <Text style={styles.statValue}>{Math.round(totalPoints)}</Text>
            <Text style={styles.statLabel}>Lifetime Effort</Text>
          </View>
          <View style={[styles.statCard]}>
            <Text style={styles.statValue}>{totalActivities}</Text>
            <Text style={styles.statLabel}>Activities</Text>
          </View>
        </View>

        {/* Time Earned — hero card */}
        {totalTimeMinutes > 0 && (
          <RivalCard style={[styles.timeEarnedCard]}>
            <Text style={styles.timeEarnedLabel}>Time Earned</Text>
            <Text style={styles.timeEarnedValue}>
              {Math.floor(totalTimeMinutes / 60) > 0 ? `${Math.floor(totalTimeMinutes / 60)}h ` : ''}
              {totalTimeMinutes % 60}m
            </Text>
            <Text style={styles.timeEarnedSub}>Every minute here is yours. You earned it.</Text>
            {hardTimeMinutes > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <RivalIcon name="bolt" size={14} color={RivalColors.accentText} />
                <Text style={[styles.heroHardTime, { marginTop: 0 }]}>
                  {Math.floor(hardTimeMinutes / 60).toLocaleString()}h {hardTimeMinutes % 60}m hard training
                </Text>
              </View>
            )}
          </RivalCard>
        )}

        {/* Stats row 2 */}
        <View style={[styles.statsGrid, { marginBottom: 20 }]}>
          <View style={[styles.statCard]}>
            <Text style={[styles.statValue, { color: RivalColors.accentText }]}>{distanceNumber(totalDistanceKm)}</Text>
            <Text style={styles.statLabel}>{distanceUnit()} logged</Text>
          </View>
          <View style={[styles.statCard]}>
            <Text style={[styles.statValue, { color: RivalColors.accentText }]}>{elevationNumber(totalElevationM)}</Text>
            <Text style={styles.statLabel}>{elevationUnit()} climbed</Text>
          </View>
          <View style={[styles.statCard]}>
            <Text style={[styles.statValue, { fontSize: 16 }]}>{memberSince || '—'}</Text>
            <Text style={styles.statLabel}>Member since</Text>
          </View>
        </View>

        {/* Streak — a consistency metric, not a scoring bonus */}
        {(() => {
          const currentStreak = streak?.current ?? 0;
          const tiers = [
            { weeks: 2, label: '2 weeks' },
            { weeks: 4, label: '4 weeks' },
            { weeks: 8, label: '8 weeks' },
            { weeks: 12, label: '12 weeks' },
          ];
          return (
            <RivalCard style={[styles.streakCard]}>
              <View style={styles.streakCardHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <RivalIcon name="fire" size={16} color={RivalColors.textPrimary} />
                  <Text style={styles.streakCardTitle}>Streak</Text>
                </View>
                <View style={styles.streakCurrentPill}>
                  <Text style={styles.streakCurrentText}>
                    {currentStreak > 0 ? `${currentStreak}w streak` : 'No streak'}
                  </Text>
                </View>
              </View>
              <Text style={styles.streakCardSub}>
                Complete at least 3 activities every week to build your streak — a record of your consistency, not a score booster.
              </Text>
              <View style={styles.streakTiers}>
                {tiers.map((tier) => {
                  const isActive = currentStreak >= tier.weeks;
                  const isNext = !isActive && currentStreak < tier.weeks &&
                    (tier === tiers.find(t => currentStreak < t.weeks));
                  return (
                    <View key={tier.weeks} style={[styles.streakTierRow, isActive && styles.streakTierRowActive]}>
                      <Text style={[styles.streakTierWeeks, isActive && { color: RivalColors.accentText }]}>
                        {isActive ? '✓' : isNext ? '→' : '  '} {tier.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {currentStreak === 0 && (
                <Text style={styles.streakNudge}>Log 3 activities this week to start a streak.</Text>
              )}
              {currentStreak === 1 && (
                <Text style={styles.streakNudge}>One more qualifying week starts a streak.</Text>
              )}
            </RivalCard>
          );
        })()}

        {/* Milestones */}
        {totalTimeMinutes > 0 && (
          <RivalCard style={[styles.milestonesCard]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <RivalIcon name="trophy" size={16} color={RivalColors.textSecondary} />
              <Text style={styles.milestonesTitle}>Milestones</Text>
            </View>
            <View style={styles.milestonesRow}>
              {[
                { type: 'hours_100', icon: 'medal' as const, label: '100h' },
                { type: 'hours_500', icon: 'bolt' as const, label: '500h' },
                { type: 'hours_1000', icon: 'trophy' as const, label: '1,000h' },
                { type: 'hours_5000', icon: 'crown' as const, label: '5,000h' },
              ].map(m => {
                const earned = earnedMilestones.includes(m.type);
                return (
                  <View key={m.type} style={[styles.milestoneBadge, !earned && styles.milestoneBadgeLocked]}>
                    <RivalIcon name={earned ? m.icon : 'lock'} size={24} color={earned ? RivalColors.textPrimary : RivalColors.textSecondary} />
                    <Text style={[styles.milestoneBadgeLabel, !earned && { color: RivalColors.textSecondary }]}>{m.label}</Text>
                  </View>
                );
              })}
            </View>
          </RivalCard>
        )}

        {/* Impact */}
        <RivalCard style={[styles.impactCard]}>
          <Text style={styles.impactLabel}>IMPACT</Text>
          {!wide && (
            // Phone: the three numbers, the same set as Home's Legacy swipe.
            <View style={styles.mImpactRow}>
              {[
                { icon: 'respect' as const, value: respectTimes, label: 'Respect' },
                { icon: 'impact' as const, value: inspiredTimes, label: 'Inspired' },
                { icon: 'groups' as const, value: peopleCount, label: 'People' },
              ].map((f, i) => (
                <View key={f.label} style={[styles.mImpactCell, i > 0 && styles.mImpactCellBorder]}>
                  <RivalIcon name={f.icon} size={16} color={RivalColors.accentFill} />
                  <Text style={styles.mImpactValue}>{f.value.toLocaleString()}</Text>
                  <Text style={styles.mImpactLabel}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}
          {wide && (
          <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <RivalIcon name="ai" size={18} color={RivalColors.textPrimary} />
            <Text style={styles.impactValue}>
              {inspiredTimes.toLocaleString()} {inspiredTimes === 1 ? 'time' : 'times'} people have shown up for your effort
            </Text>
          </View>
          <Text style={styles.impactSub}>
            {inspiredCount > 0
              ? `by ${inspiredCount.toLocaleString()} ${inspiredCount === 1 ? 'person who keeps' : 'people who keep'} showing up`
              : 'Nobody yet — get out there.'}
          </Text>
          </>
          )}
        </RivalCard>

        {/* Past Seasons */}
        {pastSeasons.length > 0 && (
          !wide ? (
            // Phone: one card per year with the rank it finished on, each
            // opening that year's review (on your own page).
            <View style={styles.mPastYears}>
              <Text style={styles.mPastYearsTitle}>Past years</Text>
              <View style={styles.mPastYearsRow}>
                {pastSeasons.map((s) => {
                  const lvl = getLevel(s.final_xp);
                  return (
                    <TouchableOpacity
                      key={s.year}
                      style={[styles.mPastYearCard]}
                      disabled={!isOwnProfile}
                      activeOpacity={0.85}
                      onPress={() => router.push({ pathname: '/year-review', params: { year: String(s.year) } })}
                    >
                      <Text style={styles.mPastYear}>{s.year}</Text>
                      <Text style={[styles.mPastYearRank, { color: rankColorFor(lvl.level) }]} numberOfLines={1}>{s.final_rank_name}</Text>
                      <Text style={styles.mPastYearEffort}>{Math.round(s.final_xp).toLocaleString()} Effort</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : (
          <RivalCard style={styles.pastSeasonsCard}>
            <Text style={styles.pastSeasonsTitle}>Past years</Text>
            {pastSeasons.map((s) => {
              const seasonLvl = getLevel(s.final_xp);
              const seasonRankColor = rankColorFor(seasonLvl.level);
              return (
                <View key={s.year} style={styles.pastSeasonRow}>
                  <Text style={styles.pastSeasonYear}>{s.year}</Text>
                  <Text style={[styles.pastSeasonRank, { color: seasonRankColor }]}>
                    {seasonLvl.icon} {s.final_rank_name}
                  </Text>
                  <Text style={styles.pastSeasonXp}>{Math.round(s.final_xp)} Effort</Text>
                </View>
              );
            })}
          </RivalCard>
          )
        )}

        {/* Quick links */}
        <View style={styles.quickLinks}>
          <TouchableOpacity style={[styles.quickLink]} onPress={() => router.push('/ranks')}>
            <RivalIcon name="trophy" size={22} color={RivalColors.textPrimary} />
            <Text style={styles.quickLinkText}>All ranks</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickLink]} onPress={() => router.push('/achievements')}>
            <RivalIcon name="medal" size={22} color={RivalColors.textPrimary} />
            <Text style={styles.quickLinkText}>Achievements</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickLink]} onPress={() => router.push('/recap?type=monthly')}>
            <RivalIcon name="stats" size={22} color={RivalColors.textPrimary} />
            <Text style={styles.quickLinkText}>Monthly Recap</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickLink]} onPress={() => router.push('/year-review')}>
            <RivalIcon name="calendar" size={22} color={RivalColors.textPrimary} />
            <Text style={styles.quickLinkText}>Year in review</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: RivalColors.textSecondary, fontSize: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  back: { color: RivalColors.accentText, fontSize: 16, width: 48 },
  // Page title in the editorial serif, matching Today / Activity / Team Feed.
  headerTitle: { ...RivalType.titleMd, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '600', color: RivalColors.textPrimary },

  rankCard: { marginBottom: 16, alignItems: 'center', gap: 10 },
  rankAvatar: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 3,
    backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  rankAvatarImage: { width: 88, height: 88, borderRadius: 44 },
  rankAvatarText: { fontSize: 36, fontWeight: '700', color: RivalColors.onAccentFill },
  rankName: { fontSize: 36, fontWeight: '800', letterSpacing: 1 },
  mindset: { alignItems: 'center', gap: 6, paddingHorizontal: 8, marginBottom: 4, maxWidth: 360 },
  mindsetLabel: { ...RivalType.labelCaps, color: RivalColors.accentText },
  mindsetText: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 17, lineHeight: 24,
    color: RivalColors.textPrimary, textAlign: 'center',
  },
  mindsetEmpty: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 15, color: RivalColors.textSecondary },
  levelPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: RivalRadius.full, borderWidth: 1 },
  levelPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  seasonLabel: { fontSize: 12, color: RivalColors.textSecondary, marginTop: -4 },
  xpSection: { width: '100%', gap: 6, marginTop: 4 },
  xpToNext: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },

  timeEarnedCard: { marginBottom: 16, alignItems: 'center', gap: 6 },
  timeEarnedLabel: { ...RivalType.labelCaps, color: RivalColors.textSecondary },
  timeEarnedValue: { ...RivalType.displayHero, color: RivalColors.accentText },
  timeEarnedSub: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
  heroHardTime: { fontSize: 12, color: RivalColors.accentText, fontWeight: '600', marginTop: 2 },

  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statCard: { flex: 1, backgroundColor: RivalColors.surfaceHigh, borderRadius: RivalRadius.lg, padding: 14, alignItems: 'center', gap: 5 },
  statValue: { fontSize: 20, fontWeight: '700', color: RivalColors.textPrimary },
  statLabel: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary, textAlign: 'center' },

  streakCard: { marginBottom: 16, gap: 14 },
  streakCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  streakCardTitle: { fontSize: 16, fontWeight: '700', color: RivalColors.textPrimary },
  streakCurrentPill: {
    backgroundColor: `${RivalColors.accentFill}22`, borderRadius: RivalRadius.full,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: `${RivalColors.accentFill}55`,
  },
  streakCurrentText: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  streakCardSub: { fontSize: 12, color: RivalColors.textSecondary, lineHeight: 18 },
  streakTiers: { gap: 8 },
  streakTierRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: RivalRadius.DEFAULT, backgroundColor: RivalColors.surfaceLow,
  },
  streakTierRowActive: { backgroundColor: RivalColors.surfaceContainer, borderWidth: 1, borderColor: `${RivalColors.accentFill}33` },
  streakTierWeeks: { fontSize: 13, color: RivalColors.textSecondary, fontWeight: '600' },
  streakNudge: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },

  milestonesCard: { marginBottom: 16, gap: 12 },
  milestonesTitle: { ...RivalType.labelCaps, color: RivalColors.textSecondary },
  milestonesRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  milestoneBadge: { flex: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingVertical: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: `${RivalColors.rankAnchors.unrivaled}55` },
  milestoneBadgeLocked: { backgroundColor: RivalColors.surfaceLowest, borderColor: RivalColors.surfaceContainerHigh },
  milestoneBadgeIcon: { fontSize: 24 },
  milestoneBadgeLabel: { fontSize: 11, fontWeight: '700', color: RivalColors.rankAnchors.unrivaled },

  impactCard: { marginBottom: 16, alignItems: 'center', gap: 6 },
  impactLabel: { ...RivalType.labelCaps, color: RivalColors.tertiary },
  impactValue: { fontSize: 20, fontWeight: '700', color: RivalColors.textPrimary, textAlign: 'center' },
  impactSub: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },

  pastSeasonsCard: { marginBottom: 16, gap: 10 },
  mImpactRow: { flexDirection: 'row', marginTop: 4 },
  mImpactCell: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 6 },
  mImpactCellBorder: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,209,190,0.08)' },
  mImpactValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, color: '#fff' },
  mImpactLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' },
  mPastYears: { marginBottom: 16, gap: 10 },
  mPastYearsTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  mPastYearsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mPastYearCard: {
    flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: 3, paddingVertical: 14, paddingHorizontal: 6,
    backgroundColor: '#1d1714', borderWidth: 1, borderColor: 'rgba(255,209,190,0.10)', borderRadius: 16,
  },
  mPastYear: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, color: '#fff' },
  mPastYearRank: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.8 },
  mPastYearEffort: { fontSize: 11.5, color: 'rgba(255,255,255,0.55)' },
  pastSeasonsTitle: { ...RivalType.labelCaps, color: RivalColors.textSecondary },
  pastSeasonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: RivalColors.surfaceContainerHigh },
  pastSeasonYear: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary, width: 50 },
  pastSeasonRank: { fontSize: 14, fontWeight: '700', flex: 1 },
  pastSeasonXp: { fontSize: 13, color: RivalColors.textSecondary, fontWeight: '600' },

  quickLinks: { flexDirection: 'row', gap: 10, marginBottom: 16, marginTop: 6 },
  quickLink: { flex: 1, backgroundColor: RivalColors.surfaceHigh, borderRadius: RivalRadius.DEFAULT, paddingVertical: 16, alignItems: 'center', gap: 6 },
  quickLinkIcon: { fontSize: 22 },
  quickLinkText: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600' },
});


// Phone only: the blend (grey page, recessed cards, serif numbers).
const pb = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 10 },
  card: { backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: RivalColors.surfaceBright, borderRadius: 16, paddingHorizontal: 14 },
  cap: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary },
  person: { alignItems: 'center', gap: 8, marginBottom: 2 },
  avatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: RivalColors.accentFill },
  avatarImg: { width: 64, height: 64 },
  avatarText: { fontSize: 26, fontWeight: '700', color: RivalColors.onAccentFill },
  mindset: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 15, lineHeight: 21, color: '#fff', textAlign: 'center', paddingHorizontal: 20 },
  rank: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  rankName: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 40, lineHeight: 46, color: '#fff',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #ffffff, #D97757 170%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : {}),
  } as any,
  bar: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  barFill: {
    height: '100%', borderRadius: 3, backgroundColor: RivalColors.accentFill,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, #D97757, #ffb59e)' } : {}),
  } as any,
  rankSub: { fontSize: 12.5, color: RivalColors.textSecondary, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: 3, paddingVertical: 13, paddingHorizontal: 4,
    backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: RivalColors.surfaceBright, borderRadius: 14,
  },
  tileValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, color: '#fff', fontVariant: ['tabular-nums'] },
  tileValueSmall: { fontSize: 17, lineHeight: 27 },
  tileLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderTopColor: 'rgba(50,50,50,0.8)' },
  lineText: { fontSize: 13, lineHeight: 18, color: RivalColors.textSecondary, marginTop: 2 },
  lineValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, color: RivalColors.accentText },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  badgeOn: {
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  impact: { flexDirection: 'row', paddingHorizontal: 0 },
  impactCell: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 13 },
  impactRule: { borderLeftWidth: 1, borderLeftColor: 'rgba(50,50,50,0.8)' },
  impactValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, color: '#fff' },
  milestones: { flexDirection: 'row', gap: 7 },
  milestone: {
    flex: 1, alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 9,
    borderRadius: 14, backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: RivalColors.surfaceBright,
  },
  milestoneOn: { borderColor: 'rgba(255,181,158,0.5)', backgroundColor: 'rgba(217,119,87,0.10)' },
  milestoneLabel: { fontSize: 10.5, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
});
