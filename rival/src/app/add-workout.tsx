import { StyleSheet, TouchableOpacity, View, Text, ScrollView, ImageBackground, useWindowDimensions, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalButton, RivalCard, RivalIcon, RivalIconName, RivalTopNav, RivalBackButton, rb, GreyPageHead, GreyRows, GreyRow, GreySheet } from '../components/rival';
import { goToTab } from '../lib/tabNav';
import { pickScanFiles, setPendingScanFiles } from '../lib/scanHandoff';
import { RivalButtonColors, RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';

const PROCESS_STEPS: Array<{ icon: RivalIconName; title: string; body: string }> = [
  { icon: 'addPhoto', title: '1. Capture', body: 'Photograph a training app screen, gym whiteboard or workout card.' },
  { icon: 'brain', title: '2. Automatic extraction', body: 'Exercises, sets, weights and distance are extracted from the image.' },
  { icon: 'verified', title: '3. Review and save', body: 'Confirm the details. Effort updates as soon as the activity is saved.' },
];

export default function AddWorkoutScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;

  const card = (
    icon: RivalIconName,
    accent: boolean,
    title: string,
    body: string,
    actions: React.ReactNode,
  ) => (
    <RivalCard glass style={[styles.card, wide && styles.cardWide]}>
      <View style={[styles.cardIcon, accent && styles.cardIconAccent]}>
        <RivalIcon name={icon} size={26} color={accent ? RivalColors.accentText : RivalColors.textSecondary} />
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
      <View style={styles.cardActions}>{actions}</View>
    </RivalCard>
  );

  if (!wide) {
    // Phone: a pop-up over the page it came from (a transparent modal on
    // phone, see _layout.tsx). Scanning leads as two big tiles straight on the
    // sheet, because adding activities should be one easy tap (Ricky,
    // 2026-10-02); manual entry and a multi-day scan are the other roads.
    const close = () => (router.canGoBack() ? router.back() : goToTab('/my-activities'));
    // The camera or photo library opens straight from the tile's tap; the
    // scan page then reads what was chosen (lib/scanHandoff.ts). Cancelling
    // leaves you here.
    const scan = (source: 'camera' | 'gallery') => {
      if (Platform.OS !== 'web') { router.push(`/scan-workout?source=${source}`); return; }
      pickScanFiles(source, (files) => {
        setPendingScanFiles(files);
        router.push('/scan-workout?source=picked');
      });
    };
    return (
      <View style={ms.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
        <GreySheet
          kicker="LOG"
          title="Add an activity"
          onClose={close}
          footer={<Text style={ms.tileNote}>Details are read automatically. Review before saving.</Text>}
        >
          {/* Four ways in, all the same size of tile (Ricky, 2026-10-02):
              the two scans first, the photo tile lit. */}
          <View style={[ms.tiles, ms.tilesTop]}>
            <TouchableOpacity style={[ms.tile, ms.tilePrimary]} onPress={() => scan('camera')} activeOpacity={0.85} accessibilityRole="button">
              <View style={ms.tileIconPrimary}><RivalIcon name="camera" size={26} color={ms.primaryText.color as string} /></View>
              <Text style={[ms.tileTitle, { color: ms.primaryText.color as string }]}>Take photo</Text>
              <Text style={[ms.tileSub, { color: ms.primaryText.color as string, opacity: 0.75 }]}>Use the camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ms.tile, ms.tileGhost]} onPress={() => scan('gallery')} activeOpacity={0.85} accessibilityRole="button">
              <View style={ms.tileIconGhost}><RivalIcon name="upload" size={26} color={RivalColors.accentText} /></View>
              <Text style={ms.tileTitle}>Upload</Text>
              <Text style={ms.tileSub}>From the photo library</Text>
            </TouchableOpacity>
          </View>
          <View style={[ms.tiles, { marginTop: 10 }]}>
            <TouchableOpacity style={[ms.tile, ms.tileGhost]} onPress={() => router.push('/manual-entry')} activeOpacity={0.85} accessibilityRole="button">
              <View style={ms.tileIconGhost}><RivalIcon name="manual" size={26} color={RivalColors.accentText} /></View>
              <Text style={ms.tileTitle}>Manual entry</Text>
              <Text style={ms.tileSub}>Type in the details</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ms.tile, ms.tileGhost]} onPress={() => router.push('/weekly-scan')} activeOpacity={0.85} accessibilityRole="button">
              <View style={ms.tileIconGhost}><RivalIcon name="batch" size={26} color={RivalColors.accentText} /></View>
              <Text style={ms.tileTitle}>Multi-day scan</Text>
              <Text style={ms.tileSub}>Several days at once</Text>
            </TouchableOpacity>
          </View>
        </GreySheet>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ImageBackground
        source={require('../../assets/images/backgrounds/optimized/overhead-squat-warehouse-gym.jpg')}
        style={styles.bg}
        imageStyle={styles.bgImage}
        resizeMode="cover"
      >
        <RivalTopNav />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
          </View>

          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>ADD WORKOUT</Text>
            <Text style={styles.heroTitle}>Honor the commitment.</Text>
            <Text style={styles.heroSub}>
              Record an activity by photo, by manual entry or with a weekly scan.
            </Text>
          </View>

          {/* Three actions */}
          <View style={[styles.cardsRow, wide && styles.cardsRowWide]}>
            {card('scan', true, 'Scan Workout', 'Capture or upload a workout card. The details are extracted automatically.', (
              <>
                <RivalButton label="Capture" onPress={() => router.push('/scan-workout?source=camera')} style={styles.fullBtn} />
                <RivalButton label="Upload" onPress={() => router.push('/scan-workout?source=gallery')} variant="secondary" style={styles.fullBtn} />
              </>
            ))}
            {card('manual', false, 'Manual Entry', 'Enter duration, distance and lifts.', (
              <RivalButton label="Manual Entry →" onPress={() => router.push('/manual-entry')} variant="secondary" style={styles.fullBtn} />
            ))}
            {card('batch', false, 'Weekly Scan', 'Log multiple days at once.', (
              <RivalButton label="Weekly Scan" onPress={() => router.push('/weekly-scan')} variant="secondary" style={styles.fullBtn} />
            ))}
          </View>

          {/* How it works */}
          <View style={styles.processSection}>
            <Text style={styles.processTitle}>HOW IT WORKS</Text>
            <View style={[styles.processRow, wide && styles.processRowWide]}>
              {PROCESS_STEPS.map((step) => (
                <View key={step.title} style={[styles.processStep, wide && styles.processStepWide]}>
                  <View style={styles.processIcon}>
                    <RivalIcon name={step.icon} size={20} color={RivalColors.accentText} />
                  </View>
                  <View style={styles.processTextWrap}>
                    <Text style={styles.processStepTitle}>{step.title}</Text>
                    <Text style={styles.processStepBody}>{step.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  bg: { flex: 1 },
  // Faint atmospheric backdrop, like the mockup's opacity-10 image behind a scrim.
  bgImage: { opacity: 0.12 },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, maxWidth: 1200, width: '100%', alignSelf: 'center' },

  header: { marginBottom: 8 },
  back: { color: RivalColors.accentText, fontSize: 16 },

  hero: { alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 40, paddingHorizontal: 8 },
  heroLabel: { ...RivalType.labelCaps, color: RivalColors.accentText, letterSpacing: 2 },
  heroTitle: { ...RivalType.headlineLg, color: RivalColors.textPrimary, textAlign: 'center' },
  heroSub: { ...RivalType.bodyMd, color: RivalColors.textSecondary, textAlign: 'center', maxWidth: 560 },

  cardsRow: { gap: 16, marginBottom: 48 },
  cardsRowWide: { flexDirection: 'row', alignItems: 'stretch' },
  card: { flex: 1, padding: 24, gap: 12 },
  cardWide: { flexBasis: 0 },
  cardIcon: { width: 56, height: 56, borderRadius: RivalRadius.md, backgroundColor: RivalColors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  cardIconAccent: { backgroundColor: `${RivalColors.accentFill}22` },
  cardIconText: { fontSize: 26 },
  cardTitle: { ...RivalType.titleMd, fontSize: 22, color: RivalColors.textPrimary },
  cardBody: { ...RivalType.bodyMd, fontSize: 14, color: RivalColors.textSecondary },
  cardActions: { marginTop: 'auto', paddingTop: 16, gap: 10 },
  fullBtn: { width: '100%' },

  processSection: { borderTopWidth: 1, borderTopColor: RivalColors.outlineVariant, paddingTop: 32 },
  processTitle: { ...RivalType.labelCaps, color: RivalColors.textSecondary, textAlign: 'center', letterSpacing: 3, marginBottom: 28 },
  processRow: { gap: 24 },
  processRowWide: { flexDirection: 'row' },
  processStep: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  processStepWide: { flex: 1 },
  processIcon: { width: 48, height: 48, borderRadius: RivalRadius.full, backgroundColor: RivalColors.surfaceContainerHigh, borderWidth: 1, borderColor: RivalColors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  processIconText: { fontSize: 20 },
  processTextWrap: { flex: 1, gap: 4 },
  processStepTitle: { ...RivalType.titleMd, fontSize: 16, color: RivalColors.textPrimary },
  processStepBody: { fontSize: 13, color: RivalColors.textSecondary, lineHeight: 19 },
});

// Phone only — the blend (see RivalGreySheet's rb).
const ms = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  stepNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  stepNumText: { fontSize: 12, fontWeight: '800', color: RivalColors.accentText },
  stepText: { flex: 1, fontSize: 14, fontWeight: '600', color: RivalColors.textSecondary },
  actions: { flexDirection: 'row', gap: 8 },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 999,
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  },
  primaryText: { fontSize: 14.5, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  ghost: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)',
  },
  ghostText: { fontSize: 14.5, fontWeight: '700', color: RivalColors.accentText },
  // The two scan tiles on the phone pop-up.
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  tiles: { flexDirection: 'row', gap: 10 },
  tilesTop: { marginTop: 14 },
  tile: { flex: 1, minHeight: 132, borderRadius: 18, padding: 16, justifyContent: 'flex-end', gap: 3 },
  tilePrimary: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  tileGhost: { borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)', backgroundColor: 'rgba(255,209,190,0.05)' },
  tileIconPrimary: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.12)', marginBottom: 'auto' },
  tileIconGhost: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,181,158,0.1)', marginBottom: 'auto' },
  tileTitle: { fontSize: 17, fontWeight: '800', color: RivalColors.textPrimary },
  tileSub: { fontSize: 12, fontWeight: '500', color: RivalColors.textSecondary },
  tileNote: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
});
