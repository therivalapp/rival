-- Feedback: a fourth type, Quote (Ricky, 2026-11-11).
-- Beta testers can send a daily quote they like from the Feedback pop-up.
-- Only widens the allowed values of feedback.kind; no rows change.
alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check
  check (kind in ('problem', 'idea', 'dislike', 'quote'));
