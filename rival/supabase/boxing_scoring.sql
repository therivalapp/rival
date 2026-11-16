-- Boxing as its own activity type (Ricky, 2026-11-16). Without a row it
-- scores at the 0.8 default, below Martial arts (1.375). Bag work and boxing
-- classes are interval work like HIIT (1.625), so it sits between the two.
-- No elevation credit: it's done on the spot.
insert into scoring_config (activity_type, multiplier, elevation_rate)
values ('Boxing', 1.5, 0)
on conflict (activity_type) do nothing;
