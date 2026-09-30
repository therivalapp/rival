import { Children, Fragment, isValidElement, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View, type TextInputProps } from 'react-native';
import { RivalButtonColors, RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, type RivalIconName } from './RivalIcon';
import { RivalCalendarGrid } from './RivalCalendarGrid';
import { BusyText } from './BusyText';
import { RivalBackButton } from './RivalBackButton';

// The phone pop-up style set by Plan an activity: grey sheet with a warm glow
// at the top, centred kicker and serif title, grey caps labels, recessed cards
// of label/value rows, and icon tiles with round badges. Pop-ups build from
// these pieces so they stay the same.

export function GreySheet({
  kicker, title, onClose, children, footer, overlay,
}: {
  kicker: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  /** Drawn over the whole sheet, for the calendar or time picker. */
  overlay?: ReactNode;
}) {
  const { height } = useWindowDimensions();
  // No close button: a pop-up closes by tapping outside it (the caller's
  // backdrop) or by dragging it down from the top.
  const dragY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, gs) => gs.dy > 6 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderMove: (_e, gs) => dragY.setValue(Math.max(0, gs.dy)),
    onPanResponderRelease: (_e, gs) => {
      if (gs.dy > 90 || gs.vy > 0.8) {
        closeRef.current();
        dragY.setValue(0);
      } else {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: false, bounciness: 4 }).start();
      }
    },
    onPanResponderTerminate: () => Animated.spring(dragY, { toValue: 0, useNativeDriver: false }).start(),
  })).current;
  return (
    <Animated.View style={[g.sheet, { maxHeight: height * 0.92, transform: [{ translateY: dragY }] }]}>
      <View style={g.glow} pointerEvents="none" />
      <View {...pan.panHandlers} style={g.dragZone}>
        <View style={g.grabber} />
        <View style={g.head}>
          <Text style={g.kicker}>{kicker}</Text>
          <Text style={g.title}>{title}</Text>
        </View>
      </View>
      <ScrollView style={g.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      <View style={g.foot}>{footer}</View>
      {overlay}
    </Animated.View>
  );
}

export function GreyLabel({ children }: { children: ReactNode }) {
  return <Text style={g.label}>{children}</Text>;
}

/** A recessed card of rows, with a hairline between each. */
export function GreyRows({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter((c) => isValidElement(c));
  return (
    <View style={g.card}>
      {rows.map((r, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={g.divider} />}
          {r}
        </Fragment>
      ))}
    </View>
  );
}

/** Icon, label, then the value on the right. Pass `onPress` for a picker row. */
export function GreyRow({
  icon, label, value, placeholder, onPress, children,
}: {
  icon: RivalIconName;
  label: string;
  value?: string;
  placeholder?: string;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <>
      <RivalIcon name={icon} size={16} color={RivalColors.accentText} style={g.rowIcon} />
      <Text style={g.rowLabel} numberOfLines={1}>{label}</Text>
      <View style={g.rowControl}>
        {children ?? (
          <Text style={value ? g.rowValue : g.rowPlaceholder} numberOfLines={1}>{value || placeholder}</Text>
        )}
      </View>
    </>
  );
  return onPress ? (
    <TouchableOpacity style={g.row} onPress={onPress} activeOpacity={0.8}>{body}</TouchableOpacity>
  ) : (
    <View style={g.row}>{body}</View>
  );
}

/** The typed value of a row, right-aligned. */
export function GreyRowInput(props: TextInputProps) {
  return <TextInput {...props} style={[g.rowInput, props.style]} placeholderTextColor={PLACEHOLDER} />;
}

/** A full-width recessed text field, for values too long for a row. */
export function GreyField(props: TextInputProps) {
  return <TextInput {...props} style={[g.field, props.style]} placeholderTextColor={PLACEHOLDER} />;
}

/** Equal tiles, `columns` across. With icons, each gets a round badge. */
export function GreyTiles<T extends string>({
  options, value, onChange, columns = 4,
}: {
  options: { value: T; label: string; icon?: RivalIconName }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  const width = `${(100 - (columns - 1) * 2.4) / columns}%` as any;
  return (
    <View style={g.tiles}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            style={[g.tile, { width }, !o.icon && g.tileShort, on && g.tileOn]}
            onPress={() => onChange(o.value)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            {o.icon ? (
              <View style={[g.badge, on && g.badgeOn]}>
                <RivalIcon name={o.icon} size={16} color={on ? RivalColors.surfaceLowest : 'rgba(255,255,255,0.6)'} />
              </View>
            ) : null}
            <Text style={[g.tileText, on && g.tileTextOn]} numberOfLines={1}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Small muted text under a card. */
export function GreyNote({ children }: { children: ReactNode }) {
  return <Text style={g.note}>{children}</Text>;
}

export function GreyPrimary({ label, busy, disabled, onPress }: { label: string; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[g.primary, disabled && g.primaryOff]} onPress={onPress} disabled={disabled} activeOpacity={0.85}>
      <BusyText busy={!!busy} style={g.primaryText}>{label}</BusyText>
    </TouchableOpacity>
  );
}

/** The month calendar over the sheet. `value` and `onChange` are ISO dates. */
export function GreyCalendar({ value, onChange, onClose }: { value: string | null; onChange: (iso: string) => void; onClose: () => void }) {
  return (
    <View style={g.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={g.overlayCard}>
        <RivalCalendarGrid value={value} onChange={onChange} />
      </View>
    </View>
  );
}

/** Background for a full page in the pop-up style. */
export const GREY_PAGE_BG = RivalColors.surfaceContainer;

/** The top of a full page in the pop-up style: the same warm glow, centred
 *  kicker and serif title as GreySheet, with a back button in place of the
 *  close. Sits first inside the page's ScrollView (16px side padding). */
export function GreyPageHead({
  kicker, title, sub, onBack,
}: {
  kicker: string;
  title: string;
  sub?: string;
  onBack?: () => void;
}) {
  return (
    <View style={gp.head}>
      <View style={gp.glow} pointerEvents="none" />
      {onBack ? <RivalBackButton onPress={onBack} style={gp.back} /> : null}
      <Text style={g.kicker}>{kicker}</Text>
      <Text style={gp.title}>{title}</Text>
      {sub ? <Text style={gp.sub}>{sub}</Text> : null}
    </View>
  );
}

const gp = StyleSheet.create({
  head: { alignItems: 'center', marginHorizontal: -16, paddingHorizontal: 60, paddingTop: 16, paddingBottom: 12 },
  glow: {
    position: 'absolute', top: -80, left: 0, right: 0, height: 240,
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'radial-gradient(ellipse 75% 100% at 50% 0%, rgba(217,119,87,0.22) 0%, rgba(217,119,87,0.07) 45%, rgba(217,119,87,0) 100%)' }
      : { backgroundColor: 'rgba(217,119,87,0.05)' }),
  } as any,
  back: { position: 'absolute', left: 16, top: 8 },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 28, lineHeight: 34, color: '#fff', textAlign: 'center', marginTop: 3 },
  sub: { fontSize: 13, lineHeight: 18, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 4 },
});

/** The blend for full pages (the review's "blend" column): the pop-up's
 *  greys on a page. Phone only; pages branch on width. */
export const rb = StyleSheet.create({
  page: { flex: 1, backgroundColor: RivalColors.surfaceContainer },
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 48, gap: 12 },
  card: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 16, borderWidth: 1, borderColor: RivalColors.surfaceBright, padding: 14, gap: 12 },
  /** Grey spaced caps: a card's own label, or a section label between cards. */
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary },
  section: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary, marginTop: 6, marginBottom: -4, marginLeft: 4 },
  field: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.surfaceBright, paddingHorizontal: 13, paddingVertical: 11 },
  rule: { borderTopWidth: 1, borderTopColor: 'rgba(50,50,50,0.8)' },
  /** One segmented toggle: grey track, the chosen part lifted. */
  seg: { flexDirection: 'row', backgroundColor: RivalColors.surfaceLowest, borderWidth: 1, borderColor: RivalColors.surfaceBright, borderRadius: 999, padding: 3 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 999 },
  segItemOn: { backgroundColor: RivalColors.surfaceBright },
  segText: { fontSize: 13, fontWeight: '600', color: RivalColors.textSecondary },
  segTextOn: { color: '#fff', fontWeight: '700' },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  /** Big serif figure with the white-to-ember fill. */
  big: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 38, lineHeight: 44, color: '#fff', textAlign: 'center',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #ffffff, #D97757 170%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : {}),
  } as any,
  bar: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  barFill: {
    height: '100%', borderRadius: 3, backgroundColor: RivalColors.accentFill,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, #D97757, #ffb59e)' } : {}),
  } as any,
});

/** A segmented toggle in the blend style. */
export function GreySegment<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={rb.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TouchableOpacity key={o.value} style={[rb.segItem, on && rb.segItemOn]} onPress={() => onChange(o.value)} activeOpacity={0.85} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <Text style={[rb.segText, on && rb.segTextOn]} numberOfLines={1}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const PLACEHOLDER = 'rgba(255,255,255,0.28)';

const g = StyleSheet.create({
  sheet: {
    backgroundColor: RivalColors.surfaceHigh,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18, paddingTop: 10,
    borderTopWidth: 1, borderColor: RivalColors.surfaceBright,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 150,
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(217,119,87,0.20) 0%, rgba(217,119,87,0.07) 45%, rgba(217,119,87,0) 100%)' }
      : { backgroundColor: 'rgba(217,119,87,0.07)' }),
  },
  dragZone: { ...(Platform.OS === 'web' ? ({ touchAction: 'none', cursor: 'grab' } as any) : {}) },
  grabber: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: RivalColors.surfaceBright, marginBottom: 14 },
  head: { alignItems: 'center', marginBottom: 2, paddingHorizontal: 36 },
  kicker: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.3, color: RivalColors.accentText, textAlign: 'center' },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, color: '#fff', textAlign: 'center', marginTop: 3 },
  close: {
    position: 'absolute', right: 0, top: -4,
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.surfaceContainer,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  foot: { paddingTop: 16, paddingBottom: 26, gap: 6 },

  label: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary, marginTop: 15, marginBottom: 8, textTransform: 'uppercase' },

  card: {
    backgroundColor: RivalColors.surfaceLowest, borderRadius: 16,
    borderWidth: 1, borderColor: RivalColors.surfaceBright, paddingHorizontal: 13,
  },
  divider: { height: 1, backgroundColor: RivalColors.surfaceBright, opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 10, paddingVertical: 4 },
  rowIcon: { width: 18, textAlign: 'center' },
  // At least 104 wide so short labels line up; longer ones take what they need.
  rowLabel: { fontSize: 13.5, fontWeight: '600', color: RivalColors.textSecondary, minWidth: 104, flexShrink: 0 },
  rowControl: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  rowValue: { color: RivalColors.textPrimary, fontSize: 15, fontWeight: '500', textAlign: 'right', paddingVertical: 8 },
  rowPlaceholder: { color: PLACEHOLDER, fontSize: 15, fontWeight: '500', textAlign: 'right', paddingVertical: 8 },
  rowInput: {
    color: RivalColors.textPrimary, fontSize: 15, fontWeight: '500',
    textAlign: 'right', paddingVertical: 8, minWidth: 0, alignSelf: 'stretch',
    backgroundColor: 'transparent', borderWidth: 0,
  },
  field: {
    backgroundColor: RivalColors.surfaceLowest, borderRadius: 14,
    borderWidth: 1, borderColor: RivalColors.surfaceBright,
    paddingHorizontal: 14, paddingVertical: 13,
    color: RivalColors.textPrimary, fontSize: 16, fontWeight: '500',
  },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tile: {
    alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 8,
    borderRadius: 14, backgroundColor: RivalColors.surfaceLowest,
    borderWidth: 1, borderColor: 'rgba(255,209,190,0.09)',
  },
  tileShort: { paddingVertical: 12 },
  tileOn: { backgroundColor: 'rgba(217,119,87,0.10)', borderColor: 'rgba(255,181,158,0.6)' },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  badgeOn: {
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  },
  tileText: { fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.72)', maxWidth: '92%' },
  tileTextOn: { color: '#fff' },

  note: { fontSize: 12, lineHeight: 17, color: RivalColors.textSecondary, marginTop: 8, marginHorizontal: 4 },

  primary: {
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: 999,
    paddingVertical: 15, alignItems: 'center',
    ...(Platform.OS === 'web' ? { boxShadow: '0 6px 22px rgba(217,119,87,0.32)' } : {}),
  },
  primaryOff: { opacity: 0.5 },
  primaryText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.surfaceLowest), letterSpacing: 0.2 },

  overlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  overlayCard: {
    width: '100%', maxWidth: 340, overflow: 'hidden',
    backgroundColor: RivalColors.surfaceHigh, borderRadius: 18,
    borderWidth: 1, borderColor: RivalColors.surfaceBright, padding: 18,
  },
});

/** A secondary action ("Challenge a team", "Plan activity"): a dark pill with
 *  the same round gradient icon badge the tiles use, so actions across the
 *  app read as one family. `large` for a hero, over a photo. */
export function RivalActionPill({
  icon, label, onPress, large, chevron,
}: {
  icon: RivalIconName;
  label: string;
  onPress: () => void;
  large?: boolean;
  chevron?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[a.pill, large && a.pillLarge]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <View style={[a.badge, large && a.badgeLarge]}>
        <RivalIcon name={icon} size={large ? 15 : 13} color={RivalColors.surfaceLowest} />
      </View>
      <Text style={[a.text, large && a.textLarge]} numberOfLines={1}>{label}</Text>
      {chevron ? <RivalIcon name="chevronRight" size={large ? 16 : 14} color="rgba(255,255,255,0.45)" /> : null}
    </TouchableOpacity>
  );
}

const a = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    paddingLeft: 5, paddingRight: 14, paddingVertical: 5, borderRadius: 999,
    backgroundColor: 'rgba(14,14,14,0.85)',
    borderWidth: 1, borderColor: 'rgba(255,209,190,0.14)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } : {}),
  } as any,
  pillLarge: { gap: 10, paddingLeft: 6, paddingRight: 16, paddingVertical: 6 },
  badge: {
    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  badgeLarge: { width: 30, height: 30, borderRadius: 15 },
  text: { fontSize: 13, fontWeight: '700', color: '#fff' },
  textLarge: { fontSize: 14.5 },
});

/** A full-width action as a tile: round gradient badge, title and a line of
 *  explanation, chevron. Sits in a page's column like any other card. */
export function RivalActionTile({
  icon, title, subtitle, onPress,
}: {
  icon: RivalIconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={t.tile} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
      <View style={t.badge}>
        <RivalIcon name={icon} size={18} color={RivalColors.surfaceLowest} />
      </View>
      <View style={t.text}>
        <Text style={t.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={t.sub}>{subtitle}</Text> : null}
      </View>
      <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.45)" />
    </TouchableOpacity>
  );
}

const t = StyleSheet.create({
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch',
    paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14,
    backgroundColor: 'rgba(14,14,14,0.78)',
    borderWidth: 1, borderColor: 'rgba(255,209,190,0.14)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } : {}),
  } as any,
  badge: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 12.5, color: RivalColors.textSecondary },
});

/** A small action tile: round gradient badge over a short label, the same
 *  shape as the activity tiles. The standard for secondary actions
 *  ("Invite code", "Plan activity", "Custom goal") instead of pills. */
export function RivalMiniTile({
  icon, label, onPress,
}: {
  icon: RivalIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={mt.tile} onPress={onPress} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={label}>
      <View style={mt.badge}>
        <RivalIcon name={icon} size={15} color={RivalColors.surfaceLowest} />
      </View>
      <Text style={mt.label} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

const mt = StyleSheet.create({
  tile: {
    width: 92, alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 9, paddingHorizontal: 6,
    borderRadius: 14, backgroundColor: 'rgba(14,14,14,0.8)',
    borderWidth: 1, borderColor: 'rgba(255,209,190,0.14)',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } : {}),
  } as any,
  badge: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  label: { fontSize: 11.5, lineHeight: 14, fontWeight: '700', color: '#fff', textAlign: 'center' },
});

/** The row of things not set up yet, at the top of a page. Each is a small
 *  tile; once it's set up, the page shows it as its own titled section and
 *  the tile drops out. Renders nothing when everything is set up. */
export function RivalStartTiles({
  tiles, title = "What's next",
}: {
  tiles: { key: string; icon: RivalIconName; label: string; onPress: () => void }[];
  title?: string;
}) {
  if (tiles.length === 0) return null;
  return (
    <View style={st.wrap}>
      <Text style={st.title}>{title}</Text>
      <View style={st.row}>
        {tiles.map((t) => (
          <TouchableOpacity key={t.key} style={st.tile} onPress={t.onPress} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t.label}>
            <View style={st.badge}>
              <RivalIcon name={t.icon} size={15} color={RivalColors.surfaceLowest} />
            </View>
            <Text style={st.label} numberOfLines={2}>{t.label}</Text>
          </TouchableOpacity>
        ))}
        {/* Fillers keep a short row on the same four-column grid. */}
        {Array.from({ length: (4 - (tiles.length % 4)) % 4 }).map((_, i) => <View key={`f${i}`} style={st.filler} />)}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 8 },
  title: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary, textTransform: 'uppercase', marginLeft: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tile: {
    flexBasis: '22%', flexGrow: 1, alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 9, paddingHorizontal: 3,
    borderRadius: 14, backgroundColor: 'rgba(14,14,14,0.8)',
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)',
    // The warm wash inside the card, the same as the planned-activity cards
    // (SessionCard's "inviting" style): lit from the top, fading down.
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'linear-gradient(180deg, #2a1d18 0%, #1c1a19 70%)' }
      : { backgroundColor: '#241b17' }),
  } as any,
  filler: { flexBasis: '22%', flexGrow: 1 },
  badge: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.accentText,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #ffb59e, #D97757)' } : {}),
  } as any,
  label: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', color: '#fff', textAlign: 'center' },
});
