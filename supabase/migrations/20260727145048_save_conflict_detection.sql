-- ============================================================
-- Totem — save-conflict detection.
--
-- The problem this solves: your whole roster/fixtures/results for a club
-- is saved as one combined blob every time anything changes. If two
-- browser tabs (or two staff members) both have the app open and one
-- saves after the other, the second save silently overwrites the first
-- one's changes completely — there's no warning, and nothing to undo.
--
-- The fix: every save now has to prove it's working from the latest
-- version of the data. If it isn't (because someone else saved in the
-- meantime), the save is rejected instead of silently overwriting —
-- the app then tells the person what happened and lets them reload
-- before continuing, rather than losing work invisibly.
--
-- Run this once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- Reliably bump updated_at on every change, regardless of what the
-- client remembers to set — this is the actual source of truth the
-- conflict check depends on, so it shouldn't rely on client code alone.
create or replace function public.bump_org_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists org_state_bump_updated_at on public.org_state;
create trigger org_state_bump_updated_at
  before update on public.org_state
  for each row
  execute function public.bump_org_state_updated_at();
