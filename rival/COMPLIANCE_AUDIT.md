# Connected-service compliance audit

Checked 2026-10-30 against the API Agreement and API Policy effective 2026-06-01. This is a reading of the terms, not legal advice. Strava decides compliance "in its sole discretion" (Policy 5).

## Data held

548 of 561 activities came through Strava, and 545 of those are older than 7 days. Stored fields include splits, best efforts, heart rate and route polylines.

## Clear gaps

| Rule | Finding | Where | Smallest fix |
|---|---|---|---|
| 7.1 privacy settings | RIVAL asks for `activity:read_all` and no importer reads `visibility`, so activities set to "Only you" on Strava can reach teammates | `src/lib/strava.ts:29`, `strava-webhook`, `strava-backfill`, `strava-full-import` | FIXED, deployed 2026-10-30. Older ones go when a sync or full import reaches them |
| 7.4 revocation | Athlete deauthorization events are ignored; data stays when someone revokes access on Strava | `strava-webhook/index.ts:189` | FIXED, deployed 2026-10-30. Depends on the webhook subscription being alive |
| 5.3 AI | `generate-share-caption` and `generate-share-image` take activity stats to AI services; unused by the app but still deployed | `supabase/functions/` | Remove both |
| 5.5 bulk | "Import full Strava history" pulls a person's whole history into permanent tables | `strava-full-import`, `profile.tsx:776` | Remove once storage is settled |
| 6.2 cache | Strava data is stored indefinitely, against a 7-day limit | `activities`, `activity_routes`, `activity_sources` | See options below |
| 2.1 consent | The screen does not explain deletion requests or confirmation; it mentions feeds and standings only | `connect-strava.tsx` | Rewrite |
| 6.5 privacy policy | No Usage Data statement | `PRIVACY_POLICY.md` | Add it |
| 4.4 Garmin data | Activities recorded on Garmin and arriving through Strava carry no Garmin attribution | feeds, activity pages, share stamps | Moot if Strava stops being a team data source |

## Unresolved in the terms

- **Teammate display.** Agreement summary, Policy 2.3 and 6.2 say a user's data shows only to that user. 5.13 and the summary's consent line imply sharing with consent. 6.1 implies an exception for capacity of 9,999 or fewer. The Agreement controls over the Policy. Feeds, standings and profiles all depend on this.
- **5.4 combining.** Strava data may not be combined with other customer data. Team totals mix Strava and manual activities.
- **5.8 charging.** Paid features must not be substantially duplicative of Strava. This limits paid plans built on Strava data.

## Imitating or replicating Strava

| Area | Verdict |
|---|---|
| Logos and marks | Pass. No Strava logo files in the app |
| Name in product | Pass. Strava appears only as a named connection |
| Colour | Pass. RIVAL's terracotta and serif look are distinct. `profile.tsx:1128` uses Strava's orange for a connection dot; remove to be safe |
| Vocabulary | Pass. No kudos, segments, KOM, Relative Effort, Year in Sport, Local Legend or clubs in the UI. "Effort" is the closest; keep it, don't add "Relative" |
| Function | Exposed. Activity feed, reactions, comments, photos, leaderboards, group challenges, personal bests, yearly review, route maps and activity logs all exist on Strava. RIVAL's own ground is team competition by Effort across every activity type, ranks, lift logging, confirmed shared activities and team pages |

## Not checked

Terms-of-service wording (Policy 9.2), support contact and links to Strava accounts (2.4), Garmin and HealthKit rules.

Leaving: Policy 7.4(d) requires deleting all Strava Data and personal data derived from it within 30 days of stopping use of the API.

# Garmin

Checked 2026-10-30 against the Garmin Connect Developer Program Agreement (FRM-0952 Rev. B) and API Brand Guidelines.

- **Access:** new applications are reported paused since spring 2026, with no date. Two independent reports quote Garmin replies; Garmin has made no public announcement. Existing integrations are unaffected.
- **Retention:** no 7-day style limit found. Data may be displayed in the licensee's app (4.1).
- **Money:** 5.2(e) bars deriving income from use of the API without written permission. 10.1 lets Garmin charge for API access in future.
- **Attribution:** "Garmin [device model]" on feeds, cards, detail views, exports, share images and derived or combined data. New display formats need 30 days' written notice (6.6).
- **Termination:** Garmin may end the agreement on 30 days' notice (9.2).
- **Starter tier:** push only, no historical data, capped users.

# Apple

Checked 2026-10-30 against App Review Guidelines 5.1.1 to 5.1.3, the Developer Program License Agreement 3.3 section H, and the HealthKit privacy guidance.

- **Purpose:** HealthKit data only for health, motion or fitness services, clear in marketing and the UI.
- **Storage:** iCloud is banned. No rule against RIVAL's own servers was found. The privacy policy must state retention and deletion.
- **Other people:** disclosure to a third party needs prior express consent, and only so that party can provide a health or fitness service. Whether a teammate counts as a third party is not addressed. Strava itself shows Health-sourced workouts to followers, which is precedent, not clearance.
- **Never:** advertising, marketing, data brokers, sale, AI services without explicit permission, writing false data.
- **Paid features:** cannot depend on granting Health access (5.1.1(ii)); in-app purchase is required for digital features (3.1.1).
- **App quality:** must be more than a repackaged website (4.2).
- **Coverage:** Apple Watch workouts arrive fully. Strava sends route, type, distance, time and calories for its own activities, with no routes for third-party ones. Garmin Connect is reported to send summaries without routes (user reports, not official).
- **Requires:** paid Apple Developer account and a native iPhone build. Neither exists yet.
- **Android:** Health Connect not researched.

# Options

| | Stay on Strava | Leave now | Move the foundation, Strava while allowed |
|---|---|---|---|
| Fits Strava's terms | No | Yes | Improves in stages |
| Automatic sync at beta | Yes, 10 people | No, until the iPhone app ships | Yes, on iPhone |
| Keep history | At risk | Only via archive import | Via archive import |
| Teammate sharing | Disputed | Clear | Clear for Health and RIVAL data |
| Work needed | Least | Medium | Most |

# Board review

**Contrarian.** This fixes a risk that has not bitten. There are seven users and Strava has not objected. The alternative rests on a native app and a developer account that do not exist, and could delay beta by months. Apple Health also drops Android and web users. The simple answer is to run beta at 10 athletes and decide later. The weakness in that case is that the terms bar what the product does, and Strava can end access at will.

**First Principles.** The problem is a person's effort being seen by their team, not syncing from Strava. Strava is one pipe, and the activity is the person's own. The requirement is low-effort capture plus the right to keep and show it. Only manual entry, photo scan, personal archives and the phone's Health store offer both today.

**Expansionist.** "Whatever you record on, your team sees it" is a stronger position than sitting on top of Strava. It moves RIVAL away from competing with Strava and towards being the team layer over every device. The same native app unlocks push, in-app purchase and all-day walking, which are all parked behind it.

**Outsider.** Nike Run Club records its own runs and reads Health; it never relied on a rival's feed. Duolingo's streak is valuable because Duolingo owns it. Spotify keeps the listening history that makes Wrapped possible. Each owns the record its identity features depend on.

**Executor.** Not a one-week job. This week: filter private activities, handle revoked access, remove the two AI functions, stop full-history import, separate archive imports from API data. Then enrol with Apple, get a native build running, and read workouts only through the existing dedup path, with a new consent screen. Routes, steps, Android and Garmin direct wait.

**Customer Advocate.** Connecting once to Health is simpler, and gym members with no Strava account gain the most. Strava regulars lose custom titles and sometimes routes. History is identity, so archive import has to be smooth or Legacy and Effort will feel erased. A team with Android members needs a good manual route, or they become second-class.

**Chairman.** Staying is cheap and works today. Moving is harder but is the only route where the terms allow what RIVAL exists to do. Real risks: the native build effort, the Android gap, App Review's view of teammate sharing, and thinner Garmin data. Recommendation: move the foundation before beta, keep Strava only while it is allowed, and plan as if it will go. This matches the 2026-09-23 walking ruling to close gaps with HealthKit when native lands. **Confidence 7/10.** Missing: how well the app runs as a native iPhone build, how many beta testers use iPhones, real Health data quality from Strava and Garmin sources, and the outcome of Strava's review.

Sources are in the session notes; terms were read directly from Strava, Garmin and Apple on 2026-10-30.
