import { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { RivalStartTiles, GreySheet, GreyLabel, GreyTiles, GreyRows, GreyRow, GreyField, GreyNote, GreyPrimary } from '../RivalGreySheet';
import { BREAKPOINT_WIDE_LAYOUT } from '../../../constants/breakpoints';
import { supabase } from '../../../lib/supabase';
import { notify } from '../../../lib/notify';
import { formatTeamName } from '../../../lib/identity';
import { RivalColors, RivalSerifFamily, RivalButtonColors } from '../../../constants/rivalTheme';
import { RivalIcon, type RivalIconName } from '../RivalIcon';
import { sheet } from './sheetStyles';
import { BusyText } from '../BusyText';
import { selectAll, inChunks } from '../../../lib/selectAll';

// Team Hub's Challenges tab: 1v1 challenges between teammates, and Team vs
// Team. Ported from the old team page (league.tsx), which was the only place
// either existed — Team Hub's tab used to just link back to it.
//
// Same tables and rules as before: league_challenges (1v1) and
// league_vs_league_challenges (team vs team); a pending challenge is answered
// by its opponent (for Team vs Team, by the opposing team's admin); an active
// one whose end date has passed is settled on the next load.

export type ChallengeMetric = 'xp' | 'distance' | 'activities' | 'elevation' | 'duration';

export const CHALLENGE_METRICS: Array<{ value: ChallengeMetric; label: string; unit: string }> = [
  { value: 'xp', label: 'Effort', unit: 'Effort' },
  { value: 'distance', label: 'Distance', unit: 'km' },
  { value: 'elevation', label: 'Elevation', unit: 'm' },
  { value: 'duration', label: 'Time', unit: 'hrs' },
  { value: 'activities', label: 'Activities', unit: 'activities' },
];

type Status = 'pending' | 'active' | 'declined' | 'completed';

type Challenge = {
  id: string; challenger_id: string; opponent_id: string; metric: ChallengeMetric;
  start_date: string; end_date: string; status: Status; winner_id: string | null; created_at: string;
};

type TeamChallenge = {
  id: string; challenger_league_id: string; opponent_league_id: string; created_by: string;
  metric: ChallengeMetric; start_date: string; end_date: string; status: Status;
  winner_league_id: string | null; created_at: string;
};

type Score = { challenger: number; opponent: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const DURATIONS = [3, 7, 14];

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayIso(): string { return isoDay(new Date()); }
function endIsoFromDays(days: number): string { return isoDay(new Date(Date.now() + days * DAY_MS)); }
// Device locale, so it reads the way the viewer writes dates ("Sep 17" in
// Canada, "17 Sep" elsewhere) rather than a raw 2026-09-17.
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function metricLabel(m: ChallengeMetric) { return CHALLENGE_METRICS.find(x => x.value === m)?.label ?? m; }
function metricUnit(m: ChallengeMetric) { return CHALLENGE_METRICS.find(x => x.value === m)?.unit ?? ''; }

function metricValue(metric: ChallengeMetric, a: any): number {
  if (metric === 'xp') return a.effort_score || 0;
  if (metric === 'distance') return (a.distance_meters || 0) / 1000;
  if (metric === 'elevation') return a.elevation_meters || 0;
  if (metric === 'duration') return (a.duration_seconds || 0) / 3600;
  return 1;
}

function windowIso(start: string, end: string) {
  return {
    startIso: new Date(`${start}T00:00:00`).toISOString(),
    // The end date is inclusive, so the window runs to midnight after it.
    endIso: new Date(new Date(`${end}T00:00:00`).getTime() + DAY_MS).toISOString(),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

async function scoreUsers(metric: ChallengeMetric, start: string, end: string, sideA: string[], sideB: string[]): Promise<Score> {
  const all = [...sideA, ...sideB];
  if (all.length === 0) return { challenger: 0, opponent: 0 };
  const { startIso, endIso } = windowIso(start, end);
  // Paged and sliced: the database stops at 1,000 rows without saying so.
  const data = await inChunks(all, (slice) => selectAll((from, to) => supabase
    .from('activities')
    .select('user_id, effort_score, distance_meters, elevation_meters, duration_seconds')
    .in('user_id', slice)
    .gte('started_at', startIso)
    .lt('started_at', endIso)
    .order('started_at')
    .order('id')
    .range(from, to)));
  const a = new Set(sideA);
  let challenger = 0, opponent = 0;
  (data || []).forEach((row: any) => {
    const v = metricValue(metric, row);
    if (a.has(row.user_id)) challenger += v; else opponent += v;
  });
  return { challenger: round1(challenger), opponent: round1(opponent) };
}

export async function fireChallengeNotification(type: string, challengeId: string, extra?: Record<string, unknown>) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/challenge-notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ type, challengeId, ...extra }),
    }).catch(() => {});
  } catch {}
}

// ---------------------------------------------------------------------------

export function TeamChallengesTab({
  leagueId,
  teamName,
  currentUserId,
  isAdmin,
  nameFor,
  refreshKey = 0,
  teamGoal = null,
  onEditTeamGoal,
  onOpenMembers,
  onEndTeamGoal,
}: {
  leagueId: string;
  teamName: string;
  currentUserId: string;
  isAdmin: boolean;
  nameFor: (userId: string) => string;
  /** Bump to reload, e.g. after a challenge is sent from the Members tab. */
  refreshKey?: number;
  /** The team's shared goal (the ring on the team page), if one is running. */
  teamGoal?: { title: string; detail: string } | null;
  onEditTeamGoal?: () => void;
  /** Opens the Members tab, where a teammate is challenged. */
  onOpenMembers?: () => void;
  onEndTeamGoal?: () => void;
}) {
  const phone = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  const [loading, setLoading] = useState(true);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [teamChallenges, setTeamChallenges] = useState<TeamChallenge[]>([]);
  const [teamScores, setTeamScores] = useState<Record<string, Score>>({});
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: oneVone }, { data: vsTeams }] = await Promise.all([
      supabase.from('league_challenges').select('*').eq('league_id', leagueId).order('created_at', { ascending: false }),
      supabase.from('league_vs_league_challenges').select('*')
        .or(`challenger_league_id.eq.${leagueId},opponent_league_id.eq.${leagueId}`)
        .order('created_at', { ascending: false }),
    ]);
    const rows = (oneVone || []) as Challenge[];
    const trows = (vsTeams || []) as TeamChallenge[];

    // Names for the other teams, fetched up front. The old page only loaded
    // them when you opened the "challenge a team" picker, so every Team vs
    // Team card showed a raw team id until you did.
    const otherIds = Array.from(new Set(trows.map(t => (t.challenger_league_id === leagueId ? t.opponent_league_id : t.challenger_league_id))));

    const [oneScores, teamScoreRows, namesRes] = await Promise.all([
      Promise.all(rows.filter(c => c.status === 'active' || c.status === 'pending')
        .map(async c => [c.id, await scoreUsers(c.metric, c.start_date, c.end_date, [c.challenger_id], [c.opponent_id])] as const)),
      Promise.all(trows.filter(t => t.status === 'active' || t.status === 'pending').map(async t => {
        const [aRes, bRes] = await Promise.all([
          supabase.from('league_members').select('user_id').eq('league_id', t.challenger_league_id).eq('status', 'active'),
          supabase.from('league_members').select('user_id').eq('league_id', t.opponent_league_id).eq('status', 'active'),
        ]);
        const score = await scoreUsers(
          t.metric, t.start_date, t.end_date,
          (aRes.data || []).map((m: any) => m.user_id),
          (bRes.data || []).map((m: any) => m.user_id),
        );
        return [t.id, score] as const;
      })),
      otherIds.length ? supabase.from('leagues').select('id, name').in('id', otherIds) : Promise.resolve({ data: [] as any[] }),
    ]);

    const scoreMap: Record<string, Score> = Object.fromEntries(oneScores);
    const teamScoreMap: Record<string, Score> = Object.fromEntries(teamScoreRows);
    const names: Record<string, string> = {};
    (namesRes.data || []).forEach((l: any) => { names[l.id] = formatTeamName(l.name); });

    // Settle anything that has finished. Logged rather than surfaced: it's a
    // background sweep and simply retries on the next visit.
    const today = todayIso();
    for (const c of rows) {
      if (c.status === 'active' && c.end_date < today) {
        const p = scoreMap[c.id];
        const winner = !p || p.challenger === p.opponent ? null : p.challenger > p.opponent ? c.challenger_id : c.opponent_id;
        const { error } = await supabase.from('league_challenges').update({ status: 'completed', winner_id: winner }).eq('id', c.id);
        if (error) console.error('Challenge completion failed:', error.message);
        else { c.status = 'completed'; c.winner_id = winner; }
      }
    }
    for (const t of trows) {
      if (t.status === 'active' && t.end_date < today) {
        const p = teamScoreMap[t.id];
        const winner = !p || p.challenger === p.opponent ? null : p.challenger > p.opponent ? t.challenger_league_id : t.opponent_league_id;
        const { error } = await supabase.from('league_vs_league_challenges').update({ status: 'completed', winner_league_id: winner }).eq('id', t.id);
        if (error) console.error('Team challenge completion failed:', error.message);
        else { t.status = 'completed'; t.winner_league_id = winner; }
      }
    }

    setChallenges(rows);
    setScores(scoreMap);
    setTeamChallenges(trows);
    setTeamScores(teamScoreMap);
    setTeamNames(names);
    setLoading(false);
  }, [leagueId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function respond(challengeId: string, accept: boolean) {
    const { error } = await supabase.from('league_challenges').update({ status: accept ? 'active' : 'declined' }).eq('id', challengeId);
    if (error) { notify(accept ? "Couldn't accept that challenge" : "Couldn't decline that challenge", error.message); return; }
    fireChallengeNotification('1v1_response', challengeId, { accept });
    load();
  }

  async function respondTeam(challengeId: string, accept: boolean) {
    const { error } = await supabase.from('league_vs_league_challenges').update({ status: accept ? 'active' : 'declined' }).eq('id', challengeId);
    if (error) { notify(accept ? "Couldn't accept that challenge" : "Couldn't decline that challenge", error.message); return; }
    fireChallengeNotification('lvl_response', challengeId, { accept });
    load();
  }

  const pending = challenges.filter(c => c.status === 'pending');
  const active = challenges.filter(c => c.status === 'active');
  const done = challenges.filter(c => c.status === 'completed');
  const teamPending = teamChallenges.filter(c => c.status === 'pending');
  const teamActive = teamChallenges.filter(c => c.status === 'active');
  const teamDone = teamChallenges.filter(c => c.status === 'completed');

  const noTeammate = !loading && pending.length + active.length + done.length === 0;
  const noTeamVs = !loading && teamPending.length + teamActive.length + teamDone.length === 0;
  return (
    <View style={{ gap: 22 }}>
      {/* Phone: challenges not started yet, as tiles at the top. Each becomes
          its own section below once there's one. */}
      {phone && (
        <RivalStartTiles
          tiles={[
            ...(isAdmin && !teamGoal && onEditTeamGoal ? [{ key: 'team', icon: 'target' as const, label: 'Team challenge', onPress: onEditTeamGoal }] : []),
            ...(noTeammate && onOpenMembers ? [{ key: 'mate', icon: 'person' as const, label: 'Challenge a teammate', onPress: onOpenMembers }] : []),
            ...(noTeamVs ? [{ key: 'vs', icon: 'race' as const, label: 'Challenge a team', onPress: () => setTeamSheetOpen(true) }] : []),
          ]}
        />
      )}
      {/* ---- The team's shared challenge ----
          Managed here, beside the other challenges, rather than from a tap on
          the ring or from Team settings. Admins start, edit and end it;
          everyone else sees what the team is working towards. */}
      {(teamGoal || (isAdmin && !phone)) && (
        <View style={{ gap: 10 }}>
          <Text style={s.sectionTitle}>Team challenge</Text>
          {teamGoal ? (
            <View style={s.card}>
              <Text style={s.cardKicker}>TOGETHER</Text>
              <Text style={s.cardTitle}>{teamGoal.title}</Text>
              <Text style={s.cardDetail}>{teamGoal.detail}</Text>
              {isAdmin && (
                <View style={s.btnRow}>
                  <TouchableOpacity style={s.secondaryBtn} onPress={onEndTeamGoal}>
                    <Text style={s.secondaryBtnText}>End challenge</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.primaryBtn} onPress={onEditTeamGoal}>
                    <Text style={s.primaryBtnText}>Edit</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : (
            <TouchableOpacity style={s.emptyCard} onPress={onEditTeamGoal} activeOpacity={0.8}>
              <RivalIcon name="target" size={22} color={RivalColors.accentText} />
              <Text style={s.emptyText}>Start a team challenge: one shared goal everyone's training counts towards.</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ---- Teammate challenges ---- */}
      {!(phone && noTeammate) && (
      <View style={{ gap: 10 }}>
        <Text style={s.sectionTitle}>Teammate challenges</Text>
        {loading ? (
          <Text style={s.muted}>Loading…</Text>
        ) : pending.length + active.length + done.length === 0 ? (
          <View style={s.emptyCard}>
            <RivalIcon name="race" size={22} color={RivalColors.accentText} />
            <Text style={s.emptyText}>Challenge a teammate from the Members tab.</Text>
          </View>
        ) : (
          <>
            {pending.map(c => {
              const mine = c.challenger_id === currentUserId;
              const other = mine ? c.opponent_id : c.challenger_id;
              const involvesMe = mine || c.opponent_id === currentUserId;
              return (
                <View key={c.id} style={s.card}>
                  <Text style={s.cardKicker}>PENDING</Text>
                  <Text style={s.cardTitle}>
                    {mine ? `You challenged ${nameFor(other)}` : c.opponent_id === currentUserId ? `${nameFor(other)} challenged you` : `${nameFor(c.challenger_id)} challenged ${nameFor(c.opponent_id)}`}
                  </Text>
                  <Text style={s.cardDetail}>{metricLabel(c.metric)} · {shortDate(c.start_date)} to {shortDate(c.end_date)}</Text>
                  {c.opponent_id === currentUserId ? (
                    <View style={s.btnRow}>
                      <TouchableOpacity style={s.secondaryBtn} onPress={() => respond(c.id, false)}>
                        <Text style={s.secondaryBtnText}>Decline</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.primaryBtn} onPress={() => respond(c.id, true)}>
                        <Text style={s.primaryBtnText}>Accept</Text>
                      </TouchableOpacity>
                    </View>
                  ) : involvesMe ? (
                    <Text style={s.muted}>Waiting for a response.</Text>
                  ) : null}
                </View>
              );
            })}

            {active.map(c => {
              const p = scores[c.id] || { challenger: 0, opponent: 0 };
              return (
                <View key={c.id} style={s.card}>
                  <Text style={s.cardKicker}>ACTIVE · ENDS {shortDate(c.end_date).toUpperCase()}</Text>
                  <Text style={s.cardTitle}>{nameFor(c.challenger_id)} vs {nameFor(c.opponent_id)}</Text>
                  <Text style={s.cardDetail}>{metricLabel(c.metric)}</Text>
                  <ScoreBars
                    a={{ label: nameFor(c.challenger_id), value: p.challenger }}
                    b={{ label: nameFor(c.opponent_id), value: p.opponent }}
                    unit={metricUnit(c.metric)}
                  />
                </View>
              );
            })}

            {done.length > 0 && <Text style={s.subTitle}>History</Text>}
            {done.map(c => (
              <View key={c.id} style={[s.card, s.cardDone]}>
                <Text style={s.cardTitle}>{nameFor(c.challenger_id)} vs {nameFor(c.opponent_id)}</Text>
                <Text style={s.cardDetail}>{metricLabel(c.metric)} · {shortDate(c.start_date)} to {shortDate(c.end_date)}</Text>
                <ResultLine text={c.winner_id ? `${nameFor(c.winner_id)} won` : 'Draw'} won={!!c.winner_id} />
              </View>
            ))}
          </>
        )}
      </View>
      )}

      {/* ---- Team vs Team ---- */}
      {!(phone && noTeamVs) && (
      <View style={{ gap: 10 }}>
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Team vs Team</Text>
          {phone ? (
            <TouchableOpacity onPress={() => setTeamSheetOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.linkText}>Challenge a team</Text>
            </TouchableOpacity>
          ) : (
          <TouchableOpacity style={s.pillBtn} onPress={() => setTeamSheetOpen(true)}>
            <RivalIcon name="race" size={14} color={RivalColors.accentText} />
            <Text style={s.pillBtnText}>Challenge a team</Text>
          </TouchableOpacity>
          )}
        </View>

        {!loading && teamPending.length + teamActive.length + teamDone.length === 0 && (
          <Text style={s.muted}>Compete against another team over a set period.</Text>
        )}

        {teamPending.map(t => {
          const weSent = t.challenger_league_id === leagueId;
          const other = teamNames[weSent ? t.opponent_league_id : t.challenger_league_id] ?? 'Another team';
          return (
            <View key={t.id} style={s.card}>
              <Text style={s.cardKicker}>PENDING</Text>
              <Text style={s.cardTitle}>{weSent ? `${teamName} challenged ${other}` : `${other} challenged ${teamName}`}</Text>
              <Text style={s.cardDetail}>{metricLabel(t.metric)} · {shortDate(t.start_date)} to {shortDate(t.end_date)}</Text>
              {!weSent && isAdmin ? (
                <View style={s.btnRow}>
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => respondTeam(t.id, false)}>
                    <Text style={s.secondaryBtnText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.primaryBtn} onPress={() => respondTeam(t.id, true)}>
                    <Text style={s.primaryBtnText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={s.muted}>
                  {weSent ? "Waiting for their admin to respond." : 'A team admin can accept or decline this.'}
                </Text>
              )}
            </View>
          );
        })}

        {teamActive.map(t => {
          const p = teamScores[t.id] || { challenger: 0, opponent: 0 };
          const weAreChallenger = t.challenger_league_id === leagueId;
          const other = teamNames[weAreChallenger ? t.opponent_league_id : t.challenger_league_id] ?? 'Another team';
          return (
            <View key={t.id} style={s.card}>
              <Text style={s.cardKicker}>ACTIVE · ENDS {shortDate(t.end_date).toUpperCase()}</Text>
              <Text style={s.cardTitle}>{teamName} vs {other}</Text>
              <Text style={s.cardDetail}>{metricLabel(t.metric)}</Text>
              <ScoreBars
                a={{ label: teamName, value: weAreChallenger ? p.challenger : p.opponent }}
                b={{ label: other, value: weAreChallenger ? p.opponent : p.challenger }}
                unit={metricUnit(t.metric)}
              />
            </View>
          );
        })}

        {teamDone.map(t => {
          const other = teamNames[t.challenger_league_id === leagueId ? t.opponent_league_id : t.challenger_league_id] ?? 'Another team';
          const won = t.winner_league_id === leagueId;
          return (
            <View key={t.id} style={[s.card, s.cardDone]}>
              <Text style={s.cardTitle}>{teamName} vs {other}</Text>
              <Text style={s.cardDetail}>{metricLabel(t.metric)} · {shortDate(t.start_date)} to {shortDate(t.end_date)}</Text>
              <ResultLine text={t.winner_league_id === null ? 'Draw' : won ? `${teamName} won` : `${other} won`} won={won} />
            </View>
          );
        })}
      </View>
      )}

      <ChallengeTeamSheet
        visible={teamSheetOpen}
        leagueId={leagueId}
        currentUserId={currentUserId}
        onClose={() => setTeamSheetOpen(false)}
        onSent={load}
      />
    </View>
  );
}

function ScoreBars({ a, b, unit }: { a: { label: string; value: number }; b: { label: string; value: number }; unit: string }) {
  const max = Math.max(a.value, b.value, 1);
  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      {[{ ...a, color: RivalColors.accentFill }, { ...b, color: RivalColors.tertiary }].map((row, i) => (
        <View key={i} style={s.barRow}>
          <Text style={s.barLabel} numberOfLines={1}>{row.label}</Text>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${Math.round((row.value / max) * 100)}%`, backgroundColor: row.color } as any]} />
          </View>
          <Text style={s.barValue}>{row.value.toLocaleString()} <Text style={s.barUnit}>{unit}</Text></Text>
        </View>
      ))}
    </View>
  );
}

function ResultLine({ text, won }: { text: string; won: boolean }) {
  return (
    <View style={s.resultRow}>
      <RivalIcon name="trophy" size={15} color={won ? RivalColors.accentGold : RivalColors.textSecondary} />
      <Text style={[s.resultText, won && { color: RivalColors.accentGold }]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Challenge a teammate (opened from the Members tab).

export function ChallengeTeammateSheet({
  visible, leagueId, currentUserId, opponent, onClose, onSent,
}: {
  visible: boolean;
  leagueId: string;
  currentUserId: string;
  opponent: { id: string; name: string } | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [metric, setMetric] = useState<ChallengeMetric>('xp');
  const [days, setDays] = useState(7);
  const [customDays, setCustomDays] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { if (visible) { setMetric('xp'); setDays(7); setCustomDays(''); } }, [visible]);

  const resolvedDays = days === -1 ? parseInt(customDays, 10) : days;
  const valid = !!opponent && Number.isInteger(resolvedDays) && resolvedDays >= 1 && resolvedDays <= 90;

  async function send() {
    if (!opponent || !valid || sending) return;
    setSending(true);
    const { data, error } = await supabase.from('league_challenges').insert({
      league_id: leagueId, challenger_id: currentUserId, opponent_id: opponent.id,
      metric, start_date: todayIso(), end_date: endIsoFromDays(resolvedDays), status: 'pending',
    }).select('id').single();
    setSending(false);
    if (error) { notify("Couldn't send that challenge", error.message); return; }
    if (data) fireChallengeNotification('1v1_sent', data.id);
    onSent?.();
    onClose();
  }

  const phoneSheet = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  if (phoneSheet) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={sheet.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
          <GreySheet
            kicker="TEAM CHALLENGE"
            title={`Challenge ${opponent?.name ?? ''}`}
            onClose={onClose}
            footer={<GreyPrimary label={sending ? 'Sending…' : 'Send challenge'} busy={sending} disabled={!valid || sending} onPress={send} />}
          >
            <GreyNote>The higher total at the end wins.</GreyNote>
            <GreyMetricAndDuration metric={metric} setMetric={setMetric} days={days} setDays={setDays} customDays={customDays} setCustomDays={setCustomDays} />
          </GreySheet>
        </View>
      </Modal>
    );
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheet.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={sheet.card}>
          <View style={sheet.grabber} />
          <View style={sheet.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={sheet.title}>Challenge {opponent?.name ?? ''}</Text>
              <Text style={sheet.sub}>The higher total at the end wins.</Text>
            </View>
            {/* Phone pop-ups close by tapping outside, no X. */}
            {!phoneSheet && (
              <TouchableOpacity style={sheet.close} onPress={onClose} accessibilityLabel="Close">
                <RivalIcon name="close" size={18} color={RivalColors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          <MetricAndDuration
            metric={metric} setMetric={setMetric}
            days={days} setDays={setDays}
            customDays={customDays} setCustomDays={setCustomDays}
          />
          <View style={sheet.btnRow}>
            <TouchableOpacity style={sheet.secondaryBtn} onPress={onClose}>
              <Text style={sheet.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[sheet.primaryBtn, (!valid || sending) && sheet.primaryBtnOff]} onPress={send} disabled={!valid || sending}>
              <BusyText busy={!!(sending)} style={sheet.primaryBtnText}>{sending ? 'Sending…' : 'Send challenge'}</BusyText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Challenge another team.

function ChallengeTeamSheet({
  visible, leagueId, currentUserId, onClose, onSent,
}: {
  visible: boolean;
  leagueId: string;
  currentUserId: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [metric, setMetric] = useState<ChallengeMetric>('xp');
  const [days, setDays] = useState(7);
  const [customDays, setCustomDays] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSearch(''); setTarget(null); setMetric('xp'); setDays(7); setCustomDays('');
    supabase.from('leagues').select('id, name').neq('id', leagueId).order('name').limit(300)
      .then(({ data }) => setTeams((data || []).map((l: any) => ({ id: l.id, name: formatTeamName(l.name) }))));
  }, [visible, leagueId]);

  const resolvedDays = days === -1 ? parseInt(customDays, 10) : days;
  const valid = !!target && Number.isInteger(resolvedDays) && resolvedDays >= 1 && resolvedDays <= 90;
  const q = search.trim().toLowerCase();
  const shown = (q ? teams.filter(t => t.name.toLowerCase().includes(q)) : teams).slice(0, 30);

  async function send() {
    if (!target || !valid || sending) return;
    setSending(true);
    const { data, error } = await supabase.from('league_vs_league_challenges').insert({
      challenger_league_id: leagueId, opponent_league_id: target, created_by: currentUserId,
      metric, start_date: todayIso(), end_date: endIsoFromDays(resolvedDays), status: 'pending',
    }).select('id').single();
    setSending(false);
    if (error) { notify("Couldn't send that challenge", error.message); return; }
    if (data) fireChallengeNotification('lvl_sent', data.id);
    onSent?.();
    onClose();
  }

  const phoneSheet = useWindowDimensions().width < BREAKPOINT_WIDE_LAYOUT;
  if (phoneSheet) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={sheet.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
          <GreySheet
            kicker="TEAM CHALLENGE"
            title="Challenge a team"
            onClose={onClose}
            footer={<GreyPrimary label={sending ? 'Sending…' : 'Send challenge'} busy={sending} disabled={!valid || sending} onPress={send} />}
          >
            <GreyNote>All member activity counts toward each team's total.</GreyNote>
            <GreyLabel>Opponent</GreyLabel>
            <GreyField value={search} onChangeText={setSearch} placeholder="Search teams" autoCorrect={false} />
            <View style={{ height: 8 }} />
            <GreyRows>
              {shown.slice(0, 8).map((t) => (
                <GreyRow key={t.id} icon="groups" label={t.name} onPress={() => setTarget(t.id)}>
                  {target === t.id ? <RivalIcon name="check" size={17} color={RivalColors.accentText} /> : null}
                </GreyRow>
              ))}
              {shown.length === 0 ? <GreyRow icon="search" label="No teams match that search." /> : null}
            </GreyRows>
            <GreyMetricAndDuration metric={metric} setMetric={setMetric} days={days} setDays={setDays} customDays={customDays} setCustomDays={setCustomDays} />
          </GreySheet>
        </View>
      </Modal>
    );
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheet.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[sheet.card, { maxHeight: '90%' }]}>
          <View style={sheet.grabber} />
          <View style={sheet.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={sheet.title}>Challenge a team</Text>
              <Text style={sheet.sub}>All member activity counts toward each team's total.</Text>
            </View>
            {/* Phone pop-ups close by tapping outside, no X. */}
            {!phoneSheet && (
              <TouchableOpacity style={sheet.close} onPress={onClose} accessibilityLabel="Close">
                <RivalIcon name="close" size={18} color={RivalColors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={sheet.label}>Team</Text>
            <TextInput
              style={sheet.input}
              value={search}
              onChangeText={setSearch}
              placeholder="Search teams"
              placeholderTextColor={RivalColors.textSecondary}
              autoCorrect={false}
            />
            <View style={s.teamList}>
              {shown.map(t => (
                <TouchableOpacity key={t.id} style={[s.teamRow, target === t.id && s.teamRowOn]} onPress={() => setTarget(t.id)}>
                  <Text style={[s.teamRowText, target === t.id && { color: '#fff' }]} numberOfLines={1}>{t.name}</Text>
                  {target === t.id && <RivalIcon name="check" size={16} color={RivalColors.accentText} />}
                </TouchableOpacity>
              ))}
              {shown.length === 0 && <Text style={[s.muted, { padding: 12 }]}>No teams match that search.</Text>}
            </View>
            <MetricAndDuration
              metric={metric} setMetric={setMetric}
              days={days} setDays={setDays}
              customDays={customDays} setCustomDays={setCustomDays}
            />
          </ScrollView>
          <View style={sheet.btnRow}>
            <TouchableOpacity style={sheet.secondaryBtn} onPress={onClose}>
              <Text style={sheet.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[sheet.primaryBtn, (!valid || sending) && sheet.primaryBtnOff]} onPress={send} disabled={!valid || sending}>
              <BusyText busy={!!(sending)} style={sheet.primaryBtnText}>{sending ? 'Sending…' : 'Send challenge'}</BusyText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Phone: what counts and how long, as grey tiles.
const METRIC_ICONS: Record<ChallengeMetric, RivalIconName> = { xp: 'bolt', distance: 'distance', elevation: 'elevation', duration: 'timer', activities: 'calendar' };
function GreyMetricAndDuration({
  metric, setMetric, days, setDays, customDays, setCustomDays,
}: {
  metric: ChallengeMetric; setMetric: (m: ChallengeMetric) => void;
  days: number; setDays: (d: number) => void;
  customDays: string; setCustomDays: (v: string) => void;
}) {
  return (
    <>
      <GreyLabel>Compete on</GreyLabel>
      <GreyTiles
        columns={3}
        options={CHALLENGE_METRICS.map((m) => ({ value: m.value, label: m.label, icon: METRIC_ICONS[m.value] }))}
        value={metric}
        onChange={setMetric}
      />
      <GreyLabel>How long</GreyLabel>
      <GreyTiles
        options={[...DURATIONS.map((d) => ({ value: String(d), label: d === 7 ? '1 week' : d === 14 ? '2 weeks' : `${d} days` })), { value: '-1', label: 'Custom' }]}
        value={String(days)}
        onChange={(v) => { setDays(Number(v)); if (v !== '-1') setCustomDays(''); }}
      />
      {days === -1 ? (
        <>
          <View style={{ height: 8 }} />
          <GreyField
            value={customDays}
            onChangeText={(v) => setCustomDays(v.replace(/\D/g, '').slice(0, 2))}
            placeholder="Number of days (1–90)"
            keyboardType="number-pad"
          />
        </>
      ) : null}
    </>
  );
}

function MetricAndDuration({
  metric, setMetric, days, setDays, customDays, setCustomDays,
}: {
  metric: ChallengeMetric; setMetric: (m: ChallengeMetric) => void;
  days: number; setDays: (d: number) => void;
  customDays: string; setCustomDays: (v: string) => void;
}) {
  return (
    <>
      <Text style={sheet.label}>Measured by</Text>
      <View style={sheet.chipRow}>
        {CHALLENGE_METRICS.map(m => (
          <TouchableOpacity key={m.value} style={[sheet.chip, metric === m.value && sheet.chipOn]} onPress={() => setMetric(m.value)}>
            <Text style={[sheet.chipText, metric === m.value && sheet.chipTextOn]}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={sheet.label}>Duration</Text>
      <View style={sheet.chipRow}>
        {DURATIONS.map(d => (
          <TouchableOpacity key={d} style={[sheet.chip, days === d && sheet.chipOn]} onPress={() => { setDays(d); setCustomDays(''); }}>
            <Text style={[sheet.chipText, days === d && sheet.chipTextOn]}>{d} days</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[sheet.chip, days === -1 && sheet.chipOn]} onPress={() => setDays(-1)}>
          <Text style={[sheet.chipText, days === -1 && sheet.chipTextOn]}>Custom</Text>
        </TouchableOpacity>
      </View>
      {days === -1 && (
        <TextInput
          style={[sheet.input, { marginTop: 10 }]}
          value={customDays}
          onChangeText={(v) => setCustomDays(v.replace(/\D/g, '').slice(0, 2))}
          placeholder="Number of days (1–90)"
          placeholderTextColor={RivalColors.textSecondary}
          keyboardType="number-pad"
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkText: { fontSize: 13, fontWeight: '700', color: RivalColors.accentText },
  sectionTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 17, color: '#fff' },
  subTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: RivalColors.textSecondary, marginTop: 6 },
  muted: { fontSize: 13, color: RivalColors.textSecondary },
  emptyCard: {
    alignItems: 'center', gap: 8, paddingVertical: 22, paddingHorizontal: 16, borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.03)',
  },
  emptyText: { fontSize: 13.5, color: RivalColors.textSecondary, textAlign: 'center' },
  card: {
    backgroundColor: '#1c1a19', borderRadius: 18, borderWidth: 1, borderColor: `${RivalColors.accentFill}33`,
    padding: 14, gap: 4,
  },
  cardDone: { borderColor: 'rgba(255,255,255,0.08)' },
  cardKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: RivalColors.accentText },
  cardTitle: { fontSize: 15.5, fontWeight: '800', color: '#fff' },
  cardDetail: { fontSize: 13, color: RivalColors.textSecondary },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  primaryBtn: { flex: 1, minHeight: 44, borderRadius: 999, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontSize: 14, fontWeight: '800', color: RivalButtonColors.label(RivalColors.surfaceLowest) },
  secondaryBtn: {
    flex: 1, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 92, fontSize: 12.5, color: 'rgba(255,255,255,0.85)' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { minWidth: 64, textAlign: 'right', fontSize: 13, fontWeight: '800', color: '#fff' },
  barUnit: { fontSize: 11, fontWeight: '600', color: RivalColors.textSecondary },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  resultText: { fontSize: 13.5, fontWeight: '700', color: RivalColors.textSecondary },
  pillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: `${RivalColors.accentFill}1f`, borderWidth: 1, borderColor: `${RivalColors.accentFill}44`,
  },
  pillBtnText: { fontSize: 12.5, fontWeight: '700', color: RivalColors.accentText },
  teamList: {
    marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: RivalColors.surfaceBright,
    backgroundColor: RivalColors.surfaceLowest, maxHeight: 220, overflow: 'hidden',
  },
  teamRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    paddingHorizontal: 14, minHeight: 46, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  teamRowOn: { backgroundColor: `${RivalColors.accentFill}22` },
  teamRowText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: RivalColors.textSecondary },
});
