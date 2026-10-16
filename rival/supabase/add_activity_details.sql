-- The finer details of an activity (Ricky, 2026-10-14): heart rate, pace,
-- cadence, calories, shoes or bike, best efforts and splits.
--
-- Shown only behind a tap (Details on the activity page, or tapping the
-- numbers on a feed card), so cards stay at four numbers. Best efforts also
-- drive the new "Fastest 5 km" style personal bests, counted across every
-- run in RIVAL, whether the distance was a whole run or part of a longer one.
--
-- All columns start empty; nothing existing changes. Strava fills them for
-- new activities, and older ones are filled gradually (Strava limits how many
-- activities can be read in detail per day).
alter table activities
  add column if not exists avg_heartrate numeric,
  add column if not exists max_heartrate numeric,
  add column if not exists avg_cadence numeric,
  add column if not exists avg_watts numeric,
  add column if not exists calories numeric,
  add column if not exists avg_speed numeric,          -- metres per second
  add column if not exists max_speed numeric,          -- metres per second
  add column if not exists gear_name text,             -- e.g. "Pegasus 40"
  -- [{ "name": "5k", "distance": 5000, "seconds": 1450 }, ...]
  add column if not exists best_efforts jsonb,
  -- [{ "distance": 1000, "seconds": 327, "elevation": 4 }, ...] per km
  add column if not exists splits jsonb,
  -- When the details were last read from the source, so the filler knows
  -- what is still to do.
  add column if not exists details_fetched_at timestamptz;
