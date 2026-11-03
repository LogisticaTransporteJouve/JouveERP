SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W2 · S3 F2: an NC against a purchase charged to an employee.
--
-- The employee kept owing the whole factura and the NC credited the expense
-- account (or compras), so the employee paid for goods that went back to the
-- supplier and Gestión showed the NC as a gain on a cost that was never the
-- company's. Now:
--
--   1. build_purchase_invoice_journal_lines (latest: 20261104096400): an NC
--      whose origin is charged to an employee posts its neto (the same sum
--      of parts) to anticipos_personal, like the factura's debit. Only that
--      line changes.
--   2. The charge is the factura's figure minus its live NCs (status
--      'received', same currency), with the 20261104096700 rule per
--      document (fiscal: neto + no gravado + exento + municipales + internos;
--      internal: imp_total). An NC insert, edit, cancel, delete or re-point
--      re-syncs the factura it credits. At or below zero the charge goes.
--   3. The charge's description is refreshed only while it is still the
--      automatic text: one the user edited is kept (W1 · S3 #18).
--   4. Changing who a factura is charged to re-posts its live NCs, and an
--      NC's journal re-posts when its origin changes.
--
-- Backfill: the charges of facturas with live NCs are re-synced (the
-- employee's balance shows what was over-charged) and those NCs are
-- re-posted. An NC in a closed period keeps its entry until the period is
-- reopened (docs/pendientes.md lists them).
--
-- Rollback: older code reads the same columns and calls no new function;
-- older SQL (20261104096700) would charge the factura whole again on its next
-- edit.

-- 1. Journal --------------------------------------------------------------------------

create or replace function public.build_purchase_invoice_journal_lines(
  p_invoice     public.purchase_invoices,
  p_description text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lines  jsonb := '[]'::jsonb;
  v_debit_detail boolean := p_invoice.kind <> 'nc';
  v_rate   numeric := case
    when p_invoice.moneda is null or p_invoice.moneda = 'PES' then 1
    else coalesce(
      nullif(p_invoice.cotizacion, 0),
      public.get_exchange_rate('USD', p_invoice.fecha),
      1
    )
  end;
  -- Each component converted and rounded on its own, as libro_iva_compras does.
  v_neto   numeric := round(p_invoice.imp_neto * v_rate, 2)
                    + round(p_invoice.imp_no_gravado * v_rate, 2)
                    + round(p_invoice.imp_op_exentas * v_rate, 2)
                    + round(p_invoice.imp_perc_municipales * v_rate, 2)
                    + round(p_invoice.imp_impuestos_internos * v_rate, 2);
  v_has_neto boolean := (p_invoice.imp_neto + p_invoice.imp_no_gravado + p_invoice.imp_op_exentas
                         + p_invoice.imp_perc_municipales + p_invoice.imp_impuestos_internos) > 0;
  v_iva    numeric := round(p_invoice.imp_iva * v_rate, 2);
  v_perc_iva  numeric := round(p_invoice.imp_perc_iva * v_rate, 2);
  v_perc_iibb numeric := round(p_invoice.imp_perc_iibb * v_rate, 2);
  -- Without an active account for the role, IVA perceptions post with the IVA credit.
  v_perc_iva_role text := case when exists (
    select 1 from public.chart_of_accounts
     where system_role = 'percepciones_iva_pagadas' and is_active
  ) then 'percepciones_iva_pagadas' else 'iva_credito' end;
  v_prov   numeric;
  -- Charged to an employee: the purchase itself, or (an NC) the document it
  -- credits. The NC then takes back from anticipos_personal what the
  -- employee no longer owes, never from the expense.
  v_to_employee boolean := (
    p_invoice.charged_employee_id is not null
    or (p_invoice.kind = 'nc' and exists (
          select 1 from public.purchase_invoices o
           where o.id = p_invoice.invoice_origin_id
             and o.charged_employee_id is not null))
  ) and exists (
    select 1 from public.chart_of_accounts
     where system_role = 'anticipos_personal' and is_active
  );
begin
  -- Counterparty = sum of the posted detail lines → exact balance.
  v_prov := (case when v_has_neto then v_neto else 0 end)
    + (case when p_invoice.imp_iva > 0 then v_iva else 0 end)
    + (case when p_invoice.imp_perc_iva > 0 then v_perc_iva else 0 end)
    + (case when p_invoice.imp_perc_iibb > 0 then v_perc_iibb else 0 end);

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'proveedores',
    case when v_debit_detail then 'credit' else 'debit' end, v_prov,
    'description', p_description || ' — proveedor'
  );
  if v_has_neto then
    v_lines := v_lines || case
      when v_to_employee then jsonb_build_object(
        'system_role', 'anticipos_personal',
        case when v_debit_detail then 'debit' else 'credit' end, v_neto,
        'description', p_description || ' — a cargo de empleado')
      when p_invoice.account_id is not null then jsonb_build_object(
        'account_id', p_invoice.account_id,
        case when v_debit_detail then 'debit' else 'credit' end, v_neto,
        'description', p_description || ' — neto')
      else jsonb_build_object(
        'system_role', 'compras',
        case when v_debit_detail then 'debit' else 'credit' end, v_neto,
        'description', p_description || ' — neto')
    end;
  end if;
  if p_invoice.imp_iva > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'iva_credito',
      case when v_debit_detail then 'debit' else 'credit' end, v_iva,
      'description', p_description || ' — IVA crédito'
    );
  end if;
  if p_invoice.imp_perc_iva > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_perc_iva_role,
      case when v_debit_detail then 'debit' else 'credit' end, v_perc_iva,
      'description', p_description || ' — percepciones IVA'
    );
  end if;
  if p_invoice.imp_perc_iibb > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'percepciones_iibb_pagadas',
      case when v_debit_detail then 'debit' else 'credit' end, v_perc_iibb,
      'description', p_description || ' — percepciones'
    );
  end if;
  return v_lines;
end;
$$;

revoke all on function public.build_purchase_invoice_journal_lines(public.purchase_invoices, text) from public, anon, authenticated;

-- 2. Charge ---------------------------------------------------------------------------

-- What a purchase charges its employee, before NCs (20261104096700 rule).
create function public.purchase_employee_charge_figure(p public.purchase_invoices)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_channel_fiscal(p.channel_id)
              then p.imp_neto + p.imp_no_gravado + p.imp_op_exentas
                   + p.imp_perc_municipales + p.imp_impuestos_internos
              else p.imp_total end;
$$;

revoke all on function public.purchase_employee_charge_figure(public.purchase_invoices)
  from public, anon, authenticated;

-- Writes the employee charge of one purchase from its current row and its
-- live NCs. The triggers below call it.
create function public.sync_purchase_employee_charge(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi     public.purchase_invoices;
  v_amount numeric;
  v_desc   text;
begin
  if p_invoice_id is null then
    return;
  end if;
  select * into v_pi from public.purchase_invoices where id = p_invoice_id;
  v_amount := public.purchase_employee_charge_figure(v_pi) - coalesce((
    select sum(public.purchase_employee_charge_figure(nc))
      from public.purchase_invoices nc
     where nc.invoice_origin_id = v_pi.id
       and nc.kind = 'nc'
       and nc.status = 'received'
       and coalesce(nc.moneda, 'PES') = coalesce(v_pi.moneda, 'PES')
  ), 0);
  if v_pi.id is null or v_pi.charged_employee_id is null or v_pi.status <> 'received'
     or coalesce(v_amount, 0) <= 0 then
    delete from public.employee_account_movements where purchase_invoice_id = p_invoice_id;
    return;
  end if;

  v_desc := 'Compra ' || coalesce(v_pi.letter::text, '') || lpad(v_pi.punto_venta::text, 4, '0')
    || '-' || lpad(v_pi.numero::text, 8, '0') || ' a cargo del empleado';
  insert into public.employee_account_movements as m (
    employee_id, kind, currency, amount, movement_date, description, purchase_invoice_id, created_by
  ) values (
    v_pi.charged_employee_id, 'charge',
    case when v_pi.moneda = 'DOL' then 'USD' else 'ARS' end,
    v_amount, v_pi.fecha, v_desc, v_pi.id, auth.uid()
  )
  on conflict (purchase_invoice_id) where purchase_invoice_id is not null do update
     set employee_id   = excluded.employee_id,
         currency      = excluded.currency,
         amount        = excluded.amount,
         movement_date = excluded.movement_date,
         -- The user may edit the description: only the automatic text follows
         -- the purchase's number.
         description   = case
           when m.description ~ '^Compra .* a cargo del empleado$' then excluded.description
           else m.description
         end;
end;
$$;

revoke all on function public.sync_purchase_employee_charge(uuid) from public, anon, authenticated;

-- A purchase re-syncs its own charge; an NC re-syncs the purchase it credits
-- (before and after a re-point).
create or replace function public.purchase_invoice_sync_employee_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.purchase_invoices;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  perform public.sync_purchase_employee_charge(v_row.id);
  if tg_op = 'UPDATE' then
    if old.kind = 'nc'
       and (new.kind <> 'nc' or old.invoice_origin_id is distinct from new.invoice_origin_id) then
      perform public.sync_purchase_employee_charge(old.invoice_origin_id);
    end if;
  end if;
  if v_row.kind = 'nc' then
    perform public.sync_purchase_employee_charge(v_row.invoice_origin_id);
  end if;
  return null;
end;
$$;

revoke all on function public.purchase_invoice_sync_employee_charge() from public, anon, authenticated;

drop trigger purchase_invoices_sync_employee_charge on public.purchase_invoices;
create trigger purchase_invoices_sync_employee_charge
  after insert or delete or update of charged_employee_id, status, imp_total, imp_neto, moneda, fecha,
                            punto_venta, numero, channel_id, imp_no_gravado, imp_op_exentas,
                            imp_perc_municipales, imp_impuestos_internos, kind, invoice_origin_id
  on public.purchase_invoices
  for each row execute function public.purchase_invoice_sync_employee_charge();

-- 3. Re-post -------------------------------------------------------------------------

-- The NCs of a purchase whose employee charge changed post to another account.
create function public.purchase_invoice_repost_credit_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nc uuid;
begin
  for v_nc in
    select nc.id from public.purchase_invoices nc
     where nc.invoice_origin_id = new.id and nc.kind = 'nc' and nc.status = 'received'
  loop
    perform public.repost_journal('purchase_invoices', v_nc);
  end loop;
  return null;
end;
$$;

revoke all on function public.purchase_invoice_repost_credit_notes() from public, anon, authenticated;

create constraint trigger purchase_invoices_repost_credit_notes
  after update of charged_employee_id
  on public.purchase_invoices
  deferrable initially deferred
  for each row
  when (old.charged_employee_id is distinct from new.charged_employee_id)
  execute function public.purchase_invoice_repost_credit_notes();

-- An NC's entry depends on its origin: same columns as 20261104096400 plus
-- invoice_origin_id.
drop trigger purchase_invoices_repost_journal on public.purchase_invoices;
create constraint trigger purchase_invoices_repost_journal
  after update of imp_neto, imp_iva, imp_trib, imp_total, fecha, moneda, cotizacion,
                  account_id, cost_center_id, kind, channel_id, charged_employee_id,
                  imp_no_gravado, imp_op_exentas, imp_perc_iva, imp_perc_iibb,
                  imp_perc_municipales, imp_impuestos_internos, invoice_origin_id
  on public.purchase_invoices
  deferrable initially deferred
  for each row execute function public.repost_journal_trigger();

-- 4. Backfill ------------------------------------------------------------------------

-- The guard refuses changing an owned movement outside its owner, and the
-- updated_at trigger would stamp rows nobody edited (as 20261104095200).
alter table public.employee_account_movements disable trigger employee_account_movements_guard;
alter table public.employee_account_movements disable trigger employee_account_movements_set_updated_at;

select public.sync_purchase_employee_charge(f.id)
  from public.purchase_invoices f
 where f.charged_employee_id is not null
   and exists (select 1 from public.purchase_invoices nc
                where nc.invoice_origin_id = f.id and nc.kind = 'nc' and nc.status = 'received');

alter table public.employee_account_movements enable trigger employee_account_movements_guard;
alter table public.employee_account_movements enable trigger employee_account_movements_set_updated_at;

-- Re-post the NCs of charged purchases; a closed period keeps its entry.
do $$
declare
  v_nc uuid;
begin
  for v_nc in
    select nc.id
      from public.purchase_invoices nc
      join public.purchase_invoices f on f.id = nc.invoice_origin_id
     where nc.kind = 'nc' and nc.status = 'received' and f.charged_employee_id is not null
  loop
    begin
      perform public.repost_journal('purchase_invoices', v_nc);
    exception when sqlstate '55006' then
      raise notice 'NC % de una compra a cargo de empleado: período cerrado, queda con su asiento', v_nc;
    end;
  end loop;
end;
$$;
