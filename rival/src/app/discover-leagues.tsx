import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput, Image, useWindowDimensions, Platform } from 'react-native';
import { goToTab } from '../lib/tabNav';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { notify } from '../lib/notify';
import { RivalTopNav, RivalIcon, RivalFixedBackground, RivalWarm, RivalMiniTile, rb, GreyPageHead } from '../components/rival';
import { formatDisplayName, formatTeamName } from '../lib/identity';
import type { RivalIconName } from '../components/rival/RivalIcon';
import { RivalColors, RivalRadius, RivalType, RivalButtonColors, RivalSerifFamily } from '../constants/rivalTheme';
import { BREAKPOINT_TWO_UP_GRID, BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { BusyText } from '../components/rival/BusyText';

type MembershipState = 'none' | 'pending' | 'active';

type TeamRow = {
  id: string;
  name: string;
  logo_url: string | null;
  member_count: number;
  // Public teams only: sessions logged by the team in the last 7 days. The
  // single most useful signal for a stranger — is this team alive?
  sessions_last_7d: number;
  membership: MembershipState;
  // Populated for "my teams" only — a reason to click, not just a headcount.
  heroStat: { icon: 'fire' | 'trophy' | 'run' | 'chat'; text: string } | null;
  lastActivityAt: string | null;
  unreadCount: number;
  // Most recent unread message's sender — a name to notice, not just a count.
  unreadFrom: string | null;
  // "Evidence of shared commitment" — since the team formed, not a rolling window.
  together: { weeks: number; hours: number } | null;
  pinned: boolean;
};


function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function getMondayStart(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Teams landing page (stitch-export-16 "My Teams" layout): your teams as big
// hero cards up top, then a Discover section for public teams below, one
// search box covering both. The mock's Nearby/Pro/Endurance filter chips and
// live-session times are omitted — there's no location/schedule data to back
// them, and fake chips don't earn their place.
export default function DiscoverLeaguesScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= BREAKPOINT_TWO_UP_GRID;
  // Phone: the RIVAL look on headings and the Discover rows. The team cards
  // keep their own design.
  const mob = windowWidth < BREAKPOINT_WIDE_LAYOUT;

  const [myTeams, setMyTeams] = useState<TeamRow[]>([]);
  const [publicTeams, setPublicTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  const { scrollProps: pullProps, indicator: pullIndicator } = usePullToRefresh(() => load());

  async function load() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;

    const [publicRes, membershipRes, activeMembersRes, publicCountsRes] = await Promise.all([
      supabase.from('leagues').select('id, name, logo_url').eq('is_private', false).order('name'),
      supabase.from('league_members').select('league_id, status, pinned, leagues(id, name, logo_url, created_at)').eq('user_id', user.id),
      // Active membership rows across every league — doubles as both the
      // public "member count" and, filtered to my teams below, the roster
      // used to compute each team's hero stat.
      supabase.from('league_members').select('league_id, user_id').eq('status', 'active'),
      // Public-team counts have to come from an RPC: RLS on league_members is
      // is_league_member(), so counting rows client-side only ever sees teams
      // you're ALREADY in — every public team you hadn't joined showed "0".
      supabase.rpc('get_public_team_counts'),
    ]);
    const publicCounts = new Map<string, { members: number; sessions: number }>(
      (publicCountsRes.data || []).map((r: any) => [r.league_id, {
        members: Number(r.member_count ?? 0),
        sessions: Number(r.sessions_last_7d ?? 0),
      }])
    );

    const countMap: Record<string, number> = {};
    const membersByLeague: Record<string, string[]> = {};
    (activeMembersRes.data || []).forEach((m: any) => {
      countMap[m.league_id] = (countMap[m.league_id] || 0) + 1;
      (membersByLeague[m.league_id] ??= []).push(m.user_id);
    });

    const membershipMap = new Map((membershipRes.data || []).map((m: any) => [m.league_id, m.status as MembershipState]));

    const myTeamRows = (membershipRes.data || []).filter((m: any) => m.status === 'active' && m.leagues);
    const myTeamIds = myTeamRows.map((m: any) => m.leagues.id);
    const teamCreatedAt: Record<string, string | null> = {};
    myTeamRows.forEach((m: any) => { teamCreatedAt[m.leagues.id] = m.leagues.created_at ?? null; });

    // Hero stat per team: reason to click, not just a headcount. Bounded to a
    // 30-day window across only my teams' rosters (small, cheap) — enough to
    // rank this week's Effort and flag a teammate's recent PB without a
    // separate query per team.
    const heroStatByLeague: Record<string, TeamRow['heroStat']> = {};
    const lastActivityByLeague: Record<string, string | null> = {};
    const unreadByLeague: Record<string, number> = {};
    const unreadFromByLeague: Record<string, string | null> = {};
    const togetherByLeague: Record<string, TeamRow['together']> = {};
    if (myTeamIds.length > 0) {
      const allMemberIds = Array.from(new Set(myTeamIds.flatMap((id: string) => membersByLeague[id] || [])));
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const weekStart = getMondayStart(new Date());

      // Earliest of my teams' creation dates — the "together" query needs full
      // history back to whichever team formed first, not just 30 days.
      const createdDates = myTeamIds.map((id: string) => teamCreatedAt[id]).filter(Boolean) as string[];
      const earliestCreatedAt = createdDates.length > 0
        ? createdDates.reduce((min, d) => (new Date(d) < new Date(min) ? d : min))
        : thirtyDaysAgo.toISOString();

      const [activitiesRes, readsRes, messagesRes, togetherActivitiesRes, profilesRes] = await Promise.all([
        allMemberIds.length > 0
          ? supabase.from('activities')
              .select('user_id, effort_score, exercises, started_at, activity_type')
              .in('user_id', allMemberIds)
              .gte('started_at', thirtyDaysAgo.toISOString())
              .order('started_at', { ascending: false })
              .limit(500)
          : Promise.resolve({ data: [] }),
        supabase.from('league_chat_reads').select('league_id, last_read_at').eq('user_id', user.id).in('league_id', myTeamIds),
        supabase.from('league_messages').select('league_id, user_id, created_at').eq('kind', 'text').in('league_id', myTeamIds).order('created_at', { ascending: false }).limit(500),
        // "Training together" duration, per team — bounded to the union of my
        // teams' rosters since whichever formed first, capped at 3000 rows so
        // a long-lived team can't blow up the query.
        allMemberIds.length > 0
          ? supabase.from('activities')
              .select('user_id, duration_seconds, started_at')
              .in('user_id', allMemberIds)
              .gte('started_at', earliestCreatedAt)
              .limit(3000)
          : Promise.resolve({ data: [] }),
        // Names for the hero-stat "{Name} logged a run" / unread-sender lines
        // — a name is what makes the signal worth noticing, not just a count.
        allMemberIds.length > 0
          ? supabase.from('users').select('id, display_name').in('id', allMemberIds)
          : Promise.resolve({ data: [] }),
      ]);
      const recentActivities = activitiesRes.data;
      const profileById = new Map((profilesRes.data || []).map((p: any) => [p.id, p]));

      myTeamIds.forEach((teamId: string) => {
        const createdAt = teamCreatedAt[teamId];
        if (!createdAt) { togetherByLeague[teamId] = null; return; }
        const teamMemberIds = new Set(membersByLeague[teamId] || []);
        const teamTogetherActivities = (togetherActivitiesRes.data || []).filter((a: any) =>
          teamMemberIds.has(a.user_id) && new Date(a.started_at) >= new Date(createdAt)
        );
        if (teamTogetherActivities.length === 0) { togetherByLeague[teamId] = null; return; }
        const weeks = Math.max(1, Math.floor((Date.now() - new Date(createdAt).getTime()) / (7 * 24 * 60 * 60 * 1000)));
        const totalSeconds = teamTogetherActivities.reduce((s: number, a: any) => s + (a.duration_seconds || 0), 0);
        togetherByLeague[teamId] = { weeks, hours: Math.round(totalSeconds / 3600) };
      });

      // Most recent unread message per team, named — "Emma" is worth noticing,
      // a bare count isn't. Messages arrive newest-first, so the first unread
      // one seen per league is the most recent.
      const lastReadByLeague = new Map((readsRes.data || []).map((r: any) => [r.league_id, r.last_read_at]));
      (messagesRes.data || []).forEach((m: any) => {
        const lastRead = lastReadByLeague.get(m.league_id);
        if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
          unreadByLeague[m.league_id] = (unreadByLeague[m.league_id] || 0) + 1;
          if (!unreadFromByLeague[m.league_id]) {
            unreadFromByLeague[m.league_id] = formatDisplayName(profileById.get(m.user_id), 'Someone');
          }
        }
      });

      myTeamIds.forEach((teamId: string) => {
        const teamMemberIds = new Set(membersByLeague[teamId] || []);
        const teamActivities = (recentActivities || []).filter((a: any) => teamMemberIds.has(a.user_id));

        lastActivityByLeague[teamId] = teamActivities[0]?.started_at ?? null;

        const pbThisWeek = teamActivities.some((a: any) =>
          new Date(a.started_at).getTime() >= weekStart &&
          (a.exercises || []).some((ex: any) => ex.prLift)
        );
        if (pbThisWeek) {
          heroStatByLeague[teamId] = { icon: 'fire', text: 'New PB this week' };
          return;
        }

        const weekActivities = teamActivities.filter((a: any) => new Date(a.started_at).getTime() >= weekStart);
        if (teamMemberIds.size > 1 && weekActivities.length > 0) {
          const effortByUser = new Map<string, number>();
          weekActivities.forEach((a: any) => {
            effortByUser.set(a.user_id, (effortByUser.get(a.user_id) || 0) + (a.effort_score || 0));
          });
          const ranked = Array.from(teamMemberIds).sort((a, b) => (effortByUser.get(b) || 0) - (effortByUser.get(a) || 0));
          const myRank = ranked.indexOf(user.id) + 1;
          if (myRank > 0) {
            heroStatByLeague[teamId] = { icon: 'trophy', text: `You're ${ordinal(myRank)} this week` };
            return;
          }
        }

        // Named, not counted — "Emma logged a Run" is memorable, "1 activity
        // this week" is forgettable. Most recent activity this week wins.
        const mostRecent = weekActivities[0];
        if (mostRecent) {
          const name = formatDisplayName(profileById.get(mostRecent.user_id), 'Someone');
          const typeLabel = (mostRecent.activity_type || 'an activity').replace(/([a-z])([A-Z])/g, '$1 $2');
          heroStatByLeague[teamId] = { icon: 'run', text: `${name} logged ${typeLabel}` };
        } else {
          heroStatByLeague[teamId] = null;
        }
      });
    }

    const sortedMyTeams = myTeamRows
      .map((m: any) => ({
        id: m.leagues.id,
        name: formatTeamName(m.leagues.name),
        logo_url: m.leagues.logo_url,
        member_count: countMap[m.leagues.id] || 0,
        sessions_last_7d: 0,
        membership: 'active' as MembershipState,
        heroStat: heroStatByLeague[m.leagues.id] || null,
        lastActivityAt: lastActivityByLeague[m.leagues.id] || null,
        unreadCount: unreadByLeague[m.leagues.id] || 0,
        unreadFrom: unreadFromByLeague[m.leagues.id] || null,
        together: togetherByLeague[m.leagues.id] || null,
        pinned: !!m.pinned,
      }))
      // A manually pinned team always wins; otherwise most recently active
      // first — "who am I training with today", not alphabetical.
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime();
      });

    setMyTeams(sortedMyTeams);

    setPublicTeams(
      (publicRes.data || [])
        .filter((l: any) => membershipMap.get(l.id) !== 'active')
        .map((l: any) => ({
          id: l.id,
          name: formatTeamName(l.name),
          logo_url: l.logo_url,
          member_count: publicCounts.get(l.id)?.members ?? 0,
          sessions_last_7d: publicCounts.get(l.id)?.sessions ?? 0,
          membership: membershipMap.get(l.id) || 'none',
          heroStat: null,
          lastActivityAt: null,
          unreadCount: 0,
          unreadFrom: null,
          together: null,
          pinned: false,
        }))
    );
    setLoading(false);
  }

  const MAX_PINNED = 3;

  // Manually pin up to 3 teams to the top of the grid, overriding the
  // automatic "most recently active" order. Unpinning is done by tapping an
  // already-pinned team again; a 4th pin attempt is a no-op rather than
  // bumping an existing pin — explicit unpin first, no surprise evictions.
  async function togglePin(leagueId: string) {
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    const wasPinned = myTeams.find(t => t.id === leagueId)?.pinned;
    const pinnedCount = myTeams.filter(t => t.pinned).length;
    if (!wasPinned && pinnedCount >= MAX_PINNED) return;

    // Optimistic — flip locally before the round-trip so the tap feels instant.
    setMyTeams(prev => prev
      .map(t => (t.id === leagueId ? { ...t, pinned: !wasPinned } : t))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime();
      }));

    const { error } = await supabase.from('league_members').update({ pinned: !wasPinned }).eq('user_id', user.id).eq('league_id', leagueId);
    if (error) notify("Couldn't pin that team", error.message);
  }

  async function join(leagueId: string) {
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    setJoining(leagueId);
    setJoinError(null);
    const { error } = await supabase.from('league_members').insert({ league_id: leagueId, user_id: user.id, role: 'member', status: 'pending' });
    setJoining(null);
    if (error) {
      setJoinError(error.message);
      return;
    }
    setPublicTeams(prev => prev.map(l => l.id === leagueId ? { ...l, membership: 'pending' } : l));
  }

  const q = search.trim().toLowerCase();
  const filteredMine = myTeams.filter(l => l.name.toLowerCase().includes(q));
  const filteredPublic = publicTeams.filter(l => l.name.toLowerCase().includes(q));

  function memberLabel(n: number) {
    return `${n} ${n === 1 ? 'member' : 'members'}`;
  }

  // Deterministic fallback glyph when a team has no crest yet — cheap
  // per-card visual variety without a database column to back it.
  const FALLBACK_ICONS = ['bolt', 'medal', 'fire', 'star', 'location'] as const;
  function fallbackIcon(id: string) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return FALLBACK_ICONS[hash % FALLBACK_ICONS.length];
  }

  // Phone: the blend. No background photo; every team shows its crest
  // beside its name, in grouped rows.
  if (mob) {
    const crest = (team: TeamRow) => team.logo_url ? (
      <Image source={{ uri: team.logo_url }} style={pm.crest} />
    ) : (
      <View style={[pm.crest, pm.crestFallback]}>
        <RivalIcon name={fallbackIcon(team.id)} size={17} color={RivalColors.accentText} />
      </View>
    );
    return (
      <SafeAreaView style={rb.page} edges={['top', 'left', 'right']}>
        <RivalTopNav active="teams" />
        <ScrollView contentContainerStyle={[rb.content, { paddingBottom: 120 }]} {...pullProps}>
          {pullIndicator}
          <GreyPageHead kicker="TEAMS" title="Find a team" onBack={() => (router.canGoBack() ? router.back() : goToTab('/team-feed'))} />

          <View style={[rb.field, pm.search]}>
            <RivalIcon name="search" size={17} color={RivalColors.textSecondary} />
            <TextInput style={pm.searchInput} value={search} onChangeText={setSearch} placeholder="Search teams" placeholderTextColor={RivalColors.textSecondary} />
          </View>
          <View style={pm.tiles}>
            <RivalMiniTile icon="add" label="Create team" onPress={() => router.push('/create-league')} />
            <RivalMiniTile icon="key" label="Invite code" onPress={() => router.push('/join-league')} />
          </View>

          {loading && <Text style={pm.muted}>Loading…</Text>}

          {!loading && (
            <>
              <Text style={rb.section}>My teams</Text>
              {filteredMine.length === 0 ? (
                <View style={[rb.card, pm.emptyRow]}>
                  <View style={rb.badge}><RivalIcon name="groups" size={16} color={RivalColors.accentText} /></View>
                  <Text style={pm.emptyText}>{q ? 'No teams match this search.' : 'No team yet. Create one, or ask to join a public team below.'}</Text>
                </View>
              ) : (
                <View style={[rb.card, pm.list]}>
                  {filteredMine.map((team, i) => (
                    <TouchableOpacity key={team.id} style={[pm.row, i > 0 && rb.rule]} onPress={() => router.push({ pathname: '/team-hub', params: { id: team.id } })} activeOpacity={0.8}>
                      {crest(team)}
                      <View style={pm.rowText}>
                        <Text style={pm.name} numberOfLines={1}>{team.name}</Text>
                        <Text style={pm.meta} numberOfLines={1}>
                          {team.unreadFrom ? `${team.unreadFrom} messaged` : memberLabel(team.member_count)}
                        </Text>
                      </View>
                      {team.pinned ? <RivalIcon name="pin" size={14} color={RivalColors.accentText} /> : null}
                      <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={rb.section}>Discover</Text>
              {joinError && <Text style={styles.joinError}>{joinError}</Text>}
              {filteredPublic.length === 0 ? (
                <View style={[rb.card, pm.emptyRow]}>
                  <View style={rb.badge}><RivalIcon name="globe" size={16} color={RivalColors.accentText} /></View>
                  <Text style={pm.emptyText}>{q ? 'No public teams match this search.' : 'No public teams right now.'}</Text>
                </View>
              ) : (
                <View style={[rb.card, pm.list]}>
                  {filteredPublic.map((team, i) => (
                    <View key={team.id} style={[pm.row, i > 0 && rb.rule]}>
                      <TouchableOpacity style={pm.rowMain} onPress={() => router.push({ pathname: '/team-preview', params: { id: team.id } })} activeOpacity={0.8}>
                        {crest(team)}
                        <View style={pm.rowText}>
                          <Text style={pm.name} numberOfLines={1}>{team.name}</Text>
                          <Text style={pm.meta} numberOfLines={1}>
                            {memberLabel(team.member_count)}
                            {team.sessions_last_7d > 0 ? ` · ${team.sessions_last_7d} this week` : ' · Quiet this week'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      {team.membership === 'pending' ? (
                        <Text style={pm.requested}>Requested</Text>
                      ) : (
                        <TouchableOpacity style={pm.request} onPress={() => join(team.id)} disabled={joining === team.id}>
                          <BusyText busy={joining === team.id} style={pm.requestText}>{joining === team.id ? 'Sending…' : 'Request'}</BusyText>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <RivalFixedBackground
        source={require('../../assets/images/backgrounds/optimized/coastal-cliff-hikers-group.jpg')}
        focalPoint="43% 42%"
      />
      <View style={styles.scrim} />
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav active="teams" />
      <ScrollView
        contentContainerStyle={styles.content}
        {...pullProps}
      >
        {pullIndicator}

        {/* Search + entry points */}
        <View style={[styles.toolRow, wide && styles.toolRowWide]}>
          <View style={styles.searchBox}>
            <RivalIcon name="search" size={18} color={RivalColors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search teams…"
              placeholderTextColor={RivalColors.textSecondary}
            />
          </View>
          <View style={styles.actionBtns}>
            {mob ? (
              <RivalMiniTile icon="add" label="Create team" onPress={() => router.push('/create-league')} />
            ) : (
            <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/create-league')}>
              <RivalIcon name="add" size={16} color={RivalColors.onAccentFill} />
              <Text style={styles.actionBtnText}>Create Team</Text>
            </TouchableOpacity>
            )}
            {mob ? (
              <RivalMiniTile icon="key" label="Invite code" onPress={() => router.push('/join-league')} />
            ) : (
            <TouchableOpacity style={styles.actionBtnGhost} onPress={() => router.push('/join-league')}>
              <RivalIcon name="key" size={16} color={RivalColors.accentText} />
              <Text style={styles.actionBtnGhostText}>Invite code</Text>
            </TouchableOpacity>
            )}
          </View>
        </View>

        {loading && <Text style={styles.loading}>Loading…</Text>}

        {/* ——— My Teams ——— */}
        {!loading && (
          <>
            <Text style={[styles.sectionTitle, styles.sectionTitleCentered, mob && ms.sectionTitle]}>{mob ? 'My teams' : 'My Teams'}</Text>
            {filteredMine.length === 0 ? (
              <View style={styles.emptyBox}>
                <RivalIcon name="groups" size={30} color={RivalColors.textSecondary} />
                <Text style={styles.emptyText}>{q ? 'No teams match this search.' : 'No team yet.'}</Text>
                {!q && <Text style={styles.emptySub}>Create one, or join a public team below.</Text>}
              </View>
            ) : (
              <View style={[styles.teamGrid, wide && styles.teamGridWide]}>
                {filteredMine.map(team => (
                  <TeamGridCard
                    key={team.id}
                    team={team}
                    wide={wide}
                    members={memberLabel(team.member_count)}
                    fallbackIconName={fallbackIcon(team.id)}
                    onPress={() => router.push({ pathname: '/team-hub', params: { id: team.id } })}
                    onTogglePin={() => togglePin(team.id)}
                  />
                ))}
                <TouchableOpacity
                  style={[styles.joinCard, wide && styles.gridCardWide]}
                  onPress={() => router.push('/join-league')}
                  activeOpacity={0.85}
                >
                  <View style={styles.joinCardIcon}>
                    <RivalIcon name="add" size={26} color={RivalColors.textPrimary} />
                  </View>
                  <Text style={styles.joinCardTitle}>Join a Team</Text>
                  <Text style={styles.joinCardSub}>Enter an invite code or browse public teams</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ——— Discover ——— */}
            <Text style={[styles.sectionTitle, styles.sectionTitleCentered, mob && ms.sectionTitle]}>Discover</Text>
            <Text style={styles.sectionSub}>Public teams open to join requests.</Text>

            {joinError && <Text style={styles.joinError}>{mob ? joinError : `⚠️ ${joinError}`}</Text>}

            {filteredPublic.length === 0 ? (
              <View style={styles.emptyBox}>
                <RivalIcon name="globe" size={30} color={RivalColors.textSecondary} />
                <Text style={styles.emptyText}>{q ? 'No public teams match your search.' : 'No public teams right now.'}</Text>
                {!q && <Text style={styles.emptySub}>Create one and make it public from Team Settings.</Text>}
              </View>
            ) : (
              <View style={[styles.discoverList, wide && styles.discoverListWide]}>
                {filteredPublic.map(team => (
                  <View key={team.id} style={[styles.discoverCard, wide && styles.discoverCardHalf, mob && ms.discoverCard]}>
                    <TouchableOpacity
                      style={styles.discoverLeft}
                      onPress={() => router.push({ pathname: '/team-preview', params: { id: team.id } })}
                    >
                      {team.logo_url ? (
                        <Image source={{ uri: team.logo_url }} style={styles.discoverLogo} />
                      ) : (
                        <View style={styles.discoverLogoFallback}>
                          <RivalIcon name="groups" size={22} color={RivalColors.accentText} />
                        </View>
                      )}
                      <View style={styles.discoverInfo}>
                        <Text style={[styles.discoverName, mob && ms.discoverName]} numberOfLines={1}>{team.name}</Text>
                        {/* Headcount alone can't tell a living team from an
                            abandoned one — the week's activity can. */}
                        <Text style={styles.discoverMeta}>
                          {memberLabel(team.member_count)}
                          {team.sessions_last_7d > 0
                            ? ` · ${team.sessions_last_7d} ${team.sessions_last_7d === 1 ? 'activity' : 'activities'} this week`
                            : ' · Quiet this week'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {team.membership === 'pending' ? (
                      <View style={styles.pendingPill}>
                        <Text style={styles.pendingPillText}>Requested</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.joinBtn, mob && ms.joinBtn, joining === team.id && styles.joinBtnDisabled]}
                        onPress={() => join(team.id)}
                        disabled={joining === team.id}
                      >
                        <BusyText busy={!!(joining === team.id)} style={[styles.joinBtnText, mob && ms.joinBtnText]}>{joining === team.id ? 'Sending…' : mob ? 'Request' : 'Request to join'}</BusyText>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// Uniform "My Teams" grid card (stitch-export-19 layout): fixed-size card
// with a crest slot, a status pill (hero stat or member count), the team
// name, a 2-up members/training metric row, and an earned-hours footer — one
// named, memorable signal per card ("Emma logged a Run") rather than a stack
// of counts.
function TeamGridCard({
  team, wide, members, fallbackIconName, onPress, onTogglePin,
}: {
  team: TeamRow;
  wide: boolean;
  members: string;
  fallbackIconName: RivalIconName;
  onPress: () => void;
  onTogglePin: () => void;
}) {
  const earnedHours = team.together?.hours ?? 0;
  const pillText = team.heroStat?.text ?? `${members}`;
  const pillIcon = team.heroStat?.icon ?? 'groups';

  // Web-only reveal: the crest is the resting state, everything else fades
  // in on hover. Native has no hover concept, so it always shows content.
  const [hovered, setHovered] = useState(false);
  const showContent = Platform.OS !== 'web' || hovered;
  const hoverHandlers = Platform.OS === 'web'
    ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
    : {};

  return (
    <TouchableOpacity
      style={[styles.gridCard, wide && styles.gridCardWide, team.pinned && styles.gridCardPinned, hovered && styles.gridCardHovered]}
      onPress={onPress}
      activeOpacity={0.85}
      {...(hoverHandlers as any)}
    >
      {team.logo_url ? (
        <>
          <Image source={{ uri: team.logo_url }} style={styles.gridCardBg} resizeMode="cover" />
          {showContent && <View style={styles.gridCardBgScrim} />}
        </>
      ) : (
        !showContent && (
          <View style={styles.gridCrestResting}>
            <RivalIcon name={fallbackIconName} size={44} color={RivalColors.accentText} />
          </View>
        )
      )}

      {/* Resting-state CTA — only for genuinely unread chat, which actually
          clears (opening the team's Chat tab marks it read). heroStat
          ("New PB this week" etc.) has no read/dismiss state of its own, so
          it can't drive this — it'd never go away. */}
      {!showContent && !!team.unreadFrom && (
        <View style={styles.restingNotifDot}>
          <RivalIcon name="notifications" size={13} color="#1A1A1A" />
        </View>
      )}

      {showContent && (
        <>
          {team.pinned && (
            <View style={styles.pinnedRibbon}>
              <Text style={styles.pinnedRibbonText}>PINNED</Text>
            </View>
          )}
          <View style={styles.gridCardTop}>
            {!team.logo_url && (
              <View style={styles.gridCrestFallback}>
                <RivalIcon name={fallbackIconName} size={26} color={RivalColors.accentText} />
              </View>
            )}
            <View style={[styles.gridTopRight, !team.logo_url && { marginLeft: 'auto' }]}>
              <TouchableOpacity
                style={styles.pinBtnGrid}
                onPress={(e) => { e.stopPropagation?.(); onTogglePin(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <RivalIcon name="pin" size={14} color={team.pinned ? RivalColors.accentText : RivalColors.textSecondary} />
              </TouchableOpacity>
              {!!team.unreadFrom && (
                <View style={styles.unreadBadge}>
                  <RivalIcon name="chat" size={11} color={RivalColors.onAccentFill} />
                  <Text style={styles.unreadBadgeText} numberOfLines={1}>
                    {team.unreadFrom}{team.unreadCount > 1 ? ` +${team.unreadCount - 1}` : ''}
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.gridCenterBlock}>
            <View style={styles.pillRow}>
              <RivalIcon name={pillIcon} size={12} color={RivalColors.accentText} />
              <Text style={styles.pillText} numberOfLines={1}>{pillText.toUpperCase()}</Text>
            </View>
            <Text style={styles.gridName} numberOfLines={2}>{team.name.toUpperCase()}</Text>
          </View>

          <View style={styles.gridFooter}>
            <View>
              <Text style={styles.footerLabel}>MEMBERS</Text>
              <Text style={styles.footerValue}>{team.member_count}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.footerLabel}>EARNED</Text>
              <Text style={styles.footerEarned}>{earnedHours}h</Text>
            </View>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  scrim: { position: 'fixed' as any, top: 0, left: 0, right: 0, height: '100vh' as any, backgroundColor: 'rgba(14,14,14,0.55)' },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 60, maxWidth: 1200, width: '100%', alignSelf: 'center' },

  toolRow: { gap: 12, marginBottom: 28 },
  toolRowWide: { flexDirection: 'row', alignItems: 'center' },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: RivalRadius.full, paddingHorizontal: 16, height: 44 },
  searchInput: { flex: 1, color: RivalColors.textPrimary, fontSize: 14, height: '100%' },
  actionBtns: { flexDirection: 'row', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: RivalRadius.full, paddingHorizontal: 16, height: 44 },
  actionBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontSize: 14, fontWeight: '700' },
  actionBtnGhost: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: `${RivalColors.accentFill}66`, borderRadius: RivalRadius.full, paddingHorizontal: 16, height: 44 },
  actionBtnGhostText: { color: RivalColors.accentText, fontSize: 14, fontWeight: '700' },

  loading: { color: RivalColors.textSecondary, textAlign: 'center', marginTop: 40 },

  sectionTitle: { ...RivalType.titleMd, color: RivalColors.textPrimary, marginBottom: 4, marginTop: 8 },
  sectionTitleCentered: { textAlign: 'center', fontSize: 22, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  sectionSub: { fontSize: 13, color: RivalColors.textSecondary, marginBottom: 14, textAlign: 'center' },

  emptyBox: { alignItems: 'center', gap: 8, paddingVertical: 36, marginBottom: 24, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RivalRadius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  emptyText: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  emptySub: { fontSize: 13, color: RivalColors.textSecondary },

  // My Teams grid cards (stitch-export-19 layout) — uniform size, no photo
  // background, crest slot + status pill + name + metrics + footer.
  teamGrid: { gap: 14, marginBottom: 28, marginTop: 10 },
  teamGridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCard: { borderRadius: RivalRadius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)', padding: 18, minHeight: 260, position: 'relative', overflow: 'hidden', ...(Platform.OS === 'web' ? { transitionProperty: 'transform, box-shadow', transitionDuration: '150ms', transitionTimingFunction: 'ease' } as any : {}) },
  gridCardHovered: { transform: [{ scale: 1.03 }], ...(Platform.OS === 'web' ? { boxShadow: '0 12px 28px rgba(0,0,0,0.35)' } as any : {}) },
  // flexGrow: 0 keeps every card the same size regardless of row count — a
  // team's crest photo (background-cover) was cropping badly when a
  // near-empty row let flexGrow stretch a card much wider than tall.
  gridCardWide: { flexBasis: '31%', flexGrow: 0, minWidth: 280 },
  gridCardPinned: { borderColor: `${RivalColors.accentFill}66`, backgroundColor: 'rgba(217,119,87,0.06)' },
  gridCardBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  gridCardBgScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,10,0.55)' },
  pinnedRibbon: { position: 'absolute', top: 0, right: 0, backgroundColor: RivalColors.accentFill, paddingHorizontal: 10, paddingVertical: 3, borderBottomLeftRadius: RivalRadius.DEFAULT, zIndex: 1 },
  pinnedRibbonText: { color: RivalColors.onAccentFill, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  gridCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  gridCrestFallback: { width: 48, height: 48, borderRadius: RivalRadius.DEFAULT, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  // Resting (un-hovered) state for teams with no crest — a big centered
  // glyph fills the card the same way a crest photo would.
  gridCrestResting: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  restingNotifDot: { position: 'absolute', top: 10, right: 10, width: 26, height: 26, borderRadius: RivalRadius.full, backgroundColor: '#FFC93C', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(0,0,0,0.35)' },
  gridTopRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pinBtnGrid: { width: 26, height: 26, borderRadius: RivalRadius.full, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  unreadBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: RivalRadius.full, paddingHorizontal: 9, paddingVertical: 4, maxWidth: 120 },
  unreadBadgeText: { color: RivalColors.onAccentFill, fontSize: 11, fontWeight: '800' },
  // A single frosted panel anchored to the bottom of the card — keeps the
  // crest artwork clear up top instead of text sitting dead-center on it.
  // Fills the space between the top row and the footer, so the team name
  // sits centered in the card regardless of content height.
  gridCenterBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pillText: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText, letterSpacing: 0.5 },
  // Letter-spacing borrowed from the RIVAL wordmark itself (RivalTopNav) —
  // makes the team name read as a title, not just bold body text.
  gridName: { fontSize: 20, fontWeight: '800', letterSpacing: 1, color: RivalColors.textPrimary, textAlign: 'center' },
  gridFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  footerLabel: { fontSize: 10, fontWeight: '700', color: RivalColors.textSecondary, letterSpacing: 0.5, marginBottom: 3 },
  footerEarned: { fontSize: 26, fontWeight: '800', color: RivalColors.accentText },
  footerValue: { fontSize: 26, fontWeight: '800', color: RivalColors.textPrimary },

  joinCard: { borderRadius: RivalRadius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, minHeight: 260 },
  joinCardIcon: { width: 52, height: 52, borderRadius: RivalRadius.full, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  joinCardTitle: { fontSize: 16, fontWeight: '700', color: RivalColors.textPrimary },
  joinCardSub: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },

  // Discover cards
  joinError: { color: '#ffb4ab', fontSize: 13, marginBottom: 10 },
  discoverList: { gap: 10, marginTop: 4 },
  discoverListWide: { flexDirection: 'row', flexWrap: 'wrap' },
  discoverCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: RivalRadius.md, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  discoverCardHalf: { flexBasis: '48%', flexGrow: 1, minWidth: 300 },
  discoverLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  discoverInfo: { flexShrink: 1 },
  discoverLogo: { width: 44, height: 44, borderRadius: RivalRadius.DEFAULT },
  discoverLogoFallback: { width: 44, height: 44, borderRadius: RivalRadius.DEFAULT, backgroundColor: `${RivalColors.accentFill}22`, alignItems: 'center', justifyContent: 'center' },
  discoverName: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  discoverMeta: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  joinBtn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: RivalRadius.full, paddingVertical: 8, paddingHorizontal: 14 },
  joinBtnDisabled: { opacity: 0.5 },
  joinBtnText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontWeight: '800', fontSize: 13 },
  pendingPill: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RivalRadius.full, paddingVertical: 8, paddingHorizontal: 14 },
  pendingPillText: { color: RivalColors.textSecondary, fontWeight: '700', fontSize: 13 },
});

// Phone only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  sectionTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 26, fontWeight: '700', textTransform: 'none', letterSpacing: 0 },
  discoverCard: { backgroundColor: 'rgba(29,23,20,0.88)', borderColor: RivalWarm.cardBorder, borderRadius: 16 },
  discoverName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 17 },
  // Only one gradient pill per screen (Create Team); a row action is quiet.
  joinBtn: { backgroundColor: 'transparent', ...RivalButtonColors.noGradient, borderWidth: 1, borderColor: 'rgba(255,209,190,0.28)' },
  joinBtnText: { color: RivalColors.accentText },
});

// Phone: the blend.
const pm = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: {
    flex: 1, minWidth: 0, padding: 0, color: '#fff', fontSize: 15,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  tiles: { flexDirection: 'row', gap: 8 },
  muted: { fontSize: 12.5, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 20 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyText: { flex: 1, fontSize: 13, lineHeight: 18, color: RivalColors.textSecondary },
  list: { paddingVertical: 0, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  crest: { width: 40, height: 40, borderRadius: 20, backgroundColor: RivalColors.surfaceContainer, borderWidth: 1, borderColor: RivalColors.surfaceBright },
  crestFallback: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 16, fontWeight: '700', color: '#fff' },
  meta: { fontSize: 12, color: RivalColors.textSecondary },
  request: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)' },
  requestText: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  requested: { fontSize: 12.5, fontWeight: '600', color: RivalColors.textSecondary },
});
