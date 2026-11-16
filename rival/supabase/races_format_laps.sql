-- Laps replaces Backyard (Ricky 2026-11-15): a laps event's distance is the lap.
alter table races drop constraint if exists races_format_check;
alter table races add constraint races_format_check check (format in ('finish', 'laps', 'timed'));
