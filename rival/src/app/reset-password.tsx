import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, Platform, Image as RNImage, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Asset } from 'expo-asset';
import { RivalButton, RivalIcon, RivalWarm, rm } from '../components/rival';
import { RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function ResetPasswordScreen() {
  const { width } = useWindowDimensions();
  const mob = width < BREAKPOINT_WIDE_LAYOUT;
  const [status, setStatus] = useState<'verifying' | 'ready' | 'invalid'>('verifying');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      setStatus('invalid');
      return;
    }

    (async () => {
      // Supabase's recovery link appends tokens to the URL fragment (since we run with
      // detectSessionInUrl: false to avoid clashing with the Strava OAuth callback).
      const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        setStatus(error ? 'invalid' : 'ready');
        return;
      }

      // Fallback: PKCE-style `?code=` param.
      const queryParams = new URLSearchParams(window.location.search);
      const code = queryParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        setStatus(error ? 'invalid' : 'ready');
        return;
      }

      setStatus('invalid');
    })();
  }, []);

  async function handleSetNewPassword() {
    if (!newPassword || newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace('/home');
  }

  // Same photographic shell as sign-in and sign-up — this is the third screen
  // in that flow and was the last one still on the flat pre-Ember background.
  const bgUri = Platform.OS === 'web'
    ? Asset.fromModule(require('../../assets/images/backgrounds/optimized/ridge-runners-hazy-backlit.jpg')).uri
    : undefined;

  return (
    <View style={styles.bg}>
      {Platform.OS === 'web' ? (
        // @ts-ignore — intentional escape hatch to a real DOM element; RN Web's renderer is react-dom
        <img
          src={bgUri}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% center', display: 'block' }}
        />
      ) : (
        <RNImage
          source={require('../../assets/images/backgrounds/optimized/ridge-runners-hazy-backlit.jpg')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}
      <View style={[styles.scrim, mob && ms.scrim]} />
      <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={[styles.logo, mob && ms.logo]}>RIVAL</Text>

        {status === 'verifying' && (
          <Text style={[styles.status, mob && ms.status]}>Verifying reset link…</Text>
        )}

        {status === 'invalid' && (
          <View style={mob ? [styles.card, ms.card, ms.invalidCard] : styles.fragment}>
            {mob && <Text style={[styles.title, ms.title]}>Link expired</Text>}
            <Text style={[styles.status, mob && ms.status]}>
              This reset link is invalid or has expired. Request a new one from the sign-in screen.
            </Text>
            <TouchableOpacity
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))}
              style={mob && ms.ghost}
            >
              {mob ? (
                <>
                  <RivalIcon name="back" size={16} color={RivalColors.accentText} />
                  <Text style={rm.ghostText}>Back to sign in</Text>
                </>
              ) : (
                <Text style={styles.link}>← Back to sign in</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {status === 'ready' && (
          <View style={[styles.card, mob && ms.card]}>
            <Text style={[styles.title, mob && ms.title]}>Set a new password</Text>

            {error ? (
              <View style={[styles.errorBox, mob && ms.errorBox]}>
                <Text style={[styles.errorText, mob && ms.errorText]}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={[styles.label, mob && rm.label]}>New password</Text>
              <TextInput
                style={[styles.input, mob && ms.input]}
                placeholder="At least 6 characters"
                placeholderTextColor={RivalColors.textSecondary}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, mob && rm.label]}>Confirm password</Text>
              <TextInput
                style={[styles.input, mob && ms.input]}
                placeholder="Re-enter password"
                placeholderTextColor={RivalColors.textSecondary}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
            </View>

            <RivalButton
              busy={saving}
              label={saving ? 'Saving…' : 'Set new password'}
              onPress={handleSetNewPassword}
              disabled={saving}
              style={[styles.submitBtn, mob && ms.primary]}
              labelStyle={mob ? rm.primaryText : undefined}
            />
          </View>
        )}
      </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, position: 'relative', backgroundColor: RivalColors.surfaceLowest },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14,14,14,0.35)' },
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24, paddingHorizontal: 24 },
  // Keeps the desktop layout as it was: the message and link sit directly in
  // the column, spaced by its gap.
  fragment: { alignItems: 'center', gap: 24 },
  logo: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, letterSpacing: 6 },
  status: { fontSize: 16, color: RivalColors.textSecondary, textAlign: 'center', paddingHorizontal: 20 },
  link: { color: RivalColors.accentFill, fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: 'rgba(19,19,19,0.75)',
    borderRadius: RivalRadius.lg,
    padding: 24,
    gap: 16,
  },
  submitBtn: { marginTop: 8 },
  title: { fontSize: 24, fontWeight: '800', color: RivalColors.textPrimary, textAlign: 'center' },
  errorBox: { backgroundColor: RivalColors.errorContainer, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: RivalColors.error },
  errorText: { color: RivalColors.error, fontSize: 14 },
  inputGroup: { gap: 8 },
  label: { color: RivalColors.textPrimary, fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: RivalColors.surfaceLow, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: RivalColors.textPrimary, fontSize: 16, borderWidth: 1, borderColor: RivalColors.accentText,
  },
  primaryButton: { backgroundColor: RivalColors.accentFill, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  disabled: { opacity: 0.6 },
  primaryButtonText: { color: RivalColors.textPrimary, fontSize: 18, fontWeight: '700' },
});

// Phone only — the RIVAL look (see RivalMobile.tsx). Matches sign-in.tsx.
const ms = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(17,14,12,0.55)' },
  logo: { ...RivalType.titleMd, letterSpacing: 6 },
  status: { color: RivalWarm.soft, fontSize: 15, lineHeight: 22 },
  invalidCard: { alignItems: 'center' },
  ghost: { ...rm.ghost, paddingHorizontal: 20 } as any,
  card: { alignSelf: 'stretch', backgroundColor: 'rgba(29,23,20,0.94)', borderWidth: 1, borderColor: RivalWarm.cardBorder, borderRadius: 20, padding: 22 },
  title: rm.serifTitle,
  errorBox: { backgroundColor: 'rgba(255,143,143,0.08)', borderColor: 'rgba(255,143,143,0.25)', borderRadius: 12 },
  errorText: { color: '#ff8f8f', fontSize: 13, lineHeight: 18 },
  input: { backgroundColor: RivalWarm.field, borderColor: RivalWarm.cardBorder, paddingVertical: 13, fontSize: 15, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  primary: { ...rm.primary, borderWidth: 0, marginTop: 6 } as any,
});
