-- ============================================================
-- Totem — Multi-tenant migration
-- Run this AFTER schema.sql has already been run once. Safe to
-- re-run (idempotent), and preserves your existing club's data by
-- migrating it into its own organization automatically.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- organizations: one row per club/school/team ----------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  plan text not null default 'free',
  created_at timestamptz default now()
);

-- ---------- team_members: now belongs to one organization ----------
alter table public.team_members add column if not exists org_id uuid references public.organizations(id);
alter table public.team_members add column if not exists role text not null default 'member';

-- ---------- org_state: replaces the old single club_state row —
-- one JSON blob per organization instead of one for the whole app ----------
create table if not exists public.org_state (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

-- ============================================================
-- One-time migration: if you already had data in the old
-- single-tenant club_state table, move it into a new organization
-- now, and link your existing staff accounts to it. Safe to run
-- even if you have no prior data (it just does nothing in that case).
-- ============================================================
do $$
declare
  migrated_org_id uuid;
  existing_state jsonb;
begin
  if not exists (select 1 from public.organizations) and exists (select 1 from public.club_state) then
    select data into existing_state from public.club_state where id = 1;

    insert into public.organizations (name, plan) values ('My Club', 'free')
    returning id into migrated_org_id;

    update public.team_members set org_id = migrated_org_id, role = 'owner' where org_id is null;

    insert into public.org_state (org_id, data)
    values (migrated_org_id, coalesce(existing_state, '{}'::jsonb))
    on conflict (org_id) do nothing;
  end if;
end $$;

create index if not exists team_members_org_id_idx on public.team_members(org_id);

-- ============================================================
-- Row Level Security — a user can only ever read/write data that
-- belongs to their own organization. Two different clubs can never
-- see each other's rosters, results, or anything else.
-- ============================================================
alter table public.organizations enable row level security;
alter table public.org_state enable row level security;

drop policy if exists "organizations_member_read" on public.organizations;
create policy "organizations_member_read" on public.organizations
  for select using (
    exists (select 1 from public.team_members tm where tm.id = auth.uid() and tm.org_id = organizations.id)
  );

drop policy if exists "org_state_team_access" on public.org_state;
create policy "org_state_team_access" on public.org_state
  for all
  using (exists (select 1 from public.team_members tm where tm.id = auth.uid() and tm.org_id = org_state.org_id))
  with check (exists (select 1 from public.team_members tm where tm.id = auth.uid() and tm.org_id = org_state.org_id));

-- ============================================================
-- Self-service signup: when someone signs up, either create them a
-- brand new organization (if they gave a club name) or join them to
-- an existing one (if they gave a valid invite code). Runs
-- automatically — the app passes one of these two pieces of info
-- when calling supabase.auth.signUp().
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
declare
  target_org_id uuid;
  meta_org_name text;
  meta_invite_code text;
begin
  meta_org_name := new.raw_user_meta_data->>'org_name';
  meta_invite_code := new.raw_user_meta_data->>'invite_code';

  if meta_invite_code is not null and meta_invite_code <> '' then
    select id into target_org_id from public.organizations where invite_code = meta_invite_code;
    if target_org_id is null then
      raise exception 'That club invite code was not recognized.';
    end if;
    insert into public.team_members (id, email, org_id, role) values (new.id, new.email, target_org_id, 'member');
  else
    insert into public.organizations (name, plan) values (coalesce(nullif(meta_org_name, ''), 'My Club'), 'free')
    returning id into target_org_id;
    insert into public.team_members (id, email, org_id, role) values (new.id, new.email, target_org_id, 'owner');
    insert into public.org_state (org_id, data) values (target_org_id, '{}'::jsonb);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- IMPORTANT — one manual dashboard step required after running this:
--
--   Authentication → Providers → Email → turn "Allow new users to
--   sign up" back ON.
--
-- This was deliberately turned off earlier for the single-club,
-- admin-provisioned model. It needs to be ON now for self-service
-- signup to work — and this is safe to re-enable, because every new
-- signup creates (or joins) their OWN isolated organization; nobody
-- can ever see another club's data no matter how they signed up.
--
-- Also recommended now that signup is public: Authentication →
-- Settings → turn ON "Confirm email", so people can't sign up with
-- an email address that isn't actually theirs.
-- ============================================================
