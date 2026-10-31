import { createElement, useEffect, useRef, useState } from 'react';
import { Image, PanResponder, Platform, StyleProp, View, ViewStyle } from 'react-native';
import { computeCoverLayout } from './CoverImage';
import { cardPhoto } from '../../lib/imageUrl';

// A photo or video in a frame, dragged to choose which part stays in view.
// Nothing is cut: it records a focal point (0 to 1 across and down) that
// CoverImage and WebVideo apply wherever the item is shown, the same rule
// for every shape of frame. Used in the photo picker, so positioning is part
// of choosing photos rather than a step after it (Ricky, 2026-10-24).
export function FocalFrame({
  uri,
  type,
  focalX = 0.5,
  focalY = 0.5,
  width,
  height,
  onChange,
  style,
}: {
  uri: string;
  type: 'photo' | 'video';
  focalX?: number;
  focalY?: number;
  width: number;
  height: number;
  onChange: (x: number, y: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  // The card-sized copy: quick to load, and plenty for a frame this size.
  const shown = type === 'photo' ? cardPhoto(uri) : uri;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // The responder is made once, so its handlers read these refs for the
  // latest size, position and callback rather than the first render's.
  const naturalRef = useRef(natural);
  const focalRef = useRef({ x: focalX, y: focalY });
  const startRef = useRef(focalRef.current);
  const onChangeRef = useRef(onChange);
  focalRef.current = { x: focalX, y: focalY };
  onChangeRef.current = onChange;
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  useEffect(() => {
    if (type !== 'photo') return;
    let cancelled = false;
    setNatural(null);
    Image.getSize(shown, (w, h) => { if (!cancelled) { naturalRef.current = { w, h }; setNatural({ w, h }); } }, () => {});
    return () => { cancelled = true; };
  }, [shown, type]);

  const frameRef = useRef<any>(null);

  function dragBy(dx: number, dy: number) {
    const n = naturalRef.current;
    if (!n) return;
    const { width: fw, height: fh } = sizeRef.current;
    const s = startRef.current;
    const l = computeCoverLayout(fw, fh, n.w, n.h, s.x, s.y);
    // Dragging right shows more of the left side, so x goes down.
    const x = l.maxOffsetX > 0 ? clamp01(s.x - dx / l.maxOffsetX) : s.x;
    const y = l.maxOffsetY > 0 ? clamp01(s.y - dy / l.maxOffsetY) : s.y;
    onChangeRef.current(x, y);
  }
  const dragRef = useRef(dragBy);
  dragRef.current = dragBy;

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { startRef.current = focalRef.current; },
    onPanResponderMove: (_e, g) => dragRef.current(g.dx, g.dy),
  })).current;

  // Web listens to the finger and mouse directly. The frame sits inside a
  // scrolling pop-up, and on iPhones the scroll took the gesture away from
  // PanResponder (Ricky, 2026-10-31), so the photo would not move.
  useEffect(() => {
    const el = frameRef.current as HTMLElement | null;
    if (Platform.OS !== 'web' || !el || typeof el.addEventListener !== 'function') return;
    let fromX = 0, fromY = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      fromX = e.touches[0].clientX; fromY = e.touches[0].clientY;
      startRef.current = focalRef.current;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      dragRef.current(e.touches[0].clientX - fromX, e.touches[0].clientY - fromY);
    };
    const onMouseMove = (e: MouseEvent) => dragRef.current(e.clientX - fromX, e.clientY - fromY);
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    const onMouseDown = (e: MouseEvent) => {
      fromX = e.clientX; fromY = e.clientY;
      startRef.current = focalRef.current;
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('mousedown', onMouseDown);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('mousedown', onMouseDown);
      onMouseUp();
    };
  }, []);

  const layout = natural ? computeCoverLayout(width, height, natural.w, natural.h, focalX, focalY) : null;
  const web = Platform.OS === 'web';

  return (
    <View
      ref={frameRef}
      {...(Platform.OS === 'web' ? {} : pan.panHandlers)}
      // data-nodrag: a drag here moves the photo, not the pop-up it sits in.
      {...(web ? { dataSet: { nodrag: '1' } } : {})}
      style={[{ width, height, overflow: 'hidden', backgroundColor: '#1a1714' }, web && ({ touchAction: 'none', cursor: 'grab' } as any), style]}
    >
      {type === 'video' ? (
        web ? createElement('video', {
          src: uri, muted: true, autoPlay: true, loop: true, playsInline: true,
          onLoadedMetadata: (e: any) => {
            const v = e.currentTarget as HTMLVideoElement;
            if (v.videoWidth && v.videoHeight) { naturalRef.current = { w: v.videoWidth, h: v.videoHeight }; setNatural(naturalRef.current); }
          },
          style: {
            width: '100%', height: '100%', display: 'block', objectFit: 'cover',
            objectPosition: `${focalX * 100}% ${focalY * 100}%`, pointerEvents: 'none',
          },
        }) : null
      ) : layout ? (
        web ? (
          // A background, not an <img>: the browser's own image drag would
          // take the gesture (same as CoverImage and PhotoPositioner).
          <View
            style={[{
              position: 'absolute', width: layout.renderW, height: layout.renderH, left: layout.left, top: layout.top,
              backgroundImage: `url("${shown}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat',
            } as any, { pointerEvents: 'none' }]}
          />
        ) : (
          <Image source={{ uri: shown }} style={{ position: 'absolute', width: layout.renderW, height: layout.renderH, left: layout.left, top: layout.top }} />
        )
      ) : null}
    </View>
  );
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
