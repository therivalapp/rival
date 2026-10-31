-- Team board notes can end (Ricky, 2026-10-24): "Show until" a date and
-- time when posting, so a Saturday meetup doesn't sit on the board for
-- months. Null is "Until removed", which is every existing note, so nothing
-- that is there now changes.
--
-- Past its end, a note leaves the board but is not deleted: its comments and
-- Respect stay. The app hides it; nothing is removed here.
--
-- One nullable column on an existing table: no data changes, no new table
-- (so no new GRANTs), and the existing policies already cover it (posters
-- edit their own messages, admins pin).

alter table public.league_messages
  add column if not exists expires_at timestamptz;

-- The board reads a team's live notes: those without an end, or ending later.
create index if not exists league_messages_board_expiry_idx
  on public.league_messages (league_id, expires_at)
  where kind = 'board';
