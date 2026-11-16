import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, Modal as RNModal, Platform, View, type ModalProps } from 'react-native';
import { useKeyboardFitHeight } from '../../lib/keyboard';

// React Native Web's "slide" moves the whole full-screen layer, dark backdrop
// included, so closing a pop-up dragged a black screen down behind it (Ricky,
// 2026-11-01). Here the backdrop fades where it is and only the sheet moves,
// through useSheetMotion. Use this in place of React Native's Modal.

const SheetOpen = createContext<boolean | null>(null);

export function Modal({ animationType, visible = true, children, ...rest }: ModalProps) {
  if (animationType !== 'slide') {
    return <RNModal {...rest} animationType={animationType} visible={visible}><KeyboardFit>{children}</KeyboardFit></RNModal>;
  }
  return (
    <SheetOpen.Provider value={visible}>
      <RNModal {...rest} animationType="fade" visible={visible}><KeyboardFit>{children}</KeyboardFit></RNModal>
    </SheetOpen.Provider>
  );
}

/** A page shown as a pop-up (a route over the page before): its sheet rises
 *  on its own on the web too, as in a Modal, while the layer only fades
 *  (Goals, Mockup 83, Ricky 2026-11-15). */
export function RoutePopUp({ children }: { children: ReactNode }) {
  return <SheetOpen.Provider value={true}>{children}</SheetOpen.Provider>;
}

// A pop-up's layer covers the whole screen and doesn't shrink with the
// keyboard the way the app does (_layout.tsx), so a bottom sheet stayed
// behind the keyboard and typing happened out of sight (Ricky, 2026-11-05).
// While the keyboard is up the layer takes only the space above it; the
// app's focus handler then scrolls the field into view inside the sheet.
function KeyboardFit({ children }: { children: ReactNode }) {
  const h = useKeyboardFitHeight();
  if (Platform.OS !== 'web') return <>{children}</>;
  return <View style={h != null ? { height: h, overflow: 'hidden' } : { flex: 1 }}>{children}</View>;
}

// iPhone: the same as the web (Mockup 48 · More motion C, Ricky 2026-11-13).
// The pop-up's layer fades and the sheet rises on its own with a short
// settle, overshooting 8px and easing back, then drops on close.
const RISE_EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** iPhone: the sheet's rise, as a translateY value. `open` null is a page
 *  shown as a pop-up (a route), which rises once when it opens. */
export function useSheetRise(given?: boolean | null): Animated.Value {
  const ctx = useContext(SheetOpen);
  const open = given === undefined ? ctx : given;
  const far = Dimensions.get('window').height;
  const rise = useRef(new Animated.Value(Platform.OS === 'web' ? 0 : far)).current;
  const shown = open !== false;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (shown) {
      rise.setValue(far);
      Animated.sequence([
        Animated.timing(rise, { toValue: -8, duration: 300, easing: RISE_EASE, useNativeDriver: false }),
        Animated.timing(rise, { toValue: 0, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      ]).start();
    } else {
      Animated.timing(rise, { toValue: far, duration: 220, easing: Easing.bezier(0.47, 0, 0.745, 0.715), useNativeDriver: false }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return rise;
}

/** For the sheet inside a sliding Modal: rises on open, drops on close. The
 *  keyframes (global.css) move `translate`, so a sheet already dragged down
 *  with `transform` carries on from where it is. */
export function useSheetMotion(): any {
  return sheetMotion(useContext(SheetOpen));
}

/** The same, for a component that renders the Modal itself and so sits
 *  outside its context. */
export function sheetMotion(open: boolean | null): any {
  if (open === null || Platform.OS !== 'web') return null;
  return open
    ? { animationName: 'rivalSheetUp', animationDuration: '380ms', animationTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)', animationFillMode: 'backwards' }
    : { animationName: 'rivalSheetDown', animationDuration: '220ms', animationTimingFunction: 'cubic-bezier(0.47, 0, 0.745, 0.715)', animationFillMode: 'forwards' };
}
