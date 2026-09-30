---
name: brand-check
description: Gate user-facing copy (UI strings, notifications, quotes, empty states, marketing lines) against RIVAL's brand-voice bible. Use before shipping any new user-visible text, or to audit existing copy passed as an argument or found in the current diff.
---

# RIVAL Brand Check

Audit the copy given in the arguments (or all new/changed user-facing strings in the current working diff if no argument) against RIVAL's brand voice. Report each line as **PASS** or **FLAG** with a one-line reason and, for flags, a suggested rewrite in-voice.

## The voice

Calm, confident, thoughtful, optimistic. Speaks like the training partner everyone wishes they had. Never loud, never shames, never fake-hustle. **Consistency — not motivation — is the outcome RIVAL builds for**; copy serves that.

## Hard rules

- **Words we avoid (automatic FLAG):** grind, hustle, beast mode, crush, destroy, dominate, no excuses, "pain is weakness", "winners never quit", "rise and grind" — and anything in that register.
- **Words we like:** effort, consistency, identity, community, progress, momentum, journey, future, today, encourage, inspire, become, together, show up.
- **No guilt or pressure mechanics in copy**: nothing that shames a missed day/week ("don't break your streak!" energy is out). Streaks are pure consistency info, never a threatened loss.
- **Vocabulary**: user-facing copy says **Team** (never league/group), **Effort** (never XP/points), **Respect** and **Inspired** (reactions), **Impact**, **Unrivaled** (top rank). These are display-copy rules only — never rename code identifiers, DB columns, or routes to match.
- **Activity, never session/workout-as-a-noun for the user's training**: "activity"/"activities" covers everything (a run, a lift, a yoga class) without sounding like a gym workout. FLAG "session(s)". The year is "year", never "season" (e.g. "2026 rank", "Your 2026").
- **What "rival" means**: a rival isn't someone you're against — it's someone who brings out your best. Copy frames competition as friendly, shared and motivating ("We make each other better"). FLAG anything that frames other people as opponents to beat or crush (e.g. "can you catch them?" as a taunt). Naming the person just ahead IS on-brand — "7 behind Sandy" is friendly rivalry and Ricky finds it motivating; keep it. Don't over-explain the name in-product; let the experience carry it.

## Professional tone (Ricky, 2026-09-24 — applies to every screen, and to every new page)

RIVAL reads like a professional product. Warmth comes from the design and from
what the app notices about you — not from chatty wording.

- **Titles, labels, buttons: plain noun or verb phrases.** "Scan workout", "Manual entry",
  "Take photo", "Save changes". No "your"/"my" in titles or labels, no filler articles
  ("Take photo", not "Take a photo"), sentence case.
- **Descriptions: short, neutral, factual sentences.** Say what it does. "Details are
  extracted automatically." — not "RIVAL reads it and fills everything in!"
- **No slang, no colloquialisms, no cute phrasing.** Out: "snap it", "in one go", "catch up",
  "fastest", "let's", "awesome", "oops", "heads up", "come back once you've actually done it".
- **No exclamation marks. No emoji** (real icons only).
- **Errors:** what happened, then what to do, in one or two calm sentences. No blame, no jokes.
- **Empty states:** a calm statement or invitation — not an apology and not cheerleading.
- **Encouragement stays, understated.** "Every session counts." — never hype. The brand
  vocabulary (Team, Effort, Respect, Inspired, Impact, Unrivaled) still applies.

## Quality bar for each line

Short, clear, memorable; no clichés or motivational-poster language; makes the reader think, reflect, or feel seen; direct address ("you") is fine in sentences, never in titles, labels or buttons; timeless (still true in 5+ years); no negativity; human, not robotic.

## Output

A table or tight list: line → PASS/FLAG → reason → (if FLAG) rewrite. End with an overall verdict and anything structural (e.g. a whole feature whose framing fights the ethos, not just its words).
