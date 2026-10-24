import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { formatDurationClock } from '../../lib/format';
import { formatActivityDistance } from '../../lib/units';
import { RivalColors, RivalFontFamily, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, activityIconName } from './RivalIcon';
import { RouteMap } from './RouteMap';

// The activity a "Short activity recorded" notification is about (Ricky,
// 2026-10-18): the card grows into it, so the decision to keep or remove is
// made looking at the activity rather than at its name alone.

export type ShortActivity = {
  id: string;
  name: string | null;
  type: string | null;
  startedAt: string;
  seconds: number;
  meters: number | null;
  effort: number;
  provider: string | null;
  polyline: string | null;
};

export async function loadShortActivities(ids: string[]): Promise<Record<string, ShortActivity>> {
  if (!ids.length) return {};
  const [{ data: rows }, { data: routes }] = await Promise.all([
    supabase.from('activities')
      .select('id, name, activity_type, started_at, duration_seconds, distance_meters, effort_score, provider')
      .in('id', ids),
    supabase.from('activity_routes').select('activity_id, polyline').in('activity_id', ids),
  ]);
  const routeFor = new Map((routes ?? []).map((r: any) => [r.activity_id, r.polyline as string]));
  const out: Record<string, ShortActivity> = {};
  (rows ?? []).forEach((a: any) => {
    out[a.id] = {
      id: a.id, name: a.name, type: a.activity_type, startedAt: a.started_at,
      seconds: a.duration_seconds || 0, meters: a.distance_meters, effort: Math.round(a.effort_score || 0),
      provider: a.provider, polyline: routeFor.get(a.id) ?? null,
    };
  });
  return out;
}

// "Run", "Weight training": Strava's CamelCase type as a short name.
export function typeName(type: string | null | undefined): string {
  if (!type) return 'Activity';
  if (type === 'WeightTraining') return 'Weights';
  if (/^[A-Z]{2,}$/.test(type) || type === 'CrossFit') return type;
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0) + words.slice(1).toLowerCase();
}

// "1 min 43 s", "45 s".
export function shortLength(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

/** The closed card's line: "Run · “4x4” · 1 min 43 s". */
export function shortActivityLine(a: ShortActivity): string {
  const name = a.name && a.name.trim() && a.name.trim() !== typeName(a.type) ? ` · “${a.name.trim()}”` : '';
  return `${typeName(a.type)}${name} · ${shortLength(a.seconds)}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  const day = new Date(iso); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86400000);
  const label = days <= 0 ? 'Today' : days === 1 ? 'Yesterday'
    : d.toLocaleDateString(undefined, days < 7 ? { weekday: 'long' }
      // The year whenever it isn't this one: an imported history reaches back.
      : d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${label}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

const SOURCE: Record<string, string> = { strava: 'Strava', garmin: 'Garmin' };

export function ShortActivityPreview({ a }: { a: ShortActivity }) {
  const distance = formatActivityDistance(a.meters, a.type);
  const source = a.provider ? SOURCE[a.provider.toLowerCase()] : null;
  return (
    <View style={s.wrap}>
      <View style={s.panel}>
        {a.polyline ? <RouteMap polyline={a.polyline} style={s.map} /> : null}
        <View style={s.head}>
          <View style={s.icon}><RivalIcon name={activityIconName(a.type)} size={15} color={RivalColors.accentText} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={1}>{a.name?.trim() || typeName(a.type)}</Text>
            <Text style={s.meta} numberOfLines={1}>{when(a.startedAt)}{source ? ` · From ${source}` : ''}</Text>
          </View>
        </View>
        <View style={s.stats}>
          <View style={s.stat}><Text style={s.value}>{formatDurationClock(a.seconds) || '0:00'}</Text><Text style={s.label}>Time</Text></View>
          {distance ? <View style={[s.stat, s.rule]}><Text style={s.value}>{distance}</Text><Text style={s.label}>Distance</Text></View> : null}
          <View style={[s.stat, s.rule]}><Text style={s.value}>+{a.effort.toLocaleString()}</Text><Text style={s.label}>Effort</Text></View>
        </View>
      </View>
      <Text style={s.why}>Activities under 3 minutes are often a watch started by mistake. Keep it if it was real.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12 },
  panel: { borderRadius: 14, backgroundColor: '#221d1b', overflow: 'hidden' },
  map: { aspectRatio: 3.4, borderRadius: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,131,95,0.18)' },
  name: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 19, lineHeight: 23, color: '#fff' },
  meta: { fontFamily: RivalFontFamily, fontSize: 11.5, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  stats: { flexDirection: 'row', paddingHorizontal: 6, paddingTop: 8, paddingBottom: 12 },
  stat: { flex: 1, alignItems: 'center' },
  rule: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,209,190,0.08)' },
  value: { fontFamily: RivalFontFamily, fontSize: 16, fontWeight: '800', color: '#fff' },
  label: { fontFamily: RivalFontFamily, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  why: { fontFamily: RivalFontFamily, fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.6)' },
});
