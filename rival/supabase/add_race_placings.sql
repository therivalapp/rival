-- Placings on an event (Ricky, 2026-11-04, design/event-placings-mockup.png).
--
-- One jsonb column on races, typed in after the event or read from a photo of
-- the results (scan-placings). Shape, all optional:
--   {
--     "rows":  [ { "key": "division", "category": "Open Men", "place": 86,  "of": 1240 },
--                { "key": "overall",  "category": "Everyone", "place": 214, "of": 3100 },
--                { "key": "age",      "category": "M 35-39",  "place": 19,  "of": 262 } ],
--     "parts": { "run1": 112, "st1": 45, ...,            -- HYROX: each run and station
--                "<activity id>": 8, ... }               -- multi-day: each event's place
--   }
--
-- No new table and no new policy: races already has "Users manage own races"
-- (user_id = auth.uid()) for writes, and the column inherits the table's
-- grants. Nothing existing changes; every race starts with placings null.

alter table public.races add column if not exists placings jsonb;
