import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { fetchAllActivities } from '../../lib/fetchAllActivities';
import { saveArrangement } from '../../lib/activityMedia';
import { milestoneWords, profileMilestones, type Milestone } from '../../lib/profilePage';
import { RivalColors } from '../../constants/rivalTheme';
import { MediaPicker, pickMediaFiles, type MediaItem } from './MediaPicker';
import { GreyNote, GreyPrimary, GreySheet } from './RivalGreySheet';

// After saving an activity with no photo: when it reached a milestone, offer
// to add one, since that photo becomes the milestone's picture on the profile
// (Ricky, 2026-10-31). Otherwise it simply finishes.
export function MilestonePhotoPrompt({ activityId, userId, onDone }: { activityId: string; userId: string; onDone: () => void }) {
  const [hit, setHit] = useState<Milestone | null>(null);
  const [picked, setPicked] = useState<{ items: MediaItem[]; notice?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchAllActivities(userId, 'id, activity_type, started_at, duration_seconds, distance_meters, elevation_meters, effort_score')
      .then((rows) => {
        if (!live) return;
        const found = profileMilestones(rows).earned.find((m) => m.activity.id === activityId);
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
  return (
    <View style={s.dim}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onDone} accessibilityLabel="Not now" />
      <GreySheet
        kicker="Milestone"
        title={`${hit.target.toLocaleString()} ${milestoneWords(hit.kind)}`}
        onClose={onDone}
        footer={(
          <View style={{ gap: 10 }}>
            <GreyPrimary label="Add a photo" busy={saving} onPress={choose} />
            <TouchableOpacity onPress={onDone} disabled={saving} style={s.later}><Text style={s.laterText}>Not now</Text></TouchableOpacity>
          </View>
        )}
      >
        <GreyNote>Add a photo to remember this achievement.</GreyNote>
        {error ? <Text style={s.error}>{error}</Text> : null}
      </GreySheet>
      {picked ? (
        <MediaPicker
          initial={picked.items}
          initialNotice={picked.notice}
          title="Photos and videos"
          onCancel={() => setPicked(null)}
          onDone={save}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 400 },
  later: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16 },
  laterText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
  error: { fontSize: 13, color: RivalColors.error, marginTop: 8 },
});
