import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { RivalIcon } from './RivalIcon';

// The Respect star on feed cards. With `animate` on, giving Respect plays the
// spin-and-shine (keyframes in global.css); taking it back just swaps the icon.
// Web only: the native build shows the plain icon.
const SPIN_MS = 620;
const RAY_DELAY_MS = 380;
const RAY_MS = 480;
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

export function RespectStar({ on, size, onColour, offColour, animate }: {
  on: boolean; size: number; onColour: string; offColour: string; animate: boolean;
}) {
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
        <RivalIcon name={on ? 'star' : 'starOutline'} size={size} color={on ? onColour : offColour} />
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
