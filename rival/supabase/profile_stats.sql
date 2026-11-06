-- The two stats a person shows either side of Effort on their profile.
-- It lives on users, not in personal settings, because teammates read it too.
-- Empty means the defaults: Time earned and Activities.
alter table users add column if not exists profile_stats text[]
  check (profile_stats is null or cardinality(profile_stats) = 2);

notify pgrst, 'reload schema';
