import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { RivalColors } from '../../../constants/rivalTheme';
import { RESPECT_COLOUR, respectGivenText } from '../../../constants/reactionColours';
import { RivalIcon } from '../RivalIcon';

// The comments under a feed card on phones (Ricky, 2026-10-05): each comment
// has a star with its count and a Reply link, and replies sit indented one
// level under the comment they answer, the way Instagram lays them out.
//
// Stars live in feed_comment_stars, apart from feed_reactions, so a starred
// comment never adds to the activity's Respect or anyone's Impact.
// Replies always point at the top comment of a thread, so nothing nests deeper.
// A reply is not prefixed with the person's name: the indent says who it answers.

export type ThreadComment = { id: string; user_id: string; body: string; created_at: string; reply_to_id?: string | null };

function ago(ts: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export function CommentThread({
  comments, currentUserId, nameFor, draft, onChangeDraft, onPost,
}: {
  comments: ThreadComment[];
  currentUserId: string | null;
  nameFor: (userId: string) => string;
  draft: string;
  onChangeDraft: (text: string) => void;
  onPost: (replyToId: string | null) => void;
}) {
  const [stars, setStars] = useState<Record<string, string[]>>({});
  const [replyTo, setReplyTo] = useState<ThreadComment | null>(null);

  const ids = useMemo(() => comments.map((c) => c.id), [comments]);
  const idsKey = ids.join(',');

  useEffect(() => {
    if (ids.length === 0) return;
    let live = true;
    (async () => {
      const { data, error } = await supabase.from('feed_comment_stars').select('comment_id, user_id').in('comment_id', ids);
      if (!live || error) return;
      const next: Record<string, string[]> = {};
      (data ?? []).forEach((r: any) => { (next[r.comment_id] ??= []).push(r.user_id); });
      setStars(next);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  async function toggleStar(commentId: string) {
    if (!currentUserId) return;
    const had = (stars[commentId] ?? []).includes(currentUserId);
    const apply = (on: boolean) => setStars((prev) => {
      const list = (prev[commentId] ?? []).filter((u) => u !== currentUserId);
      return { ...prev, [commentId]: on ? [...list, currentUserId] : list };
    });
    apply(!had);
    const { error } = had
      ? await supabase.from('feed_comment_stars').delete().eq('comment_id', commentId).eq('user_id', currentUserId)
      : await supabase.from('feed_comment_stars').insert({ comment_id: commentId, user_id: currentUserId });
    if (error) apply(had);
  }

  // Top comments in order, each followed by its replies. A reply whose
  // comment is gone shows as an ordinary comment.
  const known = new Set(ids);
  const tops = comments.filter((c) => !c.reply_to_id || !known.has(c.reply_to_id));
  const repliesOf = (id: string) => comments.filter((c) => c.reply_to_id === id);

  function row(c: ThreadComment, reply: boolean, threadTop: ThreadComment) {
    const given = (stars[c.id] ?? []);
    const mine = !!currentUserId && given.includes(currentUserId);
    return (
      <View key={c.id} style={[s.row, reply && s.reply]}>
        <View style={s.text}>
          <Text style={s.line}>
            <Text style={s.author}>{nameFor(c.user_id)}</Text>
            <Text style={s.body}>{'  '}{c.body}</Text>
          </Text>
          <View style={s.acts}>
            <Text style={s.act}>{ago(c.created_at)}</Text>
            <TouchableOpacity onPress={() => setReplyTo(threadTop)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
              <Text style={[s.act, s.actLink]}>Reply</Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity style={s.star} onPress={() => toggleStar(c.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={mine ? 'Remove star' : 'Star comment'}>
          <RivalIcon name={mine ? 'star' : 'starOutline'} size={15} color={mine ? RESPECT_COLOUR : 'rgba(255,255,255,0.55)'} />
          {given.length > 0 ? <Text style={[s.starCount, mine && respectGivenText]}>{given.length}</Text> : null}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {tops.map((t) => (
        <View key={t.id} style={s.thread}>
          {row(t, false, t)}
          {repliesOf(t.id).map((r) => row(r, true, t))}
        </View>
      ))}

      {replyTo ? (
        <View style={s.replying}>
          <Text style={s.replyingText} numberOfLines={1}>Replying to {nameFor(replyTo.user_id)}</Text>
          <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.replyingCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          value={draft}
          onChangeText={onChangeDraft}
          placeholder={replyTo ? 'Add a reply…' : 'Add a comment…'}
          placeholderTextColor="rgba(255,255,255,0.4)"
          onSubmitEditing={() => { if (draft.trim()) { onPost(replyTo?.id ?? null); setReplyTo(null); } }}
        />
        <TouchableOpacity
          onPress={() => { onPost(replyTo?.id ?? null); setReplyTo(null); }}
          disabled={!draft.trim()}
        >
          <Text style={[s.send, !draft.trim() && { opacity: 0.4 }]}>Post</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12, paddingHorizontal: 2 },
  thread: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  reply: { marginLeft: 22 },
  text: { flex: 1, minWidth: 0 },
  line: { fontSize: 13.5, lineHeight: 18, color: '#fff' },
  author: { fontWeight: '800', color: '#fff' },
  body: { fontWeight: '400', color: '#fff' },
  acts: { flexDirection: 'row', gap: 14, marginTop: 3 },
  act: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  actLink: { fontWeight: '700' },
  star: { width: 22, alignItems: 'center', paddingTop: 1, gap: 1 },
  starCount: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  replying: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  replyingText: { flex: 1, fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  replyingCancel: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, color: RivalColors.onSurface, fontSize: 12.5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  send: { color: RivalColors.accentText, fontWeight: '700', fontSize: 12.5 },
});
