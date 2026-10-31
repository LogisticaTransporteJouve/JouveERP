SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- C2: authenticated can no longer post journal entries directly. Every writer
-- is a SECURITY DEFINER emitter or create_manual_journal_entry (role-checked),
-- and no app code calls create_journal_entry. Rolling back to a SHA before
-- create_manual_journal_entry needs:
--   grant execute on function public.create_journal_entry(date, text, text, jsonb, text, uuid, text, boolean, uuid) to authenticated;
revoke all on function public.create_journal_entry(date, text, text, jsonb, text, uuid, text, boolean, uuid)
  from public, anon, authenticated;
