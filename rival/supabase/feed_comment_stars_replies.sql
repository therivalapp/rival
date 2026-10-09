-- Feed comments: a star on each comment, and replies one level deep.
-- (Ricky, 2026-10-05.) Same shape as chat_reactions_replies.sql.

-- 1. REPLIES. A reply points at the comment it answers. The app always points
--    at the top comment of a thread, so replies never nest more than one level.
--    ON DELETE SET NULL, not CASCADE: deleting a comment must not silently
--    delete everyone's replies to it (they then show as ordinary comments).
alter table feed_comments
  add column if not exists reply_to_id uuid references feed_comments(id) on delete set null;

create index if not exists feed_comments_reply_to_idx on feed_comments(reply_to_id);

-- 2. STARS. Their own table, deliberately apart from feed_reactions: a star on
--    a comment never adds to the activity's Respect count or to anyone's
--    Impact stat, which both read feed_reactions only. One star per person
--    per comment, so a double tap can't stack.
create table if not exists feed_comment_stars (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references feed_comments(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index if not exists feed_comment_stars_comment_idx on feed_comment_stars(comment_id);

alter table feed_comment_stars enable row level security;

-- Scoped through the comment's team: you can see and give stars only in teams
-- you are an ACTIVE member of (is_league_member checks status = 'active').
drop policy if exists "members read comment stars" on feed_comment_stars;
create policy "members read comment stars" on feed_comment_stars
  for select using (
    exists (select 1 from feed_comments c
             where c.id = comment_id and is_league_member(c.league_id))
  );

drop policy if exists "members add own comment stars" on feed_comment_stars;
create policy "members add own comment stars" on feed_comment_stars
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from feed_comments c
                 where c.id = comment_id and is_league_member(c.league_id))
  );

drop policy if exists "members remove own comment stars" on feed_comment_stars;
create policy "members remove own comment stars" on feed_comment_stars
  for delete using (auth.uid() = user_id);
