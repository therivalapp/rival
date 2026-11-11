import { useEffect, useState } from 'react';
import { supabase, getAuthUser } from './supabase';

// Report and block (Apple guideline 1.2, 2026-11-10, Mockup 27 v8).
//
// Blocks: who the signed-in member has blocked, from public.user_blocks
// (supabase/report_block.sql). Kept in memory and shared, so the feed, the
// team hub and chat all hide a blocked member's activities, comments and
// messages the moment the block is saved. Cleared when the account changes.
//
// Pop-ups: openReport() and openBlock() show the Report and Block pop-ups
// over the current page; SafetyHost, mounted once in _layout.tsx, listens.

let blocked: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;
const subscribers = new Set<(ids: Set<string>) => void>();
let owner: string | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  const id = session?.user?.id ?? null;
  if (id !== owner) {
    owner = id;
    blocked = null;
    loading = null;
    publish(new Set());
  }
});

function publish(ids: Set<string>) {
  subscribers.forEach((fn) => fn(ids));
}

/** The ids of members the signed-in member has blocked. */
export async function getBlockedIds(): Promise<Set<string>> {
  if (blocked) return blocked;
  if (loading) return loading;
  loading = (async () => {
    const { data: { user } } = await getAuthUser();
    if (!user) return new Set<string>();
    const { data, error } = await supabase.from('user_blocks').select('blocked_id').eq('blocker_id', user.id);
    // Before report_block.sql runs the table is missing; treat that as no blocks.
    const ids = new Set<string>(error ? [] : (data ?? []).map((r: { blocked_id: string }) => r.blocked_id));
    blocked = ids;
    loading = null;
    publish(ids);
    return ids;
  })();
  return loading;
}

/** The blocked ids, kept current; starts empty and fills once loaded. */
export function useBlockedIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => blocked ?? new Set());
  useEffect(() => {
    subscribers.add(setIds);
    getBlockedIds();
    return () => { subscribers.delete(setIds); };
  }, []);
  return ids;
}

/** Saves a block. Returns an error message, or null when it worked. */
export async function blockMember(userId: string): Promise<string | null> {
  const { data: { user } } = await getAuthUser();
  if (!user) return 'Sign in again and try once more.';
  const { error } = await supabase.from('user_blocks')
    .upsert({ blocker_id: user.id, blocked_id: userId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
  if (error) return 'The block could not be saved. Try again.';
  markBlocked(userId);
  return null;
}

/** Records a block saved elsewhere (the send-report function). */
export function markBlocked(userId: string) {
  const next = new Set(blocked ?? []);
  next.add(userId);
  blocked = next;
  publish(next);
}

/** Removes a block. Returns an error message, or null when it worked. */
export async function unblockMember(userId: string): Promise<string | null> {
  const { data: { user } } = await getAuthUser();
  if (!user) return 'Sign in again and try once more.';
  const { error, count } = await supabase.from('user_blocks')
    .delete({ count: 'exact' }).eq('blocker_id', user.id).eq('blocked_id', userId);
  if (error || !count) return 'The member could not be unblocked. Try again.';
  const next = new Set(blocked ?? []);
  next.delete(userId);
  blocked = next;
  publish(next);
  return null;
}

export type ReportTarget = {
  kind: 'activity' | 'message' | 'member';
  /** The activity or message id; not needed for a member. */
  targetId?: string;
  userId: string;
  name: string;
};
export type BlockTarget = { userId: string; name: string };

type Request = { type: 'report'; target: ReportTarget } | { type: 'block'; target: BlockTarget };
let listener: ((r: Request) => void) | null = null;

export function setSafetyListener(l: ((r: Request) => void) | null) {
  listener = l;
}

export function openReport(target: ReportTarget) {
  listener?.({ type: 'report', target });
}

export function openBlock(target: BlockTarget) {
  listener?.({ type: 'block', target });
}

/** The first word of a name, for "Block Sam". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
