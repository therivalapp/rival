import { Platform } from 'react-native';

// Each rank's material, by level (Rookie first): stone, copper, bronze, then
// sapphire, emerald, ruby, amethyst, opal, platinum and gold. Picked by Ricky
// 2026-10-01 ("M2, gems and metals") over flat colours, which looked cheap.
// `light` is the highlight and `dark` the shade; drawn as a soft sheen from
// one to the other, never as one flat colour.
//
// Phone screens use these. Desktop keeps RANK_LEVEL_COLORS (mobile-only phase).
export const RANK_SHEEN: { light: string; dark: string }[] = [
  { light: '#d8d3cc', dark: '#8a837b' }, // Rookie: stone
  { light: '#e6a882', dark: '#91573a' }, // Hustler: copper
  { light: '#d9c08e', dark: '#8f7342' }, // Warrior: bronze
  { light: '#9fb6e6', dark: '#3f5d9c' }, // Elite: sapphire
  { light: '#9fd9bd', dark: '#2f7a5b' }, // Champion: emerald
  { light: '#e7a3ad', dark: '#8f3a49' }, // Legend: ruby
  { light: '#c9b0e8', dark: '#6a4a9a' }, // Mythic: amethyst
  { light: '#d4ecf0', dark: '#78a3ad' }, // Immortal: opal
  { light: '#eef1f5', dark: '#98a1ab' }, // God: platinum
  { light: '#fff0b0', dark: '#c4932a' }, // Unrivaled: gold
];

export function rankSheen(level: number): { light: string; dark: string } {
  return RANK_SHEEN[Math.min(RANK_SHEEN.length, Math.max(1, level)) - 1];
}

/** A rank name in its material: white fading into the highlight on web, the
 *  highlight itself elsewhere. */
export function rankTextSheen(level: number): object {
  const { light } = rankSheen(level);
  return Platform.OS === 'web'
    ? { backgroundImage: `linear-gradient(180deg, #ffffff 10%, ${light} 120%)`, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' }
    : { color: light };
}

/** The circle behind a rank icon: a soft sheen with a light rim and glow. */
export function rankBadgeSheen(level: number, lit = true): object {
  const { light, dark } = rankSheen(level);
  if (!lit) return { backgroundColor: dark + '1f', borderColor: light + '2a' };
  return Platform.OS === 'web'
    ? { backgroundImage: `radial-gradient(circle at 35% 25%, ${light}33, ${dark}22 70%)`, borderColor: light + '66', boxShadow: `0 0 18px ${dark}33` }
    : { backgroundColor: dark + '33', borderColor: light + '66' };
}

/** An earned rank's tile, filled solid in its material (Ricky, 2026-10-03:
 *  mockup B, full colour). Text on it is dark: RANK_TILE_INK. */
export function rankTileFill(level: number): object {
  const { light, dark } = rankSheen(level);
  return Platform.OS === 'web'
    ? { backgroundImage: `linear-gradient(160deg, ${light} 0%, ${dark} 100%)`, borderColor: light }
    : { backgroundColor: dark, borderColor: light };
}

export const RANK_TILE_INK = '#1a1210';
