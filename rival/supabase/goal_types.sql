-- New Focus goal types (Ricky, 2026-10-31, board 8/10, design/focus-types-mockup.png).
-- Personal goals only; team challenges are not touched.
--
-- goal_type gains: fastest_time, pace, longest_distance, lift, event_time,
-- weekly_rhythm, variety, time_earned, effort, total_reps, total_weight.
-- target_value keeps one number per type: seconds for fastest_time and
-- event_time, seconds per 100 m (swim) or per km for pace, kg for lift,
-- km for longest_distance, activities a week for weekly_rhythm and variety,
-- hours for time_earned, points for effort, reps added up for total_reps
-- (1,000 pull-ups: sets x reps across activities, by lift_name), kg added up
-- for total_weight (sets x reps x weight, one lift or all when lift_name is empty).
--
-- Nothing is rewritten: every new column is empty or false on existing goals.

alter table public.goals
  add column if not exists distance_m numeric,        -- fastest_time: the distance; pace: held over
  add column if not exists lift_name text,            -- lift, total_reps, total_weight: the exercise
  add column if not exists lift_reps integer,         -- lift: reps at the target weight
  add column if not exists start_value numeric,       -- the best when the goal was set
  add column if not exists race_id uuid references public.races(id) on delete set null,  -- event_time
  add column if not exists open_ended boolean not null default false;  -- no end date chosen

-- end_date stays required, so screens reading it keep working: an open-ended
-- goal stores a far-off date, and open_ended tells the page to show "Open".

alter table public.goals
  drop constraint if exists goals_goal_type_check;
alter table public.goals
  add constraint goals_goal_type_check check (goal_type in (
    'distance', 'elevation', 'gym_sessions',
    'fastest_time', 'pace', 'longest_distance', 'lift', 'event_time',
    'weekly_rhythm', 'variety', 'time_earned', 'effort', 'total_reps', 'total_weight'
  ));

alter table public.goals
  drop constraint if exists goals_lift_reps_range;
alter table public.goals
  add constraint goals_lift_reps_range check (lift_reps is null or lift_reps >= 1);
