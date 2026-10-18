-- Account deletion by email confirmation (Ricky, 2026-10-17).
--
-- "Request account deletion" records a row here and sends a sign-in link to
-- the account's email. Following the link opens the final "Delete account
-- permanently" screen, and delete-account only accepts that path while a
-- request exists and has not expired. "Cancel request" removes the row.
-- The in-app "Delete now instead" path does not need a row.
--
-- New table only; nothing existing changes.
create table if not exists public.deletion_requests (
  user_id uuid primary key references public.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

alter table public.deletion_requests enable row level security;

drop policy if exists "Own deletion request: read" on public.deletion_requests;
create policy "Own deletion request: read" on public.deletion_requests
  for select using (auth.uid() = user_id);

drop policy if exists "Own deletion request: create" on public.deletion_requests;
create policy "Own deletion request: create" on public.deletion_requests
  for insert with check (auth.uid() = user_id);

drop policy if exists "Own deletion request: cancel" on public.deletion_requests;
create policy "Own deletion request: cancel" on public.deletion_requests
  for delete using (auth.uid() = user_id);
