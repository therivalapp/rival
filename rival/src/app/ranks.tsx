import { useEffect, useState } from 'react';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import type { RivalIconName } from '../components/rival/RivalIcon';
import { rankBadgeSheen, rankSheen, rankTextSheen } from '../constants/rankSheen';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { getSeasonStartISO, getCurrentSeasonYear } from '../lib/season';
import { Platform, StyleSheet, View, Text, ScrollView, TouchableOpacity, useWindowDimensions } from 'react-native';
import { goToTab } from '../lib/tabNav';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { LEVELS, getLevel } from '../lib/xp';
import { rankPace, type RankPace } from '../lib/rankPace';
import { RivalIcon, RivalTopNav, RivalPageHeader, RivalBackButton, RivalMobileHeader, RivalWarm, rm, rb, GreyPageHead } from '../components/rival';

// A rough idea of the training each rank takes, for a person reading the list:
// Effort earned over a whole year at a typical mix of activities. About 70
// Effort an hour is the average across RIVAL's activities (a run earns ~80,
// a gym workout ~60), so this is a guide, not a promise.
const TYPICAL_EFFORT_PER_HOUR = 70;
// A realistic year of training — about six weeks go to holidays, illness,
// injury or a taper, so the weekly figure is spread over the rest.
const TRAINING_WEEKS = 46;

// "About 36 h of training", or once it's a regular habit, "About 230 h in
// the year · 4.5 h a week". The early ranks come in the first weeks, so a
// weekly figure for them (minutes) would describe nobody's actual training.
// The tiles' icons, by rank (level 1 first).
const RANK_ICONS: RivalIconName[] = [
  'rankRookie', 'rankHustler', 'rankWarrior', 'rankElite', 'rankChampion',
  'rankLegend', 'rankMythic', 'rankImmortal', 'rankGod', 'rankUnrivaled',
];

// A tile-sized guide: "3 h a week", or total hours for the first ranks.
function shortGuide(minXp: number): string | null {
  if (minXp <= 0) return null;
  const hours = minXp / TYPICAL_EFFORT_PER_HOUR;
  const perWeek = hours / TRAINING_WEEKS;
  if (perWeek < 1) return `About ${Math.max(1, Math.round(hours))} h`;
  const w = perWeek < 10 ? Math.round(perWeek * 2) / 2 : Math.round(perWeek);
  return `${w} h a week`;
}

function weeklyGuide(minXp: number): string | null {
  if (minXp <= 0) return null;
  const hours = minXp / TYPICAL_EFFORT_PER_HOUR;
  const total = hours < 20 ? Math.max(1, Math.round(hours)) : Math.round(hours / 5) * 5;
  const perWeek = hours / TRAINING_WEEKS;
  if (perWeek < 1) return `About ${total} h of training`;
  const w = perWeek < 10 ? Math.round(perWeek * 2) / 2 : Math.round(perWeek);
  return `About ${total} h in the year · ${w} h a week`;
}

export default function RanksScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;
  const [totalXp, setTotalXp] = useState(0);
  const [pace, setPace] = useState<RankPace | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      const { data } = await supabase
        .from('activities')
        .select('effort_score')
        .eq('user_id', user.id)
        // Rank is a season measure everywhere else (top bar, Home, Stats);
        // lifetime Effort here showed a rank the rest of the app didn't.
        .gte('started_at', getSeasonStartISO());
      const xp = data?.reduce((sum, a) => sum + (a.effort_score || 0), 0) ?? 0;
      setTotalXp(xp);

      // When their training began, for the pace projection: anyone with
      // activities from before this year is measured from 1 January.
      const { data: first } = await supabase
        .from('activities')
        .select('started_at')
        .eq('user_id', user.id)
        .order('started_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      setPace(rankPace({ yearEffort: xp, firstActivityEver: first ? new Date(first.started_at) : null }));
    }
    load();
  }, []);

  const currentLevel = getLevel(totalXp);

  if (!wide) {
    const next = LEVELS.find((l) => l.level === currentLevel.level + 1);
    const span = next ? next.minXp - currentLevel.minXp : 1;
    const pct = next ? Math.min(1, (totalXp - currentLevel.minXp) / span) : 1;
    return (
      <SafeAreaView style={rb.page} edges={['top', 'left', 'right']}>
        <RivalTopNav active="today" />
        <ScrollView contentContainerStyle={[rb.content, ms.content]}>
          <GreyPageHead kicker={String(getCurrentSeasonYear())} title="Ranks" onBack={() => (router.canGoBack() ? router.back() : goToTab('/home'))} />

          {/* The rank, and the Effort behind it, up front. */}
          <View style={[rb.card, rb.hero, ms.rankCard]}>
            <Text style={rb.label}>{getCurrentSeasonYear()} rank</Text>
            <Text style={rb.big}>{currentLevel.name}</Text>
            <View style={ms.effortRow}>
              <Text style={ms.effortNum}>{Math.round(totalXp).toLocaleString()}</Text>
              <Text style={ms.effortUnit}>Effort this year</Text>
            </View>
            {next ? (
              <>
                <View style={rb.bar}><View style={[rb.barFill, { width: `${Math.max(2, Math.round(pct * 100))}%` as any }]} /></View>
                <Text style={ms.sub}>{Math.max(0, Math.ceil(next.minXp - totalXp)).toLocaleString()} Effort to {next.name} · Level {currentLevel.level}</Text>
              </>
            ) : (
              <Text style={ms.sub}>The top rank.</Text>
            )}
          </View>

          {/* Where this year is heading. A projection only — rank is always
              what has been earned. A latecomer also sees what a full year at
              their pace would reach: something to aim at next year. */}
          {pace ? (
            <View style={[rb.card, ms.paceCard]}>
              <View style={ms.paceRow}>
                <View style={rb.badge}><RivalIcon name="trendUp" size={16} color={RivalColors.accentText} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={rb.label}>On pace for</Text>
                  <Text style={ms.paceRank}>{pace.yearEnd.level.name}</Text>
                  <Text style={ms.sub2}>About {pace.yearEnd.effort.toLocaleString()} Effort by 31 December at the current pace.</Text>
                </View>
              </View>
              {pace.fullYear ? (
                <View style={[ms.paceRow, rb.rule, ms.paceDivider]}>
                  <View style={rb.badge}><RivalIcon name="calendar" size={16} color={RivalColors.accentText} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={rb.label}>A full year at this pace</Text>
                    <Text style={ms.paceRank}>{pace.fullYear.level.name}</Text>
                    <Text style={ms.sub2}>
                      Based on training since {pace.start.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}. The first full year begins on 1 January.
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={rb.section}>All ranks</Text>
          {/* Every rank as a tile with its own icon and colour: earned ones
              lit, the current one highlighted with its progress, the next one
              showing what's left, the rest waiting. Unrivaled closes the
              ladder on its own wide tile. */}
          <View style={ms.grid}>
            {LEVELS.filter((l) => l.level < 10).map((lvl) => {
              const sheen = rankSheen(lvl.level);
              const isCurrent = lvl.level === currentLevel.level;
              const isEarned = totalXp >= lvl.minXp && !isCurrent;
              const isNext = lvl.level === currentLevel.level + 1;
              const lit = isEarned || isCurrent;
              const pct = isCurrent && Number.isFinite(lvl.maxXp) ? Math.min(1, (totalXp - lvl.minXp) / (lvl.maxXp - lvl.minXp)) : 0;
              const guide = shortGuide(lvl.minXp);
              return (
                <View key={lvl.level} style={[ms.tile, isCurrent && [rb.hero, { borderColor: sheen.light + '66' }]]}>
                  {isEarned ? (
                    <View style={ms.tileCorner}><RivalIcon name="checkBold" size={12} color={RivalColors.accentText} /></View>
                  ) : null}
                  {/* Each rank in its own material (constants/rankSheen.ts):
                      earned ones lit with a sheen, the rest waiting, dimmed. */}
                  <View style={[ms.tileIcon, rankBadgeSheen(lvl.level, lit)]}>
                    <RivalIcon name={RANK_ICONS[lvl.level - 1]} size={21} color={lit ? sheen.light : sheen.light + '70'} />
                  </View>
                  <Text style={[ms.tileName, lit ? rankTextSheen(lvl.level) : ms.tileNameOff]} numberOfLines={1}>{lvl.name}</Text>
                  {isCurrent && Number.isFinite(lvl.maxXp) ? (
                    <View style={ms.tileTrack}><View style={[ms.tileFill, { width: `${Math.max(4, Math.round(pct * 100))}%` as any, backgroundColor: sheen.light }]} /></View>
                  ) : null}
                  <Text style={[ms.tileValue, isNext && ms.tileValueNext]} numberOfLines={1}>
                    {isNext ? `${Math.ceil(lvl.minXp - totalXp).toLocaleString()} to go` : `${lvl.minXp.toLocaleString()} Effort`}
                  </Text>
                  {guide ? <Text style={ms.tileGuide} numberOfLines={1}>{guide}</Text> : null}
                </View>
              );
            })}
          </View>
          {(() => {
            const top = LEVELS[LEVELS.length - 1];
            const color = rankSheen(top.level).light;
            const reached = totalXp >= top.minXp;
            const isNext = top.level === currentLevel.level + 1;
            return (
              <View style={[ms.topTile, reached && rb.hero]}>
                <View style={ms.topGlow} pointerEvents="none" />
                <View style={[ms.topIcon, { borderColor: color + '77' }]}>
                  <RivalIcon name="rankUnrivaled" size={30} color={color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={ms.topKicker}>{reached ? 'You' : 'The top rank'}</Text>
                  <Text style={ms.topName}>{top.name}</Text>
                  <Text style={ms.topValue}>
                    {isNext ? `${Math.ceil(top.minXp - totalXp).toLocaleString()} Effort to go` : `${top.minXp.toLocaleString()} Effort`}
                    {shortGuide(top.minXp) ? ` · ${shortGuide(top.minXp)}` : ''}
                  </Text>
                </View>
              </View>
            );
          })()}
          <Text style={ms.note}>
            Rank is earned each year; everyone starts again on 1 January. The hours are a rough guide to reaching each rank in a year.
          </Text>
          <TouchableOpacity onPress={() => router.push('/effort')} accessibilityRole="link" style={ms.effortLink}>
            <Text style={ms.effortLinkText}>How Effort works →</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
        </View>

        <RivalPageHeader title="Ranks" subtitle="Start as a Rookie. Become Unrivaled." />

        <View style={styles.list}>
          {LEVELS.map((lvl, i) => {
            const isCurrent = lvl.level === currentLevel.level;
            const isUnlocked = totalXp >= lvl.minXp;
            const isLast = lvl.maxXp === Infinity;

            return (
              <View key={lvl.level}>
                <View style={[
                  styles.row,
                  isCurrent && { borderColor: lvl.color, borderWidth: 2, backgroundColor: lvl.color + '11' },
                  !isCurrent && { borderColor: isUnlocked ? lvl.color + '44' : RivalColors.surfaceHigh },
                ]}>
                  {/* Left: icon + colour strip */}
                  <View style={[styles.strip, { backgroundColor: lvl.color }]}>
                    <Text style={styles.stripIcon}>{lvl.icon}</Text>
                    <Text style={styles.stripNum}>{lvl.level}</Text>
                  </View>

                  {/* Middle: name + xp */}
                  <View style={styles.rowContent}>
                    <Text style={[styles.rankName, { color: isUnlocked ? lvl.color : '#3A3A3A' }]}>
                      {lvl.name}
                    </Text>
                    <Text style={styles.xpReq}>
                      {lvl.minXp.toLocaleString()} Effort{!isLast ? ` – ${lvl.maxXp.toLocaleString()}` : '+'}
                    </Text>
                  </View>

                  {/* Right: status */}
                  <View style={styles.rowRight}>
                    {isCurrent && (
                      <View style={[styles.currentBadge, { backgroundColor: lvl.color }]}>
                        <Text style={styles.currentBadgeText}>YOU</Text>
                      </View>
                    )}
                    {!isCurrent && isUnlocked && (
                      <Text style={[styles.check, { color: lvl.color }]}>✓</Text>
                    )}
                    {!isUnlocked && (
                      <Text style={styles.locked}>🔒</Text>
                    )}
                  </View>
                </View>

                {/* Connector line between rows */}
                {i < LEVELS.length - 1 && (
                  <View style={styles.connector}>
                    <View style={[styles.connectorLine, { backgroundColor: isUnlocked && totalXp >= LEVELS[i + 1].minXp ? lvl.color : RivalColors.surfaceHigh }]} />
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.footer}>Everyone has a Rival. Only a few become Unrivaled.</Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 },
  header: { marginBottom: 0 },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 32 },
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: RivalColors.surfaceLow,
  },
  strip: {
    width: 56,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 2,
  },
  stripIcon: {
    fontSize: 22,
  },
  stripNum: {
    fontSize: 11,
    fontWeight: '900',
    color: RivalColors.textPrimary,
    opacity: 0.8,
  },
  rowContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 4,
  },
  rankName: {
    fontSize: 20,
    fontWeight: '900',
  },
  xpReq: {
    fontSize: 12,
    color: RivalColors.textSecondary,
    fontWeight: '600',
  },
  rowRight: {
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: RivalColors.textPrimary,
    letterSpacing: 1,
  },
  check: {
    fontSize: 20,
    fontWeight: '900',
  },
  locked: {
    fontSize: 16,
    opacity: 0.4,
  },
  connector: {
    alignItems: 'center',
    height: 12,
  },
  connectorLine: {
    width: 2,
    height: '100%',
  },
  footer: {
    fontSize: 13,
    color: RivalColors.accentText,
    textAlign: 'center',
    marginTop: 32,
    fontStyle: 'italic',
  },
});

// Mobile only — the blend (see RivalGreySheet's rb).
const ms = StyleSheet.create({
  content: { paddingBottom: 120 },
  rankCard: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  effortRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: -2 },
  effortNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, color: RivalColors.accentText, fontVariant: ['tabular-nums'] },
  effortUnit: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary },
  sub: { fontSize: 12.5, color: RivalColors.textSecondary, textAlign: 'center' },
  sub2: { fontSize: 12.5, lineHeight: 17, color: RivalColors.textSecondary, marginTop: 2 },
  paceCard: { gap: 0, paddingVertical: 4 },
  paceRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 10 },
  paceDivider: {},
  paceRank: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, lineHeight: 26, color: '#fff', marginTop: 2 },
  list: { paddingVertical: 0, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  num: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  numOn: {
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  numText: { fontSize: 12.5, fontWeight: '800', color: 'rgba(255,255,255,0.45)' },
  numTextOn: { color: RivalColors.surfaceLowest },
  name: { fontSize: 14.5, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  nameOn: { color: '#fff' },
  guide: { fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginTop: 1 },
  value: { fontSize: 13.5, fontWeight: '500', color: 'rgba(255,255,255,0.45)', fontVariant: ['tabular-nums'] },
  valueOn: { color: '#fff' },
  you: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(217,119,87,0.15)' },
  youText: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: 4, paddingTop: 16, paddingBottom: 14, paddingHorizontal: 8,
    borderRadius: 16, borderWidth: 1, borderColor: RivalColors.surfaceBright, backgroundColor: RivalColors.surfaceLowest,
  },
  tileCorner: { position: 'absolute', top: 9, right: 9 },
  tileIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  tileName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15.5, color: '#fff' },
  tileNameOff: { color: 'rgba(255,255,255,0.55)' },
  tileTrack: { alignSelf: 'stretch', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginHorizontal: 6, marginVertical: 3 },
  tileFill: { height: 3, borderRadius: 2 },
  tileValue: { fontSize: 11.5, fontWeight: '700', color: 'rgba(255,255,255,0.7)', fontVariant: ['tabular-nums'] },
  tileValueNext: { color: RivalColors.accentText },
  tileGuide: { fontSize: 10.5, color: 'rgba(255,255,255,0.38)' },
  topTile: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.28)', backgroundColor: '#211c14',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(120deg, #1d1912 0%, #2a2214 60%, #3a2c12 100%)' } : {}),
  } as any,
  topGlow: {
    position: 'absolute', left: -30, top: -40, width: 160, height: 160, borderRadius: 80,
    ...(Platform.OS === 'web' ? { backgroundImage: 'radial-gradient(circle, rgba(255,215,0,0.22) 0%, rgba(255,215,0,0) 65%)' } : { backgroundColor: 'rgba(255,215,0,0.06)' }),
  } as any,
  topIcon: { width: 58, height: 58, borderRadius: 29, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,215,0,0.1)' },
  topKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: '#FFD700' },
  topName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, lineHeight: 30, color: '#fff' },
  topValue: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, lineHeight: 17, color: RivalColors.textSecondary, textAlign: 'center', paddingHorizontal: 16 },
  effortLink: { alignSelf: 'center', paddingVertical: 4 },
  effortLinkText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
});
