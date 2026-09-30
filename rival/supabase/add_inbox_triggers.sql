-- Fills the inbox. Nothing here is callable by the client.
--
-- These are SECURITY DEFINER so a trigger can write the RECIPIENT's inbox row
-- while the person who caused it holds no permission to write anyone's inbox.
-- Doing this from the app instead would mean granting insert-for-anyone, which
-- is a spam primitive.
--
-- Every trigger is written to never break the action that fired it: a failure
-- to notify must not stop a reaction being saved. Hence the exception guard —
-- an inbox row is worth less than the thing it describes.

begin;

-- Resolves who should hear about activity on a feed target. Returns null when
-- there is nobody to tell, which the callers treat as "skip quietly".
create or replace function inbox_target_owner(p_target_type text, p_target_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  -- A day's walk rollup is synthetic and spans several activities, so its owner
  -- is encoded in the id rather than found by lookup: "roll:<user>:<date>".
  if p_target_type = 'day_roll' then
    return nullif(split_part(p_target_id, ':', 2), '')::uuid;
  end if;

  -- Anything else is a real row, but target_id is text and can hold a
  -- non-uuid, so a bad value must not raise and kill the write that fired us.
  begin
    if p_target_type = 'activity' then
      select user_id into owner_id from activities where id = p_target_id::uuid;
    elsif p_target_type = 'race' then
      select user_id into owner_id from races where id = p_target_id::uuid;
    elsif p_target_type = 'board' then
      select user_id into owner_id from league_messages where id = p_target_id::uuid;
    end if;
  exception when others then
    return null;
  end;

  return owner_id;
end;
$$;

create or replace function inbox_on_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  actor_name text;
begin
  owner_id := inbox_target_owner(new.target_type, new.target_id);
  -- Nobody to tell, or you reacted to your own — neither is worth an item.
  if owner_id is null or owner_id = new.user_id then
    return new;
  end if;

  select coalesce(display_name, 'A teammate') into actor_name from users where id = new.user_id;

  insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
  values (
    owner_id,
    'reaction',
    new.user_id,
    new.league_id,
    new.target_type,
    new.target_id,
    -- Stored as the display copy, not the stored value: the database keeps
    -- 'respect' and 'inspired', the app says Respect and Inspired.
    actor_name || (case when new.emoji = 'inspired' then ' was Inspired by an activity' else ' gave Respect' end),
    null
  )
  on conflict do nothing;

  return new;
exception when others then
  -- Never let a missing notification cost someone their reaction.
  return new;
end;
$$;

create or replace function inbox_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  actor_name text;
begin
  owner_id := inbox_target_owner(new.target_type, new.target_id);
  if owner_id is null or owner_id = new.user_id then
    return new;
  end if;

  select coalesce(display_name, 'A teammate') into actor_name from users where id = new.user_id;

  insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
  values (
    owner_id,
    'comment',
    new.user_id,
    new.league_id,
    new.target_type,
    new.target_id,
    actor_name || ' commented on your Effort',
    left(new.body, 140)
  )
  on conflict do nothing;

  return new;
exception when others then
  return new;
end;
$$;

-- Join requests go to every admin of the team; the approval itself goes back to
-- the person who asked.
create or replace function inbox_on_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_name text;
  actor_name text;
  admin_id uuid;
begin
  select name into team_name from leagues where id = new.league_id;
  select coalesce(display_name, 'Someone') into actor_name from users where id = new.user_id;

  -- A new pending row is a request to join: tell the admins, who are the only
  -- people who can answer it.
  if tg_op = 'INSERT' and new.status = 'pending' then
    for admin_id in
      select user_id from league_members
      where league_id = new.league_id and is_admin and status = 'active'
    loop
      insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
      values (
        admin_id, 'join_request', new.user_id, new.league_id,
        'league_member', new.id::text,
        actor_name || ' asked to join ' || coalesce(team_name, 'the Team'),
        null
      )
      on conflict do nothing;
    end loop;
    return new;
  end if;

  -- Approved: tell the person who asked, and close the admins' open requests so
  -- the item does not sit there offering a decision that has already been made.
  if tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    update inbox_items
       set resolved_at = now(), resolution = 'acted'
     where kind = 'join_request' and subject_id = new.id::text and resolved_at is null;

    insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
    values (
      new.user_id, 'team_joined', null, new.league_id,
      'league', new.league_id::text,
      'Joined ' || coalesce(team_name, 'a team'),
      'Your Effort now counts towards the Team.'
    )
    on conflict do nothing;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists inbox_reaction_trigger on feed_reactions;
create trigger inbox_reaction_trigger
  after insert on feed_reactions
  for each row execute function inbox_on_reaction();

drop trigger if exists inbox_comment_trigger on feed_comments;
create trigger inbox_comment_trigger
  after insert on feed_comments
  for each row execute function inbox_on_comment();

drop trigger if exists inbox_membership_trigger on league_members;
create trigger inbox_membership_trigger
  after insert or update on league_members
  for each row execute function inbox_on_membership();

commit;
