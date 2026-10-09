import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { View, Text, TouchableOpacity, Image, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useIsFocused, usePathname } from 'expo-router';
import { supabase, getAuthUser } from '../../lib/supabase';
import { getLevel } from '../../lib/xp';
import { getSeasonStartISO } from '../../lib/season';
import { fetchInboxBadgeCount, onInboxChanged } from '../../lib/inbox';
import { NotificationsMenu } from './NotificationsMenu';
import { stravaSharingNeedsAnswer } from '../../lib/stravaSharing';
import { getUnreadChats } from '../../lib/unreadChats';
import { RivalColors, RivalType } from '../../constants/rivalTheme';
import { BREAKPOINT_MOBILE_NAV } from '../../constants/breakpoints';
import { RivalIcon, RivalIconName } from './RivalIcon';
import Svg, { Path } from 'react-native-svg';
import { goToTab, type TabRoute } from '../../lib/tabNav';

// Shared persistent top navigation, matching the Stitch mockups. Drop it in at
// the top of a screen (outside the ScrollView so it stays put) and pass the
// current section so it highlights. Self-contained: fetches the user's avatar
// itself so it needs no props beyond `active`.
type Section = 'today' | 'activity' | 'teams' | 'chat';

const LINKS: Array<{ key: Section; label: string; route: string; icon: RivalIconName }> = [
  { key: 'today', label: 'Today', route: '/home', icon: 'home' },
  { key: 'activity', label: 'Activity', route: '/my-activities', icon: 'stats' },
  // Team Feed is now the Teams tab's landing screen (Ricky's call,
  // 2026-08-10) — team-feed.tsx is still static sample data, not wired to
  // real teams yet. discover-leagues.tsx (the old "My Teams" list) needs a
  // new home; Ricky's thinking the top of this feed.
  { key: 'teams', label: 'Teams', route: '/team-feed', icon: 'groups' },
  // Chat earns a tab because team chat is the ONLY conversation in RIVAL —
  // the social graph is teams, so there is no other way people talk. Last in
  // the row so the three existing tabs don't move under anyone's thumb.
  { key: 'chat', label: 'Chat', route: '/messages', icon: 'chat' },
];

// Avatar, name and rank for the bar, shared by every screen's copy of it.
// A minute is short enough that a new photo or a rank change shows up soon,
// and invalidateNavIdentity() refreshes it at once where that matters.
const NAV_IDENTITY_MS = 60_000;
let navIdentity: {
  at: number; userId: string; avatarUrl: string | null; displayName: string; initial: string; rankName: string;
} | null = null;

export function invalidateNavIdentity() {
  navIdentity = null;
}

export function RivalTopNav({ active, centerSlot, hideBar, action }: {
  active?: Section;
  centerSlot?: ReactNode;
  hideBar?: boolean;
  /**
   * ONE screen-specific action, left of the bell. Deliberately singular: the
   * bar is shared by every screen, so anything permanent here has to earn its
   * place on all of them. Per-screen actions belong to the screen.
   */
  action?: { icon: RivalIconName; label: string; onPress: () => void };
}) {
  // Re-checked on every navigation rather than on an interval: this bar is
  // mounted on every screen, so a route change is both the cheapest signal
  // that something may have changed and the moment the count is looked at.
  const pathname = usePathname();
  const [unreadChats, setUnreadChats] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getUnreadChats()
      .then((r) => { if (!cancelled) setUnreadChats(r.count); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  const [inboxCount, setInboxCount] = useState(0);
  const bellRef = useRef<View>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const barRef = useRef<View>(null);
  const [notifAnchor, setNotifAnchor] = useState<{ left: number; top: number; width: number; height: number; barBottom: number } | null>(null);
  // A route change closes the dropdown.
  useEffect(() => { setNotifOpen(false); }, [pathname]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      Promise.all([fetchInboxBadgeCount(), stravaSharingNeedsAnswer().catch(() => false)])
        .then(([n, strava]) => { if (!cancelled) setInboxCount(n + (strava ? 1 : 0)); })
        .catch(() => {});
    };
    refresh();
    // Acting on an item does not navigate, so without this the badge would keep
    // claiming work that was just done.
    const unsubscribe = onInboxChanged(refresh);
    return () => { cancelled = true; unsubscribe(); };
  }, [pathname]);

  const { width } = useWindowDimensions();
  // Below this, the absolutely-centered links row (built for desktop, where the
  // logo and the RANK/bell/avatar cluster are far apart) collides with the right
  // cluster instead of sitting in genuine empty space. Drop to a second in-flow
  // row instead of overlapping text on top of text.
  const narrow = width < BREAKPOINT_MOBILE_NAV;
  // react-native-screens (web) hides an inactive screen with `display:none`
  // rather than unmounting it, so a signed-out or navigated-away screen's
  // RivalTopNav instance keeps running. That's invisible for everything
  // inline in this component's own tree, but the bottom pill below is
  // portaled straight to document.body (see bottomNavPortalTarget) to escape
  // iOS Safari's nested-scroll position:fixed bug — which means it's NOT a
  // descendant of the hidden screen wrapper, so display:none never hides it.
  // Gating the portal on focus is what actually hides it when its screen
  // isn't the active one (e.g. it was still showing over the sign-out
  // welcome screen, which renders no RivalTopNav of its own at all).
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  // Keyboard-only offset. When the software keyboard opens, visualViewport
  // shrinks below the layout viewport and this keeps the pill above it.
  // It is NOT what handles the iOS-standalone viewport split — measured on
  // device (2026-08-24, standalone:Y): innerHeight 793 === visualViewport
  // .height 793, so this term is 0 there. The split is between the LAYOUT
  // viewport (793, what `position:fixed` resolves against) and the true
  // screen (852, what 100vh resolves to); that is corrected in CSS on the
  // style itself — see `bottom` on bottomNavOuter below.
  const [navBottomOffset, setNavBottomOffset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => setNavBottomOffset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  // Instagram-style: shrink the pill while scrolling down, restore it on the
  // way back up. The scrollable element is a per-screen ScrollView (a plain
  // div on web), not window itself — but "scroll" events don't bubble, so a
  // normal window listener never sees them. A CAPTURING window listener does:
  // capture phase reaches every ancestor on the way down to the actual
  // target, regardless of bubbling. That's what lets this live once here,
  // self-contained, instead of wiring onScroll into every mobile screen.
  // Native has no DOM window, so this stays a no-op there.
  const [navShrunk, setNavShrunk] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !narrow) return;
    const lastY = new Map<EventTarget, number>();
    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      const y = target.scrollTop ?? 0;
      const prevY = lastY.get(target) ?? y;
      const delta = y - prevY;
      lastY.set(target, y);
      if (y <= 4) { setNavShrunk(false); return; }
      if (delta > 6) setNavShrunk(true);
      else if (delta < -6) setNavShrunk(false);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true } as any);
  }, [narrow]);
  // Seeded from the shared cache, so a newly opened screen shows the avatar
  // and rank at once instead of a "?" that fills in a moment later.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(navIdentity?.avatarUrl ?? null);
  const [initial, setInitial] = useState(navIdentity?.initial ?? '?');
  const [displayName, setDisplayName] = useState(navIdentity?.displayName ?? '');
  const [rankName, setRankName] = useState<string | null>(navIdentity?.rankName ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  async function handleSignOut() {
    invalidateNavIdentity();
    await supabase.auth.signOut();
    router.replace('/');
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user || cancelled) return;
      // Every screen has its own copy of this bar, so without a shared cache
      // each navigation re-fetched the profile and the whole year's
      // activities just to draw an avatar and a rank.
      if (navIdentity && navIdentity.userId === user.id && Date.now() - navIdentity.at < NAV_IDENTITY_MS) return;

      const [{ data: profile }, { data: seasonActs }] = await Promise.all([
        supabase.from('users').select('avatar_url, display_name').eq('id', user.id).single(),
        // Rank = level from this season's Effort. Query only the season's rows
        // (bounded) rather than all-time, so the nav stays light on every screen.
        supabase.from('activities').select('effort_score').eq('user_id', user.id).gte('started_at', getSeasonStartISO()),
      ]);
      if (cancelled) return;

      const name = profile?.display_name || (user.user_metadata?.display_name as string) || '';
      const seasonEffort = (seasonActs || []).reduce((sum, a) => sum + (a.effort_score || 0), 0);
      navIdentity = {
        at: Date.now(),
        userId: user.id,
        avatarUrl: profile?.avatar_url || null,
        displayName: name,
        initial: name ? name[0].toUpperCase() : '?',
        rankName: getLevel(seasonEffort).name,
      };
      setAvatarUrl(navIdentity.avatarUrl);
      setDisplayName(navIdentity.displayName);
      setInitial(navIdentity.initial);
      setRankName(navIdentity.rankName);
    })();
    return () => { cancelled = true; };
  }, []);

  // iOS Safari has a long-standing bug: `position: fixed` inside a nested
  // scrolling container (which is what Expo Router's screen wrapper is, on
  // web) doesn't stay pinned to the viewport — it scrolls along with that
  // container instead, instead of staying pinned to the bottom of the
  // screen. Rendering the bar as a portal directly under <body> sidesteps
  // that nested container entirely, so `fixed` behaves the way it does
  // everywhere else. Native has no such container, so it renders inline
  // there as before (bottomNavPortalTarget is null on native).
  const bottomNavPortalTarget = Platform.OS === 'web' && typeof document !== 'undefined' ? document.body : null;
  const bottomNav = (
    // `calc(100% - 100vh)` is the iOS-standalone correction. For a fixed
    // element 100% is the LAYOUT viewport (793 on device) while 100vh is the
    // TRUE screen (852), so this evaluates to -59px and pushes the pill down
    // onto the real bottom edge. In any normal browser the two are equal and
    // it evaluates to 0, leaving behaviour there unchanged. navBottomOffset
    // adds the keyboard case on top.
    //
    // paddingBottom lifts the pill clear of the home indicator, and lives on
    // this OUTER wrapper (no background of its own) so the visible pill keeps
    // its compact hug-the-content size — putting it on the pill instead
    // stretches its own background into a tall bar (80989da relearned this).
    // Trimmed from the full 34pt inset: the indicator only occupies the
    // bottom ~21px, and the full inset floated the pill far enough off the
    // edge to read as dead space. Unlike every earlier attempt at this, the
    // gap is now safe — the shell reaches the true 852 bottom, so what shows
    // under the pill is the app's own background, not bare page canvas.
    <View
      style={[
        styles.bottomNavOuter,
        {
          bottom: `calc(100% - 100vh + ${navBottomOffset}px)`,
          paddingBottom: insets.bottom > 0 ? Math.max(insets.bottom - 12, 8) : 6,
        } as any,
      ]}
    >
      <View style={[styles.bottomNav, navShrunk && styles.bottomNavShrunk]}>
        {LINKS.map((l) => {
          const isActive = active === l.key;
          return (
            <TouchableOpacity
              key={l.key}
              onPress={() => goToTab(l.route as TabRoute)}
              style={[styles.bottomNavItem, isActive && styles.bottomNavItemActive, navShrunk && styles.bottomNavItemShrunk]}
            >
              <View>
                <RivalIcon name={l.icon} size={navShrunk ? 22 : 20} color={isActive ? RivalColors.accentText : RivalColors.textSecondary} />
                {/* A tab that looks identical at 0 and 9 unread gives no reason
                    to tap it — the count IS the invitation. */}
                {l.key === 'chat' && unreadChats > 0 && <View style={styles.navBadge} />}
              </View>
              <Text style={[styles.bottomNavLabel, isActive && styles.bottomNavLabelActive, navShrunk && styles.bottomNavLabelShrunk]}>{l.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // hideBar drops the top row (logo/links/avatar cluster) for screens that
  // want their own hero to own the top of the page (e.g. team-feed.tsx),
  // while still keeping the floating bottom tab pill — that pill is the only
  // way to switch tabs on mobile, so it must survive even when the bar above
  // it doesn't. Desktop has no bottom pill (narrow-only), so hideBar means no
  // nav chrome at all there; acceptable since this app is mobile-first.
  if (hideBar) {
    if (!isFocused) return null;
    return narrow ? (bottomNavPortalTarget ? createPortal(bottomNav, bottomNavPortalTarget) : bottomNav) : null;
  }

  return (
    // Screens wrap this in a SafeAreaView, which pads the whole app down past
    // the status bar / Dynamic Island (59pt in standalone). That left the inset
    // strip painting the bare page background ABOVE the nav, reading as dead
    // space over the header. Pull the bar back up through that padding and add
    // it back as internal padding instead, so the bar's own background runs
    // edge-to-edge under the status bar while its content stays clear of it.
    // insets.top is 0 in a browser tab, where this is a no-op.
    <View ref={barRef as any} style={[styles.bar, narrow && styles.barNarrow, insets.top > 0 && ({ marginTop: -insets.top, paddingTop: insets.top } as any)]}>
      <View style={[styles.row, narrow && styles.rowNarrow]}>
        <TouchableOpacity
          onPress={() => goToTab('/home')}
          style={narrow && centerSlot ? styles.logoWrapBalanced : undefined}
        >
          <Text style={[styles.logo, narrow && styles.logoNarrow]}>RIVAL</Text>
        </TouchableOpacity>

        {!narrow && (
          <View style={[styles.links, Platform.OS === 'web' && (styles.linksCentered as any)]}>
            {LINKS.map((l) => (
              <TouchableOpacity key={l.key} onPress={() => goToTab(l.route as TabRoute)}>
                <Text style={[styles.link, active === l.key && styles.linkActive]}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Mobile-only center slot (e.g. Today's "Total time earned") — desktop
            keeps its existing links row above, unaffected when this prop is
            omitted by every other screen. In-flow (not absolutely centered
            like the desktop links row) so it shares space with the logo and
            right cluster instead of overlapping them on a narrow screen. */}
        {narrow && centerSlot ? (
          <View style={styles.centerSlot}>
            {centerSlot}
          </View>
        ) : null}

        <View style={[styles.right, narrow && styles.rightNarrow, narrow && !!centerSlot && styles.rightBalanced]}>
          {/* RANK badge is desktop-only on this bar — mobile shows the same
              rank name inside the Today screen's own Legacy section instead,
              so it doesn't fight the center slot for space here. */}
          {rankName && !narrow && (
            <TouchableOpacity style={styles.rankBadge} onPress={() => router.push('/ranks')}>
              <Text style={styles.rankLabel}>RANK</Text>
              <Text
                style={[
                  styles.rankValue,
                  { color: '#D8A81D', fontStyle: 'italic' },
                  // Same gradient recipe as the hero number on home.tsx —
                  // web-only (background-clip: text has no RN-native
                  // equivalent), flat color above is the native fallback.
                  ...(Platform.OS === 'web' ? [{
                    backgroundImage: 'linear-gradient(180deg, #FFE48A, #D8A81D)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    color: 'transparent',
                  } as any] : []),
                ]}
              >
                {rankName}
              </Text>
            </TouchableOpacity>
          )}
          {/* The chat icon that used to sit here moved to the bottom nav, where
              it carries an unread dot. Two doors to the same room — one of
              them badge-less — is worse than one. This slot now takes ONE
              optional per-screen action instead. */}
          {action && (
            <TouchableOpacity
              onPress={action.onPress}
              accessibilityLabel={action.label}
              style={[styles.notifBtn, narrow && styles.notifBtnNarrow]}
            >
              <RivalIcon name={action.icon} size={narrow ? 21 : 22} color={RivalColors.accentText} />
            </TouchableOpacity>
          )}
          {/* Phones: the bell opens a dropdown of the latest notifications, with
              See all leading to the full page. Desktop keeps going straight to
              the page. */}
          <TouchableOpacity
            ref={bellRef as any}
            onPress={() => {
              if (!narrow) { router.push('/inbox'); return; }
              // The dropdown grows out of the bell itself, so it needs to know
              // exactly where the bell and the bottom of the bar are.
              const bell = (bellRef.current as any)?.getBoundingClientRect?.();
              const bar = (barRef.current as any)?.getBoundingClientRect?.();
              if (bell && bar) {
                setNotifAnchor({ left: bell.left, top: bell.top, width: bell.width, height: bell.height, barBottom: bar.bottom });
              }
              setNotifOpen(true);
            }}
            accessibilityLabel="Notifications"
            style={[styles.notifBtn, narrow && styles.notifBtnNarrow]}
          >
            {/* A fine-line bell, to match the thin type around it (Ricky,
                2026-10-03, option B; desktop too since that night). */}
            <Svg width={narrow ? 23 : 24} height={narrow ? 23 : 24} viewBox="0 0 24 24" fill="none" stroke={RivalColors.accentText} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </Svg>
            {inboxCount > 0 ? (
              <View style={styles.notifDot}>
                <Text style={styles.notifDotText}>{inboxCount > 9 ? '9+' : inboxCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <View
            style={styles.avatarWrap}
            {...(Platform.OS === 'web'
              ? { onMouseEnter: () => setMenuOpen(true), onMouseLeave: () => setMenuOpen(false) } as any
              : {})}
          >
            <View style={[styles.avatarRing, narrow && styles.avatarRingNarrow]}>
              <TouchableOpacity onPress={() => router.push('/profile')} style={[styles.avatar, narrow && styles.avatarNarrow]}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={[styles.avatarImg, narrow && styles.avatarImgNarrow]} />
                ) : (
                  <Text style={[styles.avatarInitial, narrow && styles.avatarInitialNarrow]}>{initial}</Text>
                )}
              </TouchableOpacity>
            </View>
            {/* Invisible hover bridge covering the row's own bottom padding
                between the avatar and the bar's bottom edge — without it,
                that strip belongs to `row`/`right` (not a descendant of
                avatarWrap), so crossing it on the way down would fire
                mouseleave and close the menu before the pointer reaches it. */}
            {Platform.OS === 'web' && <View style={[styles.avatarMenuBridge, narrow && { right: -8 }]} />}
            {Platform.OS === 'web' && (
              <View
                style={[
                  styles.avatarMenu,
                  // rowNarrow pads 8, not 20: -20 pushed the (hidden) menu
                  // 12px past the screen edge on phones.
                  narrow && { right: -8 },
                  {
                    transform: [{ scaleY: menuOpen ? 1 : 0 }],
                    opacity: menuOpen ? 1 : 0,
                    transition: 'transform 0.16s ease, opacity 0.12s ease',
                  } as any,
                ]}
                pointerEvents={menuOpen ? 'auto' : 'none'}
              >
                <View style={styles.avatarMenuHeader}>
                  <View style={styles.avatarMenuHeaderAvatar}>
                    {avatarUrl ? (
                      <Image source={{ uri: avatarUrl }} style={styles.avatarMenuHeaderImg} />
                    ) : (
                      <Text style={styles.avatarInitial}>{initial}</Text>
                    )}
                  </View>
                  <View>
                    <Text style={styles.avatarMenuHeaderName}>{displayName || 'You'}</Text>
                    {rankName && (
                      <Text
                        style={[
                          styles.avatarMenuHeaderRank,
                          { color: '#D8A81D' },
                          // Same gold gradient recipe as the RANK badge above —
                          // web-only, flat gold above is the native fallback.
                          ...(Platform.OS === 'web' ? [{
                            backgroundImage: 'linear-gradient(180deg, #FFE48A, #D8A81D)',
                            backgroundClip: 'text',
                            WebkitBackgroundClip: 'text',
                            color: 'transparent',
                          } as any] : []),
                        ]}
                      >
                        {rankName.toUpperCase()}
                      </Text>
                    )}
                  </View>
                </View>
                {/* "Profile" used to point at /profile, which is the SETTINGS
                    page (Personal Info / Connected Apps / Notifications /
                    Account) — while the actual profile, the one with your
                    name, avatar and Effort, lives at /stats. profile.tsx
                    already redirects there when you view someone else's.
                    Both menu items also landed on the same settings page, one
                    just deep-linking a tab of the other. */}
                <TouchableOpacity
                  style={[styles.avatarMenuItem, hoveredItem === 'profile' && styles.avatarMenuItemHovered]}
                  onPress={() => { setMenuOpen(false); router.push('/stats'); }}
                  {...(Platform.OS === 'web' ? { onMouseEnter: () => setHoveredItem('profile'), onMouseLeave: () => setHoveredItem(null) } as any : {})}
                >
                  <RivalIcon name="person" size={16} color={RivalColors.accentText} />
                  <Text style={styles.avatarMenuText}>Profile</Text>
                </TouchableOpacity>
                {/* No Friends entry: RIVAL's social unit is the Team. A one-way
                    follow makes an audience, not a training partner — and the
                    thing that gets someone out the door is people who notice
                    when you don't. friends.tsx and the follows table are left
                    in place so this is one line to undo. */}
                <TouchableOpacity
                  style={[styles.avatarMenuItem, hoveredItem === 'settings' && styles.avatarMenuItemHovered]}
                  onPress={() => { setMenuOpen(false); router.push('/profile'); }}
                  {...(Platform.OS === 'web' ? { onMouseEnter: () => setHoveredItem('settings'), onMouseLeave: () => setHoveredItem(null) } as any : {})}
                >
                  <RivalIcon name="settings" size={16} color={RivalColors.accentText} />
                  <Text style={styles.avatarMenuText}>Settings</Text>
                </TouchableOpacity>
                <View style={styles.avatarMenuDivider} />
                <TouchableOpacity
                  style={[styles.avatarMenuItem, hoveredItem === 'signout' && styles.avatarMenuItemHovered]}
                  onPress={() => { setMenuOpen(false); handleSignOut(); }}
                  {...(Platform.OS === 'web' ? { onMouseEnter: () => setHoveredItem('signout'), onMouseLeave: () => setHoveredItem(null) } as any : {})}
                >
                  <RivalIcon name="logout" size={16} color={RivalColors.accentText} />
                  <Text style={styles.avatarMenuText}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
      {narrow && isFocused && (bottomNavPortalTarget ? createPortal(bottomNav, bottomNavPortalTarget) : bottomNav)}
      {narrow && isFocused && notifOpen && notifAnchor && <NotificationsMenu anchor={notifAnchor} onClose={() => setNotifOpen(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { width: '100%', backgroundColor: 'rgba(14,14,14,0.55)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', zIndex: 100 },
  // Mockup's mobile header is a warm pink-tinted gradient wash, not the
  // desktop bar's flat dark translucent fill — desktop keeps `bar` as-is.
  barNarrow: {
    backgroundColor: 'rgba(255,209,190,0.06)',
    borderBottomColor: 'rgba(255,209,190,0.12)',
    ...(Platform.OS === 'web'
      ? { backgroundImage: 'linear-gradient(180deg, rgba(255,209,190,0.10) 0%, rgba(255,209,190,0.03) 100%)' } as any
      : {}),
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 1200, marginHorizontal: 'auto', paddingHorizontal: 20, paddingVertical: 8, position: 'relative' },
  // Mockup's mobile header padding (14px 8px) is narrower than the desktop
  // bar built for a 1200px-wide row — desktop keeps its own spacing.
  rowNarrow: { paddingHorizontal: 8, paddingVertical: 9 },
  logo: { ...RivalType.titleMd, color: RivalColors.accentText, letterSpacing: 4, fontWeight: '800' },
  // Mockup's mobile wordmark uses the same tri-color gradient-text recipe as
  // the hero numbers/"Total time earned" value elsewhere — desktop's plain
  // flat accentText color is untouched, this only applies when narrow.
  logoNarrow: {
    fontSize: 17, letterSpacing: 3,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(100deg, #D97757 0%, #ffb59e 45%, #F5B759 100%)',
      backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent',
    } as any : {}),
  },
  links: { flexDirection: 'row', gap: 32 },
  // The logo (left) and RANK/bell/avatar cluster (right) aren't the same
  // width — RANK badge + notif button + avatar is much wider than "RIVAL" —
  // so `justifyContent: space-between` alone leaves these links biased
  // toward the shorter (left) side instead of sitting at the row's true
  // center. Pin them to the row's actual midpoint instead, independent of
  // sibling widths. Percentage transforms aren't supported on native, so
  // this is web-only; native keeps the old (slightly off-center) flow,
  // which is an acceptable fallback since this app runs primarily on web.
  linksCentered: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' },
  // Mobile-only slot for a screen-supplied center element (e.g. Today's
  // "Total time earned"). minWidth:0 lets its content shrink/truncate
  // instead of pushing the logo/right cluster apart.
  centerSlot: { flex: 1, alignItems: 'center', minWidth: 0 },
  // With centerSlot active, giving the logo and the (much wider) right
  // cluster equal flex turns the row into a symmetric 3-column split, so
  // centerSlot's alignItems:'center' lands on the row's true midpoint
  // instead of the midpoint of the leftover gap (which skewed toward the
  // narrower logo side, since the right cluster is visibly wider).
  logoWrapBalanced: { flex: 1 },
  rightBalanced: { flex: 1, justifyContent: 'flex-end' },
  // Floating bottom tab bar, mobile only (`narrow` breakpoint above) — replaces
  // the old in-flow links row so the primary nav sits within thumb reach
  // instead of up next to the logo. `position: 'fixed'` pins it to the
  // viewport regardless of where in the tree it renders (RivalTopNav itself
  // stays docked at the top), same trick used elsewhere in this app for
  // viewport-relative overlays. Flush with the true bottom edge (`bottom:
  // navBottomOffset`, set inline — 0 in a normal browser tab, but a live
  // measured offset on iOS standalone where the layout viewport can report
  // taller than what's actually visible) rather than floating above it.
  // The home-indicator clearance
  // lives on THIS outer wrapper (invisible, no chrome) rather than on the
  // visible pill below — giving it to the pill directly stretched its own
  // background/border down through that empty space, reading as a tall bar
  // with dead space inside it instead of a snug pill sitting above the clearance.
  bottomNavOuter: {
    position: 'fixed' as any,
    left: 0, right: 0,
    zIndex: 200,
    paddingHorizontal: 16,
    // No background of its own. An earlier attempt faded this strip to #131313
    // to stop scrolling content showing through the home-indicator clearance,
    // but that colour is Today's flat backdrop -- over the photographic
    // backgrounds on Activity and Team Feed it read as a dark shadow boxed in
    // around the pill. The clearance is now small enough (see paddingBottom
    // above) that content passing behind it is not distracting, and a floating
    // pill is supposed to float over the page, not sit on a slab.
  },

  bottomNav: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#1c1c1c',
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 4, paddingHorizontal: 6,
    // overflow:hidden clips backdropFilter to the border-radius — without it,
    // some browsers render the blur as an unclipped rectangle that bleeds
    // past the pill's rounded corners as a faint square halo. box-shadow is
    // unaffected (it paints outside the border box regardless of overflow).
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { backdropFilter: 'blur(20px)', transition: 'transform 0.22s ease, opacity 0.22s ease' } as any
      : {}),
  },
  // Instagram-style shrink while scrolling down — scales the whole pill down
  // and nudges it toward the bottom edge (transform-origin) so it reads as
  // settling out of the way, not just uniformly resizing in place.
  bottomNavShrunk: {
    transform: [{ scale: 0.8 }],
    ...(Platform.OS === 'web' ? { transformOrigin: 'center bottom' } as any : {}),
  },
  // A dot, not a count. The number would be the number of TEAMS with unread,
  // which reads as a message count and isn't one — and a count invites
  // clearing-for-its-own-sake, which is pressure this app deliberately avoids.
  // "Something's here" is the whole job.
  navBadge: {
    position: 'absolute', top: -3, right: -5,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: RivalColors.accentFill,
  },

  bottomNavItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 5, paddingHorizontal: 5, borderRadius: 16 },
  bottomNavItemActive: { backgroundColor: `${RivalColors.accentFill}22` },
  bottomNavItemShrunk: { paddingVertical: 8, gap: 0 },
  bottomNavLabel: { fontSize: 11, fontWeight: '600', color: RivalColors.textSecondary },
  bottomNavLabelActive: { color: RivalColors.accentText },
  bottomNavLabelShrunk: { opacity: 0, height: 0, lineHeight: 0, fontSize: 0 },
  // Smaller, more letter-spacing, lighter weight — quieter and closer to an
  // Apple-style minimal nav, without going all the way to "near-invisible"
  // (this is core navigation people tap constantly, not a utility bar).
  link: { ...RivalType.bodyMd, fontSize: 13, letterSpacing: 0.6, fontWeight: '400', color: RivalColors.textSecondary },
  linkActive: { color: RivalColors.textPrimary, fontWeight: '600' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Mobile only (current scope is mobile-only) — tighter than desktop's 12,
  // Ricky wanted the chat/bell icons sitting closer to the avatar.
  rightNarrow: { gap: 6 },
  rankBadge: { alignItems: 'flex-end' },
  rankLabel: { ...RivalType.labelCaps, fontSize: 9, color: RivalColors.textSecondary },
  rankValue: { fontSize: 14, fontWeight: '700' },
  notifBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  notifBtnNarrow: { width: 32, height: 32, borderRadius: 16 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // Mockup's mobile avatar is a plain filled circle, no ring border. Sized
  // 15% up from the mockup's literal 28px per Ricky's ask.
  avatarNarrow: { width: 36, height: 36, borderRadius: 18 },
  avatarImg: { width: 42, height: 42, borderRadius: 21 },
  avatarImgNarrow: { width: 36, height: 36, borderRadius: 18 },
  avatarInitial: { color: RivalColors.onAccentFill, fontWeight: '800', fontSize: 18 },
  avatarInitialNarrow: { fontSize: 14 },
  // Thin ring as a separate, slightly larger circle rather than a border ON
  // the avatar — a border on the avatar's own fixed-size box would paint
  // over the outer rim of the photo instead of framing it. At 45x45 with a
  // 1.5px border, the inner content box is exactly 42x42, so the avatar
  // photo sits fully inside, untouched.
  avatarRing: { width: 45, height: 45, borderRadius: 22.5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  // Mockup's mobile avatar has no ring at all — collapse the ring to exactly
  // the avatar's own size with no border, rather than restructuring the JSX.
  // Phones (Ricky, 2026-10-03, option B): a 36px picture in a thin ring.
  avatarRingNarrow: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)' },
  // Wraps the ring+avatar + its dropdown so the menu can be absolutely
  // positioned relative to just the avatar, not the whole nav row. zIndex
  // so the menu paints above the rank badge / page content instead of
  // behind it.
  // Sits on the bell rather than beside it, so the header's spacing does not
  // shift the moment something arrives.
  notifDot: {
    position: 'absolute', top: -2, right: -4, minWidth: 16, height: 16, borderRadius: 8,
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RivalColors.accentFill,
  },
  notifDotText: { fontSize: 9.5, fontWeight: '800', color: '#2a1410' },
  avatarWrap: { position: 'relative', zIndex: 100 },
  // top/right land the menu exactly at the bar's own bottom-right corner:
  // 53 = ring height (45) + row's bottom padding (8), and -20 cancels
  // row's horizontal padding — both measured from `row`'s style below.
  // That makes the menu flush with the bar's bottom edge and the screen's
  // right edge instead of just the avatar's edges. Same translucent tone
  // as `bar` (not a near-opaque slab) and no top border, so it genuinely
  // reads as the nav bar's own surface continuing downward — backdropFilter
  // blur keeps text legible over whatever hero photo is behind it, same
  // trick `bar` doesn't need (it sits over a much smaller, more uniform
  // strip of the photo) but this taller panel does. Only the bottom
  // corners are rounded. scaleY + transformOrigin 'top' (set in the inline
  // style above) makes it unfurl from the bar instead of popping in.
  avatarMenu: {
    position: 'absolute', top: 53, right: -20, minWidth: 220,
    backgroundColor: 'rgba(14,14,14,0.55)',
    borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
    borderWidth: 1, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.06)',
    paddingTop: 14, paddingBottom: 8, gap: 4,
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(20px)',
      boxShadow: '0 10px 20px rgba(0,0,0,0.35)',
      transformOrigin: 'top',
    } as any : {}),
  },
  // Fills the row's bottom-padding strip (avatar bottom → bar bottom) that
  // avatarMenu's top offset opens up, so hovering down through it stays
  // on an avatarWrap descendant the whole way — see the bridge comment above.
  avatarMenuBridge: { position: 'absolute', top: 45, height: 8, right: -20, width: 220 },
  // Name + rank block at the top of the menu, matching the reference
  // mockup's header row — same avatar image, just bigger, plus rank tier
  // underneath the name so the dropdown reads as "who's signed in", not
  // just a bare list of actions.
  avatarMenuHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  avatarMenuHeaderAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarMenuHeaderImg: { width: 38, height: 38, borderRadius: 19 },
  avatarMenuHeaderName: { ...RivalType.bodyMd, fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  avatarMenuHeaderRank: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.accentText, fontStyle: 'italic', marginTop: 2 },
  avatarMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  // Same "pop" recipe as the home dashboard's gridCardHovered — scale +
  // lifted shadow — plus a background tint since these rows have no card
  // outline of their own to pop against.
  avatarMenuItemHovered: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    transform: [{ scale: 1.03 }],
    ...(Platform.OS === 'web' ? { boxShadow: '0 6px 16px rgba(0,0,0,0.3)' } as any : {}),
  },
  avatarMenuText: { ...RivalType.bodyMd, fontSize: 14, color: RivalColors.textPrimary },
  avatarMenuDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 6 },
});
