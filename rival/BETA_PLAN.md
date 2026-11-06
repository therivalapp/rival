# RIVAL beta to-do list

Updated 2026-11-02. Beta aims to start by the end of 2026. Beta is friends with iPhones. RIVAL separates from Strava first.

## Now: Ricky on holiday
- [x] Ricky: review the profile empty states: done; built as ghost tiles on the profile (committed), the older mockup is superseded
- [x] Ricky: polish visuals
- [ ] Full-screen celebration (B) for PBs and yearly achievements, built 2026-11-02, uncommitted: count-up for distance and elevation, confetti, lifetime milestones lead then PBs then yearly achievements, replaces the photo pop-ups on phones (latest activity only, no photo yet). Still to see on the phone; dev preview: /home?previewCelebration=pb or =achievement
- [ ] Event page for one-day events BUILT 2026-11-04, uncommitted (components/rival/EventSheet.tsx, design/event-compare-v9.png): opens from event cards on Activity and Profile; last time = most recent earlier event of the same name; leg taps open that activity. Not yet seen on screen (preview not signed in). Share left off until an event share is designed. Multi-day keeps opening the diary (mock: event-opened-v2.png, column 2). Single race, HYROX and a reworked multi-day mocked 2026-11-04 (design/event-types-mockup.png), awaiting Ricky. Revised 2026-11-04: event-marathon-v2.png, event-hyrox-v3.png (Roxzone times), event-multiday-v2.png. Placings mocked 2026-11-04 (design/event-placings-mockup.png): one Placings card (division/overall/age group, each "of N") on all event types, HYROX run and station ranks, CrossFit event places, a Placings sheet with Scan results (results screenshot read like scan-workout) or typed. Revised 2026-11-04: Photos row on every event (all photos from its activities, day tags on multi-day, tap opens the viewer), HYROX station times white and ROX in salmon, Placings sheet uses Add an activity's words and icons. BUILT 2026-11-05, uncommitted: EventSheet now has the race (halves, pace per km, fastest efforts, details), HYROX (bar, runs/stations/Roxzone table with ranks) and multi-day (days bar, event cards with score and place) layouts, a Placings card on every event with Add placings / Edit, a Photos row, and PlacingsEditor (Photo scan tiles shared with Add an activity via ScanChoiceTiles, manual rows, station or event ranks). Multi-day events now open the event page. Checked with sample data in a local preview, not with real events. add_race_placings.sql RUN 2026-11-05 (2 events, column empty, policies unchanged); scan-placings DEPLOYED 2026-11-05 and read a sample HYROX results image correctly (division, overall, age group, run and station ranks). Still to check: saving placings on a real event, on a phone
- [ ] Event share mocked 2026-11-05 (design/event-share-mockup.png): Share on the event page (gradient, Done ghost), the activity share pop-up with two new event stamps (Finish: time as hero; Place: place as hero, dates for multi-day), placings as stat tiles with an ivory edge, HYROX running/stations/Roxzone and multi-day events/worked/days/best event tiles; Effort gold, always on. BUILT 2026-11-05, uncommitted: components/rival/EventShare.tsx (the activity share pop-up's layout), drawEventStamp in lib/shareStamp.ts, choices in lib/eventShare.ts, Share on the event page for your own events. "Share the stamp on its own" renamed "Save transparent stamp" on activity shares too. Checked with sample data in a local preview; not yet shared from a phone
- [ ] Triathlon transitions and Edit times BUILT 2026-11-05 (design/event-transitions-mockup.png, design/event-times-built.png): card tap opens the event page, ⋯ menu top right (Edit times, Edit event details), Official finish time pop-up with scan + optional T1/T2, Edit times for finish, legs and transitions, salmon Share on cards. add_race_transitions.sql RUN and scan-placings (reads times) DEPLOYED 2026-11-05, both verified. Code not committed or live yet; not tried on a phone.
- [x] Event mockup gaps FIXED 2026-11-05, checked on the QA test account: marathon share starts on Finish, Overall and Age group; enlarge button on the event share photo; PB pill on a race's fastest efforts (fastestBests rule); typed HYROX run ranks; saved transparent stamps are trimmed and centred (activity, event and rank shares). Uncommitted. QA test data: T100 Test Triathlon, Test Marathon, Test HYROX, City 10K (test).
- [x] One shared time box, reader and display format everywhere: BUILT 2026-11-05, uncommitted (lib/time.ts; events goal/finish, team event goal, goal time/pace, scan duration; old parsers now use it; rule in AGENTS.md). Also: pop-ups rise above the keyboard (RivalModal), finish times editable, Share on Events cards. Not yet tried on a phone
- [ ] Next after events: muscle group goals (Ricky 2026-11-03, e.g. posterior chain and grip this winter): weekly sets on an area plus one or two marker lifts; lifts need to count toward several areas; new goal type needs a migration; mock first
- [ ] After the new app is live: run supabase/team_invites_retire_code_join.sql so a code alone no longer walks in
- [ ] Teams on profiles (B, drop-down) with Ask to join, built 2026-11-02, uncommitted; profile_teams.sql run 2026-11-02 and checked on screen
- [ ] Event finish celebration and Also earned tiles on every celebration, built 2026-11-02, uncommitted. Dev preview: /home?previewCelebration=event
- [x] Live run screen + Finish pop-up B BUILT 2026-11-02 (design/live-run-mockup.png): Finish pauses, Resume play button, Save saves straight away (lib/saveLiveActivity.ts, auto-named "Morning Run"), celebration if earned, back to Today with a "Run saved." note and Edit. Live Stats/Splits/Map pages and the Finish map + splits chart show once a route is recorded (lib/liveTrack.ts); BPM/calories show once a watch feeds them. Capture button + Capture The Moment tile on Finish. Not yet tested: a real save end to end (would write to Ricky's account); needs GPS recording (native) to fill the route. In-app camera for Capture (components/rival/LiveCamera.tsx, no Use Photo/Retake) built 2026-11-02: needs https, so it only works on the deployed site, not the phone dev address; native needs expo-camera. Ricky 2026-11-02: wait for native GPS (no web GPS). Finish photo thumbnails open the photo picker to untick unwanted shots (Keep). Finish v2 BUILT 2026-11-02 (design/finish-923-mockup-v5.png, more-details-mockup-v3.png): moving + elapsed time, six tiles with Effort tile B (opens the breakdown), vertical split bars (up to 12, then every 5 or 20 km; part bar dashed and filled), More details (time, HR + cadence, pace/elevation chart, HR zones Z1-Z5 with names, fastest efforts, every split). Elapsed time is not saved (one duration column; needs a migration). No PB pill on fastest efforts yet. Other activities mocked: design/finish-activities-mockup.png, awaiting Ricky. Stats for all 60 types mapped 2026-11-02 (design/activity-stats-map.png): Finish tiles vs More details per group, with the source of each (GPS, phone motion, watch, sensor, logged). New stats (steps, lengths, SWOLF, waves, ski runs, elapsed and so on) need one migration: a flexible stats jsonb column on activities. Awaiting Ricky's picks. Only four layouts differ from the standard Finish (the rest just swap tiles): mocked in design/finish-special-mockup.png (swim More details with SWOLF and stroke types, ski runs list, HYROX station splits, result card for racket/team sports and CrossFit scores). Awaiting review. Ski updated (design/finish-ski-crossfit-mockup.png): Elevation tile, Distance kept, Descent column, elevation chart. Live CrossFit mocked (design/crossfit-live-mockup.png): pick AMRAP/For time/EMOM/Lifts, one-tap Round button with round splits, score pre-filled at Finish. All of it BUILT 2026-11-02 (Ricky: build it anyway): per-activity Finish tiles and hero for all 18 groups (lib/finishTiles.ts, lib/activityStats.ts), weights lift list with PB pill, ski runs + elevation chart + Elevation/Descent, HYROX race mode (Done per part, station splits), live CrossFit (AMRAP/For time/EMOM/Lifts, Round button, round splits, score filled in), score and result pop-ups, swim splits and More details from watch data, ride splits in km/h. Checked in the browser with test data, not on a phone. Extra numbers save to activities.stats (supabase/add_activity_stats.sql, RUN 2026-11-02); a real save is still untested. Heart rate, calories, cadence, power and average speed now save to their existing columns. Since then: opponent tagging (pick a teammate on the result; tagged on save like a training partner), HYROX division and optional Roxzone timing (31 parts), stroke and SWOLF per 100 m. Live ski/snowboard screen BUILT 2026-11-02: metres skied (ridden on a snowboard), speed in km/h, On the lift state, runs page, Highest tile on live and Finish instead of Elevation. Start cut down 2026-11-02 to activities where the phone is on you (START_TYPES: run/walk/hike/snowshoe, rides, ski/snowboard/touring/Nordic, gym and classes). Everything else is logged in Log an activity or comes from a watch via Apple Health/Garmin once those connect. Match result (racket/team) and CrossFit score moved into Log an activity, saved to activities.stats; a tagged opponent's copy gets the result turned round (mirror_match_result.sql RUN 2026-11-02). Match result shown on the feed card and activity page, built 2026-11-02, uncommitted (components/rival/MatchResult.tsx): "Played Sandy" and the sets, never won or lost; Won/Lost/Drawn removed from the result pop-up too. CrossFit cards stay normal; a score shows nowhere after saving yet. Feed band checked with stand-in data; activity page card not yet seen on screen. Other saved stats (steps, ski runs and so on) are not shown after saving yet.
- [ ] Ricky: request a Garmin data export, so the importer can be built from a real file
- [ ] Claude: add Garmin to archive import, with directions
- [ ] Garmin import (archive and API) brings each strength activity's exercises: name, sets, reps, weight, into `activities.exercises`, matched to RIVAL lifts for PBs (Ricky, 2026-11-04). Apple Health has no sets.
- [ ] Imported history kept as RIVAL's own, built 2026-11-02, uncommitted: archive imports are strava_archive and survive the Strava purge. functions deployed 2026-11-02; Settings disconnect change goes live with the next app deploy
- [ ] Privacy policy rewritten and Sharing with teams built 2026-11-02, uncommitted (/team-sharing before joining or creating a team, /privacy in the app). Contact email set; public URL and the date (UPDATED in src/app/privacy.tsx) still needed
- [ ] Neutral grey on phones built 2026-11-01, uncommitted: side pages and pop-ups only. Main pages reverted to the live look; Chat on Today's black; team hub on black with a held photo; top bar is Today's colour everywhere

- [x] Desktop is the phone app, 2026-11-06 (Ricky: "do the same for desktop"): wider than 480px the site is held to a centred 480px column and lays out exactly as on a phone (bottom bar with Start, pop-ups, colours). Old desktop layouts kept, off (DESKTOP_COLUMN_WIDTH in constants/breakpoints.ts). Mouse click-and-drag scrolls sideways rows (lib/mouseDragScroll.ts). Checked in headless Chrome at 1280 and 1440 on the QA account, not on Ricky's computer. Possible later: something designed for the empty space either side

## When Ricky is home
- [ ] NEXT WEEK, first up (banked 2026-11-04): therivalapp.com BOUGHT 2026-11-05; Claude builds a one-page site and hosts the privacy policy (deploy with Ricky's OK); Ricky applies to Garmin Starter as an individual (not incorporating yet) and gets a Personal Garmin key so the importer can be built on his workouts. See Garmin application below
- [ ] Ricky: sign up for the Apple Developer Program ($99 a year)
- [ ] Get RIVAL running as an iPhone app
- [ ] Make the look carry over to the iPhone app: gradients and other styling are web-only (about 210 gradient uses in 47 files) and fall back to flat colours
- [ ] Get it on TestFlight
- [ ] Build the Apple Health connection, including past workouts
- [ ] Build GPS tracking
- [ ] Live activity: Start button, ready screen A, gym timer with lifts, pause, one-tap lifts, Up next tiles, "Capture The Moment" and its photo pop-up built 2026-10-31, uncommitted; needs a real run-through on the phone. Mid-run prompt waits for the iPhone app
- [ ] Test with Ricky's Garmin
- [ ] New Focus types: fastest time, pace, lift first, then longest distance, event time, weekly rhythm, variety, time earned, Effort, total reps, total weight (mock: design/focus-types-mockup.png; goal_types.sql run 2026-10-31. Fastest time, pace, lift and the 3 Volume + 3 Performance limit built, uncommitted; saving a real goal still to test)

## Before beta
- [ ] Trademark clearance for the name before public launch (Ricky to decide on a lawyer search, roughly a few hundred to $1,500): RIVAL is registered in Class 9 by Rival Boxing Gear (sports brand, since 2012) and Rival Forces (9 and 41, 2025); RIVALFIT (fitness tracking and challenges) and RIVAL FIT are pending; other App Store apps are called Rival (Compete With Friends, RivalByM with HYROX challenges, Rival Fitness). Found 2026-11-05
- [ ] Full legal review of everything built: privacy policy, consent, terms of service (none yet), Apple Health, Strava deletion, AI providers, photos of others (Ricky asked 2026-11-02)
- [ ] Ricky: generate AI background images, one for each activity on the Start screen (Swim has none yet)
- [ ] Ricky: import his Strava archive and check it
- [ ] Disconnect Strava and delete everything that came through its API
- [ ] Remove the unused AI share functions
- [ ] Run a full compliance check for Apple
- [ ] Review the daily quotes (add Ricky's "Work hard until your idols become your rivals.", 2026-11-06)
- [ ] Decide on video service, Supabase Pro, photo compression and off-site backup
- [ ] Decide on the charity page
- [ ] Spec the text-behind-you share image
- [ ] Setup questions for new members: ask their usual activities so Start and the tiles fit from day one (Ricky 2026-11-01); mock first
- [ ] Ricky: move sign-in emails off Resend's test sender to a verified domain
- [ ] Daily cap on the Add Race search (it calls the Anthropic API with no limit today)
- [ ] Ricky: merge the work branch (shared-activities) into main when ready
- [ ] Photo filters for activity photos (Ricky asked 2026-10-24): spec first (which looks, per photo or per activity, video too), then mock, then build
- [ ] Ricky: invite iPhone friends by the end of 2026, so the first full achievement year starts 1 January 2027

## Garmin application (ready for when Garmin reopens, 2026-11-04)
Approval adds new workouts arriving with full detail: routes, lift sets, swim lengths, per-km pace. Without it, new workouts come through Apple Health as summaries only. Not a beta blocker; aim to have it by public launch. REOPENED: the Starter Access form is live again (checked 2026-11-04, garmin.com/en-US/forms/StarterGarminConnectDeveloperAccess): push only, no history, limited users; Enterprise later for history and unlimited users. Form asks for company name, website URL, privacy policy URL, address, business model, third-party services that touch Garmin data (Supabase, Vercel, Anthropic if scans use it), APIs wanted, expected users (0-100). Personal API key (own data only) available now for building the importer with Ricky's account.
- [ ] Individual Apple account for the beta; incorporate before earning or public launch, whichever comes first (accounting about $2k a year, Ricky 2026-11-04). Apple converts individual to organisation later; incorporating then needs a D-U-N-S number
- [x] Ricky: bought therivalapp.com on Cloudflare 2026-11-05 (auto-renews 2027-11-05, Cloudflare name servers). Still to do: set up an email address on it (also fixes the Resend test sender). Checked 2026-11-05: therivalapp.com free (matches the GitHub name), also therivalapp.app, rivalapp.co; rival.co shows unregistered (may be premium-priced); rival.com/.app/.io/.fit, getrival, joinrival, tryrival all taken
- [x] Website BUILT and DEPLOYED 2026-11-06 (rival/site, Vercel project therivalapp): live at therivalapp.vercel.app with /privacy (Garmin section added); therivalapp.com attached on Vercel. WAITING on Ricky: two CNAME records in Cloudflare (GARMIN_APPLICATION.md). Rebuild the privacy page with `python3 scripts/build-site-privacy.py` after editing PRIVACY_POLICY.md
- [x] Application answers drafted: GARMIN_APPLICATION.md
- [ ] Ask for the Activity API only (workouts, routes, sets); no sleep, stress or steps
- [ ] Screenshots showing "Garmin [device model]" attribution everywhere Garmin data appears
- [ ] Written statement: Garmin data never sold or used for ads; income only from cosmetics and extra teams, never from Garmin data (terms 5.2(e))
- [ ] Garmin data deleted on disconnect or account deletion (account deletion already built)
- [ ] Live app with beta testers on TestFlight, plus usage numbers
- [ ] Short demo video: a Garmin workout arriving, scoring, and showing on the team feed
- [ ] Ricky: apply once the website and privacy policy are up (form is open now)

## Banked ideas, ranked (Claude's order, 2026-11-03)
Do now, before beta: small, and what a new tester sees first
1. [x] Total Time Earned empty state: phone top bar reads "Day One" until time is earned, built 2026-11-03, uncommitted (design/time-earned-dayone-mockup.png). Not yet seen on screen: needs an account with no activities
2. [x] Circular Focus card: already live on Today (ring with progress, % complete, days left); the old reminder was out of date
3. [x] Team Challenge: already built (create-team-challenge.tsx): a team target in distance, elevation, time, activities or Effort with a deadline, or an event as the goal, shown on the team hub
4b. [x] Your place under the podium when outside the top three: "8th of 12 · 7 Days Remaining" (design/podium-place-mockup.png, B), built 2026-11-03, uncommitted; checked on screen with stand-in teammates. Big-place versions mocked (podium-place-full-mockup.png, podium-place-compact-mockup.png); Ricky kept the small line
4. [x] Monthly PBs on the team feed: built 2026-11-03, then removed at Ricky's call; the Activity page's own PB filter stays. All Teams card mocked (design/all-teams-mockup.png), no leading line, awaiting Ricky
5. [x] Board note expiry: already built (board_note_expiry.sql, "Show until" when posting; past notes leave the board)

Soon after beta starts: worth it once there is real activity to show
6. [ ] Stats timeframe toggle: Lifetime / Year / Month / Week on the Stats page
7. [ ] Weather chip: real weather on an activity from its GPS and start time (Open-Meteo, free); needs own GPS or Apple Health routes
8. [ ] All Teams list (design/all-teams-mockup.png): last swipe after the podiums, each team's leader and your place, no summary line; only for 4+ teams. Banked 2026-11-03 for RIVAL+ (fits the free = 3 teams idea)
9. [ ] Team Highlights: an Instagram-style team page of chosen moments; board 7/10 (Team Challenge, which it was waiting on, is built)
10. [ ] Planned workouts: scheduled workouts shown as Upcoming in an empty week; needs a new table

Later: bigger, or nobody will need it for a while
11. [ ] Unrivaled trophy polish: title and sparkles on the reached trophy; nobody reaches 30,000 until late 2027
12. [ ] Journeys: a shared group goal tied to an event; a big feature, builds on Team Challenge and events
13. [ ] Player card share image: photo, name and stats in the rank's material
14. [ ] Health tips from credible sources (e.g. Stacy Sims): belongs with a future Pro layer
15. [ ] Premium training plans: Pro builds a plan toward a goal from Garmin history; needs Garmin approval first
16. [ ] Add other apps' imports as people ask for them

## Done
- [x] Phone checks marked done by Ricky 2026-11-02 (all still uncommitted): profile stats, photo drag, milestone prompt, Log an activity layouts, HYROX fix, Goals and Today card, FIT routes, Choose activities, yearly achievements, All Teams Feed header, Activity/Feed titles, task pages without bars, notifications speed, swipe on Today, search above the keyboard, Start speed, last-member leave check, Sharing with teams on joining
- [x] Decided 2026-11-02: All Teams Feed and team hub keep their current backgrounds; flame button stays; no seconds box for Weights; Firsts removed and a Time ladder (25-500 hours) plus a 5,000 m elevation level added, 34 achievements a year; Build profile card stays #282828
- [x] Profile page built, new Strava connections closed, `saved_workouts_photos.sql` run, 2026-10-31
- [x] New Strava connections closed in the app, sign-up now points to archive import (local until committed)
- [x] Decided to separate from Strava (2026-10-30)
- [x] Audited Strava, Garmin and Apple terms: `COMPLIANCE_AUDIT.md`
- [x] Private Strava activities filtered, live 2026-10-30
- [x] Revoked Strava access handled, live 2026-10-30
