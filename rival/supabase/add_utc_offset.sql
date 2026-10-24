-- Remember the local time zone each activity happened in (Ricky, 2026-10-14).
--
-- started_at is the exact moment an activity began, which is right, but on its
-- own it can only be shown in the viewer's time zone. An 8 am run in Morocco
-- then reads as midnight to anyone (or any device) on Vancouver time, and its
-- time-of-day sky turns to night.
--
-- Strava sends the activity's offset from UTC (utc_offset, in seconds, e.g.
-- 3600 for Morocco in October, -25200 for Vancouver in summer). The importers
-- will save it here; manual entries save the phone's own offset. Empty means
-- not known yet, and the app falls back to the viewer's time zone as today.
--
-- Nothing existing changes: the column starts empty for every row.
alter table activities
  add column if not exists utc_offset_seconds integer;
