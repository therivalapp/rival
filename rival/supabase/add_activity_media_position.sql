-- Let an activity's photos and videos be put in an order, and keep it.
--
-- Until now the order was simply upload time (created_at), which is fine
-- while you can only ever add to the end. Instagram-style arranging — the
-- numbered picker showing what is already uploaded alongside anything new —
-- means reordering media that already exists, and upload time cannot be
-- changed after the fact. So the order gets its own column.
--
-- Also adds the missing UPDATE policy. activity_media has had insert, select
-- and delete policies but never update, so a reorder would have been refused
-- by RLS silently: zero rows changed, no error.

begin;

alter table activity_media add column if not exists position integer;

-- Existing media keeps the order it already shows in: upload order, counted
-- from 0 within each activity. Only rows without a position are touched, so
-- running this twice changes nothing.
update activity_media m
   set position = o.pos
  from (
    select id, row_number() over (partition by activity_id order by created_at, id) - 1 as pos
      from activity_media
  ) o
 where o.id = m.id
   and m.position is null;

-- Same rule as insert and delete: only media on your own activities.
drop policy if exists "Users can update media for their own activities" on activity_media;
create policy "Users can update media for their own activities" on activity_media
  for update to authenticated
  using (exists (select 1 from activities where activities.id = activity_media.activity_id and activities.user_id = auth.uid()))
  with check (exists (select 1 from activities where activities.id = activity_media.activity_id and activities.user_id = auth.uid()));

create index if not exists activity_media_activity_position_idx
  on activity_media (activity_id, position);

commit;
