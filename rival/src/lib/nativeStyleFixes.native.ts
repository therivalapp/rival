import { StyleSheet } from 'react-native';

// iPhone app only (Metro picks this file for native; nativeStyleFixes.ts is
// the web no-op). The app was built for the web first, and a few CSS-only
// layout values mean nothing to the native layout engine: `position: 'fixed'`
// (ignored, so fixed bars and backgrounds landed in the flow, e.g. the bottom
// bar sitting in the header), viewport units ('100vh', '100dvh': dropped, so
// full-screen layers collapsed) and `calc(...)` strings. Rather than touching
// every screen, every StyleSheet is translated once as it is created:
//   position 'fixed'      -> 'absolute'
//   N vh / dvh / svh      -> 'N%'
//   calc(...)             -> removed (the native fallback in the style wins)
//   inset: n              -> top/right/bottom/left
// (Ricky's first TestFlight open, 2026-11-11.)

const VIEWPORT = /^(-?\d+(?:\.\d+)?)(d|s|l)?vh$/;

function fixOne(style: any): any {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return style;
  let out: any = null;
  const set = (k: string, v: any) => { if (!out) out = { ...style }; if (v === undefined) delete out[k]; else out[k] = v; };
  for (const k of Object.keys(style)) {
    const v = style[k];
    if (k === 'position' && v === 'fixed') set(k, 'absolute');
    else if (typeof v === 'string') {
      const m = v.match(VIEWPORT);
      if (m) set(k, `${m[1]}%`);
      else if (v.includes('calc(')) set(k, undefined);
    }
    if (k === 'inset' && typeof v === 'number') {
      set('inset', undefined);
      for (const side of ['top', 'right', 'bottom', 'left']) if (style[side] === undefined) set(side, v);
    }
  }
  return out ?? style;
}

const create = StyleSheet.create;
(StyleSheet as any).create = (styles: Record<string, any>) => {
  const fixed: Record<string, any> = {};
  for (const k of Object.keys(styles)) fixed[k] = fixOne(styles[k]);
  return create(fixed);
};

export {};
