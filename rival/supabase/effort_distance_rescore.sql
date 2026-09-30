-- Effort: mostly distance. Step 2 of 2: rescore every activity.
-- Run only after effort_distance.sql. Mirrors calculateEffortScore in
-- supabase/functions/_shared/effortScore.ts and src/lib/effort.ts.

-- Rollback copy of every current score.
create table if not exists effort_rescore_backup_20261001 as
  select id, effort_score, raw_effort_score from activities;

with scored as (
  select a.id,
    round((
      case
        when coalesce(c.distance_rate, 0) > 0 and coalesce(a.distance_meters, 0) > 0 then
          a.duration_seconds / 60.0 * c.distance_time_rate
          + (case when c.min_pace > 0 and a.duration_seconds > 0
                  then least(a.distance_meters / 1000.0, a.duration_seconds / 60.0 / c.min_pace)
                  else a.distance_meters / 1000.0 end) * c.distance_rate
        else a.duration_seconds / 60.0 * coalesce(c.multiplier, 1.0)
      end
      + least(greatest(coalesce(a.elevation_meters, 0), 0),
              case when a.duration_seconds > 0
                   then greatest(a.duration_seconds / 3600.0 * 2500, 1500) else 0 end)
        * coalesce(c.elevation_rate, 0)
    )::numeric, 1) as effort
  from activities a
  left join scoring_config c on c.activity_type = a.activity_type
)
update activities a set effort_score = s.effort, raw_effort_score = s.effort
from scored s where s.id = a.id;

-- Rollback, if needed:
-- update activities a set effort_score = b.effort_score, raw_effort_score = b.raw_effort_score
--   from effort_rescore_backup_20261001 b where b.id = a.id;
