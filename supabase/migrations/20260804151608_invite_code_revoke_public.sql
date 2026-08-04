-- ============================================================
-- Totem — fix incomplete revoke from the previous migration.
--
-- Postgres grants EXECUTE to the PUBLIC pseudo-role by default when a
-- function is created, unless explicitly revoked. The previous migration
-- only revoked from anon/authenticated directly, which had no effect
-- because those roles still inherited EXECUTE through PUBLIC — confirmed
-- live (curl against the RPC still succeeded after that migration).
-- ============================================================

revoke execute on function public.get_org_name_for_invite_code(text) from public;
