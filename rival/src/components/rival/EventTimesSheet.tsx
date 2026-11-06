import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { GreyLabel, GreyNote, GreyPrimary, GreyRow, GreyRowInput, GreyRows, GreySheet } from './RivalGreySheet';
import { ScanChoiceTiles } from './ScanChoiceTiles';
import { RivalColors } from '../../constants/rivalTheme';
import { supabase } from '../../lib/supabase';
import { pickScanFiles } from '../../lib/scanHandoff';
import { formatRaceName } from '../../lib/identity';
import { formatTime, parseTime, timeFieldProps } from '../../lib/time';
import { transitionKey, transitionTimes } from '../../lib/eventPage';
import { legDistance, legName } from '../../lib/eventLegs';
import { calculateEffortScore, loadScoringConfig } from '../../lib/effort';
import { activityIconName } from './RivalIcon';

// The times of an event (Ricky, 2026-11-05, design/event-transitions-mockup.png).
// 'finish' is Official finish time (column 3): Photo scan, the finish time,
// the leg total and transitions under it, then T1 and T2, both optional, the
// second filled in from the remaining time. 'edit' is Edit times (column 4):
// the official finish, then every leg and transition, with their total
// against the finish. Changing a leg changes that activity, so its pace and
// Effort follow. Every time is the time box (lib/time.ts).

export type TimesRace = {
  id: string;
  name: string;
  actual_finish_time: string | null;
  transitions?: (number | null)[] | null;
  disciplines?: { name?: string }[] | null;
};
export type TimesLeg = { id: string; activity_type: string; started_at: string; duration_seconds: number | null; distance_meters: number | null };
export type TimesSaved = {
  actual_finish_time: string | null;
  transitions: (number | null)[] | null;
  /** Legs whose time changed: their new seconds and Effort. */
  legs: Record<string, { duration_seconds: number; effort_score: number }>;
};

const field = (secs: number | null | undefined, kind: 'hms' | 'ms') => formatTime(secs ?? null, 'field', kind);
/** A transition's box: minutes and seconds, or hours when it ran that long. */
const gapKind = (secs: number | null | undefined): 'hms' | 'ms' => ((secs ?? 0) >= 6000 ? 'hms' : 'ms');

export function EventTimesSheet({ mode, race, legs, transitionGaps, showFinish = true, onClose, onSaved }: {
  mode: 'finish' | 'edit';
  race: TimesRace;
  /** The event's activities, in order. */
  legs: TimesLeg[];
  /** How many transitions the event has: legs less one for a triathlon, else 0. */
  transitionGaps: number;
  /** False for an event over several days, which has no one finish. */
  showFinish?: boolean;
  onClose: () => void;
  onSaved: (saved: TimesSaved) => void;
}) {
  const [finish, setFinish] = useState(field(parseTime(race.actual_finish_time, 'hours'), 'hms'));
  const [gaps, setGaps] = useState<string[]>(() => Array.from({ length: transitionGaps }, (_, i) => field(race.transitions?.[i], 'ms')));
  const [legTimes, setLegTimes] = useState<string[]>(() => legs.map((a) => field(a.duration_seconds, 'hms')));
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Gaps read as minutes:seconds ("02:48"), finish and legs as h:m:s.
  const finishSecs = parseTime(finish, 'hours');
  const gapSecs = gaps.map((g) => parseTime(g, 'minutes'));
  const legSecsEach = mode === 'edit' ? legTimes.map((t) => parseTime(t, 'hours')) : legs.map((a) => a.duration_seconds || null);
  const legTotal = legSecsEach.reduce<number>((t, x) => t + (x ?? 0), 0);
  const tt = useMemo(() => transitionTimes(gapSecs, transitionGaps, finishSecs, legTotal), [gapSecs.join(), transitionGaps, finishSecs, legTotal]);

  const setGap = (i: number, v: string) => setGaps((gs) => gs.map((g, k) => (k === i ? v : g)));
  const setLeg = (i: number, v: string) => setLegTimes((ls) => ls.map((l, k) => (k === i ? v : l)));

  /** "T1 · swim to bike". */
  const gapLabel = (i: number) => {
    const from = legs[i] ? legName(race, legs[i], i).toLowerCase() : '';
    const to = legs[i + 1] ? legName(race, legs[i + 1], i + 1).toLowerCase() : '';
    return from && to ? `${transitionKey(i)} · ${from} to ${to}` : transitionKey(i);
  };

  function gapRow(i: number) {
    const t = tt.list[i];
    const kind = gapKind(gapSecs[i] ?? t?.seconds);
    // A transition worked out from the remaining time shows in the box's
    // placeholder, so it is clearly not one that was typed.
    const filled = !gaps[i] && t?.filled ? field(t.seconds, kind) : undefined;
    return (
      <GreyRow key={`g${i}`} icon="swap" label={gapLabel(i)}>
        <GreyRowInput {...timeFieldProps(kind, gaps[i], (v) => setGap(i, v))} {...(filled ? { placeholder: filled } : {})} />
      </GreyRow>
    );
  }

  function scan(source: 'camera' | 'gallery') {
    if (Platform.OS !== 'web') { setError('Photo scan is not available here yet. Type the times instead.'); return; }
    pickScanFiles(source, async (files) => {
      setScanning(true);
      setError(null);
      setNote(null);
      try {
        const images = await Promise.all(files.slice(0, 4).map((f) => new Promise<{ base64Image: string; mediaType: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ base64Image: String(reader.result).split(',')[1], mediaType: f.type || 'image/jpeg' });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(f);
        })));
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/scan-placings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({ images, want: 'times', transitions: transitionGaps }),
        });
        const data = await res.json().catch(() => ({}));
        const times = data?.times as { finish?: number | null; transitions?: (number | null)[] } | undefined;
        if (!res.ok || !times || (!times.finish && !times.transitions?.some(Boolean))) {
          setError(data?.error || 'No times were found in the photo. Try a clearer photo, or type them in.');
          return;
        }
        if (times.finish) setFinish(field(times.finish, 'hms'));
        (times.transitions ?? []).forEach((v, i) => { if (v && i < transitionGaps) setGap(i, field(v, gapKind(v))); });
        setNote('Times read from the photo. Check them before saving.');
      } catch {
        setError('The results could not be read. Try again, or type them in.');
      } finally {
        setScanning(false);
      }
    });
  }

  const legChanged = legs.map((a, i) => mode === 'edit' && legSecsEach[i] != null && legSecsEach[i] !== (a.duration_seconds || null));
  const canSave = !saving && (mode === 'edit'
    ? legSecsEach.every((x) => x != null) && (!showFinish || !finish || finishSecs != null)
    : finishSecs != null);

  async function save() {
    setSaving(true);
    setError(null);
    // Only typed transitions are kept; one filled in from the remaining time
    // follows the finish if it changes later.
    const transitions = transitionGaps && gapSecs.some((x) => x != null) ? gapSecs : null;
    const actual = showFinish ? (finishSecs ? field(finishSecs, 'hms') : null) : race.actual_finish_time;
    const changedLegs: TimesSaved['legs'] = {};

    if (legChanged.some(Boolean)) {
      const ids = legs.filter((_, i) => legChanged[i]).map((a) => a.id);
      const [{ data: rows, error: readErr }, config] = await Promise.all([
        supabase.from('activities').select('id, activity_type, elevation_meters, distance_meters').in('id', ids),
        loadScoringConfig(),
      ]);
      if (readErr) { setSaving(false); setError(`Save failed: ${readErr.message}`); return; }
      for (const r of (rows ?? []) as { id: string; activity_type: string; elevation_meters: number | null; distance_meters: number | null }[]) {
        const secs = legSecsEach[legs.findIndex((a) => a.id === r.id)]!;
        // A new time is a new claim, so it scores as any edited activity does
        // in Manual entry: no longer confirmed.
        const effort = calculateEffortScore(r.activity_type, secs, r.elevation_meters ?? 0, config, r.distance_meters ?? 0, false);
        const { data: done, error: legErr } = await supabase.from('activities')
          .update({ duration_seconds: secs, effort_score: effort, raw_effort_score: effort, effort_confirmed: false })
          .eq('id', r.id).select('id');
        if (legErr || !done?.length) { setSaving(false); setError(`Save failed: ${legErr?.message ?? 'the activity could not be changed.'}`); return; }
        changedLegs[r.id] = { duration_seconds: secs, effort_score: effort };
      }
    }

    let { data, error: raceErr } = await supabase.from('races')
      .update({ actual_finish_time: actual, ...(transitionGaps ? { transitions } : {}) }).eq('id', race.id).select('id');
    // Until supabase/add_race_transitions.sql is run there is no column for
    // transitions; the finish still saves.
    if (raceErr && transitionGaps && /transitions/.test(raceErr.message)) {
      ({ data, error: raceErr } = await supabase.from('races').update({ actual_finish_time: actual }).eq('id', race.id).select('id'));
    }
    setSaving(false);
    if (raceErr || !data?.length) { setError(`Save failed: ${raceErr?.message ?? 'the event could not be changed.'}`); return; }
    onSaved({ actual_finish_time: actual, transitions, legs: changedLegs });
  }

  const total = legTotal + tt.list.reduce((t, x) => t + (x.seconds ?? 0), 0);
  const clock = (secs: number) => formatTime(secs, 'clock');

  return (
    <GreySheet
      kicker="EVENTS"
      title={mode === 'edit' ? 'Edit times' : transitionGaps ? 'Official finish time' : 'Finish time'}
      sub={formatRaceName(race.name)}
      onClose={onClose}
      footer={<GreyPrimary label={saving ? 'Saving…' : 'Save'} busy={saving} disabled={!canSave} onPress={save} />}
    >
      {mode === 'finish' ? (
        <>
          <GreyLabel>Photo scan</GreyLabel>
          <ScanChoiceTiles onPick={scan} compact />
          {scanning ? <GreyNote>Reading the photo…</GreyNote> : null}
          {note ? <GreyNote>{note}</GreyNote> : null}
          <GreyLabel>Manual entry</GreyLabel>
          <GreyRows>
            <GreyRow label="Finish time">
              <GreyRowInput {...timeFieldProps('hms', finish, setFinish)} autoFocus={!race.actual_finish_time} />
            </GreyRow>
          </GreyRows>
          {transitionGaps && legTotal > 0 ? (
            <Text style={s.note}>
              {'Leg total '}<Text style={s.b}>{clock(legTotal)}</Text>{'.'}
              {tt.total ? <>{' Transitions '}<Text style={s.b}>{clock(tt.total)}</Text>{'.'}</> : null}
            </Text>
          ) : null}
          {transitionGaps ? (
            <>
              <View style={s.labelRow}>
                <GreyLabel>Transitions</GreyLabel>
                <Text style={s.optional}>Optional</Text>
              </View>
              <GreyRows>{tt.list.map((_, i) => gapRow(i))}</GreyRows>
              {transitionGaps > 1 ? <Text style={s.note}>{`${transitionKey(transitionGaps - 1)} is filled in from the remaining time.`}</Text> : null}
            </>
          ) : null}
        </>
      ) : (
        <>
          {showFinish ? (
            <>
              <GreyLabel>Official finish</GreyLabel>
              <GreyRows>
                <GreyRow label="Finish time">
                  <GreyRowInput {...timeFieldProps('hms', finish, setFinish)} />
                </GreyRow>
              </GreyRows>
            </>
          ) : null}
          <GreyLabel>{transitionGaps ? 'Legs and transitions' : legs.length > 1 ? 'Activities' : 'Activity'}</GreyLabel>
          <GreyRows>
            {legs.flatMap((a, i) => {
              const d = legDistance(a);
              const row = (
                <GreyRow key={a.id} icon={activityIconName(a.activity_type)} label={`${legName(race, a, i)}${d ? ` · ${d.num} ${d.unit}` : ''}`}>
                  <GreyRowInput {...timeFieldProps('hms', legTimes[i], (v) => setLeg(i, v))} />
                </GreyRow>
              );
              return i < transitionGaps ? [row, gapRow(i)] : [row];
            })}
          </GreyRows>
          {showFinish && finishSecs && total > 0 ? (
            <Text style={s.note}>
              {'Total '}<Text style={s.b}>{clock(total)}</Text>
              {total === finishSecs ? ', matching the finish time.'
                : `, ${clock(Math.abs(total - finishSecs))} ${total > finishSecs ? 'more' : 'less'} than the finish time.`}
            </Text>
          ) : null}
          <Text style={[s.note, { marginTop: 2 }]}>{transitionGaps ? 'Changing a leg updates its pace and Effort.' : 'Changing a time updates its pace and Effort.'}</Text>
        </>
      )}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </GreySheet>
  );
}

const s = StyleSheet.create({
  note: { fontSize: 12, lineHeight: 17, color: RivalColors.textSecondary, marginTop: 8 },
  b: { color: '#fff', fontWeight: '700' },
  labelRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  optional: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText, marginBottom: 8 },
  error: { fontSize: 12.5, color: RivalColors.danger, marginTop: 10 },
});
