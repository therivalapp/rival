import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Animated, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { RivalColors } from '../../constants/rivalTheme';
import { getAuthUser, supabase } from '../../lib/supabase';
import { teamSharingAgreed } from '../../lib/stravaSharing';
import { formatTeamName } from '../../lib/identity';
import { GreyNote, GreyPrimary, GreySheet } from './RivalGreySheet';
import { RivalIcon } from './RivalIcon';

// Teams on a profile (Ricky, 2026-11-02, B: design/teams-tiles-vs-dropdown.jpg):
// one short row that opens into the list, so the page stays short. On a
// teammate's profile, a public team you're not in can be asked to join
// (design/ask-to-join-mockup.png). Private teams you're not in never show:
// profile_teams() leaves them out.

type ProfileTeam = {
  id: string;
  name: string;
  logo_url: string | null;
  description: string | null;
  is_private: boolean;
  member_count: number;
  effort_this_week: number;
  role: string | null;
  viewer_status: 'active' | 'pending' | 'declined' | null;
};

const CARD = '#232120';
const members = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`;

export function ProfileTeams({ userId, isOwn, name, label }: {
  userId: string;
  isOwn: boolean;
  /** The person's name, for the pop-up's kicker. */
  name: string;
  label: (text: string) => React.ReactNode;
}) {
  const [teams, setTeams] = useState<ProfileTeam[] | null>(null);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<ProfileTeam | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    supabase.rpc('profile_teams', { p_user_id: userId }).then(({ data, error: e }) => {
      if (live) setTeams(e ? [] : ((data ?? []) as ProfileTeam[]));
    });
    return () => { live = false; };
  }, [userId]);

  const openTeam = (t: ProfileTeam) => {
    if (t.viewer_status === 'active') router.push({ pathname: '/team-hub', params: { id: t.id } });
    else router.push({ pathname: '/team-preview', params: { id: t.id } });
  };

  async function ask() {
    if (!asking) return;
    if (!(await teamSharingAgreed())) { setAsking(null); return; }
    const { data: { user } } = await getAuthUser();
    if (!user) return;
    setSending(true);
    setError(null);
    const { error: e } = await supabase.from('league_members').insert({ league_id: asking.id, user_id: user.id, role: 'member', status: 'pending' });
    setSending(false);
    if (e) { setError('The request could not be sent. Try again.'); return; }
    const team = asking;
    setTeams((cur) => (cur ?? []).map((t) => (t.id === team.id ? { ...t, viewer_status: 'pending' } : t)));
    setAsking(null);
    setSent(`Request sent to ${formatTeamName(team.name)}.`);
  }

  if (!teams || teams.length === 0) return null;
  const count = teams.length;
  const summary = isOwn ? `${count} ${count === 1 ? 'team' : 'teams'}` : `In ${count} ${count === 1 ? 'team' : 'teams'}`;

  const right = (t: ProfileTeam) => {
    if (isOwn) return <Text style={s.quiet}>{t.role === 'admin' ? 'Admin' : 'Member'}</Text>;
    if (t.viewer_status === 'active') return <Text style={s.quiet}>Your team</Text>;
    if (t.viewer_status === 'pending') return <View style={[s.pill, s.pillAsked]}><Text style={s.pillAskedText}>Asked</Text></View>;
    if (t.viewer_status === 'declined' || t.is_private) return null;
    return (
      <TouchableOpacity style={s.pill} onPress={() => { setError(null); setAsking(t); }} accessibilityRole="button" accessibilityLabel={`Ask to join ${formatTeamName(t.name)}`}>
        <Text style={s.pillText}>Ask to join</Text>
      </TouchableOpacity>
    );
  };

  const firstName = name.split(' ')[0];
  const sheet = asking ? (
    <View style={s.layer}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setAsking(null)} accessibilityLabel="Not now" />
      <GreySheet
        kicker={`${firstName}'s team`.toUpperCase()}
        title={`Ask to join ${formatTeamName(asking.name)}`}
        onClose={() => setAsking(null)}
        footer={(
          <View style={{ gap: 4 }}>
            <GreyPrimary label="Ask to join" busy={sending} onPress={ask} />
            <TouchableOpacity onPress={() => setAsking(null)} disabled={sending} style={s.later} accessibilityRole="button"><Text style={s.laterText}>Not now</Text></TouchableOpacity>
          </View>
        )}
      >
        <View style={s.sheetBody}>
          <Crest uri={asking.logo_url} size={76} radius={18} />
          <View style={s.facts}>
            <View style={s.fact}><RivalIcon name="groups" size={15} color={RivalColors.accentText} /><Text style={s.factText}>{members(asking.member_count)}</Text></View>
            <View style={s.fact}><RivalIcon name="bolt" size={15} color={RivalColors.accentText} /><Text style={s.factText}>{Math.round(asking.effort_this_week).toLocaleString()} Effort this week</Text></View>
          </View>
          {asking.description ? <View style={s.about}><Text style={s.aboutText}>{asking.description}</Text></View> : null}
          <View style={{ alignSelf: 'stretch' }}><GreyNote>You'll be notified when your request is accepted or declined.</GreyNote></View>
          {error ? <Text style={s.error}>{error}</Text> : null}
        </View>
      </GreySheet>
    </View>
  ) : null;

  return (
    <>
      {label('Teams')}
      <View style={s.card}>
        <TouchableOpacity style={s.head} activeOpacity={0.8} onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <View style={s.stack}>
            {teams.slice(0, 3).map((t, i) => <Crest key={t.id} uri={t.logo_url} size={30} radius={8} style={[s.stacked, i > 0 && { marginLeft: -8 }]} />)}
          </View>
          <Text style={s.summary}>{summary}</Text>
          <View style={open ? s.flip : undefined}><RivalIcon name="chevronDown" size={22} color="rgba(255,255,255,0.5)" /></View>
        </TouchableOpacity>
        {open ? teams.map((t) => (
          <TouchableOpacity key={t.id} style={s.row} activeOpacity={0.8} onPress={() => openTeam(t)} accessibilityRole="button">
            <Crest uri={t.logo_url} size={36} radius={9} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name}>{formatTeamName(t.name)}</Text>
              <Text style={s.sub}>{members(t.member_count)}</Text>
            </View>
            {right(t)}
          </TouchableOpacity>
        )) : null}
      </View>
      {sheet ? (Platform.OS === 'web' ? createPortal(sheet, document.body) : sheet) : null}
      {sent ? <SentNote text={sent} onDone={() => setSent(null)} /> : null}
    </>
  );
}

function Crest({ uri, size, radius, style }: { uri: string | null; size: number; radius: number; style?: any }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: '#2c2a29', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size }} /> : <RivalIcon name="groups" size={size * 0.5} color="rgba(255,255,255,0.35)" />}
    </View>
  );
}

// "Request sent to Akatsuki." for a moment at the bottom, then gone.
function SentNote({ text, onDone }: { text: string; onDone: () => void }) {
  const fade = useRef(new Animated.Value(0)).current;
  const done = useCallback(onDone, [onDone]);
  useEffect(() => {
    Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.delay(2400),
      Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: false }),
    ]).start(() => done());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const note = (
    <Animated.View style={[s.toast, { opacity: fade, pointerEvents: 'none' }]}>
      <RivalIcon name="checkCircle" size={20} color={RivalColors.accentText} />
      <Text style={s.toastText}>{text}</Text>
    </Animated.View>
  );
  return Platform.OS === 'web' ? createPortal(note, document.body) : note;
}

const s = StyleSheet.create({
  card: { backgroundColor: CARD, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: 16, paddingHorizontal: 13 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  stack: { flexDirection: 'row' },
  stacked: { borderWidth: 2, borderColor: CARD },
  summary: { flex: 1, color: '#fff', fontSize: 14.5, fontWeight: '800' },
  flip: { transform: [{ rotate: '180deg' }] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  name: { color: '#fff', fontSize: 14, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  quiet: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '700' },
  pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,181,158,0.45)' },
  pillText: { color: RivalColors.accentText, fontSize: 12, fontWeight: '800' },
  pillAsked: { borderColor: 'rgba(255,255,255,0.14)' },
  pillAskedText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '800' },
  layer: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute', top: 0, left: 0, right: 0, zIndex: 400, backgroundColor: 'rgba(0,0,0,0.55)',
    ...(Platform.OS === 'web' ? { height: '100vh' } as any : { bottom: 0 }),
  },
  sheetBody: { alignItems: 'center', paddingTop: 4 },
  facts: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 12 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  factText: { fontSize: 12.5, color: 'rgba(255,255,255,0.6)' },
  about: { alignSelf: 'stretch', marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,209,190,0.05)', borderWidth: 1, borderColor: 'rgba(255,181,158,0.18)' },
  aboutText: { fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  error: { fontSize: 13, color: RivalColors.error, marginTop: 8, textAlign: 'center' },
  later: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  laterText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
  toast: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute', left: 16, right: 16, bottom: 30, zIndex: 401,
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#282828', borderWidth: 1, borderColor: 'rgba(255,181,158,0.25)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14,
  },
  toastText: { flex: 1, color: '#fff', fontSize: 13 },
});
