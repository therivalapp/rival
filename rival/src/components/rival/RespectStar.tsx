import { useEffect, useId, useRef, useState } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Platform, View } from 'react-native';
import { RivalIcon } from './RivalIcon';

// The Respect star on feed cards. With `animate` on, giving Respect plays the
// spin-and-shine (keyframes in global.css); taking it back just swaps the icon.
// Web only: the native build shows the plain icon.
const SPIN_MS = 620;
const RAY_DELAY_MS = 380;
const RAY_MS = 480;
// Material's star and star-border, the same shapes as the icon font.
const STAR_FILLED = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';
const STAR_OUTLINE = 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z';
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

export function RespectStar({ on, size, onColour, offColour, animate, onGradient }: {
  on: boolean; size: number; onColour: string; offColour: string; animate: boolean;
  /** Web: fill the given star top-to-bottom, like the Effort numbers. */
  onGradient?: readonly [string, string];
}) {
  const gid = `starFill${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [play, setPlay] = useState(0);
  const was = useRef(on);
  useEffect(() => {
    if (on && !was.current && animate && Platform.OS === 'web') setPlay((n) => n + 1);
    was.current = on;
  }, [on, animate]);

  useEffect(() => {
    if (!play) return;
    const t = setTimeout(() => setPlay(0), RAY_DELAY_MS + RAY_MS + 50);
    return () => clearTimeout(t);
  }, [play]);

  const spin: any = play ? { animationName: 'rivalStarSpinShine', animationDuration: `${SPIN_MS}ms`, animationTimingFunction: 'cubic-bezier(.3,1.4,.5,1)' } : null;
  return (
    <View style={{ width: size, height: size }}>
      <View key={play} style={spin}>
        {onGradient ? (
          // Drawn as a vector rather than the icon font, so a large star keeps
          // crisp edges and takes the Effort gradient (Ricky, 2026-10-14).
          <Svg width={size} height={size} viewBox="0 0 24 24">
            <Defs>
              <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={onGradient[0]} />
                <Stop offset="1" stopColor={onGradient[1]} />
              </LinearGradient>
            </Defs>
            <Path d={on ? STAR_FILLED : STAR_OUTLINE} fill={on ? `url(#${gid}) ${onColour}` : offColour} />
          </Svg>
        ) : (
          <RivalIcon name={on ? 'star' : 'starOutline'} size={size} color={on ? onColour : offColour} />
        )}
      </View>
      {play ? RAYS.map((deg) => (
        <View key={`${play}-${deg}`} pointerEvents="none" style={{ position: 'absolute', left: size / 2 - 1, top: size / 2 - 8, width: 2, height: 8, transform: [{ rotate: `${deg}deg` }], transformOrigin: '50% 100%' } as any}>
          <View style={{
            width: 2, height: 8, borderRadius: 2, backgroundColor: onColour, opacity: 0,
            transformOrigin: '50% 100%', animationName: 'rivalStarRay', animationDuration: `${RAY_MS}ms`,
            animationDelay: `${RAY_DELAY_MS}ms`, animationTimingFunction: 'ease-out', animationFillMode: 'forwards',
          } as any} />
        </View>
      )) : null}
    </View>
  );
}

// The given star alone, drawn sharp in the Effort numbers' gold fade: the
// pin on day cards and Highlights (Ricky, 2026-10-14).
export const STAR_GOLD = ['#fff4d6', '#ffc94d'] as const;
export function GoldStar({ size }: { size: number }) {
  const gid = `goldStar${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={STAR_GOLD[0]} />
          <Stop offset="1" stopColor={STAR_GOLD[1]} />
        </LinearGradient>
      </Defs>
      <Path d={STAR_FILLED} fill={`url(#${gid}) ${STAR_GOLD[1]}`} />
    </Svg>
  );
}
