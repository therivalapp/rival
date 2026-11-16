// Steps goal maths (Mockup 52, 2026-11-14). A Steps goal is a daily or weekly
// step target filled from Apple Health. Steps never add Effort (board
// 2026-11-14): this file only reads a day-by-day step map.

export type DailySteps = Record<string, number>;

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday of the week `d` falls in (weeks start Monday, like streak.ts). */
export function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** Average steps a day over the last `days` days before today, counting only
 *  days with steps (a phone left at home isn't a zero). */
export function averageSteps(steps: DailySteps, days = 30, today = new Date()): number {
  const vals: number[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const v = steps[dayKey(d)];
    if (v && v > 0) vals.push(v);
  }
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

export type StepsWeekDay = { label: string; steps: number; hit: boolean; today: boolean; future: boolean; fill: number };

/** This week, Monday to Sunday. For a daily goal each day fills toward the
 *  target; for a weekly goal toward a seventh of it. */
export function stepsWeek(steps: DailySteps, target: number, period: 'day' | 'week', today = new Date()): StepsWeekDay[] {
  const mon = mondayOf(today);
  const perDay = period === 'day' ? target : target / 7;
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const todayKey = dayKey(today);
  return labels.map((label, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const k = dayKey(d);
    const v = steps[k] ?? 0;
    const future = k > todayKey;
    return { label, steps: v, hit: !future && perDay > 0 && v >= perDay, today: k === todayKey, future, fill: future || perDay <= 0 ? 0 : Math.min(1, v / perDay) };
  });
}

export type StepsProgress = {
  current: number; // today's steps (daily) or this week's (weekly)
  target: number;
  pct: number; // 0..1
  toGo: number;
  daysHit: number; // days so far this week at the daily pace
  daysSoFar: number; // days this week up to today
  week: StepsWeekDay[];
};

export function stepsProgress(steps: DailySteps, target: number, period: 'day' | 'week', today = new Date()): StepsProgress {
  const week = stepsWeek(steps, target, period, today);
  const current = period === 'day' ? (steps[dayKey(today)] ?? 0) : week.reduce((a, d) => a + d.steps, 0);
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  const past = week.filter((d) => !d.future);
  return { current, target, pct, toGo: Math.max(0, target - current), daysHit: past.filter((d) => d.hit).length, daysSoFar: past.length, week };
}
