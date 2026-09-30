-- Raise an inbox item when a suspiciously short activity syncs in.
--
-- A teammate's watch lost GPS mid-run and produced a 74-second "Morning Run".
-- Nothing in the data can tell that from a genuine sprint — the person who was
-- there knows instantly and the app never will — so it asks rather than
-- guessing. Short is suspicious, not impossible, which is why this is a
-- question and not an automatic deletion. Overlapping activities ARE resolved
-- automatically, in the importer, because two at once is impossible.
--
-- Only auto-synced activities. Someone who opened the app and logged a
-- 90-second effort meant it.

begin;

create or replace function inbox_on_short_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.duration_seconds, 0) <= 0
     or new.duration_seconds >= 180
     or lower(coalesce(new.provider, '')) not in ('strava', 'garmin')
     or new.short_review_dismissed_at is not null then
    return new;
  end if;

  insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
  values (
    new.user_id,
    'short_activity',
    null,
    null,
    'activity',
    new.id::text,
    'Short activity recorded',
    coalesce(new.name, new.activity_type) || ' · ' || new.duration_seconds || ' seconds'
  )
  on conflict do nothing;

  return new;
exception when others then
  -- An import must never fail because we could not raise a question about it.
  return new;
end;
$$;

drop trigger if exists inbox_short_activity_trigger on activities;
create trigger inbox_short_activity_trigger
  after insert on activities
  for each row execute function inbox_on_short_activity();

commit;
