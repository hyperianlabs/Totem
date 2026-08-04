-- ============================================================
-- Totem — adds "not available" as a third transport response option,
-- alongside "own transport" and "bus".
-- Run this once in Supabase SQL Editor, after migration-transport-responses.sql.
-- Safe to re-run.
-- ============================================================

alter table public.transport_responses drop constraint if exists transport_responses_choice_check;
alter table public.transport_responses add constraint transport_responses_choice_check
  check (choice in ('own','bus','unavailable'));
