-- ============================================================
-- Totem — Founding Schools Programme.
--
-- The first 100 orgs ever created (not invited joiners — creating
-- a brand-new club/school) permanently claim a founder slot:
--   - a founder badge (founder_number, 1-100)
--   - "no fee increases, ever" — whatever Paystack plan/price they're
--     on the first time they pay is the one they stay on for life,
--     even after public pricing changes and new Paystack plans are
--     created for everyone else. founder_locked_plan_code records
--     that plan_code so a founding school can always be resubscribed
--     against their original price point, not whatever's public by
--     then.
--
-- Assignment is atomic via a dedicated sequence (nextval is race-free
-- across concurrent signups — no two orgs can ever claim the same
-- founder_number, and the <=100 check is honoured exactly regardless
-- of any gaps left by rolled-back signups, same as any serial column).
--
-- Run this once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create sequence if not exists public.founder_number_seq start 1;

alter table public.organizations add column if not exists is_founding_school boolean not null default false;
alter table public.organizations add column if not exists founder_number int unique;
alter table public.organizations add column if not exists founder_locked_plan_code text;

create or replace function public.handle_new_user()
returns trigger as $$
declare
  target_org_id uuid;
  meta_org_name text;
  meta_invite_code text;
  meta_org_type text;
  meta_consent text;
  meta_justification text;
  meta_signup_source text;
  next_founder_number int;
begin
  meta_org_name := new.raw_user_meta_data->>'org_name';
  meta_invite_code := new.raw_user_meta_data->>'invite_code';
  meta_org_type := new.raw_user_meta_data->>'org_type';
  meta_consent := new.raw_user_meta_data->>'consent_attestation';
  meta_justification := new.raw_user_meta_data->>'duplicate_justification';
  meta_signup_source := new.raw_user_meta_data->>'signup_source';

  if meta_invite_code is not null and meta_invite_code <> '' then
    select id into target_org_id from public.organizations where invite_code = meta_invite_code;
    if target_org_id is null then
      raise exception 'That club invite code was not recognized.';
    end if;
    insert into public.team_members (id, email, org_id, role) values (new.id, new.email, target_org_id, 'member');
  else
    next_founder_number := nextval('public.founder_number_seq');

    insert into public.organizations (
      name, plan, org_type, consent_attestation_confirmed, consent_attestation_date,
      duplicate_justification, signup_source, is_founding_school, founder_number
    )
    values (
      coalesce(nullif(meta_org_name, ''), 'My Club'),
      'free',
      coalesce(nullif(meta_org_type, ''), 'club'),
      coalesce(meta_consent, 'false')::boolean,
      case when coalesce(meta_consent, 'false')::boolean then now() else null end,
      nullif(meta_justification, ''),
      nullif(meta_signup_source, ''),
      next_founder_number <= 100,
      case when next_founder_number <= 100 then next_founder_number else null end
    )
    returning id into target_org_id;
    insert into public.team_members (id, email, org_id, role) values (new.id, new.email, target_org_id, 'owner');
    insert into public.org_state (org_id, data) values (target_org_id, '{}'::jsonb);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;
