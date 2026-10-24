-- Raise the photo/video upload limit from 25MB to 50MB (Ricky, 2026-10-11).
--
-- 50MB is the most a single file can be on Supabase's free plan. It lets phone
-- clips of roughly 30-45 seconds through, where 25MB stopped at about 15-25.
-- The proper fix (a video service that compresses uploads, plus Supabase Pro)
-- is planned for beta prep; see the video-before-beta note.
--
-- Only the activity-photos bucket changes. The app's own check
-- (MAX_VIDEO_MB in src/components/rival/MediaPicker.tsx) is raised to match.
update storage.buckets
   set file_size_limit = 52428800  -- 50 * 1024 * 1024
 where id = 'activity-photos';
