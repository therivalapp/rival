import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalColors, RivalGhost, RivalSerifFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyPageHead, GREY_PAGE_BG, RivalIcon, RivalAvatar } from '../components/rival';
import { GreyLabel } from '../components/rival/RivalGreySheet';
import { supabase } from '../lib/supabase';
import { goToTab } from '../lib/tabNav';
import { formatDisplayName } from '../lib/identity';
import { useBlockedIds, unblockMember } from '../lib/safety';

// Blocked members (Report and block, Mockup 27 v8, panel F), from Settings,
// More. Unblock brings their posts and messages back straight away.

type Person = { id: string; name: string; avatar: string | null };

export default function BlockedMembersScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const back = () => (router.canGoBack() ? router.back() : goToTab('/home'));
  const blocked = useBlockedIds();
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ids = [...blocked];
  const key = ids.sort().join(',');

  useEffect(() => {
    const missing = ids.filter((i) => !people[i]);
    if (missing.length === 0) return;
    supabase.from('users').select('id, display_name, avatar_url').in('id', missing).then(({ data }) => {
      const next: Record<string, Person> = {};
      (data ?? []).forEach((u: { id: string; display_name: string | null; avatar_url: string | null }) => {
        next[u.id] = { id: u.id, name: formatDisplayName(u) || 'Member', avatar: u.avatar_url };
      });
      setPeople((p) => ({ ...p, ...next }));
    });
  }, [key]);

  async function unblock(id: string) {
    setBusy(id);
    setError(null);
    const msg = await unblockMember(id);
    setBusy(null);
    if (msg) setError(msg);
  }

  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <GreyPageHead kicker="SETTINGS" title="Blocked members" sub="Hidden from the feed and chats." onBack={back} />
        {ids.length > 0 ? (
          <>
            <GreyLabel>Blocked</GreyLabel>
            <View style={s.card}>
              {ids.map((id, i) => {
                const p = people[id];
                return (
                  <View key={id} style={[s.row, i > 0 && s.rowLine]}>
                    <RivalAvatar uri={p?.avatar ?? null} name={p?.name ?? ''} size={34} />
                    <Text style={s.name} numberOfLines={1}>{p?.name ?? ' '}</Text>
                    <TouchableOpacity onPress={() => unblock(id)} disabled={busy === id} hitSlop={8} accessibilityRole="button">
                      <Text style={[s.unblock, busy === id && { opacity: 0.5 }]}>Unblock</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            {error ? <Text style={s.error}>{error}</Text> : null}
          </>
        ) : (
          <View style={s.empty}>
            <RivalIcon name="block" size={34} color="rgba(255,181,158,0.35)" />
            <Text style={s.emptyTitle}>No blocked members</Text>
            <Text style={s.emptySub}>Block a member from their post, message or profile.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  pageWide: { backgroundColor: RivalColors.surfaceContainer },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 120 },
  card: { backgroundColor: RivalGhost.fill, borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border, paddingHorizontal: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58 },
  rowLine: { borderTopWidth: 1, borderTopColor: RivalGhost.hairline },
  name: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: '#fff' },
  unblock: { fontSize: 14, fontWeight: '700', color: RivalColors.accentText },
  error: { fontSize: 12.5, lineHeight: 17, color: RivalColors.error, marginTop: 10 },
  empty: {
    marginTop: 22, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.22)',
    paddingVertical: 22, paddingHorizontal: 16, alignItems: 'center',
  },
  emptyTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: '#fff', marginTop: 6 },
  emptySub: { fontSize: 12.5, color: RivalColors.textSecondary, marginTop: 3, textAlign: 'center' },
});
