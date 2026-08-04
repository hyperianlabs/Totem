-- ============================================================
-- Totem — POPIA consent attestation groundwork
-- Run this once in Supabase SQL Editor. Safe to re-run.
--
-- This does NOT make Totem POPIA-compliant on its own — it's a technical
-- record-keeping tool. The actual legal work (what consent language is
-- valid, whether an exception applies, cross-border transfer handling)
-- needs a real South African lawyer. This just gives clubs a documented,
-- timestamped confirmation that they've addressed consent on their end.
-- ============================================================

alter table public.organizations add column if not exists consent_attestation_confirmed boolean not null default false;
alter table public.organizations add column if not exists consent_attestation_date timestamptz;

-- Update the signup trigger so "create a new club" signups also record the
-- consent attestation checkbox from the signup form.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  target_org_id uuid;
  meta_org_name text;
  meta_invite_code text;
  meta_org_type text;
  meta_consent text;
begin
  meta_org_name := new.raw_user_meta_data->>'org_name';
  meta_invite_code := new.raw_user_meta_data->>'invite_code';
  meta_org_type := new.raw_user_meta_data->>'org_type';
  meta_consent := new.raw_user_meta_data->>'consent_attestation';

  if meta_invite_code is not null and meta_invite_code <> '' then
    select id into target_org_id from public.organizations where invite_code = meta_invite_code;
    if target_org_id is null then
      raise exception 'That club invite code was not recognized.';
    end if;
    insert into public.team_members (id, email, org_id, role) values (new.id, new.email, target_org_id, 'member');
  else
    insert into public.organizations (name, plan, org_type, consent_attestation_confirmed, consent_attestation_date)
    values (
      coalesce(nullif(meta_org_name, ''), 'My Club'),
      'free',
      coalesce(nullif(meta_org_type, ''), 'club'),
      coalesce(meta_consent, 'false')::boolean,
      case when coalesce(meta_consent, 'false')::boolean then now() else null end
    )
    returning id into target_org_id;
    insert into public.team_members (id, email, org_id, role) values (new.id, new.email, target_org_id, 'owner');
    insert into public.org_state (org_id, data) values (target_org_id, '{}'::jsonb);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;
