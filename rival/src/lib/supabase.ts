import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dataChanged, type DataArea } from './dataEvents';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const getStorage = () => {
  if (Platform.OS !== 'web') return AsyncStorage;
  if (typeof window === 'undefined') return undefined;
  return {
    getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
    setItem: (key: string, value: string) => Promise.resolve(localStorage.setItem(key, value)),
    removeItem: (key: string) => Promise.resolve(localStorage.removeItem(key)),
  };
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Any write to activity or team data, from anywhere in the app, tells the
// in-memory caches (lib/fetchAllActivities.ts, lib/myTeams.ts) that what they
// hold is out of date. Done here, once, so a new screen that edits data can't
// forget to. Database functions count too: accepting a training-partner tag
// creates an activity, and leaving or deleting a team changes memberships.
const AREA_BY_TABLE: Record<string, DataArea> = {
  activities: 'activities',
  activity_media: 'activities',
  activity_participants: 'activities',
  league_members: 'teams',
  leagues: 'teams',
};
const WRITES = ['insert', 'update', 'upsert', 'delete'] as const;
const baseFrom = supabase.from.bind(supabase);
(supabase as any).from = (table: string) => {
  const builder: any = baseFrom(table);
  const area = AREA_BY_TABLE[table];
  if (area) {
    for (const m of WRITES) {
      const original = builder[m].bind(builder);
      builder[m] = (...args: any[]) => { dataChanged(area); return original(...args); };
    }
  }
  return builder;
};
const baseRpc = supabase.rpc.bind(supabase);
// Functions that only read: calling them must not throw away the caches.
// weekly_wins writes only its own record, which no cache holds.
const READ_ONLY_RPCS = new Set(['my_strava_sharing', 'lookup_league_by_invite_code', 'weekly_wins']);
(supabase as any).rpc = (...args: any[]) => {
  if (!READ_ONLY_RPCS.has(args[0])) {
    dataChanged('activities');
    dataChanged('teams');
  }
  return (baseRpc as any)(...args);
};

// The signed-in user, read from the session already stored on the device.
//
// supabase.auth.getUser() makes a network round trip to the auth server to
// re-validate the token, and nearly every screen called it FIRST, before any
// of its own queries could start — so every page paid one extra full round
// trip before loading anything. The session is already here: the database
// still checks the token on every query (RLS), so the client only needs the
// id to know whose data to ask for. getSession() also refreshes an expired
// token itself, so this stays correct across long sessions.
//
// Same { data: { user } } shape as getUser(), so call sites swap one-for-one.
export async function getAuthUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return { data: { user: session?.user ?? null } };
}
