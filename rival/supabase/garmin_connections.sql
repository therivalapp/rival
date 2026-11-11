-- Garmin connection (2026-11-11, Ricky approved the table in chat).
--
-- garmin_connections: one row per member who connected Garmin. Holds Garmin's
-- user id (to match pushed activities to the member) and the OAuth2 tokens
-- (used only to disconnect at Garmin). Members can read whether they are
-- connected and when the last activity arrived, never the tokens: the app's
-- roles get column grants on the three safe columns only. Edge functions use
-- the service role.
--
-- garmin_oauth_states: the short-lived PKCE verifier between Connect and
-- Garmin's return. Service role only, no grants at all.

create table if not exists public.garmin_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  garmin_user_id text not null unique,
  access_token text,
  refresh_token text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_activity_at timestamptz
);

alter table public.garmin_connections enable row level security;

revoke all on public.garmin_connections from anon, authenticated;
grant select (user_id, connected_at, last_activity_at) on public.garmin_connections to authenticated;
grant all on public.garmin_connections to service_role;

drop policy if exists "Own Garmin connection" on public.garmin_connections;
create policy "Own Garmin connection" on public.garmin_connections
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.garmin_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_verifier text not null,
  return_to text not null,
  created_at timestamptz not null default now()
);

alter table public.garmin_oauth_states enable row level security;
revoke all on public.garmin_oauth_states from anon, authenticated;
grant all on public.garmin_oauth_states to service_role;
