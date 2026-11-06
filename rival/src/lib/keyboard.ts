import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

// Whether the phone's keyboard is up (web: the visual viewport has shrunk
// well below the window). Pages use it to step their bottom bar aside while
// typing, so the field sits right above the keyboard (Ricky, 2026-10-24).
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => setOpen(window.innerHeight - vv.height > 120);
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);
  return open;
}

// The height left above the phone's keyboard while it is up (web: the
// visual viewport), else undefined. Pop-ups (RivalModal) shrink to it, so a
// sheet anchored to the bottom rises above the keyboard instead of typing
// behind it (Ricky, 2026-11-05: an event name typed out of sight).
export function useKeyboardFitHeight(): number | undefined {
  const [h, setH] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => setH(window.innerHeight - vv.height > 120 ? Math.round(vv.height) : undefined);
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);
  return h;
}

/** The screen height a pop-up can use: above the keyboard when it is up. */
export function useScreenHeight(): number {
  const { height } = useWindowDimensions();
  const fit = useKeyboardFitHeight();
  return fit ?? height;
}
