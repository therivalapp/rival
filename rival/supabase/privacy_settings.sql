-- Privacy settings (Mockup 34, approved 2026-11-11).
-- Three switches on users, readable by teammates so their phones can respect
-- them, and two functions for birthdays: the date of birth itself stays
-- unreadable by the app (lock_down_user_email.sql).

alter table users add column if not exists birthday_visible boolean not null default false;
alter table users add column if not exists chat_milestones boolean not null default true;
alter table users add column if not exists read_receipts boolean not null default true;

grant select (birthday_visible, chat_milestones, read_receipts) on users to authenticated;
grant update (birthday_visible, chat_milestones, read_receipts) on users to authenticated;

-- The signed-in member's own date of birth, for the Privacy page.
create or replace function my_birthday()
returns date
language sql stable security definer set search_path = public
as $$ select date_of_birth from users where id = auth.uid() $$;
revoke all on function my_birthday() from public, anon;
grant execute on function my_birthday() to authenticated;

-- Teammates' birthdays for the chat card: day and month only, never the
-- year, and only for members who turned "Teammates can see my birthday" on.
create or replace function team_birthdays(lid uuid)
returns table (user_id uuid, month int, day int)
language sql stable security definer set search_path = public
as $$
  select u.id, extract(month from u.date_of_birth)::int, extract(day from u.date_of_birth)::int
  from users u
  join league_members m on m.user_id = u.id and m.league_id = lid and m.status = 'active'
  where is_league_member(lid)
    and u.birthday_visible
    and u.date_of_birth is not null
$$;
revoke all on function team_birthdays(uuid) from public, anon;
grant execute on function team_birthdays(uuid) to authenticated;
