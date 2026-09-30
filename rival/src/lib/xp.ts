export type Level = {
  level: number;
  name: string;
  minXp: number;
  maxXp: number;
  color: string;
  icon: string; // placeholder until proper images are added
};

// Effort needed for each rank within one calendar year (ranks reset on
// 1 January). Set 2026-09-26 around a realistic year: about 46 training weeks,
// leaving roughly six for holidays, illness, injury or a taper, at about 70
// Effort an hour. On that basis Legend is ~4 hours a week and Unrivaled ~9.5 —
// reachable by a committed amateur with rest days, without punishing a missed
// fortnight. Every rank above Rookie has to be trained for.
// supabase/functions/season-rollover keeps its own copy — change both.
// Raised ~30% on 2026-10 with the distance formula, which lifts totals by
// about that much; nobody changed rank in the dry run.
export const LEVELS: Level[] = [
  { level: 1,  name: 'Rookie',    minXp: 0,      maxXp: 2000,      color: '#6b7280', icon: '🌱' },
  { level: 2,  name: 'Hustler',   minXp: 2000,    maxXp: 5250,      color: '#06b6d4', icon: '🔥' },
  { level: 3,  name: 'Warrior',   minXp: 5250,    maxXp: 9000,     color: '#2563eb', icon: '⚔️' },
  { level: 4,  name: 'Elite',     minXp: 9000,   maxXp: 13000,     color: '#059669', icon: '💎' },
  { level: 5,  name: 'Champion',  minXp: 13000,   maxXp: 17500,     color: '#d97706', icon: '🏅' },
  { level: 6,  name: 'Legend',    minXp: 17500,   maxXp: 22750,    color: '#dc2626', icon: '👑' },
  { level: 7,  name: 'Mythic',    minXp: 22750,  maxXp: 28000,    color: '#db2777', icon: '🌟' },
  { level: 8,  name: 'Immortal',  minXp: 28000,  maxXp: 33250,    color: '#4f46e5', icon: '♾️' },
  { level: 9,  name: 'God',       minXp: 33250,  maxXp: 39000,    color: '#f97316', icon: '⚡' },
  { level: 10, name: 'Unrivaled', minXp: 39000,  maxXp: Infinity, color: '#fbbf24', icon: '🏆' },
];

export function getLevel(xp: number): Level {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].minXp) return LEVELS[i];
  }
  return LEVELS[0];
}

export function xpProgressInLevel(xp: number): { current: number; needed: number; pct: number } {
  const lvl = getLevel(xp);
  if (lvl.maxXp === Infinity) return { current: xp - lvl.minXp, needed: 0, pct: 1 };
  const current = xp - lvl.minXp;
  const needed = lvl.maxXp - lvl.minXp;
  return { current, needed, pct: current / needed };
}
