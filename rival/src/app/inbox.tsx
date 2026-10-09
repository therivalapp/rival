import { useSnapState } from '../lib/snapState';
import { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { sidePageWide } from '../constants/breakpoints';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  fetchInbox,
  isActionable,
  markRead,
  resolveItem,
  respondToActivityTag,
  respondToJoinRequest,
  respondToShortActivity,
  respondToPaceReview,
  type InboxItem,
} from '@/lib/inbox';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import { RivalBackButton, RivalIcon, RivalTopNav, GreySheet, GreyLabel } from '@/components/rival';
import { INBOX_ICON_FOR, goToInboxSubject, inboxTimeAgo } from '@/components/rival/NotificationsMenu';
import { RivalButtonColors, RivalColors, RivalRadius, RivalSerifFamily, RivalType, RivalGhost } from '@/constants/rivalTheme';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';
import { stravaSharingNeedsAnswer, STRAVA_SHARING_NOTICE } from '../lib/stravaSharing';

// The inbox. Items are answered where they sit rather than sending you off to
// another screen to find the thing they are about — a notification you have to
// go hunting after is just a reminder that you have work to do.

export default function InboxScreen() {
  const [items, setItems] = useSnapState<InboxItem[]>('inbox.items', []);
  const [loading, setLoading] = useSnapState('inbox.loading', true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<Record<string, string>>({});
  const phone = !sidePageWide(useWindowDimensions().width);

  const load = useCallback(async () => {
    const rows = await fetchInbox();
    setItems(rows);
    setLoading(false);
    // Marked read on open, but only the purely informational ones. An item
    // still waiting for an answer keeps counting until it is answered.
    const toMark = rows.filter((r) => !r.read_at && !isActionable(r)).map((r) => r.id);
    if (toMark.length) {
      await markRead(toMark);
      setItems((prev) => prev.map((r) => (toMark.includes(r.id) ? { ...r, read_at: new Date().toISOString() } : r)));
    }
  }, []);

  // Not an inbox row: shown while Strava sharing is still unanswered.
  const [stravaPending, setStravaPending] = useState(false);
  useFocusEffect(useCallback(() => { load(); stravaSharingNeedsAnswer().then(setStravaPending, () => {}); }, [load]));
  const { scrollProps: pullProps, indicator: pullIndicator } = usePullToRefresh(load);

  async function act(item: InboxItem, run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(item.id);
    setErrorFor((prev) => ({ ...prev, [item.id]: '' }));
    const res = await run();
    setBusyId(null);
    if (!res.ok) {
      setErrorFor((prev) => ({ ...prev, [item.id]: res.error || 'Something went wrong. Try again.' }));
      // Re-read regardless: the failure often means someone else already
      // handled it, and the list should stop showing a stale decision.
      await load();
      return;
    }
    await load();
  }

  // An activity that looked faster than possible: open it to edit (the item
  // closes itself once the numbers are realistic), or vouch for it.
  async function answerPaceReview(item: InboxItem, correct: boolean): Promise<{ ok: boolean; error?: string }> {
    if (correct) return respondToPaceReview(item);
    if (!item.subject_id) return { ok: false, error: 'That activity is no longer available.' };
    router.push({ pathname: '/manual-entry', params: { editId: item.subject_id } });
    return { ok: true };
  }

  const unresolvedFirst = [...items].sort((a, b) => {
    const aOpen = isActionable(a) ? 0 : 1;
    const bOpen = isActionable(b) ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // The answer buttons for an item still waiting on a decision.
  const actionsFor = (item: InboxItem) => {
    const busy = busyId === item.id;
    const pair = (no: string, yes: string, yesBusy: string, respond: (ok: boolean) => Promise<{ ok: boolean; error?: string }>) => (
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.secondary, m.secondary]} disabled={busy} onPress={() => act(item, () => respond(false))}>
          <BusyText busy={busy} style={styles.secondaryText}>{busy ? '…' : no}</BusyText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primary, m.primary]} disabled={busy} onPress={() => act(item, () => respond(true))}>
          <BusyText busy={busy} style={styles.primaryText}>{busy ? yesBusy : yes}</BusyText>
        </TouchableOpacity>
      </View>
    );
    if (item.kind === 'join_request') return pair('Decline', 'Approve', '…', (ok) => respondToJoinRequest(item, ok));
    if (item.kind === 'short_activity') return pair('Remove', 'Keep', '…', (ok) => respondToShortActivity(item, ok));
    if (item.kind === 'activity_tag') return pair('Decline', 'Confirm', 'Confirming…', (ok) => respondToActivityTag(item, ok));
    if (item.kind === 'pace_review') return pair('Edit', "It's correct", 'Saving…', (ok) => answerPaceReview(item, ok));
    return null;
  };

  if (phone) {
    const open = unresolvedFirst.filter(isActionable);
    const earlier = unresolvedFirst.filter((i) => !isActionable(i));
    const close = () => (router.canGoBack() ? router.back() : goToTab('/home'));
    return (
      <View style={m.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
        <GreySheet kicker="INBOX" title="Notifications" onClose={close} footer={null}>
          <View style={m.content}>
            {(stravaPending || open.length > 0) && <GreyLabel>Needs a reply</GreyLabel>}
            {stravaPending && (
              <TouchableOpacity style={[m.card, m.cardOpen]} onPress={STRAVA_SHARING_NOTICE.open} activeOpacity={0.8}>
                <View style={[styles.cardMain, { alignItems: 'center' }]}>
                  <View style={m.badge}><RivalIcon name="link" size={16} color={RivalColors.accentText} /></View>
                  <View style={styles.textWrap}>
                    <Text style={styles.cardTitle}>{STRAVA_SHARING_NOTICE.title}</Text>
                    <Text style={styles.cardBody} numberOfLines={2}>{STRAVA_SHARING_NOTICE.body}</Text>
                  </View>
                  <View style={m.tag}><Text style={m.tagText}>Review</Text></View>
                </View>
              </TouchableOpacity>
            )}
            {open.map((item) => (
              <View key={item.id} style={[m.card, m.cardOpen]}>
                <View style={styles.cardMain}>
                  <View style={m.badge}><RivalIcon name={INBOX_ICON_FOR[item.kind]} size={16} color={RivalColors.accentText} /></View>
                  <View style={styles.textWrap}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    {item.body ? <Text style={styles.cardBody}>{item.body}</Text> : null}
                    <Text style={styles.cardWhen}>{inboxTimeAgo(item.created_at)}</Text>
                  </View>
                </View>
                {actionsFor(item)}
                {errorFor[item.id] ? <Text style={styles.error}>{errorFor[item.id]}</Text> : null}
              </View>
            ))}

            {loading ? (
              <Text style={styles.state}>Loading…</Text>
            ) : earlier.length > 0 ? (
              <>
                <GreyLabel>{open.length > 0 || stravaPending ? 'Earlier' : 'Recent'}</GreyLabel>
                <View style={m.list}>
                  {earlier.map((item, i) => (
                    <View key={item.id} style={[m.row, i > 0 && m.rowRule]}>
                      <TouchableOpacity style={m.rowMain} activeOpacity={0.7} onPress={() => goToInboxSubject(item)}>
                        <View style={m.badge}>
                          <RivalIcon name={INBOX_ICON_FOR[item.kind]} size={15} color={RivalColors.accentText} />
                          {!item.read_at && <View style={m.dot} />}
                        </View>
                        <View style={styles.textWrap}>
                          <Text style={m.rowTitle} numberOfLines={2}>{item.title}</Text>
                          {item.body ? <Text style={m.rowBody} numberOfLines={2}>{item.body}</Text> : null}
                        </View>
                        <Text style={m.when}>{inboxTimeAgo(item.created_at)}</Text>
                      </TouchableOpacity>
                      {!item.resolved_at ? (
                        <TouchableOpacity
                          style={m.clear}
                          hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
                          onPress={() => act(item, () => resolveItem(item.id, 'dismissed'))}
                          accessibilityLabel="Clear"
                        >
                          <RivalIcon name="close" size={14} color="rgba(255,255,255,0.35)" />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ))}
                </View>
              </>
            ) : !stravaPending && open.length === 0 ? (
              <View style={m.empty}>
                <View style={m.badge}><RivalIcon name="notificationsOutline" size={16} color={RivalColors.accentText} /></View>
                <View style={styles.textWrap}>
                  <Text style={styles.cardTitle}>No notifications</Text>
                  <Text style={styles.cardBody}>Reactions, comments and requests appear here.</Text>
                </View>
              </View>
            ) : null}
          </View>
        </GreySheet>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav />
      <ScrollView contentContainerStyle={styles.content} {...pullProps}>
        {pullIndicator}

        <View style={styles.header}>
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : goToTab('/home'))} />
          <Text style={styles.title}>Notifications</Text>
        </View>

        {stravaPending && (
          <View style={[styles.card, styles.cardUnread, styles.cardOpen]}>
            <View style={styles.cardMain}>
              <View style={styles.iconWrap}>
                <RivalIcon name="groups" size={17} color={RivalColors.accentText} />
              </View>
              <View style={styles.textWrap}>
                <Text style={styles.cardTitle}>{STRAVA_SHARING_NOTICE.title}</Text>
                <Text style={styles.cardBody}>{STRAVA_SHARING_NOTICE.body}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.primary} onPress={STRAVA_SHARING_NOTICE.open}>
                <Text style={styles.primaryText}>Review</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {loading ? (
          <Text style={styles.state}>Loading…</Text>
        ) : unresolvedFirst.length === 0 ? (
          stravaPending ? null :
          <View style={styles.empty}>
            <RivalIcon name="notificationsOutline" size={28} color={RivalColors.accentText} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyBody}>Reactions, comments and requests appear here.</Text>
          </View>
        ) : (
          unresolvedFirst.map((item) => {
            const open = isActionable(item);
            const busy = busyId === item.id;
            const err = errorFor[item.id];
            return (
              <View key={item.id} style={[styles.card, !item.read_at && styles.cardUnread, open && styles.cardOpen]}>
                <TouchableOpacity
                  style={styles.cardMain}
                  activeOpacity={open ? 1 : 0.7}
                  disabled={open}
                  onPress={() => goToInboxSubject(item)}
                >
                  <View style={styles.iconWrap}>
                    <RivalIcon name={INBOX_ICON_FOR[item.kind]} size={17} color={RivalColors.accentText} />
                  </View>
                  <View style={styles.textWrap}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    {item.body ? <Text style={styles.cardBody}>{item.body}</Text> : null}
                    <Text style={styles.cardWhen}>{inboxTimeAgo(item.created_at)}</Text>
                  </View>
                </TouchableOpacity>

                {open && item.kind === 'join_request' ? (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => act(item, () => respondToJoinRequest(item, false))}
                    >
                      <BusyText busy={!!(busy)} style={styles.secondaryText}>{busy ? '…' : 'Decline'}</BusyText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.primary}
                      disabled={busy}
                      onPress={() => act(item, () => respondToJoinRequest(item, true))}
                    >
                      <BusyText busy={!!(busy)} style={styles.primaryText}>{busy ? '…' : 'Approve'}</BusyText>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {open && item.kind === 'short_activity' ? (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => act(item, () => respondToShortActivity(item, false))}
                    >
                      <BusyText busy={!!(busy)} style={styles.secondaryText}>{busy ? '…' : 'Remove'}</BusyText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.primary}
                      disabled={busy}
                      onPress={() => act(item, () => respondToShortActivity(item, true))}
                    >
                      <BusyText busy={!!(busy)} style={styles.primaryText}>{busy ? '…' : 'Keep'}</BusyText>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {open && item.kind === 'activity_tag' ? (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={styles.secondary}
                      disabled={busy}
                      onPress={() => act(item, () => respondToActivityTag(item, false))}
                    >
                      <BusyText busy={!!(busy)} style={styles.secondaryText}>{busy ? '…' : 'Decline'}</BusyText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.primary}
                      disabled={busy}
                      onPress={() => act(item, () => respondToActivityTag(item, true))}
                    >
                      <BusyText busy={!!(busy)} style={styles.primaryText}>{busy ? 'Confirming…' : 'Confirm'}</BusyText>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {open && item.kind === 'pace_review' ? (
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.secondary} disabled={busy} onPress={() => act(item, () => answerPaceReview(item, false))}>
                      <BusyText busy={!!(busy)} style={styles.secondaryText}>{busy ? '…' : 'Edit'}</BusyText>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => act(item, () => answerPaceReview(item, true))}>
                      <BusyText busy={!!(busy)} style={styles.primaryText}>{busy ? 'Saving…' : "It's correct"}</BusyText>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {err ? <Text style={styles.error}>{err}</Text> : null}

                {!open && !item.resolved_at ? (
                  <TouchableOpacity style={styles.clear} onPress={() => act(item, () => resolveItem(item.id, 'dismissed'))}>
                    <Text style={styles.clearText}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#131313' },
  content: { paddingHorizontal: 20, paddingBottom: 120, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  title: { ...RivalType.titleMd, fontFamily: RivalSerifFamily, color: '#fff' },
  state: { color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 30 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 60 },
  emptyTitle: { fontFamily: RivalSerifFamily, fontSize: 17, fontWeight: '700', color: '#fff' },
  emptyBody: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center' },

  card: {
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: RivalRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    padding: 14,
    gap: 10,
  },
  // Unread is a quiet left edge rather than a different background: the list
  // should not look like two kinds of thing.
  cardUnread: { borderLeftWidth: 2, borderLeftColor: RivalColors.accentFill },
  cardOpen: { borderColor: 'rgba(255,209,190,0.22)' },
  cardMain: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,209,190,0.10)',
  },
  textWrap: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 14.5, fontWeight: '600', color: '#fff' },
  cardBody: { fontSize: 13, color: RivalColors.textSecondary },
  cardWhen: { fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  actions: { flexDirection: 'row', gap: 10 },
  primary: {
    flex: 1, paddingVertical: 10, borderRadius: RivalRadius.md, alignItems: 'center',
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  },
  primaryText: { fontSize: 13.5, fontWeight: '700', color: RivalButtonColors.label('#2a1410') },
  secondary: {
    flex: 1, paddingVertical: 10, borderRadius: RivalRadius.md, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  secondaryText: { fontSize: 13.5, fontWeight: '600', color: RivalColors.textSecondary },
  error: { fontSize: 12, color: '#ff8f8f' },
  clear: { alignSelf: 'flex-start' },
  clearText: { fontSize: 12, color: 'rgba(255,255,255,0.45)', textDecorationLine: 'underline' },
});

// Phone: the pop-up style (see RivalGreySheet).
const m = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  content: { gap: 8, paddingBottom: 4 },
  card: {
    backgroundColor: RivalGhost.fill, borderRadius: 16,
    borderWidth: 1, borderColor: RivalGhost.border, padding: 13, gap: 12,
  },
  cardOpen: { borderColor: 'rgba(255,181,158,0.35)' },
  badge: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  dot: {
    position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: 4,
    backgroundColor: RivalColors.accentFill, borderWidth: 1.5, borderColor: RivalColors.surfaceLowest,
  },
  primary: { borderRadius: 999 },
  tag: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(217,119,87,0.15)' },
  tagText: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  secondary: { borderRadius: 999 },
  list: {
    backgroundColor: RivalGhost.fill, borderRadius: 16,
    borderWidth: 1, borderColor: RivalGhost.border, paddingHorizontal: 13,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowRule: { borderTopWidth: 1, borderTopColor: 'rgba(50,50,50,0.8)' },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
  rowTitle: { fontSize: 13.5, fontWeight: '600', color: '#fff' },
  rowBody: { fontSize: 12.5, color: RivalColors.textSecondary },
  when: { fontSize: 11.5, color: 'rgba(255,255,255,0.4)' },
  clear: { paddingLeft: 4, paddingVertical: 8 },
  empty: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8,
    backgroundColor: RivalGhost.fill, borderRadius: 16,
    borderWidth: 1, borderColor: RivalGhost.border, padding: 14,
  },
});
