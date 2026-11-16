-- How an event is ranked (Ricky, 2026-11-15, Mockup 85 v2): to the finish
-- (a time), backyard (yards: 6.7 km loops, one every hour) or a set time
-- (distance in 6 or 24 hours). Existing events are to the finish.
alter table races add column if not exists format text not null default 'finish'
  check (format in ('finish', 'backyard', 'timed'));
