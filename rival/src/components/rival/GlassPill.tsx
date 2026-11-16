import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { webFx } from '../../lib/webFx';

// Glass pill (Mockup 69 C, Mockup 71): the first-place podium glass as a
// label pill. A tinted gradient body, a bright top rim and a soft sheen over
// the top half. Every label pill uses it, each in its own colour; the words
// take the tone's text colour (GLASS_TEXT).

export type GlassTone = 'gold' | 'ivory' | 'green' | 'peach' | 'salmon' | 'amber' | 'dark' | 'grey';

const TONES: Record<GlassTone, { rgb: string; light: string }> = {
  gold: { rgb: '255,215,0', light: '255,244,184' },
  ivory: { rgb: '244,234,216', light: '255,255,255' },
  green: { rgb: '95,211,138', light: '190,255,215' },
  peach: { rgb: '232,131,95', light: '255,214,196' },
  salmon: { rgb: '255,181,158', light: '255,230,220' },
  amber: { rgb: '245,183,89', light: '255,232,190' },
  dark: { rgb: '20,20,20', light: '255,255,255' },
  grey: { rgb: '255,255,255', light: '255,255,255' },
};

export const GLASS_TEXT: Record<GlassTone, string> = {
  gold: '#FFD700',
  ivory: '#f4ead8',
  green: '#7fe0a4',
  peach: '#ffd3c2',
  salmon: '#ffb59e',
  amber: '#F5B759',
  dark: '#ffffff',
  grey: 'rgba(255,255,255,0.65)',
};

function body(tone: GlassTone): ViewStyle {
  const { rgb, light } = TONES[tone];
  if (tone === 'dark') {
    return {
      backgroundColor: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,255,255,0.25)', borderTopColor: 'rgba(255,255,255,0.55)',
      ...webFx({ backgroundImage: 'linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.45) 100%)' }),
    };
  }
  if (tone === 'grey') {
    return {
      backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.18)', borderTopColor: 'rgba(255,255,255,0.4)',
      ...webFx({ backgroundImage: 'linear-gradient(160deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 55%, rgba(255,255,255,0.06) 100%)' }),
    };
  }
  return {
    backgroundColor: `rgba(${rgb},0.18)`,
    borderColor: `rgba(${rgb},0.7)`,
    borderTopColor: `rgba(${light},0.9)`,
    ...webFx({
      backgroundImage: `linear-gradient(160deg, rgba(${light},0.30) 0%, rgba(${rgb},0.14) 55%, rgba(${rgb},0.24) 100%)`,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(0,0,0,0.25)',
    }),
  };
}

export function GlassPill({ tone, style, faded, children }: { tone: GlassTone; style?: StyleProp<ViewStyle>; faded?: boolean; children: React.ReactNode }) {
  return (
    <View style={[style, s.pill, body(tone), faded && s.faded]}>
      <View style={[s.sheen, webFx({ backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0))' }), { pointerEvents: 'none' }]} />
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  pill: { borderWidth: 1, borderRadius: 999, overflow: 'hidden' },
  sheen: { position: 'absolute', left: 6, right: 6, top: 1, height: '45%', borderRadius: 999 },
  faded: { opacity: 0.6 },
});
