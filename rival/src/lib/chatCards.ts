import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { getLevel } from './xp';
import { tileLabel } from './activityTypes';
import { formatActivityDistance, formatDistanceWhole } from './units';
import { showFinish } from './time';
import { firstName } from './safety';
import type { RivalIconName } from '../components/rival/RivalIcon';

// Chat cards (Mockup 33 v4, approved 2026-11-11). Like Messenger's birthday
// card: a strip above the message box when something is worth saying, with
// replies that send in one tap. At most ONE card a day in each chat, picked
// by priority, so a big team is never flooded. Each card is shown on one day
// only; the X or any reply puts it away. Cards about a person are never shown
// to that person.
//
// Worked out on the phone from data members can already read (team
// activities, public events, planned activities). Kept for the day per team.
//
// Birthdays come from team_birthdays (day and month, only for members who
// turned "Teammates can see my birthday" on). Members who turned off
// "Milestones about me" get no race day, result, rank, hours or welcome back
// cards (Privacy, Mockup 34).

export type ChatCardChip =
  | { kind: 'send'; label: string; text: string }
  | { kind: 'respect'; label: string; activityId: string }
  | { kind: 'rsvp'; label: string; messageId: string }
  | { kind: 'open'; label: string; route: string }
  | { kind: 'dismiss'; label: string };

export type ChatCard = {
  key: string;
  icon: RivalIconName;
  tone: 'accent' | 'event' | 'pb';
  text: string;
  chips: ChatCardChip[];
};

export type CardSession = { id: string; user_id: string; activity_type: string | null; scheduled_at: string | null };
type Member = { user_id: string; name: string; joined_at: string | null; milestones: boolean };
type Act = {
  id: string; user_id: string; started_at: string; activity_type: string;
  duration_seconds: number | null; distance_meters: number | null;
  elevation_meters: number | null; effort_score: number | null; race_id: string | null;
};

const DAY = 86_400_000;
const RECENT_MS = 36 * 60 * 60 * 1000; // "just happened": the last day and a half
const HOUR_MARKS = [50, 100, 250, 500, 1000, 1500, 2000];
const BACK_AFTER_DAYS = 21;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayOf(dateStr: string): Date { return new Date(`${dateStr}T12:00:00`); }
function weekday(dateStr: string): string { return dayOf(dateStr).toLocaleDateString(undefined, { weekday: 'long' }); }
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?AM$/i, ' am').replace(/\s?PM$/i, ' pm');
}
function withArticle(word: string): string { return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`; }

async function pagedActivities(userIds: string[], since: string): Promise<Act[]> {
  const out: Act[] = [];
  // PostgREST returns at most 1,000 rows a request.
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabase
      .from('activities')
      .select('id, user_id, started_at, activity_type, duration_seconds, distance_meters, elevation_meters, effort_score, race_id')
      .in('user_id', userIds)
      .gte('started_at', since)
      .order('started_at', { ascending: true })
      .range(from, from + 999);
    if (error || !data) break;
    out.push(...(data as Act[]));
    if (data.length < 1000) break;
  }
  return out;
}

const METRIC_UNIT: Record<string, string> = { xp: 'Effort', distance: 'km', elevation: 'm', duration: 'hour', activities: 'activity' };
function metricValue(a: Act, metric: string): number {
  if (metric === 'xp') return a.effort_score || 0;
  if (metric === 'distance') return (a.distance_meters || 0) / 1000;
  if (metric === 'elevation') return a.elevation_meters || 0;
  if (metric === 'duration') return (a.duration_seconds || 0) / 3600;
  return 1;
}

/** Every card that could show in this team's chat today, highest priority first. */
export async function buildChatCards(args: {
  leagueId: string; me: string; sessions: CardSession[]; rsvpMap: Record<string, string[]>;
}): Promise<ChatCard[]> {
  const { leagueId, me, sessions, rsvpMap } = args;
  const now = new Date();
  const today = ymd(now);
  const yearStart = `${now.getFullYear()}-01-01T00:00:00`;

  const [{ data: league }, { data: memberRows }, { data: birthdayRows }] = await Promise.all([
    supabase.from('leagues').select('name, created_at, race_id, goal_metric, goal_target, goal_target_date').eq('id', leagueId).maybeSingle(),
    supabase.from('league_members').select('user_id, joined_at, users(display_name, chat_milestones)').eq('league_id', leagueId).eq('status', 'active'),
    supabase.rpc('team_birthdays', { lid: leagueId }),
  ]);
  if (!league || !memberRows) return [];
  const members: Member[] = (memberRows as any[]).map((m) => ({
    user_id: m.user_id, joined_at: m.joined_at, name: firstName(m.users?.display_name || 'A teammate'),
    milestones: m.users?.chat_milestones !== false,
  }));

  const byId = new Map(members.map((m) => [m.user_id, m]));
  // Cards about a person's own milestones respect their Privacy switch.
  const celebrate = (userId: string) => { const m = byId.get(userId); return !!m && m.milestones; };
  const others = members.filter((m) => m.user_id !== me);
  const ids = members.map((m) => m.user_id);
  const hubRoute = `/team-hub?id=${leagueId}`;

  // Team activities from 1 January, or from when the team began if that was
  // earlier and a challenge is running (it counts from the start).
  const since = league.goal_metric && league.created_at < yearStart ? league.created_at : yearStart;
  const weekAgo = ymd(new Date(now.getTime() - 2 * DAY));
  const weekAhead = ymd(new Date(now.getTime() + 7 * DAY));
  const [acts, { data: raceRows }] = await Promise.all([
    pagedActivities(ids, since),
    supabase.from('races').select('id, user_id, name, race_date, actual_finish_time')
      .gte('race_date', weekAgo).lte('race_date', weekAhead)
      .or(`user_id.in.(${ids.join(',')})${league.race_id ? `,id.eq.${league.race_id}` : ''}`),
  ]);
  const races = (raceRows ?? []) as { id: string; user_id: string; name: string; race_date: string; actual_finish_time: string | null }[];
  const { data: interestRows } = races.length
    ? await supabase.from('race_interests').select('race_id, user_id').in('race_id', races.map((r) => r.id)).in('user_id', ids)
    : { data: [] as any[] };

  const cards: ChatCard[] = [];
  const recentCut = now.getTime() - RECENT_MS;

  // 1. Race day, one card per teammate racing today.
  for (const r of races.filter((r) => r.race_date === today && r.user_id !== me && celebrate(r.user_id))) {
    const n = byId.get(r.user_id)!.name;
    cards.push({
      key: `raceday:${r.id}`, icon: 'run', tone: 'event', text: `${n} races the ${r.name} today.`,
      chips: [{ kind: 'send', label: `Good luck today, ${n}`, text: `Good luck today, @${n}` }, { kind: 'send', label: 'Go get it 💪', text: `Go get it, @${n} 💪` }],
    });
  }

  // 2. Results from the last two days.
  for (const r of races.filter((r) => r.actual_finish_time && r.race_date <= today && r.user_id !== me && celebrate(r.user_id))) {
    const n = byId.get(r.user_id)!.name;
    const act = acts.find((a) => a.race_id === r.id && a.user_id === r.user_id);
    cards.push({
      key: `result:${r.id}`, icon: 'trophy', tone: 'event', text: `${n} finished the ${r.name} in ${showFinish(r.actual_finish_time)}.`,
      chips: [
        ...(act ? [{ kind: 'respect' as const, label: 'Respect', activityId: act.id }] : []),
        { kind: 'send', label: `Great race, ${n}`, text: `Great race, @${n}` },
      ],
    });
  }

  // Birthdays: on the day, and two days before (like Messenger).
  const md = (d: Date) => `${d.getMonth() + 1}-${d.getDate()}`;
  const todayMd = md(now);
  const soonMd = md(new Date(now.getTime() + 2 * DAY));
  for (const b of (birthdayRows ?? []) as { user_id: string; month: number; day: number }[]) {
    if (b.user_id === me || !byId.has(b.user_id)) continue;
    const n = byId.get(b.user_id)!.name;
    const key = `${b.month}-${b.day}`;
    if (key === todayMd) {
      cards.push({
        key: `birthday:${b.user_id}:${now.getFullYear()}`, icon: 'cake', tone: 'accent', text: `It is ${n}'s birthday today.`,
        chips: [{ kind: 'send', label: `Happy birthday, ${n} 🎂`, text: `Happy birthday, @${n} 🎂` }, { kind: 'send', label: 'Have a great day', text: `Have a great day, @${n}` }],
      });
    } else if (key === soonMd) {
      cards.push({
        key: `birthday-soon:${b.user_id}:${now.getFullYear()}`, icon: 'cake', tone: 'accent', text: `${n}'s birthday is in 2 days.`,
        chips: [{ kind: 'send', label: `Happy early birthday, ${n} 🎉`, text: `Happy early birthday, @${n} 🎉` }, { kind: 'send', label: 'Have a great one', text: `Have a great one, @${n}` }],
      });
    }
  }

  // 3. A planned activity tomorrow, for anyone not yet going.
  const tomorrow = ymd(new Date(now.getTime() + DAY));
  for (const s of sessions) {
    if (!s.scheduled_at || s.user_id === me) continue;
    if (ymd(new Date(s.scheduled_at)) !== tomorrow) continue;
    const going = rsvpMap[s.id] ?? [];
    if (going.includes(me)) continue;
    const title = s.activity_type ? tileLabel(s.activity_type) : 'Planned activity';
    cards.push({
      key: `planned:${s.id}`, icon: 'event', tone: 'accent',
      text: `${title} tomorrow at ${timeOf(s.scheduled_at)}. ${going.length} going.`,
      chips: [{ kind: 'rsvp', label: "I'm in", messageId: s.id }, { kind: 'dismiss', label: "Can't make it" }],
    });
  }

  // 4. An event in the next week with teammates racing.
  const upcoming = races.filter((r) => r.race_date > today && r.race_date <= weekAhead);
  const seenRace = new Set<string>();
  for (const r of upcoming) {
    if (seenRace.has(r.id)) continue;
    seenRace.add(r.id);
    const racers = new Set<string>();
    if (byId.has(r.user_id)) racers.add(r.user_id);
    (interestRows ?? []).filter((i: any) => i.race_id === r.id).forEach((i: any) => racers.add(i.user_id));
    if (racers.size === 0 || (racers.size === 1 && racers.has(me))) continue;
    const day = weekday(r.race_date);
    const who = racers.size === 1 ? `${byId.get([...racers][0])!.name} is racing.` : `${racers.size} from the team are racing.`;
    cards.push({
      key: `event:${r.id}`, icon: 'flag', tone: 'event', text: `${r.name} is on ${day}. ${who}`,
      chips: [{ kind: 'send', label: `Good luck on ${day}`, text: `Good luck on ${day}, everyone racing` }, { kind: 'send', label: 'Who is coming to watch?', text: `Who is coming to watch the ${r.name}?` }],
    });
  }

  // 5. New members, in the last two days.
  for (const m of others.filter((m) => m.joined_at && now.getTime() - new Date(m.joined_at).getTime() < 2 * DAY)) {
    cards.push({
      key: `joined:${m.user_id}`, icon: 'personAdd', tone: 'accent', text: `${m.name} joined the team.`,
      chips: [{ kind: 'send', label: `Welcome, ${m.name} 👋`, text: `Welcome, @${m.name} 👋` }, { kind: 'send', label: 'Good to have you', text: `Good to have you, @${m.name}` }],
    });
  }

  // 6. Team challenge: 50%, 75%, the last 3 days, complete.
  if (league.goal_metric && league.goal_target && league.goal_target_date) {
    const target = Number(league.goal_target);
    const total = acts.filter((a) => a.started_at >= league.created_at).reduce((s, a) => s + metricValue(a, league.goal_metric), 0);
    const pct = target > 0 ? Math.floor((total / target) * 100) : 0;
    const daysLeft = Math.round((dayOf(league.goal_target_date).getTime() - dayOf(today).getTime()) / DAY);
    const unit = METRIC_UNIT[league.goal_metric] ?? '';
    const plural = target === 1 || unit === 'km' || unit === 'm' || unit === 'Effort' ? unit : unit === 'activity' ? 'activities' : `${unit}s`;
    const name = `${target.toLocaleString()} ${plural} challenge`;
    const base = `challenge:${league.goal_metric}:${target}:${league.goal_target_date}`;
    const view = { kind: 'open' as const, label: 'View challenge', route: hubRoute };
    if (pct >= 100) {
      cards.push({ key: `${base}:done`, icon: 'groups', tone: 'accent', text: `${name} is complete.`, chips: [{ kind: 'send', label: 'Done, team', text: 'Done, team 🎉' }, view] });
    } else if (daysLeft >= 0 && daysLeft <= 3) {
      cards.push({ key: `${base}:last`, icon: 'groups', tone: 'accent', text: `${name} has ${daysLeft === 0 ? 'its last day today' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}. ${pct}% done.`, chips: [{ kind: 'send', label: 'Last push', text: 'Last push, team' }, view] });
    } else if (daysLeft > 0 && (pct >= 75 || pct >= 50)) {
      const mark = pct >= 75 ? 75 : 50;
      cards.push({ key: `${base}:${mark}`, icon: 'groups', tone: 'accent', text: `${name} is ${mark}% done. ${daysLeft} days left.`, chips: [{ kind: 'send', label: mark === 75 ? 'Nearly there' : 'Halfway there', text: mark === 75 ? 'Nearly there, team' : 'Halfway there, team' }, view] });
    }
  }

  // Per-person totals for this calendar year.
  const yearActs = acts.filter((a) => a.started_at >= yearStart);
  const byUser = new Map<string, Act[]>();
  yearActs.forEach((a) => { (byUser.get(a.user_id) ?? byUser.set(a.user_id, []).get(a.user_id)!).push(a); });

  // 7. Rank up, and 8. hours milestones, from activities in the last day and a half.
  const rankCards: ChatCard[] = [];
  const hourCards: ChatCard[] = [];
  const backCards: ChatCard[] = [];
  for (const m of others) {
    if (!m.milestones) continue;
    const list = byUser.get(m.user_id) ?? [];
    if (!list.length) continue;
    const recent = list.filter((a) => new Date(a.started_at).getTime() >= recentCut);
    if (!recent.length) continue;
    const latest = recent[recent.length - 1];
    const effort = list.reduce((s, a) => s + (a.effort_score || 0), 0);
    const effortBefore = effort - recent.reduce((s, a) => s + (a.effort_score || 0), 0);
    const lvl = getLevel(effort);
    if (lvl.level > getLevel(effortBefore).level) {
      rankCards.push({
        key: `rank:${m.user_id}:${now.getFullYear()}:${lvl.level}`, icon: `rank${lvl.name}` as RivalIconName, tone: 'accent',
        text: `${m.name} reached ${lvl.name}.`,
        chips: [{ kind: 'respect', label: 'Respect', activityId: latest.id }, { kind: 'send', label: 'Well earned', text: `Well earned, @${m.name}` }],
      });
    }
    const hours = list.reduce((s, a) => s + (a.duration_seconds || 0), 0) / 3600;
    const hoursBefore = hours - recent.reduce((s, a) => s + (a.duration_seconds || 0), 0) / 3600;
    const mark = [...HOUR_MARKS].reverse().find((h) => hours >= h && hoursBefore < h);
    if (mark) {
      hourCards.push({
        key: `hours:${m.user_id}:${now.getFullYear()}:${mark}`, icon: 'hourglass', tone: 'accent',
        text: `${m.name} passed ${mark.toLocaleString()} hours of activity this year.`,
        chips: [{ kind: 'respect', label: 'Respect', activityId: latest.id }, { kind: 'send', label: 'That is dedication', text: `That is dedication, @${m.name}` }],
      });
    }
    // 11. Welcome back: the first activity after three weeks or more without one.
    const first = recent[0];
    const prev = list[list.indexOf(first) - 1];
    if (prev && new Date(first.started_at).getTime() - new Date(prev.started_at).getTime() >= BACK_AFTER_DAYS * DAY) {
      const dist = formatActivityDistance(first.distance_meters, first.activity_type);
      const what = `${dist ? `${dist} ` : ''}${tileLabel(first.activity_type).toLowerCase()}`;
      backCards.push({
        key: `back:${first.id}`, icon: 'wavingHand', tone: 'accent', text: `${m.name} is back with ${withArticle(what)}.`,
        chips: [{ kind: 'send', label: `Welcome back, ${m.name}`, text: `Welcome back, @${m.name}` }, { kind: 'respect', label: 'Respect', activityId: first.id }],
      });
    }
  }
  cards.push(...rankCards, ...hourCards);

  // 9. The team's anniversary.
  const started = new Date(league.created_at);
  const years = now.getFullYear() - started.getFullYear();
  if (years >= 1 && started.getMonth() === now.getMonth() && started.getDate() === now.getDate()) {
    const span = years === 1 ? 'one year' : `${years} years`;
    cards.push({
      key: `anniversary:${now.getFullYear()}`, icon: 'celebration', tone: 'accent', text: `${league.name} started ${span} ago today.`,
      chips: [{ kind: 'send', label: `Happy ${span}, team 🎉`, text: `Happy ${span}, team 🎉` }, { kind: 'send', label: `Here is to year ${years + 1}`, text: `Here is to year ${years + 1}` }],
    });
  }

  // 10. Monday: last week, Monday to Sunday.
  if (now.getDay() === 1) {
    const end = new Date(now); end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 7 * DAY);
    const week = acts.filter((a) => { const t = new Date(a.started_at).getTime(); return t >= start.getTime() && t < end.getTime(); });
    const hrs = Math.round(week.reduce((s, a) => s + (a.duration_seconds || 0), 0) / 3600);
    const km = week.reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000;
    if (hrs >= 1) {
      cards.push({
        key: `week:${ymd(start)}`, icon: 'barChart', tone: 'accent',
        text: `Last week the team logged ${hrs} ${hrs === 1 ? 'hour' : 'hours'}${km >= 1 ? ` and ${formatDistanceWhole(km)}` : ''}.`,
        chips: [{ kind: 'send', label: 'Strong week, team', text: 'Strong week, team' }, { kind: 'open', label: 'View the week', route: hubRoute }],
      });
    }
  }

  // 11. Welcome back is last: only on a day with nothing else.
  cards.push(...backCards);
  return cards;
}

// One card a day in each chat. The pick is remembered for the day, so the
// same card stays put while the chat is reopened; a card shown on one day is
// never shown again.
type DayPick = { day: string; key: string | null; closed: boolean; at?: number };
// With nothing to show yet, look again at most once an hour.
const RECHECK_MS = 60 * 60 * 1000;
const pickKey = (leagueId: string) => `rival_chat_card:${leagueId}`;
const doneKey = (leagueId: string) => `rival_chat_cards_done:${leagueId}`;

async function readJson<T>(k: string, fallback: T): Promise<T> {
  try { const v = await AsyncStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
async function writeJson(k: string, v: unknown) {
  try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch {}
}

export async function todaysChatCard(leagueId: string, build: () => Promise<ChatCard[]>): Promise<ChatCard | null> {
  const today = ymd(new Date());
  const pick = await readJson<DayPick | null>(pickKey(leagueId), null);
  if (pick?.day === today && pick.closed) return null;
  if (pick?.day === today && !pick.key && Date.now() - (pick.at ?? 0) < RECHECK_MS) return null;
  const cards = await build();
  if (pick?.day === today && pick.key) return cards.find((c) => c.key === pick.key) ?? null;
  const done = await readJson<string[]>(doneKey(leagueId), []);
  const card = cards.find((c) => !done.includes(c.key)) ?? null;
  await writeJson(pickKey(leagueId), { day: today, key: card?.key ?? null, closed: false, at: Date.now() });
  if (card) await writeJson(doneKey(leagueId), [...done, card.key].slice(-300));
  return card;
}

/** The X, or any reply: the card is put away until tomorrow's. */
export async function closeChatCard(leagueId: string) {
  await writeJson(pickKey(leagueId), { day: ymd(new Date()), key: null, closed: true });
}
