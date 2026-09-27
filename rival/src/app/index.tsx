import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, Image, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { RivalButton } from '../components/rival';
import { RivalColors, RivalType, RivalSerifFamily } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { rm } from '../components/rival/RivalMobile';

const SMOKE_SOURCE = require('../../assets/images/backgrounds/optimized/podium-smoke.jpg');

export default function WelcomeScreen() {
  const mobile = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  // Signed-in people go straight to Home. The welcome page stays hidden until
  // the session check finishes, so it never flashes up on the way through.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (session) router.replace('/home');
        else setChecked(true);
      })
      .catch(() => setChecked(true));
  }, []);

  if (!checked) return <View style={styles.pending} />;

  return (
    <View style={styles.page}>
      <View style={styles.hero}>
        <Image source={SMOKE_SOURCE} style={styles.smoke} resizeMode="cover" />
        <Image source={SMOKE_SOURCE} style={styles.smokeTop} resizeMode="cover" />
        <SafeAreaView style={styles.content}>
          <Text style={styles.logo}>RIVAL</Text>

          <View style={styles.taglineWrap}>
            <Text style={[styles.tagline, mobile && ms.tagline]}>We make each other better</Text>
            {/* The one place the name is explained. Everywhere else the
                product carries it: rivals as the people who lift you. */}
            <Text style={styles.taglineSub}>A rival isn't someone you're against. It's someone who brings out your best.</Text>
          </View>

          {mobile ? (
            <View style={ms.buttons}>
              <TouchableOpacity style={rm.primary} onPress={() => router.push('/sign-up')} accessibilityRole="button">
                <Text style={rm.primaryText}>Get started</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/sign-in')} style={styles.signInLink} accessibilityRole="button">
                <Text style={ms.signIn}>Already have an account? <Text style={ms.signInStrong}>Sign in</Text></Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.buttons}>
              <RivalButton
                label="Get started"
                onPress={() => router.push('/sign-up')}
                labelStyle={{ textTransform: 'uppercase', letterSpacing: 2, fontWeight: '800' }}
                style={{ paddingHorizontal: 19, paddingVertical: 11 }}
              />
              <TouchableOpacity onPress={() => router.push('/sign-in')} style={styles.signInLink}>
                <Text style={styles.signInLinkText}>Sign in</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Plain block container — no flex:1 (that requires a height-bounded ancestor,
  // which this screen deliberately no longer has).
  page: {
    backgroundColor: RivalColors.surfaceLow,
  },
  pending: { flex: 1, minHeight: '100%', backgroundColor: RivalColors.surfaceLow },
  // minHeight, not height: fills at least one screen but is free to grow, same as
  // any ordinary hero section on a real webpage.
  // 100dvh, not 100vh: on iOS 100vh is the LARGE viewport (741px of an 852px
  // iPhone 15 Pro screen) while only the SMALL viewport (659px) is actually
  // visible behind Safari's toolbar. Sizing the hero to 100vh pushed the
  // "Sign In" link into that hidden 82px band with nothing scrollable to
  // reach it. 100dvh tracks what is genuinely visible.
  hero: {
    position: 'relative',
    minHeight: '100dvh' as any,
    width: '100%',
  },
  // Same warm-smoke texture as the Today screen's Weekly Leader/Legacy
  // sections — low opacity, faded on both edges so it reads as ambient
  // atmosphere behind the logo rather than a cropped photo.
  smoke: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    width: '100%', height: 500,
    opacity: 0.3,
    ...(Platform.OS === 'web'
      ? ({
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)',
        } as any)
      : {}),
  },
  // Second copy, mirrored vertically and pinned to the top instead — smoke
  // rising from both edges toward the middle rather than just the bottom.
  smokeTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    width: '100%', height: 500,
    opacity: 0.3,
    transform: [{ scaleY: -1 }],
    ...(Platform.OS === 'web'
      ? ({
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)',
        } as any)
      : {}),
  },
  content: {
    minHeight: '100dvh' as any,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingBottom: 40,
    paddingTop: 24,
  },
  logo: {
    ...RivalType.titleMd,
    color: RivalColors.textPrimary,
    letterSpacing: 8,
    textAlign: 'center',
  },
  taglineWrap: {
    alignItems: 'center',
    gap: 16,
    paddingBottom: 32,
    marginTop: 80,
  },
  tagline: {
    ...RivalType.headlineLg,
    color: RivalColors.textPrimary,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 4,
    fontSize: 17,
    lineHeight: 22,
  },
  taglineSub: {
    ...RivalType.bodyMd,
    color: RivalColors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 300,
  },
  buttons: {
    gap: 4,
    alignItems: 'center',
  },
  signInLink: {
    paddingVertical: 14,
  },
  signInLinkText: {
    color: RivalColors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
});

// Phone: the tagline in the app's serif voice, and the one gradient pill.
const ms = StyleSheet.create({
  tagline: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700',
    textTransform: 'none', letterSpacing: 0, fontSize: 30, lineHeight: 36,
  },
  buttons: { alignSelf: 'stretch', gap: 4 },
  signIn: { textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.6)' },
  signInStrong: { color: RivalColors.accentText, fontWeight: '700' },
});
