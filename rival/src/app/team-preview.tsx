import { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { RivalIcon, RivalBackButton, RivalCard, RivalTopNav, RivalMobileHeader, RivalWarm, rm, rb, GreyPageHead } from '../components/rival';
import { RivalColors, RivalRadius, RivalType, RivalButtonColors, RivalSerifFamily, RivalGhost } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { formatTeamName } from '../lib/identity';
import { BusyText } from '../components/rival/BusyText';

// What a stranger sees before joining a public team.
//
// The whole point is answering ONE question: is this team alive? A name and a
// logo can't, which is why joining used to be a blind leap. So this leads with
// the week's activity, not with achievement.
//
// Deliberately NOT shown: individual activities, the chat, per-member Effort,
// or a full roster. Members of a team didn't consent to strangers reading
// their week — and a leaderboard here would tell a newcomer where they'd rank
// before they've done anything, which is the wrong first impression and cuts
// against showing up being the thing that counts.
type Preview = {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  member_count: number;
  sessions_last_7d: number;
  member_names: string[] | null;
};

type Membership = 'none' | 'pending' | 'active';

export default function TeamPreviewScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<Membership>('none');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(true);
  // Phone: the RIVAL look; same content and actions as desktop.
  const { width } = useWindowDimensions();
  const mob = width < BREAKPOINT_WIDE_LAYOUT;

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    if (!id) { setLoading(false); return; }
    setLoading(true);

    const { data: { user } } = await getAuthUser();
    setSignedIn(!!user);

    // Private teams return no row at all — invite-only means invisible, not
    // "visible but locked".
    const { data, error: rpcError } = await supabase.rpc('get_team_preview', { p_league_id: id });
    const row = Array.isArray(data) ? data[0] : data;

    if (rpcError) setError(rpcError.message);
    setPreview(row ?? null);

    if (user && row) {
      const { data: m } = await supabase
        .from('league_members')
        .select('status')
        .eq('league_id', id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (m?.status === 'active') setMembership('active');
      else if (m?.status === 'pending') setMembership('pending');
    }

    setLoading(false);
  }

  async function requestToJoin() {
    const { data: { user } } = await getAuthUser();
    if (!user || !id) return;
    setJoining(true);
    setError('');
    const { error: insertError } = await supabase
      .from('league_members')
      .insert({ league_id: id, user_id: user.id, role: 'member', status: 'pending' });
    setJoining(false);
    if (insertError) { setError(insertError.message); return; }
    setMembership('pending');
  }

  const memberLabel = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`;

  function foundedLabel(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  const body = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={RivalColors.accentFill} />
        </View>
      );
    }

    // A signed-out visitor gets a permissions failure, not an empty result —
    // the RPCs are granted to `authenticated` only. Saying "probably private"
    // there would be a guess, and the wrong one.
    if (!preview && !signedIn) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.emptyTitle, mob && ms.emptyTitle]}>Sign in to see this team</Text>
          <Text style={[styles.emptyBody, mob && ms.emptyBody]}>
            Team previews are for members of RIVAL. It takes a moment to join.
          </Text>
          <TouchableOpacity style={mob ? [rm.ghost, ms.ghostBtn] : styles.secondaryBtn} onPress={() => router.push('/sign-in')}>
            <Text style={mob ? rm.ghostText : styles.secondaryBtnText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!preview) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.emptyTitle, mob && ms.emptyTitle]}>This team isn't open to preview</Text>
          <Text style={[styles.emptyBody, mob && ms.emptyBody]}>
            It may be private — private teams are joined with an invite code from someone already inside.
          </Text>
          <TouchableOpacity style={mob ? [rm.ghost, ms.ghostBtn] : styles.secondaryBtn} onPress={() => router.push('/join-league')}>
            {mob && <RivalIcon name="key" size={16} color={RivalColors.accentText} />}
            <Text style={mob ? rm.ghostText : styles.secondaryBtnText}>Enter an invite code</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const sessions = Number(preview.sessions_last_7d ?? 0);
    const names = (preview.member_names ?? []).filter(Boolean);

    return (
      <>
        <View style={[styles.hero, mob && ms.hero]}>
          {preview.logo_url ? (
            <Image source={{ uri: preview.logo_url }} style={[styles.logo, mob && ms.crest]} />
          ) : (
            <View style={[styles.logoFallback, mob && ms.crest]}>
              <RivalIcon name="groups" size={34} color={RivalColors.accentText} />
            </View>
          )}
          {!mob && <Text style={styles.teamName}>{formatTeamName(preview.name)}</Text>}
          <Text style={[styles.founded, mob && rb.label]}>Together since {foundedLabel(preview.created_at)}</Text>
        </View>

        {/* The aliveness signal, given the most weight on the screen. */}
        <RivalCard glass style={[styles.statCard, mob && [rb.card, ms.statCard]]}>
          <Text style={[styles.statValue, mob && ms.statValue]}>{sessions}</Text>
          <Text style={[styles.statLabel, mob && ms.statLabel]}>
            {sessions === 1 ? 'activity logged this week' : 'activities logged this week'}
          </Text>
          <Text style={[styles.statSub, mob && rm.hint]}>
            {sessions > 0
              ? `Across ${memberLabel(preview.member_count)}.`
              : `${memberLabel(preview.member_count)} — no one has logged yet this week.`}
          </Text>
        </RivalCard>

        {names.length > 0 && (
          <RivalCard glass style={[styles.peopleCard, mob && [rb.card, ms.peopleCard]]}>
            <Text style={mob ? rb.label : styles.peopleTitle}>Members</Text>
            <Text style={[styles.peopleNames, mob && ms.peopleNames]}>
              {names.join(', ')}
              {preview.member_count > names.length ? ` and ${preview.member_count - names.length} more` : ''}
            </Text>
          </RivalCard>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {membership === 'active' ? (
          <TouchableOpacity
            style={mob ? [rm.primary, ms.primaryBtn] : styles.primaryBtn}
            onPress={() => router.push({ pathname: '/team-hub', params: { id: preview.id } })}
          >
            <Text style={mob ? rm.primaryText : styles.primaryBtnText}>Open team</Text>
          </TouchableOpacity>
        ) : membership === 'pending' ? (
          <View style={[styles.pendingPill, mob && ms.pending]}>
            {mob && <RivalIcon name="checkCircle" size={16} color={RivalColors.accentText} />}
            <Text style={[styles.pendingText, mob && ms.pendingText]}>Request sent. An admin will review it.</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[mob ? [rm.primary, ms.primaryBtn] : styles.primaryBtn, joining && styles.primaryBtnDisabled]}
            onPress={requestToJoin}
            disabled={joining}
          >
            <BusyText busy={!!(joining)} style={mob ? rm.primaryText : styles.primaryBtnText}>{joining ? 'Sending…' : 'Request to join'}</BusyText>
          </TouchableOpacity>
        )}

        <Text style={[styles.privacyNote, mob && ms.privacyNote]}>
          You'll see the team's feed, chat and standings once you're in.
        </Text>
      </>
    );
  };

  return (
    <SafeAreaView style={[styles.container, mob && rb.page]} edges={['top', 'left', 'right']}>
      <RivalTopNav />
      <ScrollView contentContainerStyle={[styles.content, mob && ms.content]}>
        {mob ? (
          <GreyPageHead
            kicker="TEAM"
            title={preview ? formatTeamName(preview.name) : 'Team'}
            onBack={() => (router.canGoBack() ? router.back() : router.replace('/discover-leagues'))}
          />
        ) : (
        <View style={styles.header}>
          <RivalBackButton
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover-leagues'))}
            color={RivalColors.accentFill}
          />
          <Text style={styles.headerTitle}>Team</Text>
          <View style={{ width: 48 }} />
        </View>
        )}
        {body()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerTitle: { ...RivalType.titleMd, color: RivalColors.textPrimary },

  hero: { alignItems: 'center', gap: 8, marginBottom: 24 },
  logo: { width: 84, height: 84, borderRadius: 42, backgroundColor: RivalColors.surfaceContainerHigh },
  logoFallback: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: RivalColors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center',
  },
  teamName: { ...RivalType.headlineLgMobile, color: RivalColors.textPrimary, textAlign: 'center' },
  founded: { fontSize: 13, color: RivalColors.textSecondary },

  statCard: { alignItems: 'center', padding: 24, gap: 4, marginBottom: 12 },
  statValue: { fontSize: 48, fontWeight: '800', color: RivalColors.accentText, lineHeight: 54 },
  statLabel: { fontSize: 15, fontWeight: '600', color: RivalColors.textPrimary },
  statSub: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 4 },

  peopleCard: { padding: 20, gap: 6, marginBottom: 12 },
  peopleTitle: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary, letterSpacing: 0.6 },
  peopleNames: { fontSize: 15, color: RivalColors.textPrimary, lineHeight: 22 },

  error: { color: RivalColors.error, fontSize: 13, marginBottom: 12 },

  primaryBtn: {
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
    borderRadius: RivalRadius.DEFAULT,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontSize: 16, fontWeight: '700' },

  pendingPill: {
    borderRadius: RivalRadius.DEFAULT,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: RivalColors.surfaceContainerHigh,
    marginTop: 8,
  },
  pendingText: { color: RivalColors.textSecondary, fontSize: 14, fontWeight: '600' },

  secondaryBtn: {
    borderRadius: RivalRadius.DEFAULT,
    paddingVertical: 14, paddingHorizontal: 20,
    borderWidth: 1, borderColor: RivalColors.accentFill,
    marginTop: 8,
  },
  secondaryBtnText: { color: RivalColors.accentText, fontSize: 15, fontWeight: '600' },

  emptyTitle: { ...RivalType.titleMd, color: RivalColors.textPrimary, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: RivalColors.textSecondary, textAlign: 'center', lineHeight: 20 },

  privacyNote: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 16, lineHeight: 17 },
});

// Phone only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 120 },
  hero: { gap: 8, marginTop: 0, marginBottom: 14 },
  crest: { borderWidth: 2, borderColor: 'rgba(255,181,158,0.35)' },
  teamName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, lineHeight: 36 },
  statCard: { alignItems: 'center', marginBottom: 12 },
  statValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 56, lineHeight: 62 },
  statLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary },
  peopleCard: { gap: 8, marginBottom: 12 },
  peopleNames: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 16, lineHeight: 23 },
  primaryBtn: { marginTop: 8 },
  pending: { flexDirection: 'row', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  pendingText: { color: RivalColors.textSecondary },
  ghostBtn: { paddingHorizontal: 22, marginTop: 8 },
  emptyTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22 },
  emptyBody: { color: RivalColors.textSecondary },
  privacyNote: { color: RivalColors.textSecondary },
});
