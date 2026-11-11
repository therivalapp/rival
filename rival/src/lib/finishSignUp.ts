import { supabase } from './supabase';

// Finishes a new account on its first signed-in moment (2026-11-10), so sign-up
// works the same with Supabase's "Confirm email" on or off.
//
// With confirmation on, sign-up returns no session: nothing can be written to
// the account until the member clicks the email link and signs in. So sign-up
// keeps the date of birth in the account's details along with needs_setup,
// and the first signed-in screen (sign-up itself when there is a session, the
// welcome page after the email link, or sign-in) calls this. It saves the date
// of birth, clears both details, and returns true so the caller opens
// activity setup instead of Home.

export async function finishSignUp(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  const meta = user?.user_metadata ?? {};
  if (!user || !meta.needs_setup) return false;

  if (typeof meta.date_of_birth === 'string') {
    const { error } = await supabase
      .from('users')
      .update({ date_of_birth: meta.date_of_birth })
      // No date_of_birth filter: the app may write that column but not read
      // it (lock_down_user_email.sql), and a filter on it is a read.
      .eq('id', user.id);
    if (error) {
      // Kept for the next sign-in to try again; setup still opens now.
      console.warn('Date of birth not saved:', error.message);
      return true;
    }
  }
  const { error: clearError } = await supabase.auth.updateUser({ data: { needs_setup: null, date_of_birth: null } });
  if (clearError) console.warn('Sign-up details not cleared:', clearError.message);
  return true;
}
