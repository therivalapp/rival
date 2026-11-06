-- Joining a team by invite: the new member names who invited them, that
-- teammate confirms, and the admin keeps the final say (Ricky, 2026-11-01).
--
--   code + a teammate named  -> the teammate is asked; Confirm lets them in
--   Not me, or no reply in 48 hours -> the request moves to the admins
--   code + nobody named, or a request from Discover -> the admins, as before
--
-- Everyone on the team is told when someone joins. Someone declined is told
-- once, with no reason or name, and can ask that team again after a week.
--
-- join_league_with_code stays until the new app is live, then goes (see
-- team_invites_retire_code_join.sql): while it exists a code still walks in.

alter table league_members
  add column if not exists invited_by uuid references users(id) on delete set null,
  add column if not exists invite_state text check (invite_state in ('teammate', 'admin')),
  add column if not exists invite_sent_at timestamptz;

alter table inbox_items drop constraint inbox_items_kind_check;
alter table inbox_items add constraint inbox_items_kind_check check (kind = any (array[
  'reaction', 'comment', 'join_request', 'short_activity', 'team_joined', 'activity_tag',
  'tag_accepted', 'pace_review', 'rank_alert', 'join_confirm', 'join_declined'
]));

-- Puts a pending request in front of whoever answers it now.
create or replace function notify_join_request(p_member uuid, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  m league_members%rowtype;
  team_name text;
  actor_name text;
begin
  select * into m from league_members where id = p_member;
  if m.id is null or m.status <> 'pending' then return; end if;
  select name into team_name from leagues where id = m.league_id;
  select coalesce(display_name, 'Someone') into actor_name from users where id = m.user_id;

  if m.invite_state = 'teammate' and m.invited_by is not null then
    insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
    values (m.invited_by, 'join_confirm', m.user_id, m.league_id, 'league_member', m.id::text,
            'Did you invite ' || actor_name || '?',
            'Wants to join ' || coalesce(team_name, 'the Team') || '.')
    on conflict do nothing;
  else
    insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
    select user_id, 'join_request', m.user_id, m.league_id, 'league_member', m.id::text,
           actor_name || ' asked to join',
           coalesce(team_name, 'The Team') || ' · ' || coalesce(p_note, 'No invite')
    from league_members
    where league_id = m.league_id and role = 'admin' and status = 'active'
    on conflict do nothing;
  end if;
end;
$$;

-- Requests, joins and the whole-team notice.
create or replace function inbox_on_membership()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  team_name text;
  actor_name text;
  inviter_name text;
  creator uuid;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform notify_join_request(new.id);
    return new;
  end if;

  select name, created_by into team_name, creator from leagues where id = new.league_id;

  if tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    update inbox_items
       set resolved_at = now(), resolution = 'acted'
     where kind in ('join_request', 'join_confirm') and subject_id = new.id::text and resolved_at is null;

    insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
    values (new.user_id, 'team_joined', null, new.league_id, 'league', new.league_id::text,
            'Joined ' || coalesce(team_name, 'a team'),
            'Your Effort now counts towards the Team.')
    on conflict do nothing;
  end if;

  if (tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active')
     or (tg_op = 'INSERT' and new.status = 'active' and new.user_id is distinct from creator) then
    select coalesce(display_name, 'Someone') into actor_name from users where id = new.user_id;
    select display_name into inviter_name from users where id = new.invited_by;
    insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
    select user_id, 'team_joined', new.user_id, new.league_id, 'league_member', new.id::text,
           actor_name || ' joined ' || coalesce(team_name, 'the Team'),
           case when inviter_name is not null then 'Invited by ' || inviter_name end
    from league_members
    where league_id = new.league_id and status = 'active' and user_id <> new.user_id
    on conflict do nothing;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

-- Someone else removed a pending request: that is a decline.
create or replace function inbox_on_membership_removed()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  team_name text;
begin
  if old.status <> 'pending' then return old; end if;
  update inbox_items
     set resolved_at = now(), resolution = 'acted'
   where kind in ('join_request', 'join_confirm') and subject_id = old.id::text and resolved_at is null;
  if auth.uid() is null or auth.uid() = old.user_id then return old; end if;
  select name into team_name from leagues where id = old.league_id;
  insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
  values (old.user_id, 'join_declined', null, old.league_id, 'league_member', old.id::text,
          'Request not approved',
          coalesce(team_name, 'The team') || ' did not approve this request. Other teams are open to join in Discover.')
  on conflict do nothing;
  return old;
exception when others then
  return old;
end;
$$;

drop trigger if exists inbox_membership_removed_trigger on league_members;
create trigger inbox_membership_removed_trigger after delete on league_members
  for each row execute function inbox_on_membership_removed();

-- The team behind a code and who is on it, for "Who invited you?". The code is
-- the credential, as it is for joining.
create or replace function team_by_code(code text)
returns json language plpgsql stable security definer set search_path to 'public' as $$
declare
  target leagues%rowtype;
  mine league_members%rowtype;
begin
  if auth.uid() is null then return json_build_object('error', 'not_authenticated'); end if;
  select * into target from leagues where upper(invite_code) = upper(trim(code));
  if target.id is null then return json_build_object('error', 'invalid_code'); end if;
  select * into mine from league_members where league_id = target.id and user_id = auth.uid();
  return json_build_object(
    'league_id', target.id,
    'name', target.name,
    'logo_url', target.logo_url,
    'status', mine.status,
    'invited_by', mine.invited_by,
    'members', coalesce((
      select json_agg(json_build_object(
        'user_id', m.user_id,
        'name', coalesce(u.display_name, 'Teammate'),
        'avatar_url', u.avatar_url,
        'is_admin', m.role = 'admin',
        'is_founder', m.user_id = target.created_by,
        'joined_at', m.joined_at,
        'year_effort', coalesce((
          select sum(a.effort_score) from activities a
          where a.user_id = m.user_id and a.started_at >= date_trunc('year', now())
        ), 0)
      ) order by u.last_active_at desc nulls last)
      from league_members m join users u on u.id = m.user_id
      where m.league_id = target.id and m.status = 'active'
    ), '[]'::json)
  );
end;
$$;

-- Send or change a request. p_inviter null means nobody invited them.
create or replace function request_to_join(code text, p_inviter uuid default null)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  target record;
  row_id uuid;
  row_status text;
  inviter uuid;
begin
  if auth.uid() is null then return json_build_object('error', 'not_authenticated'); end if;
  select id, name into target from leagues where upper(invite_code) = upper(trim(code));
  if target.id is null then return json_build_object('error', 'invalid_code'); end if;

  select id, status into row_id, row_status from league_members
   where league_id = target.id and user_id = auth.uid();
  if row_status = 'active' then
    return json_build_object('league_id', target.id, 'name', target.name, 'already_member', true);
  end if;

  if exists (select 1 from inbox_items
             where user_id = auth.uid() and kind = 'join_declined' and league_id = target.id
               and created_at > now() - interval '7 days') then
    return json_build_object('error', 'declined_recently');
  end if;

  select user_id into inviter from league_members
   where league_id = target.id and user_id = p_inviter and status = 'active' and user_id <> auth.uid();

  if row_id is null then
    insert into league_members (league_id, user_id, role, status, invited_by, invite_state, invite_sent_at)
    values (target.id, auth.uid(), 'member', 'pending', inviter,
            case when inviter is null then 'admin' else 'teammate' end, now());
  else
    -- Changed their mind about who to ask: the old question goes away.
    delete from inbox_items
     where kind in ('join_request', 'join_confirm') and subject_id = row_id::text and resolved_at is null;
    update league_members
       set invited_by = inviter,
           invite_state = case when inviter is null then 'admin' else 'teammate' end,
           invite_sent_at = now()
     where id = row_id;
    perform notify_join_request(row_id);
  end if;

  return json_build_object('league_id', target.id, 'name', target.name, 'already_member', false);
end;
$$;

-- The named teammate answers. Only they can.
create or replace function respond_to_join_confirm(p_member uuid, p_confirm boolean)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  m league_members%rowtype;
  who text;
begin
  select * into m from league_members where id = p_member;
  if m.id is null or m.status <> 'pending' or m.invite_state <> 'teammate' or m.invited_by is distinct from auth.uid() then
    update inbox_items set resolved_at = now(), resolution = 'dismissed'
     where kind = 'join_confirm' and subject_id = p_member::text and user_id = auth.uid() and resolved_at is null;
    return json_build_object('error', 'already_handled');
  end if;

  if p_confirm then
    update league_members set status = 'active' where id = m.id;
  else
    update inbox_items set resolved_at = now(), resolution = 'acted'
     where kind = 'join_confirm' and subject_id = m.id::text and resolved_at is null;
    update league_members set invite_state = 'admin' where id = m.id;
    select coalesce(display_name, 'A teammate') into who from users where id = auth.uid();
    perform notify_join_request(m.id, who || ' didn''t confirm');
  end if;
  return json_build_object('ok', true);
end;
$$;

-- No answer in 48 hours: the request moves to the admins, so nobody is stuck.
create or replace function escalate_join_confirms()
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  m league_members%rowtype;
  who text;
begin
  for m in
    select * from league_members
    where status = 'pending' and invite_state = 'teammate' and invite_sent_at < now() - interval '48 hours'
  loop
    update inbox_items set resolved_at = now(), resolution = 'expired'
     where kind = 'join_confirm' and subject_id = m.id::text and resolved_at is null;
    update league_members set invite_state = 'admin' where id = m.id;
    select coalesce(display_name, 'A teammate') into who from users where id = m.invited_by;
    perform notify_join_request(m.id, who || ' hasn''t replied in 48 hours');
  end loop;
end;
$$;

select cron.schedule('join-confirm-escalate', '0 * * * *', 'select escalate_join_confirms()');

revoke all on function notify_join_request(uuid, text) from public, anon, authenticated;
revoke all on function escalate_join_confirms() from public, anon, authenticated;
revoke all on function team_by_code(text) from public, anon;
revoke all on function request_to_join(text, uuid) from public, anon;
revoke all on function respond_to_join_confirm(uuid, boolean) from public, anon;
grant execute on function team_by_code(text) to authenticated;
grant execute on function request_to_join(text, uuid) to authenticated;
grant execute on function respond_to_join_confirm(uuid, boolean) to authenticated;
