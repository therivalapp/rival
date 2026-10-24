import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { fullPhoto } from '../../lib/imageUrl';
import type { StampPlacement } from '../../lib/shareCard';

// A stamp on the person's own photo that they place themselves: drag it with
// one finger; with two, pinch to size it and twist to turn it (Ricky,
// 2026-10-22: "everyone's photos are going to be different"). What they see
// here is what composeStampOnPhoto flattens and shares.
//
// Only a touch that lands on the stamp moves it; anywhere else on the photo
// scrolls the page as usual (Ricky, 2026-10-22). Once a gesture has started
// on the stamp, a second finger anywhere joins it for the pinch and twist.
// The lettering always stays inside the frame, since anything past the edge
// would be cut off the shared picture; the clear margin round it (room for
// its shadow) may run off, so the figures can sit right at the edge (Ricky,
// 2026-10-22). On a computer: drag with the
// mouse, scroll over the stamp to resize, Shift and scroll to turn.

const MIN_W = 0.2;
// Past 1, since the clear margin may run off; fit() keeps the lettering in.
const MAX_W = 1.4;
/** Extra room around the stamp that still counts as touching it, in px. */
const GRAB = 14;

type Ink = { l: number; t: number; r: number; b: number };
const NO_MARGIN: Ink = { l: 0, t: 0, r: 0, b: 0 };

/** How far in from each side the stamp's lettering starts, as fractions of
 *  its size: only near-solid pixels count, not the soft shadow round them. */
function inkMargins(img: HTMLImageElement): Ink {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return NO_MARGIN;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return NO_MARGIN;
  x.drawImage(img, 0, 0);
  const a = x.getImageData(0, 0, w, h).data;
  let l = w, t = h, r = -1, b = -1;
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < w; i++) {
      if (a[(y * w + i) * 4 + 3] < 200) continue;
      if (i < l) l = i;
      if (i > r) r = i;
      if (y < t) t = y;
      if (y > b) b = y;
    }
  }
  if (r < 0) return NO_MARGIN;
  return { l: l / w, t: t / h, r: (w - 1 - r) / w, b: (h - 1 - b) / h };
}

/** Where a stamp starts: low and centred, the tall column narrower. */
export function defaultPlacement(tall: boolean): StampPlacement {
  return tall ? { cx: 0.5, cy: 0.62, w: 0.5 } : { cx: 0.5, cy: 0.8, w: 0.92 };
}

type Props = {
  photoUrl: string | null;
  stampUrl: string;
  /** The lettering's margins, measured without its shadow (shareStamp's
   *  inkMargins); else measured here from the picture. */
  inkHint?: Ink;
  height: number;
  placement: StampPlacement;
  onChange: (p: StampPlacement) => void;
};

export function StampStage({ photoUrl, stampUrl, inkHint, height, placement, onChange }: Props) {
  const width = (height * 9) / 16;
  const [aspect, setAspect] = useState(3); // stamp width / height
  const [ink, setInk] = useState<Ink>(NO_MARGIN);
  const live = useRef(placement);
  live.current = placement;
  const change = useRef(onChange);
  change.current = onChange;
  const geo = useRef({ width, height, aspect, ink });
  geo.current = { width, height, aspect, ink };
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    Image.getSize(stampUrl, (w, h) => { if (w && h) setAspect(w / h); }, () => {});
    if (inkHint) { setInk(inkHint); return; }
    if (Platform.OS !== 'web') return;
    let live = true;
    const img = new window.Image();
    img.onload = () => { if (live) { try { setInk(inkMargins(img)); } catch { setInk(NO_MARGIN); } } };
    img.src = stampUrl;
    return () => { live = false; };
  }, [stampUrl, inkHint]);

  // Keep the turned stamp's lettering inside the frame: shrink it if it
  // can't fit, then hold it in from the edges. The clear margin round the
  // lettering is free to run past the edge.
  const fit = (p: StampPlacement): StampPlacement => {
    const { width: W, height: H, aspect: A, ink: m } = geo.current;
    const r = p.r ?? 0;
    const cos = Math.cos(r), sin = Math.sin(r);
    // The lettering's turned extent from the stamp's centre, in px.
    const reach = (ww: number) => {
      const sw = ww * W, sh = sw / A;
      const xs = [(-0.5 + m.l) * sw, (0.5 - m.r) * sw];
      const ys = [(-0.5 + m.t) * sh, (0.5 - m.b) * sh];
      const px: number[] = [], py: number[] = [];
      for (const lx of xs) for (const ly of ys) {
        px.push(lx * cos - ly * sin);
        py.push(lx * sin + ly * cos);
      }
      return { x0: Math.min(...px), x1: Math.max(...px), y0: Math.min(...py), y1: Math.max(...py) };
    };
    let w = Math.min(MAX_W, Math.max(MIN_W, p.w));
    let e = reach(w);
    const k = Math.min(1, W / (e.x1 - e.x0), H / (e.y1 - e.y0));
    if (k < 1) { w *= k; e = reach(w); }
    return {
      cx: Math.min(1 - e.x1 / W, Math.max(-e.x0 / W, p.cx)),
      cy: Math.min(1 - e.y1 / H, Math.max(-e.y0 / H, p.cy)),
      w,
      r,
    };
  };

  // Whether a screen point lands on the stamp (turned with it).
  const onStamp = (x: number, y: number, rect: DOMRect) => {
    const { width: W, height: H, aspect: A } = geo.current;
    const p = live.current;
    const dx = x - rect.left - p.cx * W;
    const dy = y - rect.top - p.cy * H;
    const r = -(p.r ?? 0);
    const lx = dx * Math.cos(r) - dy * Math.sin(r);
    const ly = dx * Math.sin(r) + dy * Math.cos(r);
    const sw = p.w * W, sh = sw / A;
    return Math.abs(lx) <= sw / 2 + GRAB && Math.abs(ly) <= sh / 2 + GRAB;
  };

  const stageRef = useCallback((node: any) => {
    cleanup.current?.();
    cleanup.current = null;
    if (Platform.OS !== 'web' || !node?.addEventListener) return;
    const el = node as HTMLElement;
    const pts = new Map<number, { x: number; y: number }>();
    let active = false;
    let start: { p: StampPlacement; mid: { x: number; y: number }; dist: number; angle: number } | null = null;
    const snapshot = () => {
      const list = [...pts.values()];
      const mid = list.reduce((a, b) => ({ x: a.x + b.x / list.length, y: a.y + b.y / list.length }), { x: 0, y: 0 });
      const dist = list.length > 1 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0;
      const angle = list.length > 1 ? Math.atan2(list[1].y - list[0].y, list[1].x - list[0].x) : 0;
      start = { p: live.current, mid, dist, angle };
    };
    const apply = () => {
      if (!start) return;
      const list = [...pts.values()];
      const rect = el.getBoundingClientRect();
      const mid = list.reduce((a, b) => ({ x: a.x + b.x / list.length, y: a.y + b.y / list.length }), { x: 0, y: 0 });
      let w = start.p.w;
      let r = start.p.r ?? 0;
      if (list.length > 1 && start.dist > 0) {
        w = start.p.w * (Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) / start.dist);
        r = (start.p.r ?? 0) + Math.atan2(list[1].y - list[0].y, list[1].x - list[0].x) - start.angle;
        // A light pull to level, so straight is easy to find again.
        const turns = Math.round(r / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(r - turns) < 0.05) r = turns;
      }
      change.current(fit({
        cx: start.p.cx + (mid.x - start.mid.x) / rect.width,
        cy: start.p.cy + (mid.y - start.mid.y) / rect.height,
        w,
        r,
      }));
    };

    // Fingers: touch events, so a touch off the stamp is left to scroll.
    const tStart = (e: TouchEvent) => {
      const rect = el.getBoundingClientRect();
      if (!active) {
        const hit = [...e.changedTouches].some((t) => onStamp(t.clientX, t.clientY, rect));
        if (!hit) return;
        active = true;
      }
      for (const t of e.changedTouches) pts.set(t.identifier, { x: t.clientX, y: t.clientY });
      snapshot();
      e.preventDefault();
    };
    const tMove = (e: TouchEvent) => {
      if (!active) return;
      for (const t of e.changedTouches) if (pts.has(t.identifier)) pts.set(t.identifier, { x: t.clientX, y: t.clientY });
      apply();
      e.preventDefault();
    };
    const tEnd = (e: TouchEvent) => {
      if (!active) return;
      for (const t of e.changedTouches) pts.delete(t.identifier);
      if (pts.size) snapshot(); else { start = null; active = false; }
    };

    // The mouse.
    const mDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !onStamp(e.clientX, e.clientY, el.getBoundingClientRect())) return;
      el.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      active = true;
      snapshot();
      e.preventDefault();
    };
    const mMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      apply();
    };
    const mUp = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pts.delete(e.pointerId);
      start = null;
      active = false;
    };
    const wheel = (e: WheelEvent) => {
      if (!onStamp(e.clientX, e.clientY, el.getBoundingClientRect())) return;
      e.preventDefault();
      const p = live.current;
      if (e.shiftKey) change.current(fit({ ...p, r: (p.r ?? 0) + (e.deltaY || e.deltaX) * 0.004 }));
      else change.current(fit({ ...p, w: p.w * (1 - e.deltaY * 0.0015) }));
    };

    el.addEventListener('touchstart', tStart, { passive: false });
    el.addEventListener('touchmove', tMove, { passive: false });
    el.addEventListener('touchend', tEnd);
    el.addEventListener('touchcancel', tEnd);
    el.addEventListener('pointerdown', mDown);
    el.addEventListener('pointermove', mMove);
    el.addEventListener('pointerup', mUp);
    el.addEventListener('wheel', wheel, { passive: false });
    cleanup.current = () => {
      el.removeEventListener('touchstart', tStart);
      el.removeEventListener('touchmove', tMove);
      el.removeEventListener('touchend', tEnd);
      el.removeEventListener('touchcancel', tEnd);
      el.removeEventListener('pointerdown', mDown);
      el.removeEventListener('pointermove', mMove);
      el.removeEventListener('pointerup', mUp);
      el.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new stamp (or a different size of photo) is pulled inside the frame.
  useEffect(() => {
    const p = fit(live.current);
    const q = live.current;
    if (p.cx !== q.cx || p.cy !== q.cy || p.w !== q.w) change.current(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, ink, width, height]);

  const sw = placement.w * width;
  const sh = sw / aspect;
  return (
    <View>
      <View ref={stageRef} style={[st.stage, { width, height }]}>
        {photoUrl ? <Image source={{ uri: fullPhoto(photoUrl) }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <Image
          source={{ uri: stampUrl }}
          style={{ position: 'absolute', cursor: 'grab', width: sw, height: sh, left: placement.cx * width - sw / 2, top: placement.cy * height - sh / 2, transform: [{ rotate: `${placement.r ?? 0}rad` }], pointerEvents: 'none' } as any}
          resizeMode="contain"
        />
      </View>
      <Text style={st.hint}>{photoUrl ? 'Drag to move' : 'A see-through stamp to place over a photo.'}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  stage: { alignSelf: 'center', borderRadius: 18, overflow: 'hidden', backgroundColor: '#2a2522', } as any,
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.55)', textAlign: 'center', marginTop: 8 },
});
