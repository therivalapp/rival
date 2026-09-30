-- Tidy the reactions table (Ricky approved, 2026-09-25).
--
-- 1. Five reactions from before Respect/Inspired still hold an emoji
--    (🔥 💪 🎉 👏). AGENTS.md says old emoji rows were migrated to 'respect';
--    these were missed. The app already counts them as Respect, so this only
--    makes the data say what the app shows.
-- 2. Reactions on activities that have since been deleted point at nothing.
--    They are never shown or counted; this removes them.

update feed_reactions
set emoji = 'respect'
where emoji not in ('respect', 'inspired');

delete from feed_reactions r
where r.target_type = 'activity'
  and not exists (select 1 from activities a where a.id::text = r.target_id);
