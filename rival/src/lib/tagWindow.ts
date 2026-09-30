// How recent a session has to be before you can say who else was on it.
//
// Its own module, with no Supabase import, so it can be unit tested — anything
// that reaches the client pulls in react-native, which the test runner cannot
// parse. Same reason dayRollup.ts sits apart from the screen that uses it.

// Matches the interval in the insert policy in
// supabase/add_activity_sharing.sql. The policy is what actually holds; this
// copy only lets the UI avoid offering an option it knows will be refused.
export const TAG_WINDOW_HOURS = 48;

// A range, not a maximum. A watch with a wrong clock can land an activity
// slightly in the future, and "not yet happened" should not read as eligible.
export function withinTagWindow(startedAt: string): boolean {
  const age = Date.now() - new Date(startedAt).getTime();
  return age >= 0 && age < TAG_WINDOW_HOURS * 60 * 60 * 1000;
}
