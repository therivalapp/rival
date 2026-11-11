# RIVAL — agent guide

RIVAL is a social fitness app: friends form **Teams**, log workouts (manual entry, photo scan via AI, or Strava sync), earn **Effort** points, and compete on weekly leaderboards. React Native + **Expo (SDK 56)** running primarily on WEB via react-native-web, deployed on Vercel. Backend is Supabase (Postgres + Auth + Storage + Deno edge functions), project ref `dgauxvrvqnkbfvarexok`.

**Expo HAS CHANGED** — read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing Expo-API code.

## Layout

- `src/app/*.tsx` — one file per screen, Expo Router file-based routes. `league.tsx` is the Team hub (feed/chat/sessions/challenges/standings).
- `src/lib/` — shared logic: `xp.ts` (level math), `streak.ts`, `season.ts`, `identity.ts` (display-name styles), `dateFormat.ts` (YYYY-MM-DD typed input ↔ ISO), `achievements.ts`, `supabase.ts` (client).
- `supabase/functions/` — Deno edge functions. `_shared/` holds cross-function modules (`activityDedup.ts`, `formatName.ts`).
- `supabase/*.sql` — schema/RLS migrations as standalone files. **Always write the .sql file first and show Ricky what it does** — it's the reviewable artifact. He may then either run it himself in the dashboard, or tell you to apply it (see "Applying migrations" below). Either way, verify it landed afterwards.

## Commands

- Dev server: use the preview tools / `.claude/launch.json` (`rival-web`, port 8081). Start it proactively at session start.
- Type check: `npx tsc --noEmit` from `rival/`.
- Tests: `npm test` from `rival/` (vitest, forced to `TZ=Pacific/Auckland` — the streak suite contains NZ DST regression tests that only bite in that zone). Pure-logic libs (`streak`, `dateFormat`, `effort`, `xp`, `season`) are covered in `src/lib/__tests__/` — run this after touching any of them. The effort tests mirror the server formula in `supabase/functions/_shared/effortScore.ts`; if the formula changes, change BOTH and the test.
- **Live DB introspection**: `supabase db query "<SQL>" --linked` from `rival/`. Use this freely for reads — check schema, `pg_policies`, `pg_proc` etc. yourself instead of asking Ricky to paste query output.
- **Applying migrations**: writes through `supabase db query` are allowed **only when Ricky approves that specific migration in the session**. Never apply one off your own judgement. When he does approve:
  1. Show him the `.sql` first — he's approving a reviewed change, not a blank cheque.
  2. Dry-run it as a `select` and show the projected effect before writing (a row count, a before/after total — something he can sanity-check).
  3. Snapshot anything you're about to overwrite to the scratchpad, so there's a rollback path.
  4. Run it in steps (schema, then data), verifying each. Apply a `.sql` file with
     `supabase db query --linked -f <file>` — passing its contents as a positional
     argument fails, because a leading `--` comment line parses as a CLI flag.
  5. Verify the result matches the dry-run prediction, and say so.
  Approval covers the migration he approved — not the next one.
- **iPhone app: instant updates (EAS Update), set up 2026-11-11.** Changes to JS/TS code, copy and images reach installed TestFlight builds without a new build: `set -a && . ./.env.local && set +a && npx eas-cli update --channel production --environment production --platform ios --message "<what changed>" --non-interactive` from `rival/` (Expo has no env variables of its own, so the bundle takes `EXPO_PUBLIC_*` from `.env.local`; check the bundle in `dist/` contains the Supabase URL; the app picks the update up on its next open). A new build (`npx eas-cli build -p ios --profile production --auto-submit`) is still needed for native changes: a new native package, a permission or Info.plist text, an entitlement, app icon, or any `app.json` plugin change. `runtimeVersion` follows the app version (`policy: appVersion`), so **bump `version` in app.json with every native change**, or an update could reach a build that lacks the native code it needs. Ask Ricky before publishing an update; it goes straight to testers' phones.
- Deploy an edge function: `supabase functions deploy <name> --project-ref dgauxvrvqnkbfvarexok`. The deploy bundler is the real Deno type-check (local `tsc` can't resolve Deno URL imports). Code changes in `supabase/functions/` do nothing until deployed.

## Database rules (hard-won — do not relearn these in production)

- **RLS is permissive (policies OR together).** One overly-broad policy silently undermines every scoped one. After any policy change, re-verify with `select * from pg_policies where tablename='...'` via `supabase db query --linked`.
- SECURITY DEFINER helpers: `is_league_member(lid)` (checks `status='active'`), `is_league_admin(lid)`, `lookup_league_by_invite_code(code)` (invite lookup without exposing the leagues table — the client must use this RPC, not select on `leagues`).
- `league_members.status` is `'pending' | 'active'` (public-team join requests). **Every** membership-scoped query — client AND edge functions — must filter `.eq('status', 'active')` unless it is explicitly about pending requests.
- External-activity uniqueness is **per-user**: `unique (user_id, provider, provider_activity_id)` on both `activities` and `activity_sources`. Never add a global unique constraint on an external-ID column (one Strava account can legitimately touch two RIVAL profiles over time).
- **Never add a second foreign key between two tables that the client embeds.** A second link from `league_members` to `users` made every `users(...)` embed fail with PGRST201, and browsers cached the 300 response after the fix. Use a plain column, or name the link in every embed.
- **Activity importer rule**: any importer (Strava today; Garmin/HealthKit later) must call `resolveCanonicalActivityId()` before insert and `linkNewActivitySource()` after, from `_shared/activityDedup.ts` — never a bespoke upsert keyed on provider ID. Pass the provenance payload (`external_id`, `upload_id`) so cross-source matching can be deterministic later.

## Client-code footguns

- **Always check `.error` (and `count` on deletes) from every Supabase write** before treating it as done or navigating away. RLS failures are silent no-ops (0 rows, no error thrown) — this has caused real shipped bugs (leave-team, kick-member).
- **`RefreshControl` does nothing at all on web** — react-native-web renders it as a plain View and drops `onRefresh`, so pull-to-refresh never fires. Use `usePullToRefresh` from `src/components/rival/usePullToRefresh.tsx`, which implements the gesture against the scrolling element.
- **`Alert.alert` does nothing at all on web** — react-native-web ships it as an empty function (`static alert() {}`), so EVERY call is silently discarded, not just ones with buttons. Never call it directly. Use `notify()` from `src/lib/notify.ts` (web → `window.alert`, native → the real Alert) for messages, `window.confirm` for confirmations, and inline error text (state + styled Text) where the error belongs next to the control. This has bitten silently before: four error paths in league-settings (approve/decline//remove member/change role) reported failures into the void.
- **CSS animations on web: keyframes in `src/global.css`, `animationName` as an INLINE style.** react-native-web drops inline `animationKeyframes` objects, and its dev validation deletes `animationName` from anything inside `StyleSheet.create` (logging "Invalid style property of animationName"). Gate it on `Platform.OS === 'web'` and pass it inline, like `podiumRise()` in `home.tsx`.
- **In-memory caches clear themselves on writes.** `lib/fetchAllActivities.ts` (whole activity history, shared by Home/Activity/Goals/Stats/year/achievements) and `lib/myTeams.ts` (the signed-in person's teams) are kept for a minute. `lib/supabase.ts` wraps `supabase.from(...).insert/update/upsert/delete` on `activities`, `activity_media`, `activity_participants`, `league_members` and `leagues`, plus every `rpc`, to clear them. Writes done server-side (edge functions such as Strava sync) must call `invalidateActivityCache()` afterwards. Screens remember their last data between visits with `useSnapState` (`lib/snapState.ts`), cleared when the account changes.
- **Personal settings live in auth user metadata**, not a table: `lib/prefs.ts` (units, daily quote, notification switches, muted teams). Display units go through `lib/units.ts`; data is always stored metric.
- **The four bottom-nav screens are real tabs** in `src/app/(tabs)/` (home, my-activities, team-feed, messages), kept mounted once opened. Go to them with `goToTab('/home')` from `src/lib/tabNav.ts`, never `router.push`/`replace` — from a stacked page those open a second copy of the whole tab set. (Sign-in/welcome flows still `router.replace('/home')` on purpose, to clear history.)
- **PostgREST embedded-resource filters** (`.select('x, parent!inner(y)').eq('parent.y', …)`) can silently fail to filter. Use two plain sequential queries instead.
- Dates are **typed** as `YYYY-MM-DD` (Canada's standard, and unambiguous where DD/MM and MM/DD disagree); convert with `src/lib/dateFormat.ts` helpers at input boundaries, store ISO `YYYY-MM-DD`. Dates are **displayed** with `toLocaleDateString(undefined, …)` so each user sees their own device's format — never hardcode a locale. Ricky is in Canada; the test suite still pins `TZ=Pacific/Auckland` for the NZ DST streak regressions.
- **Times: one way, everywhere (`src/lib/time.ts`).** Every typed time is the time box: spread `timeFieldProps('hms' | 'ms', value, setValue)` onto the text box (number pad, filled like a stopwatch, shows every unit as you type: `00:01:53` vs `01:53:00`). Read times only with `parseTime` (two parts: `'hours'` for saved finish/goal times, `'minutes'` for paces, splits and scans) and show them only with `formatTime` / `showFinish` (finish and goal times always with hours, "1:53:00"). Never write a new time parser, mask or formatter, and never a free-text time box (Ricky, 2026-11-05: "1:53" read as minutes on one screen and hours on another). Separate labelled min/sec boxes and steppers are fine.
- Week boundaries are **Monday-start** (`streak.ts` has the canonical helper).

## Product vocabulary (copy-only renames — internals unchanged)

User-facing copy says **Team, Effort, Respect, Inspired, Impact, Unrivaled**. The code/DB deliberately still says `leagues`, `league_members`, `xp`, `effort_score`, route paths `/league`, `/create-league`, etc. **Never rename DB columns, internal identifiers, or route paths to match display copy** — display strings only. Reactions are stored as the strings `'respect'` and `'inspired'` (old emoji rows were migrated to `'respect'`); only `'inspired'` feeds the Impact stat.

**Activity first: think twice before "session" or "workout".** "Activity"/"activities" covers everything (a run, a lift, a class). Before writing session, workout or training in any copy, mockup, quote or chat text, use activity instead; keep another word only when activity genuinely does not make sense in that sentence (Ricky, 2026-11-11). Internal names (`gym_sessions`, `team_sessions`, `add-workout.tsx`) stay.

**Elevation, never climb.** Height gained is always "Elevation" in user-facing copy: labels, tiles, sentences, mockups ("212 m elevation", not "Climb" or "m climbed"). Code names like `climb` stay. Exercise names (Rope climb, Mountain climber) and the Climbing sport are not affected (Ricky, 2026-11-04).

Voice: always encourage, never pressure or shame. Streaks are pure consistency info — no bonus/penalty language. Gate new copy against the brand-voice bible (in Claude's memory: "RIVAL Brand Voice" / "Daily Perspectives").

**Professional tone — every screen, including every new page.** Titles, labels and buttons are
plain noun/verb phrases with no "your"/"my" ("Scan workout", "Manual entry", "Take photo").
Descriptions are short factual sentences ("Details are extracted automatically."). No slang or
cute phrasing ("snap it", "in one go", "catch up", "fastest"), no exclamation marks, no emoji.
Errors say what happened and what to do. Encouragement stays but is understated. Run the
`brand-check` skill on new copy — the full rules live there.

## Design parameters (read before building any screen)

RIVAL must look like one app. The current look is the Add an activity pop-up (`src/app/add-workout.tsx` phone branch); match it. **Anything that isn't in here or already in the app gets mocked first and approved by Ricky before it is built.** New ideas are welcome, as mockups.

- **Check first:** find what the app already uses for that thing (colour, tile, card, label) and reuse it. Never pick a colour or draw a component for one page.
- **Ground:** the pop-up's neutral grey, #282828 on phones (`RivalGhost.ground`, `RivalColors.pageGround`; set in `global.css` so desktop keeps its colours), pop-ups on `GreySheet`, pages on `GreyPageHead`/`GREY_PAGE_BG`. Never brown pages or cards (#110e0c, #1d1714 and similar are the retired look), never near-black (#0e0e0e) cards, never see-through black pop-ups. Exception: the main pages (Today, Activity, Team feed, Chat, Profile) keep their original dark look; Activity and Profile use #1b1a19 on phones; the team hub has the black #131313 ground with its grey cards. Top bar is Today's colour everywhere; bottom bar stays #1c1c1c.
- **Top glow:** one main card per page and the top of pop-ups only (`RivalMainGlow`, `rb.hero`). Other cards are plain. The glow behind numbers is a different effect and stays banned.
- **Cards and fields:** ghost style, `RivalGhost.fill` with `RivalGhost.border`.
- **Tiles:** a big faint icon behind the words, as part of the tile's background, words bottom left: `GreyArtTiles` / `TileArt`. The chosen or primary tile is lit with the peach button gradient. No round icon badges in new tiles.
- **Type:** serif italic (Georgia, `RivalSerifFamily`) for titles and big numbers, small spaced caps for labels, professional copy (the tone rules above).
- **Colour:** coral/peach accents from `rivalTheme.ts`. One gradient pill per screen, the main action. Personal bests use `RivalColors.rankAnchors.unrivaled`, never a new gold, never coral. Events use `RivalColors.event`. **No red on results or data**: the deep coral #D97757 (`accentFill`) reads as red, so it is only for the button gradient and filled buttons, never for times, bars, ranks, day markers or labels; data steps ivory (`RivalColors.event`) → light peach #ffd2bf → salmon #ffb59e (`accentText`). `danger` red is only for delete and errors (Ricky, 2026-11-04).
- **Icons:** `RivalIcon` only. No emoji, no halos or light sweeps. No X on phone pop-ups: tap outside or drag down.
- **Photos:** `assets/images/backgrounds/optimized` only on designed pages, and sparingly. One photo moment per flow; never put text on a face.
- **Pages:** no empty dark space, no plain default lists. Design empty and in-between states too.
- **Phones first:** visual changes don't touch desktop during the mobile-only phase.
- **Mockups:** use the real layout from the code, render at 2x with headless Chrome, and check them before sending. Builds then match the mockup exactly.
- **Checking a page:** compare it to Add an activity on screen before calling it finished.
- **Before sending any mockup, check it against this list** (Ricky, 2026-11-05; he was fixing the same small things on every mockup):
  - **Words:** the fewest that still read clearly, per "Fewest words" in the brand-check skill. Buttons are the verb alone when the pop-up names the thing ("Save", not "Save finish time"). Data lines are label then value ("Leg total 3:08:46", "Transitions 5:34"), no "add up to", "took" or similar. Helper notes are one sentence and only when needed; no reassurance, no feature callouts.
  - **Icons only where they carry meaning.** Text buttons, links and helper notes have no icon (no stopwatch on "Add official finish time", no icon before a one-line note). Icons stay on tiles, on Share, and on list rows only where they tell the rows apart (Swim, Bike, Run); a lone row such as Finish time has none.
  - **Edit is the word "Edit"** (or "Edit times", "Edit event details"), in accent text. No pencil icons.
  - **Page edits live in the three-dot menu, top right** (`moreHoriz` in a 32px dark circle, as on an activity). No full-width "Edit details" buttons on a page.
  - **Cards open their page.** Tapping anywhere on a card opens its detail page, and every edit for that thing lives there. Cards don't carry their own edit controls.
  - **Share on a card is a solid salmon (#ffb59e) button** with dark text. The gradient stays for the one main action on a page or pop-up.
  - **Run brand-check on every string** in the mockup before rendering, then read the render once more for anything that could be shorter.

## Verification limits

Authenticated flows (RLS behavior under a real session, OAuth callbacks) cannot be fully verified without Ricky's credentials — verify what you can (DB introspection, type checks, preview logs/screenshots, deploy success) and say plainly what still needs a human check.
