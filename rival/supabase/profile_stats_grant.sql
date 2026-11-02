-- Signed-in people read users column by column. profile_stats.sql added the
-- column without that permission, so nobody, owner included, can read it yet.
grant select (profile_stats) on public.users to authenticated;

notify pgrst, 'reload schema';
