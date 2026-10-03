import { StyleSheet } from 'react-native';
import { RivalColors, RivalGhost, RivalSerifFamily } from '../../../constants/rivalTheme';

// Shared look for Team Hub's bottom sheets (challenge a teammate, challenge a
// team, encourage, edit the Team Challenge). Same language as
// PlanSessionSheet: raised sheet, serif italic title, recessed inputs, filled
// accent chip for the selection, thumb-sized buttons.
export const sheet = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: RivalColors.surfaceHigh,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 26,
    borderTopWidth: 1, borderColor: RivalColors.surfaceBright,
  },
  grabber: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: RivalColors.surfaceBright, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, color: '#fff' },
  sub: { fontSize: 13, color: RivalColors.textSecondary, marginTop: 2 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalColors.surfaceContainer },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary, marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999,
    backgroundColor: RivalColors.surfaceContainer, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  chipOn: { backgroundColor: RivalColors.accentText, borderColor: RivalColors.accentText },
  chipText: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  chipTextOn: { color: RivalColors.surfaceLowest },
  input: {
    backgroundColor: RivalColors.surfaceLowest, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    color: RivalColors.textPrimary, borderWidth: 1, borderColor: RivalColors.surfaceBright,
    // 16 is the floor iOS Safari zooms below on focus.
    fontSize: 16,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  primaryBtn: { flex: 1, minHeight: 48, borderRadius: 999, backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center' },
  primaryBtnOff: { opacity: 0.45 },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: RivalColors.surfaceLowest },
  secondaryBtn: {
    flex: 1, minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  error: { fontSize: 13, color: '#ff9b8f', marginTop: 10 },
});

// Phones: the Add an activity look (warm outlines, Ricky 2026-10-03), on top
// of `sheet`. Desktop keeps the recessed greys.
export const sheetPhone = StyleSheet.create({
  chip: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border },
  input: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border },
  list: { backgroundColor: RivalGhost.fill, borderColor: RivalGhost.border },
});
