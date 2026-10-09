import { useEffect, useState } from 'react';
import { RivalColors, RivalButtonColors } from '../constants/rivalTheme';
import { RivalIcon, RivalBackButton, RivalMobileHeader, RivalRowLink, RivalTopNav, rm, GreySheet, GreyNote, GreyLabel, GreyField, GreyRows, GreyRow, GreyPrimary } from '../components/rival';
import { sidePageWide } from '../constants/breakpoints';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { clearPendingInvite, readPendingInvite } from '../lib/pendingInvite';
import { supabase, getAuthUser } from '../lib/supabase';
import { BusyText } from '../components/rival/BusyText';

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

    // Validate the code AND join in one server-side step (SECURITY DEFINER
    // RPC — supabase/join_league_with_code.sql). The code is the credential:
    // this works on public teams too, and upgrades a pending join-request to
    // active. A client-side insert can't do either without loosening RLS.
    const { data: result, error: joinError } = await supabase
      .rpc('join_league_with_code', { code: code.trim().toUpperCase() });

    if (joinError || !result || result.error) {
      console.log('Join error:', JSON.stringify(joinError ?? result?.error));
      setError(
        result?.error === 'invalid_code'
          ? 'Invalid invite code. Check it and try again.'
          : "Couldn't join the team. Try again."
      );
      setLoading(false);
      return;
    }

    setLoading(false);
    clearPendingInvite();
    router.replace({ pathname: '/team-hub', params: { id: result.league_id } });
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
          footer={<GreyPrimary label={loading ? 'Joining…' : 'Join team'} busy={loading} disabled={loading || code.trim().length < 4} onPress={handleJoin} />}
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
    backgroundColor: RivalColors.surfaceLow,
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
    backgroundColor: RivalColors.surfaceLow,
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
});
