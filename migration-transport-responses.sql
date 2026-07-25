-- ============================================================
-- Totem — away-fixture transport requests (own transport vs. bus)
-- Run this once in Supabase SQL Editor. Safe to re-run.
--
-- Security design worth understanding: guardians never log in, so they
-- can't be authorized the normal way (via auth.uid()). Instead, each
-- response row gets its own random, unguessable token — the ONLY way to
-- read or update a specific row is knowing that exact token, and that
-- lookup happens through the paystack-style Edge Function
-- (send-transport-request-email's companion, transport-response),
-- using the service role key server-side. The table itself has NO
-- policy allowing the public/anon role to read or write anything
-- directly — a guardian's browser never talks to this table itself,
-- only to the Edge Function, which enforces the token match.
-- ============================================================

create table if not exists public.transport_responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  fixture_id text not null,
  player_id text not null,
  player_name text not null,
  sport_name text not null,
  opponent text not null,
  fixture_date text not null,
  fixture_time text,
  venue text,
  token uuid not null default gen_random_uuid() unique,
  choice text check (choice in ('own','bus','unavailable')),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists transport_responses_org_idx on public.transport_responses(org_id);
create index if not exists transport_responses_fixture_idx on public.transport_responses(fixture_id);

alter table public.transport_responses enable row level security;

-- Only your own club's staff can view responses for your own club's
-- fixtures — this is what powers the "bus register" view in the app.
drop policy if exists "transport_responses_staff_select" on public.transport_responses;
create policy "transport_responses_staff_select" on public.transport_responses
  for select using (
    exists (select 1 from public.team_members where id = auth.uid() and org_id = transport_responses.org_id)
  );

-- Only your own club's staff can create the initial request rows (this
-- happens automatically when an away fixture is booked).
drop policy if exists "transport_responses_staff_insert" on public.transport_responses;
create policy "transport_responses_staff_insert" on public.transport_responses
  for insert with check (
    exists (select 1 from public.team_members where id = auth.uid() and org_id = transport_responses.org_id)
  );

-- Deliberately NO policy allowing anon/public select or update — a
-- guardian's response is only ever read or written through the
-- transport-response Edge Function, using the service role key, which
-- enforces the exact-token match itself rather than relying on RLS to
-- do it (RLS can't verify "does this request know the right token",
-- only which rows a role is broadly allowed to touch).
