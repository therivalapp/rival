import { supabase } from './supabase';

// Team Beta account approval (Mockup 30, 2026-11-11; supabase/account_approval.sql).
// A new account waits on /waiting-approval until it is approved from the email
// sent to hello@therivalapp.com (functions/approve-member).

let approvedFor: string | null = null;

/** Whether this account may use RIVAL. Remembered once true, so the gate costs
 *  one small read per visit. Errors count as approved: a network blip must
 *  never lock a member out (the server still guards the approval itself). */
export async function isApproved(userId: string): Promise<boolean> {
  if (approvedFor === userId) return true;
  const { data, error } = await supabase.from('users').select('approved_at').eq('id', userId).maybeSingle();
  if (error || !data) return true;
  if (data.approved_at) { approvedFor = userId; return true; }
  return false;
}

/** From the waiting page: emails the RIVAL team the first time, and reports
 *  whether the account has been approved since. */
export async function requestApproval(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('approve-member', { body: { action: 'request' } });
  if (error) return false;
  if (data?.approved) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) approvedFor = session.user.id;
    return true;
  }
  return false;
}

/** The email's Approve or Decline link, opened on /approve. */
export async function answerApproval(action: 'approve' | 'decline', userId: string, token: string):
  Promise<{ status?: 'approved' | 'declined' | 'already' | 'gone'; name?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('approve-member', { body: { action, user_id: userId, token } });
  if (error) {
    let message = 'This link could not be used. Try again.';
    try { const body = await (error as any).context?.json?.(); if (body?.error) message = body.error; } catch {}
    return { error: message };
  }
  return data ?? {};
}
