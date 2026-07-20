-- ============================================================
-- Totem — switch payment columns from Stripe-specific naming to
-- neutral naming, since Stripe doesn't directly support South African
-- businesses and Paystack is used instead (see paystack-webhook function).
-- Run this once in Supabase SQL Editor. Safe to re-run.
-- ============================================================

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'organizations' and column_name = 'stripe_customer_id') then
    alter table public.organizations rename column stripe_customer_id to payment_customer_id;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'organizations' and column_name = 'stripe_subscription_id') then
    alter table public.organizations rename column stripe_subscription_id to payment_subscription_id;
  end if;
end $$;

drop index if exists organizations_stripe_customer_idx;
create index if not exists organizations_payment_customer_idx on public.organizations(payment_customer_id);
