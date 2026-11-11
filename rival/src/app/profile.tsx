import { invalidateActivityCache } from '../lib/fetchAllActivities';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Switch, TouchableOpacity, View, Text, TextInput, ScrollView, Image, Platform, useWindowDimensions } from 'react-native';
import { Modal } from '../components/rival/RivalModal';
import { usePullToRefresh } from '@/components/rival/usePullToRefresh';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { selectAll } from '../lib/selectAll';
import { notify } from '../lib/notify';
import { ROUTE_MAPS_ENABLED } from '../lib/features';
import { squareImage } from '../lib/imageResize';
import { getQuote, QuoteTone } from '../lib/quotes';
import { usePrefs, updatePrefs, type NotifyKey, type UnitSystem } from '../lib/prefs';
import { openFeedback } from '../lib/feedback';
import { healthAvailable, useHealthStatus, syncHealth } from '../lib/appleHealth';
import { buildArchive } from '../lib/archive';
import { buildDataExport, saveJsonFile } from '../lib/exportData';
import { RivalButton, RivalCard, RivalIcon, RivalIconName, RivalTopNav, RivalBackButton, invalidateNavIdentity } from '../components/rival';
import { RivalColors, RivalRadius, RivalType, RivalButtonColors, RivalGhost } from '../constants/rivalTheme';
import { sidePageWide, BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { BusyText } from '../components/rival/BusyText';
import { GreyRows, GreyRow, GreyLabel, GreySheet, GreyPrimary, GreyNote, GreyTiles } from '../components/rival/RivalGreySheet';
import { RivalSerifFamily } from '../constants/rivalTheme';
import { goBack, goToTab } from '../lib/tabNav';
import { avatarImage } from '../lib/imageUrl';

const UNIT_OPTIONS: Array<{ value: UnitSystem; label: string; sub: string }> = [
  { value: 'metric', label: 'Metric', sub: 'Kilometres, metres and kilograms.' },
  { value: 'imperial', label: 'Imperial', sub: 'Miles, feet and pounds.' },
];

// Informational notifications a person can switch off. Questions that need an
// answer are always shown, so nobody is left waiting on a reply.
const NOTIFY_OPTIONS: Array<{ key: NotifyKey; label: string; sub: string }> = [
  { key: 'reaction', label: 'Respect and Inspired', sub: 'When someone recognises an activity.' },
  { key: 'comment', label: 'Comments', sub: 'When someone comments on an activity.' },
  { key: 'tag_accepted', label: 'Activity partners', sub: 'When someone confirms they trained with you.' },
  { key: 'team_joined', label: 'Team updates', sub: 'When a team approves a request, and when someone joins a team.' },
];

const QUOTE_TONES: Array<{ value: QuoteTone; label: string; sub: string }> = [
  { value: 'blunt', label: 'Blunt', sub: 'Hard truths, no cushioning.' },
  { value: 'balanced', label: 'Balanced', sub: 'A mix of tough and supportive.' },
  { value: 'encouraging', label: 'Encouraging', sub: 'Warm, patient, always in your corner.' },
];

type TabId = 'personal' | 'preferences' | 'apps' | 'notifications' | 'account';
const TABS: Array<{ id: TabId; label: string; icon: RivalIconName }> = [
  { id: 'personal', label: 'Personal Info', icon: 'person' },
  { id: 'preferences', label: 'Preferences', icon: 'tune' },
  { id: 'apps', label: 'Connected devices', icon: 'link' },
  { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  { id: 'account', label: 'Account', icon: 'settings' },
];

// Apple Health (2026-11-10): connect once, every past workout comes in, then
// new ones whenever the app opens (lib/appleHealth.ts). iPhone app only.
function HealthRow() {
  const health = useHealthStatus();
  if (!healthAvailable) {
    return (
      <View style={styles.comingSoonRow}>
        <View style={styles.appRowLeft}>
          <RivalIcon name="health" size={18} color={RivalColors.accentText} />
          <View>
            <Text style={styles.appName}>Apple Health</Text>
            <Text style={styles.appStatus}>Available in the iPhone app</Text>
          </View>
        </View>
      </View>
    );
  }
  const ago = (t: number | null) => {
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'Synced just now' : m < 60 ? `Synced ${m} min ago` : m < 1440 ? `Synced ${Math.round(m / 60)} h ago` : `Synced ${new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  };
  const status = health.state === 'syncing' ? 'Syncing…'
    : health.state === 'connected' ? ['Connected', ago(health.lastSync)].filter(Boolean).join(' · ')
      : health.state === 'error' ? health.message : 'Workouts from Apple Watch and other apps';
  const action = health.state === 'off' ? 'Connect' : health.state === 'error' ? 'Try again' : health.state === 'connected' ? 'Sync' : null;
  return (
    <TouchableOpacity
      style={[styles.appRow, { marginTop: 12 }]}
      disabled={health.state === 'syncing'}
      onPress={() => (health.state === 'off' ? router.push('/apple-health' as any) : syncHealth())}
      activeOpacity={0.8}
    >
      <View style={[styles.appRowLeft, { flex: 1, minWidth: 0 }]}>
        <RivalIcon name="health" size={18} color={RivalColors.accentText} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.appName}>Apple Health</Text>
          <Text style={styles.appStatus}>{status}</Text>
        </View>
      </View>
      {action ? <Text style={styles.healthAction}>{action}</Text> : <ActivityIndicator color={RivalColors.accentText} />}
    </TouchableOpacity>
  );
}

// A switch in the Settings menu's row style.
function MenuSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: RivalColors.surfaceContainerHigh, true: RivalColors.accentFill }}
      thumbColor="#ffffff"
      {...(Platform.OS === 'web' ? ({ activeThumbColor: '#ffffff' } as any) : {})}
    />
  );
}

// Names are saved as one display name ("First Last"); the first word is the
// first name and the rest the last name, matching sign-up.
function splitName(name: string): { first: string; last: string } {
  const parts = (name || '').trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

export default function ProfileScreen() {
  const { userId: viewedUserId, tab: tabParam } = useLocalSearchParams<{ userId?: string; tab?: TabId }>();
  const { width: windowWidth } = useWindowDimensions();
  const wide = sidePageWide(windowWidth);

  const [currentAuthUserId, setCurrentAuthUserId] = useState('');
  const isOwnProfile = !viewedUserId || viewedUserId === currentAuthUserId;

  // Viewing someone else's profile is a stats view, not a settings view —
  // bounce to their stats page. Settings only ever apply to your own account.
  useEffect(() => {
    if (viewedUserId) router.replace({ pathname: '/stats', params: { userId: viewedUserId } });
  }, [viewedUserId]);

  const [activeTab, setActiveTab] = useState<TabId>(
    tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'personal'
  );
  // Mobile shows the menu and the chosen panel as two separate screens, so a
  // panel never has to share the viewport with the list that opened it. Wide
  // layouts ignore this entirely — there the sidebar and panel sit together.
  // A ?tab= deep link opens straight to that panel.
  const [panelOpen, setPanelOpen] = useState(!!(tabParam && TABS.some(t => t.id === tabParam)));

  const [displayName, setDisplayName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [bio, setBio] = useState('');
  const [newBio, setNewBio] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [quoteTone, setQuoteTone] = useState<QuoteTone>('balanced');
  const [savingTone, setSavingTone] = useState(false);
  const [quotePreview, setQuotePreview] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [memberSince, setMemberSince] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const prefs = usePrefs();
  const [prefError, setPrefError] = useState<string | null>(null);
  const [myTeams, setMyTeams] = useState<Array<{ id: string; name: string }>>([]);
  // Account changes
  const [newEmail, setNewEmail] = useState('');
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [exporting, setExporting] = useState<'data' | 'all' | null>(null);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);


  useEffect(() => {
    loadProfile();
  }, []);

  const { scrollProps: pullProps, indicator: pullIndicator } = usePullToRefresh(() => loadProfile());

  async function loadProfile() {
    const { data: { user } } = await getAuthUser();
    if (!user) { setLoading(false); return; }
    setCurrentAuthUserId(user.id);

    setEmail(user.email ?? '');
    if (user.created_at) {
      const d = new Date(user.created_at);
      setMemberSince(d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }

    const [userRes, memberRes] = await Promise.all([
      supabase.from('users').select('display_name, is_admin, avatar_url, bio, quote_tone').eq('id', user.id).single(),
      supabase.from('league_members').select('league_id').eq('user_id', user.id).eq('status', 'active'),
    ]);
    const teamIds = (memberRes.data ?? []).map((m: any) => m.league_id);
    if (teamIds.length) {
      supabase.from('leagues').select('id, name').in('id', teamIds).then(({ data }) => {
        setMyTeams(((data ?? []) as Array<{ id: string; name: string }>).sort((a, b) => a.name.localeCompare(b.name)));
      });
    } else {
      setMyTeams([]);
    }

    const name = userRes.data?.display_name || user.user_metadata?.display_name || '';
    setDisplayName(name);
    setNewFirst(splitName(name).first);
    setNewLast(splitName(name).last);
    setIsAdmin(!!userRes.data?.is_admin);
    setAvatarUrl(userRes.data?.avatar_url || null);
    setBio(userRes.data?.bio || '');
    setNewBio(userRes.data?.bio || '');
    setQuoteTone((userRes.data?.quote_tone as QuoteTone) || 'balanced');

    setLoading(false);
  }

  async function saveName() {
    const newName = `${newFirst.trim()} ${newLast.trim()}`.trim();
    if (!newFirst.trim() || !newLast.trim()) { notify('Name needed', 'Enter a first and last name.'); return; }
    setSaving(true);
    const { data: { user } } = await getAuthUser();
    if (!user) { setSaving(false); return; }
    const { error } = await supabase.from('users').update({ display_name: newName }).eq('id', user.id);
    if (error) {
      // Don't advance the UI past a write that didn't land — showing the new
      // name while the row still holds the old one is worse than an error.
      notify("Couldn't save name", error.message);
      setSaving(false);
      return;
    }
    await supabase.auth.updateUser({ data: { display_name: newName } });
    invalidateNavIdentity();
    setDisplayName(newName);
    setEditingName(false);
    setSaving(false);
  }

  async function saveBio() {
    const trimmed = newBio.trim();
    setSavingBio(true);
    const { data: { user } } = await getAuthUser();
    if (!user) { setSavingBio(false); return; }
    const { error } = await supabase.from('users').update({ bio: trimmed || null }).eq('id', user.id);
    if (error) { notify("Mindset not saved", error.message); setSavingBio(false); return; }
    setBio(trimmed);
    setNewBio(trimmed);
    setSavingBio(false);
  }

  async function updateQuoteTone(tone: QuoteTone) {
    setSavingTone(true);
    const { data: { user } } = await getAuthUser();
    if (!user) { setSavingTone(false); return; }
    const { error } = await supabase.from('users').update({ quote_tone: tone }).eq('id', user.id);
    if (error) {
      notify("Couldn't save that preference", error.message);
      setSavingTone(false);
      return;
    }
    setQuoteTone(tone);
    setQuotePreview(getQuote(tone).text);
    setSavingTone(false);
  }

  async function savePref(patch: Parameters<typeof updatePrefs>[0]) {
    setPrefError(null);
    const res = await updatePrefs(patch);
    if (!res.ok) setPrefError(`The change was not saved: ${res.error}`);
  }

  async function changeEmail() {
    const next = newEmail.trim().toLowerCase();
    setEmailMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { setEmailMsg({ ok: false, text: 'Enter a valid email address.' }); return; }
    if (next === email.toLowerCase()) { setEmailMsg({ ok: false, text: 'That is already the email on this account.' }); return; }
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: next });
    setSavingEmail(false);
    if (error) { setEmailMsg({ ok: false, text: error.message }); return; }
    setNewEmail('');
    setEmailMsg({ ok: true, text: `A confirmation link has been sent. The email changes once the link in that message is opened.` });
  }

  async function changePassword() {
    setPasswordMsg(null);
    if (newPassword.length < 8) { setPasswordMsg({ ok: false, text: 'Use at least 8 characters.' }); return; }
    if (newPassword !== confirmPassword) { setPasswordMsg({ ok: false, text: 'The two passwords do not match.' }); return; }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) { setPasswordMsg({ ok: false, text: error.message }); return; }
    setNewPassword('');
    setConfirmPassword('');
    setPasswordMsg({ ok: true, text: 'Password updated.' });
  }

  // Two choices (Ricky, 2026-10-24): the data alone, a small file that is
  // quick to save, or the data with every photo and video, as a .zip.
  async function downloadData(withMedia: boolean) {
    setExportMsg(null);
    setExporting(withMedia ? 'all' : 'data');
    try {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      if (Platform.OS !== 'web') {
        setExportMsg({ ok: false, text: 'Downloading is only available in the web app for now.' });
        return;
      }
      if (!withMedia) {
        const { json, problems } = await buildDataExport(user.id, user.email ?? null);
        saveJsonFile(json, `rival-data-${new Date().toISOString().slice(0, 10)}.json`);
        setExportMsg(problems.length
          ? { ok: false, text: `Downloaded, but ${problems.length} section${problems.length === 1 ? '' : 's'} could not be read. The file lists which.` }
          : { ok: true, text: 'Downloaded.' });
        return;
      }
      // The whole archive, photos and videos included, not only the data
      // (Ricky, 2026-10-24).
      const c = await buildArchive(user.id, user.email ?? null, (done, total) => setExportMsg({ ok: true, text: `Saving photos and videos: ${done} of ${total}` }));
      const parts = [`${c.activities.toLocaleString()} ${c.activities === 1 ? 'activity' : 'activities'}`, `${c.photos.toLocaleString()} ${c.photos === 1 ? 'photo' : 'photos'}`];
      if (c.videos) parts.push(`${c.videos.toLocaleString()} ${c.videos === 1 ? 'video' : 'videos'}`);
      setExportMsg({ ok: true, text: `Downloaded: ${parts.join(', ')}.` });
    } catch (e: any) {
      setExportMsg({ ok: false, text: `The download could not be prepared: ${e?.message ?? 'unknown error'}` });
    } finally {
      setExporting(null);
    }
  }

  async function uploadAvatar() {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingAvatar(true);
      try {
        const { data: { user } } = await getAuthUser();
        if (!user) return;
        const image = await squareImage(file);
        const resized = image !== file;
        const ext = resized ? 'jpg' : (file.name.split('.').pop() || 'jpg');
        const path = `${user.id}/avatar.${ext}`;
        const { error: storageErr } = await supabase.storage
          .from('avatars')
          .upload(path, image, { contentType: resized ? 'image/jpeg' : file.type, upsert: true });
        if (!storageErr) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
          // Same path every time, so a version stamp makes phones fetch the new
          // photo instead of showing the cached old one.
          urlData.publicUrl = `${urlData.publicUrl}?v=${Date.now()}`;
          // The file uploaded, but the row still has to point at it — if this
          // half fails the photo is orphaned in storage and the profile keeps
          // the old avatar, so say so rather than showing the new one.
          const { error: rowErr } = await supabase.from('users').update({ avatar_url: urlData.publicUrl }).eq('id', user.id);
          invalidateNavIdentity();
          if (rowErr) {
            notify("Couldn't update photo", rowErr.message);
          } else {
            setAvatarUrl(urlData.publicUrl);
          }
        }
      } finally {
        setUploadingAvatar(false);
      }
    };
    input.click();
  }

  async function handleSignOut() {
    invalidateNavIdentity();
    await supabase.auth.signOut();
    router.replace('/');
  }

  async function handleDeleteAccount() {
    // Typed confirmation ("DELETE") — a tap-through dialog is too easy to
    // fat-finger for something this permanent. window.prompt because
    // Alert.alert button callbacks don't fire on web.
    const typed = Platform.OS === 'web'
      ? window.prompt(
          'This permanently deletes your account: all activities, teams you\'re in, ' +
          'photos, events, goals, and history. Teams you created will be handed to ' +
          'another member (or deleted if empty). This cannot be undone.\n\n' +
          'Type DELETE to confirm.'
        )
      : null; // native flow needs a custom modal — web-only until the iOS build exists
    if (typed !== 'DELETE') return;

    setDeletingAccount(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const data = await res.json();
      if (!res.ok || !data.deleted) {
        notify("Couldn't delete account", data.error || 'Try again or contact support.');
        return;
      }
      invalidateNavIdentity();
    await supabase.auth.signOut();
      router.replace('/');
    } catch {
      notify("Couldn't delete account", 'Could not reach the server. Try again.');
    } finally {
      setDeletingAccount(false);
    }
  }

  if (loading || !isOwnProfile) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const bioDirty = newBio.trim() !== bio;

  // ---- Tab panels ----------------------------------------------------------

  const personalPanel = (
    <RivalCard glass style={styles.panel}>
      <View style={[styles.personalTop, wide && styles.personalTopWide]}>
        <TouchableOpacity onPress={uploadAvatar} disabled={uploadingAvatar} style={styles.avatarWrap}>
          <View style={styles.avatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarImage(avatarUrl, 120) }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{displayName ? displayName[0].toUpperCase() : '?'}</Text>
            )}
          </View>
          {/* The word, not a pencil (AGENTS.md: Edit is the word Edit). */}
          <BusyText busy={uploadingAvatar} style={styles.editWord}>{uploadingAvatar ? 'Uploading…' : 'Edit photo'}</BusyText>
        </TouchableOpacity>

        <View style={styles.fieldsCol}>
          {/* Name: first and last, as on sign-up */}
          {(['first', 'last'] as const).map((part) => {
            const value = part === 'first' ? newFirst : newLast;
            const setValue = part === 'first' ? setNewFirst : setNewLast;
            const shown = splitName(displayName)[part];
            return (
              <View style={styles.field} key={part}>
                <Text style={styles.fieldLabel}>{part === 'first' ? 'FIRST NAME' : 'LAST NAME'}</Text>
                {editingName ? (
                  <View style={styles.editRow}>
                    <TextInput style={styles.input} value={value} onChangeText={setValue} autoFocus={part === 'first'} autoCapitalize="words"
                      placeholder={part === 'first' ? 'First name' : 'Last name'} placeholderTextColor={RivalColors.textSecondary} />
                  </View>
                ) : (
                  <TouchableOpacity style={styles.readField} onPress={() => setEditingName(true)}>
                    <Text style={styles.readFieldValue}>{shown || (part === 'first' ? 'Add first name' : 'Add last name')}</Text>
                    <Text style={styles.editWord}>Edit</Text>
                  </TouchableOpacity>
                )}
                {editingName && part === 'last' ? (
                  <View style={[styles.editRow, { marginTop: 10, justifyContent: 'flex-end' }]}>
                    <TouchableOpacity onPress={() => { setEditingName(false); setNewFirst(splitName(displayName).first); setNewLast(splitName(displayName).last); }}>
                      <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.saveChip} onPress={saveName} disabled={saving}>
                      <BusyText busy={!!(saving)} style={styles.saveChipText}>{saving ? 'Saving…' : 'Save'}</BusyText>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          })}

          {/* Email (read-only) */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
            <View style={[styles.readField, styles.readFieldDisabled]}>
              <Text style={styles.readFieldValue}>{email || '—'}</Text>
            </View>
          </View>

          {/* Mindset — stored in users.bio; only the display name changed. */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>MINDSET</Text>
            <TextInput
              style={styles.bioInput}
              value={newBio}
              onChangeText={(t) => setNewBio(t.slice(0, 280))}
              placeholder="Share your Mindset"
              placeholderTextColor={RivalColors.textSecondary}
              multiline
              numberOfLines={3}
            />
            <View style={styles.bioFooter}>
              <Text style={styles.bioHint}>What keeps you going. A line to live by, a favourite quote, the thought that gets you through the hard part.</Text>
              <Text style={styles.bioCount}>{newBio.length}/280</Text>
            </View>
            {bioDirty && (
              <View style={styles.bioSaveRow}>
                <TouchableOpacity onPress={() => setNewBio(bio)}><Text style={[styles.cancelText, { color: RivalColors.danger }]}>Discard</Text></TouchableOpacity>
                <TouchableOpacity style={styles.saveChip} onPress={saveBio} disabled={savingBio}>
                  <BusyText busy={!!(savingBio)} style={styles.saveChipText}>{savingBio ? 'Saving…' : 'Save mindset'}</BusyText>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Link to stats */}
      <TouchableOpacity style={styles.statsLink} onPress={() => router.push('/stats')}>
        <RivalIcon name="stats" size={16} color={RivalColors.textPrimary} />
        <Text style={styles.statsLinkText}>Statistics: rank, milestones and Impact</Text>
        <Text style={styles.statsLinkArrow}>→</Text>
      </TouchableOpacity>

      {/* Moved here from the Activity Journal screen — a settings-style link
          out, same as the stats link above, fits better here than sitting
          inline in the activity feed. */}
      <TouchableOpacity style={styles.statsLink} onPress={() => router.push('/lifts')}>
        <RivalIcon name="target" size={16} color={RivalColors.textPrimary} />
        <Text style={styles.statsLinkText}>View Personal Bests</Text>
        <Text style={styles.statsLinkArrow}>→</Text>
      </TouchableOpacity>
    </RivalCard>
  );

  const optionRows = <T extends string>(options: Array<{ value: T; label: string; sub: string }>, selectedValue: T, onPick: (v: T) => void, disabled?: boolean) =>
    options.map((opt) => {
      const selected = selectedValue === opt.value;
      return (
        <TouchableOpacity
          key={opt.value}
          style={[styles.optionRow, selected && styles.optionRowActive]}
          onPress={() => onPick(opt.value)}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityState={{ selected }}
        >
          <View style={styles.optionTextWrap}>
            <Text style={[styles.optionLabel, selected && { color: RivalColors.accentText }]}>{opt.label}</Text>
            <Text style={styles.optionSample}>{opt.sub}</Text>
          </View>
          <Text style={[styles.optionCheck, selected && { color: RivalColors.accentText }]}>{selected ? '●' : '○'}</Text>
        </TouchableOpacity>
      );
    });

  const switchRow = (key: string, label: string, sub: string, value: boolean, onChange: (v: boolean) => void) => (
    <View key={key} style={styles.switchRow}>
      <View style={styles.optionTextWrap}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text style={styles.optionSample}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: RivalColors.surfaceContainerHigh, true: RivalColors.accentFill }}
        thumbColor="#ffffff"
        {...(Platform.OS === 'web' ? ({ activeThumbColor: '#ffffff' } as any) : {})}
      />
    </View>
  );

  const preferencesPanel = (
    <RivalCard glass style={styles.panel}>
      {wide && <Text style={styles.panelTitle}>Preferences</Text>}

      <View style={styles.subSectionFirst}>
        <Text style={styles.subSectionTitle}>UNITS</Text>
        {optionRows(UNIT_OPTIONS, prefs.units, (v) => savePref({ units: v }))}
      </View>

      <View style={styles.subSection}>
        <Text style={styles.subSectionTitle}>DAILY QUOTE</Text>
        {switchRow('quote', 'Show a quote each day', 'A short line when RIVAL is first opened each day.', prefs.dailyQuote, (v) => savePref({ dailyQuote: v }))}
        {prefs.dailyQuote && (
          <>
            <Text style={[styles.subSectionTitle, styles.subSectionTitleInner]}>TONE</Text>
            {optionRows(QUOTE_TONES, quoteTone, updateQuoteTone, savingTone)}
            {quotePreview && <Text style={styles.quotePreview}>"{quotePreview}"</Text>}
          </>
        )}
      </View>
      {prefError && <Text style={styles.errorText}>{prefError}</Text>}
    </RivalCard>
  );

  const appsPanel = (
    <RivalCard glass style={styles.panel}>
      {wide && <Text style={styles.panelTitle}>Connected devices</Text>}
      <Text style={styles.panelSub}>Bring in workouts from Garmin or Apple Health, or past activities from an archive file.</Text>

      {/* Garmin (Mockup 31): history import now, live connection once keys are in. */}
      <TouchableOpacity style={[styles.appRow, { marginTop: 12 }]} onPress={() => router.push('/garmin' as any)} activeOpacity={0.8}>
        <View style={[styles.appRowLeft, { flex: 1, minWidth: 0 }]}>
          <RivalIcon name="watch" size={18} color={RivalColors.accentText} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.appName}>Garmin</Text>
            <Text style={styles.appStatus}>Import past activities</Text>
          </View>
        </View>
        <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.35)" />
      </TouchableOpacity>

      <HealthRow />

      {/* An archive file (Ricky, 2026-10-17). */}
      <TouchableOpacity style={styles.appRow} onPress={() => router.push('/import-archive')} activeOpacity={0.8}>
        <View style={styles.appRowLeft}>
          <RivalIcon name="upload" size={18} color={RivalColors.accentText} />
          <View>
            <Text style={styles.appName}>Import an archive</Text>
            <Text style={styles.appStatus}>A .zip of past activities</Text>
          </View>
        </View>
        <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.35)" />
      </TouchableOpacity>

    </RivalCard>
  );

  const notificationsPanel = (
    <RivalCard glass style={styles.panel}>
      {wide && <Text style={styles.panelTitle}>Notifications</Text>}
      <Text style={styles.panelSub}>Choose what appears under the bell. Requests that need an answer, such as join requests and activity partner confirmations, always appear.</Text>

      <View style={styles.subSectionFirst}>
        {NOTIFY_OPTIONS.map((o) => switchRow(o.key, o.label, o.sub, prefs.notify[o.key], (v) => savePref({ notify: { ...prefs.notify, [o.key]: v } })))}
      </View>

      {myTeams.length > 0 && (
        <View style={styles.subSection}>
          <Text style={styles.subSectionTitle}>MUTED TEAMS</Text>
          <Text style={styles.optionSample}>A muted team sends nothing to the bell and its chat stops counting as unread. You stay a member.</Text>
          {myTeams.map((t) => {
            const muted = prefs.mutedTeams.includes(t.id);
            return switchRow(
              t.id,
              t.name,
              muted ? 'Muted' : 'Notifications on',
              muted,
              (v) => savePref({ mutedTeams: v ? [...prefs.mutedTeams, t.id] : prefs.mutedTeams.filter((id) => id !== t.id) }),
            );
          })}
        </View>
      )}
      {prefError && <Text style={styles.errorText}>{prefError}</Text>}
      <Text style={styles.footNote}>Alerts on the phone itself are not available yet. They will follow these settings when they are.</Text>
    </RivalCard>
  );

  const accountPanel = (
    <RivalCard glass style={styles.panel}>
      {wide && <Text style={styles.panelTitle}>Account</Text>}

      <View style={styles.accountMetaRow}>
        <Text style={styles.accountMetaLabel}>Member since</Text>
        <Text style={styles.accountMetaValue}>{memberSince || '—'}</Text>
      </View>

      <View style={styles.subSection}>
        <Text style={styles.subSectionTitle}>EMAIL</Text>
        <Text style={styles.optionSample}>Currently {email || 'not set'}.</Text>
        <View style={styles.editRow}>
          <TextInput
            style={styles.input}
            value={newEmail}
            onChangeText={(v) => { setNewEmail(v); setEmailMsg(null); }}
            placeholder="New email address"
            placeholderTextColor={RivalColors.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TouchableOpacity style={styles.saveChip} onPress={changeEmail} disabled={savingEmail || !newEmail.trim()}>
            <BusyText busy={!!(savingEmail)} style={styles.saveChipText}>{savingEmail ? '…' : 'Change'}</BusyText>
          </TouchableOpacity>
        </View>
        {emailMsg && <Text style={emailMsg.ok ? styles.okText : styles.errorText}>{emailMsg.text}</Text>}
      </View>

      <View style={styles.subSection}>
        <Text style={styles.subSectionTitle}>PASSWORD</Text>
        <TextInput
          style={[styles.input, styles.inputStacked]}
          value={newPassword}
          onChangeText={(v) => { setNewPassword(v); setPasswordMsg(null); }}
          placeholder="New password"
          placeholderTextColor={RivalColors.textSecondary}
          secureTextEntry
          autoComplete="new-password"
        />
        <TextInput
          style={[styles.input, styles.inputStacked]}
          value={confirmPassword}
          onChangeText={(v) => { setConfirmPassword(v); setPasswordMsg(null); }}
          placeholder="Confirm new password"
          placeholderTextColor={RivalColors.textSecondary}
          secureTextEntry
          autoComplete="new-password"
        />
        <RivalButton busy={savingPassword} label={savingPassword ? 'Updating…' : 'Update password'} onPress={changePassword} disabled={savingPassword || !newPassword} variant="secondary" style={styles.actionBtn} />
        {passwordMsg && <Text style={passwordMsg.ok ? styles.okText : styles.errorText}>{passwordMsg.text}</Text>}
      </View>

      <View style={styles.subSection}>
        <Text style={styles.subSectionTitle}>YOUR DATA</Text>
        <Text style={styles.optionSample}>A copy of everything RIVAL holds for this account: activities, routes, goals, events, teams, messages and recognition. Data only is one small file. With photos and videos it is a .zip, which can take a few minutes.</Text>
        <RivalButton busy={exporting === 'data'} label={exporting === 'data' ? 'Preparing…' : 'Download data'} onPress={() => downloadData(false)} disabled={!!exporting} variant="secondary" style={styles.actionBtn} />
        <RivalButton busy={exporting === 'all'} label={exporting === 'all' ? 'Preparing…' : 'Download data, photos and videos'} onPress={() => downloadData(true)} disabled={!!exporting} variant="secondary" style={styles.actionBtn} />
        {exportMsg && <Text style={exportMsg.ok ? styles.okText : styles.errorText}>{exportMsg.text}</Text>}
      </View>

      {isAdmin && (
        <RivalButton label="Scoring Config" onPress={() => router.push('/admin')} variant="secondary" style={styles.actionBtn} />
      )}
      <RivalButton label="Sign Out" onPress={handleSignOut} variant="secondary" style={styles.actionBtn} />

      <View style={styles.dangerZone}>
        <Text style={styles.dangerTitle}>DANGER ZONE</Text>
        {/* Opens the delete-and-archive page (Ricky, 2026-10-17); the old
            prompt-based handleDeleteAccount stays below, unused. */}
        <TouchableOpacity style={styles.deleteAccountButton} onPress={() => router.push('/delete-account')} disabled={deletingAccount}>
          <BusyText busy={!!(deletingAccount)} style={styles.deleteAccountText}>{deletingAccount ? 'Deleting account…' : 'Delete account'}</BusyText>
        </TouchableOpacity>
      </View>
    </RivalCard>
  );

  const panelFor: Record<TabId, React.ReactNode> = {
    personal: personalPanel,
    preferences: preferencesPanel,
    apps: appsPanel,
    notifications: notificationsPanel,
    account: accountPanel,
  };

  const sidebar = (
    <View style={[styles.sidebar, wide && styles.sidebarWide]}>
      {TABS.map((t) => {
        // On mobile nothing is "active" — the list is a menu you leave, so a
        // highlighted row would point at a screen you're not on.
        const active = wide && activeTab === t.id;
        return (
          <TouchableOpacity
            key={t.id}
            style={[styles.sidebarBtn, active && styles.sidebarBtnActive]}
            onPress={() => { setActiveTab(t.id); if (!wide) setPanelOpen(true); }}
          >
            <RivalIcon name={t.icon} size={16} color={active ? RivalColors.accentText : RivalColors.textSecondary} />
            <Text style={[styles.sidebarLabel, active && { color: RivalColors.accentText }]}>{t.label}</Text>
            {!wide && (
              <>
                <View style={{ flex: 1 }} />
                <RivalIcon name="chevronRight" size={18} color={RivalColors.textSecondary} />
              </>
            )}
          </TouchableOpacity>
        );
      })}
      {/* Not a panel — the introduction is its own page. */}
      <TouchableOpacity style={styles.sidebarBtn} onPress={() => router.push('/getting-started')}>
        <RivalIcon name="flag" size={16} color={RivalColors.textSecondary} />
        <Text style={styles.sidebarLabel}>How RIVAL works</Text>
        {!wide && (
          <>
            <View style={{ flex: 1 }} />
            <RivalIcon name="chevronRight" size={18} color={RivalColors.textSecondary} />
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  // Phone menu: the grey pop-up style — centred title, grouped rows with the
  // current value on the right, no photo.
  const open = (t: TabId) => { setActiveTab(t); setPanelOpen(true); };
  const phoneMenu = (
    <View>
      <View style={styles.mHead}>
        <View style={[styles.mGlow, { pointerEvents: 'none' }]} />
        <Text style={styles.mKicker}>ACCOUNT</Text>
        <Text style={styles.mTitle}>Settings</Text>
        <Text style={styles.mSub}>Profile, preferences and connected apps.</Text>
      </View>
      <GreyLabel>Profile</GreyLabel>
      <GreyRows>
        <GreyRow icon="person" label="Personal info" value={displayName} onPress={() => open('personal')} />
        <GreyRow icon="tune" label="Preferences" value={prefs.units === 'imperial' ? 'Imperial' : 'Metric'} onPress={() => open('preferences')} />
        <GreyRow icon="stats" label="Statistics" onPress={() => router.push('/stats')}>
          <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
        </GreyRow>
        <GreyRow icon="target" label="Goals" onPress={() => router.push('/goals')}>
          <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
        </GreyRow>
      </GreyRows>
      <GreyLabel>Connections</GreyLabel>
      <GreyRows>
        <GreyRow icon="link" label="Connected devices" value="None" onPress={() => open('apps')} />
        {/* The switch turns every notification on or off at once; the row
            itself opens the full list to choose them one by one. */}
        <GreyRow icon="notifications" label="Notifications" onPress={() => open('notifications')}>
          <MenuSwitch
            value={Object.values(prefs.notify).some(Boolean)}
            onChange={(v) => savePref({ notify: Object.fromEntries(Object.keys(prefs.notify).map((k) => [k, v])) as Record<NotifyKey, boolean> })}
          />
        </GreyRow>
      </GreyRows>
      {prefError ? <Text style={styles.mError}>{prefError}</Text> : null}
      <GreyLabel>More</GreyLabel>
      <GreyRows>
        {/* Team Beta (2026-11-10, Mockup 25 A); the BETA pill in the top bar opens the same pop-up. */}
        <GreyRow icon="feedback" label="Send feedback" onPress={openFeedback}>
          <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
        </GreyRow>
        <GreyRow icon="flag" label="How RIVAL works" onPress={() => router.push('/getting-started')}>
          <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
        </GreyRow>
        <GreyRow icon="bolt" label="How Effort works" onPress={() => router.push('/effort')}>
          <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
        </GreyRow>
        {/* Report and block (Mockup 27 v8, panel F). */}
        <GreyRow icon="block" label="Blocked members" onPress={() => router.push('/blocked-members' as any)}>
          <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
        </GreyRow>
        <GreyRow icon="settings" label="Account" onPress={() => open('account')}>
          <RivalIcon name="chevronRight" size={18} color="rgba(255,255,255,0.4)" />
        </GreyRow>
      </GreyRows>
    </View>
  );

  return (
    // Phones: the Add an activity look's warm grey ground (Ricky, 2026-10-03).
    <SafeAreaView style={[styles.container, !wide && { backgroundColor: RivalGhost.ground }]} edges={['top', 'left', 'right']}>
      <RivalTopNav />
      <ScrollView
        contentContainerStyle={[styles.content, windowWidth < BREAKPOINT_WIDE_LAYOUT && styles.contentNavClear]}
        {...pullProps}
      >
        {pullIndicator}
        <View style={styles.header}>
          {/* Inside a panel, back means "back to the menu" — leaving the page
              entirely would skip a level the user can see they're inside. */}
          <RivalBackButton
            onPress={() => {
              if (!wide && panelOpen) { setPanelOpen(false); return; }
              goBack();
            }}
            color={RivalColors.accentFill}
          />
          <Text style={styles.headerTitle}>
            {!wide && panelOpen ? (TABS.find(t => t.id === activeTab)?.label ?? 'Settings') : wide ? 'Settings' : ''}
          </Text>
          <View style={{ width: 48 }} />
        </View>

        {wide ? (
          <View style={styles.wideRow}>
            {sidebar}
            <View style={styles.wideContent}>{panelFor[activeTab]}</View>
          </View>
        ) : panelOpen ? (
          panelFor[activeTab]
        ) : (
          phoneMenu
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Full-bleed takeover so the count-up is the only thing on screen —
  // the same weight the connect-flow reveal gets, not a small dialog.
  revealOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: RivalColors.surfaceLowest,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  container: { flex: 1, backgroundColor: RivalColors.pageGround },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  // Phones: room for the floating bottom nav, so the last item isn't hidden behind it.
  contentNavClear: { paddingBottom: 120 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: RivalColors.textSecondary, fontSize: 16 },

  // Above the Settings title, which is pulled up beside it (mHead marginTop -44)
  // and otherwise covered the back button (2026-11-11).
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, position: 'relative', zIndex: 2 },
  back: { color: RivalColors.accentText, fontSize: 16, width: 48 },
  headerTitle: { ...RivalType.titleMd, color: RivalColors.textPrimary },

  appDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#fc4c02', marginRight: 4 },
  mError: { fontSize: 12.5, color: RivalColors.error, marginTop: 8, marginHorizontal: 4 },
  mSheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  mHead: { alignItems: 'center', marginTop: -44, marginBottom: 8 },
  // The pop-up glow behind the title (GreyPageHead), as in the blend mockup.
  mGlow: {
    position: 'absolute', top: -110, left: -24, right: -24, height: 240,
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'radial-gradient(ellipse 75% 100% at 50% 0%, rgba(217,119,87,0.22) 0%, rgba(217,119,87,0.07) 45%, rgba(217,119,87,0) 100%)' }
      : { backgroundColor: 'rgba(217,119,87,0.05)' }),
  } as any,
  mKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: RivalColors.accentText },
  mTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 30, color: '#fff', marginTop: 3 },
  mSub: { fontSize: 13, color: RivalColors.textSecondary, marginTop: 4 },
  wideRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  wideContent: { flex: 1 },

  // Sidebar
  // Row on mobile (a chip strip inside the horizontal ScrollView), column
  // only once the sidebar is a real sidebar. This defaulted to column, so on
  // mobile four full-width buttons stacked down the screen and ate ~190px
  // before any content started.
  sidebar: { gap: 8 },
  sidebarWide: { width: '22%', minWidth: 200, maxWidth: 280, flexGrow: 0, flexShrink: 0 },
  sidebarBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: RivalRadius.DEFAULT, backgroundColor: RivalColors.surfaceContainer },
  sidebarBtnActive: { backgroundColor: RivalColors.surfaceContainerHigh, borderWidth: 1, borderColor: `${RivalColors.accentFill}44` },
  sidebarIcon: { fontSize: 16 },
  sidebarLabel: { fontSize: 14, fontWeight: '600', color: RivalColors.textSecondary },

  // Panels
  panel: { gap: 8, padding: 20 },
  panelTitle: { ...RivalType.titleMd, color: RivalColors.textPrimary },
  panelSub: { fontSize: 13, color: RivalColors.textSecondary, marginBottom: 8 },

  // Personal info
  personalTop: { gap: 20 },
  personalTopWide: { flexDirection: 'row', alignItems: 'flex-start' },
  avatarWrap: { position: 'relative', alignSelf: 'center', alignItems: 'center', gap: 8 },
  avatar: { width: 112, height: 112, borderRadius: 56, backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: RivalColors.outlineVariant },
  avatarImage: { width: 112, height: 112, borderRadius: 56 },
  avatarText: { fontSize: 44, fontWeight: '700', color: RivalColors.onAccentFill },
  editWord: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText, textAlign: 'center' },

  fieldsCol: { flex: 1, gap: 16, width: '100%' },
  field: { gap: 6 },
  fieldLabel: { ...RivalType.labelCaps, fontSize: 11, color: RivalColors.textSecondary },
  readField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12 },
  readFieldDisabled: { opacity: 0.6 },
  readFieldValue: { fontSize: 15, color: RivalColors.onSurface, fontWeight: '600' },
  editHint: { fontSize: 14 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.textPrimary, fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: RivalColors.accentFill },
  saveChip: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, paddingHorizontal: 14, paddingVertical: 10, borderRadius: RivalRadius.DEFAULT },
  saveChipText: { color: RivalButtonColors.label(RivalColors.onAccentFill), fontWeight: '700', fontSize: 14 },
  cancelText: { color: RivalColors.textSecondary, fontSize: 14 },
  errorText: { fontSize: 12, color: RivalColors.error, marginTop: 4 },

  bioInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.onSurface, fontSize: 15, minHeight: 84, textAlignVertical: 'top' },
  // `alignItems: center` vertically centred a two-line hint against a
  // one-line counter, so on a narrow screen the count sat across the hint's
  // second line. Top-align them and give the counter its own gutter.
  bioFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 6 },
  bioHint: { fontSize: 11, color: RivalColors.outline, flex: 1, lineHeight: 15 },
  bioCount: { fontSize: 11, color: RivalColors.textSecondary, lineHeight: 15, flexShrink: 0 },
  bioSaveRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 4 },

  subSection: { marginTop: 20, gap: 4 },
  subSectionFirst: { marginTop: 4, gap: 4 },
  subSectionTitleInner: { marginTop: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, paddingHorizontal: 10 },
  inputStacked: { flex: 0, marginTop: 8 },
  okText: { fontSize: 12, color: RivalColors.tertiary, marginTop: 4 },
  footNote: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 16, lineHeight: 17 },
  subSectionTitle: { ...RivalType.labelCaps, color: RivalColors.textSecondary, marginBottom: 8 },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderRadius: RivalRadius.DEFAULT },
  optionRowActive: { backgroundColor: `${RivalColors.accentFill}11` },
  optionTextWrap: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  optionSample: { fontSize: 12, color: RivalColors.textSecondary },
  optionCheck: { fontSize: 18, color: RivalColors.textSecondary, marginLeft: 10 },
  quotePreview: { fontSize: 13, color: RivalColors.textSecondary, fontStyle: 'italic', paddingHorizontal: 10, paddingTop: 8 },

  statsLink: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between', marginTop: 20, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 14 },
  statsLinkText: { fontSize: 14, fontWeight: '600', color: RivalColors.textPrimary, flex: 1 },
  statsLinkArrow: { fontSize: 18, color: RivalColors.accentText },

  // Connected apps
  appRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, padding: 14, marginTop: 8 },
  appRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  appIcon: { fontSize: 24 },
  appName: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  appStatus: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  healthAction: { fontSize: 14, fontWeight: '700', color: RivalColors.accentText, marginLeft: 10 },
  connectedCheck: {
    width: 28, height: 28, borderRadius: RivalRadius.full,
    backgroundColor: `${RivalColors.tertiary}22`, borderWidth: 1, borderColor: `${RivalColors.tertiary}55`,
    alignItems: 'center', justifyContent: 'center',
  },
  appConnectBtn: { paddingHorizontal: 20 },
  comingSoonRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: RivalColors.surfaceLowest, borderRadius: RivalRadius.DEFAULT, padding: 14, marginTop: 10, opacity: 0.7 },
  actionBtn: { marginTop: 10 },
  disconnectConfirmCard: { marginTop: 10, gap: 10, alignItems: 'center' },
  disconnectConfirmBtn: { width: '100%' },
  disconnectDestructiveBtn: { borderWidth: 1.5, borderColor: RivalColors.error },
  disconnectCancelBtn: { paddingVertical: 10, paddingHorizontal: 20 },
  disconnectConfirmTitle: { color: RivalColors.textPrimary, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  disconnectConfirmSub: { color: RivalColors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  // Notifications
  comingSoonBox: { alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 16 },
  comingSoonEmoji: { fontSize: 40 },
  comingSoonTitle: { fontSize: 16, fontWeight: '700', color: RivalColors.textPrimary },
  comingSoonText: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 360 },

  // Account
  accountMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  accountMetaLabel: { fontSize: 14, color: RivalColors.textSecondary },
  accountMetaValue: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  dangerZone: { marginTop: 24, borderTopWidth: 1, borderTopColor: RivalColors.outlineVariant, paddingTop: 16, gap: 8 },
  dangerTitle: { ...RivalType.labelCaps, color: RivalColors.error },
  deleteAccountButton: { alignItems: 'center', paddingVertical: 12 },
  deleteAccountText: { color: RivalColors.danger, fontSize: 13, fontWeight: '600' },
});
