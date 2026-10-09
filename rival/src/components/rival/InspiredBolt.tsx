import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { RivalIcon } from './RivalIcon';

// The Inspired bolt on feed cards. With `animate` on, giving Inspired flashes
// the bolt twice and sends a bolt-shaped outline out from it (keyframes in
// global.css); taking it back just swaps the colour. Web only: the native
// build shows the plain icon. `onStyle` paints the given bolt in the same fade
// as the word beside it.
const FLASH_MS = 700;
const CHARGE_DELAY_MS = 300;
const CHARGE_MS = 650;

export function InspiredBolt({ on, size, onColour, offColour, onStyle, animate }: {
  on: boolean; size: number; onColour: string; offColour: string; onStyle?: object | false; animate: boolean;
}) {
  const [play, setPlay] = useState(0);
  const was = useRef(on);
  useEffect(() => {
    if (on && !was.current && animate && Platform.OS === 'web') setPlay((n) => n + 1);
    was.current = on;
  }, [on, animate]);

  useEffect(() => {
    if (!play) return;
    const t = setTimeout(() => setPlay(0), CHARGE_DELAY_MS + CHARGE_MS + 50);
    return () => clearTimeout(t);
  }, [play]);

  const flash: any = play ? { animationName: 'rivalBoltFlash', animationDuration: `${FLASH_MS}ms`, animationTimingFunction: 'ease-out' } : null;
  return (
    <View style={{ width: size, height: size }}>
      <View key={play} style={flash}>
        <RivalIcon name="bolt" size={size} color={on ? onColour : offColour} style={on && onStyle ? (onStyle as any) : undefined} />
      </View>
      {play ? (
        <View key={`c${play}`} pointerEvents="none" style={{
          position: 'absolute', left: 0, top: 0, opacity: 0,
          animationName: 'rivalBoltCharge', animationDuration: `${CHARGE_MS}ms`,
          animationDelay: `${CHARGE_DELAY_MS}ms`, animationTimingFunction: 'ease-out', animationFillMode: 'forwards',
        } as any}>
          <RivalIcon name="bolt" size={size} color="transparent" style={{ WebkitTextStroke: `1px ${onColour}` } as any} />
        </View>
      ) : null}
    </View>
  );
}
