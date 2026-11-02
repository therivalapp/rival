import { createContext, useContext } from 'react';
import { Modal as RNModal, Platform, type ModalProps } from 'react-native';

// React Native Web's "slide" moves the whole full-screen layer, dark backdrop
// included, so closing a pop-up dragged a black screen down behind it (Ricky,
// 2026-11-01). Here the backdrop fades where it is and only the sheet moves,
// through useSheetMotion. Use this in place of React Native's Modal.

const SheetOpen = createContext<boolean | null>(null);

export function Modal({ animationType, visible = true, children, ...rest }: ModalProps) {
  if (Platform.OS !== 'web' || animationType !== 'slide') {
    return <RNModal {...rest} animationType={animationType} visible={visible}>{children}</RNModal>;
  }
  return (
    <SheetOpen.Provider value={visible}>
      <RNModal {...rest} animationType="fade" visible={visible}>{children}</RNModal>
    </SheetOpen.Provider>
  );
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
    ? { animationName: 'rivalSheetUp', animationDuration: '250ms', animationTimingFunction: 'cubic-bezier(0.215, 0.61, 0.355, 1)', animationFillMode: 'backwards' }
    : { animationName: 'rivalSheetDown', animationDuration: '220ms', animationTimingFunction: 'cubic-bezier(0.47, 0, 0.745, 0.715)', animationFillMode: 'forwards' };
}
