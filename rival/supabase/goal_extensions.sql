-- Goals: let an ended goal be extended (2026-09-30).
-- Records the total days added, so the history can say
-- "Completed, extended 5 days" rather than pretend it was on time.
-- Additive only: existing goals get 0 and nothing else changes.
-- The existing "Users manage own goals" policy (ALL, own rows) already
-- covers the update, so no policy change.

alter table goals
  add column if not exists extended_days integer not null default 0;

alter table goals
  add constraint goals_extended_days_range check (extended_days between 0 and 365);
