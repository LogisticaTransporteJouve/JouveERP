SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W3 · S1 F1: a fiscal purchase's total equals the sum of its parts.
--
-- The journal credits proveedores with neto + no gravado + exento + IVA +
-- tributes and never reads imp_total, while the supplier statement, the aging
-- and the payment-order open amount use imp_total. A gap between them stayed
-- in proveedores for good. Now a fiscal purchase is refused when
-- |imp_total − (imp_neto + imp_iva + imp_trib + imp_no_gravado +
-- imp_op_exentas)| > 0.01, on insert and on an update that changes any of
-- those amounts or the channel. imp_trib already equals its four parts
-- (purchase_invoices_trib_split).
--
-- Existing rows are not backfilled: an update that leaves the amounts as they
-- are (status, notes, account, cancellation) still saves. docs/pendientes.md
-- lists the owner's query for the rows with a gap.
--
-- Internal purchases post no journal entry (their employee charge reads
-- imp_total), so the database leaves them alone; the app checks them too.
--
-- Rollback: older code writes the same columns; a write of a fiscal purchase
-- whose amounts do not add up gets this guard's message.

create function public.guard_purchase_invoice_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.imp_neto, new.imp_iva, new.imp_trib, new.imp_no_gravado,
          new.imp_op_exentas, new.imp_total, new.channel_id)
         is not distinct from
         (old.imp_neto, old.imp_iva, old.imp_trib, old.imp_no_gravado,
          old.imp_op_exentas, old.imp_total, old.channel_id) then
    return new;
  end if;
  if public.is_channel_fiscal(new.channel_id)
     and abs(new.imp_total - (new.imp_neto + new.imp_iva + new.imp_trib
                              + new.imp_no_gravado + new.imp_op_exentas)) > 0.01 then
    raise exception 'Los importes no suman el total: neto + IVA + otros tributos + no gravado + exento tienen que dar el total del comprobante.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_purchase_invoice_total() from public, anon, authenticated;

create trigger purchase_invoices_total_matches_parts
  before insert or update of imp_neto, imp_iva, imp_trib, imp_no_gravado, imp_op_exentas, imp_total, channel_id
  on public.purchase_invoices
  for each row execute function public.guard_purchase_invoice_total();
