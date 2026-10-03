-- Weekly wins: each team's weekly leader, recorded once per finished week
-- (approved by Ricky 2026-10-01). Shown as the number in the laurel on the
-- first-place pillar on Today: how many weeks that person finished first in
-- that team. A total that only grows, never a streak that can be lost.
--
-- Filled lazily, no cron: Today calls weekly_wins(team ids), which records any
-- finished weeks not yet recorded and returns the totals. The two most recent
-- finished weeks are recounted on every call, so an activity synced or added
-- late still lands in the right week; older weeks are settled.
--
-- Rules, the same as the live board:
--   * a week runs Monday to Sunday on the team's clock (below);
--   * Effort is the sum of effort_score over the week, per active member;
--   * only people who had joined by the end of that week can win it;
--   * a tie for first records everyone tied; a week nobody scored records no one;
--   * weeks before the team was created are never counted.
--
-- The team's clock: its creator's saved time zone, or else the time zone of
-- whoever first opens Today after this runs, fixed from then on so every
-- teammate sees the same record.
--
-- New tables only; nothing existing is changed.

begin;

create table if not exists weekly_wins (
  league_id uuid not null references leagues(id) on delete cascade,
  week_start date not null,
  user_id uuid not null references users(id) on delete cascade,
  effort numeric not null,
  primary key (league_id, week_start, user_id)
);
create index if not exists weekly_wins_user_idx on weekly_wins (user_id);

create table if not exists weekly_wins_progress (
  league_id uuid primary key references leagues(id) on delete cascade,
  through_week date not null,
  time_zone text not null
);

alter table weekly_wins enable row level security;
alter table weekly_wins_progress enable row level security;

-- Teammates can read their team's record. Nobody writes directly: only the
-- function below does.
drop policy if exists "weekly_wins_select_members" on weekly_wins;
create policy "weekly_wins_select_members" on weekly_wins
  for select using (is_league_member(league_id));

create or replace function weekly_wins(p_league_ids uuid[], p_time_zone text default null)
returns table (league_id uuid, user_id uuid, wins integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  lid uuid;
  tz text;
  done date;
  first_week date;
  last_week date;
  from_week date;
begin
  foreach lid in array coalesce(p_league_ids, '{}') loop
    if not is_league_member(lid) then
      continue;
    end if;

    select p.through_week, p.time_zone into done, tz
      from weekly_wins_progress p where p.league_id = lid;

    if tz is null then
      select u.timezone into tz
        from leagues l join users u on u.id = l.created_by
       where l.id = lid;
      if tz is null or not exists (select 1 from pg_timezone_names where name = tz) then
        tz := case when exists (select 1 from pg_timezone_names where name = p_time_zone)
                   then p_time_zone else 'UTC' end;
      end if;
    end if;

    last_week := (date_trunc('week', now() at time zone tz))::date - 7;
    select (date_trunc('week', l.created_at at time zone tz))::date into first_week
      from leagues l where l.id = lid;

    from_week := greatest(first_week, least(coalesce(done + 7, first_week), last_week - 7));

    if from_week <= last_week then
      delete from weekly_wins w where w.league_id = lid and w.week_start >= from_week;

      insert into weekly_wins (league_id, week_start, user_id, effort)
      select lid, s.ws, s.uid, s.effort
        from (
          select w.ws, m.user_id as uid, sum(a.effort_score) as effort,
                 max(sum(a.effort_score)) over (partition by w.ws) as top
            from (select g::date as ws
                    from generate_series(from_week::timestamp, last_week::timestamp, interval '7 days') g) w
            join league_members m
              on m.league_id = lid
             and m.status = 'active'
             and m.joined_at < ((w.ws + 7)::timestamp at time zone tz)
            join activities a
              on a.user_id = m.user_id
             and a.started_at >= (w.ws::timestamp at time zone tz)
             and a.started_at < ((w.ws + 7)::timestamp at time zone tz)
           group by w.ws, m.user_id
        ) s
       where s.effort > 0 and s.effort = s.top
      on conflict do nothing;
    end if;

    insert into weekly_wins_progress (league_id, through_week, time_zone)
    values (lid, last_week, tz)
    on conflict on constraint weekly_wins_progress_pkey do update
      set through_week = greatest(weekly_wins_progress.through_week, excluded.through_week);
  end loop;

  return query
    select w.league_id, w.user_id, count(*)::integer
      from weekly_wins w
     where w.league_id = any(p_league_ids) and is_league_member(w.league_id)
     group by w.league_id, w.user_id;
end;
$$;

revoke all on function weekly_wins(uuid[], text) from public;
grant execute on function weekly_wins(uuid[], text) to authenticated;

commit;
