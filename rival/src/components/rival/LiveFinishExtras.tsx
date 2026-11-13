import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { liveClock } from '../../lib/liveActivity';
import { isHoldLift } from '../../lib/lifts';
import { HYROX_STATIONS, roundTimes, scoreText, WOD_LABEL, type ActivityStats, type MatchResult, type Score, type SkiDay, type Wod, type WodFormat } from '../../lib/activityStats';
import type { TrackPoint } from '../../lib/liveTrack';
import { toDisplayElevation, toDisplayWeight, weightUnit, elevationUnit } from '../../lib/units';
import { FinishTiles } from './LiveFinishParts';
import { RivalIcon } from './RivalIcon';
import { webFx } from '../../lib/webFx';

// The Finish cards that only some activities have (Ricky, 2026-11-02:
// design/finish-weights-mockup.png, design/finish-special-mockup.png,
// design/finish-ski-crossfit-mockup.png, design/crossfit-live-mockup.png).

const serif = { fontFamily: RivalSerifFamily, fontStyle: 'italic' as const, fontWeight: '700' as const };
const grad = (deg: number) => (webFx({ backgroundImage: `linear-gradient(${deg}deg, #D97757, #ffb59e)` }));
const kgText = (kg: number) => `${Math.round(toDisplayWeight(kg) * 10) / 10} ${weightUnit()}`;

/** Lifts in three columns, a PB pill by any lift heavier than ever before. */
export function LiftsCard({ lifts, pbs }: { lifts: { name: string; sets?: number; reps?: number; weight?: number }[]; pbs: boolean[] }) {
  if (!lifts.length) return null;
  const count = pbs.filter(Boolean).length;
  return (
    <View style={s.card}>
      <View style={s.head}><Text style={s.title}>LIFTS</Text>{count ? <Text style={s.extra}>{`${count} PB`}</Text> : null}</View>
      <View style={s.cols}>
        <Text style={[s.colText, { flex: 1 }]}>EXERCISE</Text>
        <Text style={[s.colText, { width: 74 }]}>SETS × REPS</Text>
        <Text style={[s.colText, { width: 70, textAlign: 'right' }]}>WEIGHT</Text>
      </View>
      {lifts.map((l, i) => (
        <View key={`${l.name}-${i}`} style={[s.row, i > 0 && s.line]}>
          <View style={s.liftName}>
            <Text style={s.name} numberOfLines={1}>{l.name}</Text>
            {pbs[i] ? <Text style={s.pb}>PB</Text> : null}
          </View>
          <Text style={[s.dim, { width: 74 }]}>{l.sets && l.reps ? `${l.sets} × ${l.reps}${isHoldLift(l.name) ? ' sec' : ''}` : l.sets ? `${l.sets} sets` : l.reps ? `${l.reps} reps` : '-'}</Text>
          <Text style={[s.num, { width: 70 }]}>{l.weight ? kgText(l.weight) : '-'}</Text>
        </View>
      ))}
    </View>
  );
}

type Col = { label: string; width?: number };

/** A titled table; the first column takes the room left. Past `show` rows,
 *  a link opens the rest in place. */
export function TableCard({ title, extra, cols, rows, hi, show = 99, moreNoun = 'more' }: {
  title: string; extra?: string; cols: Col[]; rows: string[][]; hi?: number; show?: number; moreNoun?: string;
}) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, show);
  const last = cols.length - 1;
  return (
    <View style={s.card}>
      <View style={s.head}><Text style={s.title}>{title}</Text>{extra ? <Text style={s.extra}>{extra}</Text> : null}</View>
      <View style={s.cols}>
        {cols.map((c, i) => <Text key={c.label + i} style={[s.colText, c.width ? { width: c.width } : { flex: 1 }, i === last && { textAlign: 'right' }]}>{c.label}</Text>)}
      </View>
      {shown.map((r, k) => (
        <View key={k} style={[s.row, k > 0 && s.line]}>
          {r.map((v, i) => (
            <Text
              key={i} numberOfLines={1}
              style={[i === 0 ? [s.name, { flex: 1 }, k === hi && { color: RivalColors.accentText }] : i === last ? [s.num, { width: cols[i].width }] : [s.dim, { width: cols[i].width }]]}
            >{v}</Text>
          ))}
        </View>
      ))}
      {rows.length > show && !all ? (
        <TouchableOpacity style={[s.moreLink, s.line]} onPress={() => setAll(true)}>
          <Text style={s.moreLinkText}>{`${rows.length - show} ${moreNoun}`}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** The day's altitude: lifts up as dashed lines, runs down in peach, the
 *  longest in white. */
export function SkiChart({ track, day }: { track: TrackPoint[]; day: SkiDay }) {
  const [w, setW] = useState(0);
  const H = 74;
  const pts = useMemo(() => track.filter((p) => p.alt != null), [track]);
  const lines = useMemo(() => {
    if (!w || pts.length < 2) return [];
    const alts = pts.map((p) => p.alt as number);
    const lo = Math.min(...alts), hi = Math.max(...alts);
    const t0 = pts[0].s, t1 = pts[pts.length - 1].s || 1;
    const x = (i: number) => ((pts[i].s - t0) / (t1 - t0 || 1)) * w;
    const y = (i: number) => H - 3 - ((alts[i] - lo) / (hi - lo || 1)) * (H - 6);
    const longest = day.runs.reduce((b, r, i) => (r.descent > (day.runs[b]?.descent ?? -1) ? i : b), 0);
    const out: { x1: number; y1: number; x2: number; y2: number; kind: 'lift' | 'run' | 'best' }[] = [];
    const runOf = (i: number) => day.runs.findIndex((r) => i > r.from && i <= r.to);
    // Every few points is plenty at this size.
    const step = Math.max(1, Math.floor(pts.length / 240));
    for (let i = step; i < pts.length; i += step) {
      const r = runOf(i);
      out.push({ x1: x(i - step), y1: y(i - step), x2: x(i), y2: y(i), kind: r < 0 ? 'lift' : r === longest ? 'best' : 'run' });
    }
    return out;
  }, [w, pts, day]);
  const range = pts.length ? `${Math.round(toDisplayElevation(Math.min(...pts.map((p) => p.alt as number)))).toLocaleString()} TO ${Math.round(toDisplayElevation(day.highest ?? 0)).toLocaleString()} ${elevationUnit().toUpperCase()}` : '';
  return (
    <View style={s.card} onLayout={(e) => setW(e.nativeEvent.layout.width - 24)}>
      <View style={s.head}><Text style={s.title}>ELEVATION</Text><Text style={s.extra}>{range}</Text></View>
      {w ? (
        <Svg width={w} height={H} style={{ marginTop: 6 }}>
          {lines.map((l, i) => (
            <Line
              key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeLinecap="round"
              stroke={l.kind === 'lift' ? 'rgba(255,255,255,0.35)' : l.kind === 'best' ? '#fff' : '#e8835f'}
              strokeWidth={l.kind === 'lift' ? 1.5 : 2.5} strokeDasharray={l.kind === 'lift' ? '3 3' : undefined}
            />
          ))}
        </Svg>
      ) : <View style={{ height: H }} />}
      <View style={s.legend}>
        <Text style={s.legendText}><Text style={{ color: '#e8835f' }}>—</Text> Runs   <Text style={{ color: '#fff' }}>—</Text> Longest</Text>
        <Text style={s.legendText}>┄ Lifts</Text>
      </View>
    </View>
  );
}

/** Vertical bars, lower is faster: swim splits per 100 m. */
export function MiniBars({ title, seconds, labels }: { title: string; seconds: number[]; labels: string[] }) {
  if (!seconds.length) return null;
  const best = Math.min(...seconds), worst = Math.max(...seconds);
  const h = (v: number) => 35 + (worst > best ? (worst - v) / (worst - best) : 1) * 65;
  const small = seconds.length > 12;
  return (
    <View style={s.card}>
      <View style={s.head}><Text style={s.title}>{title}</Text><Text style={s.extra}>{`FASTEST ${liveClock(best)}`}</Text></View>
      <View style={[s.bars, { gap: small ? 2 : 4 }]}>
        {seconds.map((v, i) => <View key={i} style={[s.bar, v === best && s.barBest, { height: `${h(v)}%` }]} />)}
      </View>
      <View style={[s.labels, { gap: small ? 2 : 4 }]}>{seconds.map((v, i) => <Text key={i} style={[s.barTime, small && { fontSize: 8.5 }]}>{liveClock(v)}</Text>)}</View>
      <View style={[s.labels, { gap: small ? 2 : 4 }]}>{labels.map((l, i) => <Text key={i} style={s.barNum}>{l}</Text>)}</View>
    </View>
  );
}

/** An empty card that asks for something, such as the result. */
export function AddCard({ label, onPress, style }: { label: string; onPress: () => void; style?: any }) {
  return (
    <TouchableOpacity style={[s.add, style]} onPress={onPress} activeOpacity={0.8}>
      <RivalIcon name="add" size={18} color={RivalColors.accentText} />
      <Text style={s.addText}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Who was played and the score by set. Never won or lost (Ricky,
 *  2026-11-02): the sets say it. */
export function ResultCard({ result, me, onEdit, style }: { result: MatchResult; me: string; onEdit: () => void; /** Log an activity draws it in its own card style. */ style?: any }) {
  const who = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const them = result.opponent?.trim() || 'Opponent';
  return (
    <TouchableOpacity style={[s.card, style]} onPress={onEdit} activeOpacity={0.85}>
      <View style={s.resTop}>
        <Text style={s.vs}>{result.opponent ? <>Played <Text style={{ color: '#fff', fontWeight: '800' }}>{result.opponent}</Text>{result.opponentId ? ' · tagged' : ''}</> : 'Result'}</Text>
      </View>
      {result.sets.length ? (
        <View style={{ marginTop: 9 }}>
          {[me, them].map((name, side) => (
            <View key={side} style={s.setRow}>
              <View style={s.who}><Text style={s.avatar}>{who(name)}</Text><Text style={s.name} numberOfLines={1}>{name}</Text></View>
              {result.sets.map((set, i) => <Text key={i} style={s.setNum}>{set[side]}</Text>)}
            </View>
          ))}
        </View>
      ) : null}
      <Text style={s.edit}>Edit result</Text>
    </TouchableOpacity>
  );
}

export function ScoreCard({ score, wod, onEdit, style }: { score: Score; wod?: Wod | null; onEdit: () => void; style?: any }) {
  const what = [wod && wod.format !== 'lifts' ? `${WOD_LABEL[wod.format].toUpperCase()}${wod.minutes ? ` ${wod.minutes} MIN` : ''}` : null, score.workout?.toUpperCase()].filter(Boolean)[0];
  const [big, small] = score.kind === 'rounds' ? [scoreText(score, liveClock, kgText), score.reps ? ' reps' : '']
    : score.kind === 'reps' ? [String(score.reps ?? 0), ' reps']
    : score.kind === 'weight' ? [String(Math.round(toDisplayWeight(score.kg ?? 0) * 10) / 10), ` ${weightUnit()}`]
    : [liveClock(score.seconds ?? 0), ''];
  return (
    <TouchableOpacity style={[s.card, style]} onPress={onEdit} activeOpacity={0.85}>
      <View style={s.resTop}>
        <Text style={s.title}>{what ? `SCORE · ${what}` : 'SCORE'}</Text>
        <Text style={s.rx}>{score.rx === false ? 'SCALED' : 'RX'}</Text>
      </View>
      <Text style={s.score}>{big}{small ? <Text style={s.scoreUnit}>{small}</Text> : null}</Text>
      <Text style={s.edit}>Edit score</Text>
    </TouchableOpacity>
  );
}

function Stepper({ value, name, onChange }: { value: number; name: string; onChange: (n: number) => void }) {
  return (
    <View style={s.step}>
      <Text style={s.stepName}>{name}</Text>
      <View style={s.stepRow}>
        <TouchableOpacity style={s.pm} onPress={() => onChange(Math.max(0, value - 1))} accessibilityLabel={`Less ${name.toLowerCase()}`}><RivalIcon name="remove" size={20} color={RivalColors.accentText} /></TouchableOpacity>
        <TextInput
          style={s.stepValue} keyboardType="number-pad" value={String(value)} selectTextOnFocus
          onChangeText={(t) => onChange(Math.max(0, Math.floor(Number(t) || 0)))}
        />
        <TouchableOpacity style={s.pm} onPress={() => onChange(value + 1)} accessibilityLabel={`More ${name.toLowerCase()}`}><RivalIcon name="add" size={20} color={RivalColors.accentText} /></TouchableOpacity>
      </View>
    </View>
  );
}

function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <View style={s.chips}>
      {options.map(([v, l]) => (
        <TouchableOpacity key={v} style={[s.chip, value === v && s.chipOn]} onPress={() => onChange(v)} activeOpacity={0.8}>
          <Text style={[s.chipText, value === v && s.chipTextOn]}>{l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** The score pop-up's body: the kind, the numbers, RX or Scaled, the workout. */
export function ScoreEditor({ value, onChange, counted }: { value: Score; onChange: (s: Score) => void; /** Rounds tapped during the workout. */ counted?: number }) {
  const set = (p: Partial<Score>) => onChange({ ...value, ...p });
  const secs = value.seconds ?? 0;
  return (
    <View>
      <Chips value={value.kind} options={[['rounds', 'Rounds + reps'], ['time', 'Time'], ['weight', 'Weight'], ['reps', 'Reps']]} onChange={(kind) => set({ kind })} />
      <View style={s.steps}>
        {value.kind === 'rounds' ? (
          <>
            <Stepper value={value.rounds ?? 0} name="ROUNDS" onChange={(rounds) => set({ rounds })} />
            <Stepper value={value.reps ?? 0} name="EXTRA REPS" onChange={(reps) => set({ reps })} />
          </>
        ) : value.kind === 'time' ? (
          <>
            <Stepper value={Math.floor(secs / 60)} name="MINUTES" onChange={(m) => set({ seconds: m * 60 + (secs % 60) })} />
            <Stepper value={secs % 60} name="SECONDS" onChange={(x) => set({ seconds: Math.floor(secs / 60) * 60 + Math.min(59, x) })} />
          </>
        ) : value.kind === 'weight' ? (
          <Stepper value={Math.round(toDisplayWeight(value.kg ?? 0))} name={weightUnit().toUpperCase()} onChange={(w) => set({ kg: weightUnit() === 'lb' ? w * 0.453592 : w })} />
        ) : (
          <Stepper value={value.reps ?? 0} name="REPS" onChange={(reps) => set({ reps })} />
        )}
      </View>
      <Text style={s.label}>LEVEL</Text>
      <Chips value={value.rx === false ? 'scaled' : 'rx'} options={[['rx', 'RX'], ['scaled', 'Scaled']]} onChange={(v) => set({ rx: v === 'rx' })} />
      <View style={s.field}>
        <Text style={s.stepName}>FORMAT</Text>
        <TextInput style={s.fieldInput} value={value.workout ?? ''} onChangeText={(workout) => set({ workout })} placeholder="AMRAP 20 min" placeholderTextColor="#777" />
      </View>
      {counted ? (
        <View style={s.counted}>
          <RivalIcon name="checkCircle" size={15} color={RivalColors.accentText} />
          <Text style={s.countedText}>{`${counted} ${counted === 1 ? 'round' : 'rounds'} counted during the activity`}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The result pop-up's body. Racket sports score by set; team sports one line. */
export function ResultEditor({ value, onChange, team, teammates = [] }: {
  value: MatchResult; onChange: (r: MatchResult) => void; team: boolean;
  /** Teammates to pick as the opponent: picked, they are tagged and get their own copy. */
  teammates?: { id: string; name: string }[];
}) {
  const set = (p: Partial<MatchResult>) => onChange({ ...value, ...p });
  const sets = value.sets.length ? value.sets : [[0, 0] as [number, number]];
  const put = (i: number, side: 0 | 1, n: number) => set({ sets: sets.map((p, k) => (k === i ? (side ? [p[0], n] : [n, p[1]]) as [number, number] : p)) });
  return (
    <View>
      <View style={s.field}>
        <Text style={s.stepName}>{team ? 'AGAINST' : 'OPPONENT'}</Text>
        <TextInput style={s.fieldInput} value={value.opponent ?? ''} onChangeText={(opponent) => set({ opponent, opponentId: null })} placeholder={team ? 'Team name' : 'Name'} placeholderTextColor="#777" />
      </View>
      {!team && teammates.length ? (
        <>
          <View style={[s.chips, { marginTop: 8 }]}>
            {teammates.slice(0, 6).map((m) => (
              <TouchableOpacity key={m.id} style={[s.chip, value.opponentId === m.id && s.chipOn]} activeOpacity={0.8}
                onPress={() => set(value.opponentId === m.id ? { opponent: '', opponentId: null } : { opponent: m.name, opponentId: m.id })}>
                <Text style={[s.chipText, value.opponentId === m.id && s.chipTextOn]}>{m.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[s.hint, { textAlign: 'left', marginLeft: 2 }]}>
            {value.opponentId ? `${value.opponent} is asked to confirm, and gets the activity and the result on their own profile.` : 'A teammate picked here is asked to confirm, like a training partner.'}
          </Text>
        </>
      ) : null}
      <Text style={s.label}>{team ? 'SCORE' : 'SETS'}</Text>
      {sets.map((p, i) => (
        <View key={i} style={s.steps}>
          <Stepper value={p[0]} name={team ? 'US' : `SET ${i + 1} · YOU`} onChange={(n) => put(i, 0, n)} />
          <Stepper value={p[1]} name={team ? 'THEM' : 'THEM'} onChange={(n) => put(i, 1, n)} />
        </View>
      ))}
      {!team && sets.length < 5 ? (
        <TouchableOpacity style={s.addSet} onPress={() => set({ sets: [...sets, [0, 0]] })}>
          <RivalIcon name="add" size={16} color={RivalColors.accentText} /><Text style={s.addText}>Add set</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** After Start on CrossFit or HYROX: the workout's shape (design/crossfit-live-mockup.png, 1). */
export function WodPicker({ value, onChange, hyrox }: { value: Wod; onChange: (w: Wod) => void; hyrox: boolean }) {
  const set = (p: Partial<Wod>) => onChange({ ...value, ...p });
  const formats: [WodFormat, string, string][] = hyrox
    ? [['race', 'Race', '8 runs, 8 stations'], ['lifts', 'Lifts', 'Sets and reps']]
    : [['amrap', 'AMRAP', 'Most rounds'], ['fortime', 'For time', 'Fastest'], ['emom', 'EMOM', 'Every minute'], ['lifts', 'Lifts', 'Sets and reps']];
  const timed = value.format === 'amrap' || value.format === 'emom' || value.format === 'fortime';
  const moves = value.movements ?? [];
  return (
    <View>
      <View style={s.formats}>
        {formats.map(([f, name, sub]) => (
          <TouchableOpacity key={f} style={[s.format, value.format === f && s.chipOn]} onPress={() => set({ format: f, minutes: f === 'amrap' || f === 'emom' ? value.minutes ?? 20 : null })} activeOpacity={0.8}>
            <Text style={[s.formatName, value.format === f && s.chipTextOn]}>{name}</Text>
            <Text style={s.formatSub}>{sub}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {timed ? (
        <>
          <Text style={s.label}>{value.format === 'fortime' ? 'TIME CAP · OPTIONAL' : 'TIME'}</Text>
          <View style={s.capRow}>
            <TouchableOpacity style={s.pm} onPress={() => set({ minutes: Math.max(0, (value.minutes ?? 0) - 1) || null })}><RivalIcon name="remove" size={20} color={RivalColors.accentText} /></TouchableOpacity>
            <Text style={s.cap}>{value.minutes ? `${value.minutes} min` : 'None'}</Text>
            <TouchableOpacity style={s.pm} onPress={() => set({ minutes: (value.minutes ?? 0) + 1 })}><RivalIcon name="add" size={20} color={RivalColors.accentText} /></TouchableOpacity>
          </View>
          <Text style={s.label}>MOVEMENTS · OPTIONAL</Text>
          <View style={s.moves}>
            {[...moves, { name: '', reps: null }].map((m, i) => (
              <View key={i} style={[s.moveRow, i > 0 && s.line]}>
                <TextInput
                  style={[s.moveName]} value={m.name} placeholder={i === moves.length ? 'Add a movement' : ''} placeholderTextColor="#777"
                  onChangeText={(name) => set({ movements: i === moves.length ? [...moves, { name, reps: null }] : moves.map((x, k) => (k === i ? { ...x, name } : x)).filter((x, k) => x.name || k !== i) })}
                />
                {i < moves.length ? (
                  <TextInput
                    style={s.moveReps} keyboardType="number-pad" value={m.reps ? String(m.reps) : ''} placeholder="Reps" placeholderTextColor="#777"
                    onChangeText={(t) => set({ movements: moves.map((x, k) => (k === i ? { ...x, reps: Number(t) || null } : x)) })}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </>
      ) : value.format === 'race' ? (
        <>
          <Text style={s.label}>DIVISION</Text>
          <Chips value={value.division ?? 'Open'} options={[['Open', 'Open'], ['Pro', 'Pro'], ['Doubles', 'Doubles'], ['Relay', 'Relay']]} onChange={(division) => set({ division })} />
          <TouchableOpacity style={s.toggle} onPress={() => set({ roxzone: !value.roxzone })} activeOpacity={0.8}>
            <View style={{ flex: 1 }}>
              <Text style={s.toggleName}>Time the Roxzone</Text>
              <Text style={s.toggleSub}>A tap going in and coming out of each station.</Text>
            </View>
            <View style={[s.switch, value.roxzone && s.switchOn]}><View style={[s.knob, value.roxzone && s.knobOn]} /></View>
          </TouchableOpacity>
          <Text style={s.hint}>{`Tap Done as each part ends: ${HYROX_STATIONS.length} runs of 1 km, each followed by a station.`}</Text>
        </>
      ) : null}
    </View>
  );
}

/** Live: the rounds so far and the one big button (design/crossfit-live-mockup.png, 2). */
export function RoundsCard({ laps, onRound, label = 'Round', icon = 'add', name = 'ROUNDS', sub, showTimes = true }: { laps: number[]; onRound: () => void; label?: string; icon?: 'add' | 'check'; name?: string; sub?: string | null; showTimes?: boolean }) {
  const times = roundTimes(laps);
  return (
    <View style={s.rounds}>
      <View style={{ flex: 1 }}>
        <Text style={s.stepName}>{name}</Text>
        <Text style={s.roundsN} numberOfLines={1}>{sub ?? String(laps.length)}</Text>
        {showTimes && times.length ? <Text style={s.roundsSub}>Last <Text style={s.roundsEm}>{liveClock(times[times.length - 1])}</Text> · fastest <Text style={s.roundsEm}>{liveClock(Math.min(...times))}</Text></Text> : null}
      </View>
      <TouchableOpacity style={s.roundBtn} onPress={onRound} activeOpacity={0.85} accessibilityLabel={label}>
        <RivalIcon name={icon} size={30} color="#5c1902" />
        <Text style={s.roundBtnText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Live: every round so far, fastest lit (design/crossfit-live-mockup.png, 3). */
export function RoundSplits({ laps, names }: { laps: number[]; names?: (i: number) => string }) {
  const times = roundTimes(laps);
  if (!times.length) return <Text style={s.hint}>Round times appear here after the first round.</Text>;
  const best = Math.min(...times), worst = Math.max(...times);
  return (
    <View style={s.splitList}>
      {times.map((t, i) => (
        <View key={i} style={s.lapRow}>
          <Text style={s.lapName} numberOfLines={1}>{names ? names(i) : `Round ${i + 1}`}</Text>
          <View style={s.lapTrack}><View style={[s.lapFill, t === best && s.barBest, { width: `${40 + (worst > best ? (worst - t) / (worst - best) : 1) * 60}%` }]} /></View>
          <Text style={s.lapTime}>{liveClock(t)}</Text>
        </View>
      ))}
    </View>
  );
}

/** More details for a swim: time, strokes, stroke types, fastest efforts and
 *  every 100 m (design/finish-special-mockup.png, 1). From the watch. */
export function SwimDetails({ stats, moving, elapsed }: { stats: ActivityStats; moving: number; elapsed: number }) {
  const laps = stats.laps100 ?? [];
  const best = (n: number) => {
    if (laps.length < n) return null;
    let min = Infinity;
    for (let i = 0; i + n <= laps.length; i++) min = Math.min(min, laps.slice(i, i + n).reduce((a, b) => a + b, 0));
    return min;
  };
  const efforts = ([['100 m', 1], ['400 m', 4], ['1,000 m', 10]] as const).map(([name, k]) => [name, best(k)] as const).filter(([, v]) => v != null);
  const types = stats.strokeTypes ?? [];
  const stroke = stats.laps100Strokes ?? [];
  const swolfs = stats.laps100Swolf ?? [];
  const typeTotal = types.reduce((n, t) => n + t.metres, 0);
  const strokes = [
    ...(stats.swolf ? [{ value: String(stats.swolf), name: 'AVG SWOLF' }] : []),
    ...(stats.strokes && stats.lengths ? [{ value: String(Math.round(stats.strokes / stats.lengths)), name: 'PER LENGTH' }] : []),
    ...(stats.strokes ? [{ value: stats.strokes.toLocaleString(), name: 'STROKES' }] : []),
  ];
  return (
    <View>
      <Text style={s.label}>TIME</Text>
      <FinishTiles tiles={[
        { value: liveClock(moving), name: 'SWIMMING' },
        { value: liveClock(elapsed), name: 'ELAPSED' },
        { value: liveClock(stats.restSeconds ?? Math.max(0, elapsed - moving)), name: 'REST' },
      ]} />
      {strokes.length ? <><Text style={s.label}>STROKES</Text><FinishTiles tiles={strokes} /></> : null}
      {types.length ? (
        <>
          <Text style={s.label}>STROKE TYPE</Text>
          <View style={s.card}>
            {types.map((t) => (
              <View key={t.name} style={s.lapRow}>
                <Text style={[s.lapName, { width: 92, color: '#fff' }]}>{t.name}</Text>
                <View style={s.lapTrack}><View style={[s.lapFill, { width: `${(t.metres / (typeTotal || 1)) * 100}%` }]} /></View>
                <Text style={[s.dim, { width: 56, textAlign: 'right', color: '#fff' }]}>{`${t.metres.toLocaleString()} m`}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
      {efforts.length ? (
        <>
          <Text style={s.label}>FASTEST EFFORTS</Text>
          <View style={s.card}>
            {efforts.map(([name, v], i) => (
              <View key={name} style={[s.row, i > 0 && s.line]}><Text style={[s.name, { flex: 1 }]}>{name}</Text><Text style={s.num}>{liveClock(v!)}</Text></View>
            ))}
          </View>
        </>
      ) : null}
      {laps.length ? (
        <TableCard
          title="EVERY 100 M"
          extra={swolfs.length ? `BEST SWOLF ${Math.min(...swolfs)}` : undefined}
          cols={[{ label: 'M' }, ...(stroke.length ? [{ label: 'STROKE', width: 92 }] : []), ...(swolfs.length ? [{ label: 'SWOLF', width: 48 }] : []), { label: 'PACE', width: 50 }]}
          rows={laps.map((t, i) => [
            String((i + 1) * 100),
            ...(stroke.length ? [stroke[i] ?? '-'] : []),
            ...(swolfs.length ? [swolfs[i] != null ? String(swolfs[i]) : '-'] : []),
            liveClock(t),
          ])}
          show={5} moreNoun="more"
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', paddingTop: 10, paddingHorizontal: 12, paddingBottom: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: '#a0a0a0' },
  extra: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: RivalColors.accentText },
  cols: { flexDirection: 'row', gap: 10, paddingTop: 10, paddingBottom: 4, paddingHorizontal: 2 },
  colText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 1.2, color: '#a0a0a0' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 2 },
  line: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  liftName: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 13.5, fontWeight: '800', color: '#fff', flexShrink: 1 },
  dim: { fontSize: 12.5, color: '#a0a0a0' },
  num: { ...serif, fontSize: 16, color: '#fff', textAlign: 'right' },
  pb: { marginLeft: 6, fontSize: 9, fontWeight: '800', color: '#1a1408', backgroundColor: RivalColors.rankAnchors.unrivaled, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7, overflow: 'hidden' },
  moreLink: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  moreLinkText: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  legendText: { fontSize: 10.5, color: '#a0a0a0' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 46, marginTop: 8 },
  bar: { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: 'rgba(255,181,158,0.45)' },
  barBest: { backgroundColor: '#e8835f', ...grad(180) },
  labels: { flexDirection: 'row', marginTop: 4 },
  barTime: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: '#fff' },
  barNum: { flex: 1, textAlign: 'center', fontSize: 8.5, fontWeight: '800', color: '#a0a0a0', marginTop: -2 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,181,158,0.35)', marginTop: 10 },
  addText: { fontSize: 13.5, fontWeight: '800', color: RivalColors.accentText },
  resTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vs: { fontSize: 11.5, color: '#a0a0a0' },
  setRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#4a4644', color: '#fff', fontSize: 9.5, fontWeight: '800', textAlign: 'center', lineHeight: 22, overflow: 'hidden' },
  setNum: { ...serif, width: 30, textAlign: 'center', fontSize: 18, color: '#fff' },
  edit: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText, marginTop: 6, marginBottom: 2 },
  rx: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1, color: RivalColors.accentText, borderWidth: 1, borderColor: 'rgba(255,181,158,0.4)', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 },
  score: { ...serif, fontSize: 30, lineHeight: 38, color: '#fff', marginTop: 4 },
  scoreUnit: { fontFamily: undefined, fontStyle: 'normal', fontWeight: '600', fontSize: 12, color: '#a0a0a0' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  chipOn: { backgroundColor: '#2f2d2c', borderWidth: 1.5, borderColor: '#e8835f' },
  chipText: { fontSize: 12.5, fontWeight: '800', color: '#ddd' },
  chipTextOn: { color: RivalColors.accentText },
  steps: { flexDirection: 'row', gap: 10, marginTop: 12 },
  step: { flex: 1, alignItems: 'center', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', paddingTop: 12, paddingBottom: 10, paddingHorizontal: 10 },
  stepName: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: '#a0a0a0' },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 6 },
  stepValue: { ...serif, flex: 1, minWidth: 0, textAlign: 'center', fontSize: 40, lineHeight: 46, color: '#fff', padding: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  pm: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.3, color: '#a0a0a0', marginTop: 14, marginBottom: 7, marginLeft: 2 },
  field: { marginTop: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingVertical: 10, paddingHorizontal: 12 },
  fieldInput: { fontSize: 14, fontWeight: '800', color: '#fff', marginTop: 3, padding: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  hint: { fontSize: 11.5, color: '#a0a0a0', lineHeight: 17, textAlign: 'center', marginTop: 10 },
  counted: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  countedText: { fontSize: 12, color: '#a0a0a0' },
  addSet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 40, marginTop: 8 },
  formats: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 },
  format: { width: '48%', flexGrow: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  formatName: { fontSize: 13, fontWeight: '800', color: '#ddd' },
  formatSub: { fontSize: 10, fontWeight: '600', color: '#a0a0a0', marginTop: 2 },
  capRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', paddingVertical: 10, paddingHorizontal: 12 },
  cap: { ...serif, fontSize: 32, color: '#fff' },
  moves: { borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12 },
  moveRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  moveName: { flex: 1, fontSize: 14, fontWeight: '700', color: '#fff', paddingVertical: 7, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  moveReps: { width: 54, textAlign: 'right', fontSize: 14, color: '#a0a0a0', paddingVertical: 7, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)', borderRadius: 16, padding: 12, marginTop: 14 },
  toggleName: { fontSize: 14, fontWeight: '800', color: '#fff' },
  toggleSub: { fontSize: 12, color: '#a0a0a0', marginTop: 1 },
  switch: { width: 42, height: 25, borderRadius: 13, padding: 3, backgroundColor: 'rgba(255,255,255,0.14)' },
  switchOn: { backgroundColor: '#e8835f' },
  knob: { width: 19, height: 19, borderRadius: 10, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  rounds: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 22, backgroundColor: 'rgba(35,33,32,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingVertical: 14, paddingLeft: 18, paddingRight: 14 },
  roundsN: { ...serif, fontSize: 44, lineHeight: 50, color: '#fff' },
  roundsSub: { fontSize: 12, color: '#a0a0a0' },
  roundsEm: { color: '#fff', fontWeight: '700' },
  roundBtn: { width: 92, height: 92, borderRadius: 46, backgroundColor: '#e8835f', alignItems: 'center', justifyContent: 'center', ...grad(135) },
  roundBtnText: { fontSize: 13, fontWeight: '800', color: '#5c1902', textAlign: 'center' },
  splitList: { borderRadius: 16, backgroundColor: 'rgba(35,33,32,0.85)', paddingVertical: 8, paddingHorizontal: 12 },
  lapRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  lapName: { width: 64, fontSize: 12, fontWeight: '800', color: '#a0a0a0' },
  lapTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  lapFill: { height: '100%', borderRadius: 4, backgroundColor: 'rgba(255,181,158,0.55)' },
  lapTime: { ...serif, width: 44, textAlign: 'right', fontSize: 15, color: '#fff' },
});
