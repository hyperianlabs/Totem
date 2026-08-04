-- ============================================================
-- Totem — track where a new club's signup actually came from
-- (e.g. a link on a shared team sheet vs. a direct visit), so referral
-- growth from shared sheets is something you can actually measure
-- instead of guess at.
-- Run this once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

alter table public.organizations add column if not exists signup_source text;

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
    insert into public.organizations (name, plan, org_type, consent_attestation_confirmed, consent_attestation_date, duplicate_justification, signup_source)
    values (
      coalesce(nullif(meta_org_name, ''), 'My Club'),
      'free',
      coalesce(nullif(meta_org_type, ''), 'club'),
      coalesce(meta_consent, 'false')::boolean,
      case when coalesce(meta_consent, 'false')::boolean then now() else null end,
      nullif(meta_justification, ''),
      nullif(meta_signup_source, '')
    )
    returning id into target_org_id;
    insert into public.team_members (id, email, org_id, role) values (new.id, new.email, target_org_id, 'owner');
    insert into public.org_state (org_id, data) values (target_org_id, '{}'::jsonb);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;
