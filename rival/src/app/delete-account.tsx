import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyPageHead, GREY_PAGE_BG, RivalIcon, invalidateNavIdentity, type RivalIconName } from '../components/rival';
import { supabase, getAuthUser } from '../lib/supabase';
import { goToTab } from '../lib/tabNav';
import { buildArchive, type ArchiveCounts } from '../lib/archive';

// Delete account, modelled on Strava (Ricky, 2026-10-17): what is removed,
// a copy to keep first (A2, a receipt of what was saved), then deletion in a
// card of its own (R2). Requesting deletion emails a sign-in link that opens
// the final step (confirm-delete); nothing is removed on this screen. "Delete
// now instead" stays available, as Apple requires deletion in the app.

type Counts = { activities: number; photos: number; journal: number; teams: number };

const mask = (email: string | null) => {
  if (!email) return 'the account email';
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}•••@${domain}`;
};

export default function DeleteAccountScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const back = () => (router.canGoBack() ? router.back() : goToTab('/home'));
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [archive, setArchive] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saved, setSaved] = useState<ArchiveCounts | null>(null);
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      setUserId(user.id);
      setEmail(user.email ?? null);
      const head = { count: 'exact' as const, head: true };
      const [acts, photos, journal, teams, req] = await Promise.all([
        supabase.from('activities').select('id', head).eq('user_id', user.id),
        supabase.from('activities').select('id', head).eq('user_id', user.id).not('photo_url', 'is', null),
        supabase.from('activities').select('id', head).eq('user_id', user.id).not('notes', 'is', null).neq('notes', ''),
        supabase.from('league_members').select('league_id', head).eq('user_id', user.id).eq('status', 'active'),
        supabase.from('deletion_requests').select('expires_at').eq('user_id', user.id).maybeSingle(),
      ]);
      setCounts({ activities: acts.count ?? 0, photos: photos.count ?? 0, journal: journal.count ?? 0, teams: teams.count ?? 0 });
      if (req.data && new Date(req.data.expires_at).getTime() > Date.now()) setRequested(true);
    })();
  }, []);

  async function makeArchive() {
    if (!userId || archive === 'busy') return;
    setArchive('busy');
    setProgress(null);
    try {
      const c = await buildArchive(userId, email, (done, total) => setProgress({ done, total }));
      setSaved(c);
      setArchive('done');
    } catch {
      setArchive('failed');
    }
  }

  async function sendLink() {
    if (!email) return;
    const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '';
    return supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${origin}/confirm-delete` },
    });
  }

  async function requestDeletion() {
    if (!userId || sending || archive === 'busy') return;
    setSending(true);
    setMsg(null);
    try {
      await supabase.from('deletion_requests').delete().eq('user_id', userId);
      const { error } = await supabase.from('deletion_requests').insert({ user_id: userId });
      if (error) { setMsg('The request could not be recorded. Try again.'); return; }
      const sent = await sendLink();
      if (sent?.error) { setMsg('The email could not be sent. Delete now instead, or try again later.'); }
      setRequested(true);
    } finally {
      setSending(false);
    }
  }

  async function resend() {
    setSending(true);
    setMsg(null);
    const sent = await sendLink();
    setMsg(sent?.error ? 'The email could not be sent. Try again in a minute.' : 'Sent again.');
    setSending(false);
  }

  async function cancelRequest() {
    if (!userId) return;
    const { error } = await supabase.from('deletion_requests').delete().eq('user_id', userId);
    if (error) { setMsg('The request could not be cancelled. Try again.'); return; }
    setRequested(false);
    setMsg(null);
  }

  async function deleteNow() {
    if (Platform.OS === 'web' && !window.confirm('Delete this account permanently? All activities, photos, teams and Effort history are removed. This cannot be undone.')) return;
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const data = await res.json();
      if (!res.ok || !data.deleted) { setMsg('The account could not be deleted. Try again.'); return; }
      invalidateNavIdentity();
      await supabase.auth.signOut();
      router.replace('/');
    } catch {
      setMsg('Could not reach the server. Try again.');
    } finally {
      setDeleting(false);
    }
  }

  const row = (icon: RivalIconName, label: string, value: string) => (
    <View style={s.removeRow} key={label}>
      <RivalIcon name={icon} size={16} color={RivalColors.accentText} />
      <Text style={s.removeLabel}>{label}</Text>
      <Text style={s.removeValue}>{value}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="ACCOUNT" title="Delete account" onBack={back} />

        <View style={s.card}>
          <Text style={s.label}>What is removed</Text>
          <View style={s.removeList}>
            {row('distance', 'Activities and routes', counts ? counts.activities.toLocaleString() : '…')}
            {row('camera', 'Photos and journal entries', counts ? (counts.photos + counts.journal).toLocaleString() : '…')}
            {row('groups', 'Teams, Effort and ranks', counts ? `${counts.teams} ${counts.teams === 1 ? 'team' : 'teams'}` : '…')}
          </View>
          <Text style={s.body}>Teammates keep their own activities. Shared activities stay on their accounts.</Text>
        </View>

        {/* A2: keep a copy, then a receipt of what was saved. */}
        <View style={s.card}>
          <Text style={s.label}>Keep a copy</Text>
          {archive === 'idle' || archive === 'failed' ? (
            <>
              <Text style={s.body}>A file of every activity, route, photo and journal entry, saved to this device.</Text>
              {archive === 'failed' ? <Text style={s.error}>The archive could not be made. Try again.</Text> : null}
              <TouchableOpacity style={s.primary} onPress={makeArchive} activeOpacity={0.85}>
                <Text style={s.primaryText}>Download archive</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.coinRow}>
                <View style={s.coin}><RivalIcon name="archive" size={20} color={RivalButtonColors.label(RivalColors.onAccentFill)} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.serif}>{archive === 'busy' ? 'Preparing archive' : 'Archive saved'}</Text>
                  <Text style={s.body}>
                    {archive === 'busy'
                      ? progress?.total ? `Adding photos, ${progress.done} of ${progress.total}` : 'Gathering activities'
                      : 'Saved to Downloads on this device'}
                  </Text>
                </View>
              </View>
              {archive === 'done' && saved ? (
                <View style={s.facts}>
                  <View style={s.fact}><Text style={s.factLabel}>Activities</Text><Text style={s.factValue}>{saved.activities.toLocaleString()}</Text></View>
                  <View style={[s.fact, s.factDivided]}><Text style={s.factLabel}>Routes</Text><Text style={s.factValue}>{saved.routes.toLocaleString()}</Text></View>
                  <View style={[s.fact, s.factDivided]}><Text style={s.factLabel}>Photos</Text><Text style={s.factValue}>{saved.photos.toLocaleString()}</Text></View>
                  {saved.videos > 0 ? <View style={[s.fact, s.factDivided]}><Text style={s.factLabel}>Videos</Text><Text style={s.factValue}>{saved.videos.toLocaleString()}</Text></View> : null}
                  <View style={[s.fact, s.factDivided]}><Text style={s.factLabel}>Can be imported</Text><Text style={s.factPlain}>Into RIVAL later</Text></View>
                </View>
              ) : null}
            </>
          )}
        </View>

        {/* R2: deletion in a card of its own. */}
        {!requested ? (
          <View style={s.zone}>
            <View style={s.zoneIn}>
              <View style={s.ring}><RivalIcon name="delete" size={17} color={RivalColors.danger} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.serifSm}>Delete account</Text>
                <Text style={s.body}>A final confirmation is sent to {mask(email)}.</Text>
              </View>
            </View>
            <TouchableOpacity style={[s.zoneAct, archive === 'busy' && { opacity: 0.4 }]} onPress={requestDeletion} disabled={archive === 'busy' || sending} activeOpacity={0.8}>
              <Text style={s.zoneActText}>{archive === 'busy' ? 'Waiting for the archive' : sending ? 'Sending…' : 'Request account deletion'}</Text>
              <RivalIcon name="chevronRight" size={18} color="rgba(255,92,92,0.6)" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.card}>
            <View style={s.checkHead}>
              <View style={s.mailCoin}><RivalIcon name="mail" size={24} color={RivalColors.accentText} /></View>
              <Text style={s.serif}>Check email</Text>
              <Text style={[s.body, { textAlign: 'center' }]}>A link to permanently delete this account was sent to {mask(email)}. It works for 24 hours. Until then the account works as normal.</Text>
            </View>
            <TouchableOpacity style={s.ghost} onPress={resend} disabled={sending} activeOpacity={0.8}><Text style={s.ghostText}>{sending ? 'Sending…' : 'Send again'}</Text></TouchableOpacity>
            <TouchableOpacity style={s.ghost} onPress={cancelRequest} activeOpacity={0.8}><Text style={s.ghostText}>Cancel request</Text></TouchableOpacity>
          </View>
        )}
        {msg ? <Text style={s.note}>{msg}</Text> : null}
        {requested ? (
          <TouchableOpacity onPress={deleteNow} disabled={deleting} style={{ alignSelf: 'center', marginTop: 14 }}>
            <Text style={s.note}>No email? <Text style={s.noteLink}>{deleting ? 'Deleting…' : 'Delete now instead'}</Text></Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  pageWide: { backgroundColor: RivalColors.surfaceContainer },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  card: { borderRadius: 22, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, padding: 16, gap: 12 },
  label: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 1.7, textTransform: 'uppercase', color: RivalColors.accentText },
  body: { fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.72)' },
  error: { fontFamily: RivalFontFamily, fontSize: 12.5, color: RivalColors.danger },
  removeList: { borderRadius: 14, backgroundColor: 'rgba(255,209,190,0.05)' },
  removeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12 },
  removeLabel: { flex: 1, fontFamily: RivalFontFamily, fontSize: 13.5, color: '#fff' },
  removeValue: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.5)' },
  primary: {
    height: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill,
    ...RivalButtonColors.gradient,
  },
  primaryText: { fontFamily: RivalFontFamily, fontSize: 14.5, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coin: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(160deg, #ffc2ad, #c96a4a)' } as any : {}),
  },
  serif: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, color: '#fff' },
  serifSm: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, color: '#fff' },
  facts: { borderRadius: 14, backgroundColor: 'rgba(255,209,190,0.05)' },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  factDivided: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  factLabel: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.62)' },
  factValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: '#fff' },
  factPlain: { fontFamily: RivalFontFamily, fontSize: 12.5, fontWeight: '600', color: '#fff' },
  zone: { borderRadius: 22, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, overflow: 'hidden' },
  zoneIn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  ring: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,92,92,0.12)' },
  zoneAct: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  zoneActText: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', color: RivalColors.danger },
  checkHead: { alignItems: 'center', gap: 8, paddingTop: 6 },
  mailCoin: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,131,95,0.16)' },
  ghost: { height: 44, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.88)' },
  note: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
  noteLink: { color: 'rgba(255,255,255,0.8)', textDecorationLine: 'underline' },
});
