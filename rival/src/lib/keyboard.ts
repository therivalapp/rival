import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

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
