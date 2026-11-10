-- Beta sign-ups from the Join Team Beta pop-up on therivalapp.com (2026-11-09).
--
-- Holds only what the privacy policy's "Beta sign-ups" section says: name,
-- email address, and country (with province for Canada), kept to send the
-- beta invite and deleted when the beta opens to everyone, or sooner on
-- request. Country decides who can be invited: the beta opens in Canada
-- outside Quebec, Australia and New Zealand first (BETA_PLAN.md).
--
-- Nobody reads or writes this table from a browser. RLS is on with no
-- policies, and anon/authenticated get no grants, so the public site can only
-- reach it through the beta-signup edge function, which uses the service role.

create table if not exists public.beta_signups (
  id         uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name  text not null check (char_length(last_name) between 1 and 60),
  -- Stored trimmed and lower case, so one address can only sign up once.
  email      text not null unique
             check (email = lower(btrim(email)) and char_length(email) between 6 and 254),
  country    text not null check (country in (
               'Canada', 'Australia', 'New Zealand', 'United Kingdom', 'United States', 'Another country')),
  -- Province or territory, for Canada only.
  region     text check (
               (country = 'Canada' and region is not null and region in (
                 'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador',
                 'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island',
                 'Quebec', 'Saskatchewan', 'Yukon'))
               or (country <> 'Canada' and region is null)),
  created_at timestamptz not null default now()
);

alter table public.beta_signups enable row level security;

-- New public tables get no Data API access by default (Supabase, 2026-10-30).
-- Only the service role needs it.
revoke all on public.beta_signups from anon, authenticated;
grant select, insert, delete on public.beta_signups to service_role;
