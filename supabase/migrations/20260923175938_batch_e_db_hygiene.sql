-- Batch E — database hygiene (from the 2026-09-23 production audit).
-- All items are P2/P3 cleanups; none change application behaviour.

-- 1. Drop the dead, pre-multitenant `club_state` table.
--    It carried a policy (`club_state_team_access`, cmd ALL) usable by ANY
--    authenticated member of ANY org, with no org_id predicate — a latent
--    cross-org hole. In practice it holds a single empty row ('{}') and was
--    superseded by the per-org `org_state` table; no code references it.
drop table if exists public.club_state;

-- 2. Remove the redundant duplicate SELECT policy on platform_admins.
--    `platform_admins_self_read` and `platform_admins_self_select` are
--    byte-identical (USING auth.uid() = id); keep one.
drop policy if exists platform_admins_self_select on public.platform_admins;

-- 3. Revoke default PUBLIC EXECUTE on trigger-only functions. Triggers fire
--    regardless of EXECUTE grants, so this doesn't affect them — it just stops
--    these being callable as RPCs (defense-in-depth; advisors 0028/0029).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.cleanup_orphaned_org() from public, anon, authenticated;
revoke execute on function public.bump_org_state_updated_at() from public, anon, authenticated;

-- 4. Pin the mutable search_path on bump_org_state_updated_at (advisor 0011).
--    Its body is only `new.updated_at = now()` (now() lives in pg_catalog,
--    always on the path), so an empty search_path is safe.
alter function public.bump_org_state_updated_at() set search_path = '';

-- 5. Restrict the public `emblems` storage bucket to real image types
--    (allowed_mime_types was NULL = any type). SVG is deliberately excluded
--    because it can carry script.
update storage.buckets
  set allowed_mime_types = array['image/png','image/jpeg','image/webp']
  where id = 'emblems';

-- 6. Add the missing covering index on org_state.updated_by (FK -> auth.users)
--    so user-deletion cascades and joins don't sequential-scan (advisor 0001).
create index if not exists org_state_updated_by_idx on public.org_state (updated_by);
