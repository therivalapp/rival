// An invite link (/join-league?code=ABC123) opened by someone who isn't signed
// in yet. The sign-in guard sends them to the welcome screen, which would lose
// the code, so it is kept on the device until they reach the join screen.

const KEY = 'rival_pending_invite';

export function savePendingInvite(code: string) {
  try { globalThis.localStorage?.setItem(KEY, code.trim().toUpperCase()); } catch {}
}

export function readPendingInvite(): string | null {
  try { return globalThis.localStorage?.getItem(KEY) || null; } catch { return null; }
}

export function clearPendingInvite() {
  try { globalThis.localStorage?.removeItem(KEY); } catch {}
}
