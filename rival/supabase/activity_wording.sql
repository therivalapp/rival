-- Say "activity", never "session" (Ricky, 2026-09-25). The one place the
-- database words this itself: the fallback name on an "added you to an
-- activity" inbox item when the activity has no type. Same function as live,
-- with only that word changed.
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
