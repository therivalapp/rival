-- Keep a deleted Strava activity deleted (Ricky, 2026-10-11).
--
-- Deleting an imported activity also removed its activity_sources row, so the
-- next Strava sync no longer knew it had ever been seen and imported it again
-- as new (a Garmin run with a wrong clock came back, wrong date and all).
--
-- When an activity is deleted, this records each outside id it came from.
-- The importers (through resolveCanonicalActivityId in _shared/activityDedup.ts)
-- skip anything recorded here. Only the owner can read their own list; rows
-- are written by the trigger, never by the app directly.

create table if not exists deleted_activity_sources (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_activity_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, provider, provider_activity_id)
);

alter table deleted_activity_sources enable row level security;

drop policy if exists "Owner reads own deleted sources" on deleted_activity_sources;
create policy "Owner reads own deleted sources" on deleted_activity_sources
  for select using (auth.uid() = user_id);

create or replace function remember_deleted_activity_sources()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into deleted_activity_sources (user_id, provider, provider_activity_id)
  select s.user_id, s.provider, s.provider_activity_id
    from activity_sources s
   where s.activity_id = old.id
  on conflict do nothing;

  if old.provider is not null and old.provider_activity_id is not null then
    insert into deleted_activity_sources (user_id, provider, provider_activity_id)
    values (old.user_id, old.provider, old.provider_activity_id)
    on conflict do nothing;
  end if;

  return old;
end;
$$;

drop trigger if exists remember_deleted_activity_sources on activities;
create trigger remember_deleted_activity_sources
  before delete on activities
  for each row execute function remember_deleted_activity_sources();

-- The run deleted today, before this existed (Strava id 20516340874), so the
-- copy that came back can be deleted once more and stay gone.
insert into deleted_activity_sources (user_id, provider, provider_activity_id)
values ('09b2e197-8257-4d7c-a0e6-12dc0429eeff', 'strava', '20516340874')
on conflict do nothing;
