import { useSnapState } from '../lib/snapState';
import { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  type InboxItem,
} from '@/lib/inbox';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import { RivalBackButton, RivalIcon, RivalTopNav } from '@/components/rival';
import { INBOX_ICON_FOR, goToInboxSubject, inboxTimeAgo } from '@/components/rival/NotificationsMenu';
import { RivalButtonColors, RivalColors, RivalRadius, RivalSerifFamily, RivalType } from '@/constants/rivalTheme';

// The inbox. Items are answered where they sit rather than sending you off to
// another screen to find the thing they are about — a notification you have to
// go hunting after is just a reminder that you have work to do.

export default function InboxScreen() {
  const [items, setItems] = useSnapState<InboxItem[]>('inbox.items', []);
  const [loading, setLoading] = useSnapState('inbox.loading', true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorFor, setErrorFor] = useState<Record<string, string>>({});

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

  useFocusEffect(useCallback(() => { load(); }, [load]));
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

  const unresolvedFirst = [...items].sort((a, b) => {
    const aOpen = isActionable(a) ? 0 : 1;
    const bOpen = isActionable(b) ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav />
      <ScrollView contentContainerStyle={styles.content} {...pullProps}>
        {pullIndicator}

        <View style={styles.header}>
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} />
          <Text style={styles.title}>Notifications</Text>
        </View>

        {loading ? (
          <Text style={styles.state}>Loading…</Text>
        ) : unresolvedFirst.length === 0 ? (
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
                      <Text style={styles.secondaryText}>{busy ? '…' : 'Decline'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.primary}
                      disabled={busy}
                      onPress={() => act(item, () => respondToJoinRequest(item, true))}
                    >
                      <Text style={styles.primaryText}>{busy ? '…' : 'Approve'}</Text>
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
                      <Text style={styles.secondaryText}>{busy ? '…' : 'Remove'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.primary}
                      disabled={busy}
                      onPress={() => act(item, () => respondToShortActivity(item, true))}
                    >
                      <Text style={styles.primaryText}>{busy ? '…' : 'Keep'}</Text>
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
                      <Text style={styles.secondaryText}>{busy ? '…' : 'Decline'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.primary}
                      disabled={busy}
                      onPress={() => act(item, () => respondToActivityTag(item, true))}
                    >
                      <Text style={styles.primaryText}>{busy ? '…' : 'Confirm'}</Text>
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
