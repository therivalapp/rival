import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { notify } from '../lib/notify';
import { copyText } from '../lib/clipboard';
import { formatDisplayName, formatTeamName } from '../lib/identity';
import { RivalBackButton } from '../components/rival/RivalBackButton';
import { RivalTopNav } from '../components/rival/RivalTopNav';
import { RivalIcon } from '../components/rival/RivalIcon';
import { SessionCard } from '../components/rival/SessionCard';
import { PlanSessionSheet, EditableSession } from '../components/rival/PlanSessionSheet';
import { RivalColors, RivalSerifFamily, RivalButtonColors } from '../constants/rivalTheme';
import { GreyPageHead, GreySegment, GREY_PAGE_BG, rb } from '../components/rival/RivalGreySheet';
import { sidePageWide } from '../constants/breakpoints';

// Every planned activity for one team, upcoming and past. Team Hub's Coming
// Up shows the next three; its "See all" used to fall through to the old team
// page. This is that list rebuilt with the same cards as the chat and Team Hub.

// Same rule as chat.tsx and team-hub.tsx: an activity stays "upcoming" for 12
// hours after it starts, since activities carry no duration.
const SESSION_GRACE_MS = 12 * 60 * 60 * 1000;

type Row = {
  id: string; user_id: string; activity_type: string | null; body: string | null;
  scheduled_at: string | null; location: string | null;
};
type Member = { user_id: string; users: { display_name: string | null } | null };

export default function TeamSessionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [rsvps, setRsvps] = useState<Record<string, string[]>>({});
  const [view, setView] = useState<'upcoming' | 'history'>('upcoming');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [editing, setEditing] = useState<EditableSession | null>(null);
  // Phone: the RIVAL look (warm page, gradient on the chosen tab).
  const { width } = useWindowDimensions();
  const mob = !sidePageWide(width);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: { user } }, { data: league }, { data: memberRows }, { data: sessions }] = await Promise.all([
      getAuthUser(),
      supabase.from('leagues').select('name').eq('id', id).maybeSingle(),
      supabase.from('league_members').select('user_id, users(display_name)').eq('league_id', id).eq('status', 'active'),
      supabase
        .from('league_messages')
        .select('id, user_id, activity_type, body, scheduled_at, location')
        .eq('league_id', id)
        .eq('kind', 'session')
        .order('scheduled_at', { ascending: true })
        .limit(300),
    ]);
    if (user) setCurrentUserId(user.id);
    setTeamName(league?.name ? formatTeamName(league.name) : '');
    setMembers((memberRows as any) ?? []);
    const list = (sessions ?? []) as Row[];
    setRows(list);

    if (list.length > 0) {
      const { data: r } = await supabase.from('league_session_rsvps').select('message_id, user_id').in('message_id', list.map(x => x.id));
      const map: Record<string, string[]> = {};
      (r ?? []).forEach((x: any) => { (map[x.message_id] ||= []).push(x.user_id); });
      setRsvps(map);
    } else {
      setRsvps({});
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);
const { scrollProps: pullProps, indicator: pullIndicator } = usePullToRefresh(() => load());


  const nameFor = useCallback((userId: string) => {
    const m = members.find(mm => mm.user_id === userId);
    return m?.users ? formatDisplayName(m.users) : 'Athlete';
  }, [members]);

  const isPast = (r: Row) => !!r.scheduled_at && new Date(r.scheduled_at).getTime() + SESSION_GRACE_MS < Date.now();

  const upcoming = useMemo(() => rows.filter(r => !isPast(r)), [rows]);
  // Most recent first — the one that just happened is the one you look for.
  const history = useMemo(() => rows.filter(isPast).reverse(), [rows]);
  const shown = view === 'upcoming' ? upcoming : history;

  async function toggleRsvp(messageId: string) {
    if (!currentUserId) return;
    const joined = (rsvps[messageId] || []).includes(currentUserId);
    const { error } = joined
      ? await supabase.from('league_session_rsvps').delete().eq('message_id', messageId).eq('user_id', currentUserId)
      : await supabase.from('league_session_rsvps').insert({ message_id: messageId, user_id: currentUserId });
    if (error) { notify("Couldn't update RSVP", error.message); return; }
    setRsvps(prev => ({
      ...prev,
      [messageId]: joined ? (prev[messageId] || []).filter(u => u !== currentUserId) : [...(prev[messageId] || []), currentUserId],
    }));
  }

  async function copyLocation(rowId: string, text: string) {
    if (!(await copyText(text))) return;
    setCopiedId(rowId);
    setTimeout(() => setCopiedId(cur => (cur === rowId ? null : cur)), 1600);
  }

  return (
    <View style={{ flex: 1, backgroundColor: mob ? GREY_PAGE_BG : RivalColors.surfaceLow }}>
      <SafeAreaView style={[{ flex: 1 }, mob && rb.column]} edges={['top', 'left', 'right']}>
        <RivalTopNav active="teams" hideBar />
        {mob ? (
          // Phone: the blend. Team name over the title; one segmented
          // toggle; planning is the button under the list, not a +.
          <View style={ms.top}>
            <GreyPageHead
              kicker={(teamName || 'Team').toUpperCase()}
              title="Planned activities"
              onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/team-hub', params: { id } }))}
            />
            <GreySegment
              options={[
                { value: 'upcoming' as const, label: `Upcoming (${upcoming.length})` },
                { value: 'history' as const, label: `History (${history.length})` },
              ]}
              value={view}
              onChange={setView}
            />
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <RivalBackButton
                onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/team-hub', params: { id } }))}
                color={RivalColors.accentFill}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title}>Planned activities</Text>
                {!!teamName && <Text style={styles.sub} numberOfLines={1}>{teamName}</Text>}
              </View>
              <TouchableOpacity style={styles.planBtn} onPress={() => { setEditing(null); setPlanning(true); }} accessibilityLabel="Plan an activity">
                <RivalIcon name="add" size={18} color={RivalColors.accentText} />
              </TouchableOpacity>
            </View>

            <View style={styles.segment}>
              {(['upcoming', 'history'] as const).map(v => (
                <TouchableOpacity key={v} style={[styles.segBtn, view === v && styles.segBtnOn]} onPress={() => setView(v)}>
                  <Text style={[styles.segText, view === v && styles.segTextOn]}>
                    {v === 'upcoming' ? `Upcoming (${upcoming.length})` : `History (${history.length})`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={RivalColors.accentFill} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.list} {...pullProps}>
            {pullIndicator}
            {shown.length === 0 ? (
              mob ? (
                <View style={[rb.card, ms.empty]}>
                  <View style={rb.badge}>
                    <RivalIcon name="calendar" size={16} color={RivalColors.accentText} />
                  </View>
                  <Text style={ms.emptyText}>
                    {view === 'upcoming' ? 'No upcoming activities. Plan one and teammates can join.' : 'No past activities yet.'}
                  </Text>
                </View>
              ) : (
              <Text style={styles.empty}>
                {view === 'upcoming' ? 'No upcoming activities.' : 'No past activities yet.'}
              </Text>
              )
            ) : shown.map(r => (
              <SessionCard
                key={r.id}
                session={r}
                attendeeIds={rsvps[r.id] || []}
                currentUserId={currentUserId}
                nameFor={nameFor}
                past={view === 'history'}
                locationCopied={copiedId === r.id}
                onCopyLocation={() => copyLocation(r.id, r.location ?? '')}
                onEdit={() => { setEditing(r); setPlanning(true); }}
                onToggleRsvp={() => toggleRsvp(r.id)}
              />
            ))}
            {mob && view === 'upcoming' ? (
              <TouchableOpacity style={ms.planBtn} onPress={() => { setEditing(null); setPlanning(true); }} activeOpacity={0.85} accessibilityRole="button">
                <Text style={ms.planBtnText}>Plan an activity</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>

      <PlanSessionSheet
        visible={planning}
        leagueId={id as string}
        currentUserId={currentUserId}
        editing={editing}
        onClose={() => { setPlanning(false); setEditing(null); }}
        onPosted={load}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, color: '#fff' },
  sub: { fontSize: 13, color: RivalColors.textSecondary, marginTop: 1 },
  planBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${RivalColors.accentFill}1f`, borderWidth: 1, borderColor: `${RivalColors.accentFill}44`,
  },
  segment: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, padding: 4, borderRadius: 999,
    backgroundColor: RivalColors.surfaceContainer, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: RivalColors.surfaceBright },
  segText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.textSecondary },
  segTextOn: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Clears the floating tab pill.
  list: { paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  empty: { fontSize: 14, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 40 },
});

// Phone only — the blend (see RivalGreySheet's rb).
const ms = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingBottom: 12, gap: 4 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyText: { flex: 1, fontSize: 13, lineHeight: 18, color: RivalColors.textSecondary },
  planBtn: { paddingVertical: 14, borderRadius: 999, alignItems: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  planBtnText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
});
