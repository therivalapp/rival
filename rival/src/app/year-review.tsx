import { formatDistance, formatDistanceWhole, formatElevation } from '../lib/units';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { fetchAllActivities } from '../lib/fetchAllActivities';
import { getCurrentSeasonYear } from '../lib/season';
import { getLevel } from '../lib/xp';
import { notify } from '../lib/notify';
import { fetchReactionsOn, impactTotals, type ImpactTotals } from '../lib/reactions';
import { inLocalYear, buildYearReview, activityDisplayName, formatMinutes, type YearReview } from '../lib/yearReview';
import { RivalIcon, RivalTopNav, RivalMobileHeader, RivalWarm, rm, rb, GreyPageHead, activityIconName, type RivalIconName } from '../components/rival';
import { RivalColors, RivalFontFamily, RivalSerifFamily } from '../constants/rivalTheme';
import { rankTextSheen } from '../constants/rankSheen';
import { goToTab } from '../lib/tabNav';

// Year in review: a person's whole year of training, reachable from the
// January card on Home, the December countdown, and each year on Stats.
//
// Everything they did counts. Distance and elevation appear only when there
// is some, so nobody's year is summed up by a "0 km"; the "By activity" list
// names every kind of session they logged, however few.
//
// Built new rather than on /recap?type=yearly: that screen's figures come from
// a server function that counts the year in UTC and names it a Christmas
// wrap-up. Ranks and Home count the year in the person's own time zone, and
// this has to agree with them.

type Stat = { icon: RivalIconName; value: string; label: string };

export default function YearReviewScreen() {
  const params = useLocalSearchParams<{ year?: string }>();
  const currentYear = getCurrentSeasonYear();
  const year = Number(params.year) || currentYear;
  const isCurrent = year === currentYear;

  const [review, setReview] = useState<YearReview | null>(null);
  const [rank, setRank] = useState<{ name: string; level: number } | null>(null);
  const [impact, setImpact] = useState<ImpactTotals | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) { setError('Sign in to see the year in review.'); return; }
      const [activities, resultsRes] = await Promise.all([
        fetchAllActivities(user.id, 'id, started_at, activity_type, effort_score, duration_seconds, distance_meters, elevation_meters'),
        supabase.from('season_results').select('final_xp, final_rank_name, seasons(year)').eq('user_id', user.id),
      ]);
      const r = buildYearReview(activities, year);
      setReview(r);
      // A finished year uses the rank recorded when it closed; the year in
      // progress (or one that closed before recording existed) uses its Effort.
      const saved = (resultsRes.data || []).find((row: any) => row.seasons?.year === year);
      const lvl = getLevel(saved ? Number(saved.final_xp) : r.effort);
      setRank({ name: saved?.final_rank_name || lvl.name, level: lvl.level });
      // Recognition on this year's activities — shown once there is some.
      const yearIds = activities.filter((a: any) => inLocalYear(a.started_at, year)).map((a: any) => a.id);
      fetchReactionsOn(yearIds).then((rows) => setImpact(impactTotals(rows, user.id))).catch(() => {});
    })().catch(() => setError('The year in review could not be loaded. Try again.'));
  }, [year]);

  async function share() {
    if (!review || !rank) return;
    const parts = [
      `${rank.name}`,
      `${review.effort.toLocaleString()} Effort`,
      `${review.count.toLocaleString()} ${review.count === 1 ? 'activity' : 'activities'}`,
      formatMinutes(review.minutes),
      review.km > 0 ? formatDistanceWhole(review.km) : null,
      impact && impact.respect > 0 ? `${impact.respect.toLocaleString()} Respect` : null,
    ].filter(Boolean);
    const message = `${isCurrent ? `My ${year} so far` : `My ${year}`} on RIVAL: ${parts.join(' · ')}`;
    try {
      if (Platform.OS === 'web') {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (nav?.share) { await nav.share({ text: message }); return; }
        await nav?.clipboard?.writeText(message);
        notify('Copied', 'The summary is ready to paste.');
      } else {
        await Share.share({ message });
      }
    } catch {
      // Closing the share sheet is not an error worth reporting.
    }
  }


  const stats: Stat[] = review ? ([
    { icon: 'workout', value: review.count.toLocaleString(), label: review.count === 1 ? 'Activity' : 'Activities' },
    { icon: 'timer', value: formatMinutes(review.minutes), label: 'Time trained' },
    { icon: 'calendar', value: review.activeDays.toLocaleString(), label: 'Active days' },
    review.km > 0 ? { icon: 'distance', value: formatDistanceWhole(review.km), label: 'Distance' } : null,
    review.elevM > 0 ? { icon: 'elevation', value: formatElevation(review.elevM), label: 'Elevation' } : null,
    review.longestWeekStreak > 0
      ? { icon: 'fire', value: `${review.longestWeekStreak} ${review.longestWeekStreak === 1 ? 'week' : 'weeks'}`, label: 'Longest streak' }
      : null,
  ].filter(Boolean) as Stat[]) : [];

  const shortDate = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <SafeAreaView style={rb.page} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={[rb.content, s.content]}>
        <GreyPageHead kicker={isCurrent ? 'SO FAR THIS YEAR' : String(year)} title="Year in review" onBack={() => (router.canGoBack() ? router.back() : goToTab('/home'))} />

        {error ? <Text style={rm.error}>{error}</Text> : null}
        {!review && !error ? <Text style={[rm.hint, { textAlign: 'center', marginTop: 40 }]}>Loading…</Text> : null}

        {review && rank && (
          <>
            <View style={[rb.card, rb.hero, s.hero]}>
              <View style={s.ruleRow}>
                <View style={[s.rule, s.ruleLeft]} />
                <Text style={s.ruleText}>{isCurrent ? 'So far this year' : 'Year in review'}</Text>
                <View style={[s.rule, s.ruleRight]} />
              </View>
              <Text style={s.title}>{year}</Text>
              <Text style={[s.rank, rankTextSheen(rank.level)]}>{rank.name}</Text>
              <Text style={s.caps}>{isCurrent ? 'Rank so far' : 'Final rank'}</Text>
              <Text style={s.effort}>{review.effort.toLocaleString()}</Text>
              <Text style={s.capsAccent}>Total Effort</Text>
            </View>

            {review.count === 0 ? (
              <View style={[rb.card, { alignItems: 'center' }]}>
                <Text style={rm.serifTitleSm}>No activities in {year}</Text>
                <Text style={[rm.hint, { textAlign: 'center' }]}>Activities logged or synced in {year} will appear here.</Text>
              </View>
            ) : (
              <>
                <View style={s.grid}>
                  {stats.map((st) => (
                    <View key={st.label} style={[rb.card, s.statCard]}>
                      <RivalIcon name={st.icon} size={17} color={RivalColors.accentFill} />
                      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>{st.value}</Text>
                      <Text style={s.statLabel}>{st.label}</Text>
                    </View>
                  ))}
                </View>

                {review.topActivity && (
                  <View style={[rb.card, s.rowCard]}>
                    <View style={rm.iconCircle}><RivalIcon name={activityIconName(review.topActivity.type)} size={20} color={RivalColors.accentText} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={rb.label}>Top activity</Text>
                      <Text style={rm.serifTitleSm}>{activityDisplayName(review.topActivity.type)}</Text>
                      <Text style={rm.hint}>
                        {review.topActivity.count.toLocaleString()} {review.topActivity.count === 1 ? 'activity' : 'activities'} · {formatMinutes(review.topActivity.minutes)}
                      </Text>
                    </View>
                  </View>
                )}

                {impact && impact.respect + impact.inspired > 0 && (
                  <View style={[rb.card, { gap: 12 }]}>
                    <Text style={rb.label}>Recognition</Text>
                    <View style={{ flexDirection: 'row' }}>
                      {[
                        { icon: 'respect' as const, value: impact.respect, label: 'Respect' },
                        { icon: 'impact' as const, value: impact.inspired, label: 'Inspired' },
                        { icon: 'groups' as const, value: impact.people, label: 'People' },
                      ].map((f, i) => (
                        <View key={f.label} style={[s.impactCell, i > 0 && s.impactCellBorder]}>
                          <RivalIcon name={f.icon} size={16} color={RivalColors.accentFill} />
                          <Text style={s.statValue}>{f.value.toLocaleString()}</Text>
                          <Text style={s.statLabel}>{f.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                <View style={[rb.card, { gap: 14 }]}>
                  <Text style={rb.label}>Highlights</Text>
                  {review.bestWeek && (
                    <Highlight icon="trophy" title="Best week" value={`${review.bestWeek.effort.toLocaleString()} Effort`} note={`Week of ${shortDate(review.bestWeek.start)}`} />
                  )}
                  {review.longestSession && (
                    <Highlight
                      icon="timerOutline"
                      title="Longest activity"
                      value={formatMinutes(review.longestSession.minutes)}
                      note={`${activityDisplayName(review.longestSession.type)} · ${shortDate(review.longestSession.date)}`}
                    />
                  )}
                  {review.farthest && (
                    <Highlight
                      icon="distance"
                      title="Farthest"
                      value={formatDistance(review.farthest.km)}
                      note={`${activityDisplayName(review.farthest.type)} · ${shortDate(review.farthest.date)}`}
                    />
                  )}
                </View>

                <View style={[rb.card, { gap: 12 }]}>
                  <Text style={rb.label}>By activity</Text>
                  {review.byActivity.map((b, i) => (
                    <View key={b.type} style={[s.typeRow, i > 0 && s.typeRowBorder]}>
                      <RivalIcon name={activityIconName(b.type)} size={18} color={RivalColors.accentFill} />
                      <Text style={s.typeName} numberOfLines={1}>{activityDisplayName(b.type)}</Text>
                      <Text style={s.typeMeta}>
                        {b.count.toLocaleString()} {b.count === 1 ? 'activity' : 'activities'} · {b.km > 0 ? formatDistanceWhole(b.km) : formatMinutes(b.minutes)}
                      </Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity style={rm.primary} onPress={share} accessibilityRole="button">
                  <RivalIcon name="openInNew" size={17} color={RivalColors.onAccentFill} />
                  <Text style={rm.primaryText}>Share</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Highlight({ icon, title, value, note }: { icon: RivalIconName; title: string; value: string; note: string }) {
  return (
    <View style={s.highlight}>
      <View style={rm.iconCircle}><RivalIcon name={icon} size={18} color={RivalColors.accentText} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.highlightTitle}>{title}</Text>
        <Text style={rm.hint}>{note}</Text>
      </View>
      <Text style={s.highlightValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingBottom: 120 },
  hero: { alignItems: 'center', paddingVertical: 26 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rule: { width: 30, height: 1 },
  ruleLeft: Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,181,158,0) 0%, rgba(255,181,158,0.5) 100%)' } as any)
    : { backgroundColor: 'rgba(255,181,158,0.3)' },
  ruleRight: Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,181,158,0.5) 0%, rgba(255,181,158,0) 100%)' } as any)
    : { backgroundColor: 'rgba(255,181,158,0.3)' },
  ruleText: { fontFamily: RivalFontFamily, fontSize: 10.5, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: RivalColors.accentText },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 34, lineHeight: 40, color: '#fff', marginTop: 6 },
  rank: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, lineHeight: 30, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 14 },
  caps: { fontFamily: RivalFontFamily, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', color: RivalWarm.muted },
  effort: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 46, lineHeight: 52, color: '#f3c3b1', marginTop: 16 },
  capsAccent: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: RivalColors.accentText },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flexBasis: '47%', flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 16 },
  statValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, lineHeight: 28, color: '#fff' },
  statLabel: { fontFamily: RivalFontFamily, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: RivalWarm.soft },
  impactCell: { flex: 1, alignItems: 'center', gap: 6 },
  impactCellBorder: { borderLeftWidth: 1, borderLeftColor: RivalWarm.hairline },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  highlight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  highlightTitle: { fontFamily: RivalFontFamily, fontSize: 14.5, fontWeight: '700', color: '#fff' },
  highlightValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: RivalColors.accentText },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 2 },
  typeRowBorder: { borderTopWidth: 1, borderTopColor: RivalWarm.hairline, paddingTop: 12 },
  typeName: { flex: 1, fontFamily: RivalFontFamily, fontSize: 14.5, fontWeight: '600', color: '#fff' },
  typeMeta: { fontFamily: RivalFontFamily, fontSize: 13, color: RivalWarm.soft },
});
