SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A segregated channel lives only in its own section of the menu: outside it,
-- lists, reports, pickers, management and the AI leave it out. The legal
-- books (journal, libro IVA, balance) and treasury keep it, since the CUIT is
-- one. DZ Instalaciones comes back as the first one.
--
-- 1. invoicing_channels gains is_segregated, the channel's own sales and
--    purchase accounts, the PDF division line and the treasury badge text.
--    channel_in_main_scope(channel) is the one SQL predicate; the TS twin is
--    isMainChannel (lib/scope.ts).
-- 2. guard_invoicing_channel_config also refuses flipping is_segregated on a
--    channel with documents.
-- 3. DZ's accounts («Venta de productos (Instalaciones)» under 4.1, «Costo de
--    mercadería vendida (Instalaciones)» under 5.1) and the dz_fiscal row,
--    created INACTIVE: activating it is a later data step.
-- 4. build_invoice_journal_lines / build_purchase_invoice_journal_lines post
--    the net to the channel's account before the role (a purchase's own
--    account and an employee charge still win). An inactive channel account
--    raises instead of falling back to Jouve's accounts.
-- 5. An account a channel posts to cannot be deactivated.
--
-- Rollback: older code ignores the new columns; dz_fiscal is inactive, so
-- the older pickers, reconciliation and the ARCA sync skip it.

-- 1. Columns and predicate -------------------------------------------------------------

alter table public.invoicing_channels
  add column is_segregated boolean not null default false,
  -- invoicing_channels has a handful of rows: the scan and lock are instant.
  -- squawk-ignore adding-foreign-key-constraint
  add column sales_account_id uuid references public.chart_of_accounts (id) on delete restrict,
  -- squawk-ignore adding-foreign-key-constraint
  add column purchase_account_id uuid references public.chart_of_accounts (id) on delete restrict,
  add column division_label text,
  add column short_label text
    constraint invoicing_channels_short_label_length
    check (short_label is null or char_length(short_label) between 1 and 8);

comment on column public.invoicing_channels.is_segregated is
  'Canal que solo se ve en su propia sección del menú; fuera de ella, listas, reportes, selectores, gestión y la IA lo excluyen. Libros legales y tesorería lo incluyen.';
comment on column public.invoicing_channels.sales_account_id is
  'Cuenta a la que van los netos de venta del canal; vacía = la cuenta con rol ventas.';
comment on column public.invoicing_channels.purchase_account_id is
  'Cuenta a la que van los netos de compra del canal sin cuenta propia; vacía = la cuenta con rol compras.';
comment on column public.invoicing_channels.division_label is
  'Línea de división de los PDF del canal; vacía = Logística Jouve.';
comment on column public.invoicing_channels.short_label is
  'Marca corta del canal en tesorería (hasta 8 caracteres); vacía = el nombre.';

-- For the account guard below; the table has a handful of rows.
-- squawk-ignore require-concurrent-index-creation
create index invoicing_channels_sales_account_idx
  on public.invoicing_channels (sales_account_id);
-- squawk-ignore require-concurrent-index-creation
create index invoicing_channels_purchase_account_idx
  on public.invoicing_channels (purchase_account_id);

-- True for a document without a channel or on a channel of the main app.
create function public.channel_in_main_scope(p_channel_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_channel_id is null or not exists (
    select 1 from public.invoicing_channels c
     where c.id = p_channel_id and c.is_segregated);
$$;

comment on function public.channel_in_main_scope(text) is
  'Si el canal pertenece a la app principal (no segregado). NULL cuenta como principal.';

revoke all on function public.channel_in_main_scope(text) from public, anon;
grant execute on function public.channel_in_main_scope(text) to authenticated, service_role;

-- 2. Channel config guard (20261031204717) also watches is_segregated -----------------------

create or replace function public.guard_invoicing_channel_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoices where channel_id = old.id)
     or exists (select 1 from public.purchase_invoices where channel_id = old.id)
     or exists (select 1 from public.receipts where channel_id = old.id)
     or exists (select 1 from public.payment_orders where channel_id = old.id)
     or exists (select 1 from public.transactions where channel_id = old.id)
     or exists (select 1 from public.loans where channel_id = old.id)
     or exists (select 1 from public.payroll_payments where channel_id = old.id)
     or exists (select 1 from public.journal_entries where channel_id = old.id)
     or exists (select 1 from public.shipments where channel_id = old.id)
     or exists (select 1 from public.trips where channel_id = old.id) then
    if new.is_fiscal is distinct from old.is_fiscal then
      raise exception 'El canal % ya tiene documentos: no se puede cambiar si es fiscal', old.name
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    raise exception 'El canal % ya tiene documentos: no se puede cambiar si es segregado', old.name
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoicing_channel_config() from public, anon, authenticated;

drop trigger guard_invoicing_channel_config on public.invoicing_channels;

create trigger guard_invoicing_channel_config
  before update of is_fiscal, is_segregated on public.invoicing_channels
  for each row
  when (new.is_fiscal is distinct from old.is_fiscal
        or new.is_segregated is distinct from old.is_segregated)
  execute function public.guard_invoicing_channel_config();

-- 3. DZ Instalaciones: accounts and the inactive channel ----------------------------------

-- Reuses an account with the same name under the parent, else takes the
-- parent's first free child code (4.1.2 / 5.1.2 today). The names can change
-- later: nothing reads them, the builders read the channel's account ids.
do $$
declare
  v_sales_id uuid;
  v_cost_id  uuid;
  v_spec     record;
  v_parent   public.chart_of_accounts;
  v_id       uuid;
  v_n        int;
begin
  for v_spec in
    select * from (values
      ('4.1', 'Venta de productos (Instalaciones)', 'resultado_positivo', 'ingresos_operativos'),
      ('5.1', 'Costo de mercadería vendida (Instalaciones)', 'resultado_negativo', 'costo')
    ) as s (parent_code, name, account_type, eerr_category)
  loop
    v_id := null;
    select * into v_parent from public.chart_of_accounts where code = v_spec.parent_code;
    if v_parent.id is not null then
      select a.id into v_id
        from public.chart_of_accounts a
       where a.parent_id = v_parent.id and a.name = v_spec.name
       order by a.code
       limit 1;
      if v_id is null then
        v_n := 2;
        while exists (select 1 from public.chart_of_accounts
                       where code = v_spec.parent_code || '.' || v_n) loop
          v_n := v_n + 1;
        end loop;
        insert into public.chart_of_accounts
          (parent_id, code, name, level, account_type, eerr_category)
        values
          (v_parent.id, v_spec.parent_code || '.' || v_n, v_spec.name, v_parent.level + 1,
           v_spec.account_type::public.coa_account_type, v_spec.eerr_category)
        returning id into v_id;
      end if;
    end if;
    if v_spec.parent_code = '4.1' then v_sales_id := v_id; else v_cost_id := v_id; end if;
  end loop;

  insert into public.invoicing_channels
    (id, business_unit_id, name, is_fiscal, is_active, is_segregated,
     sales_account_id, purchase_account_id, division_label, short_label)
  select 'dz_fiscal', 'dz_sons', 'DZ Instalaciones', true, false, true,
         v_sales_id, v_cost_id, 'DZ Instalaciones', 'DZ'
   where exists (select 1 from public.business_units where id = 'dz_sons')
  on conflict (id) do nothing;
end;
$$;

-- 4. Builders read the channel's account -----------------------------------------------

-- Copied from 20261104094300; the net goes to the channel's sales account
-- when it has one.
create or replace function public.build_invoice_journal_lines(
  p_invoice     public.invoices,
  p_description text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
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
begin
  select * into v_channel from public.invoicing_channels where id = p_invoice.channel_id;
  if v_revenue > 0 and v_channel.sales_account_id is not null
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
      'system_role', 'diferencia_cambio',
      case when v_fx > 0 then 'credit' else 'debit' end, abs(v_fx),
      'description', p_description || ' — diferencia de cambio'
    );
  end if;
  if v_revenue > 0 then
    v_lines := v_lines || case
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
$$;

revoke all on function public.build_invoice_journal_lines(public.invoices, text) from public, anon, authenticated;

-- Copied from 20261104113001; precedence of the net: employee charge, the
-- purchase's own account, the channel's purchase account, the compras role.
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
begin
  select * into v_channel from public.invoicing_channels where id = p_invoice.channel_id;
  if v_has_neto and not v_to_employee and p_invoice.account_id is null
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
$$;
revoke all on function public.build_purchase_invoice_journal_lines(public.purchase_invoices, text) from public, anon, authenticated;

-- 5. An account a channel posts to stays active ---------------------------------------

create function public.guard_account_channel_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text;
begin
  select c.name into v_channel
    from public.invoicing_channels c
   where c.sales_account_id = old.id or c.purchase_account_id = old.id
   order by c.name
   limit 1;
  if v_channel is not null then
    raise exception 'La cuenta es la de ventas o compras del canal %: cambiá la cuenta del canal antes de desactivarla', v_channel
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_account_channel_reference() from public, anon, authenticated;

create trigger guard_account_channel_reference
  before update of is_active on public.chart_of_accounts
  for each row
  when (old.is_active and not new.is_active)
  execute function public.guard_account_channel_reference();
