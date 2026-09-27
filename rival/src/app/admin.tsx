import { useEffect, useState } from 'react';
import { RivalColors, RivalButtonColors } from '../constants/rivalTheme';
import { RivalIcon, RivalBackButton} from '../components/rival';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';

type ScoringRow = {
  activity_type: string;
  multiplier: number;
  // Effort per metre climbed. 0 for every sport where "elevation" isn't work
  // done under your own power — swimming (GPS bobbing), lift-served skiing,
  // and anything indoor/virtual.
  elevation_rate: number;
  editing: boolean;
  draft: string;
  elevDraft: string;
};

export default function AdminScreen() {
  const [rows, setRows] = useState<ScoringRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const [webhookBusy, setWebhookBusy] = useState(false);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { goToTab('/home'); return; }

    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!userData?.is_admin) { goToTab('/home'); return; }
    setIsAdmin(true);

    const { data } = await supabase
      .from('scoring_config')
      .select('activity_type, multiplier, elevation_rate')
      .order('activity_type');

    if (data) {
      setRows(data.map((r: any) => ({
        ...r,
        elevation_rate: Number(r.elevation_rate ?? 0),
        editing: false,
        draft: String(r.multiplier),
        elevDraft: String(r.elevation_rate ?? 0),
      })).sort((a: ScoringRow, b: ScoringRow) => b.multiplier - a.multiplier));
    }
    setLoading(false);
  }

  function startEdit(type: string) {
    setRows((prev) => prev.map((r) => r.activity_type === type ? { ...r, editing: true } : r));
  }

  function updateDraft(type: string, val: string) {
    setRows((prev) => prev.map((r) => r.activity_type === type ? { ...r, draft: val } : r));
  }

  function updateElevDraft(type: string, val: string) {
    setRows((prev) => prev.map((r) => r.activity_type === type ? { ...r, elevDraft: val } : r));
  }

  async function saveRow(type: string) {
    const row = rows.find((r) => r.activity_type === type);
    if (!row) return;
    const val = parseFloat(row.draft);
    if (isNaN(val) || val <= 0) return;
    // Elevation rate of exactly 0 is meaningful (most sports), so unlike the
    // multiplier it is only rejected for being unparseable or negative.
    const elev = row.elevDraft.trim() === '' ? 0 : parseFloat(row.elevDraft);
    if (isNaN(elev) || elev < 0) return;

    setSaving(type);
    const { error } = await supabase
      .from('scoring_config')
      .update({ multiplier: val, elevation_rate: elev })
      .eq('activity_type', type);

    if (error) {
      notify("Couldn't save that change", error.message);
    } else {
      setRows((prev) => prev.map((r) =>
        r.activity_type === type ? { ...r, multiplier: val, elevation_rate: elev, editing: false } : r
      ).sort((a, b) => b.multiplier - a.multiplier));
    }
    setSaving(null);
  }

  function cancelEdit(type: string) {
    setRows((prev) => prev.map((r) =>
      r.activity_type === type
        ? { ...r, editing: false, draft: String(r.multiplier), elevDraft: String(r.elevation_rate) }
        : r
    ));
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={RivalColors.accentFill} />
        </View>
      </SafeAreaView>
    );
  }

  // Strava only sends activity events while a push subscription is alive, and
  // drops it silently if the callback ever stops answering — which is exactly
  // what happened here (webhook-synced activities stop dead on 2026-08-04).
  // Nothing in the app surfaced that, so it looked like Strava sync was just
  // slow rather than off. This makes the state visible and repairable.
  async function callSubscription(action: 'status' | 'create') {
    setWebhookBusy(true);
    setWebhookStatus(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/strava-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWebhookStatus(`Error: ${data.error ?? data.message ?? res.status}${data.detail ? ` — ${JSON.stringify(data.detail).slice(0, 160)}` : ''}`);
      } else if (action === 'create') {
        setWebhookStatus(`Connected. Strava will now push new activities as they happen.`);
      } else if (data.subscribed) {
        const cb = data.subscriptions?.[0]?.callback_url ?? '';
        const matches = cb === data.expectedCallback;
        setWebhookStatus(matches
          ? `Live — Strava is pushing activities to RIVAL.`
          : `Subscription points at the wrong URL (${cb}). Tap Reconnect.`);
      } else {
        setWebhookStatus('Not connected — Strava is not pushing activities. Tap Reconnect.');
      }
    } catch (e) {
      setWebhookStatus(`Error: ${String(e)}`);
    }
    setWebhookBusy(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : goToTab('/home'))} color={RivalColors.accentFill} />
        </View>

        <Text style={styles.title}>Scoring Config</Text>
        <Text style={styles.subtitle}>
          Effort = minutes × multiplier + metres climbed × the elevation rate.
          Changes apply to new activities only. Tap a row to edit both.
        </Text>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, { flex: 1 }]}>Activity</Text>
            <Text style={[styles.tableHeaderText, { width: 150, textAlign: 'right' }]}>Per min · per m climbed</Text>
          </View>

          {rows.map((row) => (
            <View key={row.activity_type} style={styles.tableRow}>
              <Text style={styles.activityType}>{row.activity_type}</Text>

              {row.editing ? (
                <View style={styles.editCell}>
                  <TextInput
                    style={styles.multiplierInput}
                    value={row.draft}
                    onChangeText={(v) => updateDraft(row.activity_type, v)}
                    keyboardType="decimal-pad"
                    autoFocus
                    selectTextOnFocus
                  />
                  <TextInput
                    style={styles.multiplierInput}
                    value={row.elevDraft}
                    onChangeText={(v) => updateElevDraft(row.activity_type, v)}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                  <TouchableOpacity
                    onPress={() => saveRow(row.activity_type)}
                    style={styles.saveBtn}
                    disabled={saving === row.activity_type}
                  >
                    {saving === row.activity_type ? (
                      <ActivityIndicator size="small" color={RivalButtonColors.label(RivalColors.textPrimary) } />
                    ) : (
                      <RivalIcon name="check" size={16} color={RivalButtonColors.label(RivalColors.textPrimary) } />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => cancelEdit(row.activity_type)} style={styles.cancelBtn}>
                    <RivalIcon name="close" size={18} color={RivalColors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ) : (
                // Deleting a row doesn't remove the sport — it silently drops it
                // to DEFAULT_MULTIPLIER, so the activity keeps scoring at a
                // number nobody chose. Same half-a-job problem as the old Add
                // form. Tap to edit; there's no way to un-price a sport.
                <TouchableOpacity onPress={() => startEdit(row.activity_type)} style={styles.multiplierCell}>
                  <Text style={styles.multiplierValue}>×{row.multiplier}</Text>
                  {/* A dash rather than "0" — for most sports elevation is
                      deliberately not credited, and "0" reads like a value
                      someone forgot to fill in. */}
                  <Text style={styles.elevValue}>
                    {row.elevation_rate > 0 ? `+${row.elevation_rate}/m` : '—'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        {/* The "Add Activity Type" form used to live here. Removed on purpose:
            a scoring_config row is only ONE of the ten places a new sport has
            to be registered (selectable type lists in manual entry and both
            scan screens, the class-duration hint set, the icon map, the
            plan/stats/team-hub buckets, GYM_TYPES, the insight phrasing, and
            the client fallback table). Adding the row alone created a
            correctly-priced sport that nobody could ever select — the form
            looked like it did the job and silently did a tenth of it. */}
        <Text style={styles.addHint}>
          Adding a new sport takes a code change, not just a row here — it has to be
          selectable in manual entry and the scan screens too. Ask Claude to add it.
        </Text>

        <Text style={styles.sectionTitle}>Strava Background Sync</Text>
        <Text style={styles.webhookHelp}>
          When this is live, activities land in RIVAL the moment they're posted to
          Strava — no one has to open the app first.
        </Text>
        <View style={styles.webhookRow}>
          <TouchableOpacity style={styles.webhookBtn} onPress={() => callSubscription('status')} disabled={webhookBusy}>
            <BusyText busy={!!(webhookBusy)} style={styles.webhookBtnText}>{webhookBusy ? '…' : 'Check status'}</BusyText>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.webhookBtn, styles.webhookBtnPrimary]} onPress={() => callSubscription('create')} disabled={webhookBusy}>
            <BusyText busy={!!(webhookBusy)} style={[styles.webhookBtnText, styles.webhookBtnPrimaryText]}>{webhookBusy ? '…' : 'Reconnect'}</BusyText>
          </TouchableOpacity>
        </View>
        {webhookStatus && <Text style={styles.webhookStatus}>{webhookStatus}</Text>}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: RivalColors.surfaceLow,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 24,
  },
  elevValue: { fontSize: 11, color: RivalColors.textSecondary, textAlign: 'right', marginTop: 2 },
  webhookHelp: { fontSize: 13, color: RivalColors.textSecondary, lineHeight: 18, marginBottom: 12 },
  webhookRow: { flexDirection: 'row', gap: 10 },
  webhookBtn: {
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999,
    borderWidth: 1.5, borderColor: RivalColors.surfaceContainerHigh,
  },
  webhookBtnPrimary: { borderColor: RivalColors.accentFill },
  webhookBtnText: { color: RivalColors.textSecondary, fontSize: 14, fontWeight: '700' },
  webhookBtnPrimaryText: { color: RivalColors.accentText },
  webhookStatus: { marginTop: 12, fontSize: 13, lineHeight: 19, color: RivalColors.textPrimary },
  back: {
    color: RivalColors.accentFill,
    fontSize: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: RivalColors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: RivalColors.textSecondary,
    marginBottom: 28,
    lineHeight: 18,
  },
  table: {
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: RivalColors.accentText,
    backgroundColor: RivalColors.surfaceLow,
  },
  tableHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: RivalColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#3d1a6e',
  },
  activityType: {
    flex: 1,
    fontSize: 15,
    color: RivalColors.textPrimary,
    fontWeight: '500',
  },
  multiplierCell: {
    width: 100,
    alignItems: 'flex-end',
  },
  multiplierValue: {
    fontSize: 15,
    fontWeight: '700',
    color: RivalColors.accentFill,
  },
  editCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  multiplierInput: {
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: RivalColors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: RivalColors.accentFill,
    width: 64,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 36,
    minHeight: 30,
  },
  cancelBtn: {
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: RivalColors.textPrimary,
    marginTop: 28,
    marginBottom: 8,
  },
  addHint: {
    color: RivalColors.textSecondary,
    fontSize: 12,
    marginTop: 8,
    lineHeight: 17,
  },
});
