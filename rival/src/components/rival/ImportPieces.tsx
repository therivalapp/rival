import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily, rivalWordmark } from '../../constants/rivalTheme';

// The import pages' shared pieces: the loader and the fact rows, used by
// Import an archive and Apple Health (Mockup 29, 2026-11-10).

// Loading (Ricky, 2026-11-08, option C): the opening screen's pulsing RIVAL
// over a bar that fills, and what the archive holds counting up beneath.
export function LoaderCard({ fileName, pct, rows }: { fileName: string; pct: number; rows: { label: string; value: number; of?: number }[] }) {
  const web = Platform.OS === 'web';
  return (
    <View style={[s.card, s.loader]}>
      <Text style={[s.word, web && ({ animationName: 'rivalBusyPulse', animationDuration: '1.65s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' } as any)]}>RIVAL</Text>
      <View style={s.loaderTrack}>
        <View style={[s.loaderFill, { width: `${pct}%` as any }, web && ({ transition: 'width 0.5s ease-out' } as any)]} />
      </View>
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
  loaderFile: { fontFamily: RivalFontFamily, fontSize: 12, color: 'rgba(255,255,255,0.5)', maxWidth: '90%' },
  loaderFacts: { alignSelf: 'stretch', marginTop: 14 },
});
