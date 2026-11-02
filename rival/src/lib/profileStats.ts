// The two stats either side of Effort on a profile (Ricky, 2026-11-01).
// Respect, Inspired and People are left out: they sit on the line below.

export const PROFILE_STAT_KEYS = ['time', 'activities', 'distance', 'elevation', 'streak', 'lifetime'] as const;
export type ProfileStatKey = (typeof PROFILE_STAT_KEYS)[number];

export const DEFAULT_PROFILE_STATS: [ProfileStatKey, ProfileStatKey] = ['time', 'activities'];

/** A saved choice, or the defaults when it is missing or no longer valid. */
export function readProfileStats(saved: unknown): [ProfileStatKey, ProfileStatKey] {
  if (!Array.isArray(saved) || saved.length !== 2 || saved[0] === saved[1]) return DEFAULT_PROFILE_STATS;
  if (!saved.every((k) => (PROFILE_STAT_KEYS as readonly string[]).includes(k))) return DEFAULT_PROFILE_STATS;
  return saved as [ProfileStatKey, ProfileStatKey];
}
