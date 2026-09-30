import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { connectStrava } from '../lib/strava';
import { agreeToStravaSharing, loadStravaSharing } from '../lib/stravaSharing';
import { ROUTE_MAPS_ENABLED } from '../lib/features';
import { RivalButtonColors, RivalColors } from '../constants/rivalTheme';
import { RivalIcon, rm, rb, GreyPageHead, GreyRows, GreyRow } from '../components/rival';
import { goToTab } from '../lib/tabNav';

// The consent step before Strava connects. Strava's API Agreement only allows
// a person's Strava data to be shown to others with their explicit consent,
// so activity sharing is agreed here, and route maps are a separate choice
// that starts off.
//
// ?review=1 is for people who connected before this step existed: the same
// choices, saved without opening Strava again.

export default function ConnectStravaScreen() {
  const { review } = useLocalSearchParams<{ review?: string }>();
  const isReview = review === '1';
  const [shareRoutes, setShareRoutes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStravaSharing().then((s) => { if (s?.agreedAt) setShareRoutes(s.shareRoutes); });
  }, []);

  const leave = () => (router.canGoBack() ? router.back() : goToTab('/home'));

  async function agree() {
    setError(null);
    // connectStrava opens its window synchronously, before anything awaits, so
    // the browser still treats it as part of the tap. The choice saves alongside.
    if (!isReview) connectStrava(leave);
    setSaving(true);
    const res = await agreeToStravaSharing(shareRoutes);
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'The choice could not be saved. Try again.'); return; }
    if (isReview) leave();
  }

  return (
    <SafeAreaView style={rb.page} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[rb.content, s.content]}>
        <GreyPageHead
          kicker="CONNECTED DEVICES"
          title={isReview ? 'Sharing with teams' : 'Connect a device'}
          sub={isReview ? 'Review what teammates can see.' : 'Past training imports with Effort. New activities sync automatically.'}
          onBack={leave}
        />

        {!isReview ? (
          <GreyRows>
            <GreyRow icon="run" label="Strava" value="Selected" />
            <GreyRow icon="watch" label="Garmin" value="Coming soon" />
            <GreyRow icon="respect" label="Apple Health" value="Coming soon" />
          </GreyRows>
        ) : null}

        <Text style={rb.section}>Sharing with teams</Text>
        <View style={[rb.card, s.list]}>
          <Text style={s.intro}>
            RIVAL shows activities to the teams you belong to. Strava requires agreement before any of its data is shown to other people.
          </Text>
          <View style={[s.row, rb.rule]}>
            <View style={rb.badge}><RivalIcon name="groups" size={16} color={RivalColors.accentText} /></View>
            <View style={s.rowText}>
              <Text style={s.rowTitle}>Activities</Text>
              <Text style={s.body}>Type, name, date, duration, distance, elevation and Effort are shown to teammates in feeds and standings.</Text>
              <Text style={s.required}>Required for teams</Text>
            </View>
          </View>
          {ROUTE_MAPS_ENABLED && (
            <View style={[s.row, rb.rule]}>
              <View style={rb.badge}><RivalIcon name="distance" size={16} color={RivalColors.accentText} /></View>
              <View style={s.rowText}>
                <View style={s.switchHead}>
                  <Text style={s.rowTitle}>Route maps</Text>
                  <Switch
                    value={shareRoutes}
                    onValueChange={setShareRoutes}
                    trackColor={{ false: RivalColors.surfaceContainerHigh, true: RivalColors.accentFill }}
                    thumbColor="#ffffff"
                    {...(Platform.OS === 'web' ? ({ activeThumbColor: '#ffffff' } as any) : {})}
                    accessibilityLabel="Share route maps with teams"
                  />
                </View>
                <Text style={s.body}>Show the route of each activity to teammates. A route can reveal where a person lives or trains. Off unless turned on.</Text>
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity style={[s.primary, saving && { opacity: 0.5 }]} onPress={agree} disabled={saving} accessibilityRole="button">
          <Text style={s.primaryText}>{isReview ? 'Agree and save' : 'Agree and connect Strava'}</Text>
        </TouchableOpacity>
        {error && <Text style={rm.error}>{error}</Text>}
        <TouchableOpacity style={s.ghost} onPress={leave} accessibilityRole="button">
          <Text style={s.ghostText}>Not now</Text>
        </TouchableOpacity>
        {isReview && (
          <Text style={s.hint}>To stop sharing activities, disconnect Strava in Settings.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingBottom: 120 },
  list: { gap: 0, paddingVertical: 4 },
  intro: { fontSize: 13, lineHeight: 18.5, color: RivalColors.textSecondary, paddingVertical: 10 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: '#fff' },
  body: { fontSize: 13, lineHeight: 18.5, color: RivalColors.textSecondary },
  switchHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  required: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  primary: { paddingVertical: 14, borderRadius: 999, alignItems: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, marginTop: 4 },
  primaryText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  ghost: { paddingVertical: 13, borderRadius: 999, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)' },
  ghostText: { fontSize: 14.5, fontWeight: '700', color: RivalColors.accentText },
  hint: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
});
