import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

// Whether the phone's on-screen keyboard is up (web). Older iOS shrinks only
// the visual viewport, so it reads smaller than window.innerHeight. Newer iOS
// (seen 2026-11-11: the chat's message box sat behind the keyboard) shrinks
// window.innerHeight with it, so that test reads "no keyboard". There, a
// field being typed in on a touch screen with the visible area well under
// the screen's height means the keyboard is up.
export function softKeyboardUp(): boolean {
  if (typeof window === 'undefined' || !window.visualViewport) return false;
  const vv = window.visualViewport;
  if (window.innerHeight - vv.height > 120) return true;
  const el = document.activeElement as HTMLElement | null;
  const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  return typing && touch && window.screen.height - vv.height > 150;
}

// Whether the phone's keyboard is up (web: the visual viewport has shrunk
// well below the window). Pages use it to step their bottom bar aside while
// typing, so the field sits right above the keyboard (Ricky, 2026-10-24).
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => setOpen(softKeyboardUp());
    update();
    vv.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      vv.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
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
    const update = () => setH(softKeyboardUp() ? Math.round(vv.height) : undefined);
    update();
    vv.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      vv.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return h;
}

/** The screen height a pop-up can use: above the keyboard when it is up. */
export function useScreenHeight(): number {
  const { height } = useWindowDimensions();
  const fit = useKeyboardFitHeight();
  return fit ?? height;
}
