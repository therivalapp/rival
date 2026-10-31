import { StyleProp, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { RivalColors } from '../../constants/rivalTheme';
import { RivalIcon } from './RivalIcon';

// The one back control for every screen — Ricky's call after seeing it done
// properly elsewhere in the app (team-hub.tsx's header): a circular chip
// with a thin iOS-style chevron, not a bare arrow glyph floating on the
// page background or a "← Back" text link. Swapping every screen's own
// hand-rolled back button for this one component is what keeps them from
// drifting apart again the next time this look changes.
export function RivalBackButton({
  onPress,
  color = RivalColors.textPrimary,
  style,
}: {
  onPress: () => void;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.circle, style]}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <RivalIcon name="back" size={18} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    // A dark translucent fill (team-hub's own original treatment) reads
    // fine over a bright hero photo but disappears into every OTHER
    // screen's near-black background (#0e0e0e) — this needed to work as
    // the one default for both. White-on-dark instead: invisible against
    // a bright photo isn't a risk (there's always a scrim under it), but
    // dark-on-dark WAS actually invisible on flat pages, so light wins.
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
