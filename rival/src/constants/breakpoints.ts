// Shared window-width breakpoints for responsive screens. Keep these as the
// single source of truth — don't inline new `windowWidth >= N` checks in
// screens; add a named constant here instead so every screen agrees on what
// counts as "wide".

// Sidebar / multi-column desktop-style layouts (profile, league, lifts, etc.)
export const BREAKPOINT_WIDE_LAYOUT = 840;

// Two-up card grid (discover-leagues, my-activities) — needs less room than
// a full sidebar layout, just enough for two cards side by side.
export const BREAKPOINT_TWO_UP_GRID = 760;

// Inline gallery placement next to the stat column in my-activities — only
// the widest cards have room for this without cramping.
export const BREAKPOINT_SPACIOUS_GALLERY = 900;

// Below this, RivalTopNav swaps its desktop link row for the floating
// bottom tab bar. Screens with their own fixed/floating elements (FABs, etc.)
// need this too, to know when to clear the bar's height.
export const BREAKPOINT_MOBILE_NAV = 640;

// Side pages (everything except the four main tabs, sign-in and chat) show
// their phone design on desktop too, held to a centred column, since
// 2026-10-03 (Ricky: "do what we've done to the desktop version"). Their old
// desktop layouts are kept behind this switch rather than deleted.
export const SIDE_PAGES_USE_PHONE_DESIGN = true;

/** Whether a side page should draw its old desktop layout at this width. */
export function sidePageWide(width: number): boolean {
  return !SIDE_PAGES_USE_PHONE_DESIGN && width >= BREAKPOINT_WIDE_LAYOUT;
}

// How wide a side page's phone design may grow on a wide screen, and a
// pop-up sheet within it.
export const SIDE_PAGE_MAX_WIDTH = 680;
export const SIDE_SHEET_MAX_WIDTH = 560;
