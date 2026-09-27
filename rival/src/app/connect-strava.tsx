import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { connectStrava } from '../lib/strava';
import { agreeToStravaSharing, loadStravaSharing } from '../lib/stravaSharing';
import { ROUTE_MAPS_ENABLED } from '../lib/features';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import { RivalIcon, RivalMobileHeader, RivalWarm, rm } from '../components/rival';
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
    <SafeAreaView style={rm.page} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[rm.content, s.content]}>
        <RivalMobileHeader title={isReview ? 'Strava sharing' : 'Connect Strava'} onBack={leave} />

        <View style={[rm.hero, s.hero]}>
          <Text style={rm.label}>{isReview ? 'Review sharing' : 'Before connecting'}</Text>
          <Text style={rm.serifTitle}>Sharing with teams</Text>
          <Text style={rm.body}>
            RIVAL shows activities to the teams you belong to. Strava requires agreement before any of its data is shown to other people.
          </Text>
        </View>

        <View style={rm.card}>
          <View style={s.row}>
            <View style={rm.iconCircle}>
              <RivalIcon name="groups" size={20} color={RivalColors.accentText} />
            </View>
            <View style={s.rowText}>
              <Text style={s.rowTitle}>Activities</Text>
              <Text style={rm.body}>
                Activity type, name, date, duration, distance, elevation and Effort are shown to teammates in team feeds and standings.
              </Text>
              <Text style={s.required}>Required for teams</Text>
            </View>
          </View>
        </View>

        {ROUTE_MAPS_ENABLED && <View style={rm.card}>
          <View style={s.row}>
            <View style={rm.iconCircle}>
              <RivalIcon name="distance" size={20} color={RivalColors.accentText} />
            </View>
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
              <Text style={rm.body}>
                Show the route of each activity to teammates. A route can reveal where a person lives or trains.
              </Text>
              <Text style={rm.hint}>
                Off unless turned on. Check Strava privacy zones before sharing. This can be changed at any time in Settings.
              </Text>
            </View>
          </View>
        </View>}

        <TouchableOpacity
          style={[rm.primary, saving && rm.disabled]}
          onPress={agree}
          disabled={saving}
          accessibilityRole="button"
        >
          <Text style={rm.primaryText}>{isReview ? 'Agree and save' : 'Agree and connect'}</Text>
        </TouchableOpacity>
        {error && <Text style={rm.error}>{error}</Text>}
        <TouchableOpacity style={rm.ghost} onPress={leave} accessibilityRole="button">
          <Text style={rm.ghostText}>Not now</Text>
        </TouchableOpacity>
        {isReview && (
          <Text style={[rm.hint, s.center]}>
            To stop sharing activities, disconnect Strava in Settings.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  content: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  hero: { gap: 10 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  rowText: { flex: 1, gap: 6 },
  rowTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 18, fontWeight: '700', color: '#fff' },
  switchHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  required: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalWarm.muted, marginTop: 2 },
  center: { textAlign: 'center' },
});
