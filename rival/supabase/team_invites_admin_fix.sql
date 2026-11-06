-- Team admins are role = 'admin'; the is_admin column is false on every row.
-- Corrects two functions from team_invites.sql.

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
