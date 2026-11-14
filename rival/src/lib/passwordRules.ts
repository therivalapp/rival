// Password rules (Mockup 54 v4, Ricky 2026-11-14), used everywhere a password
// is chosen: sign-up, Reset password and Settings. Each rule is shown with a
// tick that fills in as it is met. Supabase checks the same rules on its side
// (Authentication, Passwords: minimum 8, lowercase, uppercase, digits and
// symbols), so the symbols here are exactly Supabase's list.

export type PasswordRule = { label: string; met: boolean };

const SYMBOLS = /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/;

export function passwordRules(pw: string): PasswordRule[] {
  return [
    { label: 'At least 8 characters', met: pw.length >= 8 },
    { label: 'Upper and lowercase letters', met: /[A-Z]/.test(pw) && /[a-z]/.test(pw) },
    { label: 'A number', met: /[0-9]/.test(pw) },
    { label: 'A special character', met: SYMBOLS.test(pw) },
  ];
}

export function passwordOk(pw: string): boolean {
  return passwordRules(pw).every((r) => r.met);
}

export const PASSWORD_RULES_MESSAGE = 'Use at least 8 characters, with upper and lowercase letters, a number and a special character.';
