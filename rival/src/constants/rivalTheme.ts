// RIVAL's real design system — "Refined Ember".
//
// Source of truth: three separate Stitch exports (2026-07-09/10) all produced
// the IDENTICAL token set in DESIGN.md (see rival/design/stitch-export*/),
// confirming this is a locked system, not a one-off screen's colors. Every
// screen should import from here instead of hardcoding hex values — the old
// screens (home.tsx, league.tsx, profile.tsx, etc.) currently hardcode ~20
// different ad-hoc colors with no shared source, which is exactly what this
// file replaces, one screen at a time.
//
// Do not add colors here that aren't in DESIGN.md without checking with Ricky
// first — this file should stay traceable back to the design export.

import { Platform } from 'react-native';

export const RivalColors = {
  // Surfaces — tiered charcoal system, darkest to lightest.
  surfaceLowest: '#0e0e0e',
  surfaceLow: '#131313', // base app background
  surfaceContainer: '#20201f',
  surfaceHigh: '#282828', // elevated cards (DESIGN.md prose calls this "surface-high")
  surfaceContainerHigh: '#2a2a2a',
  surfaceContainerHighest: '#353535',
  surfaceBright: '#323232', // hover / emphasized containers
  surfaceVariant: '#353535',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  onSurface: '#e5e2e1',
  onSurfaceVariant: '#dbc1b9',

  // Outlines / borders
  outline: '#a38c85',
  outlineVariant: '#55433d',

  // Accent — two related but DISTINCT oranges, don't merge them:
  //   accentText  = soft salmon, used for large glowing stat numbers/icons
  //   accentFill  = saturated terracotta, used for solid button fills
  // (DESIGN.md's own token dump vs its prose disagree on which hex is
  // "primary" — screenshots make it unambiguous: buttons are the darker one.)
  accentText: '#ffb59e',
  accentFill: '#D97757',
  onAccentFill: '#5c1902', // text/icon color ON a filled accent button — dark, not white (see screenshots: "Sign In", "Resume Mission" button labels are dark brown, not white)
  // Gradient-gold end color for the Today mobile redesign's hero-number/progress-bar
  // gradients (base-mockup-v3-warm-light-source.html). Deliberately distinct from
  // rankAnchors.unrivaled (#FFD700) and the ad-hoc #D8A81D RivalTopNav hardcodes for
  // rank text — three golds now coexist; reconciling them is a separate follow-up.
  accentGold: '#F5B759',

  // Secondary tone (used sparingly — chips, muted UI)
  secondary: '#c8c6c5',
  secondaryContainer: '#4a4949',

  // Tertiary — teal, used for the "Inspired" premium state per DESIGN.md
  tertiary: '#5edac7',
  tertiaryContainer: '#09a493',
  onTertiaryContainer: '#00312b',

  // Semantic
  error: '#ffb4ab',
  errorContainer: '#93000a',
  success: '#4ade80', // NOT in DESIGN.md — kept from the existing app for trend-up arrows until a real success token is designed; flag for Ricky if you're touching this

  // Rank ladder — only 4 anchor colors are in DESIGN.md (Rookie/Pro/Elite/
  // Unrivaled), but the real app has a 10-level ladder (xp.ts LEVELS). The
  // ramp below linearly interpolates between the 4 anchors as a PROVISIONAL
  // bridge so implementation isn't blocked — confirm the in-between levels
  // with Ricky before treating them as final.
  rankAnchors: {
    rookie: '#B0B0B0',
    pro: '#D97757',
    elite: '#9F57D9',
    unrivaled: '#FFD700',
  },
} as const;

// Provisional 10-level rank ramp (see rankAnchors comment above).
// Levels 1-2 Rookie, 3-5 ramp to Pro, 6-8 ramp to Elite, 9 near-Elite, 10 Unrivaled.
function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function mix(hexA: string, hexB: string, t: number) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `#${[r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
export const RANK_LEVEL_COLORS: string[] = [
  RivalColors.rankAnchors.rookie,
  RivalColors.rankAnchors.rookie,
  mix(RivalColors.rankAnchors.rookie, RivalColors.rankAnchors.pro, 1 / 3),
  mix(RivalColors.rankAnchors.rookie, RivalColors.rankAnchors.pro, 2 / 3),
  RivalColors.rankAnchors.pro,
  mix(RivalColors.rankAnchors.pro, RivalColors.rankAnchors.elite, 1 / 3),
  mix(RivalColors.rankAnchors.pro, RivalColors.rankAnchors.elite, 2 / 3),
  RivalColors.rankAnchors.elite,
  mix(RivalColors.rankAnchors.elite, RivalColors.rankAnchors.unrivaled, 0.5),
  RivalColors.rankAnchors.unrivaled,
];

// Typography — Manrope, per DESIGN.md. Loaded via Google Fonts CSS for web
// (src/global.css) and @expo-google-fonts/manrope for native.
export const RivalFontFamily = 'Manrope';

// The editorial accent face, used ITALIC and selectively — hero titles, athlete
// names, event names, and small unit labels on Team Feed / Team Hub / the
// activity diary. It is what gives those surfaces their magazine feel against
// Manrope's neutral UI text.
//
// A system stack on purpose: Georgia ships on every Apple and Windows device
// and costs nothing to load, which matters on a page that already carries a
// photographic hero. Swapping in a webfont (Instrument Serif, Fraunces) means
// changing this one constant — that is the reason it exists, rather than the 24
// copies of the same string that were previously scattered across 7 screens.
export const RivalSerifFamily = 'Georgia, "Times New Roman", serif';

export const RivalType = {
  displayHero: { fontFamily: RivalFontFamily, fontSize: 48, fontWeight: '800' as const, lineHeight: 56, letterSpacing: -0.96 },
  headlineLg: { fontFamily: RivalFontFamily, fontSize: 32, fontWeight: '700' as const, lineHeight: 40, letterSpacing: -0.32 },
  headlineLgMobile: { fontFamily: RivalFontFamily, fontSize: 28, fontWeight: '700' as const, lineHeight: 36 },
  titleMd: { fontFamily: RivalFontFamily, fontSize: 20, fontWeight: '600' as const, lineHeight: 28 },
  bodyLg: { fontFamily: RivalFontFamily, fontSize: 18, fontWeight: '400' as const, lineHeight: 28 },
  bodyMd: { fontFamily: RivalFontFamily, fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  labelCaps: { fontFamily: RivalFontFamily, fontSize: 12, fontWeight: '700' as const, lineHeight: 16, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  metricLarge: { fontFamily: RivalFontFamily, fontSize: 32, fontWeight: '300' as const, lineHeight: 32, letterSpacing: -0.32 },
};

// Shape — "Soft iOS-inspired," base 8px.
export const RivalRadius = {
  sm: 4,
  DEFAULT: 8, // standard containers, buttons, inputs
  md: 12,
  lg: 16, // large cards / sheets
  xl: 24,
  full: 9999,
};

// Spacing
export const RivalSpacing = {
  stackGap: 16,
  sectionMargin: 32,
  containerPadding: 24,
  gutter: 16,
  maxWidth: 1200,
};

// Primary buttons: the soft salmon of Home's Add Activity on phones, the
// terracotta they have always been on desktop. Ricky's call (2026-09-24):
// buttons and selected states (the chosen chip, tab or toggle) — badges, bars
// and dots keep accentFill — and mobile only, as desktop is untouched until
// the mobile app is finished.
//
// On the web the switch is two CSS variables that global.css sets below the
// phone breakpoint (BREAKPOINT_MOBILE_NAV); left unset on desktop, each falls
// back to exactly what that button had before. Native is always a phone.
//
// `label` takes the colour a button's text already had, because those differ
// (some dark brown, some near-white) — near-white on salmon is unreadable, so
// phones use the dark brown for all of them.
export const RivalButtonColors = {
  fill: Platform.OS === 'web' ? `var(--rival-button-fill, ${RivalColors.accentFill})` : RivalColors.accentText,
  label: (desktopColor: string) =>
    Platform.OS === 'web' ? `var(--rival-button-label, ${desktopColor})` : RivalColors.onAccentFill,
  // Spread next to `fill`. On phones it lays the terracotta-to-salmon gradient
  // (the one Team Hub's filter chips already use) over the salmon fill; on
  // desktop the variable is unset, so it is `none` and nothing changes.
  // Native has no CSS gradients and keeps the flat salmon.
  gradient: (Platform.OS === 'web' ? { backgroundImage: 'var(--rival-button-image, none)' } : {}) as any,
  // A gradient paints over the background colour, so any disabled or "off"
  // style that works by swapping the colour must also clear the gradient, or
  // a greyed-out button would stay orange.
  noGradient: (Platform.OS === 'web' ? { backgroundImage: 'none' } : {}) as any,
};
