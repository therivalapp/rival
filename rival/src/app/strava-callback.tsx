import { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { runFullStravaImport } from '../lib/strava';
import { StravaImportReveal } from '../components/rival';

export default function StravaCallbackScreen() {
  const [status, setStatus] = useState('Connecting to Strava…');
  // Reveal state — set once the import genuinely finishes (not on a partial/
  // error outcome, where the plain status text stays the honest message).
  const [reveal, setReveal] = useState<{ seconds: number; effort: number; activities: number } | null>(null);

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

      setStatus("Don't close this tab yet — importing your full training history now. This can take a minute for a long history.");

      // Pull the user's entire Strava history, not just recent activities, so
      // connecting doesn't feel like starting their Effort/Time Earned from
      // zero. runFullStravaImport calls the edge function one page at a time
      // and keeps going while there's more — each call bounded enough to
      // avoid the server-side resource limit a single giant import used to
      // hit on a deep account. Must run to completion before this tab closes
      // — closing early kills whichever fetch is in flight, truncating it.
      const result = await runFullStravaImport(accessToken, (p) => {
        setStatus(`Don't close this tab yet — importing your training history. ${p.savedSoFar} activities imported…`);
      });

      if (!result.ok) {
        setStatus("Strava connected, but the history import didn't finish — you can re-run it anytime from your profile.");
        setTimeout(() => window.close(), 2500);
        return;
      }

      // No auto-close here — the reveal is the introduction to how Effort
      // works, and a tab that vanishes on a timer either rushes that or
      // cuts it off entirely. It closes when the user says it can.
      setReveal({ seconds: result.importedSeconds, effort: result.importedEffort, activities: result.saved });

    } catch (err) {
      console.error('Exchange error:', err);
      setStatus('Something went wrong. Try again.');
      setTimeout(() => window.close(), 2000);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>RIVAL</Text>
        {reveal ? (
          <StravaImportReveal
            seconds={reveal.seconds}
            effort={reveal.effort}
            activities={reveal.activities}
            ctaLabel="Continue"
            onDone={() => window.close()}
          />
        ) : (
          <Text style={styles.status}>{status}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 6,
    marginBottom: 24,
  },
  status: {
    fontSize: 16,
    color: '#999999',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
