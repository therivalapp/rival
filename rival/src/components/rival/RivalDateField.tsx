import { useState } from 'react';
import { Modal, StyleProp, StyleSheet, TextInput, TextStyle, TouchableOpacity, View, ViewStyle, useWindowDimensions } from 'react-native';
import { BREAKPOINT_WIDE_LAYOUT } from '../../constants/breakpoints';
import { GreyCalendar } from './RivalGreySheet';
import { RivalColors, RivalRadius } from '../../constants/rivalTheme';
import { displayToIsoDate, isoToDisplayDate, maskDateInput } from '../../lib/dateFormat';
import { RivalIcon } from './RivalIcon';
import { RivalCalendarGrid } from './RivalCalendarGrid';

// A typed DD/MM/YYYY field paired with a calendar button — typing still
// works (separators inserted via maskDateInput so a missing "-" can't happen), but
// tapping the calendar icon skips typing entirely. `inputStyle` takes each
// screen's own existing input styling so this drops into a differently-
// styled form without homogenizing the whole app's look.
export function RivalDateField({
  value,
  onChangeText,
  placeholder = 'DD/MM/YYYY',
  inputStyle,
  containerStyle,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  inputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const phone = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  const iso = displayToIsoDate(value);

  return (
    <>
      <View style={[styles.row, containerStyle]}>
        <TextInput
          style={[styles.input, inputStyle]}
          value={value}
          onChangeText={(v) => onChangeText(maskDateInput(v))}
          placeholder={placeholder}
          placeholderTextColor={RivalColors.textSecondary}
          keyboardType="number-pad"
          maxLength={10}
        />
        <TouchableOpacity onPress={() => setOpen(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.calendarBtn}>
          <RivalIcon name="calendar" size={18} color={RivalColors.accentText} />
        </TouchableOpacity>
      </View>

      {phone ? (
        // Phone: the grey month calendar from the pop-ups.
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={{ flex: 1 }}>
            <GreyCalendar
              value={iso}
              onChange={(nextIso) => { onChangeText(isoToDisplayDate(nextIso)); setOpen(false); }}
              onClose={() => setOpen(false)}
            />
          </View>
        </Modal>
      ) : (
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          {/* Swallows the tap so it doesn't bubble to the backdrop above and close the sheet mid-pick. */}
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <RivalCalendarGrid
              value={iso}
              onChange={(nextIso) => {
                onChangeText(isoToDisplayDate(nextIso));
                setOpen(false);
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // minWidth:0 is load-bearing. On web a text input carries an intrinsic
  // minimum width (roughly its default 20-character size), and a flex item
  // will not shrink below its intrinsic minimum unless told to. In a narrow
  // container the input therefore held full width and pushed the calendar
  // button out past the right edge, where whatever sat next to the field
  // rendered on top of it. Nothing about the field looked wrong on a wide
  // screen, which is why this survived until it was put in a half-width slot.
  input: { flex: 1, minWidth: 0 },
  calendarBtn: {
    width: 40,
    height: 40,
    borderRadius: RivalRadius.DEFAULT,
    backgroundColor: RivalColors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: RivalRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
  },
});
