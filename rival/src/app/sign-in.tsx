import { useState, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, Image, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { RivalButton, RivalIcon, RivalBackButton, RivalWarm, rm } from '../components/rival';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';
import { BusyText } from '../components/rival/BusyText';

const SMOKE_SOURCE = require('../../assets/images/backgrounds/optimized/podium-smoke.jpg');
const REMEMBER_KEY = 'rival_remembered_email';

function loadRemembered(): { email: string; remember: boolean } {
  if (Platform.OS === 'web') {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved) return { email: saved, remember: true };
  }
  return { email: '', remember: false };
}

export default function SignInScreen() {
  const { width } = useWindowDimensions();
  const mob = width < BREAKPOINT_WIDE_LAYOUT;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const { email: savedEmail, remember } = loadRemembered();
    if (savedEmail) setEmail(savedEmail);
    setRememberMe(remember);
  }, []);

  async function handleSignIn() {
    if (!email || !password) {
      setError('Enter an email and password.');
      return;
    }

    setLoading(true);
    setError('');

    if (Platform.OS === 'web') {
      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, email);
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    }

    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.replace('/home');
  }

  async function handleForgotPassword() {
    if (!email) {
      setError('Enter an email address, then select "Forgot password?"');
      return;
    }
    setResetLoading(true);
    setError('');
    const redirectTo = Platform.OS === 'web' ? `${window.location.origin}/reset-password` : undefined;
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setResetLoading(false);
    setResetSent(true);
  }

  return (
    <View style={[styles.bg, mob && ms.bg]}>
      <Image source={SMOKE_SOURCE} style={styles.smoke} resizeMode="cover" />
      <Image source={SMOKE_SOURCE} style={styles.smokeTop} resizeMode="cover" />
      <SafeAreaView style={styles.container}>
        <ScrollView
          // Scrolls when the form is taller than the screen (a small phone, or
          // the keyboard up) instead of cutting the bottom off. Short forms
          // still sit centred: the content grows to fill, then beyond it.
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          <RivalBackButton onPress={() => router.back()} style={styles.back} />

          <Text style={styles.logo}>RIVAL</Text>

          <View style={[styles.card, mob && ms.card]}>
            <Text style={[styles.title, mob && ms.title]}>Welcome back</Text>
            <Text style={[styles.subtitle, mob && ms.subtitle]}>Your Effort is waiting.</Text>

            {error ? (
              <View style={[styles.errorBox, mob && ms.errorBox]}>
                <Text style={[styles.errorText, mob && ms.errorText]}>{error}</Text>
              </View>
            ) : null}

            {resetSent ? (
              <View style={[styles.successBox, mob && ms.successBox]}>
                <Text style={[styles.successText, mob && ms.successText]}>
                  A password reset link has been sent to {email.trim()}. Open it to set a new password.
                </Text>
                <TouchableOpacity onPress={() => setResetSent(false)}>
                  {mob
                    ? <RivalIcon name="close" size={16} color={RivalWarm.soft} />
                    : <Text style={styles.successDismiss}>✕</Text>}
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={[styles.label, mob && rm.label]}>Email</Text>
              <TextInput
                style={[styles.input, mob && ms.input]}
                placeholder="name@example.com"
                placeholderTextColor={RivalColors.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, mob && rm.label]}>Password</Text>
              <View style={[styles.passwordRow, mob && ms.field]}>
                <TextInput
                  style={[styles.passwordInput, mob && ms.passwordInput]}
                  placeholder="Password"
                  placeholderTextColor={RivalColors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                  <RivalIcon name={showPassword ? 'eyeOff' : 'eye'} size={20} color={RivalColors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.rowBetween}>
              <TouchableOpacity style={styles.checkboxRow} onPress={() => setRememberMe(!rememberMe)}>
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked, mob && ms.checkbox, mob && rememberMe && ms.checkboxChecked]}>
                  {rememberMe && (mob
                    ? <RivalIcon name="check" size={14} color={RivalColors.onAccentFill} />
                    : <Text style={styles.checkmark}>✓</Text>)}
                </View>
                <Text style={[styles.checkboxLabel, mob && ms.soft]}>Remember me</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setError(''); setResetSent(false); handleForgotPassword(); }} disabled={resetLoading}>
                <BusyText busy={!!(resetLoading)} style={styles.forgotLink}>{resetLoading ? 'Sending…' : 'Forgot password?'}</BusyText>
              </TouchableOpacity>
            </View>

            <RivalButton
              busy={loading}
              label={loading ? 'Signing in…' : 'Sign in'}
              onPress={handleSignIn}
              disabled={loading}
              style={[styles.signInBtn, mob && ms.primary]}
              labelStyle={mob ? rm.primaryText : undefined}
            />

            <TouchableOpacity onPress={() => router.push('/sign-up')}>
              <Text style={[styles.link, mob && ms.soft]}>Don't have an account? <Text style={mob && ms.linkStrong}>Sign up</Text></Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    position: 'relative',
    backgroundColor: RivalColors.surfaceLowest,
  },
  // Same warm-smoke texture as the Today screen's Weekly Leader/Legacy
  // sections — low opacity, faded on both edges so it reads as ambient
  // atmosphere behind the logo/card rather than a cropped photo.
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
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    justifyContent: 'center',
  },
  back: {
    position: 'absolute',
    top: 16,
    left: 24,
  },
  backText: {
    color: RivalColors.textPrimary,
    fontSize: 16,
  },
  logo: {
    ...RivalType.titleMd,
    color: RivalColors.textPrimary,
    letterSpacing: 6,
    textAlign: 'center',
    marginBottom: 24,
  },
  card: {
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: RivalRadius.lg,
    padding: 24,
    gap: 16,
  },
  title: {
    ...RivalType.headlineLgMobile,
    color: RivalColors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  subtitle: {
    ...RivalType.bodyMd,
    color: RivalColors.textSecondary,
    marginTop: -8,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: RivalColors.errorContainer,
    borderRadius: RivalRadius.DEFAULT,
    padding: 12,
  },
  errorText: {
    color: RivalColors.error,
    fontSize: 14,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    ...RivalType.labelCaps,
    fontSize: 12,
    color: RivalColors.onSurfaceVariant,
  },
  input: {
    backgroundColor: RivalColors.surfaceBright,
    borderRadius: RivalRadius.DEFAULT,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: RivalColors.textPrimary,
    fontSize: 16,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RivalColors.surfaceBright,
    borderRadius: RivalRadius.DEFAULT,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: RivalColors.textPrimary,
    fontSize: 16,
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  eyeText: {
    fontSize: 18,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  forgotLink: {
    color: RivalColors.accentText,
    fontSize: 13,
    fontWeight: '600',
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: RivalColors.tertiaryContainer,
    borderRadius: RivalRadius.DEFAULT,
    padding: 12,
  },
  successText: {
    flex: 1,
    color: RivalColors.onTertiaryContainer,
    fontSize: 13,
    lineHeight: 19,
  },
  successDismiss: {
    color: RivalColors.onTertiaryContainer,
    fontSize: 14,
    fontWeight: '700',
    paddingTop: 1,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: RivalColors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: RivalColors.accentFill,
  },
  checkmark: {
    color: RivalColors.onAccentFill,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  checkboxLabel: {
    color: RivalColors.textSecondary,
    fontSize: 14,
  },
  signInBtn: {
    marginTop: 8,
  },
  link: {
    color: RivalColors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});

// Phone only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  bg: { backgroundColor: RivalWarm.page },
  card: { backgroundColor: RivalWarm.card, borderWidth: 1, borderColor: RivalWarm.cardBorder, borderRadius: 20, padding: 22 },
  title: { ...rm.serifTitle, textTransform: 'none', letterSpacing: 0, textAlign: 'center' } as any,
  subtitle: { color: RivalWarm.soft, marginTop: -10 },
  errorBox: { backgroundColor: 'rgba(255,143,143,0.08)', borderWidth: 1, borderColor: 'rgba(255,143,143,0.25)', borderRadius: 12 },
  errorText: { color: '#ff8f8f', fontSize: 13, lineHeight: 18 },
  successBox: { backgroundColor: 'rgba(255,209,190,0.08)', borderWidth: 1, borderColor: 'rgba(255,209,190,0.2)', borderRadius: 12, alignItems: 'center' },
  successText: { color: RivalWarm.soft },
  field: { backgroundColor: RivalWarm.field, borderRadius: 12, borderWidth: 1, borderColor: RivalWarm.cardBorder },
  input: { backgroundColor: RivalWarm.field, borderRadius: 12, borderWidth: 1, borderColor: RivalWarm.cardBorder, paddingVertical: 13, fontSize: 15, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  passwordInput: { paddingVertical: 13, fontSize: 15, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  checkbox: { borderWidth: 1.5, borderColor: 'rgba(255,209,190,0.4)', borderRadius: 6 },
  checkboxChecked: { borderColor: 'transparent', backgroundColor: RivalColors.accentFill },
  soft: { color: RivalWarm.soft },
  linkStrong: { color: RivalColors.accentText, fontWeight: '700' },
  primary: { ...rm.primary, borderWidth: 0, marginTop: 6 } as any,
});
