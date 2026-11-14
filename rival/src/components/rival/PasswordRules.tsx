// The password rules with ticks that fill in as each is met (Mockup 54 v4,
// 2026-11-14). Used everywhere a password is chosen: sign-up, Reset password
// and Settings. The rules themselves live in lib/passwordRules.ts.

import { StyleSheet, Text, View } from 'react-native';
import { RivalColors } from '../../constants/rivalTheme';
import { passwordOk, passwordRules } from '../../lib/passwordRules';
import { RivalIcon } from './RivalIcon';

export function PasswordRule({ label, met }: { label: string; met: boolean }) {
  return (
    <View style={s.rule}>
      <RivalIcon name={met ? 'checkCircle' : 'radioOff'} size={15} color={met ? RivalColors.accentText : 'rgba(255,255,255,0.3)'} />
      <Text style={[s.text, met && s.met]}>{label}</Text>
    </View>
  );
}

/** The rules for `password`. Once every rule is met they fold away when the
 *  password box is left, so the confirm box sits right under it (Ricky,
 *  2026-11-14). */
export function PasswordRules({ password, focused }: { password: string; focused: boolean }) {
  if (!focused && passwordOk(password)) return null;
  return (
    <View style={s.list}>
      {passwordRules(password).map((r) => <PasswordRule key={r.label} label={r.label} met={r.met} />)}
    </View>
  );
}

/** "Passwords match", shown once the confirm box matches. */
export function PasswordsMatch({ password, confirm }: { password: string; confirm: string }) {
  if (!confirm || confirm !== password) return null;
  return <View style={s.list}><PasswordRule label="Passwords match" met /></View>;
}

const s = StyleSheet.create({
  list: { gap: 5, marginTop: 2 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  text: { fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  met: { color: 'rgba(255,255,255,0.85)' },
});
