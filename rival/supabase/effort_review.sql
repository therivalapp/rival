-- Effort review: the athlete has the final say on an activity that looks
-- faster than possible (approved by Ricky 2026-10-01 after a board review).
--
-- Effort still credits distance up to each sport's fastest realistic pace,
-- and climbing up to 2,500 m an hour. When an activity goes past either, the
-- athlete is asked to review it (inbox and the Effort breakdown). They can
-- edit the distance, or confirm it is correct. Confirming sets this flag,
-- and from then on the activity scores in full, with no cap, including when
-- Strava re-syncs it.
--
-- Nothing else changes: no existing activity goes past a cap today
-- (0 of 504 checked 2026-10-01), so every row keeps false and its score.
-- Owners can already update their own activities (existing RLS), which is
-- all confirming needs.

alter table activities
  add column if not exists effort_confirmed boolean not null default false;
