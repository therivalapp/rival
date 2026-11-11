-- Report and block (Apple guideline 1.2, 2026-11-10, Mockup 27 v8).
--
-- Two tables:
--
-- 1. public.reports: what members report (an activity, a chat message or a
--    member). Written only by the send-report edge function (service role),
--    which also emails each report to hello@therivalapp.com. Nobody reads it
--    from the app, so RLS is on with no policies and anon/authenticated get
--    no grants, the same as public.feedback.
--
-- 2. public.user_blocks: who each member has blocked. Each member can see,
--    add and remove only their own blocks. The app hides a blocked member's
--    activities, comments and chat messages from the person who blocked
--    them. The blocked member is not told and cannot see the row.
--
-- Deleting either account deletes its reports and blocks.

create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid references auth.users (id) on delete cascade,
  target_kind      text not null check (target_kind in ('activity', 'message', 'member')),
  -- The activity or message id; null when a member is reported.
  target_id        uuid,
  reason           text not null check (reason in ('spam', 'harassment', 'inappropriate', 'other')),
  details          text check (char_length(details) <= 2000),
  also_blocked     boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists reports_created_idx on public.reports (created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select, insert, delete on public.reports to service_role;

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

drop policy if exists "user_blocks own select" on public.user_blocks;
create policy "user_blocks own select" on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());

drop policy if exists "user_blocks own insert" on public.user_blocks;
create policy "user_blocks own insert" on public.user_blocks
  for insert to authenticated with check (blocker_id = auth.uid());

drop policy if exists "user_blocks own delete" on public.user_blocks;
create policy "user_blocks own delete" on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

revoke all on public.user_blocks from anon;
grant select, insert, delete on public.user_blocks to authenticated;
grant select, insert, delete on public.user_blocks to service_role;

-- Supabase's default grants also give authenticated update, truncate,
-- references and trigger on new tables; members only need select, insert and
-- delete on their own blocks (truncate would skip RLS).
revoke update, truncate, references, trigger on public.user_blocks from authenticated;
