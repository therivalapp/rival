-- Gymnastics: apparatus, floor and tumbling work, usually as a class.
--
-- Level with Volleyball and Workout (1.125), under Calisthenics (1.25). The
-- 2024 Adult Compendium lists gymnastics, general at 3.8 METs, the bottom of
-- the calisthenics range (3.8 moderate, 7.5 vigorous): short hard efforts with
-- long turns waiting at each apparatus, all of it on the clock.
--
-- No elevation credit: nothing here covers ground.
insert into scoring_config (activity_type, multiplier, elevation_rate)
values ('Gymnastics', 1.125, 0)
on conflict (activity_type) do update
  set multiplier = excluded.multiplier, elevation_rate = excluded.elevation_rate;
