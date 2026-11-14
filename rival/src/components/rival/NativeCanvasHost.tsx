// Draws lib/nativeCanvas.ts records as SVG, off screen, and saves each as a
// picture file with react-native-view-shot: the iPhone's way of making the
// share pictures the web draws on a canvas. Mounted once, in the root layout.

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, FeComposite, FeFlood, FeGaussianBlur, FeMerge, FeMergeNode, Filter, G, Image as SvgImage, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { simLog } from '../../lib/simLog';
import { NCanvas, nextRenderJob, setRenderListener, type NGradient, type NOp, type RenderJob } from '../../lib/nativeCanvas';

type Built = { defs: ReactNode[]; body: ReactNode[]; images: number };

function colour(c: string): { color: string; opacity: number } {
  const m = c.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  if (m) return { color: `rgb(${m[1]},${m[2]},${m[3]})`, opacity: Number(m[4]) };
  // #rrggbbaa (the rank frame's `${light}aa`).
  const h = c.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  if (h) return { color: `#${h[1]}`, opacity: parseInt(h[2], 16) / 255 };
  return { color: c, opacity: 1 };
}

function build(canvas: NCanvas, prefix: string): Built {
  const defs: ReactNode[] = [];
  const body: ReactNode[] = [];
  let images = 0;
  let n = 0;
  const id = () => `${prefix}${n++}`;
  const filters = new Map<string, string>();

  const paint = (p: string | NGradient): { fill: string; opacity: number } => {
    if (typeof p === 'string') { const c = colour(p); return { fill: c.color, opacity: c.opacity }; }
    const gid = id();
    const stops = p.stops.map((s, i) => { const c = colour(s.color); return <Stop key={i} offset={s.offset} stopColor={c.color} stopOpacity={c.opacity} />; });
    if (p.kind === 'linear') {
      const [x1, y1, x2, y2] = p.coords;
      defs.push(<LinearGradient key={gid} id={gid} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>{stops}</LinearGradient>);
    } else {
      const [, , , cx, cy, r] = p.coords;
      defs.push(<RadialGradient key={gid} id={gid} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={r} fx={p.coords[0]} fy={p.coords[1]}>{stops}</RadialGradient>);
    }
    return { fill: `url(#${gid})`, opacity: 1 };
  };

  // A canvas shadow (offset 0) as an SVG filter: the shape's outline in the
  // shadow colour, blurred, under the shape. Canvas blur is twice the sigma.
  const shadowFilter = (s: { blur: number; color: string } | null): string | undefined => {
    if (!s) return undefined;
    const key = `${s.blur}|${s.color}`;
    let fid = filters.get(key);
    if (!fid) {
      fid = id();
      filters.set(key, fid);
      const c = colour(s.color);
      defs.push(
        <Filter key={fid} id={fid} x="-50%" y="-50%" width="200%" height="200%">
          <FeFlood floodColor={c.color} floodOpacity={c.opacity} result="flood" />
          <FeComposite in="flood" in2="SourceAlpha" operator="in" result="shape" />
          <FeGaussianBlur in="shape" stdDeviation={s.blur / 2} result="blur" />
          <FeMerge>
            <FeMergeNode in="blur" />
            <FeMergeNode in="SourceGraphic" />
          </FeMerge>
        </Filter>,
      );
    }
    return `url(#${fid})`;
  };

  const wrap = (m: number[], node: ReactNode, key: string) => {
    const plain = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
    return plain ? <Fragment key={key}>{node}</Fragment> : <G key={key} transform={`matrix(${m.join(' ')})`}>{node}</G>;
  };

  const draw = (op: NOp, key: string) => {
    if (op.k === 'rect') {
      const p = paint(op.fill);
      return wrap(op.m, <Rect x={op.x} y={op.y} width={op.w} height={op.h} fill={p.fill} fillOpacity={p.opacity} opacity={op.alpha} filter={shadowFilter(op.shadow)} />, key);
    }
    if (op.k === 'text') {
      const p = paint(op.fill);
      const f = op.font;
      return wrap(op.m, (
        <SvgText
          x={op.x}
          y={op.y}
          textAnchor={op.align === 'center' ? 'middle' : op.align === 'right' ? 'end' : 'start'}
          fontFamily={f.family === 'serif' ? 'Georgia' : 'Manrope'}
          fontWeight={String(f.family === 'serif' ? 700 : f.weight) as any}
          fontStyle={f.italic ? 'italic' : 'normal'}
          fontSize={f.size}
          fill={p.fill}
          fillOpacity={p.opacity}
          opacity={op.alpha}
          filter={shadowFilter(op.shadow)}
        >{op.text}</SvgText>
      ), key);
    }
    if (op.k === 'path') {
      const fp = op.fill ? paint(op.fill) : null;
      const sp = op.stroke ? paint(op.stroke) : null;
      return wrap(op.m, (
        <Path
          d={op.d}
          fill={fp ? fp.fill : 'none'}
          fillOpacity={fp?.opacity}
          stroke={sp?.fill}
          strokeOpacity={sp?.opacity}
          strokeWidth={op.lineWidth}
          opacity={op.alpha}
          filter={shadowFilter(op.shadow)}
        />
      ), key);
    }
    // An image or another canvas, cropped to its source box and fitted to
    // the destination box.
    const sx = op.dw / op.sw, sy = op.dh / op.sh;
    const cid = id();
    defs.push(<ClipPath key={cid} id={cid}><Rect x={op.dx} y={op.dy} width={op.dw} height={op.dh} /></ClipPath>);
    let inner: ReactNode;
    if (op.src instanceof NCanvas) {
      const nested = build(op.src, `${prefix}${n++}_`);
      defs.push(...nested.defs);
      images += nested.images;
      inner = nested.body;
    } else {
      images += 1;
      inner = <SvgImage href={{ uri: op.src.uri }} x={0} y={0} width={op.src.naturalWidth} height={op.src.naturalHeight} preserveAspectRatio="none" onLoad={() => imageLoaded()} />;
    }
    return wrap(op.m, (
      <G clipPath={`url(#${cid})`} opacity={op.alpha}>
        <G transform={`translate(${op.dx} ${op.dy}) scale(${sx} ${sy}) translate(${-op.sx} ${-op.sy})`}>{inner}</G>
      </G>
    ), key);
  };

  canvas.ops.forEach((op, i) => body.push(draw(op, `${prefix}op${i}`)));
  return { defs, body, images };
}

// Images report in as they load; the capture waits for all of them.
let onImage: (() => void) | null = null;
function imageLoaded() { onImage?.(); }

export function NativeCanvasHost() {
  const [job, setJob] = useState<{ job: RenderJob; built: Built; key: number } | null>(null);
  const busy = useRef(false);
  const ref = useRef<View>(null);
  const counter = useRef(0);

  const pull = () => {
    if (busy.current) return;
    const next = nextRenderJob();
    if (!next) return;
    busy.current = true;
    counter.current += 1;
    simLog(`job ${counter.current} ${next.canvas.width}x${next.canvas.height} ops ${next.canvas.ops.length}`);
    try {
      setJob({ job: next, built: build(next.canvas, `c${counter.current}_`), key: counter.current });
    } catch (e: any) {
      simLog(`build failed: ${String(e?.message ?? e).slice(0, 80)}`);
      busy.current = false;
      next.reject(e instanceof Error ? e : new Error('The picture could not be made.'));
      pull();
    }
  };

  useEffect(() => {
    setRenderListener(pull);
    return () => setRenderListener(null);
  }, []);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    let loaded = 0;
    const { canvas, type, quality } = job.job;
    const finish = async () => {
      // Two frames for the SVG to lay out and paint.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) { simLog('cancelled'); return; }
      simLog(`capture ${job.key}`);
      try {
        const jpg = /jpe?g/.test(type);
        const raw = await captureRef(ref, {
          format: jpg ? 'jpg' : 'png',
          quality,
          result: 'tmpfile',
          width: canvas.width / PixelRatio.get(),
          height: canvas.height / PixelRatio.get(),
        });
        // view-shot can hand back a bare path; fetch and the share sheet want a file address.
        const uri = raw.startsWith('/') ? `file://${raw}` : raw;
        simLog(`saved ${job.key} ${String(uri).slice(0, 12)}`);
        job.job.resolve({ __nativeUri: uri, uri, type: jpg ? 'image/jpeg' : 'image/png', size: 0, canvas });
      } catch (e: any) {
        simLog(`capture failed: ${String(e?.message ?? e).slice(0, 80)}`);
        job.job.reject(e instanceof Error ? e : new Error('The picture could not be made.'));
      } finally {
        busy.current = false;
        setJob(null);
        setTimeout(pull, 0);
      }
    };
    // Photos can be slow; a picture without one beats no picture.
    simLog(`drawing ${job.key}, photos ${job.built.images}`);
    const timer = setTimeout(() => { simLog('photo wait timed out'); onImage = null; finish(); }, 8000);
    if (job.built.images === 0) { clearTimeout(timer); finish(); }
    else {
      onImage = () => {
        loaded += 1;
        if (loaded >= job.built.images) { onImage = null; clearTimeout(timer); finish(); }
      };
    }
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job]);

  if (!job) return null;
  const { canvas } = job.job;
  // Drawn in points so the saved file has the canvas's own pixel size.
  const w = canvas.width / PixelRatio.get();
  const h = canvas.height / PixelRatio.get();
  return (
    <View pointerEvents="none" style={styles.offscreen}>
      <View ref={ref} collapsable={false} style={{ width: w, height: h, backgroundColor: 'transparent' }}>
        <Svg key={job.key} width={w} height={h} viewBox={`0 0 ${canvas.width} ${canvas.height}`}>
          <Defs>{job.built.defs}</Defs>
          {job.built.body}
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Laid out and painted, but out of sight to the left.
  offscreen: { position: 'absolute', top: 0, left: -10000 },
});
