import { useEffect, useState } from 'react';
import { View, Image, StyleProp, ViewStyle } from 'react-native';
import { cardPhoto, fullPhoto } from '../../lib/imageUrl';

// True "cover" crop with a custom focal point, computed by hand instead of
// via CSS object-fit/object-position — verified this RNW build doesn't
// actually apply object-fit to the real <img> node (resizeMode="cover"
// measures back as "fill" in computed style, full stop, even with no other
// style overrides present). This measures the frame via onLayout, the
// photo's real pixel size via Image.getSize, scales up to the larger of the
// two ratios (so neither axis ever shows a gap), then shifts the oversized
// image by -focal fraction of its overflow — pure box-model math, so it
// works regardless of whether object-fit ever gets fixed underneath.
//
// Sizes already measured are kept, and the next activity's photo is measured
// ahead (preloadCover), so stepping to it draws at once rather than showing
// the black frame while it loads (Ricky, 2026-10-23).
const sizes = new Map<string, { w: number; h: number }>();

/** Fetches and measures a full-screen photo ahead of showing it. */
export function preloadCover(original: string | null | undefined) {
  const uri = fullPhoto(original);
  if (!uri || sizes.has(uri) || /\.(mp4|mov|m4v|webm)(\?|$)/i.test(uri)) return;
  Image.getSize(uri, (w, h) => { sizes.set(uri, { w, h }); }, () => {});
}

export function CoverImage({
  uri: original,
  focalX = 0.5,
  focalY = 0.5,
  style,
  full = false,
}: {
  uri: string;
  /** Fills the screen: fetched larger than a card's photo. */
  full?: boolean;
  focalX?: number | null;
  focalY?: number | null;
  style?: StyleProp<ViewStyle>;
}) {
  // A stored photo at the size it is drawn (lib/imageUrl.ts).
  const uri = full ? fullPhoto(original) : cardPhoto(original);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(() => sizes.get(uri) ?? null);

  useEffect(() => {
    let cancelled = false;
    const known = sizes.get(uri);
    setNatural(known ?? null);
    if (known) return;
    Image.getSize(uri, (w, h) => { sizes.set(uri, { w, h }); if (!cancelled) setNatural({ w, h }); }, () => {});
    return () => { cancelled = true; };
  }, [uri]);

  const fx = focalX ?? 0.5;
  const fy = focalY ?? 0.5;
  const ready = natural && frame.w > 0 && frame.h > 0;
  const layout = ready ? computeCoverLayout(frame.w, frame.h, natural!.w, natural!.h, fx, fy) : null;

  return (
    <View
      style={[{ overflow: 'hidden' }, style]}
      onLayout={(e) => setFrame({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {layout && (
        <Image
          source={{ uri }}
          style={{ position: 'absolute', width: layout.renderW, height: layout.renderH, left: layout.left, top: layout.top }}
        />
      )}
    </View>
  );
}

export function computeCoverLayout(frameW: number, frameH: number, naturalW: number, naturalH: number, focalX: number, focalY: number) {
  const scale = Math.max(frameW / naturalW, frameH / naturalH);
  const renderW = naturalW * scale;
  const renderH = naturalH * scale;
  const maxOffsetX = Math.max(0, renderW - frameW);
  const maxOffsetY = Math.max(0, renderH - frameH);
  return { renderW, renderH, left: -maxOffsetX * focalX, top: -maxOffsetY * focalY, maxOffsetX, maxOffsetY };
}
