import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { RivalButtonColors, RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalBackButton } from './RivalBackButton';
import { RivalIcon, type RivalIconName } from './RivalIcon';

// The RIVAL look on mobile, in one place.
//
// Worked out screen by screen — Edit session, Team settings, the Weekly Leader
// card — and pulled together here so every screen that gets the treatment
// uses the same pieces rather than a near copy of them:
//
//   * warm brown cards, not grey boxes; a soft terracotta glow on the one
//     hero moment of a screen
//   * serif italic for titles and names — the voice of the app
//   * small orange spaced caps for section labels
//   * one terracotta-to-salmon gradient pill for the screen's main action;
//     everything else is a quiet outlined pill or a text link
//   * real icons, never emoji
//
// Mobile only for now: desktop keeps its own layouts until the mobile app is
// finished, so screens branch on width and use these on the narrow side.

export const RivalWarm = {
  page: '#110e0c',
  card: '#1d1714',
  cardBorder: 'rgba(255,255,255,0.07)',
  field: 'rgba(255,255,255,0.04)',
  hairline: 'rgba(255,255,255,0.06)',
  muted: 'rgba(255,255,255,0.45)',
  soft: 'rgba(255,255,255,0.6)',
};

export const rm = StyleSheet.create({
  page: { flex: 1, backgroundColor: RivalWarm.page },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48, gap: 14 },

  // Serif italic: screen titles, session and team names.
  serifTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 26, fontWeight: '700', color: '#fff', lineHeight: 32 },
  serifTitleSm: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 20, fontWeight: '700', color: '#fff', lineHeight: 26 },
  body: { fontSize: 14, lineHeight: 20, color: RivalWarm.soft },

  card: { backgroundColor: RivalWarm.card, borderRadius: 16, borderWidth: 1, borderColor: RivalWarm.cardBorder, padding: 16, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  // The quiet label for a field inside a sheet card (the card's heading is rm.label).
  fieldLabel: { fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginBottom: -4 },
  hint: { fontSize: 12, lineHeight: 17, color: RivalWarm.muted },

  // The one hero moment on a screen.
  hero: {
    borderRadius: 20, padding: 20, gap: 12,
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.16)', backgroundColor: '#2d241f',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'radial-gradient(circle at -10% -15%, rgba(255,209,190,0.16) 0%, rgba(255,209,190,0) 70%), linear-gradient(135deg, #231e1b 0%, #2d241f 55%, #3b2821 100%)',
    } as any : {}),
  },

  field: { backgroundColor: RivalWarm.field, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  input: {
    padding: 0, fontSize: 15, fontWeight: '600', color: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },

  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,209,190,0.10)' },

  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  },
  primaryText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill), letterSpacing: 0.2 },
  ghost: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,209,190,0.28)',
  },
  ghostText: { fontSize: 14.5, fontWeight: '700', color: RivalColors.accentText },
  disabled: { opacity: 0.5 },
  error: { fontSize: 12.5, fontWeight: '600', color: '#ff8f8f' },
});

// Back arrow and a small caps page label. The page's real title — a session
// or team name — is left to the content beneath, so the two never compete.
// `serif` sets the title as the page's heading instead (serif italic, white),
// for pages whose sections below use serif headings too, like Goals.
export function RivalMobileHeader({ title, onBack, right, serif = false }: { title: string; onBack: () => void; right?: ReactNode; serif?: boolean }) {
  return (
    <View style={styles.header}>
      <RivalBackButton onPress={onBack} />
      <Text style={serif ? styles.headerTitleSerif : styles.headerTitle} numberOfLines={1}>{title}</Text>
      {right ?? null}
    </View>
  );
}

// A whole-row tappable card: icon, title, one line of explanation, chevron.
// For choosing where to go next, where a bordered button inside a card was
// making the reader find the one small tappable part of a large box.
export function RivalRowLink({
  icon, title, body, onPress, style,
}: { icon: RivalIconName; title: string; body?: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <TouchableOpacity style={[rm.card, styles.row, style]} onPress={onPress} activeOpacity={0.8}>
      <View style={rm.iconCircle}>
        <RivalIcon name={icon} size={20} color={RivalColors.accentText} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {body ? <Text style={rm.hint}>{body}</Text> : null}
      </View>
      <RivalIcon name="chevronRight" size={20} color={RivalWarm.muted} />
    </TouchableOpacity>
  );
}

// Fading hairline — the same stroke as the podium's stage line and the
// countdown on the Weekly Leader card.
export function RivalHairline({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.hairline, style]} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  headerTitleSerif: { flex: 1, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 26, fontWeight: '700', color: '#fff' },
  headerTitle: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: RivalColors.accentText },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15.5, fontWeight: '700', color: '#fff' },
  hairline: {
    height: 1, alignSelf: 'stretch',
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,181,158,0) 0%, rgba(255,181,158,0.35) 50%, rgba(255,181,158,0) 100%)' } as any)
      : { backgroundColor: 'rgba(255,181,158,0.2)' }),
  },
});

// ── Form sheets ─────────────────────────────────────────────────────────
// The shared layout for every small create/edit form on mobile (Add event,
// New goal, Plan a workout, …), chosen 2026-09-28:
//
//   * page background, rounded top with a soft sand edge, centred serif title
//   * fields grouped in cards (RivalSheetCard), one salmon caps heading each,
//     quiet white sentence-case labels inside (rm.fieldLabel)
//   * choices as equal tiles (RivalTiles), not a wrapping row of pills
//   * the main action pinned under the fields (`footer`), never at the end
//     of a long scroll

export function RivalSheet({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <View style={sheet.shell}>
      <ScrollView style={sheet.scroll} contentContainerStyle={sheet.body} keyboardShouldPersistTaps="handled">
        <Text style={sheet.title}>{title}</Text>
        {children}
      </ScrollView>
      <View style={sheet.foot}>{footer}</View>
    </View>
  );
}

export function RivalSheetCard({ heading, children, style }: { heading?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[sheet.card, style]}>
      {heading ? <Text style={rm.label}>{heading}</Text> : null}
      {children}
    </View>
  );
}

/** Equal tiles, `columns` across. With icons they're square-ish; without,
 *  a compact row of equal buttons. The chosen tile gets a salmon edge. */
export function RivalTiles<T extends string>({
  options, value, onChange, columns = 4,
}: {
  options: { value: T; label: string; icon?: RivalIconName }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  const width = `${(100 - (columns - 1) * 2.6) / columns}%` as any;
  return (
    <View style={sheet.tiles}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            style={[sheet.tile, { width }, o.icon ? sheet.tileTall : sheet.tileShort, on && sheet.tileOn]}
            onPress={() => onChange(o.value)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            {o.icon ? <RivalIcon name={o.icon} size={22} color={on ? RivalColors.accentText : 'rgba(255,255,255,0.55)'} /> : null}
            <Text style={[sheet.tileText, !o.icon && sheet.tileTextShort, on && sheet.tileTextOn]} numberOfLines={1}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** A dashed row that opens optional fields: "Registration link, goal time · Add details +". */
export function RivalMoreRow({ text, action, onPress }: { text: string; action: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={sheet.more} onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      <Text style={sheet.moreText}>{text}</Text>
      <Text style={sheet.moreAction}>{action}</Text>
    </TouchableOpacity>
  );
}

const sheet = StyleSheet.create({
  shell: {
    maxHeight: '92%', backgroundColor: RivalWarm.page, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,209,190,0.18)', overflow: 'hidden',
  },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 12, gap: 10 },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 4, textAlign: 'center' },
  foot: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, gap: 10, borderTopWidth: 1, borderTopColor: RivalWarm.hairline, backgroundColor: RivalWarm.page },
  card: { backgroundColor: RivalWarm.card, borderWidth: 1, borderColor: RivalWarm.cardBorder, borderRadius: 18, padding: 14, gap: 10 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalWarm.field, borderWidth: 1, borderColor: RivalWarm.cardBorder },
  tileTall: { aspectRatio: 1.1, gap: 6 },
  tileShort: { paddingVertical: 12 },
  tileOn: { backgroundColor: 'rgba(217,119,87,0.14)', borderColor: 'rgba(255,181,158,0.55)' },
  tileText: { fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  tileTextShort: { fontSize: 13.5 },
  tileTextOn: { color: '#fff' },
  more: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 18,
    borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,209,190,0.18)',
  },
  moreText: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },
  moreAction: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
});
