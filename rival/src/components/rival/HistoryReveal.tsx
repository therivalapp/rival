import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, activityIconName } from './RivalIcon';
import { SkyBackdrop } from './SkyBackdrop';
import { CountUp } from './CountUp';
import { RankLadder } from './RankLadder';
import { activityTypeLabel } from './EffortBreakdownSheet';
import { decodePolyline, projectRoute } from '../../lib/polyline';
import { formatActivityDistance, formatDistanceWhole } from '../../lib/units';

// The moment a history lands in RIVAL (Ricky, 2026-10-17/18): shared by
// importing an archive and by connecting Strava. The archive's photos (or
// the skies its activities started under), the hours of activity counting
// up, then Effort with distance by sport, the rank climbing its ladder, and
// four of the best. No glow.
//
// In sequence, about five seconds: hours, then Effort and the rank together,
// then the bests appearing one by one. A tap anywhere jumps to the end, and
// the button works at any time.

export type RevealActivity = {
  key: string;
  name: string | null;
  type: string;
  startedAt: string;
  utcOffsetSeconds?: number | null;
  durationSeconds: number;
  distanceMeters?: number | null;
  polyline?: string | null;
  effort?: number;
};

const category = (type: string) => {
  const t = type.toLowerCase();
  if (t.includes('swim')) return 'swim';
  if (t.includes('ride') || t.includes('cycl') || t.includes('bike')) return 'ride';
  if (t.includes('run') || t.includes('walk') || t.includes('hike')) return 'run';
  return 'other';
};

function Appear({ delay, skip, children, style }: { delay: number; skip: boolean; children: React.ReactNode; style?: object }) {
  const v = useRef(new Animated.Value(skip ? 1 : 0)).current;
  useEffect(() => {
    if (skip) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: 420, delay, useNativeDriver: false }).start();
  }, [skip]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export function HistoryReveal({ kicker, activities, photoUrls, yearEffort, ctaLabel, onCta, onSeeAll }: {
  kicker: string;
  activities: RevealActivity[];
  photoUrls: string[];
  /** This year's Effort, for the rank. */
  yearEffort: number;
  ctaLabel: string;
  onCta: () => void;
  onSeeAll?: () => void;
}) {
  const [skip, setSkip] = useState(false);
  const hours = Math.round(activities.reduce((t, i) => t + (i.durationSeconds || 0), 0) / 3600);
  const effort = Math.round(activities.reduce((t, i) => t + (i.effort || 0), 0));
  const km = { run: 0, ride: 0, swim: 0 } as Record<string, number>;
  activities.forEach((i) => { const c = category(i.type); if (c in km) km[c] += (i.distanceMeters || 0) / 1000; });
  const sports = (['run', 'ride', 'swim'] as const).filter((c) => km[c] > 0);
  const kmTotal = sports.reduce((t, c) => t + km[c], 0);
  const tones = ['#ffb59e', '#e8835f', '#a8553b'];

  // The collage: their own photos first, then the skies of their activities.
  const photos = photoUrls.slice(0, 6);
  const skies = useMemo(() => activities.slice(0, 6 - photos.length), [activities.length, photos.length]);

  // The best of each kind of activity: the farthest, or the longest without
  // a distance. Four shown, the rest behind "See all".
  const bests = useMemo(() => {
    const byType = new Map<string, RevealActivity>();
    activities.forEach((i) => {
      const prev = byType.get(i.type);
      const better = (i.distanceMeters || 0) > 0
        ? (i.distanceMeters || 0) > (prev?.distanceMeters || 0)
        : !(prev?.distanceMeters) && (i.durationSeconds || 0) > (prev?.durationSeconds || 0);
      if (!prev || better) byType.set(i.type, i);
    });
    return [...byType.values()].sort((a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0));
  }, [activities.length]);
  const tile = (i: RevealActivity) => {
    const noun = activityTypeLabel(i.type).toLowerCase();
    const dist = (i.distanceMeters || 0) > 0 ? formatActivityDistance(i.distanceMeters, i.type) : null;
    const [v, u] = dist ? dist.split(' ') : [`${Math.floor(i.durationSeconds / 3600)}h ${String(Math.round((i.durationSeconds % 3600) / 60)).padStart(2, '0')}m`, ''];
    const route = category(i.type) === 'run' && i.polyline
      ? projectRoute(decodePolyline(i.polyline), 30, 30, 1).map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
      : null;
    return { key: i.key, label: dist ? `Farthest ${noun}` : `Longest ${noun}`, value: v, unit: u, route };
  };

  const t0 = 0;           // hours
  const tEffort = 1400;   // Effort and the rank, together
  const tBests = 3600;    // the bests

  return (
    <SafeAreaView style={r.page} edges={['left', 'right']}>
      <Pressable style={{ flex: 1 }} onPress={() => setSkip(true)} accessible={false}>
        <ScrollView contentContainerStyle={r.content}>
          <View style={r.mosaicClip}>
            <View style={r.mosaic}>
              {photos.map((u, k) => (
                <View key={`p${k}`} style={r.tile}>
                  {Platform.OS === 'web' ? <img src={u} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt="" /> : null}
                </View>
              ))}
              {skies.map((i) => (
                <View key={i.key} style={[r.tile, r.skyTile]}>
                  <SkyBackdrop startedAt={i.startedAt} utcOffsetSeconds={i.utcOffsetSeconds} />
                  <RivalIcon name={activityIconName(i.type)} size={42} color="rgba(255,255,255,0.2)" />
                </View>
              ))}
            </View>
            <View style={[r.fade, { pointerEvents: 'none' }]} />
          </View>

          <View style={r.body}>
            <Text style={r.kick}>{kicker}</Text>
            <View>
              <View style={r.heroRow}>
                <CountUp value={hours} delay={t0} duration={skip ? 1 : 1600} style={r.hero} />
                <Text style={r.heroUnit}>h</Text>
              </View>
              <Text style={r.heroLine}>of activity imported</Text>
              <Text style={r.heroSub}>From {activities.length.toLocaleString()} {activities.length === 1 ? 'activity' : 'activities'}</Text>
            </View>

            <View style={r.effort}>
              <CountUp value={effort} delay={skip ? 0 : tEffort} duration={skip ? 1 : 1800} format={(n) => `+${Math.round(n).toLocaleString()}`} style={r.effortNum} />
              <Text style={r.effortLabel}>Effort earned</Text>
              {sports.length ? (
                <>
                  <View style={r.split}>
                    {sports.map((c, k) => <View key={c} style={{ flex: Math.max(1, Math.round((km[c] / kmTotal) * 100)), backgroundColor: tones[k] }} />)}
                  </View>
                  <View style={r.splitCols}>
                    {sports.map((c, k) => {
                      const [n, u] = formatDistanceWhole(km[c]).split(' ');
                      return (
                        <View key={c} style={[r.splitCol, k > 0 && r.splitColDivided]}>
                          <Text style={r.splitNum}>{n}<Text style={r.splitUnit}> {u}</Text></Text>
                          <View style={r.splitLabelRow}>
                            <View style={[r.dot, { backgroundColor: tones[k] }]} />
                            <Text style={r.splitLabel}>{c === 'run' ? 'Runs' : c === 'ride' ? 'Rides' : 'Swims'}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </View>

            <View style={r.rankCard}>
              <RankLadder key={skip ? 'done' : 'climb'} effort={yearEffort} climb={!skip} delay={tEffort} />
            </View>

            {bests.length ? (
              <Appear delay={tBests} skip={skip}>
                <Text style={r.found}>Found in the history</Text>
                <View style={[r.find, { marginTop: 10 }]}>
                  <View style={r.findHead}>
                    <View style={r.medal}><RivalIcon name="trophy" size={18} color="#4a3206" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={r.findTitle}>{bests.length} personal {bests.length === 1 ? 'best' : 'bests'}</Text>
                      <Text style={r.findSub}>The best of each</Text>
                    </View>
                    {onSeeAll && bests.length > 4 ? <TouchableOpacity onPress={onSeeAll} hitSlop={8}><Text style={r.seeAll}>See all</Text></TouchableOpacity> : null}
                  </View>
                  <View style={r.pbGrid}>
                    {bests.slice(0, 4).map(tile).map((tl, k) => (
                      <Appear key={tl.key} delay={tBests + 200 + k * 110} skip={skip} style={r.pbTile}>
                        {tl.route ? (
                          <Svg width={30} height={30} style={r.pbRoute}><Path d={tl.route} stroke="rgba(255,230,168,0.45)" strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
                        ) : null}
                        <Text style={r.pbLabel} numberOfLines={1}>{tl.label}</Text>
                        <Text style={r.pbValue}>{tl.value}{tl.unit ? <Text style={r.pbUnit}> {tl.unit}</Text> : null}</Text>
                      </Appear>
                    ))}
                  </View>
                </View>
              </Appear>
            ) : null}

            <TouchableOpacity style={r.primary} onPress={onCta} activeOpacity={0.85}>
              <Text style={r.primaryText}>{ctaLabel}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Pressable>
    </SafeAreaView>
  );
}

const r = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#120f0e' },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingBottom: 80 },
  mosaicClip: { height: 340, overflow: 'hidden', position: 'relative' },
  mosaic: {
    position: 'absolute', top: -10, left: -30, right: -30, height: 330, flexDirection: 'row', flexWrap: 'wrap', gap: 3,
    transform: [{ rotate: '-6deg' }, { scale: 1.1 }], opacity: 0.85,
  },
  tile: { width: '32.6%', height: '49.5%', borderRadius: 6, overflow: 'hidden', backgroundColor: '#2a2522' },
  skyTile: { alignItems: 'center', justifyContent: 'center' },
  fade: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, rgba(18,15,14,0.25) 0%, rgba(18,15,14,0.55) 45%, #120f0e 92%)' } as any : { backgroundColor: 'rgba(18,15,14,0.5)' }),
  },
  body: { marginTop: -200, paddingHorizontal: 20, gap: 14 },
  kick: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 2.4, textTransform: 'uppercase', color: '#ffd3c2' },
  heroRow: { flexDirection: 'row', alignItems: 'baseline' },
  hero: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 82, lineHeight: 92, color: '#fff' },
  heroUnit: { fontFamily: RivalFontFamily, fontSize: 30, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginLeft: 4 },
  heroLine: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, lineHeight: 27, color: '#fff', marginTop: 2 },
  heroSub: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginTop: 6 },
  effort: {
    borderRadius: 20, padding: 16, gap: 4, borderWidth: 1, borderColor: 'rgba(255,181,158,0.25)',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, rgba(232,131,95,0.28), rgba(232,131,95,0.06) 60%)' } as any : { backgroundColor: 'rgba(232,131,95,0.14)' }),
  },
  effortNum: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 64, lineHeight: 70, color: '#ffc2ad',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #fff4d6, #ffb59e 55%, #e8835f)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' } as any : {}),
  },
  effortLabel: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: '#ffd3c2' },
  split: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, marginTop: 10, marginBottom: 6 },
  splitCols: { flexDirection: 'row' },
  splitCol: { flex: 1, gap: 3 },
  splitColDivided: { paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.08)' },
  splitNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, color: '#fff' },
  splitUnit: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  splitLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  splitLabel: { fontFamily: RivalFontFamily, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' },
  rankCard: { borderRadius: 20, padding: 16, backgroundColor: 'rgba(255,255,255,0.045)' },
  found: { fontFamily: RivalFontFamily, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  find: { borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.045)', padding: 12, gap: 10 },
  findHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  medal: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e9c36a',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(160deg, #fff1c7, #d9a23a)' } as any : {}),
  },
  findTitle: { fontFamily: RivalFontFamily, fontSize: 13.5, fontWeight: '700', color: '#fff' },
  findSub: { fontFamily: RivalFontFamily, fontSize: 11.5, color: 'rgba(255,255,255,0.5)' },
  seeAll: { fontFamily: RivalFontFamily, fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  pbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pbTile: { width: '48.8%', borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10, gap: 2, backgroundColor: 'rgba(255,201,77,0.08)', overflow: 'hidden' },
  pbRoute: { position: 'absolute', right: 8, bottom: 6 },
  pbLabel: { fontFamily: RivalFontFamily, fontSize: 9, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', color: 'rgba(255,230,168,0.7)' },
  pbValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#ffe6a8' },
  pbUnit: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontSize: 11, fontWeight: '600', color: 'rgba(255,230,168,0.6)' },
  primary: { height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, marginTop: 4 },
  primaryText: { fontFamily: RivalFontFamily, fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
});
