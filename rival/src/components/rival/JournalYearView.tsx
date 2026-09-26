import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { RivalIcon, activityIconName } from './RivalIcon';
import { rm, RivalWarm } from './RivalMobile';
import { RivalColors, RivalSerifFamily } from '../../constants/rivalTheme';
import { buildYearReview, activityDisplayName, formatMinutes, type YearActivity } from '../../lib/yearReview';
import { monthlyTotals, pbMoments, yearsWithActivity, yearWeeks } from '../../lib/yearJournal';
import { getLevel, xpProgressInLevel } from '../../lib/xp';
import { formatDistance, formatDistanceWhole, toDisplayDistance, distanceUnit } from '../../lib/units';

// The Activity Journal's Year tab: one year of training at a glance. Drawn from
// the activities the journal already holds, so it opens instantly and needs no
// requests of its own. The full, shareable Year in Review is one tap away.

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

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
  const pbs = useMemo(() => pbMoments(activities, year), [activities, year]);

  const isThisYear = year === now.getFullYear();
  const level = getLevel(review.effort);
  const progress = xpProgressInLevel(review.effort);
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
          <Text style={[rm.hint, { textAlign: 'center' }]}>Every activity logged or synced from Strava builds the year here.</Text>
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
        <View style={[s.rankChip, { borderColor: hexAlpha(level.color, 0.5), backgroundColor: hexAlpha(level.color, 0.12) }]}>
          <RivalIcon name="medal" size={14} color={level.color} />
          <Text style={[s.rankText, { color: level.color }]}>{level.name}</Text>
        </View>
        <Text style={s.heroMeta}>
          {review.count.toLocaleString()} {review.count === 1 ? 'activity' : 'activities'} · {formatMinutes(review.minutes)} · {review.activeDays.toLocaleString()} active {review.activeDays === 1 ? 'day' : 'days'}
        </Text>
        {isThisYear && level.maxXp !== Infinity && (
          <View style={s.nextWrap}>
            <View style={s.track}><View style={[s.fill, GRADIENT, { width: `${Math.max(3, Math.round(progress.pct * 100))}%` }]} /></View>
            <Text style={rm.hint}>{(level.maxXp - review.effort).toLocaleString()} Effort to the next rank</Text>
          </View>
        )}
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
          <Text style={rm.label}>Weeks trained</Text>
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
          <Highlight icon="fire" title="Best week" value={`${review.bestWeek.effort.toLocaleString()} Effort`} note={`Week of ${shortDate(review.bestWeek.start)}`} />
        )}
        {review.longestSession && (
          <Highlight icon="timer" title="Longest activity" value={formatMinutes(review.longestSession.minutes)} note={`${activityDisplayName(review.longestSession.type)} · ${shortDate(review.longestSession.date)}`} />
        )}
        {review.farthest && (
          <Highlight icon="distance" title="Farthest" value={formatDistance(review.farthest.km)} note={`${activityDisplayName(review.farthest.type)} · ${shortDate(review.farthest.date)}`} />
        )}
        {review.topActivity && (
          <Highlight icon={activityIconName(review.topActivity.type)} title="Most done" value={activityDisplayName(review.topActivity.type)} note={`${review.topActivity.count} ${review.topActivity.count === 1 ? 'time' : 'times'}`} />
        )}
      </View>

      {/* What the year was made of. */}
      <View style={[rm.card, s.cardGap]}>
        <Text style={rm.label}>By activity</Text>
        {review.byActivity.slice(0, 8).map((b) => (
          <View key={b.type} style={s.typeRow}>
            <RivalIcon name={activityIconName(b.type)} size={18} color={RivalColors.accentFill} />
            <View style={s.typeBody}>
              <View style={s.typeTop}>
                <Text style={s.typeName} numberOfLines={1}>{activityDisplayName(b.type)}</Text>
                <Text style={s.typeMeta}>
                  {b.count} · {b.km > 0 ? formatDistanceWhole(b.km) : formatMinutes(b.minutes)}
                </Text>
              </View>
              <View style={s.typeTrack}><View style={[s.typeFill, { width: `${Math.round((b.count / maxTypeCount) * 100)}%` }]} /></View>
            </View>
          </View>
        ))}
      </View>

      {/* Personal bests set this year. */}
      {pbs.length > 0 && (
        <View style={[rm.card, s.cardGap]}>
          <Text style={rm.label}>Personal bests</Text>
          {pbs.map((p, i) => (
            <View key={`${p.type}-${p.date.getTime()}`} style={[s.pbRow, i > 0 && s.pbBorder]}>
              <View style={s.pbIcon}><RivalIcon name="trophy" size={15} color={RivalColors.rankAnchors.unrivaled} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.pbTitle}>
                  {p.kind === 'distance' ? `Farthest ${activityDisplayName(p.type).toLowerCase()}` : `Longest ${activityDisplayName(p.type).toLowerCase()}`}
                </Text>
                <Text style={rm.hint}>
                  {p.kind === 'distance'
                    ? `${toDisplayDistance(p.value).toFixed(1)} ${distanceUnit()}, up from ${toDisplayDistance(p.previous).toFixed(1)}`
                    : `${formatMinutes(p.value)}, up from ${formatMinutes(p.previous)}`}
                </Text>
              </View>
              <Text style={s.pbDate}>{shortDate(p.date)}</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={rm.ghost} onPress={() => router.push('/year-review')} accessibilityRole="button">
        <Text style={rm.ghostText}>Open the full year in review</Text>
      </TouchableOpacity>
    </View>
  );
}

function Highlight({ icon, title, value, note }: { icon: any; title: string; value: string; note: string }) {
  return (
    <View style={[rm.card, s.hl]}>
      <RivalIcon name={icon} size={18} color={RivalColors.accentFill} />
      <Text style={s.hlTitle}>{title}</Text>
      <Text style={s.hlValue} numberOfLines={1}>{value}</Text>
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
  heroNum: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 52, lineHeight: 58, fontWeight: '700', color: RivalColors.accentText },
  rankChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  rankText: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroMeta: { fontSize: 13, color: RivalWarm.soft, textAlign: 'center' },
  nextWrap: { alignSelf: 'stretch', gap: 6, marginTop: 6, alignItems: 'center' },
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

  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  typeBody: { flex: 1, gap: 6 },
  typeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  typeName: { flex: 1, fontSize: 14.5, fontWeight: '700', color: '#fff' },
  typeMeta: { fontSize: 12.5, color: RivalWarm.soft },
  typeTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  typeFill: { height: 4, borderRadius: 2, backgroundColor: 'rgba(217,119,87,0.7)' },

  pbRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  pbBorder: { borderTopWidth: 1, borderTopColor: RivalWarm.hairline },
  pbIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,215,0,0.1)' },
  pbTitle: { fontSize: 14.5, fontWeight: '700', color: '#fff' },
  pbDate: { fontSize: 12, color: RivalWarm.muted },
});
