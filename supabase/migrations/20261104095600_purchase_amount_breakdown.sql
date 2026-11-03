SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Exempt, non-taxed and each tribute on every purchase.
--
--   imp_neto keeps meaning neto gravado. imp_trib stays as the sum of the four
--   tribute columns (CHECK), so every reader of imp_trib keeps working. The
--   journal and the libro IVA use the sum of the parts, not imp_total.
--
--   Journal: neto, no gravado, exento, municipales and internos post to the
--   expense account; percepciones IVA to percepciones_iva_pagadas (iva_credito
--   while no active account holds the role); percepciones IIBB to
--   percepciones_iibb_pagadas, as all of imp_trib did before. A purchase with
--   only imp_perc_iibb set posts the same entry as before this migration.
--
--   Order matters: columns, then the legacy fill, then the backfill (it does
--   not queue a repost: imp_perc_iibb is not in the repost trigger's column
--   list until step 8, and the closed-period guard only lists it from step 7),
--   then the CHECK, then the functions, then the repost trigger with the new
--   columns.

-- 1. Columns -------------------------------------------------------------------------

alter table public.purchase_invoices
  add column imp_no_gravado         numeric(15, 2) not null default 0 check (imp_no_gravado >= 0),
  add column imp_op_exentas         numeric(15, 2) not null default 0 check (imp_op_exentas >= 0),
  add column imp_perc_iva           numeric(15, 2) not null default 0 check (imp_perc_iva >= 0),
  add column imp_perc_iibb          numeric(15, 2) not null default 0 check (imp_perc_iibb >= 0),
  add column imp_perc_municipales   numeric(15, 2) not null default 0 check (imp_perc_municipales >= 0),
  add column imp_impuestos_internos numeric(15, 2) not null default 0 check (imp_impuestos_internos >= 0);

-- 2. Legacy fill -----------------------------------------------------------------------
-- A writer that sends imp_trib without its parts (code older than this
-- migration, a rollback, a seed) keeps today's meaning: all of it is IIBB.
-- Current code always sends the parts. Death condition: no deployable version
-- older than this migration remains.

create function public.purchase_invoices_trib_legacy_fill()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.imp_trib <> 0
       and new.imp_perc_iva = 0 and new.imp_perc_iibb = 0
       and new.imp_perc_municipales = 0 and new.imp_impuestos_internos = 0 then
      new.imp_perc_iibb := new.imp_trib;
    end if;
  elsif new.imp_trib is distinct from old.imp_trib
     and (new.imp_perc_iva, new.imp_perc_iibb, new.imp_perc_municipales, new.imp_impuestos_internos)
         is not distinct from
         (old.imp_perc_iva, old.imp_perc_iibb, old.imp_perc_municipales, old.imp_impuestos_internos)
     and old.imp_perc_iva = 0 and old.imp_perc_municipales = 0 and old.imp_impuestos_internos = 0 then
    new.imp_perc_iibb := new.imp_trib;
  end if;

  -- Raised here so the user reads the message; the CHECK below is the backstop.
  if new.imp_trib <> new.imp_perc_iva + new.imp_perc_iibb + new.imp_perc_municipales + new.imp_impuestos_internos then
    raise exception 'Los tributos no suman el total de otros tributos.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.purchase_invoices_trib_legacy_fill() from public, anon, authenticated;

create trigger purchase_invoices_trib_legacy_fill
  before insert or update of imp_trib, imp_perc_iva, imp_perc_iibb, imp_perc_municipales, imp_impuestos_internos
  on public.purchase_invoices
  for each row execute function public.purchase_invoices_trib_legacy_fill();

-- 3. Backfill ----------------------------------------------------------------------------
-- Every existing tribute was posted as IIBB. Bumps updated_at on those rows.

update public.purchase_invoices
   set imp_perc_iibb = imp_trib
 where imp_trib <> 0 and imp_perc_iibb = 0;

-- 4. CHECK ---------------------------------------------------------------------------------

-- Every row satisfies it after the backfill (about 1500 rows): it validates at once.
alter table public.purchase_invoices
  add constraint purchase_invoices_trib_split
  check (imp_trib = imp_perc_iva + imp_perc_iibb + imp_perc_municipales + imp_impuestos_internos)
  not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.purchase_invoices validate constraint purchase_invoices_trib_split;

-- 5. Journal lines (from 20261103060100) -------------------------------------------------

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
  v_to_employee boolean := p_invoice.charged_employee_id is not null and exists (
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

-- 6. Items (from 20261031180534) ----------------------------------------------------------

create or replace function public.replace_purchase_invoice_items(p_invoice_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item      jsonb;
  v_sum_neto  numeric(15, 2);
  v_sum_iva   numeric(15, 2);
  v_sum_total numeric(15, 2);
begin
  -- Role guard (purchase_invoices:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar ítems de facturas de compra'
      using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a jsonb array';
  end if;

  delete from public.purchase_invoice_items
   where purchase_invoice_id = p_invoice_id;

  if jsonb_array_length(p_items) = 0 then
    return;
  end if;

  -- An item without a rate would count exempt or non-taxed amounts a second time.
  if exists (
       select 1 from public.purchase_invoices
        where id = p_invoice_id and imp_no_gravado + imp_op_exentas > 0
     )
     and exists (
       select 1 from jsonb_array_elements(p_items) e
        where nullif(e ->> 'iva_rate_id', '') is null
     ) then
    raise exception 'Con exento o no gravado en el encabezado, los ítems deben tener alícuota.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.purchase_invoice_items (
      purchase_invoice_id, sort_order, description,
      quantity, unit_price, iva_rate_id,
      line_neto, line_iva, line_total
    ) values (
      p_invoice_id,
      coalesce((v_item ->> 'sort_order')::int, 0),
      v_item ->> 'description',
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_price')::numeric,
      nullif(v_item ->> 'iva_rate_id', '')::int,
      (v_item ->> 'line_neto')::numeric,
      coalesce((v_item ->> 'line_iva')::numeric, 0),
      (v_item ->> 'line_total')::numeric
    );
  end loop;

  -- Recalc header totals from items. imp_trib, imp_no_gravado and
  -- imp_op_exentas (header-level) preserved.
  select
    coalesce(sum(line_neto),  0),
    coalesce(sum(line_iva),   0),
    coalesce(sum(line_total), 0)
    into v_sum_neto, v_sum_iva, v_sum_total
  from public.purchase_invoice_items
  where purchase_invoice_id = p_invoice_id;

  update public.purchase_invoices
     set imp_neto  = v_sum_neto,
         imp_iva   = v_sum_iva,
         imp_total = v_sum_total + coalesce(imp_trib, 0) + imp_no_gravado + imp_op_exentas,
         updated_at = now()
   where id = p_invoice_id;
end;
$$;

revoke all on function public.replace_purchase_invoice_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_purchase_invoice_items(uuid, jsonb) to authenticated, service_role;

-- 7. Guards: the new columns are what libro_iva_compras and the frozen remitos read ------

create or replace function public.guard_purchase_invoice_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'received' and new.channel_id is distinct from old.channel_id then
    raise exception 'No se puede cambiar el canal de una factura de compra recibida: anulala y cargala en el canal correcto'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if new.kind is distinct from old.kind and (
       exists (select 1 from public.payment_order_allocations poa
                 join public.payment_orders po on po.id = poa.payment_order_id
                where poa.purchase_invoice_id = old.id and po.status <> 'canceled')
    or exists (select 1 from public.supplier_opening_balance_allocations soba
                where soba.purchase_invoice_id = old.id)
    or exists (select 1 from public.purchase_invoices nc
                where nc.invoice_origin_id = old.id and nc.status = 'received')
  ) then
    raise exception 'No se puede cambiar el tipo de una factura de compra que ya tiene imputaciones o notas de crédito'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- What libro_iva_compras reads, for a fiscal purchase in a closed period.
  if old.status = 'received'
     and (public.is_channel_fiscal(old.channel_id) or public.is_channel_fiscal(new.channel_id))
     and exists (select 1 from public.accounting_closed_periods cp
                  where cp.period in (to_char(old.fecha, 'YYYY-MM'), to_char(new.fecha, 'YYYY-MM')))
     and (new.fecha, new.kind, new.letter, new.punto_venta, new.numero, new.supplier_id,
          new.cae_proveedor, new.cae_vto_proveedor, new.imp_neto, new.imp_iva, new.imp_trib,
          new.imp_total, new.moneda, new.cotizacion, new.channel_id, new.status,
          new.imp_no_gravado, new.imp_op_exentas, new.imp_perc_iva, new.imp_perc_iibb,
          new.imp_perc_municipales, new.imp_impuestos_internos)
         is distinct from
         (old.fecha, old.kind, old.letter, old.punto_venta, old.numero, old.supplier_id,
          old.cae_proveedor, old.cae_vto_proveedor, old.imp_neto, old.imp_iva, old.imp_trib,
          old.imp_total, old.moneda, old.cotizacion, old.channel_id, old.status,
          old.imp_no_gravado, old.imp_op_exentas, old.imp_perc_iva, old.imp_perc_iibb,
          old.imp_perc_municipales, old.imp_impuestos_internos) then
    raise exception 'El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_purchase_invoice_edit() from public, anon, authenticated;

create or replace function public.guard_purchase_remito_frozen_doc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- impute_purchase_remitos and the factura's cancellation.
  if current_setting('jouve.imputing_purchase', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.imputed_to_id is not null then
      raise exception 'Solo la imputación de remitos vincula una nota de crédito a una factura.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if new.invoice_origin_id is not null then
      if public.purchase_remito_imputed_to(new.invoice_origin_id) is not null then
        raise exception 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

  if new.imputed_to_id is distinct from old.imputed_to_id then
    raise exception 'Solo la imputación de remitos vincula una nota de crédito a una factura.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- A factura keeps room for the remitos imputed to it.
  if new.imp_total < old.imp_total
     and new.imp_total + 0.01 < coalesce((
       select sum(n.imp_total)
       from public.purchase_invoices n
       where n.imputed_to_id = new.id and n.status = 'received'
     ), 0) then
    raise exception 'La factura tiene remitos imputados por más que ese total.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if old.imputed_to_id is not null and old.status = 'received'
     and (new.status, new.kind, new.channel_id, new.supplier_id,
          new.invoice_origin_id, new.imp_neto, new.imp_iva, new.imp_trib,
          new.imp_total, new.moneda, new.cotizacion,
          new.imp_no_gravado, new.imp_op_exentas, new.imp_perc_iva, new.imp_perc_iibb,
          new.imp_perc_municipales, new.imp_impuestos_internos)
         is distinct from
         (old.status, old.kind, old.channel_id, old.supplier_id,
          old.invoice_origin_id, old.imp_neto, old.imp_iva, old.imp_trib,
          old.imp_total, old.moneda, old.cotizacion,
          old.imp_no_gravado, old.imp_op_exentas, old.imp_perc_iva, old.imp_perc_iibb,
          old.imp_perc_municipales, old.imp_impuestos_internos) then
    raise exception 'Esta nota de crédito acredita un remito imputado a una factura de Compras: no se puede cambiar ni anular mientras la factura esté vigente.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if old.status = 'received'
     and public.purchase_remito_imputed_to(old.id) is not null
     and (new.status, new.kind, new.channel_id, new.supplier_id,
          new.imp_neto, new.imp_iva, new.imp_trib, new.imp_total,
          new.moneda, new.cotizacion,
          new.imp_no_gravado, new.imp_op_exentas, new.imp_perc_iva, new.imp_perc_iibb,
          new.imp_perc_municipales, new.imp_impuestos_internos)
         is distinct from
         (old.status, old.kind, old.channel_id, old.supplier_id,
          old.imp_neto, old.imp_iva, old.imp_trib, old.imp_total,
          old.moneda, old.cotizacion,
          old.imp_no_gravado, old.imp_op_exentas, old.imp_perc_iva, old.imp_perc_iibb,
          old.imp_perc_municipales, old.imp_impuestos_internos) then
    raise exception 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if new.invoice_origin_id is distinct from old.invoice_origin_id
     and new.invoice_origin_id is not null then
    if public.purchase_remito_imputed_to(new.invoice_origin_id) is not null then
      raise exception 'El remito se imputó a una factura de Compras: no admite pagos, ajustes, notas ni anulación.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_purchase_remito_frozen_doc() from public, anon, authenticated;

-- 8. Repost: same columns as 20261103060100 plus the six new ones -------------------------

drop trigger purchase_invoices_repost_journal on public.purchase_invoices;
create constraint trigger purchase_invoices_repost_journal
  after update of imp_neto, imp_iva, imp_trib, imp_total, fecha, moneda, cotizacion,
                  account_id, cost_center_id, kind, channel_id, charged_employee_id,
                  imp_no_gravado, imp_op_exentas, imp_perc_iva, imp_perc_iibb,
                  imp_perc_municipales, imp_impuestos_internos
  on public.purchase_invoices
  deferrable initially deferred
  for each row execute function public.repost_journal_trigger();
