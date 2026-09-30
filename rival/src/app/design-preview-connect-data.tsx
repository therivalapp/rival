// DESIGN PREVIEW ONLY — not linked from any real navigation, reachable by typing
// the URL directly. Matches the locked Stitch "Connect Data" onboarding mockup
// (rival/design/stitch-export-2/.../onboarding_connect_data_epic_expansive_view/)
// exactly for LAYOUT purposes.
// DECIDED (Ricky, 2026-07-11): Strava is the one real connection; every other
// provider card stays visible but reads "Connection coming soon" until its
// integration exists. Delete this preview once the real onboarding screen is
// built (still pending: where connect-data sits in the signup flow order).
import { ImageBackground, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RivalColors, RivalRadius, RivalType, RivalButtonColors } from '../constants/rivalTheme';

export default function DesignPreviewConnectData() {
  return (
    <ImageBackground
      source={require('../../assets/images/backgrounds/optimized/a-small-group-of-diverse-athletes-2-2.jpg')}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.scrim} />
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>

          <View style={styles.hero}>
            <Text style={styles.title}>Bring your training with you.</Text>
            <Text style={styles.sub}>
              Connect your devices to automatically sync your workouts. Your history becomes your foundation here.
            </Text>
          </View>

          <View style={styles.deviceRow}>
            <View style={styles.deviceCard}>
              <Text style={styles.deviceIcon}>🏃</Text>
              <Text style={styles.deviceName}>Strava</Text>
              <Text style={styles.deviceStatusLive}>Connect now</Text>
            </View>
            <View style={[styles.deviceCard, styles.deviceCardDisabled]}>
              <Text style={styles.deviceIcon}>⌚</Text>
              <Text style={styles.deviceName}>Garmin</Text>
              <Text style={styles.deviceStatus}>Connection coming soon</Text>
            </View>
            <View style={[styles.deviceCard, styles.deviceCardDisabled]}>
              <Text style={styles.deviceIcon}>⛰️</Text>
              <Text style={styles.deviceName}>COROS</Text>
              <Text style={styles.deviceStatus}>Connection coming soon</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Sync Services</Text>
            </TouchableOpacity>
            <TouchableOpacity>
              <Text style={styles.skipLink}>Skip for now</Text>
            </TouchableOpacity>
            <Text style={styles.footerNote}>Your data is encrypted. People before data.</Text>
          </View>

        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14,14,14,0.55)' },
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 32, justifyContent: 'center', gap: 40 },

  hero: { alignItems: 'center', gap: 12 },
  title: { ...RivalType.headlineLg, color: RivalColors.textPrimary, textAlign: 'center' },
  sub: { ...RivalType.bodyMd, color: RivalColors.onSurfaceVariant, textAlign: 'center', maxWidth: 480 },

  deviceRow: { flexDirection: 'row', gap: 16, justifyContent: 'center' },
  deviceCard: {
    width: 180,
    backgroundColor: 'rgba(24,24,24,0.7)',
    borderRadius: RivalRadius.lg,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  deviceCardDisabled: { opacity: 0.55 },
  deviceIcon: { fontSize: 28, color: RivalColors.accentText },
  deviceName: { fontSize: 16, fontWeight: '700', color: RivalColors.textPrimary },
  deviceStatus: { fontSize: 10, color: RivalColors.textSecondary, textAlign: 'center', fontStyle: 'italic' },
  deviceStatusLive: { fontSize: 11, color: RivalColors.accentText, fontWeight: '700', textAlign: 'center' },

  actions: { alignItems: 'center', gap: 14 },
  primaryButton: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderRadius: RivalRadius.full, paddingVertical: 16, paddingHorizontal: 48 },
  primaryButtonText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontWeight: '700', fontSize: 16 },
  skipLink: { ...RivalType.labelCaps, fontSize: 12, color: RivalColors.textSecondary },
  footerNote: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 8 },
});
