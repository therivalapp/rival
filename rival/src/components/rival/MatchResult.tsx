import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { supabase } from '../../lib/supabase';
import { statFamily, type MatchResult } from '../../lib/activityStats';

// A match result as others see it: who was played and the sets, never won or
// lost (Ricky, 2026-11-02: "Saying who you played is enough"). The outcome is
// still stored; nothing here reads it.

/** Racket and team activities only; anything else keeps its usual card. */
export function matchFrom(activityType: string, stats: any): MatchResult | null {
  const f = statFamily(activityType);
  if (f !== 'racket' && f !== 'team') return null;
  const r = stats?.result as MatchResult | undefined;
  return r && (r.opponent?.trim() || r.sets?.length) ? r : null;
}

export const setsText = (sets: [number, number][]) => sets.map(([a, b]) => `${a}-${b}`).join('   ');

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const initials = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/** The band across the top of a feed card's numbers. */
export function MatchBand({ result }: { result: MatchResult }) {
  const them = result.opponent?.trim();
  return (
    <View style={s.band}>
      <Text style={s.played} numberOfLines={1}>
        {them ? <>Played <Text style={s.playedName}>{firstName(them)}</Text></> : 'Match'}
      </Text>
      {result.sets.length ? <Text style={s.sets}>{setsText(result.sets)}</Text> : null}
    </View>
  );
}

type PageMatch = { result: MatchResult; me: string; confirmed: 'yes' | 'waiting' | null };

/** Loads what the activity page's card needs: the result, the owner's name
 *  and, on the owner's copy, whether the opponent has confirmed. */
export function usePageMatch(activityId: string, activityType: string, sharedCopy: boolean): PageMatch | null {
  const [match, setMatch] = useState<PageMatch | null>(null);
  useEffect(() => {
    setMatch(null);
    const f = statFamily(activityType);
    if (!activityId || (f !== 'racket' && f !== 'team')) return;
    let live = true;
    (async () => {
      const { data } = await supabase.from('activities').select('user_id, stats').eq('id', activityId).maybeSingle();
      const result = matchFrom(activityType, data?.stats);
      if (!live || !data || !result) return;
      const [{ data: owner }, tag] = await Promise.all([
        supabase.from('users').select('display_name').eq('id', data.user_id).maybeSingle(),
        !sharedCopy && result.opponentId
          ? supabase.from('activity_participants').select('status').eq('activity_id', activityId).eq('user_id', result.opponentId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!live) return;
      const status = (tag as any)?.data?.status;
      setMatch({
        result,
        me: firstName(owner?.display_name || 'You'),
        confirmed: status === 'accepted' ? 'yes' : status === 'pending' ? 'waiting' : null,
      });
    })();
    return () => { live = false; };
  }, [activityId, activityType, sharedCopy]);
  return match;
}

/** The activity page's card: who played, each set in order, and whether the
 *  opponent has confirmed. */
export function MatchCard({ match }: { match: PageMatch }) {
  const { result, me, confirmed } = match;
  const them = result.opponent?.trim() || 'Opponent';
  return (
    <View style={s.card}>
      <Text style={[s.played, s.cardHead]} numberOfLines={1}>Played <Text style={s.playedName}>{them}</Text></Text>
      {result.sets.length ? [me, firstName(them)].map((name, side) => (
        <View key={side} style={s.row}>
          <View style={s.who}>
            <Text style={s.avatar}>{initials(side ? them : name)}</Text>
            <Text style={s.name} numberOfLines={1}>{name}</Text>
          </View>
          {result.sets.map((set, i) => <Text key={i} style={s.num}>{set[side]}</Text>)}
        </View>
      )) : null}
      {confirmed ? (
        <Text style={s.conf}>
          {confirmed === 'yes'
            ? <>{firstName(them)} <Text style={s.confLit}>confirmed</Text> · on their profile too</>
            : `Waiting for ${firstName(them)} to confirm`}
        </Text>
      ) : null}
    </View>
  );
}

const serif = { fontFamily: RivalSerifFamily, fontStyle: 'italic' as const, fontWeight: '700' as const, color: '#fff' };

const s = StyleSheet.create({
  band: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  played: { flex: 1, fontSize: 12.5, color: 'rgba(255,255,255,0.5)' },
  playedName: { color: '#fff', fontWeight: '700' },
  sets: { ...serif, fontSize: 16, letterSpacing: 0.3 },
  card: { marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: RivalColors.surfaceBright, paddingTop: 11, paddingHorizontal: 12, paddingBottom: 9 },
  cardHead: { paddingBottom: 9, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#4a4644', color: '#fff', fontSize: 9.5, fontWeight: '800', textAlign: 'center', lineHeight: 24, overflow: 'hidden' },
  name: { fontSize: 13.5, fontWeight: '800', color: '#fff', flexShrink: 1 },
  num: { ...serif, width: 30, textAlign: 'center', fontSize: 19 },
  conf: { marginTop: 6, fontSize: 11.5, color: '#a0a0a0' },
  confLit: { color: RivalColors.accentText, fontWeight: '700' },
});
