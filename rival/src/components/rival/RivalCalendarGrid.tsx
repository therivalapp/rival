import { useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { BREAKPOINT_MOBILE_NAV } from '../../constants/breakpoints';
import { RivalButtonColors, RivalColors, RivalRadius, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon } from './RivalIcon';

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function addYears(d: Date, n: number): Date { return new Date(d.getFullYear() + n, d.getMonth(), 1); }
function toIsoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function monthGridCells(viewDate: Date): (number | null)[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function chunkWeeks<T>(cells: T[]): T[][] {
  const weeks: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// The month-grid picker (Stitch's "Calendar Marker" pattern) — create-team-
// challenge.tsx and create-league.tsx each already had their own copy of
// this exact grid; this is the shared version for its newest consumer,
// RivalDateField, rather than a fourth near-identical copy.
export function RivalCalendarGrid({ value, onChange }: { value: string | null; onChange: (iso: string) => void }) {
  const [viewDate, setViewDate] = useState(() => (value ? new Date(value + 'T00:00:00') : startOfMonth(new Date())));
  const weeks = chunkWeeks(monthGridCells(viewDate));
  const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 };
  // Phones: the Activity calendar's look (Ricky, 2026-10-20): the month in the
  // serif, square quiet days, today's date in salmon. Desktop keeps its own.
  const phone = useWindowDimensions().width < BREAKPOINT_MOBILE_NAV;
  const todayIso = toIsoDate(new Date());

  // Swipe left or right to change month (Ricky, 2026-10-16): the corner
  // arrows are hard to reach with a thumb. The month slides out the way it
  // was pushed and the next slides in. Only a clearly sideways drag counts,
  // so taps on days and the sheet's drag-down to close still work.
  const slide = useRef(new Animated.Value(0)).current;
  const changeMonth = (n: number) => {
    Animated.timing(slide, { toValue: -n * 40, duration: 110, useNativeDriver: false }).start(() => {
      setViewDate((d) => addMonths(d, n));
      slide.setValue(n * 40);
      Animated.timing(slide, { toValue: 0, duration: 140, useNativeDriver: false }).start();
    });
  };
  const changeRef = useRef(changeMonth);
  changeRef.current = changeMonth;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_e, g) => slide.setValue(Math.max(-60, Math.min(60, g.dx * 0.5))),
    onPanResponderRelease: (_e, g) => {
      if (g.dx <= -40 || g.vx < -0.5) changeRef.current(1);
      else if (g.dx >= 40 || g.vx > 0.5) changeRef.current(-1);
      else Animated.spring(slide, { toValue: 0, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => Animated.spring(slide, { toValue: 0, useNativeDriver: false }).start(),
  })).current;

  return (
    <View style={styles.widget}>
      <View style={styles.headerRow}>
        <View style={styles.navGroup}>
          <TouchableOpacity style={styles.navBtn} onPress={() => setViewDate((d) => addYears(d, -1))} hitSlop={hitSlop} accessibilityLabel="Previous year">
            <RivalIcon name="yearBack" size={18} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={() => changeMonth(-1)} hitSlop={hitSlop} accessibilityLabel="Previous month">
            <RivalIcon name="monthBack" size={18} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
        <Text style={[styles.monthLabel, phone && styles.monthLabelPhone]}>{viewDate.toLocaleDateString(undefined, phone && viewDate.getFullYear() === new Date().getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' })}</Text>
        <View style={styles.navGroup}>
          <TouchableOpacity style={styles.navBtn} onPress={() => changeMonth(1)} hitSlop={hitSlop} accessibilityLabel="Next month">
            <RivalIcon name="monthForward" size={18} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={() => setViewDate((d) => addYears(d, 1))} hitSlop={hitSlop} accessibilityLabel="Next year">
            <RivalIcon name="yearForward" size={18} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
      </View>
      <Animated.View {...pan.panHandlers} style={[styles.grid, { transform: [{ translateX: slide }], opacity: slide.interpolate({ inputRange: [-60, 0, 60], outputRange: [0.4, 1, 0.4] }) }]}>
      <View style={[styles.daysRow, phone && styles.daysRowPhone]}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={[styles.dayLabel, phone && styles.dayLabelPhone]}>{d}</Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={[styles.daysRow, phone && styles.daysRowPhone]}>
          {week.map((day, di) => {
            if (day === null) return <View key={di} style={[styles.dayCell, phone && styles.dayCellPhone, phone && { backgroundColor: 'transparent' }]} />;
            const cellIso = toIsoDate(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
            const isSelected = value === cellIso;
            const isToday = phone && cellIso === todayIso;
            return (
              <TouchableOpacity key={di} style={[styles.dayCell, phone && styles.dayCellPhone, isSelected && styles.dayCellActive]} onPress={() => onChange(cellIso)}>
                <Text style={[styles.dayNum, phone && styles.dayNumPhone, isToday && !isSelected && styles.dayNumToday, isSelected && styles.dayNumActive]}>{day}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  widget: { gap: 6, width: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  grid: { gap: 6 },
  monthLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textPrimary },
  daysRow: { flexDirection: 'row', gap: 2 },
  dayLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  dayCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RivalRadius.sm, borderWidth: 1, borderColor: 'transparent' },
  // The chosen day lit in the same salmon as a chosen tile or the main
  // button (Ricky, 2026-10-16).
  dayCellActive: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' } as any,
  dayNum: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  monthLabelPhone: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 21, color: '#fff' },
  daysRowPhone: { gap: 6 },
  dayLabelPhone: { fontSize: 9.5, fontWeight: '800', color: 'rgba(255,255,255,0.4)' },
  dayCellPhone: { borderRadius: 11, borderWidth: 0, backgroundColor: 'rgba(255,255,255,0.035)' },
  dayNumPhone: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.55)' },
  dayNumToday: { color: RivalColors.accentText, fontWeight: '900' },
  dayNumActive: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontWeight: '800' },
});
