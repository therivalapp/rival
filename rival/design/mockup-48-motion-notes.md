# Mockup 48 · Motion — build notes

Previews (open in a browser; they loop): `mockup-48-motion-opening.html`, `-loading.html`, `-moments.html`, `-list.html`.
Stills at 2x (key frames, time under each): `mockup-48-motion-{opening,loading}-{A,B,C}.png`, `mockup-48-motion-moments-{A,B,C,D}.png`, `mockup-48-motion-list.png`.
GIFs of each option: the same names with `.gif`.
Add `?t=3.4` to any preview's address to freeze it at 3.4 s.

Nothing in the app was changed. Layouts are copied from the code (RivalTopNav phone bar and bottom bar, Today's Weekly leader and This week cards, DailyQuoteSplash, GreySheet), with sample data. They were not checked against a signed-in screen, because the QA sign-in wipes the QA account's activities.

## The engine: Reanimated, already installed

- `react-native-reanimated` 4.3.1 and `react-native-worklets` 0.8.3 are in `package.json`, but no screen uses them yet. All of this can be built without a new iPhone build. It ships as an instant update.
- Lottie is not installed and isn't needed.
- Most motion in the app today is web-only CSS (podium rise, Respect spin, sheet rise, row-in). The iPhone app shows none of it. Reanimated runs the same code on both.
- Reanimated 4 takes CSS-style keyframes (`animationName: { from, to }`, `animationDuration`, `animationTimingFunction`) on `Animated.View`/`Animated.Text`, on iPhone and on the web. The timings in these previews can be copied across directly.
- Number motion runs on the UI thread through shared values (`useSharedValue`, `withTiming`, `withSpring`), so a busy screen never makes it stutter. Today's `CountUpText` re-renders React on every frame on the iPhone.
- Reduce Motion: `useReducedMotion()` from Reanimated. When it is on, everything jumps to its final state.
- Shared easing (put it in `rivalTheme.ts` as `RivalMotion`): out `Easing.bezier(.22,.8,.24,1)`, in-out `(.65,0,.35,1)`, settle `(.22,1,.36,1)`, press spring `{ damping: 14, stiffness: 260 }`.
- Optional, needs a native build: `expo-haptics` for a light tap on Save, Respect and a new personal best. It isn't installed. Adding it means a new build and a version bump in `app.json`.

## Opening (Mockup 48 · Opening) — recommend A

- **iPhone:** the native splash stays exactly as it is: plain `#131313` from `app.json`, so no new build. In `_layout.tsx`, `SplashScreen.preventAutoHideAsync()`, then draw a full-screen `#131313` boot view with the wordmark (`rivalWordmark(30)`, `#ffb59e`). Call `SplashScreen.hideAsync()` once it has drawn. The colours match, so the switch can't be seen.
- **A · Settle:** letter-spacing 0.55em → 0.2em with opacity 0 → 1 over 0.8 s. The 72 px hairline under the wordmark grows and shrinks from the centre while Today loads (`scaleX` loop). It fills once `revealApp()` fires. The wordmark then moves into the top-bar wordmark's place (measure it with `measureInWindow`, then translate and scale over 0.6 s). It hands over to the real top-bar wordmark on the last frame. Today's cards rise 18 px and fade in, 120 ms apart. The bottom bar rises 26 px. The podium and count-ups then play as they do now.
- **Web:** the same boot element as `#rival-boot` in `+html.tsx`. The pulse is replaced by the tighten and the hairline. `appReveal.ts` keeps its job of saying when Today is ready.
- **B · Quote first** is the once-a-day path. It is A's wordmark, which then rises to `DailyQuoteSplash`'s logo spot instead of the top bar. The photo fades in, the category rules draw outward, the three quote lines rise 10 px each, 170 ms apart, then the timer runs. The preview's hold is shortened from the real 7 s. It suits A or C.
- **C · Letters:** each letter sits in its own clipping box (`overflow: hidden`) and rises from `translateY(105%)`, 70 ms apart. Five 2×10 px ticks light ivory → peach in turn. Today's numbers use the rolling digits below.
- Cap the whole sequence: if Today is ready in under 1.2 s, the hairline fills straight away. Nobody waits on the animation.

## Loading (Mockup 48 · Loading) — recommend B

- The skeleton blocks in `home.tsx` keep their places. **B:** each block's pulse starts 70 ms after the one above, so it reads top to bottom. When data lands, each section swaps in, in the same order: the skeleton fades out over 300 ms and the card rises 10 px, 120 ms apart. **C:** the blocks hold still and the opening's hairline runs under the top bar. That hairline is also the pull-to-refresh indicator.

## Moments (Mockup 48 · Moments)

- **A · Save an activity:** Save scales to 0.96 on press and springs back. The label crossfades to "Saving…" and pulses, as `BusyText` does. On success the sheet drops: `translateY` to off screen, 350 ms, ease-in. The new row comes in with Reanimated `entering={FadeInLeft}` plus `layout={LinearTransition}`, so the rows below move down instead of jumping. Effort and the activity count roll to their new totals. "+19" fades in beside Effort, holds, then fades out. With `backToOrigin()` the save already returns to the page it started from, so the motion plays there.
- **B · Personal best:** goes into `CelebrationScreen.tsx` in place of its count-up. The old best rolls back to the new one (digit columns, 120 ms apart from the left). The colour moves ivory (`RivalColors.event`) → PB gold (`rankAnchors.unrivaled`). The "Personal best" caps settle from wide spacing, a 1 px gold rule draws from the centre, then "Previous 21:48" / "Improvement 0:36" and the salmon Share button rise. The confetti stays as it is, unless you want it out.
- **C · Respect:** `RespectStar.tsx` gets a press scale of 0.82, then a spring to 1.18 and back to 1, with the outline crossfading to the filled salmon star. No spin, rays or brightness flash. The count rolls 3 → 4. Your picture joins the stack with `entering={FadeInRight}`. Taking Respect back runs it in reverse, with no spring.
- **D · Tab change:** one highlight `View` behind the four tabs, with `translateX` set to the tab slot (`withSpring`, damping 18). It replaces each tab's own `bottomNavItemActive` background. Icon and label colours crossfade over 250 ms. The tabs stay mounted (they already are). The incoming page fades in and moves 16 px in the direction of travel over 350 ms. Native-stack screens are untouched.

## Rolling digits (More motion A, Moments A and B)

Ricky, 2026-11-13: every count in the app uses rolling digits, except the import. `HistoryReveal.tsx` (via `CountUp.tsx`), shown while past activities import, keeps its count up from zero.


One component, `RollingNumber`, replaces `CountUpText` and other count-ups. `CountUp.tsx` stays for the import. The podium's `PodiumCount` is left alone. Each digit is a clipped column of 0–9, `translateY = -digit × rowHeight` with `withTiming(600–1400 ms, settle easing)`, the left digits starting first. Separators (`:`, `,`, `.`) don't move. Give rows 1.15× the font size, because Georgia's figures are old-style and 4, 7 and 9 drop below the line. The number keeps its width while it rolls, which fixes the sideways shuffle `CountUpText` works around today.

## Existing glows: leave them

Ricky kept the podium sheen, halo and sparkle glows on purpose (2026-11-13), and the podium is being redesigned in its own session. This motion work doesn't touch the Weekly Leader podium in `home.tsx` (item 9 is dropped). The RespectStar shine and InspiredBolt flash also stay unless Ricky asks for them to go.

## Final picks (Ricky, 2026-11-13)

- Opening: v2 B, Tighten and pulse (`mockup-48-motion-opening-v2.html`). RIVAL tightens as it fades in, pulses while loading (no hairline), then moves into the top bar as Today rises in.
- Loading: B, In order.
- Moments: A Save an activity, B Personal best, D Tab change. Respect stays exactly as it is now (C dropped, no avatars).
- More motion (`mockup-48-motion-more.html`): A Rolling numbers, B Pull to refresh, C Pop-ups, D Rank up, E Focus ring. Rolling digits everywhere except the import, which keeps its count up from zero.
- Mockup 49 (`mockup-49-motion.html`): A Page slide (~350 ms, back reverses it), B Chat message (rises out of the composer, replies slide in from the left), C Team Challenge ring (each member's share draws in turn with their picture, the total rolls, plays only when the team has made progress since the last visit). Merge team-hub.tsx `ChallengeRing` and `RivalChallengeRing` into one component.
- Left alone: the Weekly Leader podium (its own session), Respect, the Inspired bolt, the personal-best confetti.
- Rule: big motion for earned moments, played once; everyday motion under ~350 ms; one shared set of speeds and curves; respect Reduce Motion.
