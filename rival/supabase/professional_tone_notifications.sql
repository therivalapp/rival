-- Professional tone for notification copy the database writes (Ricky, 2026-09-24:
-- "Apply this professional tone over the entire app").
--
-- Copy only: each function below is its live definition with nothing changed
-- except the user-facing strings. No schema, data or logic changes.
--
--   "Sandy respected your effort"        -> "Sandy gave Respect"
--   "Sandy was inspired by your effort"  -> "Sandy was Inspired by an activity"
--   "Sandy commented on your effort"     -> "Sandy commented on your Effort"
--   "You joined X" / "Your effort now counts towards the team."
--                                        -> "Joined X" / "Your Effort now counts towards the Team."
--   "That was a short one"               -> "Short activity recorded"
--   "Sandy says you were there"          -> "Sandy added you to an activity"
--   "Ricky confirmed they were there"    -> "Ricky confirmed the activity"
--
-- Existing inbox items keep the wording they were written with; this changes
-- new ones only.

begin;

-- inbox_on_reaction
CREATE OR REPLACE FUNCTION public.inbox_on_reaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- inbox_on_comment
CREATE OR REPLACE FUNCTION public.inbox_on_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- inbox_on_membership
CREATE OR REPLACE FUNCTION public.inbox_on_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- inbox_on_short_activity
CREATE OR REPLACE FUNCTION public.inbox_on_short_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(new.duration_seconds, 0) <= 0
     or new.duration_seconds >= 180
     or lower(coalesce(new.provider, '')) not in ('strava', 'garmin')
     or new.short_review_dismissed_at is not null then
    return new;
  end if;

  insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
  values (
    new.user_id,
    'short_activity',
    null,
    null,
    'activity',
    new.id::text,
    'Short activity recorded',
    coalesce(new.name, new.activity_type) || ' · ' || new.duration_seconds || ' seconds'
  )
  on conflict do nothing;

  return new;
exception when others then
  -- An import must never fail because we could not raise a question about it.
  return new;
end;
$function$;

-- inbox_on_activity_tag
CREATE OR REPLACE FUNCTION public.inbox_on_activity_tag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor_name text;
  a record;
  detail text;
begin
  select rival_first_name(display_name) into actor_name from users where id = new.added_by;
  select activity_type, duration_seconds, distance_meters, effort_score
    into a from activities where id = new.activity_id;

  -- Enough to recognise the session without opening it — what it was, how long
  -- it took, what it is worth. Someone answering this is remembering a
  -- morning, and these are the details that bring it back.
  detail := coalesce(a.activity_type, 'Activity');
  if coalesce(a.duration_seconds, 0) > 0 then
    detail := detail || ' · ' || round(a.duration_seconds / 60.0) || ' min';
  end if;
  if coalesce(a.distance_meters, 0) >= 100 then
    detail := detail || ' · ' || to_char(a.distance_meters / 1000.0, 'FM990.0') || ' km';
  end if;
  detail := detail || ' · ' || coalesce(a.effort_score, 0) || ' Effort';

  insert into inbox_items (user_id, kind, actor_id, subject_type, subject_id, title, body)
  values (
    new.user_id,
    'activity_tag',
    new.added_by,
    'activity_participant',
    new.id::text,
    -- Wording chosen by Ricky in the copy review (2026-09-25).
    actor_name || ' added you to an activity',
    detail
  )
  on conflict do nothing;

  return new;
exception when others then
  -- A tag that fails to notify is still a tag; it will be found in the app.
  return new;
end;
$function$;

-- accept_activity_tag
CREATE OR REPLACE FUNCTION public.accept_activity_tag(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tag activity_participants%rowtype;
  src activities%rowtype;
  new_id uuid;
  joiner_name text;
begin
  select * into tag from activity_participants where id = p_id;
  if not found or tag.user_id <> auth.uid() then
    raise exception 'That is not yours to answer';
  end if;

  -- Already settled. Idempotent rather than an error: a double tap on a slow
  -- connection should not read as a failure.
  if tag.status <> 'pending' then
    return tag.created_activity_id;
  end if;

  select * into src from activities where id = tag.activity_id;
  if not found then
    raise exception 'That activity no longer exists';
  end if;

  -- Copied, never recalculated. Effort depends on what was done — type,
  -- duration, distance, climb — not on who did it, so the same session is
  -- worth the same to both people by construction. Recomputing here would let
  -- the two rows drift apart the next time the scoring table is tuned.
  --
  -- Deliberately NOT copied: the photo (theirs, and it may have their face in
  -- it), the journal, the pin, any PB or race flag. Those are the owner's
  -- record of the day, not facts about the session.
  insert into activities (
    user_id, provider, provider_activity_id, activity_type, started_at,
    duration_seconds, distance_meters, elevation_meters, avg_heart_rate,
    intensity_zone, raw_effort_score, effort_score, name, route_polyline,
    location, shared_from_activity_id
  ) values (
    tag.user_id,
    'shared',
    -- Deterministic, so the per-user unique index makes a second copy of the
    -- same session impossible even if this is somehow called twice at once.
    'shared:' || src.id::text,
    src.activity_type, src.started_at,
    src.duration_seconds, src.distance_meters, src.elevation_meters, src.avg_heart_rate,
    src.intensity_zone, src.raw_effort_score, src.effort_score, src.name, src.route_polyline,
    src.location, src.id
  )
  on conflict (user_id, provider, provider_activity_id) do nothing
  returning id into new_id;

  if new_id is null then
    select id into new_id from activities
     where user_id = tag.user_id and provider = 'shared'
       and provider_activity_id = 'shared:' || src.id::text;
  end if;

  update activity_participants
     set status = 'accepted', responded_at = now(), created_activity_id = new_id
   where id = p_id;

  perform sync_activity_companions(src.id);

  -- Close the loop for the person who asked. They did the work of tagging;
  -- they should not have to go looking to find out whether it landed.
  select rival_first_name(display_name) into joiner_name from users where id = tag.user_id;
  begin
    insert into inbox_items (user_id, kind, actor_id, subject_type, subject_id, title, body)
    values (
      src.user_id, 'tag_accepted', tag.user_id, 'activity', src.id::text,
      joiner_name || ' confirmed the activity',
      coalesce(src.name, src.activity_type)
    )
    on conflict do nothing;
  exception when others then
    null;
  end;

  return new_id;
end;
$function$;

commit;
