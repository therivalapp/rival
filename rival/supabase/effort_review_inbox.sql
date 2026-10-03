-- Effort review, part 2: ask in the inbox (follows effort_review.sql).
--
-- When an activity's distance is faster than its sport's realistic top pace
-- (scoring_config.min_pace), or its climbing is faster than 2,500 m an hour,
-- the athlete gets a "Check an activity" item. They edit it, or confirm it is
-- correct (activities.effort_confirmed), and the item closes itself: this
-- trigger resolves it as soon as the activity is confirmed or no longer over.
-- Editing it back over a limit later asks again.
--
-- Same pattern as the short-activity question (add_inbox_short_activity.sql).
-- Shared copies are skipped: their numbers come from the owner's activity, and
-- the owner is the one asked. No existing activity is over a limit (0 of 548,
-- checked 2026-10-01), so nothing is raised when this runs.

begin;

alter table inbox_items drop constraint inbox_items_kind_check;
alter table inbox_items add constraint inbox_items_kind_check check (kind = any (array[
  'reaction', 'comment', 'join_request', 'short_activity', 'team_joined',
  'activity_tag', 'tag_accepted', 'pace_review'
]));

create or replace function inbox_on_pace_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg scoring_config%rowtype;
  minutes numeric := coalesce(new.duration_seconds, 0) / 60.0;
  hours numeric := coalesce(new.duration_seconds, 0) / 3600.0;
  over_distance boolean := false;
  over_climb boolean := false;
begin
  if new.shared_from_activity_id is not null then
    return new;
  end if;

  select * into cfg from scoring_config where activity_type = new.activity_type;
  if found then
    over_distance := cfg.distance_rate > 0 and cfg.min_pace > 0 and minutes > 0
      and coalesce(new.distance_meters, 0) / 1000.0 > minutes / cfg.min_pace + 0.005;
    over_climb := hours > 0 and cfg.elevation_rate > 0
      and coalesce(new.elevation_meters, 0) > greatest(hours * 2500, 1500) + 0.5;
  end if;

  if (over_distance or over_climb) and not new.effort_confirmed then
    insert into inbox_items (user_id, kind, actor_id, league_id, subject_type, subject_id, title, body)
    values (
      new.user_id,
      'pace_review',
      null,
      null,
      'activity',
      new.id::text,
      'Check an activity',
      coalesce(new.name, new.activity_type) || ' · '
        || case when over_distance then 'the distance is faster than a realistic pace'
                else 'the climbing is faster than 2,500 m an hour' end
    )
    on conflict (user_id, kind, coalesce(subject_id, ''), coalesce(actor_id, user_id))
    do update set resolved_at = null, resolution = null, read_at = null,
                  body = excluded.body, created_at = now();
  else
    update inbox_items
       set resolved_at = now(), resolution = 'acted'
     where user_id = new.user_id and kind = 'pace_review'
       and subject_id = new.id::text and resolved_at is null;
  end if;

  return new;
exception when others then
  -- Saving an activity must never fail because a question could not be raised.
  return new;
end;
$$;

drop trigger if exists inbox_pace_review_trigger on activities;
create trigger inbox_pace_review_trigger
  after insert or update of distance_meters, duration_seconds, elevation_meters, activity_type, effort_confirmed
  on activities
  for each row execute function inbox_on_pace_review();

commit;
