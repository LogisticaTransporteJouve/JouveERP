SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- AI CFO follow-up: the chat proposal card shows what a confirmed write
-- reported ("12 conciliadas; 1 salteada porque cambió"), as the insight
-- proposal dialog already does from ai_proposals.result.note.
--
-- ai_chat_confirmations.result_note: written with result_id after the
-- confirmed write, through the service client (RLS unchanged: authenticated
-- reads only its own rows). Existing rows stay null.
--
-- Rollback: older code selects its own column list and never writes it.

alter table public.ai_chat_confirmations
  add column result_note text
    check (result_note is null or char_length(result_note) <= 500);

comment on column public.ai_chat_confirmations.result_note is
  'Nota del resultado de una propuesta confirmada (por ejemplo, cuántas líneas se conciliaron); null si la escritura no informó nada.';
