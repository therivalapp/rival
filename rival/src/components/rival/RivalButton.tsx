import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';
import { BusyText } from './BusyText';
import { RivalColors, RivalRadius, RivalType } from '../../constants/rivalTheme';

type Variant = 'primary' | 'secondary' | 'destructive' | 'text';

export function RivalButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  busy,
  style,
  labelStyle,
  onMouseEnter,
  onMouseLeave,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  // Keeps the label (e.g. "Saving…") and adds a spinner beside it (mobile).
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  // Optional label override — additive, every existing call site is
  // unaffected when omitted.
  labelStyle?: StyleProp<TextStyle>;
  // Web-only hover hooks — Pressable forwards unrecognized props straight to
  // the underlying host element (same mechanism the hover cards elsewhere
  // use via TouchableOpacity), so the caller can drive its own hover style.
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const isDisabled = disabled || loading || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      {...({ onMouseEnter, onMouseLeave } as any)}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'destructive' && styles.destructive,
        variant === 'text' && styles.text,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? RivalColors.accentText : RivalColors.textPrimary} />
      ) : (
        <BusyText
          busy={!!busy}
          style={[
            styles.label,
            variant === 'primary' && styles.labelPrimary,
            variant === 'secondary' && styles.labelSecondary,
            variant === 'destructive' && styles.labelDestructive,
            variant === 'text' && styles.labelText,
            labelStyle,
          ]}
        >
          {label}
        </BusyText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RivalRadius.DEFAULT,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No fill (Ricky's call — the solid/gradient block read too heavy against
  // the app's near-black backgrounds) — an outlined "ghost" button instead,
  // same accent color carried by the border and label rather than a block.
  primary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: RivalColors.accentFill,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: RivalColors.outline,
  },
  destructive: { backgroundColor: 'transparent' },
  text: { backgroundColor: 'transparent', paddingHorizontal: 8 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  label: { ...RivalType.titleMd, fontSize: 16, fontWeight: '600' },
  labelPrimary: { color: RivalColors.accentText },
  labelSecondary: { color: RivalColors.textPrimary },
  labelDestructive: { color: RivalColors.error },
  labelText: { color: RivalColors.accentText },
});
