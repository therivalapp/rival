import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalSerifFamily } from '../../../constants/rivalTheme';
import { supabase } from '../../../lib/supabase';
import { confirmAction, notify } from '../../../lib/notify';
import { inkNudge } from '../../../lib/inkCentre';
import { webFx } from '../../../lib/webFx';
import { formatTime } from '../../../lib/time';
import { daysUntilEvent, eventResults, type EventAct, type EventFormat, type EventResult } from '../../../lib/teamEvent';
import { getItem as getPhoneItem, setItem as setPhoneItem } from '../../../lib/phoneStore';
import { CompleteRing, e3, io, useIntroClock } from './ChallengeResults';
import { GlassPill, GLASS_TEXT } from '../GlassPill';
import { LaurelWreath } from '../LaurelWreath';
import { RivalAvatar } from '../RivalAvatar';
import { RivalIcon } from '../RivalIcon';

// A team challenge that is an event (Mockups 80 v3 and 85 v2, Ricky
// 2026-11-15): before the day a countdown, who is participating and the km
// trained together; on the day the results as they come in; after it the
// soft gold ring and one list, the top three in podium colours. Broad words
// throughout: participating / participated, never racing.

type Who = { name: (userId: string) => string; avatar: (userId: string) => string | null | undefined };
type Race = { id: string; user_id: string; name: string; race_date: string; location: string | null; distance_km: number | null; format: EventFormat | null };

const RING = 200, R = 86, C = 2 * Math.PI * R;
// The results open with the finished team challenge's motion (Ricky
// 2026-11-15), once per member: the ring fills, the tick pops with confetti
// and lifts into the pill, the count rises, then the facts and the list.
const EVENT_DONE_S = 10.9;
const SHOWN_AFTER_DAYS = 14;
const PLACE = [
  { rgb: '255,215,0', color: '#FFD700', label: '1ST' },
  { rgb: '255,181,158', color: RivalColors.accentText, label: '2ND' },
  { rgb: '94,218,199', color: RivalColors.tertiary, label: '3RD' },
];

function short(name: string): string {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
}
function day(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

async function paged(userIds: string[], since: string, until: string): Promise<EventAct[]> {
  const out: EventAct[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabase.from('activities')
      .select('id, user_id, started_at, activity_type, duration_seconds, distance_meters, race_id')
      .in('user_id', userIds).gte('started_at', since).lt('started_at', until)
      .order('started_at', { ascending: true }).range(from, from + 999);
    if (error || !data) break;
    out.push(...(data as EventAct[]));
    if (data.length < 1000) break;
  }
  return out;
}

export function TeamEvent({ teamId, raceId, start, memberIds, me, who, onConfetti }: {
  teamId: string; raceId: string; start: string; memberIds: string[]; me: string | null; who: Who;
  onConfetti?: () => void;
}) {
  const [race, setRace] = useState<Race | null>(null);
  const [inIds, setInIds] = useState<string[]>([]);
  const [acts, setActs] = useState<EventAct[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const introKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: r }, { data: ints }] = await Promise.all([
      supabase.from('races').select('id, user_id, name, race_date, location, distance_km, format').eq('id', raceId).maybeSingle(),
      supabase.from('race_interests').select('user_id').eq('race_id', raceId),
    ]);
    if (!r) return;
    setRace(r as Race);
    const people = [...new Set([(r as Race).user_id, ...((ints ?? []) as { user_id: string }[]).map((i) => i.user_id)])].filter((u) => memberIds.includes(u));
    setInIds(people);
    if (!people.length) { setActs([]); setLoaded(true); return; }
    // From three years back, for PBs; the day after the event, for its results.
    const since = new Date(`${(r as Race).race_date}T00:00:00`); since.setFullYear(since.getFullYear() - 3);
    const until = new Date(`${(r as Race).race_date}T00:00:00`); until.setDate(until.getDate() + 1);
    setActs(await paged(people, since.toISOString(), until.toISOString()));
    setLoaded(true);
  }, [raceId, memberIds.join(',')]);

  useEffect(() => { load(); }, [load]);

  const left = race ? daysUntilEvent(race.race_date) : 1;
  const doneKey = `eventDone:${teamId}:${raceId}`;
  const finishedNow = !!race && loaded && left < 0 && left >= -SHOWN_AFTER_DAYS;
  if (finishedNow && introKey.current == null && !getPhoneItem(doneKey)) introKey.current = doneKey;
  const play = finishedNow && introKey.current === doneKey;
  const t = useIntroClock(play, () => { setPhoneItem(doneKey, '1'); onConfetti?.(); }, () => { setPhoneItem(doneKey, '1'); introKey.current = 'done'; }, EVENT_DONE_S);
  const intro = play && t < EVENT_DONE_S;
  // Each part's way in: 0 hidden, 1 in place.
  const at = (from: number, len = 0.6) => (intro ? io((t - from) / len) : 1);

  if (!race) return null;
  if (left < -SHOWN_AFTER_DAYS) return null;
  const phase: 'before' | 'day' | 'after' = left > 0 ? 'before' : left === 0 ? 'day' : 'after';
  const format: EventFormat = race.format ?? 'finish';
  const results = eventResults({ format, date: race.race_date, distanceKm: race.distance_km, participants: inIds, activities: acts });
  const trainedRows = acts.filter((a) => a.started_at.slice(0, 10) >= start && a.started_at.slice(0, 10) < race.race_date);
  const kmTrained = Math.round(trainedRows.reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000);
  const pbs = results.filter((r) => r.pb).length;
  const imIn = !!me && inIds.includes(me);
  const owner = me === race.user_id;

  async function toggleIn() {
    if (!me || busy) return;
    if (imIn) {
      if (owner) return;
      const ok = await confirmAction({ title: 'Leave this event?', message: `You won't be listed as participating in the ${race!.name}.`, confirmLabel: 'Leave' });
      if (!ok) return;
    }
    setBusy(true);
    const { error } = imIn
      ? await supabase.from('race_interests').delete().eq('race_id', raceId).eq('user_id', me)
      : await supabase.from('race_interests').insert({ race_id: raceId, user_id: me });
    setBusy(false);
    if (error) { notify("Couldn't update", error.message); return; }
    load();
  }

  const value = (r: EventResult) => {
    if (format === 'laps') return <Text style={s.value}>{r.laps}<Text style={s.valueUnit}> {r.laps === 1 ? 'lap' : 'laps'} · {r.km.toFixed(1)} km</Text></Text>;
    if (format === 'timed' || !r.finished) return <Text style={[s.value, !r.finished && s.valueKm]}>{r.km.toFixed(1)}<Text style={s.valueUnit}> km</Text></Text>;
    return <Text style={s.value}>{formatTime(r.seconds, 'finish')}</Text>;
  };
  const pbTag = (r: EventResult) => (r.pb ? <GlassPill tone="gold" style={s.pb}><Text style={s.pbText}>PB</Text></GlassPill> : null);

  // The ring: days to go, results in so far, then everyone who participated.
  const ringFill = phase === 'before'
    ? Math.min(1, Math.max(0.02, 1 - left / Math.max(left, daysUntilEvent(race.race_date, new Date(`${start}T12:00:00`)))))
    : phase === 'day' ? (inIds.length ? results.length / inIds.length : 0) : 1;
  const big = phase === 'before' ? String(left) : String(results.length);
  const small = phase === 'before' ? (left === 1 ? 'day to go' : 'days to go') : phase === 'day' ? `of ${inIds.length} in` : 'participated';

  const top = phase === 'after' ? results.slice(0, 3) : [];
  const rest = phase === 'after' ? results.slice(3) : results;
  const waiting = phase === 'day' ? inIds.filter((u) => !results.some((r) => r.userId === u)) : [];

  return (
    <View style={s.wrap}>
      {phase === 'before' ? (
        <GlassPill tone="ivory" style={s.pill}><RivalIcon name="flag" size={14} color={GLASS_TEXT.ivory} /><Text style={[s.pillText, { color: GLASS_TEXT.ivory }]}>TEAM EVENT</Text></GlassPill>
      ) : phase === 'day' ? (
        <GlassPill tone="salmon" style={s.pill}><RivalIcon name="flag" size={14} color={GLASS_TEXT.salmon} /><Text style={[s.pillText, { color: GLASS_TEXT.salmon }]}>EVENT DAY</Text></GlassPill>
      ) : (
        <View style={intro ? { opacity: at(5.75, 0.5), transform: [{ scale: 0.85 + 0.15 * at(5.75, 0.5) }] } : undefined}>
          <GlassPill tone="gold" style={s.pill}><RivalIcon name="checkCircle" size={14} color={GLASS_TEXT.gold} /><Text style={[s.pillText, { color: GLASS_TEXT.gold }]}>EVENT COMPLETE</Text></GlassPill>
        </View>
      )}

      {phase === 'after' ? (
        <View style={s.ringAfter}>
          <CompleteRing
            t={intro ? t : 7}
            hold
            soft
            tickUp
            tickOutAt={5.45}
            center={at(6.1) > 0 ? (
              <View style={{ alignItems: 'center', opacity: at(6.1), transform: [{ translateY: 10 * (1 - at(6.1)) }] }}>
                {(() => {
                  const n = intro ? String(Math.round(results.length * e3((t - 6.1) / 3))) : big;
                  const size = n.length <= 2 ? 64 : n.length === 3 ? 56 : 46;
                  return <Text style={[s.big, { fontSize: size, lineHeight: size * 1.15, transform: [{ translateY: inkNudge(n, size) }] }]}>{n}</Text>;
                })()}
                <Text style={s.small}>{small}</Text>
              </View>
            ) : null}
          />
        </View>
      ) : (
        <EventRing fill={ringFill} gold={false} big={big} small={small} />
      )}

      <View style={[s.whole, intro && { opacity: at(7.6), transform: [{ translateY: 12 * (1 - at(7.6)) }] }]}>
        <Text style={s.name}>{race.name}</Text>
        <Text style={s.when}>{[day(race.race_date), race.location].filter(Boolean).join(' · ')}</Text>
      </View>

      <View style={[s.facts, intro && { opacity: at(8.1) }]}>
        {phase === 'after' ? null : <Fact n={inIds.length} label="PARTICIPANTS" />}
        <Fact n={kmTrained} label="KM TRAINED" line={phase !== 'after'} />
        {phase === 'day' ? <Fact n={pbs} label={pbs === 1 ? 'PB SO FAR' : 'PBS SO FAR'} line /> : <Fact n={trainedRows.length} label="ACTIVITIES" line />}
        {phase === 'after' ? <Fact n={pbs} label={pbs === 1 ? 'PB' : 'PBS'} line /> : null}
      </View>

      {phase === 'before' ? (
        <>
          <View style={s.sec}><Text style={s.secText}>PARTICIPANTS</Text><Text style={s.secCount}>{inIds.length}</Text></View>
          <View style={s.avRow}>
            {inIds.map((u) => <View key={u} style={s.avRing}><RivalAvatar uri={who.avatar(u)} name={who.name(u)} size={38} /></View>)}
          </View>
          <Text style={s.note}>{`Training since ${day(start)}. Everyone's activities count toward the km.`}</Text>
          {me && !owner ? (
            <TouchableOpacity style={[s.btn, imIn && s.btnIn]} onPress={toggleIn} disabled={busy} activeOpacity={0.85} accessibilityRole="button">
              {imIn ? <RivalIcon name="checkCircle" size={16} color={RivalColors.accentText} /> : null}
              <Text style={[s.btnText, imIn && s.btnInText]}>{imIn ? "You're in" : "I'm in"}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : (
        <>
          <View style={[s.sec, intro && { opacity: at(8.6) }]}>
            <Text style={s.secText}>{format === 'finish' ? 'EVENT DAY' : 'FURTHEST FIRST'}</Text>
            <Text style={s.secCount}>{phase === 'day' ? `${results.length} of ${inIds.length}` : results.length}</Text>
          </View>
          {top.length ? (
            <View style={s.stack}>
              {top.map((r, i) => {
                const p = PLACE[i];
                // Third, second, then first rises into place, as the podium does.
                const q = at([9.7, 9.35, 9.0][i], 0.9);
                return (
                  <View key={r.userId} style={[s.tile, intro && { opacity: q, transform: [{ translateY: 24 * (1 - q) }] }, { borderColor: `rgba(${p.rgb},0.65)`, borderTopColor: `rgba(${p.rgb},0.95)` }, webFx({ backgroundImage: `linear-gradient(160deg, rgba(${p.rgb},0.24), rgba(${p.rgb},0.06) 60%, rgba(${p.rgb},0.12))`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)' }), { backgroundColor: `rgba(${p.rgb},0.1)` }]}>
                    <Text style={[s.place, { color: p.color }]}>{p.label}</Text>
                    <View style={[s.tileRing, { borderColor: p.color }, i === 0 && { marginVertical: 4 }]}>
                      {i === 0 ? <LaurelWreath avatarSize={34} shadow={false} /> : null}
                      <RivalAvatar uri={who.avatar(r.userId)} name={who.name(r.userId)} size={34} />
                    </View>
                    <Text style={s.rowName} numberOfLines={1}>{short(who.name(r.userId))}</Text>
                    {pbTag(r)}
                    <View style={{ flex: 1 }} />
                    {value(r)}
                  </View>
                );
              })}
            </View>
          ) : null}
          {rest.length || waiting.length ? (
            <View style={[s.list, intro && { opacity: at(10.2, 0.7) }]}>
              {rest.map((r, i) => (
                <View key={r.userId} style={[s.row, i > 0 && s.rowLine]}>
                  <RivalAvatar uri={who.avatar(r.userId)} name={who.name(r.userId)} size={32} />
                  <Text style={s.rowName} numberOfLines={1}>{short(who.name(r.userId))}</Text>
                  {pbTag(r)}
                  <View style={{ flex: 1 }} />
                  {value(r)}
                </View>
              ))}
              {waiting.map((u, i) => (
                <View key={u} style={[s.row, (rest.length > 0 || i > 0) && s.rowLine]}>
                  <RivalAvatar uri={who.avatar(u)} name={who.name(u)} size={32} />
                  <Text style={s.rowName} numberOfLines={1}>{short(who.name(u))}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={s.wait}>Not in yet</Text>
                </View>
              ))}
            </View>
          ) : null}
          {phase === 'after' && !results.length ? <Text style={s.note}>No activities were added on the day.</Text> : null}
        </>
      )}
    </View>
  );
}

function Fact({ n, label, line }: { n: number; label: string; line?: boolean }) {
  const text = n.toLocaleString();
  return (
    <View style={[s.fact, line && s.factLine]}>
      <Text style={[s.factNum, { transform: [{ translateY: inkNudge(text, 26) }] }]}>{text}</Text>
      <Text style={s.factLabel}>{label}</Text>
    </View>
  );
}

function EventRing({ fill, gold, big, small }: { fill: number; gold: boolean; big: string; small: string }) {
  const id = `ev${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const size = big.length <= 2 ? 64 : big.length === 3 ? 56 : 46;
  return (
    <View style={s.ring}>
      <Svg width={RING} height={RING} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        {/* Light gold at the top: the ring is turned, so x runs bottom to top. */}
        <Defs>
          <LinearGradient id={id} x1="1" y1="0" x2="0" y2="0">
            <Stop offset="0" stopColor="#f3d77a" />
            <Stop offset="1" stopColor="#c79a2e" />
          </LinearGradient>
        </Defs>
        <Circle cx={100} cy={100} r={R} stroke="rgba(255,255,255,0.1)" strokeWidth={12} fill="none" />
        <Circle cx={100} cy={100} r={R} stroke={gold ? `url(#${id})` : '#e9a48a'} strokeWidth={12} fill="none" strokeLinecap="round" strokeDasharray={`${Math.max(0.01, C * Math.min(1, fill))} ${C}`} />
      </Svg>
      <Text style={[s.big, { fontSize: size, lineHeight: size * 1.15, transform: [{ translateY: inkNudge(big, size) }] }]}>{big}</Text>
      <Text style={s.small}>{small}</Text>
    </View>
  );
}

const SERIF = { fontFamily: RivalSerifFamily, fontStyle: 'italic' as const, fontWeight: '700' as const, color: '#fff' };
const s = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: 18, paddingHorizontal: 18, alignSelf: 'stretch' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12 },
  pillText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4 },
  ring: { width: RING, height: RING, marginTop: 14, alignItems: 'center', justifyContent: 'center' },
  ringAfter: { marginTop: 14, alignSelf: 'stretch', alignItems: 'center' },
  whole: { alignItems: 'center', alignSelf: 'stretch' },
  big: { ...SERIF, color: RivalColors.event, paddingHorizontal: 8, textAlign: 'center' },
  small: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  name: { ...SERIF, fontSize: 22, marginTop: 12, textAlign: 'center' },
  when: { fontFamily: RivalFontFamily, fontSize: 13, fontWeight: '800', color: '#fff', marginTop: 2, textAlign: 'center' },
  facts: { flexDirection: 'row', marginTop: 14, width: 330, maxWidth: '100%' },
  fact: { flex: 1, alignItems: 'center' },
  factLine: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.15)' },
  factNum: { ...SERIF, fontSize: 26, lineHeight: 30 },
  factLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.4, color: RivalColors.accentText, marginTop: 2 },
  sec: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 22, marginBottom: 10, paddingHorizontal: 2 },
  secText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5, color: '#A0A0A0' },
  secCount: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1, color: RivalColors.accentText },
  avRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignSelf: 'stretch' },
  avRing: { borderRadius: 21, borderWidth: 2, borderColor: 'rgba(244,234,216,0.5)' },
  note: { fontFamily: RivalFontFamily, fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 12, alignSelf: 'stretch' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 999, backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient },
  btnText: { fontSize: 14, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
  btnIn: { backgroundColor: 'rgba(255,209,190,0.05)', borderWidth: 1, borderColor: 'rgba(255,181,158,0.4)', ...RivalButtonColors.noGradient },
  btnInText: { color: RivalColors.accentText },
  stack: { alignSelf: 'stretch', gap: 8, marginBottom: 8 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 16 },
  place: { width: 30, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  tileRing: { borderWidth: 2, borderRadius: 20, position: 'relative' },
  list: { alignSelf: 'stretch', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  rowLine: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  rowName: { fontFamily: RivalFontFamily, fontSize: 14, fontWeight: '700', color: '#fff', flexShrink: 1 },
  pb: { paddingHorizontal: 7, paddingVertical: 2 },
  pbText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: GLASS_TEXT.gold },
  value: { ...SERIF, fontSize: 19, color: RivalColors.event },
  valueKm: { color: '#ffd2bf' },
  valueUnit: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontWeight: '600', fontSize: 11, color: 'rgba(255,255,255,0.55)' },
  wait: { fontFamily: RivalFontFamily, fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
});
