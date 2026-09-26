import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Animated, Easing, ImageBackground, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { getDailyQuote, type Quote, type QuoteTone } from '../../lib/quotes';
import { getPrefs } from '../../lib/prefs';
import { getDailyBackground } from '../../lib/dailyBackground';
import { RivalColors, RivalFontFamily, RivalSerifFamily } from '../../constants/rivalTheme';

// The daily quote, shown once a day the first time a signed-in person opens
// the app. It sits over the whole app rather than being its own screen, so the
// page underneath (Home, normally) mounts and loads its data while the quote is
// up — when it fades away after a few seconds, the page is already filled in.
// A tap anywhere skips it.
//
// This screen was deleted by accident on 2026-07-26 inside a large unrelated
// commit and nothing replaced it, which also left the Profile "Daily quote
// tone" setting saving a choice that nothing read. It reads that setting again.

const SEEN_KEY = 'rival_quote_date';
const HOLD_MS = 5000;
const FADE_IN_MS = 500;
const FADE_OUT_MS = 700;

// Pages the quote must never cover: mid-way through signing in, resetting a
// password, or finishing the Strava connection.
const SKIP_PATHS = ['/reset-password', '/strava-callback', '/sign-in', '/sign-up', '/getting-started'];

const CATEGORY_LABELS: Record<string, string> = {
  levelup: 'Level up',
  unrivaled: 'Unrivaled',
  progress: 'Progress',
  longterm: 'The long game',
  consistency: 'Consistency',
  identity: 'Identity',
  recovery: 'Recovery',
  nutrition: 'Fuel',
  community: 'Community',
  competition: 'Competition',
  wisdom: 'Perspective',
};

// The device's own calendar day, so the quote changes at local midnight.
function localDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function seenToday(): boolean {
  try { return globalThis.localStorage?.getItem(SEEN_KEY) === localDayKey(); } catch { return false; }
}

function markSeen() {
  try { globalThis.localStorage?.setItem(SEEN_KEY, localDayKey()); } catch {}
}

function prefersReducedMotion(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function DailyQuoteSplash() {
  const [quote, setQuote] = useState<Quote | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const checked = useRef(false);

  function close() {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(opacity, {
      toValue: 0,
      duration: prefersReducedMotion() ? 0 : FADE_OUT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => setQuote(null));
  }

  useEffect(() => {
    async function maybeShow(userId: string) {
      if (checked.current) return;
      checked.current = true;
      if (seenToday()) return;
      // Switched off in Profile → Preferences.
      if (!getPrefs().dailyQuote) return;
      const path = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.pathname : '';
      if (SKIP_PATHS.some((p) => path.startsWith(p))) { checked.current = false; return; }

      // The tone setting from Profile. Capped at a short wait so a slow
      // network never holds the quote back; the default tone is fine then.
      let tone: QuoteTone | undefined;
      try {
        const res: any = await Promise.race([
          supabase.from('users').select('quote_tone').eq('id', userId).maybeSingle(),
          new Promise((resolve) => setTimeout(() => resolve(null), 800)),
        ]);
        tone = (res?.data?.quote_tone as QuoteTone | undefined) || undefined;
      } catch {}

      markSeen();
      setQuote(getDailyQuote(tone));
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) maybeShow(session.user.id);
    });
    // Signing in later in the same visit counts as opening the app too.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Let the sign-in screen hand over to Home first, so the quote is
        // never shown on top of the form it just submitted.
        setTimeout(() => maybeShow(session.user.id), 400);
      }
      if (event === 'SIGNED_OUT') checked.current = false;
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!quote) return;
    closing.current = false;
    const reduced = prefersReducedMotion();
    opacity.setValue(reduced ? 1 : 0);
    progress.setValue(0);
    if (!reduced) {
      Animated.timing(opacity, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: Platform.OS !== 'web' }).start();
    }
    // The hairline along the bottom fills over the hold time — the timer made
    // visible, in place of a button to press.
    Animated.timing(progress, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false }).start();
    const t = setTimeout(close, HOLD_MS);
    return () => clearTimeout(t);
  }, [quote]);

  if (!quote) return null;

  const newYearsDay = new Date().getMonth() === 0 && new Date().getDate() === 1;
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const splash = (
    <Animated.View style={[styles.overlay, { opacity }]} accessibilityViewIsModal>
      <ImageBackground source={getDailyBackground()} style={styles.bg} resizeMode="cover">
        <View style={styles.scrim} />
        <Pressable style={styles.inner} onPress={close} accessibilityRole="button" accessibilityLabel="Continue to RIVAL">
          <Text style={styles.logo}>RIVAL</Text>

          <View style={styles.quoteBlock}>
            <View style={styles.categoryRow}>
              <View style={[styles.rule, styles.ruleLeft]} />
              <Text style={styles.category}>
                {/* New Year's Day opens the new year instead of the category. */}
                {newYearsDay ? `${new Date().getFullYear()} begins` : CATEGORY_LABELS[quote.category] ?? 'Perspective'}
              </Text>
              <View style={[styles.rule, styles.ruleRight]} />
            </View>
            <Text style={styles.quoteText}>{quote.text}</Text>
            {quote.author ? <Text style={styles.author}>{quote.author}</Text> : null}
            <Text style={styles.date}>{dateLabel}</Text>
          </View>

          <View style={styles.timerTrack}>
            <Animated.View
              style={[styles.timerFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
            />
          </View>
        </Pressable>
      </ImageBackground>
    </Animated.View>
  );

  // On web the floating nav pill is portaled to <body>, which puts it above
  // anything inside the app's own root. Portal the quote there too so it
  // covers the nav rather than sitting underneath it.
  if (Platform.OS === 'web' && typeof document !== 'undefined') return createPortal(splash, document.body);
  return splash;
}

const styles = StyleSheet.create({
  // Fixed, over everything including the floating nav pill.
  overlay: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#110e0c',
    zIndex: 10000,
  },
  bg: { flex: 1, width: '100%', height: '100%' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,14,12,0.62)' },
  inner: {
    flex: 1, alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 32, paddingTop: 72, paddingBottom: 56,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  logo: { fontFamily: RivalFontFamily, fontSize: 16, fontWeight: '700', letterSpacing: 8, color: '#fff' },
  quoteBlock: { alignItems: 'center', maxWidth: 460 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  category: {
    fontFamily: RivalFontFamily, fontSize: 11, fontWeight: '800', letterSpacing: 2.5,
    textTransform: 'uppercase', color: 'rgba(255,181,158,0.85)',
  },
  rule: { width: 32, height: 1 },
  ruleLeft: Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,181,158,0) 0%, rgba(255,181,158,0.55) 100%)' } as any)
    : { backgroundColor: 'rgba(255,181,158,0.35)' },
  ruleRight: Platform.OS === 'web'
    ? ({ backgroundImage: 'linear-gradient(90deg, rgba(255,181,158,0.55) 0%, rgba(255,181,158,0) 100%)' } as any)
    : { backgroundColor: 'rgba(255,181,158,0.35)' },
  quoteText: {
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '700',
    fontSize: 28, lineHeight: 37, color: '#fff', textAlign: 'center', marginTop: 18,
  },
  author: { fontFamily: RivalFontFamily, fontSize: 14, color: 'rgba(255,255,255,0.65)', marginTop: 12 },
  date: { fontFamily: RivalFontFamily, fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 18 },
  timerTrack: { alignSelf: 'center', width: 180, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden', alignItems: 'flex-start' },
  timerFill: { height: 2, borderRadius: 1, backgroundColor: RivalColors.accentText },
});
