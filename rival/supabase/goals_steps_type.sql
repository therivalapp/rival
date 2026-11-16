-- Steps goals (Mockup 52, Ricky approved 2026-11-14): a daily or weekly step
-- target filled from Apple Health on the phone. Steps never add Effort (board
-- 2026-11-14, 8/10). This only adds 'steps' to the allowed goal types; no
-- existing goal changes. period_type 'day' is new for steps (no check on it).

alter table public.goals drop constraint goals_goal_type_check;
alter table public.goals add constraint goals_goal_type_check check (goal_type = any (array[
  'distance', 'elevation', 'gym_sessions', 'fastest_time', 'pace', 'longest_distance', 'lift',
  'event_time', 'weekly_rhythm', 'variety', 'time_earned', 'effort', 'total_reps', 'total_weight',
  'steps'
]));
