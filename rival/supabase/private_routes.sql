-- Private routes. 2026-09-26. RUN 2026-09-26 on Ricky's OK: 304 routes moved, activities.route_polyline cleared.
--
-- The problem: a Strava route map (activities.route_polyline) can reveal where
-- someone lives or trains. No screen shows another person's route today, but
-- teammates can read every column of each other's activities through the API,
-- so the route is reachable by anyone on the same team.
--
-- The fix: routes move to their own table that only the owner can read. The
-- rest of the activity stays exactly as visible as it is now.
--
-- 1. activity_routes: one row per activity with a route; owner-only.
-- 2. Copy every existing route across.
-- 3. Clear the old column (kept, not dropped, so nothing that still selects it
--    breaks while the app and importers switch over).
--
-- Code that went with it (done, functions deployed):
--   - strava-webhook / strava-backfill / strava-full-import write the route to
--     activity_routes instead of activities.route_polyline (redeploy all three).
--   - ai-share.tsx reads the owner's route from activity_routes.
--
-- Dry-run first: select count(*) from activities where route_polyline is not null;
-- that number of rows should land in activity_routes, and the same number of
-- activities should afterwards have route_polyline null.

create table if not exists public.activity_routes (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  polyline text not null,
  created_at timestamptz not null default now()
);

alter table public.activity_routes enable row level security;

drop policy if exists "Owners read their own routes" on public.activity_routes;
create policy "Owners read their own routes" on public.activity_routes
  for select using (auth.uid() = user_id);

drop policy if exists "Owners write their own routes" on public.activity_routes;
create policy "Owners write their own routes" on public.activity_routes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.activity_routes (activity_id, user_id, polyline)
select id, user_id, route_polyline
from public.activities
where route_polyline is not null and route_polyline <> ''
on conflict (activity_id) do nothing;

update public.activities set route_polyline = null where route_polyline is not null;
