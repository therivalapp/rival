import { getMyTeamRows } from '../../lib/myTeams';
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, Image, TouchableOpacity, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { supabase, getAuthUser } from '../../lib/supabase';
import { formatTeamName } from '../../lib/identity';
import { RivalTopNav, RivalIcon, RivalWarm, rm } from '../../components/rival';
import { BREAKPOINT_WIDE_LAYOUT } from '../../constants/breakpoints';
import { getUnreadChats, latestMessageByLeague } from '../../lib/unreadChats';
import { RivalColors, RivalSerifFamily, RivalButtonColors } from '../../constants/rivalTheme';

// Same per-name color assignment as team-feed.tsx's team rail — kept as a
// local copy rather than shared, matching how timeAgo is already duplicated
// per-screen across this codebase instead of centralized.
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

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

type ThreadRow = {
  leagueId: string;
  name: string;
  logoUrl: string | null;
  lastBody: string | null;
  lastAt: string | null;
  lastIsMine: boolean;
  unread: boolean;
};

// The list as last shown, so coming back to Chat draws it at once and then
// refreshes, instead of starting from "Loading" every visit.
let lastThreads: { userId: string; rows: ThreadRow[] } | null = null;

export default function MessagesScreen() {
  const [threads, setThreads] = useState<ThreadRow[]>(() => lastThreads?.rows ?? []);
  const [loading, setLoading] = useState(() => !lastThreads);

  const load = useCallback(async () => {
    const { data: { user } } = await getAuthUser();
    if (!user) { setLoading(false); return; }
    if (lastThreads && lastThreads.userId !== user.id) { lastThreads = null; setThreads([]); }

    const teamRows = await getMyTeamRows(user.id).catch(() => []);
    const leagueIds = teamRows.map((m) => m.league_id);
    if (leagueIds.length === 0) {
      setThreads([]);
      lastThreads = { userId: user.id, rows: [] };
      setLoading(false);
      return;
    }

    const leagues = teamRows.map((r) => r.leagues).filter(Boolean) as Array<{ id: string; name: string; logo_url: string | null }>;
    const [lastByLeague, unread] = await Promise.all([
      // Just the newest message per team, not every message ever sent.
      latestMessageByLeague<{ league_id: string; user_id: string; body: string; created_at: string }>(leagueIds, 'league_id, user_id, body, created_at'),
      // Shared with the Chat tab's badge — a badge reading "2" over a list
      // showing three dots is worse than showing no badge at all.
      getUnreadChats(true),
    ]);


    const rows: ThreadRow[] = leagues
      .map((l) => {
        const last = lastByLeague.get(l.id);
        const isUnread = unread.byLeague[l.id] ?? false;
        return {
          leagueId: l.id,
          name: l.name,
          logoUrl: l.logo_url,
          lastBody: last?.body ?? null,
          lastAt: last?.created_at ?? null,
          lastIsMine: last?.user_id === user.id,
          unread: isUnread,
        };
      })
      .sort((a, b) => {
        if (!a.lastAt && !b.lastAt) return a.name.localeCompare(b.name);
        if (!a.lastAt) return 1;
        if (!b.lastAt) return -1;
        return b.lastAt.localeCompare(a.lastAt);
      });

    setThreads(rows);
    lastThreads = { userId: user.id, rows };
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Phone: the RIVAL look — warm page, team names in the serif.
  const { width } = useWindowDimensions();
  const mob = width < BREAKPOINT_WIDE_LAYOUT;

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.mBgFixed, mob && ms.bg]} />
      {mob && <Image source={SMOKE} style={ms.smoke} resizeMode="cover" />}
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <RivalTopNav active="chat" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={mob && ms.head}>
            <Text style={[styles.title, mob && ms.title]}>Messages</Text>
            {mob && !loading && threads.length > 0 && (
              <View style={ms.kicker}>
                <View style={[ms.rule, ms.ruleLeft]} />
                <Text style={ms.kickerText}>
                  {(() => {
                    const unreadCount = threads.filter((t) => t.unread).length;
                    return unreadCount > 0
                      ? `${unreadCount} unread · ${threads.length} ${threads.length === 1 ? 'team' : 'teams'}`
                      : `No unread · ${threads.length} ${threads.length === 1 ? 'team' : 'teams'}`;
                  })()}
                </Text>
                <View style={[ms.rule, ms.ruleRight]} />
              </View>
            )}
          </View>

          {loading ? (
            <Text style={styles.stateText}>Loading…</Text>
          ) : threads.length === 0 ? (
            <View style={[styles.emptyState, mob && [rm.card, ms.empty]]}>
              {mob ? (
                <View style={rm.iconCircle}><RivalIcon name="chat" size={20} color={RivalColors.accentText} /></View>
              ) : (
                <RivalIcon name="chat" size={28} color={RivalColors.accentText} />
              )}
              <Text style={[styles.emptyTitle, mob && ms.emptyTitle]}>No team chats yet</Text>
              <Text style={styles.emptyBody}>Join or create a team to message teammates.</Text>
              <TouchableOpacity style={mob ? [rm.primary, ms.emptyBtn] : styles.emptyBtn} onPress={() => router.push('/discover-leagues')}>
                <Text style={mob ? rm.primaryText : styles.emptyBtnText}>Find a team</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.list, mob && ms.list]}>
              {threads.map((t, i) => {
                const tint = tintFor(t.name);
                return (
                  <TouchableOpacity
                    key={t.leagueId}
                    style={[styles.row, mob && ms.row, mob && t.unread && ms.rowUnread, mob && rowIn(i)]}
                    onPress={() => router.push({ pathname: '/chat', params: { id: t.leagueId } })}
                  >
                    {t.logoUrl ? (
                      <Image source={{ uri: t.logoUrl }} style={[styles.avatar, mob && ms.crest, mob && t.unread && ms.crestUnread]} />
                    ) : (
                      <View style={[styles.avatarFallback, { backgroundColor: tint.bg }]}>
                        <Text style={[styles.avatarInitial, { color: tint.color }]}>{t.name[0]?.toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={styles.rowMain}>
                      <View style={styles.rowTop}>
                        <Text style={[styles.rowName, mob && ms.rowName, t.unread && styles.rowNameUnread]} numberOfLines={1}>
                          {formatTeamName(t.name)}
                        </Text>
                        {t.lastAt && <Text style={styles.rowTime}>{timeAgo(t.lastAt)}</Text>}
                      </View>
                      <Text style={[styles.rowPreview, t.unread && styles.rowPreviewUnread]} numberOfLines={1}>
                        {t.lastBody ? `${t.lastIsMine ? 'You: ' : ''}${t.lastBody}` : 'No messages yet.'}
                      </Text>
                    </View>
                    {t.unread && <View style={[styles.unreadDot, mob && ms.unreadDot]} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
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
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 48, gap: 16, width: '100%', maxWidth: 640, marginHorizontal: 'auto' },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22, fontWeight: '700', color: '#fff' },
  stateText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', marginTop: 40 },

  list: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  avatar: { width: 48, height: 48, borderRadius: 14 },
  avatarFallback: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 17, fontWeight: '800' },
  rowMain: { flex: 1, gap: 2, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowName: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.85)', flexShrink: 1 },
  rowNameUnread: { color: '#fff' },
  rowTime: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  rowPreview: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  rowPreviewUnread: { color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RivalColors.accentFill },

  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  emptyBody: { fontSize: 13, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
  emptyBtn: { marginTop: 8, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24 },
  emptyBtnText: { fontSize: 13, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
});

const SMOKE = require('../../../assets/images/backgrounds/optimized/podium-smoke.jpg');

// Rows ease in one after another when the list appears (web; the keyframe is
// in global.css). Skipped for anyone who has asked for reduced motion.
function rowIn(i: number): any {
  if (Platform.OS !== 'web') return null;
  return {
    animationName: 'rivalRowIn',
    animationDuration: '420ms',
    animationDelay: `${Math.min(i, 8) * 45}ms`,
    animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
    animationFillMode: 'both',
  };
}

// Phone only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  bg: {
    backgroundColor: RivalWarm.page,
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'radial-gradient(ellipse 120% 55% at 100% 0%, rgba(217,119,87,0.14) 0%, rgba(17,14,12,0) 60%), radial-gradient(ellipse 90% 45% at 0% 100%, rgba(255,181,158,0.06) 0%, rgba(17,14,12,0) 60%)' } as any)
      : {}),
  },
  // The same smoke as Home's Weekly Leader, faint, behind the heading only.
  smoke: {
    position: 'absolute', top: -60, left: 0, right: 0, height: 320, width: '100%', opacity: 0.16, pointerEvents: 'none',
    ...(Platform.OS === 'web'
      ? ({ maskImage: 'linear-gradient(to bottom, black 0%, black 40%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 40%, transparent 100%)' } as any)
      : {}),
  },
  head: { alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 30, lineHeight: 36, textAlign: 'center' },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kickerText: { fontSize: 11, fontWeight: '800', letterSpacing: 2.2, textTransform: 'uppercase', color: RivalColors.accentText },
  rule: { width: 36, height: 1 },
  ruleLeft: Platform.OS === 'web' ? ({ backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,181,158,0.55))' } as any) : { backgroundColor: 'rgba(255,181,158,0.4)' },
  ruleRight: Platform.OS === 'web' ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,181,158,0.55), transparent)' } as any) : { backgroundColor: 'rgba(255,181,158,0.4)' },
  list: { gap: 10 },
  row: {
    borderWidth: 1, borderBottomWidth: 1, borderColor: RivalWarm.cardBorder, borderBottomColor: RivalWarm.cardBorder, backgroundColor: RivalWarm.card,
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12,
  },
  // Unread: the card lifts a little — a salmon edge and a faint warm wash.
  rowUnread: {
    borderColor: 'rgba(255,181,158,0.35)', borderBottomColor: 'rgba(255,181,158,0.35)',
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'linear-gradient(100deg, rgba(217,119,87,0.12) 0%, rgba(29,23,20,0) 60%)', boxShadow: '0 0 18px rgba(217,119,87,0.12)' } as any)
      : {}),
  },
  crest: { borderWidth: 1, borderColor: RivalWarm.cardBorder },
  crestUnread: { borderColor: 'rgba(255,181,158,0.6)' },
  unreadDot: {
    width: 10, height: 10, borderRadius: 5,
    ...(Platform.OS === 'web' ? ({ boxShadow: '0 0 8px rgba(217,119,87,0.8)' } as any) : {}),
  },
  rowName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 17 },
  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 20 },
  emptyBtn: { alignSelf: 'stretch', marginTop: 8 },
});
