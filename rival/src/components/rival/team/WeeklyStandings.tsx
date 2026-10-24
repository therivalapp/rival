import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { formatDisplayName } from '../../../lib/identity';
import { RivalColors, RivalSerifFamily } from '../../../constants/rivalTheme';
import { RivalIcon } from '../RivalIcon';
import { RivalAvatar } from '../RivalAvatar';
import { useSnapState } from '../../../lib/snapState';

// The team's weekly leaderboard, with history: step back week by week, see
// who moved up or down since the week before, and who was last week's MVP.
// Ported from the old team page. It doubles as the member list on Team Hub's
// Members tab — every member appears, ranked, with Encourage and Challenge
// one tap away and their profile a tap on the row.

type Member = { user_id: string; role?: string; users: { display_name: string | null; avatar_url?: string | null } | null };

type Row = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  score: number;
  change: number | null;
};

// Monday-start weeks, same boundary as the rest of the app's leaderboards.
function weekWindow(offset: number) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  monday.setHours(0, 0, 0, 0);
  const start = new Date(monday);
  start.setDate(monday.getDate() + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

function weekLabel(offset: number): string {
  if (offset === 0) return 'This Week';
  if (offset === -1) return 'Last Week';
  const { start, end } = weekWindow(offset);
  const last = new Date(end);
  last.setDate(last.getDate() - 1);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, opts)} – ${last.toLocaleDateString(undefined, opts)}`;
}

const MEDAL = [RivalColors.accentGold, '#C9CED6', '#C98B5A'];

export function WeeklyStandings({
  members,
  currentUserId,
  encouragedIds,
  onOpenProfile,
  onEncourage,
  onChallenge,
}: {
  members: Member[];
  currentUserId: string;
  encouragedIds: Set<string>;
  onOpenProfile: (userId: string) => void;
  onEncourage: (userId: string, name: string) => void;
  onChallenge: (userId: string, name: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const memberKey = members.map(m => m.user_id).join(',');
  // Remembered per team and week (lib/snapState.ts), so opening Members again
  // shows the standings at once and refreshes behind them (2026-10-21).
  const k = `standings.${memberKey}.${offset}`;
  const [rows, setRows] = useSnapState<Row[]>(`${k}.rows`, []);
  const [mvpId, setMvpId] = useSnapState<string | null>(`${k}.mvp`, null);
  const [loading, setLoading] = useSnapState(`${k}.loading`, true);

  const firstLoad = useRef(true);
  const load = useCallback(async () => {
    const ids = members.map(m => m.user_id);
    if (ids.length === 0) { setRows([]); setLoading(false); return; }
    // Switching weeks shows the spinner as before; only the first load after
    // opening the tab draws the remembered standings.
    if (!firstLoad.current) setLoading(true);
    firstLoad.current = false;
    const { start, end } = weekWindow(offset);
    const prev = weekWindow(offset - 1);
    // Two queries for the whole team, grouped in memory — not two per member.
    const [weekRes, prevRes] = await Promise.all([
      supabase.from('activities').select('user_id, effort_score').in('user_id', ids)
        .gte('started_at', start.toISOString()).lt('started_at', end.toISOString()),
      supabase.from('activities').select('user_id, effort_score').in('user_id', ids)
        .gte('started_at', prev.start.toISOString()).lt('started_at', prev.end.toISOString()),
    ]);
    const sum = (data: any[] | null) => {
      const acc: Record<string, number> = {};
      (data || []).forEach((r: any) => { acc[r.user_id] = (acc[r.user_id] || 0) + (r.effort_score || 0); });
      return acc;
    };
    const week = sum(weekRes.data);
    const before = sum(prevRes.data);

    // Rank movement compares against the previous week's order, among those
    // who actually scored then — someone who didn't train last week has no
    // "previous rank" to move from.
    const prevOrder = [...ids].filter(id => (before[id] || 0) > 0).sort((a, b) => before[b] - before[a]);
    const prevRank: Record<string, number> = {};
    prevOrder.forEach((id, i) => { prevRank[id] = i; });
    setMvpId(prevOrder[0] ?? null);

    const list: Row[] = members.map(m => ({
      userId: m.user_id,
      name: m.users ? formatDisplayName(m.users as any) : 'Athlete',
      avatarUrl: m.users?.avatar_url ?? null,
      isAdmin: m.role === 'admin',
      score: Math.round(week[m.user_id] || 0),
      change: null,
    }));
    list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    list.forEach((r, i) => {
      const was = prevRank[r.userId];
      r.change = r.score > 0 && was !== undefined ? was - i : null;
    });
    setRows(list);
    setLoading(false);
    // memberKey stands in for `members` so a re-render with the same people
    // doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, memberKey]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={s.wrap}>
      <View style={s.weekNav}>
        <TouchableOpacity style={s.weekArrow} onPress={() => setOffset(o => o - 1)} accessibilityLabel="Previous week">
          <RivalIcon name="chevronLeft" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.weekLabel}>{weekLabel(offset)}</Text>
        <TouchableOpacity
          style={[s.weekArrow, offset === 0 && s.weekArrowOff]}
          onPress={() => setOffset(o => Math.min(0, o + 1))}
          disabled={offset === 0}
          accessibilityLabel="Next week"
        >
          <RivalIcon name="chevronRight" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={[s.card, loading && { opacity: 0.6 }]}>
        {rows.map((r, i) => {
          const me = r.userId === currentUserId;
          const encouraged = encouragedIds.has(r.userId);
          return (
            <TouchableOpacity
              key={r.userId}
              style={[s.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}
              activeOpacity={0.8}
              onPress={() => onOpenProfile(r.userId)}
              accessibilityLabel={`Open ${r.name}'s profile`}
            >
              <View style={[s.rank, i < 3 && r.score > 0 && { borderColor: MEDAL[i], backgroundColor: `${MEDAL[i]}22` }]}>
                <Text style={[s.rankText, i < 3 && r.score > 0 && { color: MEDAL[i] }]}>{i + 1}</Text>
              </View>
              <RivalAvatar uri={r.avatarUrl} name={r.name} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.nameRow}>
                  <Text style={[s.name, me && { color: RivalColors.accentText }]} numberOfLines={1}>{r.name}</Text>
                  {r.userId === mvpId && offset === 0 && (
                    <View style={s.mvp}>
                      <RivalIcon name="crown" size={11} color={RivalColors.accentGold} />
                      <Text style={s.mvpText}>MVP</Text>
                    </View>
                  )}
                </View>
                <View style={s.metaRow}>
                  <Text style={s.score}>{r.score.toLocaleString()} Effort</Text>
                  {r.change !== null && r.change !== 0 && (
                    <Text style={[s.change, { color: r.change > 0 ? RivalColors.tertiary : '#ff9b8f' }]}>
                      {r.change > 0 ? `▲ ${r.change}` : `▼ ${Math.abs(r.change)}`}
                    </Text>
                  )}
                  {r.isAdmin && <Text style={s.admin}>Admin</Text>}
                </View>
              </View>
              {/* Only for teammates, and only this week — you can't cheer on
                  or challenge a week that's already over. */}
              {!me && offset === 0 && (
                <View style={s.actions}>
                  <TouchableOpacity
                    style={[s.action, encouraged && s.actionDone]}
                    onPress={() => onEncourage(r.userId, r.name)}
                    disabled={encouraged}
                    accessibilityLabel={encouraged ? `Encouraged ${r.name} today` : `Encourage ${r.name}`}
                  >
                    <RivalIcon name={encouraged ? 'check' : 'fire'} size={17} color={encouraged ? RivalColors.textSecondary : RivalColors.accentText} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.action}
                    onPress={() => onChallenge(r.userId, r.name)}
                    accessibilityLabel={`Challenge ${r.name}`}
                  >
                    <RivalIcon name="race" size={17} color={RivalColors.accentText} />
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
        {!loading && rows.length === 0 && <Text style={s.empty}>No members yet.</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekArrow: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  weekArrowOff: { opacity: 0.3 },
  weekLabel: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: '#fff' },
  card: {
    backgroundColor: '#1c1a19', borderRadius: 20, borderWidth: 1, borderColor: `${RivalColors.accentFill}33`,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rank: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  rankText: { fontSize: 13, fontWeight: '800', color: RivalColors.textSecondary },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: '#fff' },
  mvp: {
    flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
    backgroundColor: `${RivalColors.accentGold}1f`,
  },
  mvpText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: RivalColors.accentGold },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  score: { fontSize: 12.5, color: RivalColors.textSecondary },
  change: { fontSize: 11.5, fontWeight: '800' },
  admin: { fontSize: 11, fontWeight: '700', color: RivalColors.textSecondary },
  actions: { flexDirection: 'row', gap: 6 },
  // 40px circles: big enough for a thumb, small enough for two in a row.
  action: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${RivalColors.accentFill}18`, borderWidth: 1, borderColor: `${RivalColors.accentFill}33`,
  },
  actionDone: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' },
  empty: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 20 },
});
