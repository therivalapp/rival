# Garmin Connect Developer Program: application answers

Draft answers for the Starter Access form
(garmin.com/en-US/forms/StarterGarminConnectDeveloperAccess), prepared
2026-11-06. Copy each answer into the form and fill in the parts in [brackets].
Apply only after https://therivalapp.com and https://therivalapp.com/privacy
load (see "Before applying").

## Before applying

1. Done 2026-11-08: DNS records added, https://therivalapp.com is live.
2. Done 2026-11-08: hello@therivalapp.com forwards to getrivalapp@gmail.com
   (Cloudflare Email Routing). The site and policy use it.

## Answers

**Company / organisation name**
RIVAL (operated by [your full name] as an individual; not yet incorporated)

**Website**
https://therivalapp.com

**Privacy policy URL**
https://therivalapp.com/privacy

**Address**
[your mailing address]

**Contact email**
hello@therivalapp.com

**Describe the application**
RIVAL is a social fitness app for small teams of friends, clubs and training
partners. Members record their activities, earn a single Effort score that
compares different sports fairly, and share them with the teams they choose.
It covers running, cycling, swimming, strength training, classes and events
such as marathons, triathlons and HYROX. RIVAL is in private beta on the web,
with an iPhone app in development.

**How will Garmin data be used**
Garmin activities will be imported so that a member's workouts appear in RIVAL
with full detail: type, time, duration, distance, elevation, heart rate,
splits, route, and the exercises and sets of strength workouts. They are used
only to record the member's activities, score Effort and show them to the
teams the member has agreed to share with. Every activity from Garmin is shown
with the name of the Garmin device that recorded it.

**Business model**
RIVAL is free to use. Planned income is from optional cosmetic items and from
members who want more than three teams. Garmin data is never sold, never used
for advertising, never shared with data brokers and never used to make money
in any way.

**APIs requested**
Activity API only (activities, routes, and strength exercise sets). RIVAL does
not request the Health API: no sleep, stress, steps or other wellness data.

**Third-party services that will process Garmin data**
- Supabase: database, sign-in and file storage (where activities are kept)
- Cloudflare: domain and email forwarding
- Vercel: hosting of the web app
- Expo: push notifications, which can include an activity's name

Garmin data is not sent to any AI provider.

**Data deletion**
Disconnecting Garmin stops new data arriving. Deleting a RIVAL account deletes
all of its data, including data from Garmin; this is built and in the app
today (Profile, Delete account). Members can also delete any single activity.

**Expected number of users**
0 to 100 during the beta.

**Platforms**
Web today; iPhone app in development (beta through TestFlight).

## Website DNS (Cloudflare)

In Cloudflare, therivalapp.com, DNS, Records, add both records with the proxy
turned off (grey cloud, "DNS only"):

| Type  | Name | Target                               | Proxy |
|-------|------|--------------------------------------|-------|
| CNAME | @    | f980f2ddd85177fb.vercel-dns-017.com  | Off   |
| CNAME | www  | f980f2ddd85177fb.vercel-dns-017.com  | Off   |

Keep Cloudflare's own name servers; changing them would stop Cloudflare email
routing. The site is already live at https://therivalapp.vercel.app and
serves the domain as soon as these records are in place.
