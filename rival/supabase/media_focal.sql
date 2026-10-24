-- A crop for every photo and video, not just the cover (Ricky, 2026-10-23:
-- "whenever you add a photo or vid make sure you can choose crop").
--
-- The crop is a focal point, 0 to 1 across and down, the same as the cover's
-- activities.photo_focal_x / photo_focal_y: the picture itself is never cut,
-- the point says which part stays in view when it's shown in a frame of a
-- different shape. Null means centred, so every existing row keeps looking
-- exactly as it does now.
--
-- Adds two nullable columns to an existing table: no data changes, no new
-- table (so no new GRANTs), and the existing RLS policies on activity_media
-- already cover them.

alter table public.activity_media
  add column if not exists focal_x numeric check (focal_x is null or (focal_x >= 0 and focal_x <= 1)),
  add column if not exists focal_y numeric check (focal_y is null or (focal_y >= 0 and focal_y <= 1));
