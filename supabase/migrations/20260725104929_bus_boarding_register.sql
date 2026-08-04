-- ============================================================
-- Totem — bus boarding register: lets staff tick players off live as
-- they board an away-game bus, straight from the app.
-- Run this once in Supabase SQL Editor, after the other transport
-- migrations. Safe to re-run.
-- ============================================================

alter table public.transport_responses add column if not exists boarded boolean not null default false;
alter table public.transport_responses add column if not exists boarded_at timestamptz;

-- The original migration only let staff SELECT and INSERT — ticking the
-- boarded checkbox needs an UPDATE policy too. Deliberately still no
-- policy for the anon/public role here; boarding is confirmed by staff
-- physically at the bus, not by guardians remotely.
drop policy if exists "transport_responses_staff_update" on public.transport_responses;
create policy "transport_responses_staff_update" on public.transport_responses
  for update using (
    exists (select 1 from public.team_members where id = auth.uid() and org_id = transport_responses.org_id)
  );
