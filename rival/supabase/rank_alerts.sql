-- Unrivaled alerts (Ricky, 2026-10-18): tell Ricky, in his inbox, when anyone
-- first comes close to Unrivaled this year and when they reach it.
--
-- Checked on every activity saved or rescored, whatever brought it in (Strava,
-- an archive import, a manual entry), by a trigger: the year's Effort is
-- summed in the person's own time zone, as the app does. rank_alerts records
-- who has already been reported, so each alert is sent once per person per
-- year. Like the other inbox triggers, a failure here never stops the
-- activity being saved.
--
-- Unrivaled starts at 39,000 (lib/xp.ts LEVELS; season-rollover keeps a copy).

begin;

create table if not exists rank_alerts (
  user_id uuid not null references users(id) on delete cascade,
  year int not null,
  kind text not null check (kind in ('near', 'reached')),
  effort int not null,
  created_at timestamptz not null default now(),
  primary key (user_id, year, kind)
);

-- Nobody reads or writes this from the app; only the trigger below.
alter table rank_alerts enable row level security;

alter table inbox_items drop constraint inbox_items_kind_check;
alter table inbox_items add constraint inbox_items_kind_check check (kind = any (array[
  'reaction', 'comment', 'join_request', 'short_activity', 'team_joined',
  'activity_tag', 'tag_accepted', 'pace_review', 'rank_alert'
]));

create or replace function rank_alert_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient constant uuid := '09b2e197-8257-4d7c-a0e6-12dc0429eeff'; -- Ricky
  near_at constant int := 35000;
  unrivaled_at constant int := 39000;
  tz text;
  yr int;
  year_start timestamptz;
  total int;
  who text;
  k text;
begin
  select coalesce(timezone, 'UTC'), coalesce(display_name, 'Someone') into tz, who
    from users where id = new.user_id;
  yr := extract(year from now() at time zone tz)::int;
  year_start := make_timestamp(yr, 1, 1, 0, 0, 0) at time zone tz;
  -- An activity from an earlier year can't move this year's rank.
  if new.started_at < year_start then return new; end if;

  select coalesce(sum(effort_score), 0)::int into total
    from activities where user_id = new.user_id and started_at >= year_start;
  if total < near_at then return new; end if;

  foreach k in array array['near', 'reached'] loop
    continue when k = 'reached' and total < unrivaled_at;
    -- Reaching it in one go reports only that, not "close" as well.
    continue when k = 'near' and total >= unrivaled_at;
    insert into rank_alerts (user_id, year, kind, effort)
      values (new.user_id, yr, k, total)
      on conflict do nothing;
    if found then
      insert into inbox_items (user_id, kind, actor_id, subject_type, subject_id, title, body)
      values (
        recipient, 'rank_alert', new.user_id, 'rank', k || ':' || yr || ':' || new.user_id,
        case k when 'near' then who || ' is close to Unrivaled' else who || ' reached Unrivaled' end,
        case k
          when 'near' then to_char(total, 'FM999,999') || ' Effort this year, ' || to_char(unrivaled_at - total, 'FM999,999') || ' to go.'
          else to_char(total, 'FM999,999') || ' Effort this year.'
        end
      )
      on conflict do nothing;
    end if;
  end loop;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists rank_alert_on_activity on activities;
create trigger rank_alert_on_activity
  after insert or update of effort_score, started_at on activities
  for each row execute function rank_alert_check();

commit;
