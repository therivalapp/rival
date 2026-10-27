import { useEffect, useState } from 'react';
import { Image, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { GreyPageHead, GREY_PAGE_BG, GreySheet, GreyLabel, GreyField, GreyPrimary, GreyNote, RivalIcon } from '../components/rival';
import { RivalButtonColors, RivalColors } from '../constants/rivalTheme';
import { confirmAction } from '../lib/notify';
import { getAuthUser } from '../lib/supabase';
import { goToTab } from '../lib/tabNav';
import { matchCanonicalLift } from '../lib/lifts';
import { pickScanFiles, setPendingScanFiles } from '../lib/scanHandoff';
import { fitPhoto } from '../lib/imageResize';
import type { LiftLine } from '../lib/liftHistory';
import {
  DAY_LONG, DAY_SHORT, SAVED_WORKOUT_LIMIT, createSavedWorkout, deleteSavedWorkout, exerciseCount, lastDoneText,
  loadSavedWorkouts, photoUrls, savedWorkoutError, updateSavedWorkout, uploadWorkoutPhoto, type SavedWorkoutRow,
} from '../lib/savedWorkouts';

// Saved workouts (Ricky, 2026-10-25, mockup approved): every saved workout in
// one place, from Manage saved workouts on Add an activity. Tap one to log
// it; ⋯ to edit or delete. New ones from a photo (scanned, not logged) or
// typed in. Private: nobody else sees them.

const KG_PER_LB = 0.453592;

type Draft = { id: string | null; name: string; usualDay: number | null; lines: LiftLine[]; imagePath: string | null };

function emptyDraft(): Draft {
  return { id: null, name: '', usualDay: null, lines: [{ name: '' }], imagePath: null };
}

export default function SavedWorkoutsScreen() {
  const { new: startNew } = useLocalSearchParams<{ new?: string }>();
  const [list, setList] = useState<SavedWorkoutRow[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(startNew === '1' ? emptyDraft() : null);
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [newPhoto, setNewPhoto] = useState<{ blob: Blob; uri: string; mimeType: string; ext: string } | null>(null);

  const load = async () => {
    try {
      const rows = await loadSavedWorkouts();
      setList(rows);
      setUrls(await photoUrls(rows.map((w) => w.imagePath)));
    } catch (e) {
      setError(savedWorkoutError(e));
      setList([]);
    }
  };
  useEffect(() => { load(); }, []);

  const back = () => (router.canGoBack() ? router.back() : goToTab('/my-activities'));
  const full = (list?.length ?? 0) >= SAVED_WORKOUT_LIMIT;

  // From a photo: the photo library opens from the tap, and the scan page
  // reads it in save-only mode (nothing is logged).
  const fromPhoto = () => {
    if (Platform.OS !== 'web') { router.push('/scan-workout?source=gallery&saveOnly=1'); return; }
    pickScanFiles('gallery', (files) => {
      setPendingScanFiles(files);
      router.push('/scan-workout?source=picked&saveOnly=1');
    });
  };

  const edit = (w: SavedWorkoutRow) => {
    setMenu(null);
    setDraftError(null);
    setNewPhoto(null);
    setDraft({ id: w.id, name: w.name, usualDay: w.usualDay, lines: w.exercises.length ? w.exercises.map((l) => ({ ...l })) : [{ name: '' }], imagePath: w.imagePath });
  };

  const remove = async (w: SavedWorkoutRow) => {
    setMenu(null);
    const sure = await confirmAction({ title: `Delete ${w.name}?`, message: 'It will no longer be offered on Add an activity. Activities already logged are not changed.', confirmLabel: 'Delete', destructive: true });
    if (!sure) return;
    try {
      await deleteSavedWorkout(w);
      setList((prev) => (prev ?? []).filter((x) => x.id !== w.id));
    } catch (e) {
      setError(`The workout could not be deleted: ${savedWorkoutError(e)}`);
    }
  };

  const pickPhoto = () => {
    if (Platform.OS !== 'web') return;
    pickScanFiles('gallery', async (files) => {
      const f = files[0];
      if (!f) return;
      const up = await fitPhoto({ blob: f, mimeType: f.type || 'image/jpeg', ext: (f.name.split('.').pop() || 'jpg').toLowerCase() });
      setNewPhoto({ ...up, uri: URL.createObjectURL(up.blob) });
    });
  };

  const save = async () => {
    if (!draft || saving) return;
    const name = draft.name.trim();
    const lines = draft.lines
      .filter((l) => l.name?.trim())
      .map((l) => ({ name: matchCanonicalLift(l.name) || l.name.trim(), sets: l.sets, reps: l.reps, weight: l.weight }));
    if (!name) { setDraftError('Give the activity a name.'); return; }
    if (!lines.length) { setDraftError('Add at least one exercise.'); return; }
    setSaving(true);
    setDraftError(null);
    try {
      let imagePath = draft.imagePath;
      if (newPhoto) {
        const { data: { user } } = await getAuthUser();
        if (!user) throw new Error('Sign in to continue.');
        imagePath = await uploadWorkoutPhoto(user.id, newPhoto.blob, newPhoto.mimeType, newPhoto.ext);
      }
      if (draft.id) {
        await updateSavedWorkout(draft.id, { name, exercises: lines, usualDay: draft.usualDay, imagePath });
      } else {
        await createSavedWorkout({ name, activityType: 'WeightTraining', exercises: lines, usualDay: draft.usualDay, imagePath });
      }
      setDraft(null);
      setNewPhoto(null);
      await load();
    } catch (e) {
      setDraftError(savedWorkoutError(e));
    } finally {
      setSaving(false);
    }
  };

  const setLine = (i: number, patch: Partial<LiftLine>) => setDraft((d) => (d ? { ...d, lines: d.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) } : d));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/[^\d.]/g, '')) || undefined);
  const showKg = (kg?: number) => (kg == null ? '' : String(Math.round((unit === 'lb' ? kg / KG_PER_LB : kg) * 10) / 10));
  const draftPhoto = newPhoto?.uri ?? (draft?.imagePath ? urls[draft.imagePath] : undefined);

  return (
    <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="LIFTS" title="Saved activities" onBack={back} />

        <View style={s.actions}>
          <TouchableOpacity style={[s.ghost, full && s.off]} onPress={fromPhoto} disabled={full} activeOpacity={0.85} accessibilityRole="button">
            <RivalIcon name="camera" size={17} color={RivalColors.accentText} />
            <Text style={s.ghostText}>From a photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.ghost, full && s.off]} onPress={() => { setDraftError(null); setNewPhoto(null); setDraft(emptyDraft()); }} disabled={full} activeOpacity={0.85} accessibilityRole="button">
            <RivalIcon name="manual" size={17} color={RivalColors.accentText} />
            <Text style={s.ghostText}>Enter manually</Text>
          </TouchableOpacity>
        </View>
        {full ? <GreyNote>{`Saved activities are limited to ${SAVED_WORKOUT_LIMIT}. Delete one to save another.`}</GreyNote> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}

        {list && list.length === 0 && !error ? (
          <GreyNote>None saved yet. Save one from a photo of the routine, or enter it manually.</GreyNote>
        ) : null}

        <View style={s.list}>
          {(list ?? []).map((w) => {
            const url = w.imagePath ? urls[w.imagePath] : undefined;
            const names = w.exercises.filter((e) => e?.name?.trim()).map((e) => e.name);
            return (
              <View key={w.id}>
                <View style={s.item}>
                <TouchableOpacity style={s.itemMain} onPress={() => router.push(`/manual-entry?saved=${w.id}`)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`Log ${w.name}`}>
                  <View style={s.thumb}>
                    {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      : <RivalIcon name="bicep" size={26} color="rgba(255,181,158,0.5)" />}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.name}>{w.name}</Text>
                    <Text style={s.sub}>{`${w.usualDay != null ? DAY_LONG[w.usualDay] : 'No usual day'} · ${lastDoneText(w.lastUsedAt, w.createdAt)}`}</Text>
                    <Text style={s.ex}>{names.slice(0, 3).join(', ')}{names.length > 3 ? ` +${names.length - 3}` : ''}</Text>
                  </View>
                </TouchableOpacity>
                  <TouchableOpacity
                    style={s.more}
                    onPress={() => setMenu((cur) => (cur === w.id ? null : w.id))}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`More for ${w.name}`}
                  >
                    <RivalIcon name="moreHoriz" size={18} color="rgba(255,255,255,0.6)" />
                  </TouchableOpacity>
                </View>
                {menu === w.id ? (
                  <View style={s.menu}>
                    <TouchableOpacity style={s.menuItem} onPress={() => edit(w)}>
                      <RivalIcon name="edit" size={15} color={RivalColors.onSurface} />
                      <Text style={s.menuText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.menuItem} onPress={() => remove(w)}>
                      <RivalIcon name="delete" size={15} color={RivalColors.danger} />
                      <Text style={[s.menuText, { color: RivalColors.danger }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
        {list && list.length ? <Text style={s.private}>Saved activities are private.</Text> : null}
      </ScrollView>

      {/* New or edited: name, usual day, photo and the exercises. */}
      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <View style={s.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDraft(null)} accessibilityLabel="Close" />
          {draft ? (
            <GreySheet
              kicker="SAVED ACTIVITY"
              title={draft.id ? 'Edit saved activity' : 'New saved activity'}
              onClose={() => setDraft(null)}
              footer={<GreyPrimary label={saving ? 'Saving…' : 'Save'} busy={saving} disabled={saving} onPress={save} />}
            >
              <GreyLabel>Name</GreyLabel>
              <GreyField value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v.slice(0, 60) })} placeholder="Monday gym" autoComplete="off" textContentType="none" />

              <GreyLabel>Usually on · optional</GreyLabel>
              <View style={s.days}>
                {DAY_SHORT.map((d, i) => {
                  // Monday first, as the app's weeks are.
                  const day = (i + 1) % 7;
                  const on = draft.usualDay === day;
                  return (
                    <TouchableOpacity key={d} style={[s.dayBtn, on && s.dayBtnOn]} onPress={() => setDraft({ ...draft, usualDay: on ? null : day })} accessibilityRole="button" accessibilityState={{ selected: on }}>
                      <Text style={[s.dayText, on && s.dayTextOn]}>{DAY_SHORT[day]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <GreyLabel>Photo · optional</GreyLabel>
              <TouchableOpacity style={s.photoRow} onPress={pickPhoto} activeOpacity={0.85} accessibilityRole="button">
                <View style={s.photoThumb}>
                  {draftPhoto ? <Image source={{ uri: draftPhoto }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    : <RivalIcon name="addPhoto" size={20} color={RivalColors.accentText} />}
                </View>
                <Text style={s.photoText}>{draftPhoto ? 'Change photo' : 'Add a photo of the routine'}</Text>
              </TouchableOpacity>

              <View style={s.exHead}>
                <GreyLabel>Exercises</GreyLabel>
                <View style={s.unit}>
                  {(['kg', 'lb'] as const).map((u) => (
                    <TouchableOpacity key={u} style={[s.unitBtn, unit === u && s.unitBtnOn]} onPress={() => setUnit(u)}>
                      <Text style={[s.unitText, unit === u && s.unitTextOn]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {draft.lines.map((l, i) => (
                <View key={i} style={s.line}>
                  <TextInput
                    style={[s.lineName, !l.name?.trim() && s.lineNameEmpty]}
                    value={l.name}
                    onChangeText={(v) => setLine(i, { name: v })}
                    placeholder="Exercise name"
                    placeholderTextColor="rgba(255,181,158,0.85)"
                    autoComplete="off"
                    textContentType="none"
                  />
                  <View style={s.nums}>
                    {([['sets', 'Sets'], ['reps', 'Reps']] as const).map(([f, label]) => (
                      <View key={f} style={s.num}>
                        <Text style={s.numLabel}>{label}</Text>
                        <TextInput style={s.numInput} value={l[f] != null ? String(l[f]) : ''} onChangeText={(v) => setLine(i, { [f]: num(v) })} keyboardType="numeric" placeholder="–" placeholderTextColor="rgba(255,255,255,0.25)" autoComplete="off" />
                      </View>
                    ))}
                    <View style={s.num}>
                      <Text style={s.numLabel}>{unit === 'kg' ? 'Kg' : 'Lb'}</Text>
                      <TextInput
                        style={s.numInput}
                        value={showKg(l.weight)}
                        onChangeText={(v) => { const n = num(v); setLine(i, { weight: n == null ? undefined : unit === 'lb' ? n * KG_PER_LB : n }); }}
                        keyboardType="decimal-pad" placeholder="–" placeholderTextColor="rgba(255,255,255,0.25)" autoComplete="off"
                      />
                    </View>
                    <TouchableOpacity style={s.lineRemove} onPress={() => setDraft({ ...draft, lines: draft.lines.filter((_, k) => k !== i) })} accessibilityLabel="Remove exercise">
                      <RivalIcon name="close" size={14} color="rgba(255,255,255,0.45)" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <TouchableOpacity style={s.addLine} onPress={() => setDraft({ ...draft, lines: [...draft.lines, { name: '' }] })} activeOpacity={0.8}>
                <RivalIcon name="add" size={16} color={RivalColors.accentText} />
                <Text style={s.addLineText}>Add exercise</Text>
              </TouchableOpacity>
              {draftError ? <Text style={s.error}>{draftError}</Text> : null}
            </GreySheet>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  content: { paddingHorizontal: 16, paddingBottom: 60, maxWidth: 560, width: '100%', alignSelf: 'center' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 6 },
  ghost: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)' },
  ghostText: { fontSize: 14, fontWeight: '700', color: RivalColors.accentText },
  off: { opacity: 0.4 },
  error: { fontSize: 12.5, color: RivalColors.danger, marginTop: 10 },
  list: { gap: 10, marginTop: 10 },
  itemMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,209,190,0.05)', borderWidth: 1, borderColor: 'rgba(255,181,158,0.22)' },
  thumb: { width: 64, height: 64, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  name: { fontSize: 15, fontWeight: '800', color: RivalColors.textPrimary },
  sub: { fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  ex: { fontSize: 11.5, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  more: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  menu: { flexDirection: 'row', gap: 8, marginTop: 6, justifyContent: 'flex-end' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' },
  menuText: { fontSize: 13, fontWeight: '700', color: RivalColors.onSurface },
  private: { fontSize: 11.5, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  days: { flexDirection: 'row', gap: 6 },
  dayBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'transparent' },
  dayBtnOn: { backgroundColor: 'rgba(255,181,158,0.14)', borderColor: 'rgba(255,181,158,0.6)' },
  dayText: { fontSize: 12, fontWeight: '800', color: RivalColors.textSecondary },
  dayTextOn: { color: '#fff' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photoThumb: { width: 52, height: 52, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,209,190,0.08)', borderWidth: 1, borderColor: 'rgba(255,181,158,0.22)' },
  photoText: { fontSize: 14, fontWeight: '700', color: RivalColors.accentText },
  exHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  unit: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 999, padding: 3, gap: 2, marginBottom: 8 },
  unitBtn: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999 },
  unitBtnOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  unitText: { fontSize: 12, fontWeight: '800', color: RivalColors.textSecondary },
  unitTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  line: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 10, gap: 8, marginBottom: 8 },
  lineName: { color: '#fff', fontSize: 15, fontWeight: '700', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: 'transparent', backgroundColor: 'rgba(0,0,0,0.12)' },
  lineNameEmpty: { borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.55)', backgroundColor: 'rgba(255,209,190,0.06)' },
  nums: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  num: { flex: 1, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 10, paddingVertical: 5 },
  numLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' },
  numInput: { color: '#fff', fontSize: 17, fontWeight: '300', textAlign: 'center', width: '100%', paddingVertical: 2 },
  lineRemove: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  addLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,209,190,0.35)' },
  addLineText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
});
