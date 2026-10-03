import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { fetchInbox, isActionable, markRead, type InboxItem } from '../../lib/inbox';
import { RivalColors, RivalFontFamily, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, type RivalIconName } from './RivalIcon';
import { goToTab } from '../../lib/tabNav';
import { stravaSharingNeedsAnswer, STRAVA_SHARING_NOTICE } from '../../lib/stravaSharing';

// The bell's dropdown on phones: the latest few notifications at a glance,
// with "See all" leading to the full Notifications page. Anything that needs
// an answer (a join request, a tag, a short activity) is answered on that
// page, where there is room for the buttons — here it just says so.

export const INBOX_ICON_FOR: Record<InboxItem['kind'], RivalIconName> = {
  reaction: 'star',
  comment: 'reply',
  join_request: 'groups',
  short_activity: 'timerOutline',
  team_joined: 'checkCircle',
  activity_tag: 'groups',
  tag_accepted: 'verified',
  pace_review: 'bolt',
};

export function inboxTimeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// Where tapping an informational notification goes.
export function goToInboxSubject(item: InboxItem) {
  if (item.kind === 'reaction' || item.kind === 'comment') goToTab('/team-feed');
  else if (item.kind === 'team_joined' || item.kind === 'join_request') router.push('/team-hub');
  else if (item.kind === 'tag_accepted') goToTab('/my-activities');
}

const SHOWN = 6;
const TAB_PAD = 6;
const PANEL = '#1d1714';

// Applied inline, never through StyleSheet.create: react-native-web's style
// validation deletes animationName from a stylesheet (and logs an error), but
// passes an inline style through. The keyframes live in global.css.
const MENU_IN: any = Platform.OS === 'web'
  ? { animationName: 'rivalMenuIn', animationDuration: '180ms', animationTimingFunction: 'cubic-bezier(0.2, 0.9, 0.3, 1)', transformOrigin: 'top right' }
  : null;

type Anchor = { left: number; top: number; width: number; height: number; barBottom: number };

export function NotificationsMenu({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [stravaPending, setStravaPending] = useState(false);
  useEffect(() => { stravaSharingNeedsAnswer().then(setStravaPending, () => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    fetchInbox(SHOWN).then((rows) => {
      if (cancelled) return;
      // Open questions first, then newest — the same order as the full page.
      const sorted = [...rows].sort((a, b) =>
        (isActionable(a) ? 0 : 1) - (isActionable(b) ? 0 : 1)
        || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setItems(sorted);
      // Seeing an informational item here counts as reading it.
      const seen = rows.filter((r) => !r.read_at && !isActionable(r)).map((r) => r.id);
      if (seen.length) markRead(seen);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = (item: InboxItem) => {
    onClose();
    if (isActionable(item)) router.push('/inbox');
    else goToInboxSubject(item);
  };

  const unread = (items ?? []).filter((i) => !i.read_at || isActionable(i)).length + (stravaPending ? 1 : 0);

  const menu = (
    <View style={styles.layer}>
      {/* Tap anywhere outside to close. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close notifications" />
      {/* The bell, lifted into a tab the same colour as the panel, so the
          panel reads as opening out of the button rather than floating. */}
      <Pressable
        style={[styles.tab, { left: anchor.left - TAB_PAD, top: anchor.top - TAB_PAD, width: anchor.width + TAB_PAD * 2, height: anchor.barBottom - anchor.top + TAB_PAD }]}
        onPress={onClose}
        accessibilityLabel="Close notifications"
      >
        <View style={{ height: anchor.height + TAB_PAD * 2, alignItems: 'center', justifyContent: 'center' }}>
          <RivalIcon name="notifications" size={21} color={RivalColors.accentText} />
        </View>
      </Pressable>
      <View style={[styles.menu, { top: anchor.barBottom }, MENU_IN]} accessibilityRole="menu">
        <View style={styles.head}>
          <Text style={styles.title}>Notifications</Text>
          {unread > 0 ? <Text style={styles.newCount}>{unread} new</Text> : null}
        </View>

        {stravaPending && (
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => { onClose(); STRAVA_SHARING_NOTICE.open(); }}>
            <View style={styles.iconWrap}>
              <RivalIcon name="groups" size={15} color={RivalColors.accentText} />
            </View>
            <View style={styles.text}>
              <Text style={styles.rowTitle} numberOfLines={2}>{STRAVA_SHARING_NOTICE.title}</Text>
              <Text style={styles.when}><Text style={styles.needsAnswer}>Needs a reply</Text></Text>
            </View>
            <View style={styles.dot} />
          </TouchableOpacity>
        )}
        {items === null ? (
          <Text style={styles.state}>Loading…</Text>
        ) : items.length === 0 ? (
          stravaPending ? null :
          <View style={styles.empty}>
            <RivalIcon name="notificationsOutline" size={22} color={RivalColors.accentText} />
            <Text style={styles.state}>No notifications yet</Text>
          </View>
        ) : (
          items.map((item, i) => {
            const needsAnswer = isActionable(item);
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.row, (i > 0 || stravaPending) && styles.rowDivider]}
                activeOpacity={0.7}
                onPress={() => open(item)}
              >
                <View style={styles.iconWrap}>
                  <RivalIcon name={INBOX_ICON_FOR[item.kind]} size={15} color={RivalColors.accentText} />
                </View>
                <View style={styles.text}>
                  <Text style={[styles.rowTitle, item.read_at && !needsAnswer && styles.rowTitleRead]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.when}>
                    {needsAnswer ? <Text style={styles.needsAnswer}>Needs a reply · </Text> : null}
                    {inboxTimeAgo(item.created_at)}
                  </Text>
                </View>
                {!item.read_at || needsAnswer ? <View style={styles.dot} /> : null}
              </TouchableOpacity>
            );
          })
        )}

        <TouchableOpacity style={styles.footer} onPress={() => { onClose(); router.push('/inbox'); }}>
          <Text style={styles.footerText}>See all</Text>
          <RivalIcon name="chevronRight" size={16} color={RivalColors.accentText} />
        </TouchableOpacity>
      </View>
    </View>
  );

  // Portaled like the bottom nav pill, so it sits above every screen's content.
  if (Platform.OS === 'web' && typeof document !== 'undefined') return createPortal(menu, document.body);
  return menu;
}

const styles = StyleSheet.create({
  layer: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    top: 0, left: 0, right: 0, bottom: 0, zIndex: 9000,
  },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  // Flush with the right edge of the screen and the bottom of the bar: square
  // on the two sides it meets, rounded only where it hangs free.
  menu: {
    position: 'absolute', right: 0, width: 344, maxWidth: '96%' as any,
    backgroundColor: PANEL,
    borderBottomLeftRadius: 18,
    borderLeftWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,209,190,0.12)',
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? ({ boxShadow: '-10px 18px 36px rgba(0,0,0,0.5)' } as any) : {}),
  },
  tab: {
    position: 'absolute', backgroundColor: PANEL,
    borderTopLeftRadius: 14, borderTopRightRadius: 14,
    borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(255,209,190,0.12)',
    zIndex: 1,
  },
  head: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 18, color: '#fff' },
  newCount: {
    fontFamily: RivalFontFamily, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2,
    textTransform: 'uppercase', color: RivalColors.accentText,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  iconWrap: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,209,190,0.10)',
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: RivalFontFamily, fontSize: 13.5, lineHeight: 18, fontWeight: '600', color: '#fff' },
  rowTitleRead: { color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  when: { fontFamily: RivalFontFamily, fontSize: 11.5, color: 'rgba(255,255,255,0.4)' },
  needsAnswer: { color: RivalColors.accentText, fontWeight: '700' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: RivalColors.accentFill },
  state: { fontFamily: RivalFontFamily, fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', paddingVertical: 8 },
  empty: { alignItems: 'center', gap: 4, paddingVertical: 20 },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,209,190,0.04)',
  },
  footerText: { fontFamily: RivalFontFamily, fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
});
