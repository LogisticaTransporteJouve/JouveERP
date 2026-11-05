SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Purchase NC/ND against their origin (audit w17, compras):
--
--   * purchase_invoices_open_after_insert runs the open-amount check of
--     purchase_invoices_open_after_edit (20261031180534, update only) on the
--     INSERT of a note with an origin, so a new NC larger than what its
--     origin still has open is refused, as on the sales side
--     (invoices_nc_open_after_change). The function
--     guard_purchase_invoice_open_after_edit is unchanged: on insert OLD is
--     null, so it checks the new row and its origin. A purchase without
--     origin cannot lower another's open amount, so its insert skips the
--     check (and the view read).
--   * guard_purchase_invoice_origin (latest: 20261031173652) also refuses an
--     NC/ND in another currency than its origin, and a change of currency on
--     an origin whose received NC/ND are in the old one (cancel them first).
--     v_purchase_invoice_open subtracts an NC's total from its origin's with
--     no currency term. The note's currency is checked on insert and when its
--     currency or its origin change, so an existing pair still saves its
--     other fields.

create constraint trigger purchase_invoices_open_after_insert
  after insert
  on public.purchase_invoices
  deferrable initially deferred
  for each row
  when (new.invoice_origin_id is not null)
  execute function public.guard_purchase_invoice_open_after_edit();

create or replace function public.guard_purchase_invoice_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier uuid;
  v_channel  text;
  v_moneda   text;
begin
  if new.invoice_origin_id is not null then
    select supplier_id, channel_id, moneda into v_supplier, v_channel, v_moneda
      from public.purchase_invoices where id = new.invoice_origin_id;
    if found then
      if v_supplier is distinct from new.supplier_id then
        raise exception 'La factura de origen es de otro proveedor'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      if v_channel is distinct from new.channel_id then
        raise exception 'La factura de origen es de otro canal: una NC/ND va en el mismo canal que su factura'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      if coalesce(v_moneda, 'PES') is distinct from coalesce(new.moneda, 'PES')
         and (tg_op = 'INSERT'
              or new.moneda is distinct from old.moneda
              or new.invoice_origin_id is distinct from old.invoice_origin_id) then
        raise exception 'La factura de origen está en otra moneda: una NC/ND va en la misma moneda que su factura'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and (new.channel_id is distinct from old.channel_id
          or new.supplier_id is distinct from old.supplier_id)
     and exists (
       select 1 from public.purchase_invoices n
        where n.invoice_origin_id = new.id
          and (n.channel_id is distinct from new.channel_id
               or n.supplier_id is distinct from new.supplier_id)
     ) then
    raise exception 'Esta factura es origen de una NC/ND: no se le puede cambiar el canal ni el proveedor'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if tg_op = 'UPDATE'
     and new.moneda is distinct from old.moneda
     and exists (
       select 1 from public.purchase_invoices n
        where n.invoice_origin_id = new.id
          and n.status = 'received'
          and coalesce(n.moneda, 'PES') is distinct from coalesce(new.moneda, 'PES')
     ) then
    raise exception 'Esta factura es origen de una NC/ND: no se le puede cambiar la moneda'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_purchase_invoice_origin() from public, anon, authenticated;

drop trigger if exists guard_purchase_invoice_origin on public.purchase_invoices;
create trigger guard_purchase_invoice_origin
  before insert or update of invoice_origin_id, channel_id, supplier_id, moneda
  on public.purchase_invoices
  for each row execute function public.guard_purchase_invoice_origin();
