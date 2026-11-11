import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { RivalColors, RivalFontFamily, RivalSerifFamily } from '../constants/rivalTheme';
import { GREY_PAGE_BG, RivalIcon } from '../components/rival';
import { answerApproval } from '../lib/approval';

// Opened from the "New sign-up" email's Approve or Decline (Mockup 30 C).
// No sign-in: the link carries a token the approve-member function checks.

export default function ApproveScreen() {
  const { a, u, t } = useLocalSearchParams<{ a?: string; u?: string; t?: string }>();
  const [result, setResult] = useState<{ title: string; sub: string; ok: boolean } | null>(null);

  useEffect(() => {
    const action = a === 'decline' ? 'decline' : a === 'approve' ? 'approve' : null;
    if (!action || !u || !t) { setResult({ title: 'Link not valid', sub: 'Open the link from the email again.', ok: false }); return; }
    answerApproval(action, String(u), String(t)).then((r) => {
      const name = r.name || 'The member';
      const first = name.split(' ')[0];
      if (r.error) setResult({ title: 'Link not valid', sub: r.error, ok: false });
      else if (r.status === 'approved') setResult({ title: `${name} is approved`, sub: `An email is on its way to ${first}. RIVAL opens for them next time they open the app.`, ok: true });
      else if (r.status === 'declined') setResult({ title: 'Sign-up declined', sub: `${name}'s account has been removed.`, ok: true });
      else if (r.status === 'already') setResult({ title: `${name} is already approved`, sub: 'Nothing more to do.', ok: true });
      else setResult({ title: 'Account not found', sub: 'It may have been removed already.', ok: false });
    });
  }, [a, u, t]);

  return (
    <SafeAreaView style={s.page}>
      <View style={s.center}>
        {!result ? <ActivityIndicator color={RivalColors.accentText} /> : (
          <>
            <View style={[s.badge, !result.ok && s.badgeOff]}>
              <RivalIcon name={result.ok ? 'check' : 'close'} size={34} color={result.ok ? '#5c1902' : RivalColors.accentText} />
            </View>
            <Text style={s.title}>{result.title}</Text>
            <Text style={s.sub}>{result.sub}</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalColors.accentText, marginBottom: 6 },
  badgeOff: { backgroundColor: 'rgba(255,181,158,0.14)' },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 28, lineHeight: 34, color: '#fff', textAlign: 'center' },
  sub: { fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 18, color: RivalColors.textSecondary, textAlign: 'center', maxWidth: 300 },
});
