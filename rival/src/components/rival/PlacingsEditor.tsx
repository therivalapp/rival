import { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GreyLabel, GreyNote, GreyPrimary, GreySheet } from './RivalGreySheet';
import { RivalIcon } from './RivalIcon';
import { ScanChoiceTiles } from './ScanChoiceTiles';
import { BusyText } from './BusyText';
import { RivalColors, RivalGhost } from '../../constants/rivalTheme';
import { supabase } from '../../lib/supabase';
import { pickScanFiles } from '../../lib/scanHandoff';
import { HYROX_STATIONS } from '../../lib/activityStats';
import { cleanPlacings, type PlacingRow, type Placings } from '../../lib/eventPage';

// Adding placings to an event (Ricky, 2026-11-04, design/event-placings-mockup.png,
// column 4): Photo scan with Take photo and Upload, the same tiles and words as
// Add an activity, then Manual entry: division, overall and age group, each
// place "of" the field, more categories if wanted, and a rank for each HYROX
// station or each event of a multi-day event. Every row is optional.

type Draft = { key: string; category: string; place: string; of: string };

const BASE: { key: string; label: string; hint: string }[] = [
  { key: 'division', label: 'Division', hint: 'Open Men' },
  { key: 'overall', label: 'Overall', hint: 'Everyone' },
  { key: 'age', label: 'Age group', hint: 'M 35-39' },
];

const num = (s: string): number | null => {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const str = (n: number | null | undefined) => (n ? String(n) : '');

function toDraft(rows: PlacingRow[] | undefined): Draft[] {
  const have = rows ?? [];
  const base = BASE.map((b) => {
    const r = have.find((x) => x.key === b.key);
    return { key: b.key, category: r?.category ?? '', place: str(r?.place), of: str(r?.of) };
  });
  const extra = have.filter((r) => !BASE.some((b) => b.key === r.key))
    .map((r) => ({ key: r.key, category: r.category ?? '', place: str(r.place), of: str(r.of) }));
  return [...base, ...extra];
}

export function PlacingsEditor({ raceId, eventName, initial, kind, events, onBack, onSaved }: {
  raceId: string;
  eventName: string;
  initial: Placings | null;
  /** HYROX asks for each station's rank; several days, each event's place. */
  kind: 'hyrox' | 'days' | 'other';
  /** The events of a multi-day event, in order. */
  events: { id: string; name: string }[];
  onBack: () => void;
  onSaved: (p: Placings | null) => void;
}) {
  const [rows, setRows] = useState<Draft[]>(() => toDraft(initial?.rows));
  const [parts, setParts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial?.parts ?? {}).map(([k, v]) => [k, str(v)])));
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const division = rows.find((r) => r.key === 'division')?.category.trim();

  function scan(source: 'camera' | 'gallery') {
    if (Platform.OS !== 'web') { setError('Photo scan is not available here yet. Type the placings instead.'); return; }
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
          body: JSON.stringify({ images, kind, events: events.map((e) => e.name) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.placings) {
          setError(data.error || 'The results could not be read. Try a clearer photo, or type them in.');
          return;
        }
        const p = data.placings as { rows?: PlacingRow[]; parts?: Record<string, number | null>; events?: (number | null)[] };
        if (p.rows?.length) {
          setRows((rs) => {
            const next = [...rs];
            for (const r of p.rows!) {
              const i = next.findIndex((x) => x.key === r.key);
              const d = { key: r.key, category: r.category ?? '', place: str(r.place), of: str(r.of) };
              if (i >= 0) next[i] = { ...next[i], ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '')) } as Draft;
              else next.push(d);
            }
            return next;
          });
        }
        const read: Record<string, string> = {};
        for (const [k, v] of Object.entries(p.parts ?? {})) if (v) read[k] = String(v);
        (p.events ?? []).forEach((v, i) => { if (v && events[i]) read[events[i].id] = String(v); });
        setParts((cur) => ({ ...cur, ...read }));
        setNote('Placings read from the photo. Check the numbers before saving.');
      } catch {
        setError('The results could not be read. Try again, or type them in.');
      } finally {
        setScanning(false);
      }
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const placings = cleanPlacings({
      rows: rows.map((r) => ({ key: r.key, category: r.category, place: num(r.place), of: num(r.of) })),
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, num(v)])),
    });
    const { data, error: err } = await supabase.from('races').update({ placings }).eq('id', raceId).select('id');
    setSaving(false);
    if (err || !data?.length) {
      setError('Placings could not be saved. Try again.');
      return;
    }
    onSaved(placings);
  }

  const rankCells = kind === 'hyrox'
    ? HYROX_STATIONS.map((s, i) => ({ key: `st${i + 1}`, name: s.replace(/\s[\d,]+ m$/, '') }))
    : kind === 'days' ? events.map((e) => ({ key: e.id, name: e.name })) : [];
  // HYROX runs can be typed as well as scanned (2026-11-05): run1..run8.
  const runCells = kind === 'hyrox' ? HYROX_STATIONS.map((_, i) => ({ key: `run${i + 1}`, name: `Run ${i + 1}` })) : [];
  const inDivision = division ? ` IN ${division.toUpperCase()}` : '';
  const grid = (cells: { key: string; name: string }[]) => (
    <View style={e.grid}>
      {cells.map((c) => (
        <View key={c.key} style={e.cell}>
          <Text style={e.cellName} numberOfLines={1}>{c.name}</Text>
          <TextInput
            style={e.cellInput} value={parts[c.key] ?? ''} onChangeText={(v) => setParts((p) => ({ ...p, [c.key]: v.replace(/[^0-9]/g, '') }))}
            placeholder="Rank" placeholderTextColor="rgba(255,255,255,0.3)" keyboardType="number-pad"
          />
        </View>
      ))}
    </View>
  );

  return (
    <GreySheet
      kicker="EVENT"
      title="Placings"
      sub={eventName}
      onClose={onBack}
      onBack={onBack}
      footer={<GreyPrimary label={saving ? 'Saving…' : 'Save'} busy={saving} disabled={saving || scanning} onPress={save} />}
    >
      <GreyLabel>Photo scan</GreyLabel>
      <ScanChoiceTiles onPick={scan} compact />
      {scanning ? <BusyText busy style={e.status}>Reading results…</BusyText> : null}
      {note ? <Text style={e.status}>{note}</Text> : null}

      <GreyLabel>Manual entry</GreyLabel>
      {rows.map((r, i) => {
        const base = BASE.find((b) => b.key === r.key);
        return (
          <View key={`${r.key}-${i}`} style={{ marginBottom: 10 }}>
            <Text style={e.rowLabel}>{(base?.label ?? 'Category').toUpperCase()}</Text>
            <View style={e.row}>
              <TextInput
                style={[e.input, { flex: 1.35 }]} value={r.category} onChangeText={(v) => setRow(i, { category: v })}
                placeholder={base?.hint ?? 'Women 40+'} placeholderTextColor="rgba(255,255,255,0.3)"
              />
              <TextInput
                style={[e.input, e.num]} value={r.place} onChangeText={(v) => setRow(i, { place: v.replace(/[^0-9]/g, '') })}
                placeholder="Place" placeholderTextColor="rgba(255,255,255,0.3)" keyboardType="number-pad"
              />
              <Text style={e.of}>of</Text>
              <TextInput
                style={[e.input, e.num]} value={r.of} onChangeText={(v) => setRow(i, { of: v.replace(/[^0-9]/g, '') })}
                placeholder="Field" placeholderTextColor="rgba(255,255,255,0.3)" keyboardType="number-pad"
              />
            </View>
          </View>
        );
      })}
      <TouchableOpacity style={e.add} onPress={() => setRows((rs) => [...rs, { key: `extra${rs.length}`, category: '', place: '', of: '' }])} accessibilityRole="button">
        <RivalIcon name="add" size={17} color={RivalColors.accentText} />
        <Text style={e.addText}>Add a category</Text>
      </TouchableOpacity>

      {rankCells.length ? (
        <>
          <View style={e.rankHead}>
            <Text style={e.rowLabel}>{kind === 'hyrox' ? `STATION RANKS${inDivision}` : 'EVENT PLACES'}</Text>
            <Text style={e.optional}>Optional</Text>
          </View>
          {grid(rankCells)}
        </>
      ) : null}

      {runCells.length ? (
        <>
          <View style={e.rankHead}>
            <Text style={e.rowLabel}>{`RUN RANKS${inDivision}`}</Text>
            <Text style={e.optional}>Optional</Text>
          </View>
          {grid(runCells)}
        </>
      ) : null}

      {error ? <Text style={e.error}>{error}</Text> : <GreyNote>Details are read automatically. Review before saving.</GreyNote>}
    </GreySheet>
  );
}

const e = StyleSheet.create({
  status: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center', marginTop: 10 },
  rowLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    height: 44, borderRadius: 12, borderWidth: 1, borderColor: RivalGhost.border, backgroundColor: RivalGhost.fill,
    paddingHorizontal: 12, fontSize: 15, fontWeight: '600', color: '#fff', minWidth: 0,
  },
  num: { flex: 1, textAlign: 'left' },
  of: { fontSize: 12, color: RivalColors.textSecondary },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  addText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
  rankHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14 },
  optional: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: {
    flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', height: 42, borderRadius: 12, paddingLeft: 12,
    borderWidth: 1, borderColor: RivalGhost.border, backgroundColor: RivalGhost.fill,
  },
  cellName: { flex: 1, fontSize: 12.5, fontWeight: '600', color: '#fff' },
  cellInput: {
    width: 64, height: 40, textAlign: 'right', paddingRight: 12, fontSize: 15, color: '#fff',
    fontFamily: Platform.OS === 'web' ? 'Georgia, serif' : undefined, fontStyle: 'italic', fontWeight: '700',
  },
  error: { fontSize: 12.5, color: RivalColors.error, textAlign: 'center', marginTop: 10 },
});
