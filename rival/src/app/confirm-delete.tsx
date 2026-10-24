import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../constants/rivalTheme';
import { GREY_PAGE_BG, RivalIcon, invalidateNavIdentity } from '../components/rival';
import { supabase } from '../lib/supabase';
import { goToTab } from '../lib/tabNav';

// The final step of deleting an account (Ricky, 2026-10-17), opened from the
// emailed link. The link signs the person in; this screen then deletes only
// while their request is still pending (delete-account checks it too).

export default function ConfirmDeleteScreen() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'expired'>('checking');
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Tokens arrive in the URL fragment (detectSessionInUrl is off app-wide).
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const access = hash.get('access_token');
        const refresh = hash.get('refresh_token');
        if (access && refresh) await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
        const code = new URLSearchParams(window.location.search).get('code');
        if (code) await supabase.auth.exchangeCodeForSession(code);
        if (access || code) window.history.replaceState(null, '', '/confirm-delete');
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setStatus('expired'); return; }
      setUserId(session.user.id);
      const { data } = await supabase.from('deletion_requests').select('expires_at').eq('user_id', session.user.id).maybeSingle();
      setStatus(data && new Date(data.expires_at).getTime() > Date.now() ? 'ready' : 'expired');
    })();
  }, []);

  async function confirm() {
    setBusy(true);
    setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setStatus('expired'); return; }
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ confirm: 'DELETE', via: 'email' }),
      });
      const data = await res.json();
      if (data.error === 'request_expired') { setStatus('expired'); return; }
      if (!res.ok || !data.deleted) { setMsg('The account could not be deleted. Try again.'); return; }
      invalidateNavIdentity();
      await supabase.auth.signOut();
      router.replace('/');
    } catch {
      setMsg('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (userId) {
      // Cancelling the request is the point of this button; if it didn't go
      // through, the emailed link would still work, so say so.
      const { error } = await supabase.from('deletion_requests').delete().eq('user_id', userId);
      if (error) { setMsg('The deletion request could not be cancelled. Try again.'); return; }
    }
    goToTab('/home');
  }

  return (
    <SafeAreaView style={s.page}>
      <View style={s.card}>
        {status === 'checking' ? (
          <Text style={s.body}>Checking the link…</Text>
        ) : status === 'expired' ? (
          <>
            <Text style={s.serif}>This link has expired</Text>
            <Text style={[s.body, { textAlign: 'center' }]}>Nothing was deleted. Request deletion again from Profile, Delete account.</Text>
            <TouchableOpacity style={s.ghost} onPress={() => (userId ? goToTab('/home') : router.replace('/'))}><Text style={s.ghostText}>Back to RIVAL</Text></TouchableOpacity>
          </>
        ) : (
          <>
            <View style={s.ring}><RivalIcon name="priority" size={26} color={RivalColors.danger} /></View>
            <Text style={s.serif}>Delete account</Text>
            <Text style={[s.body, { textAlign: 'center' }]}>All activities, photos, teams and Effort history for this account are removed. This cannot be undone.</Text>
            <TouchableOpacity style={[s.red, busy && { opacity: 0.6 }]} onPress={confirm} disabled={busy} activeOpacity={0.85}>
              <Text style={s.redText}>{busy ? 'Deleting…' : 'Delete account permanently'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.ghost} onPress={keep} disabled={busy}><Text style={s.ghostText}>Keep account</Text></TouchableOpacity>
            {msg ? <Text style={[s.body, { color: RivalColors.danger }]}>{msg}</Text> : null}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG, justifyContent: 'center', paddingHorizontal: 16 },
  card: { maxWidth: 420, width: '100%', alignSelf: 'center', borderRadius: 22, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, padding: 20, gap: 12, alignItems: 'stretch' },
  ring: { alignSelf: 'center', width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,92,92,0.14)' },
  serif: { alignSelf: 'center', fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, color: '#fff' },
  body: { fontFamily: RivalFontFamily, fontSize: 13.5, lineHeight: 20, color: 'rgba(255,255,255,0.72)' },
  red: { height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalColors.danger, marginTop: 6 },
  redText: { fontFamily: RivalFontFamily, fontSize: 14.5, fontWeight: '800', color: '#2a0b0b' },
  ghost: { height: 46, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.88)' },
});
