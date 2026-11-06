import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { liveClock } from '../../lib/liveActivity';
import { elevationGain, fastestEfforts, metresBetween, paceClock, splitBars, splits, type TrackPoint } from '../../lib/liveTrack';
import { distanceUnit, elevationUnit, toDisplayElevation } from '../../lib/units';
import { RivalIcon } from './RivalIcon';

// The parts of the Finish pop-up and its More details (Ricky, 2026-11-02:
// design/finish-923-mockup-v5.png, design/more-details-mockup-v3.png).

const serif = { fontFamily: RivalSerifFamily, fontStyle: 'italic' as const, fontWeight: '700' as const };
const grad = (deg: number) => (Platform.OS === 'web' ? { backgroundImage: `linear-gradient(${deg}deg, #D97757, #ffb59e)` } as any : {});

export type Tile = { value: string; unit?: string | null; name: string; effort?: boolean; onPress?: () => void };

/** Three across; Effort has a solid tile with a peach edge (option B,
 *  design/effort-tile-mockup.png) and opens its breakdown. */
export function FinishTiles({ tiles }: { tiles: Tile[] }) {
  if (!tiles.length) return null;
  return (
    <View style={s.grid}>
      {tiles.map((t) => {
        const body = (
          <>
            <Text style={[s.tileValue, t.effort && s.effortValue]}>{t.value}{t.unit ? <Text style={s.unit}>{t.unit}</Text> : null}</Text>
            <Text style={[s.tileName, t.effort && s.effortName]}>{t.name}</Text>
          </>
        );
        return t.onPress
          ? <TouchableOpacity key={t.name} style={[s.tile, t.effort && s.effortTile]} onPress={t.onPress} activeOpacity={0.8} accessibilityRole="button">{body}</TouchableOpacity>
          : <View key={t.name} style={[s.tile, t.effort && s.effortTile]}>{body}</View>;
      })}
    </View>
  );
}

/** Splits as bars: up to 12, grouped past that, the fastest lit, the time in
 *  white and the number under each. A part-finished last split is a narrower
 *  dashed bar, filled as far as it went. */
export function FinishSplits({ track, unitKm, speed }: { track: TrackPoint[]; unitKm: number; /** Rides: km/h, a taller bar still faster. */ speed?: boolean }) {
  const { bars, group, fastest } = useMemo(() => splitBars(track, unitKm * 1000), [track, unitKm]);
  if (!bars.length || fastest == null) return null;
  const whole = bars.filter((b) => b.part >= 0.999);
  const quickest = whole.length ? Math.min(...whole.map((b) => b.pace)) : 0;
  const slowest = whole.length ? Math.max(...whole.map((b) => b.pace)) : 0;
  const height = (pace: number) => 35 + Math.max(0, Math.min(1, slowest > quickest ? (slowest - pace) / (slowest - quickest) : 1)) * 65;
  const per = distanceUnit().toUpperCase();
  const show = (pace: number) => (speed ? (3600 / (pace * unitKm)).toFixed(1) : paceClock(pace, unitKm));
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>{group > 1 ? `SPLITS · EVERY ${group} ${per}` : 'SPLITS'}</Text>
        <Text style={s.cardExtra}>{speed ? `FASTEST ${show(fastest / unitKm)} ${per === 'MI' ? 'MPH' : 'KM/H'}` : `FASTEST ${liveClock(fastest)}`}</Text>
      </View>
      <View style={s.bars}>
        {bars.map((b, i) => (b.part < 0.999 ? (
          <View key={i} style={[s.partBar, { height: `${height(b.pace)}%` }]}>
            <View style={[s.partFill, { height: `${Math.round(b.part * 100)}%` }]} />
          </View>
        ) : (
          <View key={i} style={[s.bar, b.pace === quickest && s.barBest, { height: `${height(b.pace)}%` }]} />
        )))}
      </View>
      <View style={s.labels}>
        {bars.map((b, i) => <Text key={i} style={[s.barTime, b.part < 0.999 && s.partText]}>{show(b.pace)}</Text>)}
      </View>
      <View style={s.labels}>
        {bars.map((b, i) => <Text key={i} style={[s.barNum, b.part < 0.999 && { flex: 0.7 }]}>{b.label}</Text>)}
      </View>
    </View>
  );
}

export function MoreDetailsRow({ onPress, sub }: { onPress: () => void; sub?: string }) {
  return (
    <TouchableOpacity style={s.more} onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      <View style={{ flex: 1 }}>
        <Text style={s.moreName}>More details</Text>
        <Text style={s.moreSub}>{sub ?? 'Heart rate, fastest efforts, every split, pace and elevation'}</Text>
      </View>
      <RivalIcon name="chevronRight" size={20} color="#a0a0a0" />
    </TouchableOpacity>
  );
}

const ZONES = [
  { z: 'Z1', name: 'Recovery', lo: 0, hi: 0.6 },
  { z: 'Z2', name: 'Easy', lo: 0.6, hi: 0.7 },
  { z: 'Z3', name: 'Steady', lo: 0.7, hi: 0.8 },
  { z: 'Z4', name: 'Hard', lo: 0.8, hi: 0.9 },
  { z: 'Z5', name: 'Max', lo: 0.9, hi: 1 },
];
const EFFORTS = [
  { name: '400 m', m: 400 }, { name: '1 km', m: 1000 }, { name: '1 mile', m: 1609.344 },
  { name: '5 km', m: 5000 }, { name: '10 km', m: 10000 }, { name: 'Half marathon', m: 21097.5 }, { name: 'Marathon', m: 42195 },
];

/** The body of More details: time, heart rate and cadence, the pace and
 *  elevation chart, heart rate zones, fastest efforts and every split. Parts
 *  without data (no watch, no route) are left out. */
export function MoreDetails({ track, unitKm, moving, elapsed, avgBpm, maxBpm, cadence, zoneSeconds, hrMax }: {
  track: TrackPoint[];
  unitKm: number;
  moving: number;
  elapsed: number;
  avgBpm?: number | null;
  maxBpm?: number | null;
  cadence?: number | null;
  zoneSeconds?: number[] | null;
  hrMax?: number | null;
}) {
  const [chartW, setChartW] = useState(0);
  const per = distanceUnit();
  const sp = useMemo(() => splits(track, unitKm * 1000), [track, unitKm]);
  const efforts = useMemo(() => fastestEfforts(track, EFFORTS.map((e) => e.m)), [track]);
  const quickest = sp.done.length ? Math.min(...sp.done.map((d) => d.seconds)) : 0;
  const slowest = sp.done.length ? Math.max(...sp.done.map((d) => d.seconds)) : 0;
  const heart = [
    ...(avgBpm ? [{ value: String(avgBpm), name: 'AVERAGE' }] : []),
    ...(maxBpm ? [{ value: String(maxBpm), name: 'MAX' }] : []),
    ...(cadence ? [{ value: String(cadence), unit: ' spm', name: 'CADENCE' }] : []),
  ];
  const zoneTotal = (zoneSeconds ?? []).reduce((a, b) => a + b, 0);
  const avgPace = track.length > 1 && sp.done.length ? (moving / (sp.done.length * unitKm * 1000 + sp.into)) * 1000 : null;
  return (
    <View>
      <Text style={s.label}>TIME</Text>
      <FinishTiles tiles={[
        { value: liveClock(moving), name: 'MOVING' },
        { value: liveClock(elapsed), name: 'ELAPSED' },
        { value: liveClock(Math.max(0, elapsed - moving)), name: 'STOPPED' },
      ]} />
      {heart.length ? <><Text style={s.label}>{cadence ? 'HEART RATE AND CADENCE' : 'HEART RATE'}</Text><FinishTiles tiles={heart} /></> : null}
      {track.length > 2 ? (
        <>
          <Text style={s.label}>PACE AND ELEVATION</Text>
          <View style={s.card} onLayout={(e) => setChartW(e.nativeEvent.layout.width - 24)}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>PACE</Text>
              {avgPace ? <Text style={s.cardExtra}>{`AVG ${paceClock(avgPace, unitKm)} /${per.toUpperCase()}`}</Text> : null}
            </View>
            {chartW > 0 ? <PaceChart track={track} width={chartW} /> : <View style={{ height: 96 }} />}
            <View style={s.legend}>
              <Text style={[s.legendText, { color: '#e8835f' }]}>Pace</Text>
              <Text style={s.legendText}>{`Elevation · ${Math.round(toDisplayElevation(elevationGain(track))).toLocaleString()} ${elevationUnit()} gain`}</Text>
            </View>
          </View>
        </>
      ) : null}
      {zoneSeconds && zoneTotal > 0 ? (
        <>
          <Text style={s.label}>HEART RATE ZONES</Text>
          <View style={s.card}>
            {ZONES.map((z, i) => {
              const secs = zoneSeconds[i] ?? 0;
              const range = hrMax
                ? i === 0 ? `under ${Math.round(hrMax * z.hi)}` : i === 4 ? `${Math.round(hrMax * z.lo)}+` : `${Math.round(hrMax * z.lo)} to ${Math.round(hrMax * z.hi) - 1}`
                : null;
              return (
                <View key={z.z} style={s.zone}>
                  <Text style={s.zoneBadge}>{z.z}</Text>
                  <View style={{ width: 84 }}>
                    <Text style={s.zoneName}>{z.name}</Text>
                    {range ? <Text style={s.zoneRange}>{range}</Text> : null}
                  </View>
                  <View style={s.track}><View style={[s.zoneFill, { width: `${(secs / zoneTotal) * 100}%`, opacity: 0.35 + i * 0.16 }]} /></View>
                  <Text style={s.zoneTime}>{liveClock(secs)}</Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}
      {efforts.some((e) => e != null) ? (
        <>
          <Text style={s.label}>FASTEST EFFORTS</Text>
          <View style={s.card}>
            {EFFORTS.map((e, i) => (efforts[i] == null ? null : (
              <View key={e.name} style={[s.effortRow, i > 0 && s.rowLine]}>
                <Text style={s.effortRowName}>{e.name}</Text>
                <Text style={s.effortTime}>{liveClock(efforts[i]!)}</Text>
              </View>
            )))}
          </View>
        </>
      ) : null}
      {sp.done.length ? (
        <>
          <Text style={s.label}>EVERY SPLIT</Text>
          <View style={s.card}>
            <View style={s.splitHead}>
              <Text style={[s.headText, { width: 34 }]}>{per.toUpperCase()}</Text>
              <Text style={[s.headText, { width: 48 }]}>PACE</Text>
              <View style={{ flex: 1 }} />
              <Text style={[s.headText, { width: 46, textAlign: 'right' }]}>ELEV</Text>
            </View>
            {sp.done.map((d, i) => (
              <View key={d.n} style={[s.splitRow, i > 0 && s.rowLine]}>
                <Text style={s.splitN}>{d.n}</Text>
                <Text style={s.splitPace}>{liveClock(d.seconds)}</Text>
                <View style={s.track}><View style={[s.splitFill, d.seconds === quickest && s.barBest, { width: `${45 + (slowest > quickest ? (slowest - d.seconds) / (slowest - quickest) : 1) * 51}%` }]} /></View>
                <Text style={s.splitElev}>{`+${Math.round(toDisplayElevation(d.gain))} ${elevationUnit()}`}</Text>
              </View>
            ))}
            {sp.into >= 10 ? (
              <View style={[s.splitRow, s.rowLine]}>
                <Text style={s.splitN}>{(sp.into / (unitKm * 1000)).toFixed(2)}</Text>
                <Text style={[s.splitPace, { color: RivalColors.textSecondary }]}>{paceClock((sp.intoSeconds / sp.into) * 1000, unitKm)}</Text>
                <View style={s.track} />
                <Text style={s.splitElev} />
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

// Pace as a line over the elevation, both across the distance.
function PaceChart({ track, width }: { track: TrackPoint[]; width: number }) {
  const H = 96;
  const { pace, elev } = useMemo(() => {
    const along: number[] = [0];
    for (let i = 1; i < track.length; i++) along.push(along[i - 1] + metresBetween(track[i - 1], track[i]));
    const total = along[along.length - 1] || 1;
    const N = 40;
    const pts: { x: number; pace: number | null; alt: number | null }[] = [];
    let j = 0;
    for (let k = 0; k <= N; k++) {
      const at = (total * k) / N;
      while (j < along.length - 1 && along[j + 1] < at) j++;
      // Pace over about 200 m around this point.
      let a = j, b = j;
      while (a > 0 && at - along[a] < 100) a--;
      while (b < along.length - 1 && along[b] - at < 100) b++;
      const d = along[b] - along[a];
      pts.push({ x: (width * k) / N, pace: d > 50 ? ((track[b].s - track[a].s) / d) * 1000 : null, alt: track[j].alt ?? null });
    }
    const paces = pts.map((p) => p.pace).filter((p): p is number => p != null);
    const lo = Math.min(...paces), hi = Math.max(...paces);
    // Faster is higher.
    const py = (p: number) => 12 + (hi > lo ? (p - lo) / (hi - lo) : 0.5) * (H * 0.55);
    const alts = pts.map((p) => p.alt).filter((a): a is number => a != null);
    const alo = Math.min(...alts), ahi = Math.max(...alts);
    const ay = (a: number) => H - 6 - (ahi > alo ? (a - alo) / (ahi - alo) : 0.3) * (H * 0.4);
    const paceLine = pts.filter((p) => p.pace != null).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${py(p.pace!).toFixed(1)}`).join(' ');
    const elevArea = alts.length > 1
      ? `M0 ${H} ` + pts.filter((p) => p.alt != null).map((p) => `L${p.x.toFixed(1)} ${ay(p.alt!).toFixed(1)}`).join(' ') + ` L${width} ${H}Z`
      : '';
    const avg = paces.reduce((a, b) => a + b, 0) / (paces.length || 1);
    return { pace: { line: paceLine, avgY: py(avg) }, elev: elevArea };
  }, [track, width]);
  return (
    <Svg width={width} height={H} style={{ marginTop: 6 }}>
      {elev ? <Path d={elev} fill="rgba(255,255,255,0.07)" /> : null}
      <Line x1={0} x2={width} y1={pace.avgY} y2={pace.avgY} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
      <Path d={pace.line} stroke="#e8835f" strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31.5%', flexGrow: 1, alignItems: 'center', borderRadius: 14, paddingTop: 11, paddingBottom: 10, paddingHorizontal: 4, backgroundColor: 'rgba(255,255,255,0.05)' },
  effortTile: { backgroundColor: '#2f2d2c', borderWidth: 1.5, borderColor: '#e8835f', paddingTop: 9.5, paddingBottom: 8.5 },
  tileValue: { ...serif, fontSize: 21, lineHeight: 22, color: '#fff' },
  effortValue: { color: RivalColors.accentText },
  unit: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  tileName: { fontSize: 8.5, lineHeight: 11, letterSpacing: 1.2, fontWeight: '800', color: '#a0a0a0', marginTop: 6 },
  effortName: { color: RivalColors.accentText },
  card: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', paddingTop: 10, paddingHorizontal: 12, paddingBottom: 8 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: '#a0a0a0' },
  cardExtra: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: RivalColors.accentText },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 46, marginTop: 8 },
  bar: { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: 'rgba(255,181,158,0.45)' },
  barBest: { backgroundColor: '#e8835f', ...grad(180) },
  partBar: { flex: 0.7, justifyContent: 'flex-end', borderTopLeftRadius: 3, borderTopRightRadius: 3, borderWidth: 1.5, borderBottomWidth: 0, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.5)' },
  partFill: { backgroundColor: 'rgba(255,181,158,0.45)' },
  labels: { flexDirection: 'row', gap: 4, marginTop: 4 },
  barTime: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: '#fff' },
  partText: { flex: 0.7, color: '#a0a0a0' },
  barNum: { flex: 1, textAlign: 'center', fontSize: 8.5, fontWeight: '800', letterSpacing: 0.4, color: '#a0a0a0', marginTop: -2 },
  more: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  moreName: { fontSize: 13, fontWeight: '800', color: '#fff' },
  moreSub: { fontSize: 11.5, color: '#a0a0a0', marginTop: 1 },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, color: '#a0a0a0', marginTop: 16, marginBottom: 7, marginLeft: 2 },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  legendText: { fontSize: 10, fontWeight: '700', color: '#a0a0a0' },
  zone: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  zoneBadge: { width: 26, textAlign: 'center', fontSize: 9.5, fontWeight: '800', color: RivalColors.accentText, borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)', borderRadius: 6, paddingVertical: 2 },
  zoneName: { fontSize: 12, fontWeight: '800', color: '#fff' },
  zoneRange: { fontSize: 10, color: '#a0a0a0' },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  zoneFill: { height: '100%', borderRadius: 4, backgroundColor: '#e8835f' },
  zoneTime: { width: 44, textAlign: 'right', fontSize: 11.5, fontWeight: '700', color: '#fff' },
  effortRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 2 },
  rowLine: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  effortRowName: { flex: 1, fontSize: 13.5, fontWeight: '800', color: '#fff' },
  effortTime: { ...serif, fontSize: 16, color: '#fff' },
  splitHead: { flexDirection: 'row', gap: 10, paddingHorizontal: 2, paddingBottom: 4 },
  headText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 1.2, color: '#a0a0a0' },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 2 },
  splitN: { width: 34, fontSize: 12, fontWeight: '800', color: '#a0a0a0' },
  splitPace: { ...serif, width: 48, fontSize: 15, color: '#fff' },
  splitFill: { height: '100%', borderRadius: 4, backgroundColor: 'rgba(255,181,158,0.55)' },
  splitElev: { width: 46, textAlign: 'right', fontSize: 11, color: '#a0a0a0' },
});
