import { StyleSheet, TouchableOpacity, View, Text, ScrollView, ImageBackground, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalButton, RivalCard, RivalIcon, RivalIconName, RivalTopNav, RivalBackButton, RivalMobileHeader, RivalRowLink, rm } from '../components/rival';
import { RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';
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
    // Mobile: scanning leads, because it's the fastest way in and the one
    // people don't know RIVAL can do. Manual entry and a whole week are the
    // two other roads, as full-width rows you can tap anywhere on.
    return (
      <SafeAreaView style={rm.page} edges={['top', 'left', 'right']}>
        <RivalTopNav />
        <ScrollView contentContainerStyle={rm.content}>
          <RivalMobileHeader title="Add workout" onBack={() => router.back()} />

          <View style={rm.hero}>
            <View style={ms.heroTop}>
              <View style={rm.iconCircle}>
                <RivalIcon name="scan" size={20} color={RivalColors.accentText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={rm.label}>AI scan</Text>
                <Text style={rm.serifTitleSm}>Scan workout</Text>
              </View>
            </View>
            <Text style={rm.hint}>Capture a workout card, whiteboard or app screenshot. The details are extracted automatically.</Text>

            <View style={ms.steps}>
              {PROCESS_STEPS.map((step, i) => (
                <View key={step.title} style={ms.step}>
                  <View style={ms.stepNum}><Text style={ms.stepNumText}>{i + 1}</Text></View>
                  <Text style={ms.stepText}>{['Capture or upload', 'Details extracted automatically', 'Review and save'][i]}</Text>
                </View>
              ))}
            </View>

            <View style={ms.heroActions}>
              <TouchableOpacity style={[rm.primary, { flex: 1 }]} onPress={() => router.push('/scan-workout?source=camera')} activeOpacity={0.85}>
                <RivalIcon name="camera" size={18} color={rm.primaryText.color as string} />
                <Text style={rm.primaryText} numberOfLines={1}>Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[rm.ghost, { flex: 1 }]} onPress={() => router.push('/scan-workout?source=gallery')} activeOpacity={0.85}>
                <RivalIcon name="upload" size={18} color={RivalColors.accentText} />
                <Text style={rm.ghostText} numberOfLines={1}>Upload</Text>
              </TouchableOpacity>
            </View>
          </View>

          <RivalRowLink icon="manual" title="Manual entry" body="Enter duration, distance and lifts" onPress={() => router.push('/manual-entry')} />
          <RivalRowLink icon="batch" title="Weekly scan" body="Log multiple days at once" onPress={() => router.push('/weekly-scan')} />
        </ScrollView>
      </SafeAreaView>
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

const ms = StyleSheet.create({
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  steps: { gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,209,190,0.12)' },
  stepNumText: { fontSize: 11, fontWeight: '800', color: RivalColors.accentText },
  stepText: { flex: 1, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.72)' },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
