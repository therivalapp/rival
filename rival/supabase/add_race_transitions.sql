-- Transition times for events with legs (Ricky, 2026-11-05,
-- design/event-transitions-mockup.png).
--
-- races.transitions: the seconds between each leg and the next, in order.
-- A triathlon has two: [T1, T2], e.g. [168, 166]. A gap nobody entered is
-- null. Events without legs leave the column null.
--
-- Adds one column to an existing table. No existing row changes, so the
-- table's grants and row-level security rules already cover it.

alter table public.races
  add column if not exists transitions jsonb;

comment on column public.races.transitions is
  'Seconds between each leg and the next, in order ([T1, T2] for a triathlon); null where not entered.';
