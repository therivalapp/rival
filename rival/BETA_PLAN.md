# RIVAL beta to-do list

Updated 2026-10-31. Beta is friends with iPhones. RIVAL separates from Strava first.

## Now: Ricky on holiday
- [ ] Ricky: review the profile empty states: `design/profile-empty-states-mockup.png`
- [ ] Ricky: check photo drag on the iPhone and the milestone photo prompt
- [ ] Build people choosing their own two profile stats, Effort stays locked in the middle
- [ ] Ricky: polish visuals
- [ ] Ricky: check on the phone: new Log an activity layouts, HYROX crash fix, Month bests, lift quick tiles, Date row, Goals main focus, Today card, iPhone drag fix
- [ ] Ricky: decide on a seconds box for the Weights Time tile
- [ ] Ricky: finish the Event page review
- [ ] Claude: add FIT routes to archive import
- [ ] Ricky: request a Garmin data export, so the importer can be built from a real file
- [ ] Claude: add Garmin to archive import, with directions
- [ ] Claude: keep imported history as RIVAL's own, so activities hold their reactions and photos
- [ ] Claude: rewrite the consent screen and privacy policy

## When Ricky is home
- [ ] Ricky: sign up for the Apple Developer Program ($99 a year)
- [ ] Get RIVAL running as an iPhone app
- [ ] Get it on TestFlight
- [ ] Build the Apple Health connection, including past workouts
- [ ] Build GPS tracking
- [ ] Test with Ricky's Garmin

## Before beta
- [ ] Ricky: import his Strava archive and check it
- [ ] Disconnect Strava and delete everything that came through its API
- [ ] Remove the unused AI share functions
- [ ] Run a full compliance check for Apple
- [ ] Review the daily quotes
- [ ] Decide on video service, Supabase Pro, photo compression and off-site backup
- [ ] Decide on the charity page
- [ ] Spec the text-behind-you share image
- [ ] Ricky: invite iPhone friends

## Later
- [ ] Add other apps' imports as people ask for them
- [ ] Player card share image: photo, name and stats in the rank's material

## Done
- [x] Profile page built, new Strava connections closed, `saved_workouts_photos.sql` run, 2026-10-31
- [x] New Strava connections closed in the app, sign-up now points to archive import (local until committed)
- [x] Decided to separate from Strava (2026-10-30)
- [x] Audited Strava, Garmin and Apple terms: `COMPLIANCE_AUDIT.md`
- [x] Private Strava activities filtered, live 2026-10-30
- [x] Revoked Strava access handled, live 2026-10-30
