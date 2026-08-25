-- ============================================================
-- Totem — auto-clean orphaned organizations.
--
-- organizations has no FK tying its lifecycle to team_members. Deleting a
-- user directly via the Supabase Dashboard (Authentication → Users)
-- instead of through Totem's own "Delete Club" flow cascades away their
-- team_members row (team_members.id references auth.users on delete
-- cascade) but leaves the organizations row behind as an orphaned shell
-- nobody can ever log into — found and fixed 2026-08-25 after 3 such
-- shells piled up under "Edgemead Primary School".
--
-- This trigger deletes an org automatically the moment its last
-- team_member is gone, whatever caused that deletion.
-- ============================================================

create or replace function public.cleanup_orphaned_org()
returns trigger as $$
begin
  if old.org_id is null then
    return old;
  end if;
  if not exists (select 1 from public.team_members where org_id = old.org_id) then
    delete from public.organizations where id = old.org_id;
  end if;
  return old;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_team_member_deleted on public.team_members;
create trigger on_team_member_deleted
  after delete on public.team_members
  for each row execute procedure public.cleanup_orphaned_org();
