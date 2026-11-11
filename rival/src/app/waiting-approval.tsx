import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyPageHead, GREY_PAGE_BG, RivalIcon } from '../components/rival';
import { GreyPrimary } from '../components/rival/RivalGreySheet';
import { supabase } from '../lib/supabase';
import { requestApproval } from '../lib/approval';

// Waiting for approval (Mockup 30 A, 2026-11-11). A new account lands here
// until it is approved from the email to the RIVAL team. It checks on open,
// every 20 seconds and when the app comes back, and opens RIVAL by itself.

const STEPS = ['Account created', 'Approved by the RIVAL team', 'Choose activities and get started'];

export default function WaitingApprovalScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('An email arrives when the account is ready.');
  const done = useRef(false);

  const check = useCallback(async (byHand = false) => {
    if (done.current) return;
    if (byHand) setChecking(true);
    const ok = await requestApproval();
    if (byHand) setChecking(false);
    if (ok) {
      done.current = true;
      router.replace('/'); // opens setup or Today, as after any sign-in
    } else if (byHand) {
      setNote('Not approved yet. An email arrives when the account is ready.');
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/'); return; }
      setName(session.user.user_metadata?.display_name || session.user.email || '');
    });
    check();
    const timer = setInterval(() => check(), 20000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [check]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/');
  }

  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.word}>RIVAL</Text>
        <GreyPageHead kicker="TEAM BETA" title="Waiting for approval" sub={name ? `Signed in as ${name}` : undefined} />
        <View style={s.card}>
          <View style={s.art}><RivalIcon name="hourglass" size={150} color="rgba(255,181,158,0.05)" /></View>
          <Text style={s.body}>RIVAL is in beta, so each new account is approved before it opens. This usually takes less than a day.</Text>
          <View style={s.steps}>
            {STEPS.map((step, i) => (
              <View style={s.step} key={step}>
                <View style={[s.dot, i === 0 && s.dotOn]}>
                  {i === 0
                    ? <RivalIcon name="check" size={13} color="#5c1902" />
                    : <Text style={s.dotText}>{i + 1}</Text>}
                </View>
                <Text style={s.stepText}>{step}</Text>
              </View>
            ))}
          </View>
        </View>
        <Text style={s.note}>{note}</Text>
        <View style={{ flexGrow: 1, minHeight: 40 }} />
        <GreyPrimary label={checking ? 'Checking…' : 'Check again'} busy={checking} onPress={() => check(true)} />
        <GreyPrimary label="Sign out" tone="ghost" onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  pageWide: { backgroundColor: RivalColors.surfaceContainer },
  content: { flexGrow: 1, maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingTop: 28, paddingBottom: 24, gap: 12 },
  word: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, letterSpacing: 4, color: RivalColors.accentText, textAlign: 'center', marginBottom: 8 },
  card: { position: 'relative', overflow: 'hidden', borderRadius: 22, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, paddingVertical: 18, paddingHorizontal: 16, gap: 12 },
  art: { position: 'absolute', right: -30, bottom: -40 },
  body: { fontFamily: RivalFontFamily, fontSize: 13.5, lineHeight: 20, color: 'rgba(255,255,255,0.78)' },
  steps: { gap: 9 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,181,158,0.14)' },
  dotOn: { backgroundColor: RivalColors.accentText },
  dotText: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '800', color: RivalColors.accentText },
  stepText: { fontFamily: RivalFontFamily, fontSize: 13, color: 'rgba(255,255,255,0.72)' },
  note: { fontFamily: RivalFontFamily, fontSize: 12, lineHeight: 17, color: RivalColors.textSecondary, textAlign: 'center' },
});
