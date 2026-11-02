-- Teams on a profile (Ricky, 2026-11-02, design/teams-tiles-vs-dropdown.jpg, B).
--
-- The teams a person is in, for their profile. Read-only, one new function,
-- no table changes.
--
-- Who sees what:
--   * Your own profile: all your teams.
--   * A teammate's profile: their public teams, plus any private team you are
--     both in. A private team you're not in is never returned, so a profile
--     can't reveal it.
--   * Someone you share no team with: nothing.
--
-- viewer_status is the person looking: 'active' (your team), 'pending' (you
-- asked), 'declined' (an admin said no in the last 7 days, the same wait the
-- invite code has), or null (you can ask to join).

create or replace function public.profile_teams(p_user_id uuid)
returns table (
  id uuid,
  name text,
  logo_url text,
  description text,
  is_private boolean,
  member_count bigint,
  effort_this_week numeric,
  role text,
  viewer_status text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with viewer as (select auth.uid() as uid),
  -- Profiles are for teammates: you or someone sharing an active team.
  allowed as (
    select 1 from viewer v
     where v.uid = p_user_id
        or exists (
          select 1 from league_members a
            join league_members b on b.league_id = a.league_id
           where a.user_id = v.uid and a.status = 'active'
             and b.user_id = p_user_id and b.status = 'active')
  )
  select l.id, l.name, l.logo_url, l.description, l.is_private,
         (select count(*) from league_members m where m.league_id = l.id and m.status = 'active'),
         (select coalesce(round(sum(a.effort_score)), 0) from activities a
           where a.user_id in (select m.user_id from league_members m where m.league_id = l.id and m.status = 'active')
             and a.started_at >= date_trunc('week', now())),
         pm.role,
         case
           when vm.status = 'active' then 'active'
           when vm.status = 'pending' then 'pending'
           when exists (select 1 from inbox_items i
                         where i.user_id = (select uid from viewer) and i.kind = 'join_declined'
                           and i.league_id = l.id and i.created_at > now() - interval '7 days') then 'declined'
         end
    from league_members pm
    join leagues l on l.id = pm.league_id
    left join league_members vm on vm.league_id = l.id and vm.user_id = (select uid from viewer)
   where pm.user_id = p_user_id
     and pm.status = 'active'
     and exists (select 1 from allowed)
     and (l.is_private = false or vm.status = 'active' or p_user_id = (select uid from viewer))
   order by (vm.status = 'active') desc nulls last, l.name;
$$;

revoke all on function public.profile_teams(uuid) from public;
-- Supabase grants new functions to anon by default; signed-out callers get
-- nothing anyway (no auth.uid()), but they shouldn't call it at all.
revoke all on function public.profile_teams(uuid) from anon;
grant execute on function public.profile_teams(uuid) to authenticated;
