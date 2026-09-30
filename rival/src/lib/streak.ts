export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekKey(date: Date): string {
  return getMondayOfWeek(date).toISOString().split('T')[0];
}

// Step whole weeks via calendar-day arithmetic, NOT fixed ±7*24h milliseconds:
// across a DST transition a week is 167 or 169 hours long, and a fixed-ms step
// lands on Sunday 23:00 / Monday 01:00 — which getMondayOfWeek then normalizes
// to the WRONG Monday, silently skipping or double-counting a week.
function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

export type StreakResult = {
  current: number;      // consecutive weeks active
  activeThisWeek: boolean;
  longestEver: number;
};

const STREAK_MIN_ACTIVITIES = 3;

export function calculateStreak(activities: { started_at: string }[]): StreakResult {
  if (activities.length === 0) return { current: 0, activeThisWeek: false, longestEver: 0 };

  // Count activities per week — only weeks with 3+ qualify
  const weekCounts: Record<string, number> = {};
  for (const a of activities) {
    if (!a.started_at) continue;
    const d = new Date(a.started_at);
    if (isNaN(d.getTime())) continue;
    const k = weekKey(d);
    weekCounts[k] = (weekCounts[k] ?? 0) + 1;
  }
  const activeWeeks = new Set(
    Object.entries(weekCounts).filter(([, n]) => n >= STREAK_MIN_ACTIVITIES).map(([k]) => k)
  );

  const now = new Date();
  const thisWeekKey = weekKey(now);
  const activeThisWeek = activeWeeks.has(thisWeekKey);

  // Walk back week by week from current or last week
  let checkDate = activeThisWeek
    ? getMondayOfWeek(now)
    : addWeeks(getMondayOfWeek(now), -1);

  let current = 0;
  while (activeWeeks.has(weekKey(checkDate))) {
    current++;
    checkDate = addWeeks(checkDate, -1);
  }

  // Longest ever — scan all weeks in range
  const allDates = activities
    .filter((a) => a.started_at)
    .map((a) => new Date(a.started_at))
    .filter((d) => !isNaN(d.getTime()));
  if (allDates.length === 0) return { current, activeThisWeek, longestEver: current };
  const earliest = new Date(Math.min(...allDates.map((d) => d.getTime())));
  let longestEver = 0;
  let running = 0;
  let cursor = getMondayOfWeek(earliest);
  const end = getMondayOfWeek(now);

  while (cursor <= end) {
    if (activeWeeks.has(weekKey(cursor))) {
      running++;
      longestEver = Math.max(longestEver, running);
    } else {
      running = 0;
    }
    cursor = addWeeks(cursor, 1);
  }

  return { current, activeThisWeek, longestEver };
}

export function streakMessage(streak: StreakResult): string {
  if (streak.current === 0) return 'Log an activity this week to start a streak.';
  if (!streak.activeThisWeek) return `${streak.current} week streak, don't break it now!`;
  if (streak.current === 1) return 'Streak started. Come back next week to keep it going.';
  if (streak.current < 4) return `${streak.current} weeks in a row. Stay consistent.`;
  if (streak.current < 8) return `${streak.current} week streak. A consistent habit.`;
  if (streak.current < 12) return `${streak.current} weeks. Consistency is your superpower.`;
  if (streak.current < 26) return `${streak.current} week streak. Consistent training.`;
  return `${streak.current} weeks. Unrivaled consistency.`;
}
