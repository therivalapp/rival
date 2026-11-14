# RIVAL · App Store listing (draft for Ricky)

Drafted 2026-11-14 for the 2026-11-20 submission. Nothing here is entered in App Store Connect yet. Items marked **Ricky decides** need your pick; everything else is a proposal to check.

---

## 1. Name and subtitle

The name is limited to 30 characters. Plain "RIVAL" is taken, so App Store Connect currently shows "RIVAL (78c4d1)". The home screen keeps saying RIVAL whatever is picked here.

**Ricky decides** the name:

| Option | Length | Note |
|---|---|---|
| RIVAL: Team Fitness | 19 | Says what it is in two words |
| RIVAL Fitness Teams | 19 | Same idea, no colon |
| RIVAL: Fitness, Shared | 22 | Closest to the headline |

"RIVAL: Fitness is better shared" is 31 characters, one too many.

**Subtitle** (30 max): `Fitness is better shared` (24)

The trademark check (BETA_PLAN.md) still applies to whichever name is picked.

## 2. Category and age rating

- Primary category: **Health & Fitness**
- Secondary category: **Sports**
- Age rating: **13+**. Sign-up already refuses anyone under 13. Chat, team posts and comments are user content, with report and block built. In the questionnaire, answer **None** for violence, profanity, mature themes, gambling, medical advice and web access. Answer **Yes** to "user-generated content", with the moderation tools named.

## 3. Promotional text (170 max, can be changed any time without review)

> Join a team, log every activity, and see your Effort add up. Weekly leaders, team challenges and personal bests, shared with the people who train beside you.

(157 characters)

## 4. Description

> RIVAL is a fitness app built around the people you train with.
>
> Join or create a team with friends, a run club or a gym crew. Every activity you log earns Effort, and each week the team has a leader. Runs, rides, swims, lifts, classes and events all count, so everyone can take part in their own way.
>
> TEAMS
> - Weekly leader podium and standings
> - Team challenges with a shared target and deadline
> - Team feed, chat, comments and Respect
> - Planned activities with who is coming
>
> ACTIVITIES
> - Record runs, walks and rides with GPS
> - Import activities from Apple Health
> - Scan a whiteboard or gym screen to log an activity from a photo
> - Exercises, sets and weights for strength activities
> - Photos and videos on every activity
>
> PROGRESS
> - Effort score for every activity, on one scale across every sport
> - Personal bests, fastest times and lifts
> - Focus goals with a progress ring
> - Ranks through the year and a yearly review
>
> PRIVACY
> RIVAL does not show advertising, does not sell personal information and does not use tracking tools. Your activities are shared only with the teams you choose.
>
> Terms of use: https://therivalapp.com/terms
> Privacy policy: https://therivalapp.com/privacy

Check before submitting: site/terms.html is built but, like the rebuilt privacy page, waits on a website deploy.

## 5. Keywords (100 max, commas, no spaces after them)

```
running,gym,strength,run club,leaderboard,personal best,triathlon,hyrox,cycling,swim,log,challenge
```

(98 characters.) Words already in the name and subtitle (fitness, team, shared) are left out, because Apple counts those already.

## 6. URLs and contact

- Support URL: https://therivalapp.com (it needs a visible way to reach hello@therivalapp.com)
- Marketing URL: https://therivalapp.com
- Privacy policy URL: https://therivalapp.com/privacy. **The rebuilt page is not deployed yet** (BETA_PLAN.md). It must go live before you submit.
- Copyright: `2026 Ricky Jackson-Lewis`

## 7. App Privacy answers (App Store Connect, App Privacy)

**Tracking: No.** RIVAL does not link data with other companies' data for advertising, and has no advertising identifiers.

For each type below, choose **Linked to the user: Yes** and **Used for tracking: No**. The purpose for every type is **App Functionality**, apart from the two marked otherwise.

| Apple's category | Data type | What RIVAL holds | Purpose |
|---|---|---|---|
| Contact Info | Name | First and last name, optional username | App Functionality |
| Contact Info | Email Address | Sign-in email | App Functionality |
| Health & Fitness | Health | Heart rate and energy read from Apple Health | App Functionality |
| Health & Fitness | Fitness | Activities, duration, distance, elevation, exercises, sets, Effort | App Functionality |
| Location | Precise Location | GPS route of a recorded activity (only while recording) | App Functionality |
| User Content | Photos or Videos | Activity photos and videos, profile and cover photos, scan photos | App Functionality |
| User Content | Other User Content | Posts, messages, comments, notes, personal quote | App Functionality |
| User Content | Customer Support | What testers write in Send feedback, with screenshots | App Functionality |
| Identifiers | User ID | RIVAL account id | App Functionality |
| Usage Data | Product Interaction | When you last used the app | App Functionality |
| Diagnostics | Other Diagnostic Data | App version and phone model sent with feedback | App Functionality |
| Other Data | Other Data Types | Date of birth (age check, optional birthday for teammates) | App Functionality |

Not collected (leave unticked): Phone number, Physical address, Payment info, Credit info, Contacts, Search history, Browsing history, Advertising data, Crash data, Performance data, Sensitive info, Coarse location, Emails or text messages (the chat counts as Other User Content), Audio data, Gameplay content, Device ID.

**To check with you:**
- The push-notification token: Apple's guidance doesn't count it as a Device ID, so it is left out above. Some apps list it anyway; leaving it out is the usual answer.
- "When you last used the app" is a single timestamp. I listed it as Product Interaction to be safe. It can come off if you'd rather keep the list shorter.
- Activity scanning sends photos to Anthropic, and team crests use fal.ai. Apple counts data sent to service providers working for you as "collected" by you, not as third-party sharing. That is already covered by the rows above.

## 8. Review notes (reuse from TestFlight)

- Demo account: the review account in the demo world (Harbour Run Club). Same as build 12's Test Information.
- Add one line for the App Store review: "Account approval is switched off for the reviewer's demo account; RIVAL is in a friends beta, and new sign-ups are approved by the developer."
- **Before submitting:** make sure account approval doesn't block new sign-ups if the reviewer creates a fresh account (BETA_PLAN.md item). Hide the BETA pill in the App Store version.

## 9. Screenshots

Apple requires the **6.9-inch iPhone** size: 1320 × 2868 pixels (portrait), 3 to 10 images. Smaller iPhones reuse these automatically. No iPad screenshots are needed if the app is iPhone only.

Proposed set of 6, all taken in the demo world as the review account (no real people's data). Each gets one short line above the phone, in the RIVAL look (serif italic, peach on #131313). Mock the frames first for your approval.

| # | Screen | Line above it |
|---|---|---|
| 1 | Today: weekly leader glass podium | Fitness is better shared |
| 2 | Team hub: Team Challenge ring with members' shares | One target, the whole team |
| 3 | Activity: this week's chart and day cards | Every activity in one place |
| 4 | An activity's page with photo and gold Effort | Effort on every activity |
| 5 | Personal best celebration | Personal bests, recognised |
| 6 | Team chat with the "I'm in" card | Plan the next one together |

Optional extras: Start (GPS recording), Ranks ladder, Focus ring by sport.

How they get made: the simulator at iPhone 15 Pro Max or 16 Pro Max size gives 1290 × 2796, which Apple also accepts for the 6.9-inch slot. Screens are captured from the simulator signed in as the review account, then framed with the line above. This needs your sign-in to Appetize once, as the review account.

## 10. Still open before 2026-11-20 (from BETA_PLAN.md)

- [ ] Ricky: pick the name (section 1)
- [ ] Deploy the website (rebuilt privacy page and terms page), with your OK
- [ ] Ricky: check the privacy answers (section 7), then enter them
- [ ] Screenshot frames mocked, approved, then captured
- [ ] App Store version: BETA pill hidden, account approval not blocking a new sign-up
- [ ] Commit and ship the iPhone motion and look pass (checked on the simulator first)
