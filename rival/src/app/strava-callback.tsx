import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { runFullStravaImport } from '../lib/strava';
import { supabase } from '../lib/supabase';
import { latestArrivals, loadHistoryReveal } from '../lib/historyReveal';
import { HistoryReveal, type RevealActivity } from '../components/rival/HistoryReveal';
import { RivalIcon, activityIconName } from '../components/rival';
import { RivalFontFamily, RivalSerifFamily } from '../constants/rivalTheme';
import { formatActivityDistance } from '../lib/units';

// Connecting Strava (Ricky, 2026-10-18): three screens, no spinner. While the
// history imports, it arrives live: photos fall into the collage, the hours
// count for real, the latest activities stream past. When it finishes, the
// same reveal as importing an archive. "See where you stand" opens Today,
// where the week's podium is the surprise.

type Arrival = { id: string; name: string | null; type: string; startedAt: string; distanceMeters: number | null };

export default function StravaCallbackScreen() {
  const [status, setStatus] = useState('Connecting to Strava…');
  const [live, setLive] = useState<{ count: number; seconds: number; list: Arrival[]; photos: string[] } | null>(null);
  const [reveal, setReveal] = useState<{ activities: RevealActivity[]; photoUrls: string[]; yearEffort: number } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const accessToken = urlParams.get('state');
    const error = urlParams.get('error');

    if (error || !code || !accessToken) {
      setStatus('The connection was cancelled or timed out. Try connecting again.');
      setTimeout(() => window.close(), 2000);
      return;
    }

    exchangeToken(code, accessToken);
  }, []);

  async function exchangeToken(code: string, accessToken: string) {
    try {
      setStatus('Saving connection…');

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/strava-token-exchange`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({ code }),
        }
      );

      const data = await response.json();

      if (!response.ok || data.error) {
        console.error('Edge function error:', data);
        setStatus(response.status === 409 && data.error ? data.error : "Couldn't connect Strava. Try again.");
        setTimeout(() => window.close(), response.status === 409 ? 4000 : 2000);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser(accessToken);
      setLive({ count: 0, seconds: 0, list: [], photos: [] });

      // The whole Strava history, one page per call (see runFullStravaImport).
      // Must run to completion before this tab closes; closing early stops
      // whichever page is in flight.
      const result = await runFullStravaImport(accessToken, (p) => {
        setLive((prev) => ({ ...(prev ?? { list: [], photos: [] }), count: p.savedSoFar, seconds: p.secondsSoFar }));
        if (user) latestArrivals(user.id).then((a) => setLive((prev) => (prev ? { ...prev, list: a.list, photos: a.photos } : prev))).catch(() => {});
      });

      if (!result.ok) {
        setLive(null);
        setStatus("Strava connected, but the history import didn't finish. It can be run again from Settings, Connected devices.");
        setTimeout(() => window.close(), 3000);
        return;
      }

      if (!user) { window.close(); return; }
      setReveal(await loadHistoryReveal(user.id));
    } catch (err) {
      console.error('Exchange error:', err);
      setLive(null);
      setStatus('Something went wrong. Try again.');
      setTimeout(() => window.close(), 2000);
    }
  }

  const finish = () => {
    window.close();
    // A home-screen app can't close its own window: go to Today instead.
    setTimeout(() => router.replace('/home'), 300);
  };

  if (reveal) {
    return (
      <HistoryReveal
        kicker="Strava connected"
        activities={reveal.activities}
        photoUrls={reveal.photoUrls}
        yearEffort={reveal.yearEffort}
        ctaLabel="See where you stand"
        onCta={finish}
      />
    );
  }
  if (live) return <Arriving {...live} />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>RIVAL</Text>
        <Text style={styles.status}>{status}</Text>
      </View>
    </SafeAreaView>
  );
}

// Screen 1 and 2: the history arriving. The hours shown are what has really
// landed so far; new activities slide in at the top, older ones fade below.
function Arriving({ count, seconds, list, photos }: { count: number; seconds: number; list: Arrival[]; photos: string[] }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.25, duration: 600, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  const hours = Math.floor(seconds / 3600);
  return (
    <SafeAreaView style={a.page} edges={['left', 'right']}>
      <View style={a.mosaicClip}>
        <View style={a.mosaic}>
          {Array.from({ length: 6 }).map((_, k) => (
            <View key={k} style={a.tile}>
              {photos[k] && Platform.OS === 'web' ? <img src={photos[k]} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt="" /> : null}
            </View>
          ))}
        </View>
        <View style={[a.fade, { pointerEvents: 'none' }]} />
      </View>
      <View style={a.body}>
        <View style={a.liveRow}>
          <Animated.View style={[a.dot, { opacity: pulse }]} />
          <Text style={a.kick}>Bringing in the history</Text>
        </View>
        <View>
          <View style={a.heroRow}><Text style={a.hero}>{hours}</Text><Text style={a.heroUnit}>h</Text></View>
          <Text style={a.heroLine}>and counting</Text>
          <Text style={a.heroSub}>{count.toLocaleString()} {count === 1 ? 'activity' : 'activities'} so far</Text>
        </View>
        <View style={{ gap: 6 }}>
          {list.map((it, k) => (
            <View key={it.id} style={[a.row, { opacity: [1, 0.6, 0.32][k] ?? 0.3 }]}>
              <View style={a.rowIcon}><RivalIcon name={activityIconName(it.type)} size={14} color="#ffb59e" /></View>
              <Text style={a.rowName} numberOfLines={1}>{it.name || it.type}</Text>
              <Text style={a.rowMeta}>
                {new Date(it.startedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                {it.distanceMeters ? ` · ${formatActivityDistance(it.distanceMeters, it.type)}` : ''}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  logo: { fontSize: 32, fontWeight: '900', color: '#FFFFFF', letterSpacing: 6, marginBottom: 24 },
  status: { fontSize: 16, color: '#999999', textAlign: 'center', paddingHorizontal: 40 },
});

const a = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#120f0e' },
  mosaicClip: { height: 340, overflow: 'hidden', position: 'relative' },
  mosaic: {
    position: 'absolute', top: -10, left: -30, right: -30, height: 330, flexDirection: 'row', flexWrap: 'wrap', gap: 3,
    transform: [{ rotate: '-6deg' }, { scale: 1.1 }], opacity: 0.85,
  },
  tile: { width: '32.6%', height: '49.5%', borderRadius: 6, overflow: 'hidden', backgroundColor: '#2a2522' },
  fade: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, rgba(18,15,14,0.25) 0%, rgba(18,15,14,0.55) 45%, #120f0e 92%)' } as any : { backgroundColor: 'rgba(18,15,14,0.5)' }),
  },
  body: { maxWidth: 560, width: '100%', alignSelf: 'center', marginTop: -200, paddingHorizontal: 20, gap: 16 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ffb59e' },
  kick: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 2.4, textTransform: 'uppercase', color: '#ffd3c2' },
  heroRow: { flexDirection: 'row', alignItems: 'baseline' },
  hero: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 82, lineHeight: 92, color: '#fff' },
  heroUnit: { fontFamily: RivalFontFamily, fontSize: 30, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginLeft: 4 },
  heroLine: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, lineHeight: 27, color: '#fff', marginTop: 2 },
  heroSub: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  rowIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,131,95,0.18)' },
  rowName: { flex: 1, fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.85)' },
  rowMeta: { fontFamily: RivalFontFamily, fontSize: 11.5, color: 'rgba(255,255,255,0.5)' },
});
