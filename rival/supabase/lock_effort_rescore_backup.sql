-- Lock the 2026-10-01 rescore backup table (Supabase security alert
-- rls_disabled_in_public, 2026-10-03).
--
-- effort_rescore_backup_20261001 was the rollback snapshot taken before
-- effort_distance_rescore.sql ran: 548 rows of activity id + old Effort score.
-- It was created without row-level security, so anyone with the app's public
-- key could read, change or empty it.
--
-- Turning RLS on with NO policies shuts the app's public and signed-in roles
-- out entirely. The data stays, and the dashboard and database admin roles
-- (which bypass RLS) can still read it if the rescore ever needs undoing.
alter table public.effort_rescore_backup_20261001 enable row level security;

-- Belt and braces: take back the grants the public roles were given by default.
revoke all on public.effort_rescore_backup_20261001 from anon, authenticated;
