# RIVAL beta to-do list

Updated 2026-11-02. Beta aims to start by the end of 2026. Beta is friends with iPhones. RIVAL separates from Strava first.

## Now: Ricky on holiday
- [ ] Ricky: review the profile empty states: `design/profile-empty-states-mockup.png`
- [ ] Ricky: polish visuals
- [ ] Full-screen celebration (B) for PBs and yearly achievements, built 2026-11-02, uncommitted: count-up for distance and elevation, confetti, lifetime milestones lead then PBs then yearly achievements, replaces the photo pop-ups on phones (latest activity only, no photo yet). Still to see on the phone; dev preview: /home?previewCelebration=pb or =achievement
- [ ] Ricky: finish the Event page review
- [ ] After the new app is live: run supabase/team_invites_retire_code_join.sql so a code alone no longer walks in
- [ ] Teams on profiles (B, drop-down) with Ask to join, built 2026-11-02, uncommitted; profile_teams.sql run 2026-11-02 and checked on screen
- [ ] Event finish celebration and Also earned tiles on every celebration, built 2026-11-02, uncommitted. Dev preview: /home?previewCelebration=event
- [x] Live run screen + Finish pop-up B BUILT 2026-11-02 (design/live-run-mockup.png): Finish pauses, Resume play button, Save saves straight away (lib/saveLiveActivity.ts, auto-named "Morning Run"), celebration if earned, back to Today with a "Run saved." note and Edit. Live Stats/Splits/Map pages and the Finish map + splits chart show once a route is recorded (lib/liveTrack.ts); BPM/calories show once a watch feeds them. Capture button + Capture The Moment tile on Finish. Not yet tested: a real save end to end (would write to Ricky's account); needs GPS recording (native) to fill the route. In-app camera for Capture (components/rival/LiveCamera.tsx, no Use Photo/Retake) built 2026-11-02: needs https, so it only works on the deployed site, not the phone dev address; native needs expo-camera. Ricky 2026-11-02: wait for native GPS (no web GPS). Finish photo thumbnails open the photo picker to untick unwanted shots (Keep). Finish v2 BUILT 2026-11-02 (design/finish-923-mockup-v5.png, more-details-mockup-v3.png): moving + elapsed time, six tiles with Effort tile B (opens the breakdown), vertical split bars (up to 12, then every 5 or 20 km; part bar dashed and filled), More details (time, HR + cadence, pace/elevation chart, HR zones Z1-Z5 with names, fastest efforts, every split). Elapsed time is not saved (one duration column; needs a migration). No PB pill on fastest efforts yet. Other activities mocked: design/finish-activities-mockup.png, awaiting Ricky. Stats for all 60 types mapped 2026-11-02 (design/activity-stats-map.png): Finish tiles vs More details per group, with the source of each (GPS, phone motion, watch, sensor, logged). New stats (steps, lengths, SWOLF, waves, ski runs, elapsed and so on) need one migration: a flexible stats jsonb column on activities. Awaiting Ricky's picks. Only four layouts differ from the standard Finish (the rest just swap tiles): mocked in design/finish-special-mockup.png (swim More details with SWOLF and stroke types, ski runs list, HYROX station splits, result card for racket/team sports and CrossFit scores). Awaiting review. Ski updated (design/finish-ski-crossfit-mockup.png): Elevation tile, Distance kept, Descent column, elevation chart. Live CrossFit mocked (design/crossfit-live-mockup.png): pick AMRAP/For time/EMOM/Lifts, one-tap Round button with round splits, score pre-filled at Finish. All of it BUILT 2026-11-02 (Ricky: build it anyway): per-activity Finish tiles and hero for all 18 groups (lib/finishTiles.ts, lib/activityStats.ts), weights lift list with PB pill, ski runs + elevation chart + Elevation/Descent, HYROX race mode (Done per part, station splits), live CrossFit (AMRAP/For time/EMOM/Lifts, Round button, round splits, score filled in), score and result pop-ups, swim splits and More details from watch data, ride splits in km/h. Checked in the browser with test data, not on a phone. Extra numbers save to activities.stats (supabase/add_activity_stats.sql, RUN 2026-11-02); a real save is still untested. Heart rate, calories, cadence, power and average speed now save to their existing columns. Since then: opponent tagging (pick a teammate on the result; tagged on save like a training partner), HYROX division and optional Roxzone timing (31 parts), stroke and SWOLF per 100 m. Live ski/snowboard screen BUILT 2026-11-02: metres skied (ridden on a snowboard), speed in km/h, On the lift state, runs page, Highest tile on live and Finish instead of Elevation. Start cut down 2026-11-02 to activities where the phone is on you (START_TYPES: run/walk/hike/snowshoe, rides, ski/snowboard/touring/Nordic, gym and classes). Everything else is logged in Log an activity or comes from a watch via Apple Health/Garmin once those connect. Match result (racket/team) and CrossFit score moved into Log an activity, saved to activities.stats; a tagged opponent's copy gets the result turned round (mirror_match_result.sql RUN 2026-11-02). Not yet shown anywhere after saving: the result, score and other stats on the activity page and feed card.
- [ ] Ricky: request a Garmin data export, so the importer can be built from a real file
- [ ] Claude: add Garmin to archive import, with directions
- [ ] Imported history kept as RIVAL's own, built 2026-11-02, uncommitted: archive imports are strava_archive and survive the Strava purge. functions deployed 2026-11-02; Settings disconnect change goes live with the next app deploy
- [ ] Privacy policy rewritten and Sharing with teams built 2026-11-02, uncommitted (/team-sharing before joining or creating a team, /privacy in the app). Contact email set; public URL and the date (UPDATED in src/app/privacy.tsx) still needed
- [ ] Neutral grey on phones built 2026-11-01, uncommitted: side pages and pop-ups only. Main pages reverted to the live look; Chat on Today's black; team hub on black with a held photo; top bar is Today's colour everywhere

## When Ricky is home
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
- [ ] Full legal review of everything built: privacy policy, consent, terms of service (none yet), Apple Health, Strava deletion, AI providers, photos of others (Ricky asked 2026-11-02)
- [ ] Ricky: generate AI background images, one for each activity on the Start screen (Swim has none yet)
- [ ] Ricky: import his Strava archive and check it
- [ ] Disconnect Strava and delete everything that came through its API
- [ ] Remove the unused AI share functions
- [ ] Run a full compliance check for Apple
- [ ] Review the daily quotes
- [ ] Decide on video service, Supabase Pro, photo compression and off-site backup
- [ ] Decide on the charity page
- [ ] Spec the text-behind-you share image
- [ ] Ricky: invite iPhone friends by the end of 2026, so the first full achievement year starts 1 January 2027

## Later
- [ ] Add other apps' imports as people ask for them
- [ ] Player card share image: photo, name and stats in the rank's material

## Done
- [x] Phone checks marked done by Ricky 2026-11-02 (all still uncommitted): profile stats, photo drag, milestone prompt, Log an activity layouts, HYROX fix, Goals and Today card, FIT routes, Choose activities, yearly achievements, All Teams Feed header, Activity/Feed titles, task pages without bars, notifications speed, swipe on Today, search above the keyboard, Start speed, last-member leave check, Sharing with teams on joining
- [x] Decided 2026-11-02: All Teams Feed and team hub keep their current backgrounds; flame button stays; no seconds box for Weights; Firsts removed and a Time ladder (25-500 hours) plus a 5,000 m elevation level added, 34 achievements a year; Build profile card stays #282828
- [x] Profile page built, new Strava connections closed, `saved_workouts_photos.sql` run, 2026-10-31
- [x] New Strava connections closed in the app, sign-up now points to archive import (local until committed)
- [x] Decided to separate from Strava (2026-10-30)
- [x] Audited Strava, Garmin and Apple terms: `COMPLIANCE_AUDIT.md`
- [x] Private Strava activities filtered, live 2026-10-30
- [x] Revoked Strava access handled, live 2026-10-30
