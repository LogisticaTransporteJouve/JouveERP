SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- An ARCA-authorized voucher inserted already emitted (the ARCA import,
-- lib/afip/sync-issued.ts) is saved even when its journal entry cannot be
-- posted (closed period, missing chart-of-accounts role): the entry waits in
-- pending_journal_entries, as the →emitted update already does
-- (20261102200000_period_guard_pending_journal.sql). Before this the insert
-- aborted with 55006, importVoucher returned failed and the sync of that
-- (punto de venta, tipo) stopped on the same number every run.

-- Latest body: 20261031180534_journal_reverse_repost.sql.
create or replace function public.invoices_after_insert_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'emitted' and new.cae is not null then
    -- LEAVE + NOTE: the period mirrors invoices_after_update_journal (fecha
    -- month).
    perform public.emit_journal_or_record('invoices', new.id, to_char(new.fecha, 'YYYY-MM'));
  elsif new.status = 'emitted' then
    perform public.emit_journal('invoices', new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.invoices_after_insert_journal() from public, anon, authenticated;
