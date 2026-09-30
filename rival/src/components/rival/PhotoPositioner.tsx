import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, GestureResponderEvent, PanResponderGestureState, PanResponder, Platform } from 'react-native';
import { RivalColors, RivalType, RivalRadius, RivalButtonColors } from '../../constants/rivalTheme';
import { computeCoverLayout } from './CoverImage';

const FRAME_W = 300;
const FRAME_H = 400;

// Drag-to-reposition crop editor shown right after a photo upload. Doesn't
// crop or re-encode the file — just records a focal point (0-1 fractions)
// that CoverImage applies wherever the photo renders, so one stored value
// works across the card grid's 3:4 tiles and the diary viewer's wider hero
// box without needing per-surface crops. Uses the same manual cover-math as
// CoverImage (not CSS object-fit/object-position) so what you drag here is
// pixel-for-pixel what you'll see everywhere else.
export function PhotoPositioner({
  photoUrl,
  initialX = 0.5,
  initialY = 0.5,
  onConfirm,
  onCancel,
}: {
  photoUrl: string;
  initialX?: number;
  initialY?: number;
  onConfirm: (x: number, y: number) => void;
  // Backs all the way out of the photo pick — reverts the cover photo to
  // whatever it was before, not just accepts a default center crop of the
  // new one (that's what "Use This Crop" without dragging already does).
  onCancel: () => void;
}) {
  const [focal, setFocal] = useState({ x: initialX, y: initialY });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const startFocal = useRef(focal);
  // PanResponder is created once below via useRef, so its handlers close over
  // whatever `natural`/`focal` were AT THAT FIRST RENDER — permanently null /
  // permanently the initial focal, since Image.getSize resolves
  // asynchronously and focal changes on every subsequent drag. Refs sidestep
  // that: reading .current inside a handler always sees the latest value
  // instead of the one baked into the closure at creation time.
  const naturalRef = useRef<{ w: number; h: number } | null>(null);
  const focalRef = useRef(focal);
  useEffect(() => { focalRef.current = focal; }, [focal]);

  useEffect(() => {
    let cancelled = false;
    Image.getSize(photoUrl, (w, h) => {
      if (cancelled) return;
      naturalRef.current = { w, h };
      setNatural({ w, h });
    }, () => {});
    return () => { cancelled = true; };
  }, [photoUrl]);

  const layout = natural ? computeCoverLayout(FRAME_W, FRAME_H, natural.w, natural.h, focal.x, focal.y) : null;

  // Standard "drag the photo where you want it" feel: moving the pointer
  // right should reveal more of the image's left side, so a positive dx
  // DECREASES the focal x fraction (and same inverted relationship for y).
  // Deltas are scaled against the image's own overflow (maxOffsetX/Y), not
  // the frame size — a wider/taller-than-frame image has more room to pan,
  // so the same finger movement should cover proportionally less of its
  // focal range, or dragging feels sluggish on a barely-oversized photo and
  // twitchy on a much-larger one.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => { startFocal.current = focalRef.current; },
      onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
        const natural = naturalRef.current;
        if (!natural) return;
        const l = computeCoverLayout(FRAME_W, FRAME_H, natural.w, natural.h, startFocal.current.x, startFocal.current.y);
        const nx = l.maxOffsetX > 0 ? clamp01(startFocal.current.x - g.dx / l.maxOffsetX) : startFocal.current.x;
        const ny = l.maxOffsetY > 0 ? clamp01(startFocal.current.y - g.dy / l.maxOffsetY) : startFocal.current.y;
        setFocal({ x: nx, y: ny });
      },
    })
  ).current;

  return (
    <View style={styles.overlay}>
      <Text style={styles.title}>Position photo</Text>
      <Text style={styles.subtitle}>Drag to adjust the crop</Text>

      <View style={styles.frame} {...panResponder.panHandlers}>
        {layout && (
          Platform.OS === 'web' ? (
            // A real <img> (which RN's <Image> renders to on web) has native
            // browser drag-and-drop enabled by default — starting a drag on
            // top of it fires the OS's own image-drag gesture instead of our
            // PanResponder's touch/mouse-move events, so the crop appeared
            // completely un-draggable specifically where the photo covers
            // the frame. A plain View with a CSS background image has no
            // such built-in drag behavior. Same fix CoverImage already uses.
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', width: layout.renderW, height: layout.renderH, left: layout.left, top: layout.top,
                backgroundImage: `url("${photoUrl}")`, backgroundSize: '100% 100%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
              } as any}
            />
          ) : (
            <Image
              source={{ uri: photoUrl }}
              style={{ position: 'absolute', width: layout.renderW, height: layout.renderH, left: layout.left, top: layout.top }}
            />
          )
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.skipBtn} onPress={onCancel}>
          <Text style={styles.skipLabel}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.confirmBtn} onPress={() => onConfirm(focal.x, focal.y)}>
          <Text style={styles.confirmLabel}>Use this crop</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(10,10,10,0.96)', zIndex: 600,
    alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24,
  },
  title: { ...RivalType.titleMd, color: RivalColors.textPrimary },
  subtitle: { fontSize: 13, color: RivalColors.textSecondary, marginTop: -8, marginBottom: 6 },
  frame: {
    width: FRAME_W, height: FRAME_H, borderRadius: RivalRadius.lg, overflow: 'hidden',
    backgroundColor: '#211c19', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: RivalRadius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  skipLabel: { fontSize: 14, fontWeight: '600', color: RivalColors.textSecondary },
  confirmBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: RivalRadius.full, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  confirmLabel: { fontSize: 14, fontWeight: '700', color: RivalButtonColors.label(RivalColors.onAccentFill) },
});
