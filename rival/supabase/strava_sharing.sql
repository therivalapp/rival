-- Strava sharing consent. 2026-09-27. RUN 2026-09-27 on Ricky's OK ("run strava").
--
-- Why: Strava's API Agreement only allows one person's Strava data to be shown
-- to other people with that person's explicit consent. RIVAL shows Strava
-- activities to teammates, so connecting Strava now asks for that consent and
-- records when it was given. Route maps are a separate, optional choice that
-- starts off.
--
-- 1. users.strava_sharing_agreed_at — when the person agreed to their Strava
--    activities being shown to their teams. Null = not asked yet (everyone who
--    connected before this change is asked once on Home).
-- 2. users.share_routes — whether their route maps are shown to teammates.
--    Default false: routes stay owner-only unless the person turns this on.
-- 3. users.share_routes_changed_at — when that choice was last made.
-- 4. Uses the existing shares_active_team(a, b) from add_activity_sharing.sql
--    (true when two people are active members of the same team; SECURITY
--    DEFINER). Left untouched: the activity-tagging policy relies on it.
-- 5. A second SELECT policy on activity_routes: a teammate can read a route
--    only when the owner has share_routes on and both are active in a shared
--    team. The owner-only policies are untouched. Writes stay owner-only.
--
-- Dry-run: select count(*) from users;  -- every row gets share_routes = false,
-- and no activity_routes row becomes readable by anyone new until someone opts in.

alter table public.users
  add column if not exists strava_sharing_agreed_at timestamptz,
  add column if not exists share_routes boolean not null default false,
  add column if not exists share_routes_changed_at timestamptz;

drop policy if exists "Teammates read shared routes" on public.activity_routes;
create policy "Teammates read shared routes" on public.activity_routes
  for select using (
    exists (select 1 from public.users u where u.id = activity_routes.user_id and u.share_routes)
    and public.shares_active_team(auth.uid(), activity_routes.user_id)
  );

-- Added while running it (2026-09-27): users has column-level SELECT grants
-- (email, date of birth and time zone are hidden), so the new columns started
-- unreadable. That made the route policy above error for every reader, owners
-- included. share_routes is safe to show (it only says whether someone shares
-- routes); the consent date stays hidden and is read through my_strava_sharing().
grant select (share_routes) on public.users to authenticated;

create or replace function public.my_strava_sharing()
returns table (agreed_at timestamptz, share_routes boolean)
language sql
stable
security definer
set search_path = public
as $$
  select strava_sharing_agreed_at, share_routes from users where id = auth.uid();
$$;
revoke all on function public.my_strava_sharing() from public, anon;
grant execute on function public.my_strava_sharing() to authenticated;
