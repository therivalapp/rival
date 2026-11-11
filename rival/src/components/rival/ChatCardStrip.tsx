import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalIcon } from './RivalIcon';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalGhost } from '../../constants/rivalTheme';
import type { ChatCard, ChatCardChip } from '../../lib/chatCards';

// The chat card above the message box (Mockup 33 v4): icon, one bold line,
// an X, and replies underneath that act in one tap. lib/chatCards.ts decides
// which card shows; the chat screen does what a reply asks.

const TONE: Record<ChatCard['tone'], { bg: string; fg: string }> = {
  accent: { bg: 'rgba(255,181,158,0.14)', fg: RivalColors.accentText },
  event: { bg: 'rgba(244,234,216,0.12)', fg: RivalColors.event },
  pb: { bg: 'rgba(255,215,0,0.13)', fg: RivalColors.rankAnchors.unrivaled },
};

export function ChatCardStrip({ card, onChip, onClose }: {
  card: ChatCard;
  onChip: (chip: ChatCardChip) => void;
  onClose: () => void;
}) {
  const tone = TONE[card.tone];
  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <View style={[s.icon, { backgroundColor: tone.bg }]}>
          <RivalIcon name={card.icon} size={21} color={tone.fg} />
        </View>
        <Text style={s.text}>{card.text}</Text>
        <TouchableOpacity onPress={onClose} style={s.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <RivalIcon name="close" size={17} color={RivalColors.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} style={s.chipScroll} keyboardShouldPersistTaps="handled">
        {card.chips.map((chip) => {
          const go = chip.kind === 'rsvp';
          return (
            <TouchableOpacity key={chip.label} onPress={() => onChip(chip)} style={[s.chip, go && s.chipGo]} accessibilityRole="button">
              {chip.kind === 'respect' ? <RivalIcon name="respect" size={17} color={RivalColors.accentText} /> : null}
              <Text style={[s.chipText, go && s.chipGoText]}>{chip.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderTopWidth: 1, borderTopColor: RivalColors.surfaceBright, paddingTop: 12, paddingLeft: 14, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 14 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontFamily: RivalFontFamily, fontSize: 14, lineHeight: 19, fontWeight: '700', color: RivalColors.textPrimary },
  close: { width: 30, height: 30, borderRadius: 15, backgroundColor: RivalColors.surfaceBright, alignItems: 'center', justifyContent: 'center' },
  chipScroll: { marginTop: 12 },
  chips: { gap: 8, paddingRight: 14, paddingBottom: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border,
  },
  chipText: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '600', color: RivalColors.textPrimary },
  chipGo: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' },
  chipGoText: { color: '#2a1710', fontWeight: '700' },
});
