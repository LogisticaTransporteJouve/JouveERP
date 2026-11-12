SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- «Corresponde a la actividad de Jouve» on sales and purchase invoices
-- (decision docs/decisions/2026-11-12-comprobantes-no-jouve.md). A document
-- with is_operational = false stays in the Libro IVA, balances and aging as
-- today, but is neither income nor expense:
--
-- 1. invoices.is_operational / purchase_invoices.is_operational (default true;
--    the existing rows are Jouve's). RLS is per row: columns only.
-- 2. «Cuenta particular de socios» (asset, system role
--    cuenta_particular_socios), at the first free code under 1.1, reusing an
--    active account with the role.
-- 3. build_invoice_journal_lines / build_purchase_invoice_journal_lines
--    (latest: 20261111205000): the net (and a sale NC's exchange difference)
--    posts to that account; IVA and perceptions unchanged; a purchase charged
--    to an employee keeps anticipos_personal.
-- 4. create_invoice_draft (20261106130000) and create_purchase_invoice
--    (20261106112000):
--    an NC/ND without the flag follows its origin; purchase_invoice_editable_fields
--    gains is_operational.
-- 5. Flipping the flag re-posts the journal (repost triggers) and is refused
--    while the document's live entry sits in a closed period.
-- 6. Management P&L (management_pnl_lines cash basis, 20261111205300;
--    management_payment_order_shares, 20261104120201) and the AI sales /
--    purchases summaries (20261111205300) leave these documents out. The
--    accrual basis, expense categories and the channel summary read the
--    journal, which no longer has a result line for them.
--
-- Rollback: older code ignores the column (new rows get true); the builders
-- keep posting flagged documents to the partners' account, as they should.

-- 1. Columns ----------------------------------------------------------------------------

alter table public.invoices
  add column is_operational boolean not null default true;
alter table public.purchase_invoices
  add column is_operational boolean not null default true;

comment on column public.invoices.is_operational is
  'Corresponde a la actividad de Jouve. Falso: sigue en el Libro IVA y en saldos, pero el neto va a «Cuenta particular de socios» y no cuenta como ingreso.';
comment on column public.purchase_invoices.is_operational is
  'Corresponde a la actividad de Jouve. Falso: sigue en el Libro IVA y en saldos, pero el neto va a «Cuenta particular de socios» y no cuenta como gasto.';

-- 2. The account ---------------------------------------------------------------------------

do $$
declare
  v_parent public.chart_of_accounts;
  v_n      int := 1;
begin
  if exists (select 1 from public.chart_of_accounts
              where system_role = 'cuenta_particular_socios' and is_active) then
    return;
  end if;
  select * into v_parent from public.chart_of_accounts where code = '1.1';
  if v_parent.id is null then
    return;
  end if;
  while exists (select 1 from public.chart_of_accounts where code = '1.1.' || v_n) loop
    v_n := v_n + 1;
  end loop;
  insert into public.chart_of_accounts
    (parent_id, code, name, level, account_type, system_role)
  values
    (v_parent.id, '1.1.' || v_n, 'Cuenta particular de socios', v_parent.level + 1,
     'activo', 'cuenta_particular_socios');
end;
$$;

-- 3. Builders --------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.build_invoice_journal_lines(p_invoice invoices, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $$
declare
  v_lines   jsonb := '[]'::jsonb;
  v_debit_client boolean := p_invoice.kind <> 'nc';
  v_rate    numeric := case
    when p_invoice.moneda is null or p_invoice.moneda = 'PES' then 1
    else coalesce(
      nullif(p_invoice.cotizacion, 0),
      public.get_exchange_rate('USD', p_invoice.fecha),
      1
    )
  end;
  v_revenue numeric := round(
    (p_invoice.imp_neto + p_invoice.imp_op_ex + p_invoice.imp_tot_conc) * v_rate, 2);
  v_iva     numeric := round(p_invoice.imp_iva * v_rate, 2);
  v_trib    numeric := round(p_invoice.imp_trib * v_rate, 2);
  v_client  numeric;
  v_origin_rate numeric;
  v_fx      numeric := 0;
  v_channel public.invoicing_channels;
  -- Not Jouve's activity: what would hit a result account goes to the
  -- partners' personal account instead.
  v_non_op  boolean := not coalesce(p_invoice.is_operational, true);
begin
  select * into v_channel from public.invoicing_channels where id = p_invoice.channel_id;
  if v_non_op and not exists (select 1 from public.chart_of_accounts a
                               where a.system_role = 'cuenta_particular_socios' and a.is_active) then
    raise exception 'La cuenta «Cuenta particular de socios» está inactiva o no existe: reactivala en Contabilidad'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if not v_non_op and v_revenue > 0 and v_channel.sales_account_id is not null
     and not exists (select 1 from public.chart_of_accounts a
                      where a.id = v_channel.sales_account_id and a.is_active) then
    raise exception 'La cuenta contable del canal % está inactiva: reactivala o cambiala en Contabilidad', v_channel.name
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- Counterparty = sum of the posted detail lines → exact balance.
  v_client := (case when v_revenue > 0 then v_revenue else 0 end)
    + (case when p_invoice.imp_iva > 0 then v_iva else 0 end)
    + (case when p_invoice.imp_trib > 0 then v_trib else 0 end);

  if p_invoice.kind = 'nc'
     and p_invoice.invoice_origin_id is not null
     and coalesce(p_invoice.moneda, 'PES') <> 'PES'
     and public.usd_booking_rate(p_invoice.cotizacion, p_invoice.fecha) is not null
     and exists (select 1 from public.chart_of_accounts
                  where system_role = 'diferencia_cambio' and is_active) then
    select public.usd_booking_rate(o.cotizacion, o.fecha) into v_origin_rate
      from public.invoices o
     where o.id = p_invoice.invoice_origin_id
       and coalesce(o.moneda, 'PES') <> 'PES';
    if v_origin_rate is not null then
      -- The same lines priced at the origin's rate, rounded the same way.
      v_fx := v_client
        - (case when v_revenue > 0 then round(
             (p_invoice.imp_neto + p_invoice.imp_op_ex + p_invoice.imp_tot_conc) * v_origin_rate, 2)
           else 0 end)
        - (case when p_invoice.imp_iva > 0 then round(p_invoice.imp_iva * v_origin_rate, 2) else 0 end)
        - (case when p_invoice.imp_trib > 0 then round(p_invoice.imp_trib * v_origin_rate, 2) else 0 end);
    end if;
  end if;

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'clientes',
    case when v_debit_client then 'debit' else 'credit' end, v_client - v_fx,
    'description', p_description || ' — cliente'
  );
  if v_fx <> 0 then
    -- Only an NC gets here: crediting clientes less pesos than the revenue it
    -- reverses is a gain; more is a loss.
    v_lines := v_lines || jsonb_build_object(
      'system_role', case when v_non_op then 'cuenta_particular_socios' else 'diferencia_cambio' end,
      case when v_fx > 0 then 'credit' else 'debit' end, abs(v_fx),
      'description', p_description || ' — diferencia de cambio'
    );
  end if;
  if v_revenue > 0 then
    v_lines := v_lines || case
      when v_non_op then jsonb_build_object(
        'system_role', 'cuenta_particular_socios',
        case when v_debit_client then 'credit' else 'debit' end, v_revenue,
        'description', p_description || ' — no corresponde a Jouve')
      when v_channel.sales_account_id is not null then jsonb_build_object(
        'account_id', v_channel.sales_account_id,
        case when v_debit_client then 'credit' else 'debit' end, v_revenue,
        'description', p_description || ' — neto')
      else jsonb_build_object(
        'system_role', 'ventas',
        case when v_debit_client then 'credit' else 'debit' end, v_revenue,
        'description', p_description || ' — neto')
    end;
  end if;
  if p_invoice.imp_iva > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'iva_debito',
      case when v_debit_client then 'credit' else 'debit' end, v_iva,
      'description', p_description || ' — IVA débito'
    );
  end if;
  if p_invoice.imp_trib > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'percepciones_iibb_cobradas',
      case when v_debit_client then 'credit' else 'debit' end, v_trib,
      'description', p_description || ' — percepciones'
    );
  end if;
  return v_lines;
end;
$$
;

CREATE OR REPLACE FUNCTION public.build_purchase_invoice_journal_lines(p_invoice purchase_invoices, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $$
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
  v_perc_nac  numeric := round(p_invoice.imp_perc_nacionales * v_rate, 2);
  -- Without an active account for the role, IVA perceptions post with the IVA credit.
  v_perc_iva_role text := case when exists (
    select 1 from public.chart_of_accounts
     where system_role = 'percepciones_iva_pagadas' and is_active
  ) then 'percepciones_iva_pagadas' else 'iva_credito' end;
  -- Ganancias and other national taxes: never IVA. Without an active account
  -- for the role they stay a tax credit, with the IIBB perceptions.
  v_perc_nac_role text := case when exists (
    select 1 from public.chart_of_accounts
     where system_role = 'percepciones_ganancias' and is_active
  ) then 'percepciones_ganancias' else 'percepciones_iibb_pagadas' end;
  v_prov   numeric;
  v_channel public.invoicing_channels;
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
  -- Not Jouve's activity: the net goes to the partners' personal account
  -- instead of an expense (a charge to an employee still wins).
  v_non_op boolean := not coalesce(p_invoice.is_operational, true);
begin
  if v_non_op and v_has_neto and not v_to_employee and not exists (
       select 1 from public.chart_of_accounts a
        where a.system_role = 'cuenta_particular_socios' and a.is_active) then
    raise exception 'La cuenta «Cuenta particular de socios» está inactiva o no existe: reactivala en Contabilidad'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  select * into v_channel from public.invoicing_channels where id = p_invoice.channel_id;
  if v_has_neto and not v_to_employee and not v_non_op and p_invoice.account_id is null
     and v_channel.purchase_account_id is not null
     and not exists (select 1 from public.chart_of_accounts a
                      where a.id = v_channel.purchase_account_id and a.is_active) then
    raise exception 'La cuenta contable del canal % está inactiva: reactivala o cambiala en Contabilidad', v_channel.name
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- Counterparty = sum of the posted detail lines → exact balance.
  v_prov := (case when v_has_neto then v_neto else 0 end)
    + (case when p_invoice.imp_iva > 0 then v_iva else 0 end)
    + (case when p_invoice.imp_perc_iva > 0 then v_perc_iva else 0 end)
    + (case when p_invoice.imp_perc_iibb > 0 then v_perc_iibb else 0 end)
    + (case when p_invoice.imp_perc_nacionales > 0 then v_perc_nac else 0 end);

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
      when v_non_op then jsonb_build_object(
        'system_role', 'cuenta_particular_socios',
        case when v_debit_detail then 'debit' else 'credit' end, v_neto,
        'description', p_description || ' — no corresponde a Jouve')
      when p_invoice.account_id is not null then jsonb_build_object(
        'account_id', p_invoice.account_id,
        case when v_debit_detail then 'debit' else 'credit' end, v_neto,
        'description', p_description || ' — neto')
      when v_channel.purchase_account_id is not null then jsonb_build_object(
        'account_id', v_channel.purchase_account_id,
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
  if p_invoice.imp_perc_nacionales > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_perc_nac_role,
      case when v_debit_detail then 'debit' else 'credit' end, v_perc_nac,
      'description', p_description || ' — percepciones Ganancias y otros nacionales'
    );
  end if;
  return v_lines;
end;
$$
;

revoke all on function public.build_invoice_journal_lines(public.invoices, text) from public, anon, authenticated;
revoke all on function public.build_purchase_invoice_journal_lines(public.purchase_invoices, text) from public, anon, authenticated;

-- 4. Writers ---------------------------------------------------------------------------------

create or replace function public.purchase_invoice_editable_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'channel_id', 'account_id', 'cost_center_id', 'charged_employee_id',
    'supplier_id', 'kind', 'letter', 'punto_venta', 'numero', 'fecha',
    'fch_vto_pago', 'imp_neto', 'imp_iva', 'imp_trib', 'imp_no_gravado',
    'imp_op_exentas', 'imp_perc_iva', 'imp_perc_nacionales', 'imp_perc_iibb',
    'imp_perc_municipales', 'imp_impuestos_internos', 'imp_total', 'moneda',
    'cotizacion', 'cae_proveedor', 'cae_vto_proveedor', 'invoice_origin_id',
    'motivo_nc_nd', 'notes', 'cbte_tipo_afip', 'is_operational'
  ]::text[];
$$;

revoke all on function public.purchase_invoice_editable_fields() from public, anon;
grant execute on function public.purchase_invoice_editable_fields() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_invoice_draft(p_invoice jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
declare
  v_id uuid;
begin
  if p_invoice is null or jsonb_typeof(p_invoice) <> 'object' then
    raise exception 'p_invoice must be a json object' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a draft needs at least one item' using errcode = '22023';
  end if;

  insert into public.invoices (
    channel_id, client_id, kind, letter, cbte_tipo_afip, punto_venta, numero,
    fecha, fch_serv_desde, fch_serv_hasta, fch_vto_pago, concepto, doc_tipo,
    doc_nro, iva_condition_receptor, imp_neto, imp_iva, imp_trib, imp_tot_conc,
    imp_op_ex, imp_total, moneda, cotizacion, status, invoice_origin_id,
    source_remito_id, motivo_nc_nd, notes, idempotency_key, created_by, is_operational
  )
  select
    r.channel_id, r.client_id, r.kind, r.letter, r.cbte_tipo_afip, r.punto_venta, null,
    r.fecha, r.fch_serv_desde, r.fch_serv_hasta, r.fch_vto_pago, r.concepto, r.doc_tipo,
    r.doc_nro, r.iva_condition_receptor, r.imp_neto, r.imp_iva, r.imp_trib, r.imp_tot_conc,
    r.imp_op_ex, r.imp_total, r.moneda, r.cotizacion, 'draft', r.invoice_origin_id,
    r.source_remito_id, r.motivo_nc_nd, r.notes, r.idempotency_key, r.created_by,
    -- Not given: an NC/ND follows its origin; anything else is Jouve's.
    coalesce(r.is_operational,
             (select o.is_operational from public.invoices o where o.id = r.invoice_origin_id),
             true)
  from jsonb_populate_record(null::public.invoices, p_invoice) r
  returning id into v_id;

  insert into public.invoice_items (
    invoice_id, sort_order, description, quantity, unit_price, iva_rate_id,
    revenue_kind, line_neto, line_iva, line_total
  )
  select
    v_id, i.sort_order, i.description, i.quantity, i.unit_price, i.iva_rate_id,
    coalesce(i.revenue_kind, 'service'), i.line_neto, i.line_iva, i.line_total
  from jsonb_populate_recordset(null::public.invoice_items, p_items) i;

  return v_id;
end;
$$
;

CREATE OR REPLACE FUNCTION public.create_purchase_invoice(p_header jsonb, p_items jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
declare
  v_fields text[] := public.purchase_invoice_editable_fields() || array['created_by'];
  v_cols   text;
  v_vals   text;
  v_id     uuid;
begin
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'p_header must be a jsonb object';
  end if;
  if exists (select 1 from jsonb_object_keys(p_header) k where k <> all (v_fields)) then
    raise exception 'p_header has a field that is not editable';
  end if;

  -- Not given: an NC/ND follows the document it adjusts.
  if not p_header ? 'is_operational' and nullif(p_header ->> 'invoice_origin_id', '') is not null then
    p_header := p_header || jsonb_build_object('is_operational', coalesce(
      (select o.is_operational from public.purchase_invoices o
        where o.id = (p_header ->> 'invoice_origin_id')::uuid), true));
  end if;

  select string_agg(format('%I', f), ', '), string_agg(format('r.%I', f), ', ')
    into v_cols, v_vals
    from unnest(v_fields) f
   where p_header ? f;

  execute format(
    'insert into public.purchase_invoices (%s) select %s from jsonb_populate_record(null::public.purchase_invoices, $1) r returning id',
    v_cols, v_vals
  ) into v_id using p_header;

  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    perform public.replace_purchase_invoice_items(v_id, p_items);
  end if;

  return v_id;
end;
$$
;

revoke all on function public.create_invoice_draft(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_invoice_draft(jsonb, jsonb) to service_role;
revoke all on function public.create_purchase_invoice(jsonb, jsonb) from public, anon;
grant execute on function public.create_purchase_invoice(jsonb, jsonb) to authenticated, service_role;

-- 5. Flip: closed period guard and re-post ----------------------------------------------------

-- The flag is not in the Libro IVA, so it may change in a closed IVA period
-- only while the journal can: refused when the document's live entry is in a
-- closed accounting period.
create function public.guard_document_operational_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text;
begin
  select je.accrual_period into v_period
    from public.journal_entries je
    join public.accounting_closed_periods cp on cp.period = je.accrual_period
   where je.id in (select public.current_journal_entries(tg_table_name, old.id))
   limit 1;
  if v_period is not null then
    raise exception 'El período contable % está cerrado: no se puede cambiar si el comprobante corresponde a la actividad de Jouve. Pedí que lo reabran en Contabilidad.', v_period
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_document_operational_change() from public, anon, authenticated;

create trigger invoices_guard_operational_change
  before update of is_operational on public.invoices
  for each row
  when (new.is_operational is distinct from old.is_operational)
  execute function public.guard_document_operational_change();

create trigger purchase_invoices_guard_operational_change
  before update of is_operational on public.purchase_invoices
  for each row
  when (new.is_operational is distinct from old.is_operational)
  execute function public.guard_document_operational_change();

-- An emitted sale is otherwise immutable: only the flag re-posts it.
create constraint trigger invoices_repost_journal
  after update of is_operational on public.invoices
  deferrable initially deferred
  for each row
  when (new.is_operational is distinct from old.is_operational)
  execute function public.repost_journal_trigger();

drop trigger purchase_invoices_repost_journal on public.purchase_invoices;

create constraint trigger purchase_invoices_repost_journal
  after update of imp_neto, imp_iva, imp_trib, imp_total, fecha, moneda, cotizacion, account_id,
    cost_center_id, kind, channel_id, charged_employee_id, imp_no_gravado, imp_op_exentas,
    imp_perc_iva, imp_perc_iibb, imp_perc_municipales, imp_impuestos_internos, invoice_origin_id,
    imp_perc_nacionales, is_operational
  on public.purchase_invoices
  deferrable initially deferred
  for each row
  execute function public.repost_journal_trigger();

-- 6. Management and AI reads -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.management_payment_order_shares(p_payment_order_id uuid, p_depth integer)
 RETURNS TABLE(f_employee numeric, f_fleet numeric, f_neutral numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $$
begin
  -- Below depth 0 a bounced check's part stays in Proveedores.
  if p_payment_order_id is null or p_depth < 0 then
    return query select 0::numeric, 0::numeric, 0::numeric;
    return;
  end if;

  return query
  -- least() skips nulls: coalesce first, or no OP would read as 1.
  select least(1, coalesce(a.employee, 0)),
         least(1 - least(1, coalesce(a.employee, 0)), coalesce(a.fleet, 0)),
         least(1 - least(1, coalesce(a.employee, 0))
                 - least(1 - least(1, coalesce(a.employee, 0)), coalesce(a.fleet, 0)),
               coalesce(a.neutral, 0))
    from (
      select sum(x.employee) / nullif(max(x.total), 0) as employee,
             sum(x.fleet)    / nullif(max(x.total), 0) as fleet,
             sum(x.neutral)  / nullif(max(x.total), 0) as neutral
        from (
          select po.total_amount as total,
                 case when pi.charged_employee_id is not null
                      then poa.amount_applied end as employee,
                 case when pi.charged_employee_id is null and pi.is_operational
                           and pmb.bucket = 'fleet_investment'
                      then poa.amount_applied end as fleet,
                 -- A purchase that is not Jouve's activity is no operating cost.
                 case when pi.charged_employee_id is null
                           and (pmb.bucket = 'neutral' or not pi.is_operational)
                      then poa.amount_applied end as neutral
            from public.payment_orders po
            join public.payment_order_allocations poa on poa.payment_order_id = po.id
            join public.purchase_invoices pi on pi.id = poa.purchase_invoice_id
            left join public.management_buckets pmb on pmb.chart_of_accounts_id = pi.account_id
           where po.id = p_payment_order_id
          union all
          -- A bounced check this order pays: the shares of the order that
          -- delivered it (for an endorsed check, the holder that
          -- v_supplier_rejected_check_open reads).
          select po.total_amount,
                 rca.amount_applied * s.f_employee,
                 rca.amount_applied * s.f_fleet,
                 rca.amount_applied * s.f_neutral
            from public.payment_orders po
            join public.payment_order_rejected_check_allocations rca on rca.payment_order_id = po.id
            left join public.issued_checks ric on ric.id = rca.issued_check_id
            cross join lateral public.management_payment_order_shares(
              coalesce(ric.payment_order_id, (
                select pl.payment_order_id
                  from public.payment_order_payment_lines pl
                  join public.payment_orders hp on hp.id = pl.payment_order_id
                 where pl.endorsed_check_id = rca.endorsed_check_id
                   and hp.status <> 'canceled'
                 order by hp.created_at desc, hp.id desc
                 limit 1)),
              p_depth - 1) s
           where po.id = p_payment_order_id
             and p_depth > 0
        ) x
    ) a;
end;
$$
;

CREATE OR REPLACE FUNCTION public.management_pnl_lines(p_from date, p_to date, p_basis text)
 RETURNS TABLE(month text, bucket text, subbucket text, channel_side text, chart_account_id uuid, cost_center_id uuid, amount_ars numeric, pending_usd numeric, source_table text, source_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $$
declare
  v_from date := date_trunc('month', p_from)::date;
  v_to   date := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
begin
  if p_basis is null or p_basis not in ('accrual', 'cash') then
    raise exception 'Base inválida: %', p_basis
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  if p_basis = 'accrual' then
    return query
    with raw as (
      -- Fiscal: the journal as posted (reversals included). A manual entry
      -- is its own source.
      -- The recibo gap (source payroll_entries) is left out: the same
      -- money is the payroll_discount internal salary below.
      select je.accrual_period as month, 'fiscal'::text as side,
             coalesce(je.source_table, 'journal_entries') as source_table,
             coalesce(je.source_id, je.id) as source_id,
             je.cost_center_id,
             l.chart_of_accounts_id as account_id,
             l.credit - l.debit as amount
        from public.journal_entries je
        join public.journal_entry_lines l on l.journal_entry_id = je.id
       where je.accrual_period between to_char(v_from, 'YYYY-MM') and to_char(v_to, 'YYYY-MM')
         and je.source_table is distinct from 'payroll_entries'
         and public.channel_in_main_scope(je.channel_id)
      union all
      -- Internal: the entry each live document would post.
      select d.e ->> 'accrual_period', 'internal', x.src, x.id,
             (d.e ->> 'cost_center_id')::uuid,
             coalesce((ln ->> 'account_id')::uuid,
                      public.find_account_by_role((ln ->> 'system_role')::public.coa_system_role)),
             coalesce((ln ->> 'credit')::numeric, 0) - coalesce((ln ->> 'debit')::numeric, 0)
        from (
          select 'invoices'::text as src, i.id
            from public.invoices i
            join public.invoicing_channels c on c.id = i.channel_id
           where not c.is_fiscal and not c.is_segregated and i.status = 'emitted' and i.fecha between v_from and v_to
          union all
          select 'purchase_invoices', p.id
            from public.purchase_invoices p
            join public.invoicing_channels c on c.id = p.channel_id
           where not c.is_fiscal and not c.is_segregated and p.status = 'received' and p.fecha between v_from and v_to
          union all
          select 'transactions', t.id
            from public.transactions t
            join public.invoicing_channels c on c.id = t.channel_id
           where not c.is_fiscal and not c.is_segregated and t.accrual_month between v_from and v_to
        ) x
        cross join lateral (select public.journal_document_entry(x.src, x.id) as e) d
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(d.e -> 'lines') = 'array' then d.e -> 'lines' else '[]'::jsonb end) ln
       where d.e is not null
      union all
      -- Employee account: what the planilla discounted (the advance it repays
      -- was an asset) and a forgiven company debt are internal salaries.
      select to_char(m.movement_date, 'YYYY-MM'), 'internal', 'employee_account_movements', m.id,
             null::uuid, public.find_account_by_role('sueldos'),
             -round(m.amount * case when m.currency = 'USD'
                                    then public.get_exchange_rate('USD', m.movement_date) else 1 end, 2)
        from public.employee_account_movements m
       where m.movement_date between v_from and v_to
         and (m.kind = 'payroll_discount' or (m.kind = 'forgiveness' and m.creditor = 'empresa'))
         and (m.currency = 'ARS' or public.get_exchange_rate('USD', m.movement_date) is not null)
    ),
    classified as (
      select r.month, r.side, r.source_table, r.source_id, r.cost_center_id, r.account_id, r.amount,
             case
               -- A cuota's capital posted to the loan liability is principal
               -- paid, below the operating margin; its interest goes to its
               -- own account's bucket.
               when r.source_table = 'transactions'
                    and coa.system_role = 'prestamos'
                    and inst.id is not null
                 then 'loan_principal'
               -- An unsplit cuota posted whole to an expense is principal
               -- paid too: the loan has no booked liability (the builder
               -- expenses the whole cuota), or its entry predates the
               -- capital-first posting (20261104093100: no prestamos line
               -- although the schedule still owed capital). Otherwise the
               -- builder already moved the capital to prestamos and the
               -- result line is interest.
               when r.source_table = 'transactions'
                    and coa.account_type in ('resultado_positivo', 'resultado_negativo')
                    and inst.id is not null
                    and inst.capital_amount is null
                    and (not inst.booked
                         or (inst.owes_capital
                             and not bool_or(coa.system_role is not distinct from 'prestamos')
                                       over (partition by r.side, r.source_table, r.source_id)))
                 then 'loan_principal'
               when mb.bucket is not null then mb.bucket
               when coa.account_type in ('resultado_positivo', 'resultado_negativo') then 'unclassified'
             end as bucket,
             mb.subbucket,
             case when r.source_table = 'invoices' and coa.system_role = 'ventas'
                  then public.management_invoice_asset_share(r.source_id) else 0 end as asset_share
        from raw r
        left join public.chart_of_accounts coa on coa.id = r.account_id
        left join public.management_buckets mb on mb.chart_of_accounts_id = r.account_id
        -- The cuota a treasury movement paid, with the builder's predicate
        -- (build_transaction_journal_lines, 20261104093100).
        left join lateral (
          select li.id, li.capital_amount,
                 (lo.disbursement_transaction_id is not null or lo.import_run_id is not null) as booked,
                 lo.principal - coalesce((
                   select sum(coalesce(o.capital_amount, o.amount))
                     from public.loan_installments o
                    where o.loan_id = li.loan_id
                      and o.number < li.number
                 ), 0) > 0 as owes_capital
            from public.loan_installments li
            join public.loans lo on lo.id = li.loan_id
           where r.source_table = 'transactions'
             and li.transaction_id = r.source_id
           limit 1
        ) inst on true
    )
    select c.month,
           case when s.is_asset then 'asset_sale' else c.bucket end,
           case when c.subbucket = 'sueldos' and c.side = 'internal' then 'sueldos_internos'
                else c.subbucket end,
           c.side, c.account_id, c.cost_center_id, s.part, 0::numeric,
           c.source_table, c.source_id
      from classified c
      cross join lateral (values
        (false, c.amount - round(c.amount * c.asset_share, 2)),
        (true,  round(c.amount * c.asset_share, 2))
      ) as s (is_asset, part)
     where c.bucket is not null and c.bucket <> 'neutral'
       and (s.part <> 0 or (not s.is_asset and c.asset_share = 0))
    union all
    -- A USD movement without a rate: in dollars, never summed.
    select to_char(t.accrual_month, 'YYYY-MM'), 'pending_usd', null,
           case when c.is_fiscal then 'fiscal' else 'internal' end,
           null, t.cost_center_id, 0::numeric,
           case when t.kind = 'income' then t.amount else -t.amount end,
           'transactions', t.id
      from public.transactions t
      join public.invoicing_channels c on c.id = t.channel_id
     where t.currency = 'USD'
       and not c.is_segregated
       and t.kind in ('income', 'expense')
       and t.invoice_id is null and t.receipt_id is null and t.payment_order_id is null
       and t.issued_check_id is null
       -- Movements whose entry is not a result: a loan disbursement, a check
       -- movement or rejection, an opening-balance adjustment, a tax payment.
       and t.manual_check_id is null and t.rejected_check_id is null
       and not exists (select 1 from public.loans lo where lo.disbursement_transaction_id = t.id)
       and not exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
       and not exists (select 1 from public.account_opening_balances aob
                        where aob.adjustment_transaction_id = t.id)
       and not exists (select 1 from public.tax_documents td where td.payment_transaction_id = t.id)
       and t.accrual_month between v_from and v_to
       -- Fiscal: the journal is the source, so pending while it has no live
       -- entry (a rate loaded later, back-dated, posts nothing by itself).
       -- Internal: the entry is built now, at today's rates.
       and case when c.is_fiscal
                then not exists (select 1 from public.current_journal_entries('transactions', t.id))
                else public.get_exchange_rate('USD', t.transaction_date) is null
           end
       and not exists (select 1 from public.employee_account_movements m where m.transaction_id = t.id)
    union all
    -- A USD payroll discount or forgiven company debt with no rate that day:
    -- internal salaries in dollars, pending like any other.
    select to_char(m.movement_date, 'YYYY-MM'), 'pending_usd', null, 'internal',
           null, null::uuid, 0::numeric, -m.amount,
           'employee_account_movements', m.id
      from public.employee_account_movements m
     where m.movement_date between v_from and v_to
       and (m.kind = 'payroll_discount' or (m.kind = 'forgiveness' and m.creditor = 'empresa'))
       and m.currency = 'USD'
       and public.get_exchange_rate('USD', m.movement_date) is null;
    return;
  end if;

  -- Cash: every movement of every account and channel, by its source, with
  -- the shares that leave the operating lines carved out.
  return query
  with base as (
    select t.id, t.transaction_date, t.currency, t.cost_center_id,
           -- A USD receipt or payment order is valued at its own cotización,
           -- the rate its entry booked; anything else at the day's rate.
           case when t.currency = 'USD' then
             case when t.receipt_id is not null then
                    (select case when r.cotizacion > 1 then r.cotizacion end
                       from public.receipts r where r.id = t.receipt_id)
                  when t.payment_order_id is not null then
                    (select case when po.cotizacion > 1 then po.cotizacion end
                       from public.payment_orders po where po.id = t.payment_order_id)
             end
           end as doc_rate,
           to_char(t.transaction_date, 'YYYY-MM') as month,
           case when c.is_fiscal then 'fiscal' else 'internal' end as side,
           case when t.kind = 'income' then t.amount else -t.amount end as signed,
           case
             -- A check imported at go-live (its cartera inflow and, if it
             -- bounces, its outflow): an opening item. The debt and the check
             -- predate the system; no collection happened.
             when ick.id is not null then 'neutral'
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null then 'service_revenue'
             -- A rejected check's outflow (the bank's debit-back, the refund
             -- to a buyer, the cartera's): it takes back the collection the
             -- check had counted.
             when t.rejected_check_id is not null then 'service_revenue'
             when t.payment_order_id is not null or t.issued_check_id is not null then 'operating_cost'
             when emp.owned then 'employee_advances'
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then 'operating_cost'
             when li.id is not null then 'loan_principal'
             -- The income a loan put in the bank: financing received, below
             -- cash generation.
             when ld.id is not null then 'loan_disbursements'
             when exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
                  or exists (select 1 from public.account_opening_balances aob
                              where aob.adjustment_transaction_id = t.id)
               then 'neutral'
             -- A tax payment goes where the tax account is mapped, or to
             -- the operating taxes line (the account is usually a liability,
             -- which has no bucket).
             when td.id is not null then coalesce(tmb.bucket, 'operating_cost')
             -- A tax credit booked from a bank statement line (SIRCREB,
             -- percepciones) is a tax paid in cash.
             when public.is_bank_tax_account(cp.id) then 'operating_cost'
             -- A loose movement goes where its journal counter-account goes.
             else coalesce(mb.bucket, 'unclassified')
           end as bucket,
           case
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null or t.rejected_check_id is not null then null
             when t.payment_order_id is not null or t.issued_check_id is not null then 'proveedores'
             when emp.owned then null
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then case when c.is_fiscal then 'sueldos' else 'sueldos_internos' end
             when li.id is not null or ld.id is not null then null
             when td.id is not null then
               case when tmb.bucket is null then 'impuestos' else tmb.subbucket end
             when public.is_bank_tax_account(cp.id) then 'impuestos'
             else mb.subbucket
           end as subbucket,
           case when td.id is not null then td.account_id
                when t.receipt_id is null and t.invoice_id is null and t.manual_check_id is null
                     and t.rejected_check_id is null and t.payment_order_id is null
                     and t.issued_check_id is null and not t.is_payroll
                     and not emp.owned and li.id is null and ld.id is null
                then cp.id end as account_id,
           -- Share of a collection that paid asset sales. A rejected check
           -- takes back the share of the receipt that collected it. A sale
           -- that is not Jouve's activity counts in f_partner instead.
           case
             when t.receipt_id is not null or t.rejected_check_id is not null then (
               select least(1, greatest(0,
                        coalesce(sum(ra.amount_applied * public.management_invoice_asset_share(ra.invoice_id))
                                   filter (where ai.is_operational), 0)
                        / nullif(max(r.total_amount), 0)))
                 from public.receipts r
                 left join public.receipt_allocations ra on ra.receipt_id = r.id
                 left join public.invoices ai on ai.id = ra.invoice_id
                where r.id = coalesce(t.receipt_id,
                        (select k.source_receipt_id from public.checks k where k.id = t.rejected_check_id)))
             when t.invoice_id is not null then
               case when exists (select 1 from public.invoices ai
                                  where ai.id = t.invoice_id and not ai.is_operational)
                    then 0 else public.management_invoice_asset_share(t.invoice_id) end
             else 0
           end as f_asset,
           -- Share of a collection that paid sales which are not Jouve's
           -- activity: left out of the operating lines.
           case
             when t.receipt_id is not null or t.rejected_check_id is not null then (
               select least(1, greatest(0,
                        coalesce(sum(ra.amount_applied) filter (where not ai.is_operational), 0)
                        / nullif(max(r.total_amount), 0)))
                 from public.receipts r
                 left join public.receipt_allocations ra on ra.receipt_id = r.id
                 left join public.invoices ai on ai.id = ra.invoice_id
                where r.id = coalesce(t.receipt_id,
                        (select k.source_receipt_id from public.checks k where k.id = t.rejected_check_id)))
             when t.invoice_id is not null then
               case when exists (select 1 from public.invoices ai
                                  where ai.id = t.invoice_id and not ai.is_operational)
                    then 1 else 0 end
             else 0
           end as f_partner,
           op.f_employee,
           op.f_fleet,
           op.f_neutral,
           -- Share of an installment that is not capital. An unsplit cuota
           -- of a loan with its liability booked pays the capital the
           -- schedule still owes first, as its entry does.
           case when li.capital_amount is not null and li.amount > 0
                  then greatest(0, least(1, (li.amount - li.capital_amount) / li.amount))
                when li.default_capital is not null and t.amount > 0
                  then greatest(0, least(1, (t.amount - li.default_capital) / t.amount))
                else 0 end as f_interest
      from public.transactions t
      join public.invoicing_channels c on c.id = t.channel_id
      left join public.checks ick
        on ick.id = coalesce(t.manual_check_id, t.rejected_check_id)
       and ick.import_run_id is not null
      cross join lateral (
        select exists (select 1 from public.employee_account_movements m where m.transaction_id = t.id) as owned
      ) emp
      left join lateral (
        select li.id, li.amount, li.capital_amount,
               case when li.capital_amount is null
                         and (lo.disbursement_transaction_id is not null or lo.import_run_id is not null)
                    then greatest(0, least(t.amount, lo.principal - coalesce((
                           select sum(coalesce(o.capital_amount, o.amount))
                             from public.loan_installments o
                            where o.loan_id = li.loan_id
                              and o.number < li.number
                         ), 0)))
               end as default_capital
          from public.loan_installments li
          join public.loans lo on lo.id = li.loan_id
         where li.transaction_id = t.id
         limit 1
      ) li on true
      left join lateral (
        select lo.id from public.loans lo where lo.disbursement_transaction_id = t.id limit 1
      ) ld on true
      -- payment_transaction_id is unique: one document at most.
      left join public.tax_documents td on td.payment_transaction_id = t.id
      left join public.management_buckets tmb on tmb.chart_of_accounts_id = td.account_id
      left join public.issued_checks ic on ic.id = t.issued_check_id
      cross join lateral public.management_payment_order_shares(
        coalesce(t.payment_order_id, ic.payment_order_id), 3) op
      left join public.chart_of_accounts cp
        on cp.id = coalesce(
             case when t.kind = 'expense' then t.expense_account_id end,
             public.find_account_by_role(
               case when t.kind = 'income' then 'ajustes_caja' else 'gastos' end::public.coa_system_role))
      left join public.management_buckets mb on mb.chart_of_accounts_id = cp.id
     where t.kind in ('income', 'expense')
       and not c.is_segregated
       and t.transaction_date between v_from and v_to
  ),
  -- Where the non-capital share of an installment goes: the bucket of
  -- intereses_pagados, as in accrual (financing cost without that account).
  interest_account as (
    select coa.id,
           coalesce(mb.bucket, 'unclassified') as bucket,
           case when mb.bucket is null then null else mb.subbucket end as subbucket
      from public.chart_of_accounts coa
      left join public.management_buckets mb on mb.chart_of_accounts_id = coa.id
     where coa.id = public.find_account_by_role('intereses_pagados')
    union all
    select null::uuid, 'financing_cost', 'intereses'
     where public.find_account_by_role('intereses_pagados') is null
  ),
  parts as (
    select b.month, b.side, b.cost_center_id, b.currency, b.transaction_date, b.doc_rate, b.id,
           p.bucket, p.subbucket, p.account_id, p.part
      from base b
      cross join lateral (
        select x.bucket, x.subbucket, x.account_id, x.part
          from (values
            ('asset_sale'::text, null::text, null::uuid, round(b.signed * b.f_asset, 2)),
            ('employee_advances', null, null, round(b.signed * b.f_employee, 2)),
            ('fleet_investment', null, null, round(b.signed * b.f_fleet, 2)),
            ('neutral', null, null, round(b.signed * b.f_neutral, 2)),
            ('neutral', null, null, round(b.signed * b.f_partner, 2)),
            ((select ia.bucket from interest_account ia limit 1),
             (select ia.subbucket from interest_account ia limit 1),
             (select ia.id from interest_account ia limit 1),
             round(b.signed * b.f_interest, 2))
          ) as x (bucket, subbucket, account_id, part)
         where x.part <> 0
        union all
        select b.bucket, b.subbucket, b.account_id,
               b.signed - round(b.signed * b.f_asset, 2) - round(b.signed * b.f_employee, 2)
                        - round(b.signed * b.f_fleet, 2) - round(b.signed * b.f_neutral, 2)
                        - round(b.signed * b.f_partner, 2)
                        - round(b.signed * b.f_interest, 2)
      ) p
     where p.bucket <> 'neutral'
  ),
  rated as (
    select p.*,
           case when p.currency = 'USD'
                then coalesce(p.doc_rate, public.get_exchange_rate('USD', p.transaction_date))
                else 1 end as rate
      from parts p
  )
  select r.month, r.bucket, r.subbucket, r.side, r.account_id, r.cost_center_id,
         case when r.rate is not null then round(r.part * r.rate, 2) else 0 end,
         case when r.rate is null then r.part else 0 end,
         'transactions'::text, r.id
    from rated r
  union all
  -- Payroll discount / forgiven company debt: internal salaries of the month,
  -- and the same amount back from the advances (no cash moves).
  -- A USD one with no rate that day stays in dollars (pending_usd).
  select to_char(m.movement_date, 'YYYY-MM'), x.bucket, x.subbucket, 'internal', null::uuid, null::uuid,
         case when mr.rate is not null then x.sign * round(m.amount * mr.rate, 2) else 0 end,
         case when mr.rate is null then x.sign * m.amount else 0 end,
         'employee_account_movements', m.id
    from public.employee_account_movements m
    cross join lateral (
      select case when m.currency = 'USD'
                  then public.get_exchange_rate('USD', m.movement_date) else 1 end as rate
    ) mr
    cross join lateral (values
      ('operating_cost'::text, 'sueldos_internos'::text, -1),
      ('employee_advances', null, 1)
    ) as x (bucket, subbucket, sign)
   where m.movement_date between v_from and v_to
     and (m.kind = 'payroll_discount' or (m.kind = 'forgiveness' and m.creditor = 'empresa'));
end;
$$
;

revoke all on function public.management_payment_order_shares(uuid, integer) from public, anon, authenticated;
revoke all on function public.management_pnl_lines(date, date, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_client_net_revenue(p_from date, p_to date, p_is_fiscal boolean DEFAULT NULL::boolean, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(client_id uuid, legal_name text, net_revenue_ars numeric, invoices integer, credit_notes integer, debit_notes integer, pending_foreign numeric, total_clients integer, total_net_revenue_ars numeric, total_pending_foreign numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $$
  with docs as (
    select
      i.client_id,
      i.kind,
      (case when i.kind = 'nc' then -1 else 1 end)
        * (coalesce(i.imp_neto, 0) + coalesce(i.imp_op_ex, 0) + coalesce(i.imp_tot_conc, 0)) as net,
      case
        when i.moneda is null or i.moneda = 'PES' then 1::numeric
        else coalesce(nullif(i.cotizacion, 0), public.get_exchange_rate('USD', i.fecha))
      end as fx
    from public.invoices i
    where i.status = 'emitted'
      and i.is_operational
      and i.fecha between p_from and p_to
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = i.channel_id and c.is_fiscal = p_is_fiscal
      ))
      and public.channel_in_main_scope(i.channel_id)
  ),
  per_client as (
    select
      docs.client_id,
      coalesce(sum(docs.net * docs.fx) filter (where docs.fx is not null), 0) as net_ars,
      coalesce(sum(docs.net) filter (where docs.fx is null), 0) as pending,
      count(*) filter (where docs.kind = 'factura') as invoices,
      count(*) filter (where docs.kind = 'nc') as credit_notes,
      count(*) filter (where docs.kind = 'nd') as debit_notes
    from docs
    group by docs.client_id
  )
  select
    p.client_id,
    c.legal_name,
    round(p.net_ars, 2),
    p.invoices::integer,
    p.credit_notes::integer,
    p.debit_notes::integer,
    round(p.pending, 2),
    (count(*) over ())::integer,
    round(sum(p.net_ars) over (), 2),
    round(sum(p.pending) over (), 2)
  from per_client p
  join public.clients c on c.id = p.client_id
  order by 3 desc, 2, 1
  limit greatest(1, least(p_limit, 500))
  offset greatest(p_offset, 0);
$$
;

CREATE OR REPLACE FUNCTION public.ai_client_sales_summary(p_from date, p_to date, p_client_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_is_fiscal boolean DEFAULT NULL::boolean)
 RETURNS TABLE(client_id uuid, legal_name text, invoiced_ars numeric, invoices integer, credit_notes integer, collected_ars numeric, collected_usd numeric, receipts integer, avg_days_to_pay numeric, open_ars numeric, open_foreign numeric, overdue_ars numeric, total_clients integer, total_invoiced_ars numeric, total_collected_ars numeric, total_open_ars numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  with inv as (
    select
      i.client_id,
      sum(case when i.kind = 'nc' then -1 else 1 end * i.imp_total * coalesce(nullif(i.cotizacion, 0), 1)) as invoiced_ars,
      count(*) filter (where i.kind <> 'nc') as invoices,
      count(*) filter (where i.kind = 'nc') as credit_notes
    from public.invoices i
    where i.status = 'emitted'
      and i.is_operational
      and i.fecha between p_from and p_to
      and (p_client_id is null or i.client_id = p_client_id)
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = i.channel_id and c.is_fiscal = p_is_fiscal
      ))
      and public.channel_in_main_scope(i.channel_id)
    group by i.client_id
  ),
  rec as (
    select
      r.client_id,
      sum(r.total_amount) filter (where r.currency = 'ARS') as collected_ars,
      sum(r.total_amount) filter (where r.currency = 'USD') as collected_usd,
      count(*) as receipts
    from public.receipts r
    where r.status = 'issued'
      and r.receipt_date between p_from and p_to
      and (p_client_id is null or r.client_id = p_client_id)
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = r.channel_id and c.is_fiscal = p_is_fiscal
      ))
      and public.channel_in_main_scope(r.channel_id)
    group by r.client_id
  ),
  dtp as (
    select
      r.client_id,
      sum((r.receipt_date - i.fecha) * ra.amount_applied) / nullif(sum(ra.amount_applied), 0) as avg_days
    from public.receipts r
    join public.receipt_allocations ra on ra.receipt_id = r.id
    join public.invoices i on i.id = ra.invoice_id
    where r.status = 'issued'
      and r.receipt_date between p_from and p_to
      and (p_client_id is null or r.client_id = p_client_id)
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = r.channel_id and c.is_fiscal = p_is_fiscal
      ))
      and public.channel_in_main_scope(r.channel_id)
    group by r.client_id
  ),
  debt as (
    select
      d.client_id,
      sum(d.open_amount) filter (where d.moneda = 'PES') as open_ars,
      sum(d.open_amount) filter (where d.moneda <> 'PES') as open_foreign,
      sum(d.open_amount) filter (
        where d.moneda = 'PES' and d.due_date < current_date
      ) as overdue_ars
    from public.v_aging_documents d
    where (p_client_id is null or d.client_id = p_client_id)
      and (p_is_fiscal is null or d.channel_is_fiscal = p_is_fiscal)
      and not coalesce(d.channel_is_segregated, false)
    group by d.client_id
  ),
  keys as (
    select inv.client_id from inv
    union
    select rec.client_id from rec
    union
    select debt.client_id from debt
  )
  select
    k.client_id,
    c.legal_name,
    round(coalesce(inv.invoiced_ars, 0), 2),
    coalesce(inv.invoices, 0)::integer,
    coalesce(inv.credit_notes, 0)::integer,
    coalesce(rec.collected_ars, 0),
    coalesce(rec.collected_usd, 0),
    coalesce(rec.receipts, 0)::integer,
    round(dtp.avg_days, 1),
    coalesce(debt.open_ars, 0),
    coalesce(debt.open_foreign, 0),
    coalesce(debt.overdue_ars, 0),
    (count(*) over ())::integer,
    round(sum(coalesce(inv.invoiced_ars, 0)) over (), 2),
    sum(coalesce(rec.collected_ars, 0)) over (),
    sum(coalesce(debt.open_ars, 0)) over ()
  from keys k
  join public.clients c on c.id = k.client_id
  left join inv on inv.client_id = k.client_id
  left join rec on rec.client_id = k.client_id
  left join dtp on dtp.client_id = k.client_id
  left join debt on debt.client_id = k.client_id
  order by 3 desc, 10 desc, 2
  limit greatest(1, least(p_limit, 500));
$$
;

CREATE OR REPLACE FUNCTION public.ai_supplier_purchases_summary(p_from date, p_to date, p_supplier_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_is_fiscal boolean DEFAULT NULL::boolean)
 RETURNS TABLE(supplier_id uuid, legal_name text, category text, purchased_ars numeric, net_ars numeric, invoices integer, paid_ars numeric, paid_usd numeric, open_ars numeric, open_foreign numeric, overdue_ars numeric, next_due_date date, total_suppliers integer, total_purchased_ars numeric, total_open_ars numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  with pur as (
    select
      pi.supplier_id,
      sum(case when pi.kind = 'nc' then -1 else 1 end * pi.imp_total * coalesce(nullif(pi.cotizacion, 0), 1)) as purchased_ars,
      sum(case when pi.kind = 'nc' then -1 else 1 end * (pi.imp_neto + pi.imp_no_gravado + pi.imp_op_exentas) * coalesce(nullif(pi.cotizacion, 0), 1)) as net_ars,
      count(*) filter (where pi.kind <> 'nc') as invoices
    from public.purchase_invoices pi
    where pi.status = 'received'
      and pi.is_operational
      and pi.fecha between p_from and p_to
      and (p_supplier_id is null or pi.supplier_id = p_supplier_id)
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = pi.channel_id and c.is_fiscal = p_is_fiscal
      ))
      and public.channel_in_main_scope(pi.channel_id)
    group by pi.supplier_id
  ),
  paid as (
    select
      po.supplier_id,
      sum(po.total_amount) filter (where po.currency = 'ARS') as paid_ars,
      sum(po.total_amount) filter (where po.currency = 'USD') as paid_usd
    from public.payment_orders po
    where po.status = 'issued'
      and po.payment_date between p_from and p_to
      and (p_supplier_id is null or po.supplier_id = p_supplier_id)
      and (p_is_fiscal is null or exists (
        select 1 from public.invoicing_channels c
        where c.id = po.channel_id and c.is_fiscal = p_is_fiscal
      ))
      and public.channel_in_main_scope(po.channel_id)
    group by po.supplier_id
  ),
  docs as (
    select
      d.supplier_id,
      d.open_amount,
      d.moneda,
      coalesce(d.fch_vto_pago, d.fecha + coalesce(s.default_payment_term_days, 0)) as due_date
    from public.v_supplier_aging_documents d
    join public.suppliers s on s.id = d.supplier_id
    where (p_supplier_id is null or d.supplier_id = p_supplier_id)
      and (p_is_fiscal is null or d.channel_is_fiscal = p_is_fiscal)
      and not coalesce(d.channel_is_segregated, false)
  ),
  debt as (
    select
      docs.supplier_id,
      sum(docs.open_amount) filter (where docs.moneda = 'PES') as open_ars,
      sum(docs.open_amount) filter (where docs.moneda <> 'PES') as open_foreign,
      sum(docs.open_amount) filter (where docs.moneda = 'PES' and docs.due_date < current_date) as overdue_ars,
      min(docs.due_date) filter (where docs.due_date >= current_date) as next_due_date
    from docs
    group by docs.supplier_id
  ),
  keys as (
    select pur.supplier_id from pur
    union
    select paid.supplier_id from paid
    union
    select debt.supplier_id from debt
  )
  select
    k.supplier_id,
    s.legal_name,
    coalesce(sc.name, ''),
    round(coalesce(pur.purchased_ars, 0), 2),
    round(coalesce(pur.net_ars, 0), 2),
    coalesce(pur.invoices, 0)::integer,
    coalesce(paid.paid_ars, 0),
    coalesce(paid.paid_usd, 0),
    coalesce(debt.open_ars, 0),
    coalesce(debt.open_foreign, 0),
    coalesce(debt.overdue_ars, 0),
    debt.next_due_date,
    (count(*) over ())::integer,
    round(sum(coalesce(pur.purchased_ars, 0)) over (), 2),
    sum(coalesce(debt.open_ars, 0)) over ()
  from keys k
  join public.suppliers s on s.id = k.supplier_id
  left join public.supplier_categories sc on sc.id = s.category_id
  left join pur on pur.supplier_id = k.supplier_id
  left join paid on paid.supplier_id = k.supplier_id
  left join debt on debt.supplier_id = k.supplier_id
  where p_category_id is null or s.category_id = p_category_id
  order by 4 desc, 9 desc, 2
  limit greatest(1, least(p_limit, 500));
$$
;

revoke all on function public.ai_client_net_revenue(date, date, boolean, integer, integer) from public, anon;
grant execute on function public.ai_client_net_revenue(date, date, boolean, integer, integer) to authenticated, service_role;
revoke all on function public.ai_client_sales_summary(date, date, uuid, integer, boolean) from public, anon;
grant execute on function public.ai_client_sales_summary(date, date, uuid, integer, boolean) to authenticated, service_role;
revoke all on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer, boolean) from public, anon;
grant execute on function public.ai_supplier_purchases_summary(date, date, uuid, uuid, integer, boolean) to authenticated, service_role;
