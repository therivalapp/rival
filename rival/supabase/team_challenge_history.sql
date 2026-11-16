-- Team challenge history (Ricky approved 2026-11-14). A team's current
-- challenge gets a start date, so it counts only activities between its start
-- and due dates; each finished challenge is kept so the Challenges tab can show
-- past results (the trophy case). Podium places are worked out from the
-- activities in the dates, so only the challenge itself is stored.

alter table public.leagues add column if not exists goal_start_date date;

-- Challenges already running started when the team did (what they counted).
update public.leagues set goal_start_date = created_at::date
where goal_metric is not null and goal_start_date is null;

create table if not exists public.team_challenge_history (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  metric text not null,
  target numeric not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists team_challenge_history_league on public.team_challenge_history(league_id, end_date desc);

alter table public.team_challenge_history enable row level security;
create policy "members read team challenge history" on public.team_challenge_history
  for select using (public.is_league_member(league_id));
create policy "admins add team challenge history" on public.team_challenge_history
  for insert with check (public.is_league_admin(league_id));
create policy "admins remove team challenge history" on public.team_challenge_history
  for delete using (public.is_league_admin(league_id));

grant select, insert, delete on public.team_challenge_history to authenticated;
