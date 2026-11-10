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

Rewritten 2026-11-08, checked again 2026-11-09 against the live site, to match the form's fields (as reported by garminrumors.com,
Oct 2026) and to give approval the best chance. Fill in the [brackets].

**Company name**
RIVAL

**Website**
https://therivalapp.com

**Privacy policy URL**
https://therivalapp.com/privacy

**Contact name**
Ricky Jackson-Lewis

**Job title**
Founder

**Email**
hello@therivalapp.com

**Company address**
[your mailing address]

**Primary business service**
A social fitness app for teams of friends, clubs and training partners.

**Industry served**
Health and fitness (consumer).

**App overview**
RIVAL is a social fitness app where friends, clubs and training partners see
and recognise each other's effort. RIVAL counts every kind of movement, because
all effort deserves recognition: runs, rides, swims, walks, strength training,
yoga, classes, events such as marathons, triathlons and HYROX, and any other
activity. Every activity sits in one place, whichever device or app recorded
it. Each one earns Effort, a single score built on time, distance and
elevation that compares different sports fairly. Members see the total time and Effort
they have put in across every activity, with ranks marking milestones along the
way. Members share
with the teams they choose, take on team goals and challenges together, and
encourage each other, so friends keep each other consistent. RIVAL is in
testing now, with an iPhone beta through TestFlight planned for December 2026,
for testers in Canada, Australia and New Zealand.

**User experience**
A member connects Garmin from Settings, Connected devices, through Garmin's own
sign-in and consent screen. From then on, each activity they record on their
Garmin device appears in RIVAL automatically, with its route, splits and, for
strength workouts, the exercises and sets. Their teammates can react to it and
encourage them, and it counts toward team goals. Garmin users can share their
training with friends who use other devices, without anyone switching apps or
entering workouts twice.

**How the APIs will be used**
RIVAL receives new activities through the Activity API's push notifications:
type, start time, duration, distance, elevation, heart rate, splits, route, and
the exercises and sets of strength workouts. They are used only to record the
member's activities, score Effort and show them to the teams the member has
agreed to share with. Every activity from Garmin is shown with Garmin
attribution and the name of the device that recorded it, following Garmin's
brand guidelines. When a member disconnects RIVAL, in RIVAL or in Garmin
Connect, RIVAL stops receiving their data and removes its access to their
account. Deleting a RIVAL account deletes all of its data, including data from
Garmin; this is in the app today. Data is encrypted in transit and at rest,
and access rules in the database limit each member's data to them and the
teams they choose.

**Business model**
RIVAL is free to use, without advertising. Its core stays free: recording
activities, Effort, ranks and recognition are never behind a payment.
An optional premium membership may follow, adding extra features such as more
teams and personal planning tools. Payments in the
iPhone app go through Apple. Garmin data is used only to provide RIVAL's
features to the member it belongs to, including any paid features they choose.
It is never sold, never used for advertising and never shared with data brokers.

**Third-party services that will process, analyse or store Garmin data**
- Supabase: database, sign-in and file storage, where activities are kept.
- Vercel: hosting of the web app.
- Expo: push notifications, which can include an activity's name.
No analytics, machine learning or AI service processes, analyses or stores
Garmin data, and it is never used to train AI models.

**APIs requested**
Activity API only. RIVAL does not request the Health, Women's Health, Courses or
Training APIs.

**Expected users connected in the next 12 months**
About 100 in the beta from December 2026, growing to around 500 as RIVAL opens
to more members in 2027.

**Prior contact with Garmin or a Garmin distributor**
No.

## Keeping the answers true

- "No AI service processes Garmin data" holds because the AI share caption and
  image functions (generate-share-caption: Anthropic; generate-share-image:
  OpenAI) are not used by the app today. If either comes back, keep Garmin
  activities out of it or tell Garmin first.
- Starter access is push only with no historical data: a member's earlier
  Garmin history is not available, only what they record after connecting.
- To build with the Garmin connection: deregistration and permission-change
  handling, Garmin attribution and device name on each activity.

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
