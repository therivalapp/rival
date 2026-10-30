import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { invalidateActivityCache } from '../../lib/fetchAllActivities';
import { formatActivityDistance } from '../../lib/units';
import { formatDurationClock } from '../../lib/format';
import { RivalColors, RivalGhost } from '../../constants/rivalTheme';
import { RivalIcon } from './RivalIcon';
import { GreyLabel, GreyNote, GreyPrimary, GreySheet } from './RivalGreySheet';

// An activity recorded on two devices (Ricky, 2026-10-28): which recordings
// it has, and the pop-up to choose the one shown. Both go through the
// activity-recordings edge function (design/two-devices-mockup.png).

type Recording = {
  id: string;
  source: string;
  watch: boolean;
  distanceMeters: number | null;
  durationSeconds: number | null;
  effort: number;
  shown: boolean;
  longer: boolean;
};

/** How many recordings a Strava activity has; 0 until known. */
export function useRecordingCount(activityId: string | null | undefined, provider: string | null | undefined) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!activityId || provider !== 'strava') return;
    let live = true;
    supabase.functions.invoke('activity-recordings', { body: { activityId, action: 'count' } })
      .then(({ data }) => { if (live && typeof data?.count === 'number') setCount(data.count); })
      .catch(() => {});
    return () => { live = false; };
  }, [activityId, provider]);
  return count;
}

export function RecordingsSheet({ activityId, activityType, title, onClose, onSwitched }: {
  activityId: string | null;
  activityType: string;
  title: string;
  onClose: () => void;
  onSwitched: () => void;
}) {
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRecordings(null); setError(null); setChosen(null);
    if (!activityId) return;
    let live = true;
    supabase.functions.invoke('activity-recordings', { body: { activityId, action: 'list' } }).then(({ data, error: err }) => {
      if (!live) return;
      if (err || data?.error) { setError(data?.error ?? "Couldn't load the recordings. Try again."); return; }
      const list: Recording[] = data?.recordings ?? [];
      setRecordings(list);
      setChosen(list.find((r) => r.shown)?.id ?? null);
    });
    return () => { live = false; };
  }, [activityId]);

  const shownId = recordings?.find((r) => r.shown)?.id ?? null;

  async function save() {
    if (!activityId || !chosen || chosen === shownId) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('activity-recordings', { body: { activityId, action: 'use', providerActivityId: chosen } });
    setSaving(false);
    if (err || !data?.ok) { setError(data?.error ?? "Couldn't switch recordings. Try again."); return; }
    invalidateActivityCache();
    onSwitched();
    onClose();
  }

  return (
    <Modal visible={!!activityId} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <GreySheet
          kicker="RECORDINGS"
          title={title}
          sub="Recorded on 2 devices"
          onClose={onClose}
          footer={<GreyPrimary label="Save" busy={saving} disabled={!chosen || chosen === shownId || saving} onPress={save} />}
        >
          <GreyLabel>SHOWN ON RIVAL</GreyLabel>
          {recordings === null && !error ? <GreyNote>Loading…</GreyNote> : null}
          <View style={st.options}>
            {(recordings ?? []).map((r) => {
              const on = r.id === chosen;
              const numbers = [
                r.distanceMeters ? formatActivityDistance(r.distanceMeters, activityType) : null,
                r.durationSeconds ? formatDurationClock(r.durationSeconds) : null,
                `Effort ${r.effort}`,
              ].filter(Boolean).join(' · ');
              return (
                <TouchableOpacity key={r.id} style={[st.option, on && st.optionOn]} onPress={() => setChosen(r.id)} activeOpacity={0.85} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <View style={[st.badge, on && st.badgeOn]}>
                    <RivalIcon name={r.watch ? 'watch' : 'run'} size={17} color={on ? RivalColors.surfaceLowest : 'rgba(255,255,255,0.6)'} />
                  </View>
                  <View style={st.body}>
                    <View style={st.head}>
                      <Text style={st.source} numberOfLines={1}>{r.source}</Text>
                      {r.longer ? <View style={st.longerTag}><Text style={st.longerText}>Longer</Text></View> : null}
                    </View>
                    <Text style={st.numbers}>{numbers}</Text>
                  </View>
                  <View style={[st.radio, on && st.radioOn]}>
                    {on ? <RivalIcon name="checkBold" size={13} color={RivalColors.surfaceLowest} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          {error ? <Text style={st.error}>{error}</Text> : null}
          <GreyNote>The longer recording is shown automatically. Effort, the team feed and standings follow the recording shown.</GreyNote>
        </GreySheet>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  options: { gap: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border, backgroundColor: RivalGhost.fill },
  optionOn: { borderColor: RivalGhost.borderOn, backgroundColor: RivalGhost.fillOn },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  badgeOn: { backgroundColor: RivalColors.accentText },
  body: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  source: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: '#fff' },
  longerTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(255,181,158,0.14)' },
  longerText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: RivalColors.accentText },
  numbers: { marginTop: 4, fontSize: 13.5, color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'] },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: RivalColors.accentText, backgroundColor: RivalColors.accentText },
  error: { marginTop: 10, fontSize: 13, color: RivalColors.danger },
});
