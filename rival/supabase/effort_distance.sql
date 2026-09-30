-- Effort: mostly distance for distance sports (approved in principle 2026-09-30).
-- Step 1 of 2: schema and rates. Safe to run before the rescore; the app and
-- edge functions already read these columns (select '*') and fall back to
-- time-only scoring while distance_rate is 0.
--
--   distance sports, distance recorded:
--     Effort = minutes x distance_time_rate + km x distance_rate + climb x elevation_rate
--     km credited up to min_pace (fastest believable minutes per km)
--   everything else, or no distance recorded:
--     Effort = minutes x multiplier + climb x elevation_rate
--
-- multiplier (the time-only rate) rises 25% for every sport, so an hour in
-- the gym keeps level with an hour of running under the new formula.

alter table scoring_config
  add column if not exists distance_time_rate numeric not null default 0,
  add column if not exists distance_rate      numeric not null default 0,
  add column if not exists min_pace           numeric not null default 0;

update scoring_config set multiplier = round(multiplier * 1.25, 4);

update scoring_config c set
  distance_time_rate = v.time_rate,
  distance_rate      = v.km_rate,
  min_pace           = v.min_pace
from (values
  ('Run',              0.30,  8.0, 2.5),
  ('TrailRun',         0.30,  8.0, 2.5),
  ('Walk',             0.15,  7.3, 5.0),
  ('Hike',             0.23, 14.0, 5.0),
  ('Ride',             0.25,  2.7, 1.0),
  ('MountainBikeRide', 0.28,  4.3, 1.2),
  ('GravelRide',       0.28,  3.7, 1.0),
  ('EBikeRide',        0.18,  1.9, 1.0),
  ('Swim',             0.30, 47.0, 10.0),
  -- Indoor: treadmills, Zwift and rowing machines record distance too.
  ('VirtualRun',       0.30,  8.0, 2.5),
  ('VirtualRide',      0.25,  2.7, 1.0),
  ('Rowing',           0.30,  6.7, 2.8),
  ('VirtualRow',       0.30,  6.7, 2.8),
  -- Other ground-covering sports. Mixed sessions (HYROX, CrossFit) stay on
  -- time alone by design, even when a distance is entered.
  ('NordicSki',        0.31,  8.3, 2.0),
  ('Snowshoe',         0.25, 16.7, 5.0),
  ('Kayaking',         0.20,  7.1, 3.0),
  ('Canoeing',         0.20,  8.0, 3.0),
  ('StandUpPaddling',  0.18,  7.8, 4.0),
  ('InlineSkate',      0.23,  3.0, 1.2)
) as v(activity_type, time_rate, km_rate, min_pace)
where c.activity_type = v.activity_type;

-- Indoor climbing: treadmill incline and Zwift climbs are credited like
-- outdoor climbing (previously 0 for anything virtual).
update scoring_config set elevation_rate = 0.05
where activity_type in ('VirtualRun', 'VirtualRide');
