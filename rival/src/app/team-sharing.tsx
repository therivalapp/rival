import { useEffect, useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalColors, RivalFontFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyLabel, GreyPageHead, GreyPrimary, GreyRows, GREY_PAGE_BG, RivalIcon, type RivalIconName } from '../components/rival';
import { agreeToStravaSharing, loadStravaSharing, takeAfterAgree } from '../lib/stravaSharing';
import { goToTab } from '../lib/tabNav';

// Sharing with teams (Ricky, 2026-11-02; design/team-sharing-consent-mockup.png).
// Agreed once, before a person's activities reach any team: before joining or
// creating a first team, and from Settings to look again. It replaces the
// Strava-only consent, and is stored in the same place (users.strava_sharing_agreed_at).

export default function TeamSharingScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const [agreed, setAgreed] = useState(false);
  const [shareRoutes, setShareRoutes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStravaSharing().then((s) => {
      if (!s?.agreedAt) return;
      setAgreed(true);
      setShareRoutes(s.shareRoutes);
    });
  }, []);

  const back = () => (router.canGoBack() ? router.back() : goToTab('/home'));
  // Leaving without agreeing drops whatever was waiting on it.
  const leave = () => { takeAfterAgree(); back(); };

  async function agree() {
    setError(null);
    setSaving(true);
    const res = await agreeToStravaSharing(shareRoutes);
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'The choice could not be saved. Try again.'); return; }
    // Back to the form, then carry on with the create or join that asked.
    const next = takeAfterAgree();
    back();
    if (next) setTimeout(next, 350);
  }

  const row = (icon: RivalIconName, title: string, body: string, extra?: ReactNode) => (
    <View style={s.row} key={title}>
      <RivalIcon name={icon} size={20} color={RivalColors.accentText} />
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.body}>{body}</Text>
        {extra}
      </View>
    </View>
  );
  const required = <Text style={s.required}>Required for teams</Text>;

  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="TEAMS" title="Sharing with teams" sub="Agreed once, for every team you join." onBack={leave} />

        <GreyLabel>What teammates see</GreyLabel>
        <GreyRows>
          {row('workout', 'Activities', 'Type, name, date, duration, distance, elevation, Effort, photos and notes, in feeds and standings.', required)}
          {row('person', 'Profile', 'Name, photo, rank, quote and stats.', required)}
          <View style={s.row}>
            <RivalIcon name="distance" size={20} color={RivalColors.accentText} />
            <View style={s.rowText}>
              <View style={s.switchHead}>
                <Text style={s.rowTitle}>Route maps</Text>
                <Switch
                  value={shareRoutes}
                  onValueChange={setShareRoutes}
                  trackColor={{ false: 'rgba(255,255,255,0.14)', true: RivalColors.accentFill }}
                  thumbColor="#ffffff"
                  {...(Platform.OS === 'web' ? ({ activeThumbColor: '#ffffff' } as any) : {})}
                  accessibilityLabel="Share route maps with teams"
                />
              </View>
              <Text style={s.body}>The route of each activity. A route can show where a person lives or trains. Off unless turned on.</Text>
            </View>
          </View>
        </GreyRows>

        <GreyLabel>Staying in control</GreyLabel>
        <GreyRows>
          {row('delete', 'Delete any activity', 'It disappears from every team at once.')}
          {row('logout', 'Leave a team', 'That team no longer sees your activities.')}
          {row('accountOff', 'Delete your account', 'Everything is removed after an archive is saved for you.')}
        </GreyRows>

        <View style={s.actions}>
          <GreyPrimary label={agreed ? 'Save' : 'Agree and continue'} busy={saving} disabled={saving} onPress={agree} />
          {error ? <Text style={s.error}>{error}</Text> : null}
          {!agreed ? (
            <TouchableOpacity style={s.ghost} onPress={leave} accessibilityRole="button">
              <Text style={s.ghostText}>Not now</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={s.policy}>
            Read the full{' '}
            <Text style={s.policyLink} onPress={() => router.push('/privacy')} accessibilityRole="link">Privacy policy</Text>
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  pageWide: { backgroundColor: RivalColors.surfaceContainer },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12 },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontFamily: RivalFontFamily, fontSize: 14.5, fontWeight: '700', color: '#fff' },
  body: { fontFamily: RivalFontFamily, fontSize: 13, lineHeight: 18.5, color: RivalColors.textSecondary },
  required: { fontFamily: RivalFontFamily, fontSize: 9.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  switchHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  actions: { gap: 12, marginTop: 4 },
  ghost: { paddingVertical: 13, borderRadius: 999, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)' },
  ghostText: { fontFamily: RivalFontFamily, fontSize: 14.5, fontWeight: '700', color: RivalColors.accentText },
  error: { fontFamily: RivalFontFamily, fontSize: 13, color: RivalColors.error, textAlign: 'center' },
  policy: { fontFamily: RivalFontFamily, fontSize: 12.5, color: RivalColors.textSecondary, textAlign: 'center' },
  policyLink: { fontWeight: '700', color: RivalColors.accentText },
});
