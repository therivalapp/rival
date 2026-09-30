-- Where each person is, so a season can end at midnight on 1 January in their
-- own time zone rather than at midnight UTC (which is the evening of
-- 31 December across Canada and the US, and midday on 1 January in NZ).
--
-- The app records the device's IANA zone ("America/Toronto") when Home loads.
-- Nullable: anyone who has not opened the app since this shipped falls back to
-- UTC in season-rollover, which is exactly the behaviour before this change.

begin;

alter table users add column if not exists timezone text;

-- Guard against junk: a zone Postgres cannot resolve would make the rollover's
-- boundary calculation throw for that person.
create or replace function rival_valid_timezone(tz text)
returns boolean
language plpgsql
stable
as $$
begin
  if tz is null then
    return true;
  end if;
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

alter table users drop constraint if exists users_timezone_valid;
alter table users add constraint users_timezone_valid check (rival_valid_timezone(timezone));

commit;
