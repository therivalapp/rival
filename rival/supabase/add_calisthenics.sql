-- Calisthenics: bodyweight strength work, as a class or alone.
--
-- Level with WeightTraining (1.25). It has the same shape: sets with rest,
-- and logged time that includes walking around, skill practice and setup.
-- The 2024 Adult Compendium puts it in the same band as resistance training:
-- calisthenics 3.8 METs moderate, 7.5 vigorous; weight lifting 3.5 general,
-- 6.0 vigorous. A hard continuous session runs higher, but most logged time
-- isn't that, and the rate has to be fair for the whole hour.
--
-- No elevation credit: nothing here covers ground.
insert into scoring_config (activity_type, multiplier, elevation_rate)
values ('Calisthenics', 1.25, 0)
on conflict (activity_type) do update
  set multiplier = excluded.multiplier, elevation_rate = excluded.elevation_rate;
