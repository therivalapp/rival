import { useEffect, useState } from 'react';
import { Platform, Text, type StyleProp, type TextStyle } from 'react-native';

/** A figure counting up from 0 once, easing to a stop, as when Strava is
 *  first connected. `format` turns the running value into text. */
export function CountUp({ value, format, duration = 1600, delay = 0, style }: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  delay?: number;
  style?: StyleProp<TextStyle>;
}) {
  const [shown, setShown] = useState(Platform.OS === 'web' ? 0 : value);
  useEffect(() => {
    if (Platform.OS !== 'web') { setShown(value); return; }
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / duration);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [value, duration, delay]);
  return <Text style={style}>{format ? format(shown) : Math.round(shown).toLocaleString()}</Text>;
}
