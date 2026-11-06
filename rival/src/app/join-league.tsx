import { useEffect, useState } from 'react';
import { RivalColors, RivalButtonColors, RivalGhost } from '../constants/rivalTheme';
import { RivalIcon, RivalBackButton, RivalMobileHeader, RivalRowLink, RivalTopNav, rm, GreySheet, GreyNote, GreyLabel, GreyField, GreyRows, GreyRow, GreyPrimary } from '../components/rival';
import { sidePageWide } from '../constants/breakpoints';
import { Image, StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { teamSharingAgreed } from '../lib/stravaSharing';
import { clearPendingInvite, readPendingInvite } from '../lib/pendingInvite';
import { supabase, getAuthUser } from '../lib/supabase';
import { BusyText } from '../components/rival/BusyText';
import { RivalAvatar } from '../components/rival/RivalAvatar';
import { memberLine, requestToJoin, teamByCode, type InviteTeam } from '../lib/teamInvite';

export default function JoinLeagueScreen() {
  const [code, setCode] = useState('');
  // From an invite link, or one opened before signing in.
  const { code: codeParam } = useLocalSearchParams<{ code?: string }>();
  useEffect(() => {
    const invited = (codeParam || readPendingInvite() || '').trim().toUpperCase();
    if (invited) setCode(invited);
  }, [codeParam]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const wide = sidePageWide(width);

  // A code opens "Who invited you?"; the team itself opens once that teammate,
  // or an admin, says yes (supabase/team_invites.sql).
  const [step, setStep] = useState<'code' | 'who' | 'waiting'>('code');
  const [team, setTeam] = useState<InviteTeam | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [waitingFor, setWaitingFor] = useState<string | null>(null);

  const openTeam = (id: string) => router.replace({ pathname: '/team-hub', params: { id } });
  const firstName = (name: string) => name.trim().split(/\s+/)[0];

  async function handleJoin() {
    if (code.trim().length < 4) {
      setError('Enter a valid invite code.');
      return;
    }

    setLoading(true);
    setError('');

    const { data: { user } } = await getAuthUser();
    if (!user) {
      setError('Sign in to continue.');
      setLoading(false);
      return;
    }

    const res = await teamByCode(code.trim().toUpperCase());
    setLoading(false);
    if (!res.team) {
      setError(res.error ?? "Couldn't find the team. Try again.");
      return;
    }
    if (res.team.status === 'active') {
      clearPendingInvite();
      openTeam(res.team.league_id);
      return;
    }
    setTeam(res.team);
    if (res.team.status === 'pending') {
      setWaitingFor(res.team.members.find((m) => m.user_id === res.team!.invited_by)?.name ?? null);
      setStep('waiting');
    } else {
      setStep('who');
    }
  }

  async function sendRequest(inviter: string | null) {
    if (!team) return;
    if (!(await teamSharingAgreed(() => sendRequest(inviter)))) return;
    setLoading(true);
    setError('');
    const res = await requestToJoin(code.trim().toUpperCase(), inviter);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    clearPendingInvite();
    if (res.alreadyMember) {
      openTeam(team.league_id);
      return;
    }
    setWaitingFor(team.members.find((m) => m.user_id === inviter)?.name ?? null);
    setStep('waiting');
  }

  if (team && step !== 'code') {
    const close = () => (router.canGoBack() ? router.back() : router.replace('/discover-leagues'));
    const pickedMember = team.members.find((m) => m.user_id === picked);
    const q = search.trim().toLowerCase();
    const shown = team.members.filter((m) => m.name.toLowerCase().includes(q));
    const inviter = team.members.find((m) => m.name === waitingFor);
    return (
      <View style={ms.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
        {step === 'who' ? (
          <GreySheet
            kicker={team.name.toUpperCase()}
            title="Who invited you?"
            sub="They confirm, then the team is open to you."
            onClose={close}
            footer={(
              <>
                <GreyPrimary
                  label={loading ? 'Sending…' : pickedMember ? `Send to ${firstName(pickedMember.name)}` : 'Choose a teammate'}
                  busy={loading}
                  disabled={loading || !pickedMember}
                  onPress={() => sendRequest(picked)}
                />
                <TouchableOpacity style={ms.link} disabled={loading} onPress={() => sendRequest(null)} accessibilityRole="button">
                  <Text style={ms.linkText}>Nobody invited me</Text>
                </TouchableOpacity>
              </>
            )}
          >
            {team.members.length > 6 ? <GreyField placeholder="Search teammates" value={search} onChangeText={setSearch} autoCorrect={false} /> : null}
            <GreyLabel>Teammates</GreyLabel>
            <View style={ms.list}>
              {shown.map((m, i) => {
                const on = m.user_id === picked;
                return (
                  <TouchableOpacity key={m.user_id} style={[ms.row, i > 0 && ms.rowRule]} activeOpacity={0.8} onPress={() => setPicked(m.user_id)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <RivalAvatar uri={m.avatar_url} name={m.name} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={ms.rowName} numberOfLines={1}>{m.name}</Text>
                      <Text style={ms.rowLine} numberOfLines={1}>{memberLine(m)}</Text>
                    </View>
                    <View style={[ms.tick, on && ms.tickOn]}>{on ? <RivalIcon name="check" size={15} color={RivalButtonColors.label(RivalColors.onAccentFill)} /> : null}</View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {error ? <Text style={[rm.error, { marginTop: 8 }]}>{error}</Text> : null}
          </GreySheet>
        ) : (
          <GreySheet
            kicker={team.name.toUpperCase()}
            title={waitingFor ? `Waiting for ${firstName(waitingFor)}` : 'Waiting for the team admin'}
            sub={waitingFor ? `${firstName(waitingFor)} has been asked to confirm. The team opens once they do.` : 'The team admin has been asked to review this request.'}
            onClose={close}
            footer={(
              <>
                <GreyPrimary label="Done" onPress={close} />
                <TouchableOpacity
                  style={ms.link}
                  onPress={() => (waitingFor ? setStep('who') : router.replace('/discover-leagues'))}
                  accessibilityRole="button"
                >
                  <Text style={ms.linkText}>{waitingFor ? 'Change teammate' : 'Find another team'}</Text>
                </TouchableOpacity>
              </>
            )}
          >
            {team.logo_url ? <Image source={{ uri: team.logo_url }} style={ms.logo} resizeMode="contain" /> : null}
            {inviter ? (
              <>
                <GreyLabel>Request</GreyLabel>
                <View style={ms.list}>
                  <View style={ms.row}>
                    <RivalAvatar uri={inviter.avatar_url} name={inviter.name} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={ms.rowName} numberOfLines={1}>{inviter.name}</Text>
                      <Text style={ms.rowLine} numberOfLines={1}>Request sent</Text>
                    </View>
                  </View>
                </View>
              </>
            ) : null}
          </GreySheet>
        )}
      </View>
    );
  }

  if (!wide) {
    // Phone: a short form, so a pop-up over the screen it came from (the
    // route is a transparent modal on phone, see _layout.tsx).
    const close = () => (router.canGoBack() ? router.back() : router.replace('/discover-leagues'));
    return (
      <View style={ms.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
        <GreySheet
          kicker="TEAMS"
          title="Join a team"
          onClose={close}
          footer={<GreyPrimary label={loading ? 'Checking…' : 'Continue'} busy={loading} disabled={loading || code.trim().length < 4} onPress={handleJoin} />}
        >
          <GreyNote>Codes are shared by a team's admin. A code also works for a public team.</GreyNote>
          <GreyLabel>Invite code</GreyLabel>
          <GreyField
            style={ms.code}
            placeholder="UXXOKL"
            value={code}
            onChangeText={(t) => { setCode(t.toUpperCase()); if (error) setError(''); }}
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={handleJoin}
            returnKeyType="go"
          />
          {error ? <Text style={[rm.error, { marginTop: 8 }]}>{error}</Text> : null}
          <View style={{ height: 12 }} />
          <GreyRows>
            <GreyRow icon="globe" label="Browse public teams" onPress={() => router.replace('/discover-leagues')}>
              <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
            </GreyRow>
          </GreyRows>
        </GreySheet>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
          // Scrolls when the form is taller than the screen (a small phone, or
          // the keyboard up) instead of cutting the bottom off. Short forms
          // still sit centred: the content grows to fill, then beyond it.
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

        <View style={styles.header}>
          <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
        </View>

        <Text style={styles.title}>Join a Team</Text>
        <Text style={styles.subtitle}>Enter the invite code shared with you.</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Invite code</Text>
          <TextInput
            style={styles.input}
            placeholder="UXXOKL"
            placeholderTextColor={RivalColors.textSecondary}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.joinButton, loading && styles.joinButtonDisabled]}
          onPress={handleJoin}
          disabled={loading}
        >
          <BusyText busy={loading} style={styles.joinButtonText}>
            {loading ? 'Joining…' : 'Join Team'}
          </BusyText>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: RivalColors.pageGround,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  header: {
    marginBottom: 32,
  },
  back: {
    color: RivalColors.accentFill,
    fontSize: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: RivalColors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: RivalColors.textSecondary,
    marginBottom: 40,
  },
  form: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: RivalColors.textPrimary,
  },
  input: {
    backgroundColor: RivalColors.pageGround,
    borderRadius: 12,
    padding: 16,
    fontSize: 24,
    fontWeight: '800',
    color: RivalColors.textPrimary,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
    letterSpacing: 6,
    textAlign: 'center',
  },
  error: {
    color: '#f87171',
    fontSize: 14,
    marginTop: 16,
  },
  joinButton: {
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 48,
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinButtonText: {
    color: RivalButtonColors.label(RivalColors.textPrimary),
    fontSize: 18,
    fontWeight: '700',
  },
});

// Mobile only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code: { fontSize: 26, fontWeight: '800', letterSpacing: 8, textAlign: 'center', paddingVertical: 16 },
  list: { backgroundColor: RivalGhost.fill, borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border, paddingHorizontal: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 56, paddingVertical: 8 },
  rowRule: { borderTopWidth: 1, borderTopColor: RivalGhost.hairline },
  rowName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  rowLine: { fontSize: 11.5, color: RivalColors.textSecondary, marginTop: 1 },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  tickOn: { borderWidth: 0, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient } as any,
  logo: { width: 92, height: 92, alignSelf: 'center', marginVertical: 8 },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
});
