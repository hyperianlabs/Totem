-- ============================================================
-- Totem — let a club owner see and remove their own staff
-- Run this once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- A regular policy that queries team_members from within a policy ON
-- team_members causes "infinite recursion detected in policy" errors in
-- Postgres. This small helper function is the standard fix — it runs with
-- elevated privileges internally (bypassing RLS just for this one lookup),
-- which breaks that recursive loop.
create or replace function public.is_org_owner(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where id = auth.uid() and org_id = check_org_id and role = 'owner'
  );
$$;

drop policy if exists "team_members_owner_read_all" on public.team_members;
create policy "team_members_owner_read_all" on public.team_members
  for select using (public.is_org_owner(org_id));

drop policy if exists "team_members_owner_delete" on public.team_members;
create policy "team_members_owner_delete" on public.team_members
  for delete using (public.is_org_owner(org_id));

-- Note: this only removes someone's access to your club's data — it does
-- NOT delete their login entirely. If you want to remove the login too
-- (so the email could be reused elsewhere), that still needs to be done
-- manually via Authentication → Users → delete, since only Supabase's
-- own admin API can delete a login, not a database policy.
