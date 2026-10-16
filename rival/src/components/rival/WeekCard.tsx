import { useState, type ReactNode } from 'react';
import { Modal, Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { RivalButtonColors, RivalColors, RivalFontFamily, RivalGhost, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, activityIconName, type RivalIconName } from './RivalIcon';
import { GreyCalendar, GreyLabel, GreyRows, GreySheet } from './RivalGreySheet';
import { GoldStar } from './RespectStar';
import { distanceUnit, toDisplayDistance } from '../../lib/units';
import { activityTypeLabel } from './EffortBreakdownSheet';

// The week card on Activity (phones, Ricky 2026-10-16): the Add an activity
// grey with its warm glow, a date kicker over the serif title and Effort, the
// week as day tiles, and when opened a numbers card. Filters moved off the card into one Filter button beside
// Week, Month and Year, which opens a grey pop-up.

/** The card itself. Tapping the header opens and folds it. */
export function WeekCard({ kicker, title, sub, effort, expanded, onToggle, compact, event, children }: {
  kicker?: string;
  title: string;
  sub?: string;
  /** The Effort figure, so a caller can animate it. */
  effort: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  /** Past weeks: a little smaller. */
  compact?: boolean;
  /** An event week: ivory kicker and glow, the event as the title. */
  event?: boolean;
  children?: ReactNode;
}) {
  return (
    // A tap anywhere on the card opens or folds it; nothing on it is a
    // button of its own (Ricky, 2026-10-16).
    <TouchableOpacity style={[s.card, compact && s.cardCompact]} activeOpacity={0.92} onPress={onToggle} accessibilityState={{ expanded }}>
      <View pointerEvents="none" style={[s.glow, event && s.glowEvent]} />
      <View style={s.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {kicker ? <Text style={[s.kicker, event && s.kickerEvent]}>{kicker}</Text> : null}
          <Text style={[s.title, compact && s.titleCompact]} numberOfLines={1}>{title}</Text>
          {sub ? <Text style={s.sub}>{sub}</Text> : null}
        </View>
        {/* Effort sits in the corner with its label centred under it
            (Ricky, 2026-10-16). */}
        <View style={s.effort}>
          {effort}
          <Text style={s.effortLabel}>Effort</Text>
        </View>
      </View>
      {children}
      {/* The open/fold arrow sits centred along the bottom edge, so it
          never pushes Effort in from the corner. */}
      <View style={s.chevRow}>
        <RivalIcon name="chevronDown" size={18} color="rgba(255,255,255,0.4)" style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined} />
      </View>
    </TouchableOpacity>
  );
}

const effortBase = { fontFamily: RivalSerifFamily, fontStyle: 'italic' as const, fontWeight: '700' as const, color: '#fff' };
// White, so it stands apart from the ember columns under it (Ricky,
// 2026-10-16: the ember fill was too much of one colour).
export const weekEffortStyle = { ...effortBase, fontSize: 32, lineHeight: 36 };
export const weekEffortCompactStyle = { ...effortBase, fontSize: 22, lineHeight: 26 };

/** The week as columns sized by each day's Effort (Ricky, 2026-10-16,
 *  option A): each trained day labelled with its figure, a day that set a
 *  personal best in gold, today dashed until something is logged. */
export function DayColumns({ effort, bests, today, events }: { effort: number[]; bests: Set<number>; today: number | null; events?: Set<number> }) {
  const max = Math.max(0, ...effort);
  const top = max > 0 ? effort.indexOf(max) : -1;
  return (
    <View style={s.cols}>
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => {
        const v = effort[i] ?? 0;
        const pb = v > 0 && bests.has(i);
        // An event day is ivory; a best on the same day stays gold.
        const ev = v > 0 && !pb && !!events?.has(i);
        const isToday = v === 0 && i === today;
        // A floor so a short day still shows; rest days keep a stub.
        // Up to 80% of the column, leaving room for the figure on top.
        const h = v > 0 ? Math.max(0.14, (v / max) * 0.8) : 0.07;
        return (
          <View key={i} style={s.col}>
            {/* Each figure sits just above its own bar. */}
            <View style={s.colArea}>
              {v > 0 ? <Text style={[s.colFigure, i === top && s.colFigureTop]}>{Math.round(v * 10) / 10}</Text> : null}
              <View style={[s.colBar, { height: `${Math.round(h * 100)}%` as any }, v > 0 && (pb ? s.colBarPb : ev ? s.colBarEvent : s.colBarOn), isToday && s.colBarToday]} />
            </View>
            <Text style={[s.colDay, v > 0 && s.colDayOn, pb && s.colDayPb, ev && s.colDayEvent]}>{d}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** An event's legs as small chips: each activity's icon and distance
 *  (Ricky, 2026-10-16, event weeks W2). */
export function EventLegs({ legs }: { legs: { key: string; type: string; text: string }[] }) {
  if (legs.length < 2) return null;
  return (
    <View style={s.earned}>
      {legs.map((l) => (
        <View key={l.key} style={[s.pill, s.pillLeg]}>
          <RivalIcon name={activityIconName(l.type)} size={13} color="rgba(255,255,255,0.75)" />
          <Text style={[s.pillText, { color: 'rgba(255,255,255,0.8)', fontWeight: '600' }]}>{l.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** What a finished week earned, as small pills (Ricky, 2026-10-16, past
 *  weeks options 1 + 2): up on the week before (green), the main activity
 *  (ember), a best (gold). A quieter week simply shows fewer pills. */
export function WeekEarned({ upPct, done, best }: { upPct: number | null; done: string | null; best: string | null }) {
  if (!upPct && !done && !best) return null;
  return (
    <View style={s.earned}>
      {upPct ? (
        <View style={[s.pill, s.pillUp]}>
          <RivalIcon name="trendUp" size={13} color="#7fe0a4" />
          <Text style={[s.pillText, { color: '#7fe0a4' }]}>{upPct}% on the week before</Text>
        </View>
      ) : null}
      {done ? (
        <View style={[s.pill, s.pillDone]}>
          <RivalIcon name="check" size={13} color="#ffd3c2" />
          <Text style={[s.pillText, { color: '#ffd3c2' }]}>{done}</Text>
        </View>
      ) : null}
      {best ? (
        <View style={[s.pill, s.pillBest]}>
          <RivalIcon name="trophy" size={13} color="#ffe6a8" />
          <Text style={[s.pillText, { color: '#ffe6a8' }]}>{best}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Monday to Sunday as tiles: filled for a day trained, gold for a best. */
export function DayTiles({ done, bests, today }: { done: Set<number>; bests: Set<number>; today: number | null }) {
  return (
    <View style={s.days}>
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => {
        const pb = bests.has(i);
        const on = !pb && done.has(i);
        return (
          <View key={i} style={[s.day, on && s.dayOn, pb && s.dayPb, !on && !pb && i === today && s.dayToday]}>
            <Text style={[s.dayText, on && s.dayTextOn, pb && s.dayTextPb]}>{d}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** "1h 7m" with the h and m dimmed. */
function durationParts(seconds: number): Array<[string, string]> {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return [[String(mins), 'm']];
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? [[String(h), 'h'], [String(m), 'm']] : [[String(h), 'h']];
}

type Totals = { count: number; seconds: number; km: number };

function deltaDuration(seconds: number): string {
  const mins = Math.round(Math.abs(seconds) / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

/** Activities, Time and Distance, each with its small ember icon and the
 *  units dimmed. With `prev`, each also says how it compares (Ricky,
 *  2026-10-16, option 4): green when up, a quiet grey when down, never red. */
export function WeekNumbers({ count, seconds, km, prev }: Totals & { prev?: Totals }) {
  const delta = (diff: number, text: string) => {
    if (!prev) return null;
    const up = diff > 0.0001;
    const down = diff < -0.0001;
    return <Text style={[s.delta, !up && s.deltaFlat]}>{up ? `+${text}` : down ? `−${text}` : 'Same'}</Text>;
  };
  const cell = (icon: RivalIconName, label: string, value: ReactNode, change: ReactNode, first?: boolean) => (
    <View style={[s.cell, !first && s.cellDivided]}>
      <RivalIcon name={icon} size={17} color={RivalColors.accentFill} style={s.cellIcon} />
      <Text style={s.value} numberOfLines={1}>{value}</Text>
      <Text style={s.label}>{label}</Text>
      {change}
    </View>
  );
  const unit = distanceUnit();
  const shownKm = toDisplayDistance(km);
  const kmDiff = prev ? shownKm - toDisplayDistance(prev.km) : 0;
  return (
    <View style={s.numbers}>
      {cell('stats', count === 1 ? 'Activity' : 'Activities', String(count),
        prev ? delta(count - prev.count, String(Math.abs(count - prev.count))) : null, true)}
      {cell('timerOutline', 'Time', seconds > 0
        ? durationParts(seconds).map(([n, u], i) => (
          <Text key={u}>{i > 0 ? ' ' : ''}{n}<Text style={s.unit}>{u}</Text></Text>
        ))
        : <>0<Text style={s.unit}>m</Text></>,
        prev ? delta(seconds - prev.seconds, deltaDuration(seconds - prev.seconds)) : null)}
      {cell('distance', 'Distance', <>{km >= 0.1 ? shownKm.toFixed(1) : '0'}<Text style={s.unit}>{unit}</Text></>,
        prev ? delta(Math.round(kmDiff * 10) / 10, `${Math.abs(kmDiff).toFixed(1)} ${unit}`) : null)}
    </View>
  );
}

/** The monthly-average line and the change on last week. */
export function WeekNote({ highlight, rest, delta }: { highlight?: string; rest?: string; delta: number | null }) {
  if (!highlight && delta === null) return null;
  return (
    <View style={s.note}>
      {highlight ? (
        <Text style={s.noteText}>
          <Text style={s.noteHi}>{highlight}</Text>{rest}
        </Text>
      ) : null}
      {delta !== null ? (
        <View style={s.deltaRow}>
          <RivalIcon name={delta >= 0 ? 'trendUp' : 'trendDown'} size={13} color={delta >= 0 ? RivalColors.success : '#ff5c5c'} />
          <Text style={s.deltaText}>{Math.abs(delta)}% vs last week</Text>
        </View>
      ) : null}
    </View>
  );
}

/** "Sun 4 Oct": a day no reader can mistake for another month. */
function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export type ActivityFilters = { starred: boolean; bests: boolean; type: string; date: string | null };

export function filterCount(f: ActivityFilters): number {
  return (f.starred ? 1 : 0) + (f.bests ? 1 : 0) + (f.type !== 'All' ? 1 : 0) + (f.date ? 1 : 0);
}

/** The Filter button beside Week, Month and Year. */
export function FilterButton({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <TouchableOpacity style={[s.fbtn, count > 0 && s.fbtnOn]} onPress={onPress} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={count ? `Filter, ${count} on` : 'Filter'}>
      <RivalIcon name="tune" size={15} color={count > 0 ? '#ffffff' : 'rgba(255,255,255,0.75)'} />
      <Text style={[s.fbtnText, count > 0 && s.fbtnTextOn]}>Filter</Text>
      {count > 0 ? <View style={s.cnt}><Text style={s.cntText}>{count}</Text></View> : null}
    </TouchableOpacity>
  );
}

/** The filters in use as chips under Week, Month and Year, each with its
 *  own × (Ricky, 2026-10-16), and Clear all once there is more than one. */
export function ShowingLine({ filters, onChange }: { filters: ActivityFilters; onChange: (f: ActivityFilters) => void }) {
  const chips: Array<{ key: string; label: string; clear: Partial<ActivityFilters> }> = [];
  if (filters.starred) chips.push({ key: 'starred', label: 'Highlights', clear: { starred: false } });
  if (filters.bests) chips.push({ key: 'bests', label: 'Personal bests', clear: { bests: false } });
  if (filters.type !== 'All') chips.push({ key: 'type', label: activityTypeLabel(filters.type), clear: { type: 'All' } });
  if (filters.date) chips.push({ key: 'date', label: shortDate(filters.date), clear: { date: null } });
  if (!chips.length) return null;
  return (
    <View style={s.showing}>
      <Text style={s.showingText}>Showing</Text>
      {chips.map((c) => (
        <TouchableOpacity key={c.key} style={s.chip} onPress={() => onChange({ ...filters, ...c.clear })} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`Remove ${c.label}`}>
          <Text style={s.chipText}>{c.label}</Text>
          <RivalIcon name="close" size={12} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      ))}
      {chips.length > 1 ? (
        <TouchableOpacity onPress={() => onChange({ starred: false, bests: false, type: 'All', date: null })} hitSlop={8} accessibilityRole="button">
          <Text style={s.clear}>Clear all</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** The grey pop-up: Starred and Personal bests, the activity types as small
 *  tiles, and a date. Filters apply as they change; the button closes it. */
export function FilterSheet({ visible, filters, onChange, types, shownCount, dateText, onClose }: {
  visible: boolean;
  filters: ActivityFilters;
  onChange: (f: ActivityFilters) => void;
  types: string[];
  shownCount: number;
  dateText: string | null;
  onClose: () => void;
}) {
  // RIVAL's own calendar over the sheet, as on Log an activity, not the
  // browser's typed-date prompt (Ricky, 2026-10-16).
  const [calOpen, setCalOpen] = useState(false);
  const set = (patch: Partial<ActivityFilters>) => onChange({ ...filters, ...patch });
  const toggle = (on: boolean, change: (v: boolean) => void) => (
    <Switch
      value={on}
      onValueChange={change}
      trackColor={{ false: 'rgba(255,255,255,0.18)', true: RivalColors.accentFill }}
      thumbColor="#ffffff"
      {...(Platform.OS === 'web' ? { activeThumbColor: '#ffffff' } as any : {})}
    />
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <GreySheet
          kicker="ACTIVITY"
          title="Filter"
          onClose={onClose}
          overlay={calOpen ? (
            <GreyCalendar
              value={filters.date}
              onChange={(iso) => { set({ date: iso }); setCalOpen(false); }}
              onClose={() => setCalOpen(false)}
            />
          ) : undefined}
          footer={
            <TouchableOpacity style={s.done} onPress={onClose} activeOpacity={0.85} accessibilityRole="button">
              <Text style={s.doneText}>{shownCount === 1 ? 'Show 1 activity' : `Show ${shownCount} activities`}</Text>
            </TouchableOpacity>
          }
        >
          <GreyRows>
            <View style={s.row}>
              <GoldStar size={17} />
              <Text style={s.rowLabel}>Highlights</Text>
              {toggle(filters.starred, (v) => set({ starred: v }))}
            </View>
            <View style={s.row}>
              <RivalIcon name="trophy" size={17} color="#ffd27a" />
              <Text style={s.rowLabel}>Personal bests</Text>
              {toggle(filters.bests, (v) => set({ bests: v }))}
            </View>
            {/* The row opens the calendar; once a day is set, a separate
                round × beside it clears it, so clearing never reopens the
                calendar (Ricky, 2026-10-16). */}
            <View style={s.row}>
              <TouchableOpacity style={s.rowMain} onPress={() => setCalOpen(true)} activeOpacity={0.8} accessibilityRole="button">
                <RivalIcon name="calendar" size={17} color={RivalColors.accentText} />
                <Text style={s.rowLabel}>Date</Text>
                {filters.date ? <Text style={s.rowValue}>{shortDate(filters.date)}</Text> : (
                  <View style={s.rowAction}>
                    <Text style={s.rowActionText}>Select</Text>
                    <RivalIcon name="chevronRight" size={16} color={RivalColors.accentText} />
                  </View>
                )}
              </TouchableOpacity>
              {filters.date ? (
                <TouchableOpacity style={s.clearBtn} onPress={() => set({ date: null })} hitSlop={6} accessibilityRole="button" accessibilityLabel="Clear date">
                  <RivalIcon name="close" size={15} color="rgba(255,255,255,0.75)" />
                </TouchableOpacity>
              ) : null}
            </View>
          </GreyRows>

          <View style={{ height: 6 }} />
          <GreyLabel>ACTIVITY TYPE</GreyLabel>
          <View style={{ height: 8 }} />
          <View style={s.tiles}>
            {['All', ...types].map((t) => {
              const on = filters.type === t;
              return (
                <TouchableOpacity key={t} style={[s.tile, on && s.tileOn]} onPress={() => set({ type: t })} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <View pointerEvents="none" style={s.tileArt}>
                    <RivalIcon name={t === 'All' ? 'apps' : activityIconName(t)} size={38} color={on ? 'rgba(255,255,255,0.32)' : 'rgba(255,181,158,0.2)'} />
                  </View>
                  <Text style={[s.tileText, on && s.tileTextOn]} numberOfLines={1}>{t === 'All' ? 'All' : activityTypeLabel(t)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </GreySheet>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  card: {
    position: 'relative', overflow: 'hidden', borderRadius: 22, padding: 16, gap: 14,
    backgroundColor: RivalGhost.ground, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  cardCompact: { paddingVertical: 13, gap: 12 },
  // The warm glow from the top edge, as on the Add an activity pop-up.
  glow: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 120,
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'radial-gradient(ellipse 75% 100% at 50% 0%, rgba(232,131,95,0.22), rgba(232,131,95,0) 70%)' } as any
      : { backgroundColor: 'rgba(232,131,95,0.06)' }),
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase', color: RivalColors.accentText, marginBottom: 2 },
  title: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 26, lineHeight: 30, color: '#fff' },
  titleCompact: { fontSize: 20, lineHeight: 25 },
  sub: { fontSize: 12.5, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  effort: { alignItems: 'center' },
  effortLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2.2, textTransform: 'uppercase', color: RivalColors.accentText, marginTop: 1 },
  chevRow: { alignSelf: 'center', marginTop: -8, marginBottom: -10, paddingHorizontal: 14, paddingVertical: 2 },

  days: { flexDirection: 'row', gap: 5 },
  day: { flex: 1, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'transparent' },
  dayOn: { backgroundColor: 'rgba(232,131,95,0.22)', borderColor: 'rgba(255,181,158,0.35)' },
  dayPb: { backgroundColor: 'rgba(255,201,77,0.16)', borderColor: 'rgba(255,201,77,0.45)' },
  dayToday: { borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.25)' },
  dayText: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.5)' },
  dayTextOn: { color: '#ffd3c2' },
  dayTextPb: { color: '#ffe6a8' },

  cols: { flexDirection: 'row', gap: 6, height: 104, alignItems: 'flex-end' },
  col: { flex: 1, height: '100%', alignItems: 'center', gap: 4 },
  colArea: { flex: 1, alignSelf: 'stretch', justifyContent: 'flex-end' },
  // Every trained day shows its Effort; the biggest a touch brighter.
  colFigure: { fontSize: 10, lineHeight: 13, marginBottom: 3, textAlign: 'center', fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  colFigureTop: { color: 'rgba(255,255,255,0.9)' },
  colBar: { alignSelf: 'stretch', borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)' },
  colBarOn: {
    backgroundColor: '#d98466',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #f0b29b, #c96a4a)' } as any : {}),
  },
  colBarPb: {
    backgroundColor: '#ffc94d',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #fff4d6, #ffc94d)' } as any : {}),
  },
  colBarToday: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.28)' },
  colDay: { fontSize: 10.5, fontWeight: '800', color: 'rgba(255,255,255,0.4)' },
  colDayOn: { color: '#ffd3c2' },
  colDayPb: { color: '#ffe6a8' },
  colBarEvent: {
    backgroundColor: RivalColors.event,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #fbf4e6, #cdbd9f)' } as any : {}),
  },
  colDayEvent: { color: RivalColors.event },
  pillLeg: { backgroundColor: 'rgba(255,255,255,0.05)' },
  kickerEvent: { color: RivalColors.event },
  glowEvent: Platform.OS === 'web'
    ? { backgroundImage: 'radial-gradient(ellipse 75% 100% at 50% 0%, rgba(244,234,216,0.15), rgba(244,234,216,0) 70%)' } as any
    : { backgroundColor: 'rgba(244,234,216,0.05)' },
  earned: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 999 },
  pillUp: { backgroundColor: 'rgba(95,211,138,0.12)' },
  pillDone: { backgroundColor: 'rgba(232,131,95,0.16)' },
  pillBest: { backgroundColor: 'rgba(255,201,77,0.14)' },
  pillText: { fontFamily: RivalFontFamily, fontSize: 11.5, fontWeight: '700' },
  numbers: { flexDirection: 'row', borderRadius: 16, overflow: 'hidden', backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: RivalGhost.border },
  cell: { flex: 1, alignItems: 'center', paddingTop: 10, paddingBottom: 9, paddingHorizontal: 3, overflow: 'hidden' },
  cellDivided: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.08)' },
  // A fixed line height on the figure and its units, so the labels under
  // all three sit on one line whether or not a figure has units in it.
  value: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 29, lineHeight: 31, height: 31, color: '#fff' },
  // Sans, upright and dim, so the units step back from the serif figures.
  unit: { fontFamily: RivalFontFamily, fontStyle: 'normal', fontSize: 13, lineHeight: 31, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  cellIcon: { marginBottom: 0, height: 20 },
  delta: { marginTop: 2, fontSize: 11, fontWeight: '700', color: RivalColors.success },
  deltaFlat: { color: 'rgba(255,255,255,0.45)', fontWeight: '600' },
  label: { marginTop: 2, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },

  note: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', paddingTop: 12, gap: 3 },
  noteText: { fontSize: 13.5, color: 'rgba(255,255,255,0.85)' },
  noteHi: { fontWeight: '700', color: RivalColors.accentText },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  deltaText: { fontSize: 12.5, color: 'rgba(255,255,255,0.5)' },

  fbtn: { height: 34, paddingHorizontal: 12, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  // A filter in use is lit in plain white: gold stays for bests and
  // warnings, salmon for actions (Ricky, 2026-10-16).
  fbtnOn: { borderColor: 'rgba(255,255,255,0.55)', backgroundColor: 'rgba(255,255,255,0.1)' },
  fbtnText: { fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.75)' },
  fbtnTextOn: { color: '#fff' },
  cnt: { minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  cntText: { fontSize: 10, fontWeight: '800', color: '#1c1a19' },

  showing: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 },
  showingText: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginRight: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingLeft: 11, paddingRight: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  chipText: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
  clear: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText, marginLeft: 4 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 10, minHeight: 50 },
  rowLabel: { flex: 1, fontSize: 15, color: '#fff' },
  rowValue: { fontSize: 14, fontWeight: '600', color: '#fff' },
  rowAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  clearBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  rowActionText: { fontSize: 14, fontWeight: '700', color: RivalColors.accentText },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '2%' as any, rowGap: 7 },
  tile: {
    // Fixed quarters, so a short last row keeps tile-sized tiles.
    width: '23.5%', height: 58, justifyContent: 'flex-end', paddingHorizontal: 9, paddingBottom: 7, overflow: 'hidden',
    borderRadius: 14, backgroundColor: RivalGhost.fill, borderWidth: 1, borderColor: 'rgba(255,181,158,0.3)',
  } as any,
  tileOn: { backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient, borderColor: 'transparent' } as any,
  tileArt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  tileTextOn: { color: RivalButtonColors.label(RivalColors.onAccentFill) },
  done: {
    height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalButtonColors.fill, ...RivalButtonColors.gradient,
  } as any,
  doneText: { fontSize: 15, fontWeight: '800', color: RivalButtonColors.label(RivalColors.onAccentFill) },
});

export type Checkpoint = { key: string; label: string; value: number };

/** The week's targets as a ladder (Ricky, 2026-10-16, option 1): rungs from
 *  the nearest at the top down to the strongest week at the bottom (Ricky
 *  flipped it, 2026-10-16), a glowing line working down the side. Passed
 *  rungs tick and dim, the next shows how far to go, the last waits in gold. */
export function WeekLadder({ effort, checkpoints }: { effort: number; checkpoints: Checkpoint[] }) {
  if (!checkpoints.length) return null;
  const rungs = [...checkpoints].sort((a, b) => a.value - b.value);
  const nextIdx = rungs.findIndex((c) => effort < c.value);
  const lastIdx = rungs.length - 1;
  // How far up the line is lit: whole rungs passed, plus the way to the next.
  let lit = 0;
  if (nextIdx === -1) lit = 1;
  else if (nextIdx > 0 && lastIdx > 0) {
    const from = rungs[nextIdx - 1].value;
    const part = (effort - from) / Math.max(1, rungs[nextIdx].value - from);
    lit = (nextIdx - 1 + Math.min(1, Math.max(0, part))) / lastIdx;
  }
  const fmt = (n: number) => String(Math.round(n * 10) / 10);
  return (
    <View style={ls.ladder}>
      {rungs.length > 1 ? (
        <View pointerEvents="none" style={ls.ladderTrack}>
          <View style={[ls.ladderLit, { height: `${Math.round(lit * 100)}%` as any }]} />
        </View>
      ) : null}
      {rungs.map((c, i) => {
        const passed = effort >= c.value;
        const next = i === nextIdx;
        const top = i === lastIdx;
        return (
          <View key={c.key} style={ls.rung}>
            {passed ? (
              <View style={[ls.rungTick, top && ls.rungTickTop]}><RivalIcon name="check" size={11} color="#2a1408" /></View>
            ) : (
              <View style={[ls.rungOpen, next && ls.rungOpenNext, top && ls.rungOpenTop]} />
            )}
            <Text style={[ls.rungLabel, passed && !top && ls.rungLabelPassed, next && ls.rungLabelNext, top && ls.rungLabelTop]} numberOfLines={1}>{c.label}</Text>
            <Text style={[ls.rungValue, next && ls.rungValueNext, top && ls.rungValueTop]}>
              {next ? `${fmt(c.value - effort)} to go` : fmt(c.value)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const ls = StyleSheet.create({
  ladder: { gap: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', paddingTop: 13, paddingBottom: 2 },
  ladderTrack: { position: 'absolute', left: 8, top: 22, bottom: 11, width: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'flex-start', overflow: 'hidden' },
  ladderLit: {
    width: 2, backgroundColor: '#e8835f',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(180deg, #f0b29b, #c96a4a)', boxShadow: '0 0 8px rgba(232,131,95,0.6)' } as any : {}),
  },
  rung: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  rungTick: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0b29b' },
  rungTickTop: { backgroundColor: '#ffc94d' },
  rungOpen: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', backgroundColor: RivalGhost.ground },
  rungOpenNext: { borderColor: 'rgba(255,181,158,0.75)' },
  rungOpenTop: { borderColor: '#ffc94d', backgroundColor: 'rgba(255,201,77,0.15)' },
  rungLabel: { flex: 1, fontSize: 13.5, color: 'rgba(255,255,255,0.85)' },
  rungLabelPassed: { color: 'rgba(255,255,255,0.45)', textDecorationLine: 'line-through', textDecorationColor: 'rgba(255,255,255,0.25)' } as any,
  rungLabelNext: { color: '#fff', fontWeight: '700' },
  rungLabelTop: { color: '#ffe6a8' },
  rungValue: { fontSize: 12.5, color: 'rgba(255,255,255,0.5)' },
  rungValueNext: { color: RivalColors.accentText, fontWeight: '700' },
  rungValueTop: { color: '#ffe6a8' },
});
