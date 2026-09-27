import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native';
import { BREAKPOINT_WIDE_LAYOUT } from '../../constants/breakpoints';

// A button label that shows a small spinning indicator beside its text while
// the action runs ("Saving…", "Deleting…"), so a slow save never looks frozen.
// The spinner takes the label's own colour. Mobile only for now; desktop keeps
// the plain text change until the mobile pass is finished.

export function BusyText({ busy, style, children, numberOfLines }: {
  busy: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  const mobile = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  if (!busy || !mobile) return <Text style={style} numberOfLines={numberOfLines}>{children}</Text>;
  const color = (StyleSheet.flatten(style)?.color as string | undefined) ?? '#ffffff';
  // A bare "…" label becomes just the spinner.
  if (children === '…') return <ActivityIndicator size="small" color={color} style={styles.spinner} />;
  return (
    <View style={styles.row}>
      <ActivityIndicator size="small" color={color} style={styles.spinner} />
      <Text style={style} numberOfLines={numberOfLines}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  spinner: { transform: [{ scale: 0.8 }] },
});
