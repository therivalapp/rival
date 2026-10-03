import { useEffect, useState } from 'react';
import { RivalColors, RivalSerifFamily, RivalButtonColors, PHONE_CARD_BG, RivalGhost } from '../constants/rivalTheme';
import { RivalIcon, RivalBackButton, RivalAvatar, GreyPageHead, GREY_PAGE_BG } from '../components/rival';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, Image, Platform, useWindowDimensions } from 'react-native';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { confirmAction, notify } from '../lib/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { formatDisplayName, formatTeamName } from '../lib/identity';
import { copyText } from '../lib/clipboard';
import { BusyText } from '../components/rival/BusyText';
import { goToTab } from '../lib/tabNav';
import { useSnapState } from '../lib/snapState';

// A crest (and the name baked into it) can change once every 6 months —
// often enough to fix a bad first attempt or reflect a real team change,
// rare enough that it still reads as an identity, not a disposable cosmetic.
// Mirrors the same check in supabase/functions/generate-team-crest/index.ts.
function nextCrestEligibleAt(generatedAt: string): Date {
  const d = new Date(generatedAt);
  d.setMonth(d.getMonth() + 6);
  return d;
}
function crestOnCooldown(generatedAt: string | null): boolean {
  if (!generatedAt) return false;
  return Date.now() < nextCrestEligibleAt(generatedAt).getTime();
}

// Mirrors generate-team-crest/index.ts's UNLIMITED_REGEN_USER_ID — keeps the
// button/name-lock UI in sync with the server-side bypass for Ricky's own
// account instead of showing a disabled button the server would actually accept.
const UNLIMITED_REGEN_USER_ID = '09b2e197-8257-4d7c-a0e6-12dc0429eeff';

type Member = {
  user_id: string;
  role: string;
  users: {
    display_name: string | null;
    email: string;
    avatar_url?: string | null;
  };
};

type SettingsSnap = { userId: string; league: any; members: any[]; pending: any[] };

export default function LeagueSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Mobile gets the redesigned layout below; desktop keeps this page as it
  // was until the mobile app is finished.
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= BREAKPOINT_WIDE_LAYOUT;
  // Which member's actions are open. One at a time: each row carries a quiet
  // "more" button instead of two outlined buttons, which stacked up into a
  // wall of Make Admin / Remove on a team of any real size.
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const [leagueName, setLeagueName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [crestGeneratedAt, setCrestGeneratedAt] = useState<string | null>(null);
  const [generatingCrest, setGeneratingCrest] = useState(false);
  const [crestError, setCrestError] = useState('');
  // 3 candidates come back from one generation call; the admin picks one
  // before it's written to the league (see chooseCrest below).
  const [crestCandidates, setCrestCandidates] = useState<string[] | null>(null);
  const [confirmingCrest, setConfirmingCrest] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<Member[]>([]);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);
  const [descSaved, setDescSaved] = useState(false);
  // False until team_settings.sql has added the column.
  const [hasDescription, setHasDescription] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [codeNote, setCodeNote] = useState('');
  const [resettingCode, setResettingCode] = useState(false);
  // Deleting asks for the team name to be typed, not just a tap: it removes
  // every member's shared chat, posts and challenge history for good.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Last loaded copy of this team's settings, so reopening the page draws at
  // once and refreshes behind it instead of showing "Loading…" again.
  const [snap, setSnap] = useSnapState<SettingsSnap | null>(`teamSettings.${id}`, null);

  useEffect(() => {
    if (snap) apply(snap);
    load();
  }, [id]);

  function apply(d: SettingsSnap) {
    const league = d.league;
    setCurrentUserId(d.userId);
    setLeagueName(league.name);
    setNewName(league.name);
    setCreatedBy(league.created_by);
    setLogoUrl(league.logo_url || null);
    setIsPrivate(league.is_private !== false);
    setCrestGeneratedAt(league.crest_generated_at || null);
    setHasDescription('description' in league);
    setDescription(league.description ?? '');
    setDescDraft(league.description ?? '');
    setInviteCode(league.invite_code ?? '');
    setMembers(d.members as any);
    setPendingRequests(d.pending as any);
    setLoading(false);
  }

  async function load() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;

    // The team and its members (active and waiting) in one round trip each,
    // side by side. This used to be four requests one after another: the
    // admin check, the team, the members, then the join requests. Being an
    // admin is read off the member list instead of asked for separately.
    const [{ data: league }, { data: rows }] = await Promise.all([
      supabase
        .from('leagues')
        // select('*'): works before and after team_settings.sql adds description.
        .select('*')
        .eq('id', id)
        .single(),
      supabase
        .from('league_members')
        .select('user_id, role, status, users(display_name, avatar_url)')
        .eq('league_id', id)
        .in('status', ['active', 'pending']),
    ]);

    const all = (rows || []) as any[];
    const me = all.find((r) => r.user_id === user.id && r.status === 'active');
    if (me?.role !== 'admin') {
      goToTab('/home');
      return;
    }
    if (!league) return;

    const next: SettingsSnap = {
      userId: user.id,
      league,
      members: all.filter((r) => r.status === 'active'),
      pending: all.filter((r) => r.status === 'pending'),
    };
    setSnap(next);
    apply(next);
  }

  async function respondToRequest(userId: string, approve: boolean) {
    setRespondingTo(userId);
    if (approve) {
      const { error } = await supabase.from('league_members').update({ status: 'active' }).eq('league_id', id).eq('user_id', userId);
      if (error) {
        notify("Couldn't approve", error.message);
        setRespondingTo(null);
        return;
      }
      const request = pendingRequests.find((m) => m.user_id === userId);
      if (request) setMembers((prev) => [...prev, request]);
    } else {
      const { error } = await supabase.from('league_members').delete().eq('league_id', id).eq('user_id', userId);
      if (error) {
        notify("Couldn't decline", error.message);
        setRespondingTo(null);
        return;
      }
    }
    setPendingRequests((prev) => prev.filter((m) => m.user_id !== userId));
    setRespondingTo(null);
  }

  async function generateCrest() {
    setGeneratingCrest(true);
    setCrestError('');
    const { data, error } = await supabase.functions.invoke('generate-team-crest', { body: { leagueId: id } });
    if (error || data?.error) {
      setCrestError(data?.error || error?.message || 'Crest generation failed');
      setGeneratingCrest(false);
      return;
    }
    setGeneratingCrest(false);
    setCrestCandidates(data.urls);
  }

  async function chooseCrest(url: string) {
    setConfirmingCrest(true);
    setCrestError('');
    const { error } = await supabase
      .from('leagues')
      .update({ logo_url: url, crest_generated_at: new Date().toISOString() })
      .eq('id', id);
    setConfirmingCrest(false);
    if (error) {
      setCrestError("Couldn't save the crest. Try again.");
      return;
    }
    setLogoUrl(url);
    setCrestGeneratedAt(new Date().toISOString());
    setCrestCandidates(null);
  }

  const cooldownActive = currentUserId !== UNLIMITED_REGEN_USER_ID && crestOnCooldown(crestGeneratedAt);

  async function saveName() {
    if (cooldownActive) {
      setEditingName(false);
      return;
    }
    if (!newName.trim() || newName === leagueName) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('leagues').update({ name: newName.trim() }).eq('id', id);
    if (!error) {
      setLeagueName(newName.trim());
      setEditingName(false);
    } else {
      setNewName(leagueName);
      setEditingName(false);
    }
    setSaving(false);
  }

  async function kickMember(userId: string) {
    const member = members.find((m) => m.user_id === userId);
    const name = member?.users ? formatDisplayName(member.users, 'this member') : 'this member';

    if (!(await confirmAction({ title: `Remove ${name} from the team?`, confirmLabel: 'Remove', destructive: true }))) return;

    const { error } = await supabase
      .from('league_members')
      .delete()
      .eq('league_id', id)
      .eq('user_id', userId);

    if (error) {
      notify("Couldn't remove member", error.message);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }

  async function toggleAdmin(userId: string, currentRole: string) {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    const { error } = await supabase
      .from('league_members')
      .update({ role: newRole })
      .eq('league_id', id)
      .eq('user_id', userId);

    if (error) {
      notify("Couldn't update role", error.message);
      return;
    }
    setMembers((prev) =>
      prev.map((m) => m.user_id === userId ? { ...m, role: newRole } : m)
    );
  }

  async function saveDescription() {
    const next = descDraft.trim();
    setSavingDesc(true);
    const { data, error } = await supabase.from('leagues').update({ description: next || null }).eq('id', id).select('id');
    setSavingDesc(false);
    if (error || !data?.length) { notify("Couldn't save the description", error?.message ?? 'Only team admins can do this.'); return; }
    setDescription(next);
    setDescDraft(next);
    setDescSaved(true);
    setTimeout(() => setDescSaved(false), 1800);
  }

  function inviteLink() {
    const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/join-league?code=${inviteCode}`;
  }

  async function copyCode() {
    if (await copyText(inviteCode)) { setCodeNote('Code copied'); setTimeout(() => setCodeNote(''), 1800); }
  }

  async function shareInvite() {
    const text = `Join ${formatTeamName(leagueName)} on RIVAL. Invite code: ${inviteCode}`;
    const url = inviteLink();
    const nav: any = Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.share) {
      try { await nav.share({ title: formatTeamName(leagueName), text, url }); } catch { /* closed the share sheet */ }
      return;
    }
    if (await copyText(`${text}\n${url}`)) { setCodeNote('Invite link copied'); setTimeout(() => setCodeNote(''), 1800); }
  }

  async function resetCode() {
    const ok = await confirmAction({
      title: 'Reset the invite code?',
      message: 'The current code stops working straight away. Members already in the team are not affected.',
      confirmLabel: 'Reset code',
      destructive: true,
    });
    if (!ok) return;
    setResettingCode(true);
    const { data, error } = await supabase.rpc('reset_league_invite_code', { p_league_id: id });
    setResettingCode(false);
    if (error || !data) { notify("Couldn't reset the code", error?.message ?? 'Try again.'); return; }
    setInviteCode(data as string);
    setCodeNote('New code created');
    setTimeout(() => setCodeNote(''), 2200);
  }

  async function makeFounder(userId: string) {
    const member = members.find((m) => m.user_id === userId);
    const name = member?.users ? formatDisplayName(member.users, 'this member') : 'this member';
    const ok = await confirmAction({
      title: `Hand the team to ${name}?`,
      message: `${name} becomes the founder, with the final say over the team, including deleting it. You stay on as an admin.`,
      confirmLabel: 'Hand over',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('transfer_league_founder', { p_league_id: id, p_new_founder: userId });
    if (error) { notify("Couldn't hand over the team", error.message); return; }
    setCreatedBy(userId);
    setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role: 'admin' } : m)));
  }

  async function leaveTeam() {
    const founder = createdBy === currentUserId;
    const last = members.length <= 1;
    const ok = await confirmAction({
      title: `Leave ${formatTeamName(leagueName)}?`,
      message: last
        ? "You're the last member. Leaving will permanently delete the team, including its chat, posts and challenge history."
        : founder
          ? 'You are the founder. The team passes to the longest-standing admin, or the longest-standing member if there are no other admins. To choose who, use Make founder on a member first.'
          : 'You can rejoin later with the invite code.',
      confirmLabel: last ? 'Leave and delete' : 'Leave team',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('leave_league', { p_league_id: id });
    if (error) { notify("Couldn't leave the team", error.message); return; }
    goToTab('/team-feed');
  }

  async function deleteTeam() {
    setDeleting(true);
    const { error } = await supabase.rpc('delete_league', { p_league_id: id });
    setDeleting(false);
    if (error) { notify("Couldn't delete the team", error.message); return; }
    goToTab('/team-feed');
  }

  function getDisplayName(member: Member) {
    return formatDisplayName(member.users);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }


  if (!wide) {
    const crestLabel = generatingCrest
      ? 'Generating…'
      : cooldownActive
        ? `New crest available ${nextCrestEligibleAt(crestGeneratedAt!).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
        : crestGeneratedAt ? 'Regenerate crest' : 'Generate a crest';

    const memberRow = (member: Member, isRequest: boolean, first = false) => {
      const name = isRequest ? formatDisplayName(member.users) : getDisplayName(member);
      const isCreator = member.user_id === createdBy;
      const isYou = member.user_id === currentUserId;
      const manageable = !isRequest && !isYou && !isCreator;
      const open = openMemberId === member.user_id;
      return (
        <View key={member.user_id} style={[ms.member, first && { borderTopWidth: 0 }]}>
          <View style={ms.memberMain}>
            <RivalAvatar uri={member.users?.avatar_url ?? null} name={name} size={30} />
            <Text style={ms.memberName} numberOfLines={1}>{name}{isYou ? <Text style={ms.memberYou}>  You</Text> : null}</Text>
            {!isRequest ? (
              <Text style={ms.memberRole}>{isCreator ? 'Founder' : member.role === 'admin' ? 'Admin' : ''}</Text>
            ) : null}
            {isRequest ? (
              <View style={ms.requestActions}>
                <TouchableOpacity
                  style={ms.ghostBtn}
                  onPress={() => respondToRequest(member.user_id, false)}
                  disabled={respondingTo === member.user_id}
                >
                  <Text style={ms.ghostBtnText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={ms.fillBtn}
                  onPress={() => respondToRequest(member.user_id, true)}
                  disabled={respondingTo === member.user_id}
                >
                  <BusyText busy={!!(respondingTo === member.user_id)} style={ms.fillBtnText}>{respondingTo === member.user_id ? '…' : 'Approve'}</BusyText>
                </TouchableOpacity>
              </View>
            ) : manageable ? (
              <TouchableOpacity
                style={[ms.moreBtn, open && ms.moreBtnOpen]}
                onPress={() => setOpenMemberId(open ? null : member.user_id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <RivalIcon name="moreHoriz" size={20} color={open ? RivalColors.accentText : 'rgba(255,255,255,0.55)'} />
              </TouchableOpacity>
            ) : null}
          </View>
          {open ? (
            <View style={ms.memberMenu}>
              <TouchableOpacity
                style={ms.menuItem}
                onPress={() => { setOpenMemberId(null); toggleAdmin(member.user_id, member.role); }}
              >
                <RivalIcon name="person" size={16} color={RivalColors.onSurface} />
                <Text style={ms.menuText}>{member.role === 'admin' ? 'Remove as admin' : 'Make admin'}</Text>
              </TouchableOpacity>
              {createdBy === currentUserId ? (
                <TouchableOpacity
                  style={ms.menuItem}
                  onPress={() => { setOpenMemberId(null); makeFounder(member.user_id); }}
                >
                  <RivalIcon name="crown" size={16} color={RivalColors.onSurface} />
                  <Text style={ms.menuText}>Make founder</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={ms.menuItem}
                onPress={() => { setOpenMemberId(null); kickMember(member.user_id); }}
              >
                <RivalIcon name="close" size={16} color="#ff8f8f" />
                <Text style={[ms.menuText, ms.menuDanger]}>Remove from team</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      );
    };

    return (
      <SafeAreaView style={ms.page}>
        <ScrollView contentContainerStyle={ms.content}>
          <GreyPageHead
            kicker={formatTeamName(leagueName).toUpperCase()}
            title="Team settings"
            onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/team-hub', params: { id } }))}
          />

          {/* Identity: crest and name together, because they are one thing —
              the name is painted into the crest artwork. */}
          <View style={ms.identity}>
            {crestCandidates ? (
              <>
                <Text style={ms.pickHint}>Choose a crest</Text>
                <View style={ms.pickRow}>
                  {crestCandidates.map((url, i) => (
                    <TouchableOpacity key={i} style={ms.pickFrame} onPress={() => chooseCrest(url)} disabled={confirmingCrest} activeOpacity={0.85}>
                      <Image source={{ uri: url }} style={ms.pickImg} resizeMode="contain" />
                    </TouchableOpacity>
                  ))}
                </View>
                {confirmingCrest ? <Text style={ms.pickHint}>Saving…</Text> : null}
              </>
            ) : (
              <View style={ms.crestFrame}>
                {logoUrl ? (
                  // Contain, not cover: the team name is painted into the
                  // artwork, and cover was cropping it off both edges.
                  <Image source={{ uri: logoUrl }} style={ms.crestImg} resizeMode="contain" />
                ) : (
                  <View style={ms.crestEmpty}>
                    <RivalIcon name="groups" size={34} color={RivalColors.accentText} />
                    <Text style={ms.crestEmptyText}>No crest yet</Text>
                  </View>
                )}
              </View>
            )}

            {editingName ? (
              <View style={ms.nameEdit}>
                <TextInput
                  style={ms.nameInput}
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                  autoCapitalize="words"
                  maxLength={40}
                  placeholder="Team name"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                />
                <View style={ms.nameEditActions}>
                  <TouchableOpacity onPress={() => { setEditingName(false); setNewName(leagueName); }} style={ms.ghostBtn}>
                    <Text style={ms.ghostBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={ms.fillBtn} onPress={saveName} disabled={saving}>
                    <BusyText busy={!!(saving)} style={ms.fillBtnText}>{saving ? 'Saving…' : 'Save name'}</BusyText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <Text style={ms.teamName}>{formatTeamName(leagueName)}</Text>
                {cooldownActive ? (
                  <View style={ms.lockedRow}>
                    <RivalIcon name="lock" size={13} color="rgba(255,255,255,0.45)" />
                    <Text style={ms.lockedText}>The name is part of the crest and is locked until the next crest is available</Text>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setEditingName(true)} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
                    <Text style={ms.renameLink}>Rename team</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {!crestCandidates && !editingName ? (
              <TouchableOpacity
                style={[ms.crestBtn, (generatingCrest || cooldownActive) && ms.crestBtnOff]}
                onPress={generateCrest}
                disabled={generatingCrest || cooldownActive}
                activeOpacity={0.85}
              >
                <RivalIcon name="ai" size={16} color={generatingCrest || cooldownActive ? 'rgba(255,255,255,0.5)' : RivalButtonColors.label(RivalColors.onAccentFill)} />
                <Text style={[ms.crestBtnText, (generatingCrest || cooldownActive) && ms.crestBtnTextOff]}>{crestLabel}</Text>
              </TouchableOpacity>
            ) : null}
            {crestError ? <Text style={ms.error}>{crestError}</Text> : null}
          </View>

          {hasDescription ? <View style={ms.card}>
            <Text style={ms.cardLabel}>About the team</Text>
            <TextInput
              style={ms.descInput}
              value={descDraft}
              onChangeText={setDescDraft}
              placeholder="For example: Tuesday and Saturday runs, all paces welcome."
              placeholderTextColor="rgba(255,255,255,0.3)"
              multiline
              maxLength={160}
            />
            <View style={ms.descFoot}>
              <Text style={ms.cardHint}>{descDraft.length}/160 · Shown on the team page and in team search.</Text>
              {descDraft.trim() !== description ? (
                <TouchableOpacity style={ms.fillBtn} onPress={saveDescription} disabled={savingDesc}>
                  <BusyText busy={!!(savingDesc)} style={ms.fillBtnText}>{savingDesc ? 'Saving…' : 'Save'}</BusyText>
                </TouchableOpacity>
              ) : descSaved ? <Text style={ms.savedText}>Saved</Text> : null}
            </View>
          </View> : null}

          {inviteCode ? (
            <View style={ms.card}>
              <Text style={ms.cardLabel}>Invite</Text>
              <Text style={ms.code} selectable>{inviteCode}</Text>
              <View style={ms.codeRow}>
                <TouchableOpacity style={[ms.accentGhost, { flex: 1 }]} onPress={copyCode}>
                  <Text style={ms.accentGhostText}>Copy code</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[ms.accentGhost, { flex: 1 }]} onPress={shareInvite}>
                  <Text style={ms.accentGhostText}>Share link</Text>
                </TouchableOpacity>
              </View>
              <View style={ms.descFoot}>
                <Text style={ms.cardHint}>{codeNote || 'Anyone with the code or link can join.'}</Text>
                <TouchableOpacity onPress={resetCode} disabled={resettingCode} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <BusyText busy={!!(resettingCode)} style={ms.resetLink}>{resettingCode ? 'Resetting…' : 'Reset code'}</BusyText>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Visibility as a two-way choice, both options visible, instead of
              a button whose label was the opposite of the current state. */}
          <View style={ms.card}>
            <Text style={ms.cardLabel}>Who can join</Text>
            <View style={ms.segment}>
              {([true, false] as const).map((priv) => {
                const on = isPrivate === priv;
                return (
                  <TouchableOpacity
                    key={String(priv)}
                    style={[ms.segmentBtn, on && ms.segmentBtnOn]}
                    activeOpacity={0.85}
                    onPress={async () => {
                      if (on) return;
                      setIsPrivate(priv);
                      const { error } = await supabase.from('leagues').update({ is_private: priv }).eq('id', id);
                      if (error) {
                        // Put it back. Showing "Private" over a team that is
                        // still discoverable is a privacy failure, not a cosmetic one.
                        setIsPrivate(!priv);
                        notify("Couldn't update team visibility", error.message);
                      }
                    }}
                  >
                    <RivalIcon name={priv ? 'lock' : 'globe'} size={15} color={on ? RivalColors.accentText : RivalColors.textSecondary} />
                    <Text style={[ms.segmentText, on && ms.segmentTextOn]}>{priv ? 'Private' : 'Public'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={ms.cardHint}>
              {isPrivate
                ? 'Only people with your invite code can join.'
                : 'Anyone can find this team and ask to join. You approve every request.'}
            </Text>
          </View>

          {pendingRequests.length > 0 && (
            <>
              <View style={ms.sectHead}>
                <Text style={ms.sect}>Join requests</Text>
                <View style={ms.countBadge}><Text style={ms.countBadgeText}>{pendingRequests.length}</Text></View>
              </View>
              <View style={ms.rowsCard}>
                {pendingRequests.map((r, i) => memberRow(r, true, i === 0))}
              </View>
            </>
          )}

          <View style={ms.sectHead}>
            <Text style={ms.sect}>Members</Text>
            <Text style={ms.cardCount}>{members.length}</Text>
          </View>
          <View style={ms.rowsCard}>
            {members.map((mbr, i) => memberRow(mbr, false, i === 0))}
          </View>

          {/* Kept apart at the bottom, away from everyday settings. */}
          <View style={[ms.card, ms.dangerCard]}>
            <Text style={[ms.cardLabel, ms.dangerLabel]}>Leave or delete</Text>
            <TouchableOpacity style={ms.dangerRow} onPress={leaveTeam}>
              <RivalIcon name="logout" size={17} color="#ff8f8f" />
              <View style={{ flex: 1 }}>
                <Text style={ms.dangerText}>Leave team</Text>
                <Text style={ms.cardHint}>
                  {createdBy === currentUserId && members.length > 1
                    ? 'As founder, hand the team to someone first, or it passes to the longest-standing admin.'
                    : 'You can rejoin later with the invite code.'}
                </Text>
              </View>
            </TouchableOpacity>
            {createdBy === currentUserId ? (
              <>
                <View style={ms.dangerDivider} />
                {!deleteOpen ? (
                  <TouchableOpacity style={ms.dangerRow} onPress={() => setDeleteOpen(true)}>
                    <RivalIcon name="delete" size={17} color="#ff8f8f" />
                    <View style={{ flex: 1 }}>
                      <Text style={ms.dangerText}>Delete team</Text>
                      <Text style={ms.cardHint}>Removes the team for everyone, with its chat, posts and challenges. Activities and Effort are kept.</Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={{ gap: 10 }}>
                    <Text style={ms.cardHint}>
                      This can't be undone. Type <Text style={{ color: '#fff', fontWeight: '700' }}>{formatTeamName(leagueName)}</Text> to confirm.
                    </Text>
                    <TextInput
                      style={ms.nameInput}
                      value={deleteTyped}
                      onChangeText={setDeleteTyped}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="Team name"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                    />
                    <View style={ms.nameEditActions}>
                      <TouchableOpacity style={ms.ghostBtn} onPress={() => { setDeleteOpen(false); setDeleteTyped(''); }}>
                        <Text style={ms.ghostBtnText}>Cancel</Text>
                      </TouchableOpacity>
                      {(() => {
                        const match = deleteTyped.trim().toLowerCase() === formatTeamName(leagueName).trim().toLowerCase();
                        return (
                          <TouchableOpacity style={[ms.deleteBtn, (!match || deleting) && ms.crestBtnOff]} disabled={!match || deleting} onPress={deleteTeam}>
                            <BusyText busy={!!(deleting)} style={ms.deleteBtnText}>{deleting ? 'Deleting…' : 'Delete team'}</BusyText>
                          </TouchableOpacity>
                        );
                      })()}
                    </View>
                  </View>
                )}
              </>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/team-hub', params: { id } }))} color={RivalColors.accentFill} />
        </View>

        <Text style={styles.title}>Team Settings</Text>

        {/* Crest — AI-generated only, so every team page shares one look
            instead of a mix of AI art and whatever photo someone had on
            hand. logoCard here is just a preview; the only action is
            generateCrest below. */}
        <Text style={styles.sectionLabel}>Team Crest</Text>
        {crestCandidates ? (
          <>
            <Text style={styles.crestPickHint}>Choose a crest</Text>
            <View style={styles.crestPickRow}>
              {crestCandidates.map((url, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.crestPickFrame}
                  onPress={() => chooseCrest(url)}
                  disabled={confirmingCrest}
                >
                  <Image source={{ uri: url }} style={styles.crestPickImg} />
                </TouchableOpacity>
              ))}
            </View>
            {confirmingCrest ? <Text style={styles.crestPickHint}>Saving…</Text> : null}
          </>
        ) : (
          <>
            <View style={styles.logoCard}>
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.logoImage} />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <RivalIcon name="groups" size={36} color={RivalColors.textSecondary} />
                  <Text style={styles.logoPlaceholderHint}>No crest yet</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.crestBtn, (generatingCrest || cooldownActive) && styles.crestBtnDisabled]}
              onPress={generateCrest}
              disabled={generatingCrest || cooldownActive}
            >
              <Text style={styles.crestBtnText}>
                {generatingCrest
                  ? 'Generating…'
                  : cooldownActive
                    ? `Next crest available ${nextCrestEligibleAt(crestGeneratedAt!).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                    : crestGeneratedAt ? 'Regenerate AI crest' : 'Generate AI crest'}
              </Text>
            </TouchableOpacity>
          </>
        )}
        {crestError ? <Text style={styles.crestErrorText}>{crestError}</Text> : null}

        {/* Rename */}
        <Text style={styles.sectionLabel}>Team Name</Text>
        <View style={styles.nameCard}>
          {editingName ? (
            <View style={styles.nameEditRow}>
              <TextInput
                style={styles.nameInput}
                value={newName}
                onChangeText={setNewName}
                autoFocus
                autoCapitalize="words"
                maxLength={40}
              />
              <TouchableOpacity style={styles.saveBtn} onPress={saveName} disabled={saving}>
                <BusyText busy={!!(saving)} style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</BusyText>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setEditingName(false); setNewName(leagueName); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : cooldownActive ? (
            <View style={styles.nameRow}>
              <Text style={styles.nameText}>{formatTeamName(leagueName)}</Text>
              <Text style={styles.editHintLocked}>🔒 Locked</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.nameRow} onPress={() => setEditingName(true)}>
              <Text style={styles.nameText}>{formatTeamName(leagueName)}</Text>
              <Text style={styles.editHint}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>
        {cooldownActive ? (
          <Text style={styles.nameLockedHint}>The name is part of the crest artwork and is locked until the next crest is available.</Text>
        ) : null}

        {/* Visibility */}
        <Text style={styles.sectionLabel}>Visibility</Text>
        <View style={styles.visibilityCard}>
          <View style={styles.visibilityRow}>
            <View>
              <Text style={styles.visibilityTitle}>{isPrivate ? '🔒 Private' : '🌍 Public'}</Text>
              <Text style={styles.visibilityDesc}>
                {isPrivate
                  ? 'Only people with the invite code can join.'
                  : 'Anyone can discover and join this team.'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.visibilityToggle, !isPrivate && styles.visibilityToggleOn]}
              onPress={async () => {
                const newVal = !isPrivate;
                setIsPrivate(newVal);
                const { error } = await supabase.from('leagues').update({ is_private: newVal }).eq('id', id);
                if (error) {
                  // Put the switch back. Showing "Private" over a team that is
                  // still discoverable is a privacy failure, not a cosmetic one.
                  setIsPrivate(!newVal);
                  notify("Couldn't update team visibility", error.message);
                }
              }}
            >
              <Text style={styles.visibilityToggleText}>{isPrivate ? 'Make Public' : 'Make Private'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Join Requests */}
        {pendingRequests.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Join Requests</Text>
            <View style={[styles.membersCard, { marginBottom: 28 }]}>
              {pendingRequests.map((request) => (
                <View key={request.user_id} style={styles.memberRow}>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{formatDisplayName(request.users)}</Text>
                  </View>
                  <View style={styles.memberActions}>
                    <TouchableOpacity
                      style={styles.adminToggleBtn}
                      onPress={() => respondToRequest(request.user_id, true)}
                      disabled={respondingTo === request.user_id}
                    >
                      <Text style={styles.adminToggleText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.kickBtn}
                      onPress={() => respondToRequest(request.user_id, false)}
                      disabled={respondingTo === request.user_id}
                    >
                      <Text style={styles.kickText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Members */}
        <Text style={styles.sectionLabel}>Members</Text>
        <View style={styles.membersCard}>
          {members.map((member) => (
            <View key={member.user_id} style={styles.memberRow}>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {getDisplayName(member)}
                  
                </Text>
                {member.role === 'admin' && (
                  <Text style={styles.adminBadge}>Admin</Text>
                )}
              </View>
              {member.user_id !== currentUserId && member.user_id !== createdBy && (
                <View style={styles.memberActions}>
                  <TouchableOpacity
                    style={styles.adminToggleBtn}
                    onPress={() => toggleAdmin(member.user_id, member.role)}
                  >
                    <Text style={styles.adminToggleText}>
                      {member.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.kickBtn}
                    onPress={() => kickMember(member.user_id)}
                  >
                    <Text style={styles.kickText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: RivalColors.surfaceLow,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: RivalColors.textSecondary,
    fontSize: 16,
  },
  header: {
    marginBottom: 24,
  },
  back: {
    color: RivalColors.accentFill,
    fontSize: 16,
  },
  title: {
    fontFamily: RivalSerifFamily,
    fontStyle: 'italic',
    fontSize: 26,
    fontWeight: '700',
    color: RivalColors.textPrimary,
    marginBottom: 28,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: RivalColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  visibilityCard: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  visibilityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  visibilityTitle: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary, marginBottom: 4 },
  visibilityDesc: { fontSize: 12, color: RivalColors.textSecondary, flexShrink: 1 },
  visibilityToggle: { backgroundColor: '#0D0D0D', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  visibilityToggleOn: { backgroundColor: '#0A1A0F', borderColor: RivalColors.accentText },
  visibilityToggleText: { fontSize: 12, fontWeight: '700', color: '#CCCCCC' },
  nameCard: {
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
    marginBottom: 28,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nameText: {
    fontSize: 18,
    fontWeight: '700',
    color: RivalColors.textPrimary,
  },
  editHint: {
    fontSize: 13,
    color: RivalColors.accentFill,
  },
  editHintLocked: {
    fontSize: 13,
    color: RivalColors.textSecondary,
  },
  nameLockedHint: {
    fontSize: 12,
    color: RivalColors.textSecondary,
    marginTop: -20,
    marginBottom: 20,
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nameInput: {
    flex: 1,
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: RivalColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: RivalColors.accentFill,
  },
  saveBtn: {
    backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnText: {
    color: RivalButtonColors.label(RivalColors.textPrimary),
    fontWeight: '700',
    fontSize: 14,
  },
  cancelText: {
    color: RivalColors.textSecondary,
    fontSize: 13,
  },
  logoCard: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.accentText, marginBottom: 28, overflow: 'hidden', alignItems: 'center' },
  logoImage: { width: '100%', height: 160 },
  logoPlaceholder: { paddingVertical: 32, alignItems: 'center', gap: 8 },
  logoPlaceholderIcon: { fontSize: 36 },
  logoPlaceholderHint: { fontSize: 13, color: RivalColors.textSecondary },
  crestBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  crestBtnDisabled: { backgroundColor: RivalColors.surfaceHigh, ...RivalButtonColors.noGradient },
  crestBtnText: { color: RivalButtonColors.label(RivalColors.textPrimary), fontSize: 14, fontWeight: '700' },
  crestErrorText: { color: '#FF6B6B', fontSize: 13, marginTop: 6 },
  crestPickHint: { color: RivalColors.textSecondary, fontSize: 13, marginBottom: 10 },
  crestPickRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  crestPickFrame: { flex: 1, aspectRatio: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.accentText, overflow: 'hidden' },
  crestPickImg: { width: '100%', height: '100%' },
  membersCard: {
    backgroundColor: RivalColors.surfaceLow,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RivalColors.accentText,
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#3d1a6e',
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: RivalColors.textPrimary,
  },
  adminBadge: {
    fontSize: 11,
    color: RivalColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  memberActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  adminToggleBtn: {
    borderWidth: 1,
    borderColor: RivalColors.accentFill,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  adminToggleText: {
    color: RivalColors.accentFill,
    fontSize: 12,
    fontWeight: '600',
  },
  kickBtn: {
    borderWidth: 1,
    borderColor: '#dc2626',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  kickText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
});

// Mobile styles — the warm palette the rest of the mobile app now uses.
const ms = StyleSheet.create({
  descInput: {
    minHeight: 64, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, borderRadius: 12, padding: 12,
    color: '#fff', fontSize: 14.5, lineHeight: 20, textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  descFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  savedText: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  code: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 32, fontWeight: '700', letterSpacing: 6, color: '#fff', textAlign: 'center',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #ffffff, #D97757 170%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : {}),
  } as any,
  accentGhost: { paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,181,158,0.35)', alignItems: 'center' },
  accentGhostText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.accentText },
  sectHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginHorizontal: 4, marginBottom: -4 },
  sect: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary },
  rowsCard: { backgroundColor: PHONE_CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border, paddingHorizontal: 13 },
  wideBtn: { paddingVertical: 12 },
  resetLink: { fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.55)', textDecorationLine: 'underline' },
  dangerCard: { borderColor: 'rgba(255,143,143,0.18)' },
  dangerLabel: { color: '#ff8f8f' },
  dangerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dangerText: { fontSize: 15, fontWeight: '700', color: '#ff8f8f', marginBottom: 2 },
  dangerDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  deleteBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#b54848', alignItems: 'center' },
  deleteBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  page: { flex: 1, backgroundColor: GREY_PAGE_BG },
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 48, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  headerTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: RivalColors.accentText },

  identity: {
    alignItems: 'center', gap: 8, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 16,
    // The warm glass card (kept by Ricky over the flat blend card).
    borderWidth: 1, borderColor: 'rgba(255,181,158,0.16)', backgroundColor: '#2d241f',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'radial-gradient(circle at 50% -10%, rgba(255,209,190,0.18) 0%, rgba(255,209,190,0) 65%), linear-gradient(160deg, #231e1b 0%, #2d241f 55%, #3b2821 100%)',
    } as any : {}),
  },
  // Bigger crest in the same card: the artwork has clear space around it, so
  // the frame overlaps the card's padding rather than growing the card.
  crestFrame: { width: 180, height: 180, marginVertical: -20, alignItems: 'center', justifyContent: 'center' },
  crestImg: { width: 180, height: 180 },
  crestEmpty: { width: 136, height: 136, borderRadius: 68, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,209,190,0.06)', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,209,190,0.3)' },
  crestEmptyText: { fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  pickHint: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  pickRow: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  pickFrame: { flex: 1, aspectRatio: 1, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,209,190,0.25)', overflow: 'hidden' },
  pickImg: { width: '100%', height: '100%' },

  teamName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22, fontWeight: '700', color: '#fff', textAlign: 'center' },
  renameLink: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  lockedText: { fontSize: 12, color: 'rgba(255,255,255,0.45)', textAlign: 'center', flexShrink: 1 },

  nameEdit: { alignSelf: 'stretch', gap: 10 },
  nameInput: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22, fontWeight: '700', color: '#fff', textAlign: 'center',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  nameEditActions: { flexDirection: 'row', gap: 10, justifyContent: 'center' },

  crestBtn: {
    marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  },
  crestBtnOff: { backgroundColor: 'rgba(255,255,255,0.06)', ...RivalButtonColors.noGradient },
  crestBtnText: { fontSize: 14, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  crestBtnTextOff: { color: 'rgba(255,255,255,0.5)', fontWeight: '600', fontSize: 12.5 },
  error: { fontSize: 12.5, color: '#ff8f8f', textAlign: 'center' },

  card: { backgroundColor: PHONE_CARD_BG, borderRadius: 16, borderWidth: 1, borderColor: RivalGhost.border, padding: 14, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.textSecondary },
  cardCount: { fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  cardHint: { fontSize: 12.5, lineHeight: 17, color: 'rgba(255,255,255,0.5)' },
  countBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  countBadgeText: { fontSize: 11, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },

  segment: { flexDirection: 'row', backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border, borderRadius: 999, padding: 4, gap: 4 },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 999 },
  segmentBtnOn: { backgroundColor: RivalGhost.fillOn },
  segmentText: { fontSize: 14, fontWeight: '700', color: RivalColors.textSecondary },
  segmentTextOn: { color: '#fff' },

  member: { borderTopWidth: 1, borderTopColor: 'rgba(50,50,50,0.8)', paddingVertical: 9 },
  memberMain: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  memberText: { flex: 1, minWidth: 0, gap: 2 },
  memberName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', color: RivalColors.textSecondary },
  memberYou: { fontSize: 11.5, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  memberRole: { fontSize: 13.5, fontWeight: '500', color: '#fff' },
  moreBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  moreBtnOpen: { backgroundColor: 'rgba(255,209,190,0.12)' },
  memberMenu: { marginTop: 8, marginLeft: 41, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', paddingVertical: 4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 },
  menuText: { fontSize: 14, fontWeight: '600', color: RivalColors.onSurface },
  menuDanger: { color: '#ff8f8f' },
  requestActions: { flexDirection: 'row', gap: 8 },

  fillBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, alignItems: 'center' },
  fillBtnText: { fontSize: 13.5, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  ghostBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center' },
  ghostBtnText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.textSecondary },
});
