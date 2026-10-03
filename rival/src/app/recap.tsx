import { distanceNumber, distanceUnit, elevationNumber, elevationUnit } from '../lib/units';
import { useEffect, useState } from 'react';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { goToTab } from '../lib/tabNav';
import { RivalIcon, RivalTopNav, RivalBackButton, RivalMobileHeader, RivalWarm, rm, rb, GreyPageHead, activityIconName } from '../components/rival';

type RecapData = {
  type: string;
  label: string;
  total_workouts: number;
  total_hours: number;
  total_minutes_remainder: number;
  total_distance_km: number;
  total_elevation_m: number;
  total_effort: number;
  top_sport: string | null;
  best_week_label: string | null;
  best_week_effort: number;
  prev_total_workouts: number | null;
  prev_total_minutes: number | null;
};

export default function RecapScreen() {
  // Phone: the RIVAL look, real icons in place of emoji.
  const { width } = useWindowDimensions();
  const m = width < BREAKPOINT_WIDE_LAYOUT;
  const { type } = useLocalSearchParams<{ type?: string }>();
  const recapType = type ?? 'monthly';
  const [recap, setRecap] = useState<RecapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, [recapType]);

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError('Sign in to view the recap.'); setLoading(false); return; }

    const res = await fetch(
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/generate-recap?type=${recapType}`,
      {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
      }
    );
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? 'Failed to load recap'); return; }
    setRecap(data);
  }

  function formatTrend(current: number, prev: number | null, unit: string) {
    if (prev === null) return null;
    const diff = current - prev;
    if (diff === 0) return `Same as last month`;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff} ${unit} vs last month`;
  }

  return (
    <SafeAreaView style={[styles.container, m && rb.page]} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={[styles.content, m && ms.content]}>
        {m ? (
          <GreyPageHead kicker={recap?.label ? String(recap.label).toUpperCase() : 'RECAP'} title="Recap" onBack={() => (router.canGoBack() ? router.back() : goToTab('/home'))} />
        ) : (
          <View style={styles.header}>
            <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
          </View>
        )}

        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator color={RivalColors.accentText} size="large" />
            <Text style={styles.loadingText}>Building recap…</Text>
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        {recap && !loading && (
          <>
            {/* Hero */}
            <View style={[styles.heroBlock, m && ms.heroBlock]}>
              {recap.type === 'yearly' ? (
                <>
                  {m ? <View style={rm.iconCircle}><RivalIcon name="star" size={20} color={RivalColors.accentText} /></View> : <Text style={styles.heroEmoji}>🎄</Text>}
                  <Text style={[styles.heroTitle, m && ms.heroTitle]}>{m ? 'Christmas wrap-up' : 'Christmas Wrap Up'}</Text>
                  <Text style={[styles.heroSub, m && rb.label]}>{recap.label}</Text>
                </>
              ) : (
                <>
                  {m ? <View style={rm.iconCircle}><RivalIcon name="stats" size={20} color={RivalColors.accentText} /></View> : <Text style={styles.heroEmoji}>📊</Text>}
                  <Text style={[styles.heroTitle, m && ms.heroTitle]}>{recap.label}</Text>
                </>
              )}
            </View>

            {/* Time Earned — big headline */}
            {(recap.total_hours > 0 || recap.total_minutes_remainder > 0) && (
              <View style={[styles.timeHeroCard, m && [rb.card, rb.hero, ms.timeHero]]}>
                <Text style={styles.timeHeroLabel}>{m ? 'Time earned' : '⏱ Time Earned'}</Text>
                <Text style={[styles.timeHeroValue, m && ms.timeValue]}>
                  {recap.total_hours > 0 ? `${recap.total_hours.toLocaleString()}h ` : ''}{recap.total_minutes_remainder}m
                </Text>
                {recap.type === 'monthly' && recap.prev_total_minutes !== null && (
                  <Text style={[styles.timeHeroTrend, m && rm.hint]}>
                    {formatTrend(
                      recap.total_hours * 60 + recap.total_minutes_remainder,
                      recap.prev_total_minutes,
                      'min'
                    )}
                  </Text>
                )}
              </View>
            )}

            {/* Stats grid */}
            <View style={styles.statsGrid}>
              <View style={[styles.statCard, m && ms.card]}>
                <Text style={[styles.statValue, m && ms.serifNum]}>{recap.total_workouts}</Text>
                <Text style={styles.statLabel}>Workouts</Text>
                {recap.prev_total_workouts !== null && (
                  <Text style={styles.statTrend}>{formatTrend(recap.total_workouts, recap.prev_total_workouts, 'activities')}</Text>
                )}
              </View>
              <View style={[styles.statCard, m && ms.card]}>
                <Text style={[styles.statValue, m && ms.serifNum, { color: m ? RivalColors.accentText : RivalColors.accentFill }]}>{recap.total_effort.toLocaleString()}</Text>
                <Text style={styles.statLabel}>Total Effort</Text>
              </View>
              {recap.total_distance_km > 0 && (
                <View style={[styles.statCard, m && ms.card]}>
                  <Text style={[styles.statValue, m && ms.serifNum, !m && { color: '#4FC3F7' }]}>{distanceNumber(recap.total_distance_km)}</Text>
                  <Text style={styles.statLabel}>{distanceUnit()} covered</Text>
                </View>
              )}
              {recap.total_elevation_m > 0 && (
                <View style={[styles.statCard, m && ms.card]}>
                  <Text style={[styles.statValue, m && ms.serifNum, !m && { color: '#AB47BC' }]}>{elevationNumber(recap.total_elevation_m)}</Text>
                  <Text style={styles.statLabel}>{elevationUnit()} climbed</Text>
                </View>
              )}
            </View>

            {/* Top sport */}
            {recap.top_sport && (
              <View style={[styles.highlightCard, m && [ms.card, ms.highlight]]}>
                <Text style={m ? rb.label : styles.highlightLabel}>Top sport this period</Text>
                {m ? (
                  <View style={ms.sportRow}>
                    <View style={rm.iconCircle}><RivalIcon name={activityIconName(recap.top_sport)} size={20} color={RivalColors.accentText} /></View>
                    <Text style={[styles.highlightValue, ms.serifNum]}>{recap.top_sport}</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <RivalIcon name={activityIconName(recap.top_sport)} size={22} color={RivalColors.accentText} />
                    <Text style={styles.highlightValue}>{recap.top_sport}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Best week (yearly only) */}
            {recap.type === 'yearly' && recap.best_week_label && (
              <View style={[styles.highlightCard, m && [ms.card, ms.highlight]]}>
                <Text style={m ? rb.label : styles.highlightLabel}>{m ? 'Best week of the year' : '🔥 Best week of the year'}</Text>
                <Text style={[styles.highlightValue, m && ms.serifNum]}>w/c {recap.best_week_label}</Text>
                <Text style={styles.highlightSub}>{recap.best_week_effort.toLocaleString()} Effort</Text>
              </View>
            )}

            {/* Closing message */}
            <View style={[styles.closingCard, m && ms.card]}>
              <Text style={[styles.closingText, m && ms.closing]}>
                {recap.type === 'yearly'
                  ? `${recap.total_hours}h of your life invested into becoming better. That compounds. What will ${new Date().getFullYear() + 1} look like?`
                  : recap.total_workouts === 0
                    ? "Nothing logged this month — but you're still here. That matters. Next month starts fresh."
                    : `${recap.total_workouts} activities logged. Every one of them was a choice.`}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  header: { marginBottom: 16 },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  centered: { alignItems: 'center', marginTop: 80, gap: 16 },
  loadingText: { color: RivalColors.textSecondary, fontSize: 16 },
  errorText: { color: '#f87171', textAlign: 'center', marginTop: 40 },

  heroBlock: { alignItems: 'center', marginBottom: 28, gap: 4 },
  heroEmoji: { fontSize: 52 },
  heroTitle: { fontSize: 30, fontWeight: '900', color: RivalColors.textPrimary, textAlign: 'center' },
  heroSub: { fontSize: 14, color: RivalColors.textSecondary, textAlign: 'center' },

  timeHeroCard: { backgroundColor: '#0D1A0D', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,181,158,0.27)', gap: 6 },
  timeHeroLabel: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText, textTransform: 'uppercase', letterSpacing: 1 },
  timeHeroValue: { fontSize: 52, fontWeight: '900', color: RivalColors.accentText },
  timeHeroTrend: { fontSize: 12, color: '#4a7c4a' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: RivalColors.surfaceContainer, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 4 },
  statValue: { fontSize: 28, fontWeight: '900', color: RivalColors.textPrimary },
  statLabel: { fontSize: 11, color: RivalColors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  statTrend: { fontSize: 11, color: RivalColors.accentText, fontWeight: '600', marginTop: 2 },

  highlightCard: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 14, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 6 },
  highlightLabel: { fontSize: 12, color: RivalColors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  highlightValue: { fontSize: 22, fontWeight: '800', color: RivalColors.textPrimary },
  highlightSub: { fontSize: 13, color: RivalColors.accentFill, fontWeight: '700' },

  closingCard: { backgroundColor: '#1A0A12', borderRadius: 14, padding: 20, borderWidth: 1, borderColor: 'rgba(217,119,87,0.20)' },
  closingText: { fontSize: 15, color: '#CCCCCC', lineHeight: 24, fontStyle: 'italic', textAlign: 'center' },
});

// Phone only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 },
  heroBlock: { gap: 10, marginBottom: 20 },
  heroTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, lineHeight: 36 },
  timeHero: { alignItems: 'center' },
  timeValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700' },
  card: { backgroundColor: RivalColors.surfaceLowest, borderColor: RivalColors.surfaceBright, borderRadius: 16 },
  serifNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700' },
  highlight: { gap: 10 },
  sportRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  closing: { fontFamily: RivalSerifFamily, fontSize: 16, lineHeight: 24, color: 'rgba(255,255,255,0.75)' },
});
