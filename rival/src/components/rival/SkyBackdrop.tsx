import { Platform, StyleSheet, View } from 'react-native';

// An activity with no photo shows a soft sky for the hour it started: dawn,
// morning, midday, late afternoon, dusk or night (Ricky, 2026-10-14). Muted and
// slightly dimmed so a real photo still stands out next to it. Web draws the
// gradients; native shows the sky's middle colour until it has its own.

export type SkyName = 'dawn' | 'morning' | 'midday' | 'golden' | 'dusk' | 'night';

type Sky = { sky: string; glow: string; flat: string };

const SKIES: Record<SkyName, Sky> = {
  dawn: {
    sky: 'linear-gradient(180deg, #1f2c4a 0%, #4a4766 45%, #b07a74 80%, #d9a07e 100%)',
    glow: 'radial-gradient(ellipse 80% 45% at 50% 110%, rgba(255,190,140,0.35), rgba(255,190,140,0) 70%)',
    flat: '#4a4766',
  },
  morning: {
    sky: 'linear-gradient(180deg, #4f7391 0%, #7f9cb0 50%, #c8b294 100%)',
    glow: 'radial-gradient(ellipse 80% 50% at 30% 105%, rgba(255,230,180,0.25), rgba(255,230,180,0) 70%)',
    flat: '#7f9cb0',
  },
  midday: {
    sky: 'linear-gradient(180deg, #3f6f93 0%, #6f9bb8 55%, #a9c2cf 100%)',
    glow: 'radial-gradient(ellipse 70% 40% at 50% -10%, rgba(255,255,255,0.18), rgba(255,255,255,0) 70%)',
    flat: '#6f9bb8',
  },
  golden: {
    sky: 'linear-gradient(180deg, #5b5f7d 0%, #a7786a 50%, #e0a46a 100%)',
    glow: 'radial-gradient(ellipse 80% 50% at 70% 110%, rgba(255,200,120,0.35), rgba(255,200,120,0) 70%)',
    flat: '#a7786a',
  },
  dusk: {
    sky: 'linear-gradient(180deg, #2a2347 0%, #5d3a5e 45%, #b05e57 82%, #d98a5c 100%)',
    glow: 'radial-gradient(ellipse 85% 45% at 50% 112%, rgba(255,150,100,0.32), rgba(255,150,100,0) 70%)',
    flat: '#5d3a5e',
  },
  night: {
    sky: 'linear-gradient(180deg, #0d1424 0%, #1a2238 60%, #2a2a3c 100%)',
    glow: 'radial-gradient(ellipse 90% 50% at 50% 115%, rgba(120,130,190,0.22), rgba(120,130,190,0) 70%)',
    flat: '#1a2238',
  },
};

const STARS = [
  'radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,0.7), transparent)',
  'radial-gradient(1px 1px at 33% 9%, rgba(255,255,255,0.5), transparent)',
  'radial-gradient(1.2px 1.2px at 58% 24%, rgba(255,255,255,0.6), transparent)',
  'radial-gradient(1px 1px at 78% 12%, rgba(255,255,255,0.55), transparent)',
  'radial-gradient(1px 1px at 88% 34%, rgba(255,255,255,0.4), transparent)',
  'radial-gradient(1px 1px at 22% 40%, rgba(255,255,255,0.35), transparent)',
].join(', ');

/** The hour an activity started where it happened: from its own UTC offset
 *  when known (add_utc_offset.sql), else the viewer's clock. */
export function localHour(startedAt: string | null | undefined, utcOffsetSeconds?: number | null): number {
  if (!startedAt) return 12;
  const d = new Date(startedAt);
  if (typeof utcOffsetSeconds === 'number') return new Date(d.getTime() + utcOffsetSeconds * 1000).getUTCHours();
  return d.getHours();
}

/** The sky for the local hour an activity started. */
export function skyFor(startedAt: string | null | undefined, utcOffsetSeconds?: number | null): SkyName {
  const h = localHour(startedAt, utcOffsetSeconds);
  // Dawn 5–7, dusk 6–8 pm (Ricky, 2026-10-14).
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 11) return 'morning';
  if (h >= 11 && h < 15) return 'midday';
  if (h >= 15 && h < 18) return 'golden';
  if (h >= 18 && h < 20) return 'dusk';
  return 'night';
}

/** Fills its parent (which should clip with overflow: hidden). */
export function SkyBackdrop({ startedAt, utcOffsetSeconds }: { startedAt: string | null | undefined; utcOffsetSeconds?: number | null }) {
  const name = skyFor(startedAt, utcOffsetSeconds);
  const sky = SKIES[name];
  const web = Platform.OS === 'web';
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: sky.flat }, web && ({ backgroundImage: sky.sky } as any)]}>
      {web ? <View style={[StyleSheet.absoluteFill, { backgroundImage: sky.glow } as any]} /> : null}
      {web && name === 'night' ? <View style={[StyleSheet.absoluteFill, { backgroundImage: STARS } as any]} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,14,10,0.28)' }]} />
    </View>
  );
}
