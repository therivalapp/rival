-- The machinery behind tagging a training partner. See
-- add_activity_sharing.sql for why the feature is shaped the way it is.
--
-- The one rule worth stating up front: the client never writes the numbers.
-- Accepting a tag calls accept_activity_tag(), which copies duration, distance
-- and Effort from the original row inside the database. If the app assembled
-- that insert itself, "I was there too" would become "here is an activity with
-- whatever Effort I typed", and the whole point of the second signature would
-- be lost.

begin;

-- First name only. Cards and notifications name people the way a teammate
-- would out loud — "with Sandy", not "with Sandy Fitzgerald" — matching how
-- Home already writes "Sandy, Emma and 3 others".
create or replace function rival_first_name(full_name text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(split_part(coalesce(full_name, ''), ' ', 1), ''), 'A teammate');
$$;

-- "Sandy", "Sandy and Emma", "Sandy, Emma and Tom". Reads the way a person
-- would say it out loud, which is the standard for anything that appears on a
-- card rather than in a table.
create or replace function rival_name_list(names text[])
returns text
language sql
immutable
as $$
  select case
    when names is null or cardinality(names) = 0 then null
    when cardinality(names) = 1 then names[1]
    else array_to_string(names[1:cardinality(names) - 1], ', ') || ' and ' || names[cardinality(names)]
  end;
$$;

-- Keeps activities.companions in step with who actually confirmed.
--
-- That column used to be free text somebody typed into the journal. It is now
-- derived: the session knows who was on it, so the card should not depend on
-- anyone remembering to write it down. Each person's own row lists the OTHERS
-- — your card says who you were with, not who you are.
create or replace function sync_activity_companions(p_source uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  owner_name text;
  confirmed record;
  everyone jsonb := '[]'::jsonb;
begin
  select user_id into owner_id from activities where id = p_source;
  if owner_id is null then
    return;
  end if;

  select rival_first_name(display_name) into owner_name from users where id = owner_id;
  everyone := everyone || jsonb_build_object('id', owner_id, 'name', owner_name);

  for confirmed in
    select p.user_id, rival_first_name(u.display_name) as name, p.created_activity_id
      from activity_participants p
      join users u on u.id = p.user_id
     where p.activity_id = p_source and p.status = 'accepted'
     order by p.created_at
  loop
    everyone := everyone || jsonb_build_object('id', confirmed.user_id, 'name', confirmed.name);
  end loop;

  -- One person on the session means nobody to name — and it must still run,
  -- so that removing the last tag clears the line rather than leaving a stale
  -- name on the card.
  update activities
     set companions = (
       select rival_name_list(array_agg(e->>'name' order by ord))
         from jsonb_array_elements(everyone) with ordinality t(e, ord)
        where (e->>'id')::uuid <> owner_id
     )
   where id = p_source;

  for confirmed in
    select p.user_id, p.created_activity_id
      from activity_participants p
     where p.activity_id = p_source and p.status = 'accepted' and p.created_activity_id is not null
  loop
    update activities
       set companions = (
         select rival_name_list(array_agg(e->>'name' order by ord))
           from jsonb_array_elements(everyone) with ordinality t(e, ord)
          where (e->>'id')::uuid <> confirmed.user_id
       )
     where id = confirmed.created_activity_id;
  end loop;
end;
$$;

-- A tag has been made: ask the person about it.
--
-- SECURITY DEFINER for the same reason every other inbox trigger is — the
-- person tagging must not hold permission to write anybody's inbox directly.
create or replace function inbox_on_activity_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- Confirm a tag, and take the session on as your own.
--
-- Returns the new activity's id. Raises rather than returning quietly on a bad
-- caller: this is the one place Effort is created without a device behind it,
-- so it should fail loudly if its preconditions do not hold.
create or replace function accept_activity_tag(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- Removing a tag removes what it created.
--
-- Anything else makes "remove" cosmetic: the Effort would stay on the
-- leaderboard after the person who vouched for it withdrew.
--
-- Two cases must NOT delete the copy, and both are handled by the checks here:
--
--   * The original activity was deleted, cascading this row away. The session
--     still happened, and the tagged person's record of it is theirs to keep.
--     By the time this fires the parent row is already gone, which is exactly
--     what the existence check tests for.
--   * Their own recording of the session has since arrived and merged into
--     this row — the cross-source matcher in _shared/activityDedup.ts
--     recognises it and overwrites the copy with the real data. The provider
--     check catches that: it is no longer a copy, it is their own activity,
--     and deleting it would destroy a real recording.
create or replace function on_activity_tag_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.created_activity_id is not null
     and exists (select 1 from activities where id = old.activity_id) then
    delete from activities
     where id = old.created_activity_id
       and provider = 'shared';
  end if;

  -- An unanswered question about something that no longer exists should stop
  -- being asked.
  update inbox_items
     set resolved_at = now(), resolution = 'expired'
   where kind = 'activity_tag' and subject_id = old.id::text and resolved_at is null;

  if exists (select 1 from activities where id = old.activity_id) then
    perform sync_activity_companions(old.activity_id);
  end if;

  return old;
exception when others then
  return old;
end;
$$;

-- If somebody deletes their own shared copy, the tag it came from is spent.
-- Without this the tag would sit there marked accepted, pointing at nothing,
-- and still naming them on the owner's card.
create or replace function on_shared_copy_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tag_id uuid;
begin
  -- BEFORE, not AFTER: the foreign key's ON DELETE SET NULL would otherwise
  -- have already erased the link this needs to find the row by.
  select id into tag_id from activity_participants where created_activity_id = old.id;
  if tag_id is null then
    return old;
  end if;

  -- Clearing the link before deleting the tag is not tidiness. The tag's own
  -- delete trigger deletes the copy it created — which is this row, already
  -- mid-delete — and the two would chase each other. A null link makes that
  -- trigger skip the part that has already happened.
  update activity_participants set created_activity_id = null where id = tag_id;
  delete from activity_participants where id = tag_id;
  return old;
exception when others then
  return old;
end;
$$;

drop trigger if exists activity_tag_inbox_trigger on activity_participants;
create trigger activity_tag_inbox_trigger
  after insert on activity_participants
  for each row execute function inbox_on_activity_tag();

drop trigger if exists activity_tag_removed_trigger on activity_participants;
create trigger activity_tag_removed_trigger
  after delete on activity_participants
  for each row execute function on_activity_tag_removed();

drop trigger if exists shared_copy_deleted_trigger on activities;
create trigger shared_copy_deleted_trigger
  before delete on activities
  for each row when (old.shared_from_activity_id is not null)
  execute function on_shared_copy_deleted();

commit;
