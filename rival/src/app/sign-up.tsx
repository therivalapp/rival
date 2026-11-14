import { useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, Image, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { finishSignUp } from '../lib/finishSignUp';
import { displayToIsoDate, maskDateInput } from '../lib/dateFormat';
import { passwordOk } from '../lib/passwordRules';
import { minimumAge } from '../lib/minimumAge';
import { PasswordRules, PasswordsMatch } from '../components/rival/PasswordRules';
import { RivalButton, RivalIcon, RivalBackButton, RivalWarm, rm } from '../components/rival';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { RivalColors, RivalGhost, RivalRadius, RivalSerifFamily, RivalType, rivalWordmark } from '../constants/rivalTheme';

const SMOKE_SOURCE = require('../../assets/images/backgrounds/optimized/podium-smoke.jpg');
// Supabase's email code length (Authentication, Providers, Email).
const CODE_LENGTH = 6;


export default function SignUpScreen() {
  const { width } = useWindowDimensions();
  const mob = width < BREAKPOINT_WIDE_LAYOUT;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  // Off until ticked (Mockup 34): teams see the day and month only.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwFocused, setPwFocused] = useState(false);
  // After Create account with email confirmation on, the whole page becomes
  // Confirm email, with a 6-digit code (Mockup 54 v4, 2026-11-14).
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeNote, setCodeNote] = useState('');
  const [verifying, setVerifying] = useState(false);
  const codeInput = useRef<TextInput>(null);

  const matches = confirm.length > 0 && confirm === password;
  const ready = passwordOk(password) && matches;

  async function handleSignUp() {
    if (!ready) return;
    if (!firstName.trim() || !lastName.trim() || !dob.trim() || !email || !password) {
      setError('Complete all fields.');
      return;
    }

    const dobIso = displayToIsoDate(dob.trim());
    if (!dobIso) {
      setError('Enter a date of birth as DD/MM/YYYY.');
      return;
    }
    // The terms and privacy policy say RIVAL is for people aged 13 and over,
    // and that sign-up checks it (2026-11-09).
    const [by, bm, bd] = dobIso.split('-').map(Number);
    const today = new Date();
    const age = today.getFullYear() - by
      - (today.getMonth() + 1 < bm || (today.getMonth() + 1 === bm && today.getDate() < bd) ? 1 : 0);
    if (age < 0) {
      setError('Enter a date of birth in the past.');
      return;
    }
    // 16 in Australia (lib/minimumAge.ts).
    const minAge = minimumAge();
    if (age < minAge) {
      setError(minAge === 16 ? 'RIVAL is for people aged 16 and over in Australia.' : 'RIVAL is for people aged 13 and over.');
      return;
    }

    setLoading(true);
    setError('');

    const displayName = `${firstName.trim()} ${lastName.trim()}`;

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Date of birth and needs_setup ride along with the account, so they
        // survive email confirmation; lib/finishSignUp.ts saves the date of
        // birth and opens setup on the first signed-in moment.
        data: { display_name: displayName, date_of_birth: dobIso, needs_setup: true }
      }
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // With email confirmation switched on there is no session yet: the page
    // becomes Confirm email and the code from the email signs them in.
    if (!data.session) {
      setLoading(false);
      setCode('');
      setCodeError('');
      setCodeNote('');
      setStep('code');
      return;
    }

    // Signed in straight away (confirmation off): save the date of birth now.
    // A new account picks its activities, then the introduction, not an empty Home.
    await finishSignUp();
    router.replace('/welcome-rival');
  }

  async function verify(token: string) {
    if (token.length < CODE_LENGTH || verifying) return;
    setVerifying(true);
    setCodeError('');
    setCodeNote('');
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    if (error) {
      setVerifying(false);
      setCodeError(/expired|invalid/i.test(error.message) ? 'That code is not right or has expired. Check the email or resend the code.' : error.message);
      return;
    }
    await finishSignUp();
    router.replace('/welcome-rival');
  }

  async function resend() {
    setCodeError('');
    setCodeNote('');
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    if (error) setCodeError(error.message);
    else setCodeNote('A new code was sent.');
  }

  function typeCode(v: string) {
    // Typing, pasting the whole code, or the iPhone's code suggestion.
    const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    setCodeError('');
    if (digits.length === CODE_LENGTH) verify(digits);
  }

  if (step === 'code') {
    return (
      <View style={[styles.bg, mob && ms.bg]}>
        <Image source={SMOKE_SOURCE} style={styles.smoke} resizeMode="cover" />
        <Image source={SMOKE_SOURCE} style={styles.smokeTop} resizeMode="cover" />
        <SafeAreaView style={styles.container}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={cs.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.logo}>RIVAL</Text>
            <View style={cs.mail}>
              <RivalIcon name="mailUnread" size={38} color={RivalColors.accentText} />
            </View>
            <Text style={[ms.title, cs.title]}>Confirm email</Text>
            <Text style={cs.body}>
              A {CODE_LENGTH}-digit code was sent to{'\n'}<Text style={cs.bodyStrong}>{email.trim()}</Text>.
            </Text>

            <TouchableOpacity activeOpacity={1} onPress={() => codeInput.current?.focus()} style={cs.boxes}>
              {Array.from({ length: CODE_LENGTH }, (_, i) => (
                <View key={i} style={[cs.box, (i === Math.min(code.length, CODE_LENGTH - 1)) && cs.boxOn]}>
                  <Text style={cs.digit}>{code[i] ?? ''}</Text>
                </View>
              ))}
              {/* One hidden box behind the six: it takes typing, a paste and
                  the iPhone's "From Mail" code suggestion. */}
              <TextInput
                ref={codeInput}
                value={code}
                onChangeText={typeCode}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={CODE_LENGTH}
                autoFocus
                caretHidden
                style={cs.hidden}
              />
            </TouchableOpacity>

            {codeError ? <Text style={cs.error}>{codeError}</Text> : null}
            {codeNote ? <Text style={cs.note}>{codeNote}</Text> : null}

            <RivalButton
              busy={verifying}
              label={verifying ? 'Confirming…' : 'Confirm'}
              onPress={() => verify(code)}
              disabled={verifying || code.length < CODE_LENGTH}
              style={[ms.primary, cs.confirm, code.length < CODE_LENGTH && cs.off]}
              labelStyle={rm.primaryText}
            />
            <TouchableOpacity onPress={resend} style={cs.linkTap}>
              <Text style={cs.link}>Resend code</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setStep('form'); setCode(''); }} style={cs.linkTapTight}>
              <Text style={cs.link}>Use a different email</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.bg, mob && ms.bg]}>
      {/* The smoke keeps its own warm tone on the grey page (Ricky, 2026-11-09). */}
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
            {mob && (
              <View style={ms.head}>
                <Text style={ms.title}>Create account</Text>
                <Text style={ms.subtitle}>Find your Rivals. Get better together.</Text>
              </View>
            )}

            {error ? (
              <View style={[styles.errorBox, mob && ms.errorBox]}>
                <Text style={[styles.errorText, mob && ms.errorText]}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.nameRow}>
              <View style={[styles.inputGroup, styles.nameField]}>
                <Text style={[styles.label, mob && rm.label, mob && ms.label]}>First name</Text>
                <TextInput
                  style={[styles.input, mob && ms.input]}
                  placeholder="First name"
                  placeholderTextColor={RivalColors.textSecondary}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
              </View>
              <View style={[styles.inputGroup, styles.nameField]}>
                <Text style={[styles.label, mob && rm.label, mob && ms.label]}>Last name</Text>
                <TextInput
                  style={[styles.input, mob && ms.input]}
                  placeholder="Last name"
                  placeholderTextColor={RivalColors.textSecondary}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, mob && rm.label, mob && ms.label]}>Date of birth</Text>
              <TextInput
                style={[styles.input, mob && ms.input]}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={RivalColors.textSecondary}
                value={dob}
                onChangeText={(v) => setDob(maskDateInput(v))}
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, mob && rm.label, mob && ms.label]}>Email</Text>
              <TextInput
                style={[styles.input, mob && ms.input]}
                placeholder="name@example.com"
                placeholderTextColor={RivalColors.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, mob && rm.label, mob && ms.label]}>Password</Text>
              <View style={[styles.passwordRow, mob && ms.field]}>
                <TextInput
                  style={[styles.passwordInput, mob && ms.passwordInput]}
                  placeholder="Password"
                  placeholderTextColor={RivalColors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPwFocused(true)}
                  onBlur={() => setPwFocused(false)}
                  secureTextEntry={!showPassword}
                  textContentType="newPassword"
                  autoComplete="new-password"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                  <RivalIcon name={showPassword ? 'eyeOff' : 'eye'} size={20} color={RivalColors.textSecondary} />
                </TouchableOpacity>
              </View>
              <PasswordRules password={password} focused={pwFocused} />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, mob && rm.label, mob && ms.label]}>Confirm password</Text>
              <TextInput
                style={[styles.input, mob && ms.input]}
                placeholder="Confirm password"
                placeholderTextColor={RivalColors.textSecondary}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry={!showPassword}
                textContentType="newPassword"
                autoComplete="new-password"
              />
              <PasswordsMatch password={password} confirm={confirm} />
            </View>

            <RivalButton
              busy={loading}
              label={loading ? 'Creating account…' : 'Create account'}
              onPress={handleSignUp}
              disabled={loading || !ready}
              style={[styles.submitBtn, mob && ms.primary, !ready && cs.off]}
              labelStyle={mob ? rm.primaryText : undefined}
            />

            {/* Agreeing to the terms (2026-11-09): shown before the account is
                made, with both documents one tap away. */}
            <Text style={[styles.link, styles.agree, mob && ms.soft]}>
              By creating an account, you agree to the{' '}
              <Text style={[styles.agreeLink, mob && ms.linkStrong]} onPress={() => router.push('/terms')} accessibilityRole="link">Terms{'\u00a0'}of{'\u00a0'}use</Text>
              {' '}and{' '}
              <Text style={[styles.agreeLink, mob && ms.linkStrong]} onPress={() => router.push('/privacy')} accessibilityRole="link">Privacy{'\u00a0'}policy</Text>.
            </Text>

            <TouchableOpacity onPress={() => router.push('/sign-in')}>
              <Text style={[styles.link, mob && ms.soft]}>Already have an account? <Text style={mob && ms.linkStrong}>Sign in</Text></Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// Deliberately mirrors sign-in.tsx. The two screens sit either side of one
// decision, and sign-up had never been brought onto Refined Ember — it was
// still flat #111111 with the pre-Ember magenta and lime, so creating an
// account looked like a different product from signing in to one.
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
    ...rivalWordmark(20),
    color: RivalColors.textPrimary,
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
  },
  subtitle: {
    ...RivalType.bodyMd,
    color: RivalColors.textSecondary,
    marginTop: -8,
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
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameField: {
    flex: 1,
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
    paddingVertical: 12,
  },
  submitBtn: {
    marginTop: 8,
  },
  link: {
    color: RivalColors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  agree: { fontSize: 12, lineHeight: 17, marginTop: 12, paddingHorizontal: 12 },
  agreeLink: { color: RivalColors.accentText, fontWeight: '700' },
});

// Phone only — the RIVAL look (see RivalMobile.tsx). Matches sign-in.tsx.
const ms = StyleSheet.create({
  // The grey look (Ricky, 2026-11-09): the old brown page and card are
  // retired. The form sits straight on the grey page, fields in ghost style.
  bg: { backgroundColor: RivalGhost.ground },
  card: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'transparent', borderRadius: 20, padding: 22 },
  label: { color: RivalColors.textSecondary },
  head: { gap: 4, alignItems: 'center', marginBottom: 2 },
  title: { ...rm.serifTitle, textAlign: 'center' } as any,
  subtitle: { fontSize: 14, color: RivalWarm.soft, textAlign: 'center' },
  errorBox: { backgroundColor: 'rgba(255,143,143,0.08)', borderWidth: 1, borderColor: 'rgba(255,143,143,0.25)', borderRadius: 12 },
  errorText: { color: '#ff8f8f', fontSize: 13, lineHeight: 18 },
  field: { backgroundColor: RivalGhost.fill, borderRadius: 12, borderWidth: 1, borderColor: RivalGhost.border },
  input: { backgroundColor: RivalGhost.fill, borderRadius: 12, borderWidth: 1, borderColor: RivalGhost.border, paddingVertical: 13, paddingHorizontal: 14, fontSize: 15, minWidth: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  passwordInput: { paddingVertical: 13, paddingHorizontal: 14, fontSize: 15, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  soft: { color: RivalWarm.soft },
  linkStrong: { color: RivalColors.accentText, fontWeight: '700' },
  primary: { ...rm.primary, borderWidth: 0, marginTop: 6 } as any,
});

// The birthday choice under Date of birth (Mockup 34, 2026-11-11).

// Password rules and the Confirm email page (Mockup 54 v4, 2026-11-14).
const cs = StyleSheet.create({
  off: { opacity: 0.4 },
  content: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 16, paddingBottom: 24 },
  mail: {
    width: 76, height: 76, borderRadius: 22, alignSelf: 'center', marginTop: 4,
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)', backgroundColor: 'rgba(255,209,190,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { marginTop: 22 },
  body: { fontSize: 13.5, lineHeight: 20, color: 'rgba(255,255,255,0.72)', textAlign: 'center', marginTop: 10 },
  bodyStrong: { color: '#fff', fontWeight: '700' },
  boxes: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 24, position: 'relative' },
  box: {
    width: 42, height: 52, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)',
    backgroundColor: 'rgba(255,209,190,0.05)', alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { borderColor: RivalColors.accentText },
  digit: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 24, color: '#fff' },
  // Covers the six boxes so a tap or long-press (Paste) lands on it, but
  // shows nothing of its own.
  hidden: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.011, color: 'transparent', fontSize: 1 },
  error: { fontSize: 13, lineHeight: 18, color: '#ff8f8f', textAlign: 'center', marginTop: 14 },
  note: { fontSize: 13, lineHeight: 18, color: RivalWarm.soft, textAlign: 'center', marginTop: 14 },
  confirm: { marginTop: 22 },
  linkTap: { marginTop: 18, alignSelf: 'center', paddingVertical: 4 },
  linkTapTight: { marginTop: 8, alignSelf: 'center', paddingVertical: 4 },
  link: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
});
