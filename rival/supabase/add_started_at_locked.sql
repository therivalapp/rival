-- Keep a start time someone set in RIVAL (Ricky, 2026-10-09).
--
-- A watch with a wrong clock (a flat Garmin that hadn't resynced) uploads a run
-- to Strava stamped with the wrong day and time, and Strava won't let a GPS
-- activity's time be changed. Fixing it in RIVAL didn't hold either: every
-- Strava sync (backfill, webhook, full import) copied Strava's start time back.
--
-- Same idea as name_locked: once the person sets the start time on the edit
-- page, the importers leave started_at alone.
alter table activities
  add column if not exists started_at_locked boolean not null default false;
