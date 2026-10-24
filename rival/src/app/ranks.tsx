import { useEffect, useState } from 'react';
import { Image, Modal } from 'react-native';
import { makeRankCard, shareCardFile, type ShareFigure } from '../lib/shareCard';
import { drawRankStamp, stampBlob, stampFontsReady } from '../lib/shareStamp';
import { fullPhoto } from '../lib/imageUrl';
import { distanceUnit, toDisplayDistance } from '../lib/units';
import { RivalButtonColors, RivalGhost } from '../constants/rivalTheme';
import { BusyText } from '../components/rival/BusyText';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import type { RivalIconName } from '../components/rival/RivalIcon';
import { rankSheen, rankTextSheen, rankTileFill, RANK_TILE_INK } from '../constants/rankSheen';
import { sidePageWide } from '../constants/breakpoints';
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
  // Total hours, rounded to a clean figure: 29 reads as 30h.
  if (perWeek < 1) return `${hours < 20 ? Math.max(1, Math.round(hours)) : Math.round(hours / 5) * 5}h`;
  const w = perWeek < 10 ? Math.round(perWeek * 2) / 2 : Math.round(perWeek);
  return `${w}h a week`;
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
  const wide = sidePageWide(width);
  const [totalXp, setTotalXp] = useState(0);
  const [pace, setPace] = useState<RankPace | null>(null);
  // For sharing the rank: the year's activities and distance, and the most
  // recent photo to set it on.
  const [yearCount, setYearCount] = useState(0);
  const [yearKm, setYearKm] = useState(0);
  const [photo, setPhoto] = useState<{ url: string; fx: number | null; fy: number | null } | null>(null);
  const [share, setShare] = useState<{ card: { url: string; blob: Blob }; stamp: { url: string; blob: Blob } } | null>(null);
  const [shareChoice, setShareChoice] = useState<'card' | 'stamp'>('card');
  const [making, setMaking] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      const { data } = await supabase
        .from('activities')
        .select('effort_score, distance_meters, photo_url, photo_focal_x, photo_focal_y, started_at')
        .eq('user_id', user.id)
        // Rank is a season measure everywhere else (top bar, Home, Stats);
        // lifetime Effort here showed a rank the rest of the app didn't.
        .gte('started_at', getSeasonStartISO());
      const xp = data?.reduce((sum, a) => sum + (a.effort_score || 0), 0) ?? 0;
      setTotalXp(xp);
      setYearCount(data?.length ?? 0);
      setYearKm((data ?? []).reduce((sum, a) => sum + (a.distance_meters || 0), 0) / 1000);
      const latest = [...(data ?? [])].filter((a) => a.photo_url).sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
      if (latest) setPhoto({ url: latest.photo_url!, fx: latest.photo_focal_x, fy: latest.photo_focal_y });

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

  async function openRankShare() {
    if (making) return;
    setMaking(true);
    setShareError(null);
    try {
      const { light, dark } = rankSheen(currentLevel.level);
      const figures: ShareFigure[] = [
        // White on rank shares: the rank's material is the one colour (Ricky,
        // 2026-10-22, cleaner than gold competing with it).
        { value: Math.round(totalXp).toLocaleString(), label: 'Effort' },
        { value: yearCount.toLocaleString(), label: 'Activities' },
        ...(yearKm > 0 ? [{ value: Math.round(toDisplayDistance(yearKm)).toLocaleString(), unit: distanceUnit(), label: 'Distance' }] : []),
      ];
      const cardBlob = await makeRankCard({
        photoUrl: photo?.url ?? null,
        focalX: photo?.fx,
        focalY: photo?.fy,
        rankName: currentLevel.name,
        kicker: `${getCurrentSeasonYear()} rank · Level ${currentLevel.level} of ${LEVELS.length}`,
        light,
        dark,
        figures,
      });
      await stampFontsReady();
      const stampFile = await stampBlob(drawRankStamp(currentLevel.name, light, figures));
      setShareChoice('card');
      setShare({ card: { url: URL.createObjectURL(cardBlob), blob: cardBlob }, stamp: { url: URL.createObjectURL(stampFile), blob: stampFile } });
    } catch {
      setShareError('The picture could not be made. Try again.');
    } finally {
      setMaking(false);
    }
  }

  function closeRankShare() {
    if (share) { URL.revokeObjectURL(share.card.url); URL.revokeObjectURL(share.stamp.url); }
    setShare(null);
  }

  async function sendRankShare() {
    if (!share) return;
    const file = shareChoice === 'card' ? share.card : share.stamp;
    try {
      const done = await shareCardFile(file.blob, `rival-${currentLevel.name.toLowerCase()}${shareChoice === 'stamp' ? '-stamp.png' : '.jpg'}`);
      if (done !== 'cancelled') closeRankShare();
    } catch {
      setShareError('Sharing did not open. Try again.');
    }
  }

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
          {/* Made of the rank's own material, its icon large behind, dark
              lettering (Ricky, 2026-10-18, "W2"). */}
          <View style={[ms.matCard, rankTileFill(currentLevel.level)]}>
            <RivalIcon name={`rank${currentLevel.name}` as RivalIconName} size={190} color="rgba(16,14,12,0.13)" style={ms.matMark} />
            <Text style={ms.matLabel}>{getCurrentSeasonYear()} rank</Text>
            <Text style={ms.matName}>{currentLevel.name}</Text>
            <View style={ms.effortRow}>
              <Text style={ms.matEffort}>{Math.round(totalXp).toLocaleString()}</Text>
              <Text style={ms.matUnit}>Effort this year</Text>
            </View>
            {next ? (
              <>
                <View style={ms.matBar}><View style={[ms.matFill, { width: `${Math.max(2, Math.round(pct * 100))}%` as any }]} /></View>
                <Text style={ms.matSub}>{Math.max(0, Math.ceil(next.minXp - totalXp)).toLocaleString()} Effort to {next.name} · Level {currentLevel.level}</Text>
              </>
            ) : (
              <Text style={ms.matSub}>The top rank.</Text>
            )}
          </View>

          {/* Share the rank (Ricky, 2026-10-22): a card or a see-through stamp. */}
          {Platform.OS === 'web' && totalXp > 0 ? (
            <TouchableOpacity style={ms.shareBtn} onPress={openRankShare} disabled={making} activeOpacity={0.85}>
              <RivalIcon name="share" size={16} color={RivalButtonColors.label(RivalColors.onAccentFill)} />
              <BusyText busy={making} style={ms.shareText}>{making ? 'Making…' : `Share ${currentLevel.name}`}</BusyText>
            </TouchableOpacity>
          ) : null}
          {shareError && !share ? <Text style={ms.shareError}>{shareError}</Text> : null}

          {/* Where this year is heading. A projection only — rank is always
              what has been earned. A latecomer also sees what a full year at
              their pace would reach: something to aim at next year. */}
          {pace ? (
            <View style={[rb.card, ms.paceCard, { overflow: 'hidden' }]}>
              {/* The rank it heads for, in that rank's colour and icon; only
                  the rank held gets the full material card. */}
              <RivalIcon name={`rank${pace.yearEnd.level.name}` as RivalIconName} size={120} color={rankSheen(pace.yearEnd.level.level).light + '14'} style={ms.paceMark} />
              <View style={ms.paceRow}>
                <View style={[ms.paceCoin, rankTileFill(pace.yearEnd.level.level)]}><RivalIcon name={`rank${pace.yearEnd.level.name}` as RivalIconName} size={18} color={RANK_TILE_INK} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={rb.label}>On pace for</Text>
                  <Text style={[ms.paceRank, rankTextSheen(pace.yearEnd.level.level)]}>{pace.yearEnd.level.name}</Text>
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
                      Based on activity since {pace.start.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}. The first full year begins on 1 January.
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
              // Reached ranks, the current one included, are filled in their
              // colour; the next one carries the progress bar and what's left
              // (Ricky, 2026-10-03). Ranks further on stay dark.
              const isEarned = totalXp >= lvl.minXp;
              const isNext = lvl.level === currentLevel.level + 1;
              const pct = isNext ? Math.min(1, Math.max(0, (totalXp - currentLevel.minXp) / (lvl.minXp - currentLevel.minXp))) : 0;
              const guide = shortGuide(lvl.minXp);
              return (
                <View key={lvl.level} style={[ms.tile, isNext && [rb.hero, { borderColor: sheen.light + '66' }], isEarned && rankTileFill(lvl.level)]}>
                  {/* Each rank's icon, large and centred behind its words
                      (Ricky, 2026-10-03), in its own material
                      (constants/rankSheen.ts): reached ones filled solid, the
                      next one lit, the rest waiting, faint. */}
                  <View style={[ms.tileArt, { pointerEvents: 'none' }]}>
                    <RivalIcon
                      name={RANK_ICONS[lvl.level - 1]}
                      size={112}
                      color={isEarned ? 'rgba(26,18,16,0.16)' : isNext ? sheen.light + '33' : sheen.light + '14'}
                    />
                  </View>
                  <Text style={[ms.tileName, isEarned ? { color: RANK_TILE_INK } : isNext ? rankTextSheen(lvl.level) : ms.tileNameOff]} numberOfLines={1}>{lvl.name}</Text>
                  {isNext ? (
                    <View style={ms.tileTrack}><View style={[ms.tileFill, { width: `${Math.max(4, Math.round(pct * 100))}%` as any, backgroundColor: sheen.light }]} /></View>
                  ) : null}
                  {/* Rookie is where everyone starts: no "0 Effort" under it. */}
                  {lvl.minXp > 0 ? (
                    <Text style={[ms.tileValue, isNext && { color: sheen.light }, isEarned && ms.tileValueEarned]} numberOfLines={1}>
                      {isNext ? `${Math.ceil(lvl.minXp - totalXp).toLocaleString()} to go` : `${lvl.minXp.toLocaleString()} Effort`}
                    </Text>
                  ) : null}
                  {guide ? <Text style={[ms.tileGuide, isEarned && ms.tileGuideEarned]} numberOfLines={1}>{guide}</Text> : null}
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
              <View style={[ms.topTile, reached && ms.topTileReached]}>
                {/* No card: one big trophy on its own, like a team crest
                    (Ricky, 2026-10-03), the words centred over it. Faint until
                    reached, then solid gold with a glow and dark words. */}
                <View style={[ms.topGlow, reached && ms.topGlowReached, { pointerEvents: 'none' }]} />
                <View style={[ms.topArt, { pointerEvents: 'none' }]}>
                  <RivalIcon
                    name="rankUnrivaled"
                    size={250}
                    color={color + '29'}
                    gradient={reached ? [rankSheen(top.level).light, rankSheen(top.level).dark] : undefined}
                  />
                </View>
                <Text style={[ms.topKicker, reached && { color: RANK_TILE_INK }]}>{reached ? 'You' : 'The top rank'}</Text>
                <Text style={[ms.topName, reached ? ms.topNameReached : rankTextSheen(top.level)]}>{top.name}</Text>
                <Text style={[ms.topValue, reached && { color: RANK_TILE_INK }]}>
                  {isNext ? `${Math.ceil(top.minXp - totalXp).toLocaleString()} Effort to go` : `${top.minXp.toLocaleString()} Effort`}
                </Text>
                {!reached && shortGuide(top.minXp) ? <Text style={[ms.topValue, ms.topGuide]}>{shortGuide(top.minXp)}</Text> : null}
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
        <Modal visible={!!share} transparent animationType="fade" onRequestClose={closeRankShare}>
          {share ? (
            <View style={ms.shareBackdrop}>
              {shareChoice === 'card' ? (
                <Image source={{ uri: share.card.url }} style={[ms.sharePreview, { height: Math.min(520, (width - 96) * 16 / 9) }]} resizeMode="contain" />
              ) : (
                <View style={[ms.sharePreview, ms.stampStage, { height: Math.min(520, (width - 96) * 16 / 9) }]}>
                  {photo ? <Image source={{ uri: fullPhoto(photo.url) }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                  <Image source={{ uri: share.stamp.url }} style={ms.stampOnStage} resizeMode="contain" />
                </View>
              )}
              <View style={ms.choiceRow}>
                <TouchableOpacity style={[ms.choice, shareChoice === 'card' && ms.choiceOn]} onPress={() => setShareChoice('card')}>
                  <Text style={[ms.choiceText, shareChoice === 'card' && ms.choiceTextOn]}>Card</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[ms.choice, shareChoice === 'stamp' && ms.choiceOn]} onPress={() => setShareChoice('stamp')}>
                  <Text style={[ms.choiceText, shareChoice === 'stamp' && ms.choiceTextOn]}>Stamp</Text>
                </TouchableOpacity>
              </View>
              {shareChoice === 'stamp' ? <Text style={ms.stampHint}>A see-through stamp to place over a photo.</Text> : null}
              <TouchableOpacity style={[ms.shareBtn, ms.shareBtnModal]} onPress={sendRankShare} activeOpacity={0.85}>
                <RivalIcon name="share" size={16} color={RivalButtonColors.label(RivalColors.onAccentFill)} />
                <Text style={ms.shareText}>Share</Text>
              </TouchableOpacity>
              {shareError ? <Text style={ms.shareError}>{shareError}</Text> : null}
              <TouchableOpacity onPress={closeRankShare} hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}>
                <Text style={ms.shareClose}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Modal>
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
});

// Mobile only — the blend (see RivalGreySheet's rb).
const ms = StyleSheet.create({
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 999, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  shareBtnModal: { alignSelf: 'stretch', maxWidth: 320, width: '100%' },
  shareText: { fontSize: 14.5, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  shareError: { fontSize: 12.5, color: '#ff8f8f', textAlign: 'center' },
  // The pop-up standard: warm grey ground with the soft top glow, never
  // see-through black (Ricky, 2026-10-22).
  shareBackdrop: {
    flex: 1, backgroundColor: RivalGhost.ground, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32,
    ...(Platform.OS === 'web' ? { backgroundImage: 'radial-gradient(ellipse 80% 260px at 50% 0%, rgba(217,119,87,0.16), rgba(217,119,87,0) 70%)', backgroundRepeat: 'no-repeat' } as any : {}),
  },
  sharePreview: { aspectRatio: 9 / 16, borderRadius: 18 },
  stampStage: { overflow: 'hidden', backgroundColor: '#2a2522', justifyContent: 'flex-end', alignItems: 'center' },
  stampOnStage: { width: '92%', height: '34%', marginBottom: '6%' as any },
  stampHint: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: -4 },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: { paddingHorizontal: 20, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,181,158,0.22)', backgroundColor: 'rgba(255,209,190,0.05)' },
  choiceOn: { borderColor: 'transparent', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  choiceText: { fontSize: 13.5, fontWeight: '800', color: 'rgba(255,255,255,0.75)' },
  choiceTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  shareClose: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.6)', paddingVertical: 4 },
  matCard: { position: 'relative', overflow: 'hidden', borderRadius: 22, borderWidth: 1, alignItems: 'center', paddingVertical: 20, paddingHorizontal: 18, gap: 8 },
  matMark: { position: 'absolute', right: -34, top: -24 },
  matLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 2.2, textTransform: 'uppercase', color: 'rgba(16,14,12,0.62)' },
  matName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 52, lineHeight: 58, color: RANK_TILE_INK },
  matEffort: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 26, color: RANK_TILE_INK, fontVariant: ['tabular-nums'] },
  matUnit: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: 'rgba(16,14,12,0.65)' },
  matBar: { alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: 'rgba(16,14,12,0.2)', overflow: 'hidden' },
  matFill: { height: 8, borderRadius: 4, backgroundColor: RANK_TILE_INK },
  matSub: { fontSize: 12.5, color: 'rgba(16,14,12,0.78)', textAlign: 'center' },
  paceMark: { position: 'absolute', right: -20, bottom: -26 },
  paceCoin: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
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
    flexBasis: '30%', flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 132, paddingVertical: 14, paddingHorizontal: 8, overflow: 'hidden',
    borderRadius: 16, borderWidth: 1, borderColor: RivalColors.surfaceBright, backgroundColor: RivalColors.surfaceLowest,
  },
  tileCorner: { position: 'absolute', top: 9, right: 9 },
  tileIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  tileName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15.5, color: '#fff' },
  tileNameOff: { color: 'rgba(255,255,255,0.55)' },
  tileTrack: { alignSelf: 'stretch', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginHorizontal: 6, marginVertical: 3 },
  tileFill: { height: 3, borderRadius: 2 },
  tileArt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  // An earned rank, filled in its colour: dark ink on it.
  tileIconEarned: { backgroundColor: 'rgba(0,0,0,0.14)', borderColor: 'rgba(0,0,0,0.18)' },
  tileValueEarned: { color: '#1a1210' },
  tileGuideEarned: { color: '#2e231d', fontWeight: '600' },
  tileValue: { fontSize: 11.5, fontWeight: '700', color: 'rgba(255,255,255,0.7)', fontVariant: ['tabular-nums'] },
  tileValueNext: { color: RivalColors.accentText },
  tileGuide: { fontSize: 10.5, color: 'rgba(255,255,255,0.38)' },
  topTile: { height: 250, alignItems: 'center', justifyContent: 'center', gap: 2, marginTop: 4 },
  // Lift the words into the wide cup, clear of the narrow stem.
  topTileReached: { paddingBottom: 56 },
  topGlow: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    ...(Platform.OS === 'web' ? { backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(255,215,0,0.12) 0%, rgba(255,215,0,0) 55%)' } : {}),
  } as any,
  topGlowReached: Platform.OS === 'web' ? { backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(255,215,0,0.3) 0%, rgba(255,215,0,0) 58%)' } as any : {},
  topArt: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  topIcon: { width: 58, height: 58, borderRadius: 29, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,215,0,0.1)' },
  topKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: '#FFD700' },
  topName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 34, lineHeight: 40, color: '#fff' },
  topValue: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.75)', fontVariant: ['tabular-nums'] },
  topGuide: { fontWeight: '500', color: 'rgba(255,255,255,0.45)' },
  // Reached: dark words inside the gold cup, a size that fits between the handles.
  topNameReached: { color: '#1a1210', fontSize: 28, lineHeight: 34 },
  note: { fontSize: 12, lineHeight: 17, color: RivalColors.textSecondary, textAlign: 'center', paddingHorizontal: 16 },
  effortLink: { alignSelf: 'center', paddingVertical: 4 },
  effortLinkText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
});
