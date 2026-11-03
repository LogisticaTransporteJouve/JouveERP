SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A fiscal purchase charged to an employee charges them what the journal
-- debits to anticipos_personal (20261104095200): since 20261104096400 that is
-- neto + no gravado + exento + municipales + internos, not imp_neto alone. The
-- company still takes IVA and both perceptions as credit. Internal channel:
-- the charge stays imp_total.
--
-- No backfill: every existing purchase has the four new amounts at 0 (the
-- 20261104096400 backfill only moves imp_trib to imp_perc_iibb), so its
-- charge is already imp_neto. Latest body: 20261104095200.

create or replace function public.purchase_invoice_sync_employee_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric;
begin
  v_amount := case when public.is_channel_fiscal(new.channel_id)
                   then new.imp_neto + new.imp_no_gravado + new.imp_op_exentas
                        + new.imp_perc_municipales + new.imp_impuestos_internos
                   else new.imp_total end;
  if new.charged_employee_id is null or new.status <> 'received' or coalesce(v_amount, 0) <= 0 then
    delete from public.employee_account_movements where purchase_invoice_id = new.id;
    return null;
  end if;

  insert into public.employee_account_movements (
    employee_id, kind, currency, amount, movement_date, description, purchase_invoice_id, created_by
  ) values (
    new.charged_employee_id, 'charge',
    case when new.moneda = 'DOL' then 'USD' else 'ARS' end,
    v_amount, new.fecha,
    'Compra ' || coalesce(new.letter::text, '') || lpad(new.punto_venta::text, 4, '0')
      || '-' || lpad(new.numero::text, 8, '0') || ' a cargo del empleado',
    new.id, auth.uid()
  )
  on conflict (purchase_invoice_id) where purchase_invoice_id is not null do update
     set employee_id   = excluded.employee_id,
         currency      = excluded.currency,
         amount        = excluded.amount,
         movement_date = excluded.movement_date,
         description   = excluded.description;
  return null;
end;
$$;

revoke all on function public.purchase_invoice_sync_employee_charge() from public, anon, authenticated;

drop trigger purchase_invoices_sync_employee_charge on public.purchase_invoices;
create trigger purchase_invoices_sync_employee_charge
  after insert or update of charged_employee_id, status, imp_total, imp_neto, moneda, fecha,
                            punto_venta, numero, channel_id, imp_no_gravado, imp_op_exentas,
                            imp_perc_municipales, imp_impuestos_internos
  on public.purchase_invoices
  for each row execute function public.purchase_invoice_sync_employee_charge();
