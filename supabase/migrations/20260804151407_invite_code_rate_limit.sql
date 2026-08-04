-- ============================================================
-- Totem — rate-limit invite-code lookups
--
-- get_org_name_for_invite_code() was callable directly by anon/authenticated
-- with no throttling — an 8-hex-char code is a big enough space to not be
-- hand-guessable, but nothing stopped a scripted client from hammering it
-- to enumerate club names or eventually land a valid code and self-join a
-- real club (and its players'/minors' data) as staff.
--
-- Fix: move the lookup behind the check-invite-code edge function, which
-- rate-limits by IP using this table, and revoke direct RPC access so the
-- edge function is the only path in.
-- ============================================================

create table if not exists public.invite_code_attempts (
  id bigserial primary key,
  ip text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists invite_code_attempts_ip_time_idx
  on public.invite_code_attempts(ip, attempted_at);

-- No RLS policies needed — only ever touched by the edge function via the
-- service role, never by client code directly.
alter table public.invite_code_attempts enable row level security;

revoke execute on function public.get_org_name_for_invite_code(text) from anon, authenticated;
