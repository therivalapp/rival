import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily, rivalWordmark } from '../../constants/rivalTheme';
import { RivalIcon, type RivalIconName } from './RivalIcon';
import { GradientText } from './GradientText';
import { webFx } from '../../lib/webFx';

// The import pages' shared pieces: the loader and the fact rows, used by
// Import an archive and Apple Health (Mockup 29, 2026-11-10).

// Loading (Ricky, 2026-11-08, option C): the opening screen's pulsing RIVAL
// over a bar that fills, and what the archive holds counting up beneath.
export function LoaderCard({ fileName, pct, rows, detail }: { fileName: string; pct: number; rows: { label: string; value: number; of?: number }[]; detail?: string }) {
  const web = Platform.OS === 'web';
  return (
    <View style={[s.card, s.loader]}>
      <Text style={[s.word, web && ({ animationName: 'rivalBusyPulse', animationDuration: '1.65s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' } as any)]}>RIVAL</Text>
      <View style={s.loaderTrack}>
        <View style={[s.loaderFill, { width: `${pct}%` as any }, web && ({ transition: 'width 0.5s ease-out' } as any)]} />
      </View>
      {detail ? <Text style={s.loaderDetail}>{detail}</Text> : null}
      <Text style={s.loaderFile} numberOfLines={1}>{fileName}</Text>
      <View style={[s.facts, s.loaderFacts]}>
        {rows.map((r, k) => (
          <View key={r.label} style={[s.fact, k > 0 && s.factDivided]}>
            <Text style={s.factLabel}>{r.label}</Text>
            <Text style={s.factValue}>
              <Tally value={r.value} />
              {r.of != null ? <Text style={s.factOf}> of {r.of.toLocaleString()}</Text> : null}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A number that climbs to each new value instead of jumping. */
function Tally({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (Platform.OS !== 'web') { setShown(value); return; }
    const start = from.current;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / 900);
      const v = start + (value - start) * (1 - Math.pow(1 - p, 3));
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{Math.round(shown).toLocaleString()}</>;
}


export function Fact({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View style={[s.fact, !first && s.factDivided]}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
    </View>
  );
}


/** Ready to import (Mockup 94 v2): the new count large and centred, a caps
 *  line and the date range, then detail tiles. */
export function ReadyHead({ count, caption, span }: { count: number; caption: string; span?: string }) {
  return (
    <View style={r.head}>
      <GradientText style={r.num}>{count.toLocaleString()}</GradientText>
      <Text style={r.cap}>{caption}</Text>
      {span ? <Text style={r.span}>{span}</Text> : null}
    </View>
  );
}

/** A detail tile on Ready to import: a faint icon behind, words bottom left. */
export function ReadyTile({ icon, value, label }: { icon: RivalIconName; value: number; label: string }) {
  return (
    <View style={r.tile}>
      <View style={r.tileIcon}><RivalIcon name={icon} size={52} color="rgba(255,255,255,0.06)" /></View>
      <Text style={r.tileValue}>{value.toLocaleString()}</Text>
      <Text style={r.tileLabel}>{label}</Text>
    </View>
  );
}

const r = StyleSheet.create({
  head: { alignItems: 'center', paddingTop: 16 },
  num: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 72, lineHeight: 80, paddingHorizontal: 8, color: RivalColors.accentText, ...webFx({ backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #D97757 150%)', backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' }) },
  cap: { fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', color: RivalColors.accentText, marginTop: 2, textAlign: 'center' },
  span: { fontFamily: RivalFontFamily, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)', marginTop: 6, textAlign: 'center' },
  tile: { flex: 1, height: 86, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,209,190,0.08)', overflow: 'hidden', justifyContent: 'flex-end', paddingHorizontal: 11, paddingBottom: 10 },
  tileIcon: { position: 'absolute', right: -6, top: -4 },
  tileValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 26, color: '#fff' },
  tileLabel: { fontFamily: RivalFontFamily, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginTop: 2 },
});

const s = StyleSheet.create({
  card: { borderRadius: 22, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, padding: 16, gap: 10 },
  facts: { borderRadius: 14, backgroundColor: 'rgba(255,209,190,0.05)' },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  factDivided: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  factLabel: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.62)' },
  factOf: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontWeight: '400', fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  factValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: '#fff' },
  loader: { alignItems: 'center', paddingTop: 36, gap: 16 },
  word: { ...rivalWordmark(22), color: RivalColors.accentText, opacity: 0.9 },
  loaderTrack: { width: 180, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  loaderFill: { height: 4, borderRadius: 2, backgroundColor: RivalColors.accentText },
  loaderDetail: { fontFamily: RivalFontFamily, fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.8)', marginBottom: -8 },
  loaderFile: { fontFamily: RivalFontFamily, fontSize: 12, color: 'rgba(255,255,255,0.5)', maxWidth: '90%' },
  loaderFacts: { alignSelf: 'stretch', marginTop: 14 },
});
