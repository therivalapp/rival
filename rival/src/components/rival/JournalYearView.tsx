import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { RivalIcon, activityIconName } from './RivalIcon';
import { rm, RivalWarm } from './RivalMobile';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { rankSheen, rankTextSheen } from '../../constants/rankSheen';
import { buildYearReview, activityDisplayName, formatMinutes, type YearActivity } from '../../lib/yearReview';
import { monthlyTotals, pbMoments, yearsWithActivity, yearWeeks, type PbMoment } from '../../lib/yearJournal';
import { getLevel, xpProgressInLevel, LEVELS } from '../../lib/xp';
import { formatDistance, formatDistanceWhole, toDisplayDistance, distanceUnit } from '../../lib/units';

// The Activity Journal's Year tab: one year of training at a glance. Drawn from
// the activities the journal already holds, so it opens instantly and needs no
// requests of its own. The full, shareable Year in Review is one tap away.

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
// A bar filled in a rank's colours, dark to light (as on Today's milestone).
function rankFill(from: string, to: string): object {
  return Platform.OS === 'web'
    ? { backgroundColor: to, backgroundImage: `linear-gradient(90deg, ${from}, ${to})` }
    : { backgroundColor: to };
}

// A total as big digits with small units, the way Today shows "202h 59m":
// "89 km", "2h 45m", and "1h" rather than "1h 0m" (Ricky, 2026-10-11).
function TotalFigure({ km, minutes }: { km: number; minutes: number }) {
  if (km > 0) {
    const [num, ...unit] = formatDistanceWhole(km).split(' ');
    return <Text style={s.typeTotal}>{num}<Text style={s.typeUnit}> {unit.join(' ')}</Text></Text>;
  }
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return (
    <Text style={s.typeTotal}>
      {h > 0 ? <>{h}<Text style={s.typeUnit}>h</Text></> : null}
      {m > 0 ? <>{h > 0 ? ' ' : ''}{m}<Text style={s.typeUnit}>m</Text></> : null}
    </Text>
  );
}
// The best itself, the row's headline figure ("42.1 km", "1h 20m").
function pbValue(p: PbMoment): string {
  return p.kind === 'distance' ? `${toDisplayDistance(p.value).toFixed(1)} ${distanceUnit()}` : formatMinutes(p.value);
}
// When, then what it beat: "Jul 7 · up from 40.0 km". The date leads so it
// reads as when the best was set, not when the old one was.
function pbFrom(p: PbMoment): string {
  const from = p.kind === 'distance' ? `${toDisplayDistance(p.previous).toFixed(1)} ${distanceUnit()}` : formatMinutes(p.previous);
  return `${shortDate(p.date)} · up from ${from}`;
}

function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

const GRADIENT: any = Platform.OS === 'web'
  ? { backgroundImage: `linear-gradient(180deg, #f2b39c 0%, ${RivalColors.accentFill} 100%)` }
  : { backgroundColor: RivalColors.accentFill };

export function JournalYearView({ activities, header }: { activities: YearActivity[]; header?: React.ReactNode }) {
  const now = new Date();
  const years = useMemo(() => yearsWithActivity(activities, now), [activities]);
  const [year, setYear] = useState(now.getFullYear());
  const idx = years.indexOf(year);

  const review = useMemo(() => buildYearReview(activities, year), [activities, year]);
  const months = useMemo(() => monthlyTotals(activities, year), [activities, year]);
  const weeks = useMemo(() => yearWeeks(activities, year, now), [activities, year]);
  // One row per kind of personal best (Farthest swim, Longest yoga…), showing
  // the latest, with the earlier ones in that kind folded underneath, so one
  // sport beaten by 100 m at a time can't fill the list (Ricky, 2026-10-11).
  const pbGroups = useMemo(() => {
    const byType = new Map<string, PbMoment[]>();
    for (const p of pbMoments(activities, year, Infinity)) {
      const list = byType.get(p.type) ?? [];
      list.push(p);
      byType.set(p.type, list);
    }
    return [...byType.values()];
  }, [activities, year]);
  const [openPbTypes, setOpenPbTypes] = useState<Set<string>>(new Set());
  const togglePbType = (type: string) => setOpenPbTypes((cur) => {
    const next = new Set(cur);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  const isThisYear = year === now.getFullYear();
  const level = getLevel(review.effort);
  const progress = xpProgressInLevel(review.effort);
  const nextLevel = level.maxXp !== Infinity ? LEVELS.find((l) => l.level === level.level + 1) ?? null : null;
  const maxMonth = Math.max(1, ...months.map((m) => m.effort));
  const best = months.reduce((b, m) => (m.effort > b.effort ? m : b), months[0]);
  const pastWeeks = weeks.filter((w) => !w.future);
  const trainedWeeks = pastWeeks.filter((w) => w.count > 0).length;
  // Three shades by how big the week was, relative to this year's own weeks.
  const weekEfforts = pastWeeks.map((w) => w.effort).filter((e) => e > 0).sort((a, b) => a - b);
  const q = (p: number) => weekEfforts[Math.floor((weekEfforts.length - 1) * p)] ?? 0;
  const [q1, q2] = [q(0.33), q(0.66)];
  const shade = (e: number) => (e <= 0 ? 0 : e <= q1 ? 0.35 : e <= q2 ? 0.65 : 1);
  const maxTypeCount = Math.max(1, ...review.byActivity.map((b) => b.count));
  const perRow = Math.ceil(weeks.length / 3);
  const weekRows = [0, 1, 2].map((r) => {
    const row: Array<(typeof weeks)[number] | null> = weeks.slice(r * perRow, (r + 1) * perRow);
    while (row.length < perRow) row.push(null);
    return row;
  });

  const yearSwitcher = (
    <View style={s.switcher}>
      <TouchableOpacity
        onPress={() => idx < years.length - 1 && setYear(years[idx + 1])}
        disabled={idx >= years.length - 1}
        style={s.switchBtn}
        accessibilityLabel="Previous year"
      >
        <RivalIcon name="chevronLeft" size={22} color={idx >= years.length - 1 ? RivalWarm.muted : RivalColors.accentText} />
      </TouchableOpacity>
      <Text style={s.switchYear}>{year}</Text>
      <TouchableOpacity onPress={() => idx > 0 && setYear(years[idx - 1])} disabled={idx <= 0} style={s.switchBtn} accessibilityLabel="Next year">
        <RivalIcon name="chevronRight" size={22} color={idx <= 0 ? RivalWarm.muted : RivalColors.accentText} />
      </TouchableOpacity>
    </View>
  );

  if (review.count === 0) {
    return (
      <View style={s.stack}>
        {header}
        {yearSwitcher}
        <View style={[rm.card, s.empty]}>
          <RivalIcon name="calendar" size={28} color={RivalColors.accentText} />
          <Text style={rm.serifTitleSm}>{isThisYear ? `${year} starts with the first activity` : `Nothing logged in ${year}`}</Text>
          <Text style={[rm.hint, { textAlign: 'center' }]}>Every activity logged or synced from a connected device builds the year here.</Text>
          {isThisYear && (
            <TouchableOpacity style={[rm.primary, { alignSelf: 'stretch', marginTop: 6 }]} onPress={() => router.push('/add-workout')} accessibilityRole="button">
              <Text style={rm.primaryText}>Add activity</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={s.stack}>
      {header}
      {yearSwitcher}

      {/* The year in one number, and the rank it earned. */}
      <View style={[rm.card, s.hero]}>
        <Text style={rm.label}>{year} Effort</Text>
        <Text style={s.heroNum}>{review.effort.toLocaleString()}</Text>
        {/* The rank as Today and Ranks now show it: the rising chevrons and
            the name in serif with its rank's sheen (Ricky, 2026-10-11). */}
        <View style={s.rankLine}>
          <RivalIcon name="doubleChevronUp" size={16} color={rankSheen(level.level).light} />
          <Text style={[s.rankName, rankTextSheen(level.level)]}>{level.name}</Text>
        </View>
        <Text style={s.heroMeta}>
          {review.count.toLocaleString()} {review.count === 1 ? 'activity' : 'activities'} · {formatMinutes(review.minutes)} · {review.activeDays.toLocaleString()} active {review.activeDays === 1 ? 'day' : 'days'}
        </Text>
        {/* The next rank, laid out like Legacy's Next milestone on Today: a
            label and what's left, the rank's name in its sheen, and a bar in
            that rank's colours. Tapping it opens Ranks (Ricky, 2026-10-11). */}
        {isThisYear && nextLevel ? (() => {
          const ns = rankSheen(nextLevel.level);
          return (
            <TouchableOpacity style={s.next} activeOpacity={0.7} onPress={() => router.push('/ranks')} accessibilityRole="button" accessibilityLabel={`Next rank: ${nextLevel.name}`}>
              <View style={s.nextHead}>
                <Text style={[s.nextLabel, { color: ns.light }]}>Next rank</Text>
                <Text style={[s.nextToGo, { color: ns.light }]}>{(level.maxXp - review.effort).toLocaleString()} Effort to go</Text>
              </View>
              <View style={s.nextTitleLine}>
                <Text style={[s.nextTitle, rankTextSheen(nextLevel.level)]} numberOfLines={1}>{nextLevel.name}</Text>
                <RivalIcon name="chevronRight" size={16} color="rgba(255,255,255,0.45)" />
              </View>
              <View style={s.track}>
                <View style={[s.fill, rankFill(ns.dark, ns.light), { width: `${Math.max(3, Math.round(progress.pct * 100))}%` }]} />
              </View>
            </TouchableOpacity>
          );
        })() : null}
      </View>

      {/* Month by month. */}
      <View style={[rm.card, s.cardGap]}>
        <Text style={rm.label}>Month by month</Text>
        <View style={s.bars}>
          {months.map((m) => {
            const future = isThisYear && m.month > now.getMonth();
            const isBest = m.effort > 0 && m.month === best.month;
            const h = m.effort > 0 ? Math.max(6, Math.round((m.effort / maxMonth) * 96)) : 3;
            return (
              <View key={m.month} style={s.barCol}>
                <View style={s.barArea}>
                  <View
                    style={[
                      s.bar,
                      { height: h },
                      isBest ? GRADIENT : { backgroundColor: m.effort > 0 ? 'rgba(255,181,158,0.32)' : 'rgba(255,255,255,0.07)' },
                      future && { opacity: 0.35 },
                    ]}
                  />
                </View>
                <Text style={[s.barLabel, isBest && { color: RivalColors.accentText }]}>{MONTH_INITIALS[m.month]}</Text>
              </View>
            );
          })}
        </View>
        {best.effort > 0 && (
          <Text style={rm.hint}>
            Biggest month: {MONTH_NAMES[best.month]}, {best.effort.toLocaleString()} Effort across {best.count} {best.count === 1 ? 'activity' : 'activities'}.
          </Text>
        )}
      </View>

      {/* Consistency: every week of the year. */}
      <View style={[rm.card, s.cardGap]}>
        <View style={rm.cardHead}>
          <Text style={rm.label}>Active weeks</Text>
          <Text style={s.weeksCount}>{trainedWeeks} of {pastWeeks.length}</Text>
        </View>
        {/* Three even rows across the card, January top left. */}
        <View style={s.weekGrid}>
          {weekRows.map((row, r) => (
            <View key={r} style={s.weekRow}>
              {row.map((w, i) => {
                if (!w) return <View key={`pad${i}`} style={s.weekCell} />;
                const a = shade(w.effort);
                return (
                  <View
                    key={w.start.getTime()}
                    style={[
                      s.weekCell,
                      w.future
                        ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }
                        : a === 0
                          ? { backgroundColor: 'rgba(255,255,255,0.06)' }
                          : { backgroundColor: hexAlpha(RivalColors.accentFill, a) },
                    ]}
                  />
                );
              })}
            </View>
          ))}
        </View>
        {review.longestWeekStreak > 1 && (
          <Text style={rm.hint}>Longest run: {review.longestWeekStreak} weeks in a row with at least one activity.</Text>
        )}
      </View>

      {/* Highlights. */}
      <View style={s.grid}>
        {review.bestWeek && (
          <Highlight icon="fire" title="Best week" value={`${review.bestWeek.effort.toLocaleString()} Effort`} note={`Week of ${shortDate(review.bestWeek.start)}`} units />
        )}
        {review.longestSession && (
          <Highlight icon="timer" title="Longest activity" value={formatMinutes(review.longestSession.minutes)} note={`${activityDisplayName(review.longestSession.type)} · ${shortDate(review.longestSession.date)}`} units />
        )}
        {review.farthest && (
          <Highlight icon="distance" title="Farthest" value={formatDistance(review.farthest.km)} note={`${activityDisplayName(review.farthest.type)} · ${shortDate(review.farthest.date)}`} units />
        )}
        {review.topActivity && (
          <Highlight icon={activityIconName(review.topActivity.type)} title="Top activity" value={activityDisplayName(review.topActivity.type)} note={`${review.topActivity.count} ${review.topActivity.count === 1 ? 'time' : 'times'}`} />
        )}
      </View>

      {/* What the year was made of. */}
      <View style={[rm.card, s.cardGap]}>
        <Text style={rm.label}>By activity</Text>
        {review.byActivity.slice(0, 8).map((b) => (
          <View key={b.type} style={s.typeRow}>
            <RivalIcon name={activityIconName(b.type)} size={18} color={RivalColors.accentFill} />
            <View style={s.typeBody}>
              {/* The total is the hero: large serif on the right. The count sits
                  quietly beside the name (Ricky, 2026-10-11). A type with no
                  distance or time (e.g. untimed workouts) shows only its count. */}
              <View style={s.typeTop}>
                <Text style={s.typeName} numberOfLines={1}>
                  {activityDisplayName(b.type)}
                  <Text style={s.typeCount}>{'  '}{b.count} {b.count === 1 ? 'activity' : 'activities'}</Text>
                </Text>
                {b.km > 0 || b.minutes > 0 ? (
                  <TotalFigure km={b.km} minutes={b.minutes} />
                ) : null}
              </View>
              <View style={s.typeTrack}><View style={[s.typeFill, { width: `${Math.round((b.count / maxTypeCount) * 100)}%` }]} /></View>
            </View>
          </View>
        ))}
      </View>

      {/* Personal bests set this year. */}
      {pbGroups.length > 0 && (
        <View style={[rm.card, s.cardGap]}>
          <Text style={rm.label}>Personal bests</Text>
          {pbGroups.map((group, gi) => {
            const [latest, ...earlier] = group;
            const open = openPbTypes.has(latest.type);
            const title = latest.kind === 'distance'
              ? `Farthest ${activityDisplayName(latest.type).toLowerCase()}`
              : `Longest ${activityDisplayName(latest.type).toLowerCase()}`;
            return (
              <View key={latest.type} style={gi > 0 && s.pbBorder}>
                <TouchableOpacity
                  style={s.pbRow}
                  activeOpacity={earlier.length ? 0.7 : 1}
                  disabled={!earlier.length}
                  onPress={() => togglePbType(latest.type)}
                  accessibilityRole={earlier.length ? 'button' : undefined}
                  accessibilityState={earlier.length ? { expanded: open } : undefined}
                >
                  <View style={s.pbIcon}><RivalIcon name="trophy" size={15} color={RivalColors.rankAnchors.unrivaled} /></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.pbTitle}>{title}</Text>
                    <Text style={rm.hint}>{pbFrom(latest)}</Text>
                    {earlier.length ? (
                      <Text style={s.pbMore}>{`Set ${group.length} times this year`}</Text>
                    ) : null}
                  </View>
                  {/* The best is the trophy: large on the right, in gold
                      (Ricky, 2026-10-11). The date moved under the title. */}
                  <View style={s.pbRight}>
                    <Text style={s.pbValue}>{pbValue(latest)}</Text>
                    {earlier.length ? <RivalIcon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={RivalWarm.muted} /> : null}
                  </View>
                </TouchableOpacity>
                {open ? earlier.map((p) => (
                  <View key={p.date.getTime()} style={s.pbEarlier}>
                    <Text style={[rm.hint, { flex: 1 }]}>{pbFrom(p)}</Text>
                    <Text style={s.pbValueSmall}>{pbValue(p)}</Text>
                  </View>
                )) : null}
              </View>
            );
          })}
        </View>
      )}

      {/* The view's one main action, so RIVAL's gradient pill (Ricky, 2026-10-11:
          the dark outlined button read as disabled). */}
      <TouchableOpacity style={rm.primary} onPress={() => router.push('/year-review')} accessibilityRole="button">
        <Text style={rm.primaryText}>Open the full year in review</Text>
      </TouchableOpacity>
    </View>
  );
}

function Highlight({ icon, title, value, note, units = false }: { icon: any; title: string; value: string; note: string; units?: boolean }) {
  // With `units`, the digits stay large and the units ("h", "km", "Effort")
  // are set small and soft, like the By activity totals; a "0m" is dropped.
  const figure = units
    ? value.replace(/ 0m$/, '').split(/(\d[\d.,]*)/).filter(Boolean).map((part, i) =>
      /^\d/.test(part) ? part : <Text key={i} style={s.hlUnit}>{part}</Text>)
    : value;
  return (
    <View style={[rm.card, s.hl]}>
      <RivalIcon name={icon} size={18} color={RivalColors.accentFill} />
      <Text style={s.hlTitle}>{title}</Text>
      <Text style={s.hlValue} numberOfLines={1}>{figure}</Text>
      <Text style={rm.hint} numberOfLines={1}>{note}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: 14 },
  switcher: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  switchBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: RivalWarm.field },
  switchYear: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 28, fontWeight: '700', color: '#fff', minWidth: 90, textAlign: 'center' },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 28 },

  hero: { alignItems: 'center', gap: 8, paddingVertical: 22 },
  // The Legacy number's white-to-ember fade (home.tsx mLegacyHeroNumber); the
  // side padding keeps the italic's last digit inside the gradient clip.
  heroNum: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 52, lineHeight: 58, paddingHorizontal: 6, fontWeight: '700', color: RivalColors.accentText,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #D97757 150%)',
      backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent',
    } as any : {}),
  },
  rankLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  rankName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.4, fontSize: 18 },
  heroMeta: { fontSize: 13, color: RivalWarm.soft, textAlign: 'center' },
  next: { alignSelf: 'stretch', gap: 7, marginTop: 8, paddingTop: 12, paddingBottom: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,209,190,0.08)' },
  nextHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  nextLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  nextToGo: { fontSize: 12, fontWeight: '700' },
  nextTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: -4 },
  nextTitle: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 17, fontWeight: '700', lineHeight: 22, textTransform: 'uppercase', letterSpacing: 1.2, flexShrink: 1 },
  track: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },

  cardGap: { gap: 12 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4 },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  barArea: { height: 96, justifyContent: 'flex-end', alignSelf: 'stretch' },
  bar: { borderRadius: 4, alignSelf: 'stretch' },
  barLabel: { fontSize: 11, fontWeight: '700', color: RivalWarm.muted },

  weeksCount: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 18, fontWeight: '700', color: '#fff' },
  weekGrid: { gap: 3 },
  weekRow: { flexDirection: 'row', gap: 3 },
  weekCell: { flex: 1, aspectRatio: 1, borderRadius: 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  hl: { flexBasis: '47%', flexGrow: 1, gap: 4, paddingVertical: 14 },
  hlTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: RivalWarm.muted, marginTop: 4 },
  hlValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 20, fontWeight: '700', color: '#fff' },
  hlUnit: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },

  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  typeBody: { flex: 1, gap: 6 },
  typeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  typeName: { flex: 1, fontSize: 14.5, fontWeight: '700', color: '#fff' },
  typeMeta: { fontSize: 12.5, color: RivalWarm.soft },
  typeCount: { fontSize: 12, fontWeight: '600', color: RivalWarm.muted },
  typeTotal: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 20, lineHeight: 24, color: '#fff' },
  typeUnit: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  typeTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  typeFill: { height: 4, borderRadius: 2, backgroundColor: 'rgba(217,119,87,0.7)' },

  pbRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  pbBorder: { borderTopWidth: 1, borderTopColor: RivalWarm.hairline },
  pbIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,215,0,0.1)' },
  pbTitle: { fontSize: 14.5, fontWeight: '700', color: '#fff' },
  pbDate: { fontSize: 12, color: RivalWarm.muted },
  pbRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pbValue: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 22, lineHeight: 26, color: RivalColors.rankAnchors.unrivaled },
  pbValueSmall: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700', fontSize: 15, color: 'rgba(255,215,0,0.75)' },
  pbMore: { fontSize: 11.5, fontWeight: '700', color: RivalColors.accentText, marginTop: 1 },
  pbEarlier: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, paddingLeft: 44 },
});
