import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { BREAKPOINT_WIDE_LAYOUT } from '../../constants/breakpoints';
import type { Celebration, CelebrationActivity } from '../../lib/celebration';
import { loadCelebration } from '../../lib/celebrationLoad';
import { CelebrationScreen } from './CelebrationScreen';
import { saveArrangement } from '../../lib/activityMedia';
import { RivalColors } from '../../constants/rivalTheme';
import { MediaPicker, pickMediaFiles, type MediaItem } from './MediaPicker';
import { GreyNote, GreyPrimary, GreySheet } from './RivalGreySheet';

// After saving an activity with no photo: when it set a personal best or
// earned one of the year's achievements, celebrate it and offer to add a
// photo, which becomes the achievement's tile (Ricky, 2026-10-31; yearly
// achievements and PBs, full screen on phones, 2026-11-02). Otherwise it
// simply finishes.
export function MilestonePhotoPrompt({ activityId, userId, onDone }: { activityId: string; userId: string; onDone: () => void }) {
  const [hit, setHit] = useState<{ c: Celebration; activity: CelebrationActivity } | null>(null);
  const phone = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  const [picked, setPicked] = useState<{ items: MediaItem[]; notice?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadCelebration(userId, activityId)
      .then((found) => {
        if (!live) return;
        if (found) setHit(found); else onDone();
      })
      .catch(() => { if (live) onDone(); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose() {
    setError(null);
    const { items, rejected } = await pickMediaFiles();
    if (items.length) setPicked({ items, notice: rejected[0] });
    else if (rejected.length) setError(rejected[0]);
  }

  async function save(items: MediaItem[]) {
    setPicked(null);
    setSaving(true);
    const result = await saveArrangement({ activityId, userId, items, existing: [], currentCover: null });
    setSaving(false);
    if (result.errors.length) { setError(result.errors[0]); return; }
    onDone();
  }

  if (!hit) return null;
  const picker = picked ? (
    <MediaPicker
      initial={picked.items}
      initialNotice={picked.notice}
      title="Photos and videos"
      onCancel={() => setPicked(null)}
      onDone={save}
    />
  ) : null;
  if (phone) {
    return (
      <CelebrationScreen celebration={hit.c} activity={hit.activity} busy={saving} error={error} onAddPhoto={choose} onClose={onDone}>
        {picker}
      </CelebrationScreen>
    );
  }
  return (
    <View style={s.dim}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onDone} accessibilityLabel="Not now" />
      <GreySheet
        kicker={hit.c.kicker}
        title={hit.c.title.replace(/\.$/, '')}
        onClose={onDone}
        footer={(
          <View style={{ gap: 10 }}>
            <GreyPrimary label="Add a photo" busy={saving} onPress={choose} />
            <TouchableOpacity onPress={onDone} disabled={saving} style={s.later}><Text style={s.laterText}>Not now</Text></TouchableOpacity>
          </View>
        )}
      >
        <GreyNote>
          {hit.c.also.length ? `Also earned: ${hit.c.also.join(', ')}. ` : ''}
          Add a photo to remember it.
        </GreyNote>
        {error ? <Text style={s.error}>{error}</Text> : null}
      </GreySheet>
      {picker}
    </View>
  );
}

const s = StyleSheet.create({
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 400 },
  later: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16 },
  laterText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
  error: { fontSize: 13, color: RivalColors.error, marginTop: 8 },
});
