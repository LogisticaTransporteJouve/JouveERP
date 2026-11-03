SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A purchase charged to an employee charges them what the company does not
-- recover (follow-up of 20261103060100_employee_accounts, decision in
-- docs/decisions.md "Compra a cargo de empleado: se le carga el neto").
--
-- The charge was imp_total while the fiscal journal posts only the neto to
-- anticipos_personal and takes the IVA and the percepciones as the company's
-- credit: anticipos ended −IVA per purchase once the employee paid back, and
-- the IVA was recovered twice (crédito fiscal + the employee). Now:
--
--   * fiscal channel (the purchase is journaled, IVA crédito and
--     percepciones taken): the charge is imp_neto, the same figure the
--     journal debits to anticipos_personal (in the purchase's currency);
--   * internal channel (no journal, no credit): the charge stays imp_total.
--
-- The sync also fires on imp_neto and channel_id. Existing charges are
-- re-synced to the new figure (the employee's balance shows what was
-- over-charged). The purchase, its Libro IVA and its journal are unchanged.

create or replace function public.purchase_invoice_sync_employee_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric;
begin
  v_amount := case when public.is_channel_fiscal(new.channel_id) then new.imp_neto
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
                            punto_venta, numero, channel_id
  on public.purchase_invoices
  for each row execute function public.purchase_invoice_sync_employee_charge();

comment on column public.purchase_invoices.charged_employee_id is
  'A cargo de empleado: el neto (canal fiscal, la empresa toma el IVA y las percepciones como crédito) o el total (canal interno) va a su cuenta corriente, y el neto se asienta en anticipos al personal (fuera del costo de Gestión). Sigue en el Libro IVA.';

-- Backfill: the guard refuses changing an owned movement's amount outside
-- its owner, and the updated_at trigger would stamp rows nobody edited.
alter table public.employee_account_movements disable trigger employee_account_movements_guard;
alter table public.employee_account_movements disable trigger employee_account_movements_set_updated_at;

update public.employee_account_movements m
   set amount = pi.imp_neto
  from public.purchase_invoices pi
 where pi.id = m.purchase_invoice_id
   and public.is_channel_fiscal(pi.channel_id)
   and pi.imp_neto > 0
   and m.amount is distinct from pi.imp_neto;

alter table public.employee_account_movements enable trigger employee_account_movements_guard;
alter table public.employee_account_movements enable trigger employee_account_movements_set_updated_at;
