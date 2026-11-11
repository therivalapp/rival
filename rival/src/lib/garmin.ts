import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

// Garmin connection (2026-11-11). Connect asks garmin-connect for Garmin's
// sign-in address and opens it; Garmin returns through garmin-callback, which
// sends the member back to /garmin?garmin=connected (or failed/cancelled).
// On the web the page itself goes to Garmin and comes back; on iPhone it
// opens in an in-app browser session that closes on the rival:// return.

export type GarminStatus = { connected: boolean; connectedAt: string | null; lastActivityAt: string | null };

export async function garminStatus(): Promise<GarminStatus> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { connected: false, connectedAt: null, lastActivityAt: null };
  const { data } = await supabase.from('garmin_connections')
    .select('connected_at, last_activity_at').eq('user_id', user.id).maybeSingle();
  return { connected: !!data, connectedAt: data?.connected_at ?? null, lastActivityAt: data?.last_activity_at ?? null };
}

/** 'redirecting' on the web (the page is leaving for Garmin), otherwise the result. */
export async function connectGarmin(): Promise<'redirecting' | 'connected' | 'failed' | 'cancelled'> {
  const returnTo = Platform.OS === 'web' ? `${window.location.origin}/garmin` : Linking.createURL('garmin');
  const { data, error } = await supabase.functions.invoke('garmin-connect', { body: { returnTo } });
  if (error || !data?.url) return 'failed';
  if (Platform.OS === 'web') {
    window.location.href = data.url;
    return 'redirecting';
  }
  const res = await WebBrowser.openAuthSessionAsync(data.url, returnTo);
  if (res.type !== 'success') return 'cancelled';
  const result = Linking.parse(res.url).queryParams?.garmin;
  return result === 'connected' ? 'connected' : result === 'cancelled' ? 'cancelled' : 'failed';
}

export async function disconnectGarmin(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('garmin-disconnect', { body: {} });
  return !error && !!data?.ok;
}

/** "Last activity 2 h ago" style line for Settings. */
export function garminStatusLine(s: GarminStatus): string {
  if (!s.connected) return 'Activities from Garmin devices';
  if (!s.lastActivityAt) return 'Connected';
  const m = Math.round((Date.now() - new Date(s.lastActivityAt).getTime()) / 60000);
  const ago = m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago`
    : new Date(s.lastActivityAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `Connected · Last activity ${ago}`;
}
