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

export function GradientText({ gradient: given, style, children, ...rest }: TextProps & { gradient?: string; style?: StyleProp<TextStyle>; children?: ReactNode }) {
  if (Platform.OS === 'web') return <Text {...rest} style={style}>{children}</Text>;
  const flat: Record<string, any> = { ...(StyleSheet.flatten(style) ?? {}) };
  const gradient = given ?? flat.__gradientText;
  delete flat.__gradientText;
  if (!gradient) return <Text {...rest} style={flat}>{children}</Text>;
  const wrap: Record<string, any> = {};
  for (const k of LAYOUT_KEYS) if (flat[k] !== undefined) { wrap[k] = flat[k]; delete flat[k]; }
  const text = { ...flat, color: '#000' };
  return (
    <MaskedView style={wrap} maskElement={<Text {...rest} style={text}>{children}</Text>}>
      <View style={{ experimental_backgroundImage: gradient } as any}>
        <Text {...rest} style={[text, { opacity: 0 }]}>{children}</Text>
      </View>
    </MaskedView>
  );
}
