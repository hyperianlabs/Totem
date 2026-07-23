-- ============================================================
-- Totem — let a club owner delete their own organization
-- Run this once in Supabase SQL Editor. Safe to re-run.
--
-- Previously only a Platform Admin could delete an organization. This adds
-- the same ability for that org's own owner, scoped strictly to their own
-- club (reuses the is_org_owner() function already created in
-- migration-staff-management.sql).
--
-- Deletion cascades automatically to team_members and org_state, since
-- both already have "on delete cascade" foreign keys back to
-- organizations — no extra cleanup needed, this one DELETE removes
-- everything belonging to that club.
-- ============================================================

drop policy if exists "organizations_owner_delete" on public.organizations;
create policy "organizations_owner_delete" on public.organizations
  for delete using (public.is_org_owner(id));
