-- Activity stats (Ricky, 2026-11-02, design/activity-stats-map.png).
--
-- One new nullable column on activities for the numbers that don't have a
-- column of their own: elapsed time, steps, swim lengths and SWOLF, ski runs,
-- CrossFit rounds and score, a match result and so on. Shape is
-- ActivityStats in src/lib/activityStats.ts. Nothing else changes: existing
-- rows keep null, and the existing RLS policies on activities already cover
-- the new column (same row, same owner rules).
--
-- RUN 2026-11-02 with Ricky's approval: 565 rows, column added, all null,
-- authenticated can insert and select it. STATS_COLUMN is on in
-- src/lib/saveLiveActivity.ts.

alter table public.activities
  add column if not exists stats jsonb;

comment on column public.activities.stats is
  'Extra numbers from a recording, watch or sensor (src/lib/activityStats.ts ActivityStats).';
