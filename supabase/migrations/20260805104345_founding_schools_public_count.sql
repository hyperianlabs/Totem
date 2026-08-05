-- ============================================================
-- Totem — public "spots claimed" counter for the landing page.
--
-- Exposes ONLY a count of founding schools claimed so far (capped at
-- 100 by definition) to anonymous visitors — never any organization
-- data itself. Deliberately a narrow security definer function rather
-- than an RLS policy opening up SELECT on organizations, which would
-- risk leaking school names/plans/etc. to the public. Same pattern as
-- the existing pre-auth functions check_org_name_similar() and
-- get_org_name_for_invite_code().
--
-- Run this once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create or replace function public.get_founding_schools_count()
returns int as $$
  select count(*)::int from public.organizations where is_founding_school = true;
$$ language sql security definer set search_path = public stable;

grant execute on function public.get_founding_schools_count() to anon;
