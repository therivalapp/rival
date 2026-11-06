import { useEffect, useState } from 'react';
import { RivalButtonColors, RivalColors, RivalGhost, RivalMainGlow, RivalSerifFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { Platform, StyleSheet, View, Text, ScrollView, TouchableOpacity, useWindowDimensions } from 'react-native';
import { goToTab } from '../lib/tabNav';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { fetchAllActivities } from '../lib/fetchAllActivities';
import { ACHIEVEMENTS, CATEGORY_LABELS, checkAchievements } from '../lib/achievements';
import { calculateStreak } from '../lib/streak';
import { CoverImage } from '../components/rival/CoverImage';
import { SkyBackdrop } from '../components/rival/SkyBackdrop';
import { activityIconName } from '../components/rival/RivalIcon';
import { ActivityDiaryViewer, type DiaryActivity } from '../components/rival/ActivityDiaryViewer';
import { onActivityDeleted } from '../lib/activityEvents';
import { yearAchievements, type EarnedAchievement, type YearActivity } from '../lib/yearAchievements';
import { RivalIcon, RivalTopNav, RivalPageHeader, RivalBackButton, RivalMobileHeader, RivalWarm, rm, rb, GreyPageHead, GREY_PAGE_BG, type RivalIconName } from '../components/rival';

// Real icons on phones instead of the achievement's emoji: one per category.
const CATEGORY_ICON: Record<string, RivalIconName> = {
  firsts: 'star', streak: 'fire', activities: 'checkCircle', distance: 'distance', elevation: 'elevation', rank: 'crown',
};

export default function AchievementsScreen() {
  const { width } = useWindowDimensions();
  const wide = sidePageWide(width);
  const [earnedIds, setEarnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [newlyEarned, setNewlyEarned] = useState<string[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);

  useEffect(() => { if (wide) load(); }, [wide]);

  async function load() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;

    // started_at is required by calculateStreak — without it every row is
    // skipped and streak achievements can never unlock.
    const activities = await fetchAllActivities(
      user.id,
      'activity_type, distance_meters, elevation_meters, effort_score, started_at'
    );

    const totalXp = activities.reduce((s, a) => s + (a.effort_score || 0), 0);
    const streak = calculateStreak(activities);
    const calculated = checkAchievements(activities, totalXp, streak.longestEver);

    // Load already-saved achievements
    const { data: saved } = await supabase
      .from('user_achievements')
      .select('achievement_id')
      .eq('user_id', user.id);

    const savedIds = new Set((saved || []).map((r: any) => r.achievement_id));

    // Find newly earned ones not yet saved
    const toSave = calculated.filter((id) => !savedIds.has(id));
    if (toSave.length > 0) {
      // Auto-awarded while viewing; they'll be re-checked next visit, so this
      // logs rather than interrupts.
      const { error: awardErr } = await supabase.from('user_achievements').insert(
        toSave.map((achievement_id) => ({ user_id: user.id, achievement_id }))
      );
      if (awardErr) console.error('Achievement award failed:', awardErr.message);
      setNewlyEarned(toSave);
    }

    setEarnedIds(new Set(calculated));
    setLoading(false);
  }

  const categories = ['firsts', 'streak', 'activities', 'distance', 'elevation', 'rank'];
  const earnedCount = ACHIEVEMENTS.filter((a) => earnedIds.has(a.id)).length;

  // Phones: one year at a time, as photo tiles (Ricky, 2026-11-02).
  if (!wide) return <AchievementsPhone />;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
        </View>

        <RivalPageHeader title="Achievements" subtitle={`${earnedCount} of ${ACHIEVEMENTS.length} unlocked`} />

        {newlyEarned.length > 0 && (
          <View style={styles.newBanner}>
            <Text style={styles.newBannerTitle}>New unlocks</Text>
            <Text style={styles.newBannerSub}>
              {newlyEarned.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.name).join(', ')}
            </Text>
          </View>
        )}

        {loading && <Text style={styles.emptyText}>Loading…</Text>}

        {!loading && categories.map((cat) => {
          const items = ACHIEVEMENTS.filter((a) => a.category === cat);
          return (
            <View key={cat} style={styles.section}>
              <Text style={styles.sectionTitle}>{CATEGORY_LABELS[cat]}</Text>
              <View style={styles.grid}>
                {items.map((achievement) => {
                  const earned = earnedIds.has(achievement.id);
                  const isNew = newlyEarned.includes(achievement.id);
                  return (
                    <View
                      key={achievement.id}
                      style={[
                        styles.badge,
                        earned ? styles.badgeEarned : styles.badgeLocked,
                        isNew && styles.badgeNew,
                      ]}
                    >
                      <Text style={[styles.badgeIcon, !earned && styles.badgeIconLocked]}>
                        {earned ? achievement.icon : '🔒'}
                      </Text>
                      <Text style={[styles.badgeName, !earned && styles.badgeNameLocked]}>
                        {achievement.name}
                      </Text>
                      <Text style={[styles.badgeDesc, !earned && styles.badgeDescLocked]}>
                        {achievement.desc}
                      </Text>
                      {isNew && <View style={styles.newDot} />}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.pageGround },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 },
  header: { marginBottom: 0 },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 24 },
  newBanner: {
    backgroundColor: '#fbbf2420',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fbbf2440',
    padding: 14,
    marginBottom: 24,
    gap: 4,
  },
  newBannerTitle: { fontSize: 15, fontWeight: '800', color: RivalColors.accentGold },
  newBannerSub: { fontSize: 13, color: '#fcd34d' },
  emptyText: { color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: RivalColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  badge: {
    width: '30%',
    flexGrow: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    position: 'relative',
  },
  badgeEarned: {
    backgroundColor: RivalColors.pageGround,
    borderColor: RivalColors.accentFill,
  },
  badgeLocked: {
    backgroundColor: '#1E1E1E',
    borderColor: RivalColors.surfaceHigh,
  },
  badgeNew: {
    borderColor: RivalColors.accentGold,
    backgroundColor: '#fbbf2411',
  },
  badgeIcon: { fontSize: 28 },
  badgeIconLocked: { opacity: 0.3 },
  badgeName: {
    fontSize: 12,
    fontWeight: '800',
    color: RivalColors.textPrimary,
    textAlign: 'center',
  },
  badgeNameLocked: { color: '#444444' },
  badgeDesc: {
    fontSize: 10,
    color: RivalColors.textSecondary,
    textAlign: 'center',
    lineHeight: 14,
  },
  badgeDescLocked: { color: '#444444' },
  newDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RivalColors.accentGold,
  },
});

// Mobile only — the RIVAL look (see RivalMobile.tsx).
// Mobile only — the blend (see RivalGreySheet's rb).
const ms = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  content: { paddingHorizontal: 16, paddingBottom: 140, gap: 12 },
  years: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  yearPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,181,158,0.25)' },
  yearPillOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' },
  yearText: { fontSize: 12.5, fontWeight: '800', color: 'rgba(255,255,255,0.6)' },
  yearTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  sum: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#2c2a29', borderWidth: 1, borderColor: RivalGhost.border, ...RivalMainGlow },
  sumBig: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 40, lineHeight: 44, color: '#fff' },
  sumOf: { fontSize: 18, color: 'rgba(255,255,255,0.5)' },
  sumText: { fontSize: 12.5, lineHeight: 17, color: RivalColors.textSecondary },
  sumBold: { fontWeight: '700', color: '#fff' },
  bar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 7, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  lab: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginHorizontal: 4, marginBottom: -4 },
  labText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: '#A0A0A0' },
  labRight: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  quiet: { textAlign: 'center', fontSize: 13, color: RivalColors.textSecondary, paddingVertical: 12 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid3: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '45%', height: 160, borderRadius: 18, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#232120' },
  sky: { alignItems: 'center', justifyContent: 'center' },
  tileShade: Platform.OS === 'web' ? ({ backgroundImage: 'linear-gradient(180deg, rgba(10,9,8,0) 30%, rgba(10,9,8,0.9) 100%)' } as any) : { backgroundColor: 'rgba(10,9,8,0.35)' },
  pill: { position: 'absolute', top: 8, alignSelf: 'center', paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(14,13,12,0.55)' },
  pillText: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 13, color: '#fff' },
  tileFoot: { paddingHorizontal: 12, paddingBottom: 10 },
  tileValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, lineHeight: 28, color: '#fff' },
  unit: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  tileLabel: { fontSize: 12.5, fontWeight: '800', color: '#fff' },
  tileName: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText, marginTop: 1 },
  lock: { flexGrow: 1, flexBasis: '30%', height: 118, borderRadius: 16, overflow: 'hidden', paddingHorizontal: 10, paddingBottom: 9, justifyContent: 'flex-end', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.28)', backgroundColor: 'rgba(255,209,190,0.03)' },
  lockArt: { position: 'absolute', top: -2, right: -4 },
  lockValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, lineHeight: 23, color: 'rgba(255,255,255,0.5)' },
  lockLabel: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.45)', marginTop: 1 },
  lockBar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 6, overflow: 'hidden' },
  lockFill: { height: '100%', backgroundColor: 'rgba(255,181,158,0.7)' },
  lockProgress: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)', marginTop: 3 },
});

// ---- Phone ------------------------------------------------------------------

const LADDER_ICON: Record<string, RivalIconName> = {
  streak: 'fire', time: 'timer', activities: 'checkCircle', distance: 'distance', elevation: 'elevation', rank: 'crown',
};

function AchievementsPhone() {
  const thisYear = new Date().getFullYear();
  const [activities, setActivities] = useState<YearActivity[] | null>(null);
  const [year, setYear] = useState(thisYear);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      const rows = await fetchAllActivities(user.id, 'id, name, activity_type, started_at, duration_seconds, distance_meters, elevation_meters, effort_score, effort_confirmed, photo_url, photo_focal_x, photo_focal_y, notes, location, companions, shared_from_activity_id, pinned, race_id');
      setActivities(rows as YearActivity[]);
    })();
  }, []);

  const first = activities?.reduce<string | null>((m, a) => (!m || a.started_at < m ? a.started_at : m), null);
  const firstYear = first ? new Date(first).getFullYear() : thisYear;
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i);
  const { earned, next, total } = yearAchievements(activities ?? [], year);
  const current = year === thisYear;
  const newestFirst = [...earned].reverse();

  // Tapping a tile opens the activity that earned it; swiping moves through
  // the other activities that earned something this year.
  const [diaryIndex, setDiaryIndex] = useState<number | null>(null);
  const [patches, setPatches] = useState<Record<string, Partial<DiaryActivity>>>({});
  const [media, setMedia] = useState<Record<string, { url: string; type: 'photo' | 'video'; focalX?: number | null; focalY?: number | null }[]>>({});
  const diaryList: DiaryActivity[] = [...new Map(newestFirst.map((e) => [e.activity.id, e.activity as any])).values()].map((a: any) => ({
    id: a.id, name: a.name ?? null, activity_type: a.activity_type, started_at: a.started_at,
    duration_seconds: a.duration_seconds || 0, distance_meters: a.distance_meters || 0, elevation_meters: a.elevation_meters,
    effort_score: a.effort_score || 0, effort_confirmed: a.effort_confirmed,
    photo_url: a.photo_url ?? null, photo_focal_x: a.photo_focal_x ?? null, photo_focal_y: a.photo_focal_y ?? null,
    notes: a.notes ?? null, location: a.location ?? null, companions: a.companions ?? null,
    shared_from_activity_id: a.shared_from_activity_id ?? null, pinned: !!a.pinned, race_id: a.race_id ?? null, isPb: false,
    ...patches[a.id],
  }));
  const open = (id: string) => {
    const i = diaryList.findIndex((a) => a.id === id);
    if (i < 0) return;
    setDiaryIndex(i);
    supabase.from('activity_media').select('activity_id, media_url, media_type, focal_x, focal_y, position').in('activity_id', diaryList.map((a) => a.id)).order('position', { ascending: true })
      .then(({ data, error }) => {
        if (error || !data) return;
        const next: typeof media = {};
        for (const m of data as any[]) (next[m.activity_id] ??= []).push({ url: m.media_url, type: m.media_type, focalX: m.focal_x, focalY: m.focal_y });
        setMedia(next);
      });
  };
  useEffect(() => onActivityDeleted(() => setDiaryIndex(null)), []);

  return (
    <SafeAreaView style={ms.page} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={ms.content}>
        <GreyPageHead kicker={String(year)} title="Achievements" onBack={() => (router.canGoBack() ? router.back() : goToTab('/home'))} />

        {years.length > 1 ? (
          <View style={ms.years}>
            {years.map((y) => (
              <TouchableOpacity key={y} style={[ms.yearPill, y === year && ms.yearPillOn]} onPress={() => setYear(y)} accessibilityRole="button" accessibilityState={{ selected: y === year }}>
                <Text style={[ms.yearText, y === year && ms.yearTextOn]}>{y}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <View style={ms.sum}>
          <Text style={ms.sumBig}>{earned.length}<Text style={ms.sumOf}> / {total}</Text></Text>
          <View style={{ flex: 1 }}>
            <Text style={ms.sumText}>
              <Text style={ms.sumBold}>{current ? 'Earned this year.' : `Earned in ${year}.`}</Text>
              {current ? ' Everything starts again on 1 January.' : ''}
            </Text>
            <View style={ms.bar}><View style={[ms.barFill, { width: `${Math.round(earned.length / total * 100)}%` as any }]} /></View>
          </View>
        </View>

        {activities === null ? <Text style={ms.quiet}>Loading…</Text> : null}

        {newestFirst.length ? (
          <>
            <View style={ms.lab}><Text style={ms.labText}>Earned</Text><Text style={ms.labRight}>{newestFirst.length}</Text></View>
            <View style={ms.grid2}>{newestFirst.map((e) => <EarnedTile key={e.key} e={e} onPress={() => open(e.activity.id)} />)}</View>
          </>
        ) : activities ? (
          <Text style={ms.quiet}>{current ? 'The first activity of the year earns the first one.' : `Nothing earned in ${year}.`}</Text>
        ) : null}

        {current && next.length && activities ? (
          <>
            <View style={ms.lab}><Text style={ms.labText}>Next up</Text><Text style={ms.labRight}>{total - earned.length} left</Text></View>
            <View style={ms.grid3}>
              {next.map((n) => (
                <View key={n.key} style={ms.lock}>
                  <View style={[ms.lockArt, { pointerEvents: 'none' }]}><RivalIcon name={LADDER_ICON[n.ladder] ?? 'medal'} size={52} color="rgba(255,255,255,0.06)" /></View>
                  <Text style={ms.lockValue} numberOfLines={1} adjustsFontSizeToFit>{n.value}{n.unit ? <Text style={ms.unit}> {n.unit}</Text> : null}</Text>
                  <Text style={ms.lockLabel}>{n.label}</Text>
                  <View style={ms.lockBar}><View style={[ms.lockFill, { width: `${Math.min(100, Math.round(n.current / n.target * 100))}%` as any }]} /></View>
                  <Text style={ms.lockProgress} numberOfLines={1}>{n.progress}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
      {diaryIndex !== null ? (
        <ActivityDiaryViewer
          activities={diaryList}
          startIndex={diaryIndex}
          mediaById={media}
          onClose={() => setDiaryIndex(null)}
          onUpdate={(id, patch) => setPatches((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }))}
        />
      ) : null}
    </SafeAreaView>
  );
}

/** The activity that earned it: its photo, or its sky and icon when there is none. */
function EarnedTile({ e, onPress }: { e: EarnedAchievement; onPress: () => void }) {
  const a = e.activity;
  const date = new Date(a.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <TouchableOpacity style={ms.tile} activeOpacity={0.85} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${e.value}${e.unit ? ` ${e.unit}` : ''} ${e.label}, open the activity`}>
      {a.photo_url ? (
        <CoverImage uri={a.photo_url} focalX={a.photo_focal_x} focalY={a.photo_focal_y} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, ms.sky]}>
          <SkyBackdrop startedAt={a.started_at} />
          <RivalIcon name={activityIconName(a.activity_type)} size={56} color="rgba(255,255,255,0.35)" />
        </View>
      )}
      <View style={[StyleSheet.absoluteFill, ms.tileShade, { pointerEvents: 'none' }]} />
      <View style={ms.pill}><Text style={ms.pillText}>{date}</Text></View>
      <View style={ms.tileFoot}>
        <Text style={ms.tileValue} numberOfLines={1} adjustsFontSizeToFit>{e.value}{e.unit ? <Text style={ms.unit}> {e.unit}</Text> : null}</Text>
        <Text style={ms.tileLabel}>{e.label}</Text>
        {/* Only a name that fits: a cut-off one reads as broken. */}
        {a.name && a.name.length <= 24 ? <Text style={ms.tileName}>{a.name}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}
