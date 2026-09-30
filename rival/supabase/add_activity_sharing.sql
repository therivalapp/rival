-- Two people, one session, one device.
--
-- RIVAL has always modelled an activity as belonging to exactly one person,
-- which is an artifact of how activities arrive — through per-account device
-- integrations — rather than a decision anyone made. It is wrong often enough
-- to matter: a couple walking together where only one phone is recording, a
-- group run where one watch lost GPS. Both people trained. Only one of them
-- could prove it, and the one without the device simply did not exist that day
-- as far as the leaderboard was concerned.
--
-- This lets the owner of an activity say who else was there, and lets that
-- person confirm it. Two independent people asserting the same session is
-- stronger evidence than most of what is already in this table — a manually
-- entered activity carries one person's word and no second signature.
--
-- The shape of the exchange matters and is deliberate:
--
--   * The OWNER tags. They have the device, the app open, and the standing to
--     vouch — they were there.
--   * The TAGGED PERSON confirms. Nothing counts until they do. A tag on its
--     own moves no Effort, appears on no leaderboard, and is visible to
--     nobody. It is a question, not a grant.
--   * Declining is silent. Nobody is told, because the alternative is a
--     mechanic that pressures people into accepting.
--
-- Scope limits are here to stop the generous drift that would otherwise soften
-- the leaderboard over months: teammates only, recent activities only, and the
-- result is visible on the card so the team can see it.

begin;

-- Marks an activity as somebody else's session that this person was part of.
-- Kept as a column on activities rather than inferred from activity_participants
-- so the feed can tell at a glance without a join, and so the row survives the
-- original being deleted (the session still happened).
alter table activities
  add column if not exists shared_from_activity_id uuid references activities(id) on delete set null;

create table if not exists activity_participants (
  id uuid primary key default uuid_generate_v4(),

  -- The session, owned by whoever recorded it.
  activity_id uuid not null references activities(id) on delete cascade,

  -- Who is being said to have been there.
  user_id uuid not null references users(id) on delete cascade,

  -- Who said so. Always the activity's owner — enforced by the insert policy
  -- below, kept as a column because the inbox item names them.
  added_by uuid not null references users(id) on delete cascade,

  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),

  -- The tagged person's own activity, created on accept. Their row, not a
  -- pointer at the original: they can rename it, photograph it, or delete it,
  -- and deleting the original leaves theirs standing.
  created_activity_id uuid references activities(id) on delete set null,

  created_at timestamptz not null default now(),
  responded_at timestamptz,

  -- One question per person per session. Re-tagging somebody who declined
  -- would be a way to keep asking until they gave in.
  unique (activity_id, user_id)
);

create index if not exists activity_participants_activity_idx
  on activity_participants (activity_id);

-- Drives "anything waiting for me" — partial, because pending is a brief state
-- and the vast majority of rows will be settled.
create index if not exists activity_participants_pending_idx
  on activity_participants (user_id, created_at desc)
  where status = 'pending';

-- Do two people share a team? Used by the insert policy below to keep tagging
-- inside the circle of people who plausibly train together.
--
-- SECURITY DEFINER because it reads league_members for BOTH people, and the
-- caller can only see rows for teams they are in — without this the policy
-- would silently evaluate false against a teammate's membership row.
create or replace function shares_active_team(a uuid, b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from league_members m1
      join league_members m2 on m1.league_id = m2.league_id
     where m1.user_id = a and m1.status = 'active'
       and m2.user_id = b and m2.status = 'active'
  );
$$;

alter table activity_participants enable row level security;

-- Visible to the two people it concerns. Not to the wider team while pending:
-- an unanswered tag is a question between two people, and a team that can see
-- pending tags can apply pressure to answer them.
drop policy if exists "Read tags that involve you" on activity_participants;
create policy "Read tags that involve you" on activity_participants
  for select to authenticated
  using (user_id = auth.uid() or added_by = auth.uid());

-- Only the owner of the activity can tag, only as themselves, only teammates,
-- only pending, and only within 48 hours of the session. The window is the
-- quiet guardrail: tagging is for a session you both remember, not for going
-- back through someone's history topping up their Effort.
drop policy if exists "Tag people on your own activity" on activity_participants;
create policy "Tag people on your own activity" on activity_participants
  for insert to authenticated
  with check (
    added_by = auth.uid()
    and status = 'pending'
    and user_id <> auth.uid()
    and shares_active_team(auth.uid(), user_id)
    and exists (
      select 1 from activities a
       where a.id = activity_id
         and a.user_id = auth.uid()
         and a.started_at > now() - interval '48 hours'
    )
  );

-- Answering is the tagged person's alone. The owner cannot accept on their
-- behalf — that would make the tag a grant rather than a question.
drop policy if exists "Answer a tag about you" on activity_participants;
create policy "Answer a tag about you" on activity_participants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Either side can undo it: the owner because they may have picked the wrong
-- person, the tagged person because they may change their mind later.
drop policy if exists "Remove a tag you are part of" on activity_participants;
create policy "Remove a tag you are part of" on activity_participants
  for delete to authenticated
  using (user_id = auth.uid() or added_by = auth.uid());

-- The inbox learns two new things to say: a tag waiting to be answered, and
-- the confirmation that comes back.
alter table inbox_items drop constraint if exists inbox_items_kind_check;
alter table inbox_items add constraint inbox_items_kind_check
  check (kind in (
    'reaction', 'comment', 'join_request', 'short_activity', 'team_joined',
    'activity_tag', 'tag_accepted'
  ));

commit;
