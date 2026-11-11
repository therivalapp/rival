-- Account approval for Team Beta (Mockup 30, 2026-11-11).
-- A new account waits on the "Waiting for approval" page until it is
-- approved. Approving is one tap from the email the approve-member function
-- sends to hello@therivalapp.com. Anyone already on the website's Team Beta
-- list (public.beta_signups) is approved the moment they sign up.

-- 1. Columns. approved_at: null = waiting. approval_requested_at: when the
--    "New sign-up" email went out, so it is sent once.
alter table public.users add column if not exists approved_at timestamptz;
alter table public.users add column if not exists approval_requested_at timestamptz;

-- 2. Everyone who has an account today is approved (members, demo members,
--    the Apple review account), so nothing changes for them.
update public.users set approved_at = coalesce(created_at, now()) where approved_at is null;

-- 3. The app reads its own approval (RLS already limits rows to the member's own).
grant select (approved_at) on public.users to authenticated;

-- 4. Nobody approves themselves. The users table allows members to update
--    their own row, so a trigger stops these two columns changing unless the
--    change comes from the server (service role, used by approve-member).
create or replace function public.guard_user_approval()
returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and (new.approved_at is distinct from old.approved_at
          or new.approval_requested_at is distinct from old.approval_requested_at) then
    raise exception 'Approval is set by RIVAL only';
  end if;
  return new;
end $$;
drop trigger if exists guard_user_approval on public.users;
create trigger guard_user_approval before update on public.users
  for each row execute function public.guard_user_approval();

-- 5. Already on the Team Beta list: approved on sign-up.
create or replace function public.approve_if_on_beta_list()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.approved_at is null and new.email is not null
     and exists (select 1 from public.beta_signups b where lower(b.email) = lower(new.email)) then
    new.approved_at := now();
  end if;
  return new;
end $$;
drop trigger if exists approve_if_on_beta_list on public.users;
create trigger approve_if_on_beta_list before insert on public.users
  for each row execute function public.approve_if_on_beta_list();
