import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';

// Gradient-filled text on the iPhone app. The web draws it with CSS
// (background-clip: text in the style); the app can't, so it showed the flat
// fallback colour (2026-11-13). Here the text is a mask over a gradient.
// MaskedView ships inside the app already (expo-router depends on it), so no
// new build is needed. On the web it is a plain Text with the style as given.
//
// `gradient` is the same CSS linear-gradient the web style uses. Left out,
// it comes from the style: webFx() puts a background-clip:text gradient there
// as `__gradientText` on iPhone. With neither it is a plain Text.
const LAYOUT_KEYS = [
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'position', 'top', 'left', 'right', 'bottom', 'alignSelf', 'zIndex',
] as const;

/** Room around gradient text so an italic serif's lean and tails (the 5
 *  curls below the line and out to the left) get the gradient too: the
 *  gradient, and on iPhone the mask, stop at the text's own box (Ricky,
 *  2026-11-16). Adds `h` either side and `v` below as padding, and takes the
 *  same off the margins, so the layout doesn't move. */
export function bleedStyle(base: Record<string, any>, h: number, v: number): Record<string, number> {
  const side = (one: string, axis: string, kind: 'margin' | 'padding') => (base[`${kind}${one}`] ?? base[`${kind}${axis}`] ?? base[kind] ?? 0) as number;
  return {
    paddingLeft: side('Left', 'Horizontal', 'padding') + h,
    paddingRight: side('Right', 'Horizontal', 'padding') + h,
    paddingBottom: side('Bottom', 'Vertical', 'padding') + v,
    marginLeft: side('Left', 'Horizontal', 'margin') - h,
    marginRight: side('Right', 'Horizontal', 'margin') - h,
    marginBottom: side('Bottom', 'Vertical', 'margin') - v,
  };
}

const isItalic = (flat: Record<string, any>) => flat.fontStyle === 'italic';
const bleedOf = (flat: Record<string, any>) => Math.round((flat.fontSize ?? 16) * 0.2);

export function GradientText({ gradient: given, style, children, ...rest }: TextProps & { gradient?: string; style?: StyleProp<TextStyle>; children?: ReactNode }) {
  if (Platform.OS === 'web') {
    const f: Record<string, any> = StyleSheet.flatten(style) ?? {};
    const painted = f.backgroundImage || f.backgroundClip || f.WebkitBackgroundClip;
    if (!painted || !isItalic(f)) return <Text {...rest} style={style}>{children}</Text>;
    const b = bleedOf(f);
    return <Text {...rest} style={[style, bleedStyle(f, b, b)]}>{children}</Text>;
  }
  const flat: Record<string, any> = { ...(StyleSheet.flatten(style) ?? {}) };
  const gradient = given ?? flat.__gradientText;
  delete flat.__gradientText;
  if (!gradient) return <Text {...rest} style={flat}>{children}</Text>;
  const wrap: Record<string, any> = {};
  for (const k of LAYOUT_KEYS) if (flat[k] !== undefined) { wrap[k] = flat[k]; delete flat[k]; }
  const text: Record<string, any> = { ...flat, color: '#000' };
  if (isItalic(flat)) {
    // The mask stops at the text's box: pad it so the tails show.
    const b = bleedOf(flat);
    Object.assign(wrap, bleedStyle(wrap, b, b));
    delete wrap.paddingLeft; delete wrap.paddingRight; delete wrap.paddingBottom;
    Object.assign(text, { paddingLeft: (text.paddingLeft ?? text.paddingHorizontal ?? text.padding ?? 0) + b, paddingRight: (text.paddingRight ?? text.paddingHorizontal ?? text.padding ?? 0) + b, paddingBottom: (text.paddingBottom ?? text.paddingVertical ?? text.padding ?? 0) + b });
  }
  return (
    <MaskedView style={wrap} maskElement={<Text {...rest} style={text}>{children}</Text>}>
      <View style={{ experimental_backgroundImage: gradient } as any}>
        <Text {...rest} style={[text, { opacity: 0 }]}>{children}</Text>
      </View>
    </MaskedView>
  );
}
