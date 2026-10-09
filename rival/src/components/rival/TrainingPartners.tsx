import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  fetchParticipants,
  fetchTeammates,
  removeTag,
  tagTeammates,
  withinTagWindow,
  type Participant,
  type Teammate,
} from '../../lib/sharedActivities';
import { confirmAction } from '../../lib/notify';
import { RivalColors, RivalRadius } from '../../constants/rivalTheme';
import { RivalAvatar } from './RivalAvatar';
import { RivalIcon } from './RivalIcon';

// Who else was on this session.
//
// This replaced a free-text box that asked "Who did you train with?" and did
// nothing with the answer. The names are now people: tagging a teammate asks
// them to confirm, and confirming gives them their own copy of the session —
// which is the only way someone who was there without a device gets credit for
// being there.
//
// On the Log an activity page the activity does not exist yet, so with no
// `activityId` the picks are held as a draft (`draftIds` / `onDraftChange`)
// and the page tags them once it has saved.
//
// Only the owner of an activity sees the picker. A shared copy shows the names
// and nothing else: it is a record of who you were with, not a place to
// re-share a session that was never yours.

function nameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// "with Sandy", "with Sandy and Max", "with Sandy and 2 others": the way
// Instagram names who liked a post, so a long list stays one short line.
function shortList(names: string[]): string {
  if (names.length <= 2) return nameList(names);
  const rest = names.length - 1;
  return `${names[0]} and ${rest} other${rest === 1 ? '' : 's'}`;
}

const STACK_SIZE = 20;
const STACK_MAX = 3;

export function TrainingPartners({
  activityId,
  startedAt,
  companions,
  readOnly = false,
  hideWhenEmpty = false,
  avatars = false,
  acceptedOnly = false,
  draftIds,
  onDraftChange,
  onChanged,
}: {
  activityId: string | null;
  startedAt: string;
  // The typed value from before this feature existed. Still shown when there
  // is nothing better, so nobody's old journal entries quietly lose a name.
  companions: string | null;
  readOnly?: boolean;
  // Render nothing when there is no one to show and nothing to offer.
  hideWhenEmpty?: boolean;
  // Confirmed partners as up to three overlapping profile pictures, like
  // Instagram's "liked by", with a short name line beside them.
  avatars?: boolean;
  // Leave out anyone who has not accepted yet (feed cards, Ricky 2026-10-05).
  acceptedOnly?: boolean;
  draftIds?: string[];
  onDraftChange?: (ids: string[]) => void;
  onChanged?: () => void;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const draft = !activityId;

  const load = useCallback(async () => {
    if (!activityId) { setParticipants([]); return; }
    const rows = await fetchParticipants(activityId);
    setParticipants(rows);
  }, [activityId]);

  useEffect(() => {
    setOpen(false);
    setError('');
    load();
  }, [activityId, load]);

  // The activity can only be tagged inside the window the database enforces,
  // so an expired one shows what it has and offers nothing.
  const canEdit = !readOnly && withinTagWindow(startedAt);

  // A draft pick reads as "with Sandy" straight away; it becomes a request
  // when the activity is saved.
  const drafted = draft ? teammates.filter((t) => draftIds?.includes(t.id)) : [];
  const accepted = participants.filter((p) => p.status === 'accepted');
  const pending = participants.filter((p) => p.status === 'pending');

  async function openPicker() {
    if (!canEdit) return;
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (teammates.length === 0) {
      setLoading(true);
      setTeammates(await fetchTeammates());
      setLoading(false);
    }
  }

  async function toggle(mate: Teammate) {
    if (!activityId) {
      const ids = draftIds ?? [];
      onDraftChange?.(ids.includes(mate.id) ? ids.filter((id) => id !== mate.id) : [...ids, mate.id]);
      return;
    }
    const existing = participants.find((p) => p.userId === mate.id);
    setError('');
    setBusyId(mate.id);

    if (existing) {
      // Removing an accepted tag takes their copy of the session with it, so
      // it asks first. A pending one has cost nobody anything yet.
      if (existing.status === 'accepted') {
        const sure = await confirmAction({
          title: `Remove ${mate.name} from this activity?`,
          message: 'Their copy of the activity and its Effort will also be removed.',
          confirmLabel: 'Remove',
          destructive: true,
        });
        if (!sure) { setBusyId(null); return; }
      }
      const res = await removeTag(existing.id);
      if (!res.ok) setError(res.error || 'Something went wrong. Try again.');
    } else {
      const res = await tagTeammates(activityId, [mate.id]);
      if (!res.ok) setError(res.error || 'Something went wrong. Try again.');
    }

    setBusyId(null);
    await load();
    onChanged?.();
  }

  // What the row says when it is not open. Accepted names read plainly;
  // anything still waiting is named as waiting, so the owner can tell the
  // difference between "Sandy was there" and "Sandy has not answered yet".
  let summary = '';
  if (accepted.length) summary = `with ${(avatars ? shortList : nameList)(accepted.map((p) => p.name))}`;
  if (pending.length && !acceptedOnly) {
    const waiting = `${nameList(pending.map((p) => p.name))} · pending`;
    summary = summary ? `${summary} · ${waiting}` : waiting;
  }
  if (drafted.length) summary = `with ${nameList(drafted.map((t) => t.name))}`;
  if (!summary && companions) summary = `with ${companions}`;

  if (hideWhenEmpty && !summary && !canEdit) return null;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.row}
        activeOpacity={canEdit ? 0.7 : 1}
        disabled={!canEdit}
        onPress={openPicker}
      >
        {avatars && accepted.length > 0 ? (
          <View style={styles.stack}>
            {accepted.slice(0, STACK_MAX).map((p, i) => (
              <View key={p.id} style={[styles.stackItem, i > 0 && styles.stackOverlap, { zIndex: STACK_MAX - i }]}>
                <RivalAvatar uri={p.avatarUrl} name={p.name} size={STACK_SIZE} />
              </View>
            ))}
          </View>
        ) : (
          <RivalIcon name="groups" size={12} color="rgba(255,255,255,0.5)" />
        )}
        <Text style={[styles.summary, avatars && accepted.length > 0 && styles.summaryStack, !summary && styles.placeholder]} numberOfLines={2}>
          {summary || 'Add activity partners'}
        </Text>
        {canEdit ? (
          <RivalIcon name={open ? 'chevronDown' : 'chevronRight'} size={14} color="rgba(255,255,255,0.4)" />
        ) : null}
      </TouchableOpacity>

      {open ? (
        <View style={styles.panel}>
          <Text style={styles.panelNote}>
            Each person confirms before the activity is added to their account.
          </Text>

          {loading ? (
            <ActivityIndicator color={RivalColors.accentText} style={styles.loader} />
          ) : teammates.length === 0 ? (
            <Text style={styles.panelEmpty}>
              Only teammates can be added.
            </Text>
          ) : (
            teammates.map((mate) => {
              const existing = participants.find((p) => p.userId === mate.id)
                ?? (draftIds?.includes(mate.id) ? { status: 'draft' as const } : undefined);
              const busy = busyId === mate.id;
              return (
                <TouchableOpacity
                  key={mate.id}
                  style={styles.mate}
                  disabled={busy}
                  onPress={() => toggle(mate)}
                >
                  <RivalAvatar uri={mate.avatarUrl} name={mate.name} size={28} />
                  <View style={styles.mateText}>
                    <Text style={styles.mateName}>{mate.name}</Text>
                    {existing?.status === 'pending' ? (
                      <Text style={styles.mateState}>Pending</Text>
                    ) : existing?.status === 'accepted' ? (
                      <Text style={styles.mateState}>Confirmed</Text>
                    ) : existing?.status === 'declined' ? (
                      <Text style={styles.mateState}>Declined</Text>
                    ) : null}
                  </View>
                  {busy ? (
                    <ActivityIndicator size="small" color={RivalColors.accentText} />
                  ) : (
                    <RivalIcon
                      name={existing ? 'checkCircle' : 'add'}
                      size={18}
                      color={existing ? RivalColors.accentText : 'rgba(255,255,255,0.35)'}
                    />
                  )}
                </TouchableOpacity>
              );
            })
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summary: { flex: 1, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  // Each picture sits a quarter over the one before it, with a thin ring in
  // the card colour so the edges stay readable.
  stack: { flexDirection: 'row', alignItems: 'center', marginRight: 4 },
  stackItem: { borderRadius: STACK_SIZE, borderWidth: 1.5, borderColor: '#2a2421' },
  stackOverlap: { marginLeft: -(STACK_SIZE / 4) },
  summaryStack: { color: 'rgba(255,255,255,0.8)' },
  placeholder: { color: 'rgba(255,255,255,0.45)' },

  panel: {
    marginTop: 10,
    borderRadius: RivalRadius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  panelNote: { fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginBottom: 6 },
  panelEmpty: { fontSize: 12.5, color: 'rgba(255,255,255,0.5)', paddingVertical: 6 },
  loader: { paddingVertical: 10 },

  mate: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  mateText: { flex: 1, minWidth: 0 },
  mateName: { fontSize: 13.5, fontWeight: '600', color: '#fff' },
  mateState: { fontSize: 11, color: RivalColors.accentText, marginTop: 1 },

  error: { fontSize: 11.5, color: '#ff8f8f', marginTop: 6 },
});
