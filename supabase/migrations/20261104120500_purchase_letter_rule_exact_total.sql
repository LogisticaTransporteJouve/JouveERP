SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W4 · S1 F1 and F3, in guard_purchase_invoice_total (from
-- 20261104112000):
--
-- - A fiscal purchase's total equals its parts exactly. The journal credits
--   proveedores with the parts and the statement, the aging and the OP use
--   imp_total: the old 0.01 tolerance left that cent in proveedores for each
--   such purchase.
-- - A fiscal B or C carries no IVA, exento or no gravado: they go inside the
--   net (citi.ts declares IVA only for A). The action checked only the header
--   it was sent, and replace_purchase_invoice_items then rewrites imp_iva from
--   the lines; this trigger sees what every writer stores.
--
-- Each rule runs on insert and on an update that changes what it reads, so an
-- old purchase (a B with IVA, a total a cent off) still saves edits that leave
-- those columns alone. No backfill: production holds no purchases.
--
-- Rollback: older code writes the same columns; a write that breaks either
-- rule gets the guard's message.

create or replace function public.guard_purchase_invoice_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_total  boolean := true;
  v_check_letter boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_check_total :=
      (new.imp_neto, new.imp_iva, new.imp_trib, new.imp_no_gravado,
       new.imp_op_exentas, new.imp_total, new.channel_id)
      is distinct from
      (old.imp_neto, old.imp_iva, old.imp_trib, old.imp_no_gravado,
       old.imp_op_exentas, old.imp_total, old.channel_id);
    v_check_letter :=
      (new.letter, new.imp_iva, new.imp_no_gravado, new.imp_op_exentas, new.channel_id)
      is distinct from
      (old.letter, old.imp_iva, old.imp_no_gravado, old.imp_op_exentas, old.channel_id);
  end if;
  if not (v_check_total or v_check_letter)
     or not coalesce(public.is_channel_fiscal(new.channel_id), false) then
    return new;
  end if;
  if v_check_letter
     and new.letter in ('B', 'C')
     and (new.imp_iva <> 0 or new.imp_no_gravado <> 0 or new.imp_op_exentas <> 0) then
    raise exception 'En facturas B y C el IVA, el exento y el no gravado van incluidos en el neto: cargá el IVA en 0 y, si hay ítems, con «Sin alícuota».'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_check_total
     and new.imp_total <> new.imp_neto + new.imp_iva + new.imp_trib
                          + new.imp_no_gravado + new.imp_op_exentas then
    raise exception 'Los importes no suman el total: neto + IVA + otros tributos + no gravado + exento tienen que dar el total del comprobante.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_purchase_invoice_total() from public, anon, authenticated;

drop trigger purchase_invoices_total_matches_parts on public.purchase_invoices;
create trigger purchase_invoices_total_matches_parts
  before insert or update of imp_neto, imp_iva, imp_trib, imp_no_gravado, imp_op_exentas, imp_total, channel_id, letter
  on public.purchase_invoices
  for each row execute function public.guard_purchase_invoice_total();
