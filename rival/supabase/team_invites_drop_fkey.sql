-- team_invites.sql gave league_members a second link to users (invited_by).
-- Every query that reads members with users(...) now fails, because the
-- database cannot tell which link is meant. That emptied All Teams Feed and
-- broke the member lists on the team hub, Chat, Team settings and Plan.
-- invited_by stays as a plain id; nothing joins through this link.
alter table league_members drop constraint if exists league_members_invited_by_fkey;

-- Refresh the API's view of the tables so the fix applies at once.
notify pgrst, 'reload schema';
