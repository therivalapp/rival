import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Animated, Easing, Platform, StyleSheet, Text } from 'react-native';
import { RivalSerifFamily } from '../../constants/rivalTheme';

// The words that fade in and out once a photo is kept (Ricky, 2026-10-31).
// Under <body>, so it shows over pop-ups and the bottom bar alike.
export function MomentCaptured({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      Animated.delay(800),
      Animated.timing(opacity, { toValue: 0, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: false }),
    ]).start(() => onDone());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const words = (
    <Animated.View style={[s.cover, { opacity, pointerEvents: 'none' }]}>
      <Text style={s.words}>Moment Captured.</Text>
    </Animated.View>
  );
  return Platform.OS === 'web' ? createPortal(words, document.body) : words;
}

const s = StyleSheet.create({
  cover: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10001,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)',
  },
  words: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, lineHeight: 37, color: '#fff', textAlign: 'center' },
});
