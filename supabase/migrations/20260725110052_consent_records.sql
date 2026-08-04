-- ============================================================
-- Totem — digital POPIA consent & transport indemnity records.
-- Same security model as transport_responses: guardians never log in,
-- so each record gets its own unguessable token, and the table itself
-- has zero direct public access — every guardian interaction goes
-- through the consent-response Edge Function instead, which enforces
-- the exact token match server-side using the service role key.
--
-- Run this once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  player_id text not null,
  player_name text not null,
  sport_name text not null,
  org_name text not null,
  guardian_email text not null,
  notify_email text, -- who gets told once this is signed (head coach, or whoever added the player)
  document_version text not null default 'v1', -- so wording changes later don't retroactively alter what someone already agreed to
  token uuid not null default gen_random_uuid() unique,
  signed boolean not null default false,
  signature_name text, -- guardian's typed full name, acting as the e-signature
  relationship text, -- e.g. "Mother", "Father", "Legal guardian"
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists consent_records_org_idx on public.consent_records(org_id);
create index if not exists consent_records_player_idx on public.consent_records(player_id);
-- One record per player, ever — the app checks for an existing record
-- before creating a new one, but this is the actual guarantee against a
-- race condition creating duplicates (e.g. two "send to everyone" clicks
-- close together).
create unique index if not exists consent_records_one_per_player on public.consent_records(org_id, player_id);

alter table public.consent_records enable row level security;

drop policy if exists "consent_records_staff_select" on public.consent_records;
create policy "consent_records_staff_select" on public.consent_records
  for select using (
    exists (select 1 from public.team_members where id = auth.uid() and org_id = consent_records.org_id)
  );

drop policy if exists "consent_records_staff_insert" on public.consent_records;
create policy "consent_records_staff_insert" on public.consent_records
  for insert with check (
    exists (select 1 from public.team_members where id = auth.uid() and org_id = consent_records.org_id)
  );

-- Deliberately no anon/public policy — guardians only ever interact via
-- the consent-response Edge Function, same reasoning as transport_responses.
