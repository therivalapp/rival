-- Opponent's copy of a match result (Ricky, 2026-11-02).
--
-- Tagging the opponent on a tennis (or other racket) result works like tagging
-- a training partner: they confirm, and accept_activity_tag copies the
-- activity to them. Until now the copy left out the stats column, so the
-- opponent's copy had no result. This adds one thing to that copy: the result,
-- turned round for them.
--
--   won <-> lost (drawn stays drawn), each set's [you, them] swapped, and the
--   opponent named as the person who logged it.
--
-- Nothing else from stats is copied (steps, rounds and so on are the owner's
-- own numbers). Everything else in the function is unchanged, word for word.
-- No table changes; existing activities are not touched.
--
-- RUN 2026-11-02 with Ricky's approval; verified: function updated, still
-- security definer, authenticated can execute. Old version saved to the
-- session scratchpad (accept_activity_tag_before.sql).

create or replace function public.accept_activity_tag(p_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  tag activity_participants%rowtype;
  src activities%rowtype;
  new_id uuid;
  joiner_name text;
  owner_name text;
  mirrored jsonb;
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

  -- A match result, seen from the other side of the net.
  if src.stats ? 'result' then
    select display_name into owner_name from users where id = src.user_id;
    mirrored := jsonb_build_object('result', jsonb_build_object(
      'outcome', case src.stats->'result'->>'outcome' when 'won' then 'lost' when 'lost' then 'won' else 'drawn' end,
      'opponent', coalesce(owner_name, 'A teammate'),
      'opponentId', src.user_id,
      'sets', coalesce((
        select jsonb_agg(jsonb_build_array(e->1, e->0) order by n)
          from jsonb_array_elements(src.stats->'result'->'sets') with ordinality as x(e, n)
      ), '[]'::jsonb)
    ));
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
    location, shared_from_activity_id, stats
  ) values (
    tag.user_id,
    'shared',
    -- Deterministic, so the per-user unique index makes a second copy of the
    -- same session impossible even if this is somehow called twice at once.
    'shared:' || src.id::text,
    src.activity_type, src.started_at,
    src.duration_seconds, src.distance_meters, src.elevation_meters, src.avg_heart_rate,
    src.intensity_zone, src.raw_effort_score, src.effort_score, src.name, src.route_polyline,
    src.location, src.id, mirrored
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
