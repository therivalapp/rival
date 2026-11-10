-- Feedback sent from the app (Team Beta, 2026-11-10, Mockups 25 and 26).
--
-- The BETA pill in the top bar and the Send feedback row in Settings open a
-- pop-up; the send-feedback edge function saves each report here and emails
-- it to hello@therivalapp.com. Screenshots (up to five) go in the email
-- only and are not stored.
--
-- Nobody reads or writes this table from the app. RLS is on with no
-- policies, and anon/authenticated get no grants, so the only way in is the
-- send-feedback edge function, which uses the service role. Deleting an
-- account deletes its feedback.

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('problem', 'idea', 'dislike')),
  message     text not null check (char_length(message) between 1 and 4000),
  -- Where it was sent from and on what, so a report can be reproduced.
  page        text check (char_length(page) <= 200),
  app_version text check (char_length(app_version) <= 40),
  device      text check (char_length(device) <= 120),
  screenshot_count smallint not null default 0 check (screenshot_count between 0 and 5),
  created_at  timestamptz not null default now()
);

create index if not exists feedback_user_created_idx on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;

-- New public tables get no Data API access by default (Supabase, 2026-10-30).
-- Only the service role needs it.
revoke all on public.feedback from anon, authenticated;
grant select, insert, delete on public.feedback to service_role;
