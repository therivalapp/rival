-- Saved workouts (Ricky, 2026-10-24): a named set of lifts ("Push day",
-- "Squat day") that can be logged again in one tap from Lifts on Log an
-- activity. Repeating a past workout needs no table: it reads the
-- activity's own exercises. This is only for the ones given a name.
--
-- exercises: the lifts in order, as the app stores them on an activity:
-- [{ "name": "Bench Press", "sets": 3, "reps": 5, "weight": 140 }], weight
-- in kg. last_used_at puts the one used most recently first.
--
-- Private to the person who saved it: every policy is owner-only. A new
-- public table needs explicit grants (Supabase, from 2026-10-30).

create table if not exists public.saved_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  activity_type text,
  exercises jsonb not null default '[]'::jsonb check (jsonb_typeof(exercises) = 'array'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists saved_workouts_user_idx on public.saved_workouts (user_id, last_used_at desc);

alter table public.saved_workouts enable row level security;

drop policy if exists "Owner reads saved workouts" on public.saved_workouts;
create policy "Owner reads saved workouts" on public.saved_workouts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Owner adds saved workouts" on public.saved_workouts;
create policy "Owner adds saved workouts" on public.saved_workouts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Owner changes saved workouts" on public.saved_workouts;
create policy "Owner changes saved workouts" on public.saved_workouts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Owner removes saved workouts" on public.saved_workouts;
create policy "Owner removes saved workouts" on public.saved_workouts
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.saved_workouts to authenticated;
