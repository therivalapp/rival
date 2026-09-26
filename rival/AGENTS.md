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
- Deploy an edge function: `supabase functions deploy <name> --project-ref dgauxvrvqnkbfvarexok`. The deploy bundler is the real Deno type-check (local `tsc` can't resolve Deno URL imports). Code changes in `supabase/functions/` do nothing until deployed.

## Database rules (hard-won — do not relearn these in production)

- **RLS is permissive (policies OR together).** One overly-broad policy silently undermines every scoped one. After any policy change, re-verify with `select * from pg_policies where tablename='...'` via `supabase db query --linked`.
- SECURITY DEFINER helpers: `is_league_member(lid)` (checks `status='active'`), `is_league_admin(lid)`, `lookup_league_by_invite_code(code)` (invite lookup without exposing the leagues table — the client must use this RPC, not select on `leagues`).
- `league_members.status` is `'pending' | 'active'` (public-team join requests). **Every** membership-scoped query — client AND edge functions — must filter `.eq('status', 'active')` unless it is explicitly about pending requests.
- External-activity uniqueness is **per-user**: `unique (user_id, provider, provider_activity_id)` on both `activities` and `activity_sources`. Never add a global unique constraint on an external-ID column (one Strava account can legitimately touch two RIVAL profiles over time).
- **Activity importer rule**: any importer (Strava today; Garmin/HealthKit later) must call `resolveCanonicalActivityId()` before insert and `linkNewActivitySource()` after, from `_shared/activityDedup.ts` — never a bespoke upsert keyed on provider ID. Pass the provenance payload (`external_id`, `upload_id`) so cross-source matching can be deterministic later.

## Client-code footguns

- **Always check `.error` (and `count` on deletes) from every Supabase write** before treating it as done or navigating away. RLS failures are silent no-ops (0 rows, no error thrown) — this has caused real shipped bugs (leave-team, kick-member).
- **`RefreshControl` does nothing at all on web** — react-native-web renders it as a plain View and drops `onRefresh`, so pull-to-refresh never fires. Use `usePullToRefresh` from `src/components/rival/usePullToRefresh.tsx`, which implements the gesture against the scrolling element.
- **`Alert.alert` does nothing at all on web** — react-native-web ships it as an empty function (`static alert() {}`), so EVERY call is silently discarded, not just ones with buttons. Never call it directly. Use `notify()` from `src/lib/notify.ts` (web → `window.alert`, native → the real Alert) for messages, `window.confirm` for confirmations, and inline error text (state + styled Text) where the error belongs next to the control. This has bitten silently before: four error paths in league-settings (approve/decline//remove member/change role) reported failures into the void.
- **CSS animations on web: keyframes in `src/global.css`, `animationName` as an INLINE style.** react-native-web drops inline `animationKeyframes` objects, and its dev validation deletes `animationName` from anything inside `StyleSheet.create` (logging "Invalid style property of animationName"). Gate it on `Platform.OS === 'web'` and pass it inline, like `podiumRise()` in `home.tsx`.
- **In-memory caches clear themselves on writes.** `lib/fetchAllActivities.ts` (whole activity history, shared by Home/Activity/Goals/Stats/year/achievements) and `lib/myTeams.ts` (the signed-in person's teams) are kept for a minute. `lib/supabase.ts` wraps `supabase.from(...).insert/update/upsert/delete` on `activities`, `activity_media`, `activity_participants`, `league_members` and `leagues`, plus every `rpc`, to clear them. Writes done server-side (edge functions such as Strava sync) must call `invalidateActivityCache()` afterwards. Screens remember their last data between visits with `useSnapState` (`lib/snapState.ts`), cleared when the account changes.
- **Personal settings live in auth user metadata**, not a table: `lib/prefs.ts` (units, daily quote, notification switches, muted teams). Display units go through `lib/units.ts`; data is always stored metric.
- **PostgREST embedded-resource filters** (`.select('x, parent!inner(y)').eq('parent.y', …)`) can silently fail to filter. Use two plain sequential queries instead.
- Dates are **typed** as `YYYY-MM-DD` (Canada's standard, and unambiguous where DD/MM and MM/DD disagree); convert with `src/lib/dateFormat.ts` helpers at input boundaries, store ISO `YYYY-MM-DD`. Dates are **displayed** with `toLocaleDateString(undefined, …)` so each user sees their own device's format — never hardcode a locale. Ricky is in Canada; the test suite still pins `TZ=Pacific/Auckland` for the NZ DST streak regressions.
- Week boundaries are **Monday-start** (`streak.ts` has the canonical helper).

## Product vocabulary (copy-only renames — internals unchanged)

User-facing copy says **Team, Effort, Respect, Inspired, Impact, Unrivaled**. The code/DB deliberately still says `leagues`, `league_members`, `xp`, `effort_score`, route paths `/league`, `/create-league`, etc. **Never rename DB columns, internal identifiers, or route paths to match display copy** — display strings only. Reactions are stored as the strings `'respect'` and `'inspired'` (old emoji rows were migrated to `'respect'`); only `'inspired'` feeds the Impact stat.

Voice: always encourage, never pressure or shame. Streaks are pure consistency info — no bonus/penalty language. Gate new copy against the brand-voice bible (in Claude's memory: "RIVAL Brand Voice" / "Daily Perspectives").

**Professional tone — every screen, including every new page.** Titles, labels and buttons are
plain noun/verb phrases with no "your"/"my" ("Scan workout", "Manual entry", "Take photo").
Descriptions are short factual sentences ("Details are extracted automatically."). No slang or
cute phrasing ("snap it", "in one go", "catch up", "fastest"), no exclamation marks, no emoji.
Errors say what happened and what to do. Encouragement stays but is understated. Run the
`brand-check` skill on new copy — the full rules live there.

## Verification limits

Authenticated flows (RLS behavior under a real session, OAuth callbacks) cannot be fully verified without Ricky's credentials — verify what you can (DB introspection, type checks, preview logs/screenshots, deploy success) and say plainly what still needs a human check.
