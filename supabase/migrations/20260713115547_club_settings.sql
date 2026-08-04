-- ============================================================
-- Totem — allow the club owner to rename their organization
-- Run this once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

drop policy if exists "organizations_owner_update" on public.organizations;
create policy "organizations_owner_update" on public.organizations
  for update
  using (
    exists (
      select 1 from public.team_members tm
      where tm.id = auth.uid() and tm.org_id = organizations.id and tm.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.team_members tm
      where tm.id = auth.uid() and tm.org_id = organizations.id and tm.role = 'owner'
    )
  );
