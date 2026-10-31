-- Saved workouts, second part (Ricky, 2026-10-25): a workout saved from a
-- scan keeps its photo so it's easy to spot, can have a usual day ("Monday
-- session" leads on Mondays), and each person can keep up to 30.
--
-- 1. Two optional columns on saved_workouts. Existing rows keep both empty,
--    so nothing that is there now changes.
--    image_path: where the photo is in the workout-photos bucket below.
--    usual_day: 0 Sunday to 6 Saturday, as JavaScript's getDay().
-- 2. At most 30 saved workouts each, checked when one is added.
-- 3. A private bucket for those photos. Unlike activity-photos (public: the
--    feed shows them), these are workout screenshots and whiteboards, read
--    for the details and never posted, so only their owner can open them,
--    through a short-lived signed link.

alter table public.saved_workouts
  add column if not exists image_path text,
  add column if not exists usual_day smallint check (usual_day between 0 and 6);

create or replace function public.saved_workouts_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.saved_workouts where user_id = new.user_id) >= 30 then
    raise exception 'Saved workouts are limited to 30. Delete one to save another.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists saved_workouts_limit on public.saved_workouts;
create trigger saved_workouts_limit
  before insert on public.saved_workouts
  for each row execute function public.saved_workouts_limit();

insert into storage.buckets (id, name, public)
values ('workout-photos', 'workout-photos', false)
on conflict (id) do nothing;

-- Owner-only, by the first folder of the path (<user id>/<file>), the same
-- rule as activity-photos, but reading is owner-only too.
drop policy if exists "Owners read workout-photos" on storage.objects;
create policy "Owners read workout-photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'workout-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Owners write workout-photos" on storage.objects;
create policy "Owners write workout-photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'workout-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Owners update workout-photos" on storage.objects;
create policy "Owners update workout-photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'workout-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'workout-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Owners delete workout-photos" on storage.objects;
create policy "Owners delete workout-photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'workout-photos' and (storage.foldername(name))[1] = auth.uid()::text);
