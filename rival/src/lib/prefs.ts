import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Personal settings that only ever matter to the person who set them: units,
// the daily quote, which notifications show, and muted teams. They live on the
// account itself (auth user metadata) rather than in a table, so nobody else
// can read them and no schema change is needed to add one.
//
// Read synchronously through getPrefs() — formatting helpers need the unit
// system without awaiting — and kept current from the session.

export type UnitSystem = 'metric' | 'imperial';

// Notification kinds a person can switch off. Questions that need an answer
// (join requests, tag confirmations, short-activity checks) are not here:
// turning those off would leave someone waiting on a reply that never comes.
export type NotifyKey = 'reaction' | 'comment' | 'team_joined' | 'tag_accepted';

export type Prefs = {
  units: UnitSystem;
  dailyQuote: boolean;
  notify: Record<NotifyKey, boolean>;
  mutedTeams: string[];
};

export const DEFAULT_PREFS: Prefs = {
  units: 'metric',
  dailyQuote: true,
  notify: { reaction: true, comment: true, team_joined: true, tag_accepted: true },
  mutedTeams: [],
};

const KEY = 'rival_prefs';

function normalise(raw: any): Prefs {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    units: p.units === 'imperial' ? 'imperial' : 'metric',
    dailyQuote: p.dailyQuote !== false,
    notify: { ...DEFAULT_PREFS.notify, ...(p.notify && typeof p.notify === 'object' ? p.notify : {}) },
    mutedTeams: Array.isArray(p.mutedTeams) ? p.mutedTeams.filter((x: unknown) => typeof x === 'string') : [],
  };
}

let current: Prefs = DEFAULT_PREFS;
const listeners = new Set<(p: Prefs) => void>();

function set(next: Prefs) {
  current = next;
  listeners.forEach((l) => { try { l(next); } catch { /* one bad listener must not stop the rest */ } });
}

export function prefsFromUser(user: { user_metadata?: any } | null | undefined): Prefs {
  return normalise(user?.user_metadata?.[KEY]);
}

// Kept in step with whoever is signed in.
supabase.auth.getSession().then(({ data: { session } }) => set(prefsFromUser(session?.user)));
supabase.auth.onAuthStateChange((_event, session) => set(prefsFromUser(session?.user)));

/** For caches that depend on a setting (the bell's count, unread chat). */
export function onPrefsChanged(listener: (p: Prefs) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getPrefs(): Prefs {
  return current;
}

export function usePrefs(): Prefs {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    setP(current);
    return () => { listeners.delete(setP); };
  }, []);
  return p;
}

/** Saves a change to the account. Applied locally at once, and rolled back if
 *  the save fails so the screen never shows a setting that didn't stick. */
export async function updatePrefs(patch: Partial<Prefs>): Promise<{ ok: boolean; error?: string }> {
  const before = current;
  const next = normalise({ ...current, ...patch, notify: { ...current.notify, ...(patch.notify ?? {}) } });
  set(next);
  const { error } = await supabase.auth.updateUser({ data: { [KEY]: next } });
  if (error) {
    set(before);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
