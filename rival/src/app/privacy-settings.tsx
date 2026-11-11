import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalColors, RivalFontFamily } from '../constants/rivalTheme';
import { sidePageWide } from '../constants/breakpoints';
import { GreyPageHead, GREY_PAGE_BG, RivalIcon } from '../components/rival';
import { GreyField, GreyLabel, GreyPrimary, GreyRow, GreyRows } from '../components/rival/RivalGreySheet';
import { supabase, getAuthUser } from '../lib/supabase';
import { goBack } from '../lib/tabNav';
import { getBlockedIds } from '../lib/safety';
import { loadStravaSharing, setShareRoutes } from '../lib/stravaSharing';
import { displayToIsoDate, maskDateInput } from '../lib/dateFormat';

// Privacy (Mockup 34, approved 2026-11-11 with Ricky's changes): what
// teammates can see, in one place. Birthday, the team chat switches, route
// maps, Team visibility (the sharing explainer), blocked members, the data
// download and the privacy policy. Birthdays stay off until turned on: the
// privacy policy said the date of birth is never shown. Teams only ever see
// the day and month (team_birthdays in privacy_settings.sql).

type Prefs = { birthday_visible: boolean; chat_milestones: boolean; read_receipts: boolean };

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: RivalColors.surfaceContainerHigh, true: RivalColors.accentFill }}
      thumbColor="#ffffff"
      accessibilityLabel={label}
      {...(Platform.OS === 'web' ? ({ activeThumbColor: '#ffffff' } as any) : {})}
    />
  );
}

const chevron = <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />;

export default function PrivacySettingsScreen() {
  const phone = !sidePageWide(useWindowDimensions().width);
  const [userId, setUserId] = useState('');
  const [prefs, setPrefs] = useState<Prefs>({ birthday_visible: false, chat_milestones: true, read_receipts: true });
  const [birthday, setBirthday] = useState<string | null | undefined>(undefined);
  const [routes, setRoutes] = useState(false);
  const [blocked, setBlocked] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      setUserId(user.id);
      const [{ data: row }, { data: dob }, sharing, ids] = await Promise.all([
        supabase.from('users').select('birthday_visible, chat_milestones, read_receipts').eq('id', user.id).maybeSingle(),
        supabase.rpc('my_birthday'),
        loadStravaSharing(),
        getBlockedIds(),
      ]);
      if (row) setPrefs(row as Prefs);
      setBirthday((dob as string | null) ?? null);
      setRoutes(!!sharing?.shareRoutes);
      setBlocked(ids.size);
    })();
  }, []);

  async function save(patch: Partial<Prefs>) {
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    setError(null);
    const { data, error: e } = await supabase.from('users').update(patch).eq('id', userId).select('id');
    if (e || !data?.length) { setPrefs(before); setError('The change could not be saved. Try again.'); }
  }

  async function saveRoutes(v: boolean) {
    setRoutes(v);
    const res = await setShareRoutes(v);
    if (!res.ok) { setRoutes(!v); setError(res.error ?? 'The change could not be saved. Try again.'); }
  }

  async function saveBirthday() {
    const iso = displayToIsoDate(draft);
    if (!iso) { setError('Enter the date as DD/MM/YYYY.'); return; }
    setSaving(true);
    setError(null);
    // Written, never read back directly: the column is not readable by the app.
    const { data, error: e } = await supabase.from('users').update({ date_of_birth: iso }).eq('id', userId).select('id');
    setSaving(false);
    if (e || !data?.length) { setError('The birthday could not be saved. Try again.'); return; }
    setBirthday(iso);
    setEditing(false);
  }

  const birthdayText = birthday
    ? new Date(`${birthday}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : undefined;

  return (
    <SafeAreaView style={[s.page, !phone && s.pageWide]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <GreyPageHead kicker="SETTINGS" title="Privacy" sub="What teammates can see." onBack={() => goBack('/profile' as any)} />

        <GreyLabel>Birthday</GreyLabel>
        <GreyRows>
          {birthday === null && !editing ? (
            <GreyRow icon="cake" label="Birthday" placeholder="Add" onPress={() => setEditing(true)} />
          ) : birthday === null && editing ? (
            <View style={s.editBox}>
              <GreyField
                value={draft}
                onChangeText={(t: string) => setDraft(maskDateInput(t))}
                placeholder="DD/MM/YYYY"
                keyboardType="number-pad"
                maxLength={10}
                autoFocus
              />
              <GreyPrimary label="Save" busy={saving} disabled={saving || draft.length < 10} onPress={saveBirthday} />
            </View>
          ) : (
            <GreyRow icon="cake" label="Birthday" value={birthdayText} />
          )}
          <View>
            <GreyRow icon="groups" label="Teammates can see my birthday">
              <Toggle value={prefs.birthday_visible} onChange={(v) => save({ birthday_visible: v })} label="Teammates can see my birthday" />
            </GreyRow>
            <Text style={s.note}>Day and month only. Never the year.</Text>
          </View>
        </GreyRows>

        <GreyLabel>Team chats</GreyLabel>
        <GreyRows>
          <View>
            <GreyRow icon="celebration" label="Milestones about me">
              <Toggle value={prefs.chat_milestones} onChange={(v) => save({ chat_milestones: v })} label="Milestones about me" />
            </GreyRow>
            <Text style={s.note}>Rank ups, hours, race days and results as cards in team chats.</Text>
          </View>
          <View>
            <GreyRow icon="doneAll" label="Read receipts">
              <Toggle value={prefs.read_receipts} onChange={(v) => save({ read_receipts: v })} label="Read receipts" />
            </GreyRow>
            <Text style={s.note}>Off: teammates don&rsquo;t see when you&rsquo;ve read, and you don&rsquo;t see theirs.</Text>
          </View>
        </GreyRows>

        <GreyLabel>Activities</GreyLabel>
        <GreyRows>
          <View>
            <GreyRow icon="map" label="Route maps">
              <Toggle value={routes} onChange={saveRoutes} label="Route maps" />
            </GreyRow>
            <Text style={s.note}>A route can show where you live or train. Off unless turned on.</Text>
          </View>
          <GreyRow icon="share" label="Team visibility" onPress={() => router.push('/team-sharing')}>{chevron}</GreyRow>
        </GreyRows>

        <GreyLabel>People and data</GreyLabel>
        <GreyRows>
          <GreyRow icon="block" label="Blocked members" value={String(blocked)} onPress={() => router.push('/blocked-members' as any)} />
          <GreyRow icon="download" label="Download data" onPress={() => router.push({ pathname: '/profile', params: { tab: 'account' } } as any)}>{chevron}</GreyRow>
          <GreyRow icon="description" label="Privacy policy" onPress={() => router.push('/privacy')}>{chevron}</GreyRow>
        </GreyRows>

        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  pageWide: { backgroundColor: RivalColors.surfaceContainer },
  content: { maxWidth: 560, width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 120 },
  note: { fontFamily: RivalFontFamily, fontSize: 12, lineHeight: 16, color: '#8f8a85', paddingLeft: 28, paddingBottom: 11, marginTop: -4 },
  editBox: { paddingVertical: 12, gap: 10 },
  error: { fontFamily: RivalFontFamily, fontSize: 13, color: RivalColors.error, marginTop: 12, textAlign: 'center' },
});
