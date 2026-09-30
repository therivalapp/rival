-- Team settings: description, invite code reset, founder handover, deleting a
-- team, and leaving without stranding it. 2026-09-26.
--
-- 1. leagues.description          one or two lines about the team (max 160)
-- 2. reset_league_invite_code()   admin only; the old code stops working
-- 3. transfer_league_founder()    founder only; hands the team to a member
-- 4. delete_league()              founder only; removes the team and its history
-- 5. leave_league()               now hands the team on instead of stranding it
-- 6. a guard so other admins can't demote or remove the founder
--
-- Nothing here changes existing data.

-- 1. Description ------------------------------------------------------------
alter table public.leagues add column if not exists description text;
alter table public.leagues drop constraint if exists leagues_description_length;
alter table public.leagues add constraint leagues_description_length
  check (description is null or char_length(description) <= 160);
-- Admins already update leagues through the "admins can update league" policy.

-- 2. Reset the invite code --------------------------------------------------
-- Same shape as the app's codes (6 upper-case letters and digits), retried on
-- the rare clash with an existing code.
create or replace function public.reset_league_invite_code(p_league_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text;
begin
  if not is_league_admin(p_league_id) then
    raise exception 'Only team admins can reset the invite code';
  end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from leagues where invite_code = v_code);
  end loop;
  update leagues set invite_code = v_code where id = p_league_id;
  return v_code;
end;
$$;

-- 3. Hand the team to another member ----------------------------------------
create or replace function public.transfer_league_founder(p_league_id uuid, p_new_founder uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_league_creator(p_league_id) then
    raise exception 'Only the founder can hand over the team';
  end if;
  if not exists (
    select 1 from league_members
    where league_id = p_league_id and user_id = p_new_founder and status = 'active'
  ) then
    raise exception 'The new founder must be a member of the team';
  end if;
  update leagues set created_by = p_new_founder where id = p_league_id;
  update league_members set role = 'admin'
  where league_id = p_league_id and user_id = p_new_founder;
end;
$$;

-- 4. Delete the team --------------------------------------------------------
-- Everything that belongs to the team is removed by its ON DELETE CASCADE
-- links. Two links have no cascade and would block the delete, so they are
-- cleared first: old notifications that point at the team, and a Team vs Team
-- result the team won.
create or replace function public.delete_league(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_league_creator(p_league_id) then
    raise exception 'Only the founder can delete the team';
  end if;
  delete from notifications where league_id = p_league_id;
  update league_vs_league_challenges set winner_league_id = null where winner_league_id = p_league_id;
  delete from leagues where id = p_league_id;
end;
$$;

-- 5. Leaving no longer strands a team ---------------------------------------
-- Before: a founder who was the only admin could leave and nobody would be
-- left able to approve requests or change anything. Now, if the person
-- leaving is the founder, the team passes to the longest-standing admin, or
-- failing that the longest-standing member, who is made admin. The last
-- person out still deletes the team, as before.
create or replace function public.leave_league(p_league_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
  v_remaining int;
  v_heir uuid;
  v_deleted boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from league_members
  where league_id = p_league_id and user_id = v_user_id;

  select count(*) into v_remaining
  from league_members
  where league_id = p_league_id and status = 'active';

  if v_remaining = 0 then
    delete from notifications where league_id = p_league_id;
    update league_vs_league_challenges set winner_league_id = null where winner_league_id = p_league_id;
    delete from leagues where id = p_league_id;
    return true;
  end if;

  -- Someone must always be able to run the team.
  if not exists (
    select 1 from league_members
    where league_id = p_league_id and status = 'active' and role = 'admin'
  ) or exists (
    select 1 from leagues where id = p_league_id and created_by = v_user_id
  ) then
    select user_id into v_heir
    from league_members
    where league_id = p_league_id and status = 'active'
    order by (role = 'admin') desc, joined_at asc nulls last
    limit 1;

    update league_members set role = 'admin'
    where league_id = p_league_id and user_id = v_heir;

    update leagues set created_by = v_heir
    where id = p_league_id and created_by = v_user_id;
  end if;

  return v_deleted;
end;
$$;

-- 6. The founder can't be demoted or removed by another admin ---------------
-- The founder can still leave (their own row) and hand over (which makes the
-- new founder admin first). Rows removed because the whole team is being
-- deleted are let through.
create or replace function public.guard_league_founder()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_founder uuid;
begin
  select created_by into v_founder from leagues where id = old.league_id;
  if v_founder is null or old.user_id <> v_founder then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if auth.uid() = old.user_id or auth.uid() is null then return old; end if;
    raise exception 'The founder can''t be removed from the team';
  end if;

  if new.role <> 'admin' and auth.uid() is distinct from old.user_id then
    raise exception 'The founder can''t be removed as an admin';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_league_founder on public.league_members;
create trigger guard_league_founder
  before update of role or delete on public.league_members
  for each row execute function public.guard_league_founder();

grant execute on function public.reset_league_invite_code(uuid) to authenticated;
grant execute on function public.transfer_league_founder(uuid, uuid) to authenticated;
grant execute on function public.delete_league(uuid) to authenticated;
