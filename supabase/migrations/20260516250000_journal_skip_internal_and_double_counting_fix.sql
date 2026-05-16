-- L.2 hotfix consolidado — dos bugs encontrados al revisar end-to-end:
--
-- Bug 1 — DOUBLE COUNTING en cobranzas y pagos.
-- ------------------------------------------------------------------
-- El trigger L.2b skipea las transactions atadas a invoice_id, pero
-- NO las atadas a receipt_id ni a payment_order_id. Las RPCs
-- create_receipt y update_payment_order insertan transactions con
-- receipt_id/payment_order_id setteados — y el trigger L.2b generaba
-- un asiento (Debe Caja / Haber ajustes_caja) además del que L.2d
-- genera para el header (Debe Caja / Haber Clientes). Resultado: cada
-- cobranza y cada pago se contabilizaba DOS VECES.
-- Fix: agregar receipt_id y payment_order_id al skip de L.2b.
--
-- Bug 2 — INTERNOS GENERAN ASIENTOS.
-- ------------------------------------------------------------------
-- Decisión de negocio: solo los canales fiscales (jouve_fiscal y
-- dz_fiscal) deben generar asientos contables. Los internos son
-- registro operativo, no van al libro IVA ni al balance.
-- Consecuencia: la caja "real" (todas las cuentas) va a diferir de
-- la caja "contable" (solo lo fiscal). Eso es intencional.
-- Fix: skip en los 4 generadores (transactions, invoices, receipts,
-- payment_orders) cuando channel.is_fiscal = false.
--
-- Cleanup: borrar los asientos ya generados que ahora son inválidos
-- (los double-counted de receipts/POs y todos los de canales
-- internos). El backfill correcto vendrá implícito: como solo
-- borramos los inválidos, los válidos quedan.

set row_security = off;

------------------------------------------------------------------------------
-- 1. Helper: is_channel_fiscal
------------------------------------------------------------------------------
create or replace function public.is_channel_fiscal(p_channel_id text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(is_fiscal, false) from public.invoicing_channels where id = p_channel_id;
$$;

------------------------------------------------------------------------------
-- 2. Re-crear trigger L.2b (transactions) con los nuevos skips
------------------------------------------------------------------------------
create or replace function public.generate_journal_for_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair          public.transactions;
  v_role          public.coa_system_role;
  v_pair_role     public.coa_system_role;
  v_period        text;
  v_lines         jsonb;
  v_description   text;
begin
  -- Skip 1: movimientos atados a comprobantes (los cubre L.2c).
  if new.invoice_id is not null then
    return new;
  end if;

  -- Skip 2 (FIX double counting): movimientos atados a recibos o OPs
  -- (los cubre L.2d con su asiento desde el header).
  if new.receipt_id is not null or new.payment_order_id is not null then
    return new;
  end if;

  -- Skip 3: transfer_out — procesamos solo el transfer_in del par.
  if new.kind = 'transfer_out' then
    return new;
  end if;

  -- Skip 4 (FIX internos): canales no-fiscales no generan asientos.
  if not public.is_channel_fiscal(new.channel_id) then
    return new;
  end if;

  v_period := to_char(new.accrual_month, 'YYYY-MM');
  v_role := public.coa_role_for_account(new.account_id);

  if v_role is null then
    raise warning 'generate_journal_for_transaction: account % sin mapping COA, asiento omitido', new.account_id;
    return new;
  end if;

  if new.kind = 'income' then
    v_description := coalesce(new.description, 'Ingreso de caja');
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', new.amount, 'description', v_description),
      jsonb_build_object('system_role', 'ajustes_caja', 'credit', new.amount, 'description', v_description)
    );

  elsif new.kind = 'expense' then
    v_description := coalesce(new.description, 'Egreso de caja');
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', 'gastos', 'debit', new.amount, 'description', v_description),
      jsonb_build_object('system_role', v_role::text, 'credit', new.amount, 'description', v_description)
    );

  elsif new.kind = 'transfer_in' then
    select * into v_pair from public.transactions where id = new.transfer_pair_id;
    if v_pair.id is null then
      raise warning 'generate_journal_for_transaction: transfer_in % sin par, asiento omitido', new.id;
      return new;
    end if;
    -- El par también debe estar en canal fiscal (mismo canal típicamente).
    v_pair_role := public.coa_role_for_account(v_pair.account_id);
    if v_pair_role is null then
      raise warning 'generate_journal_for_transaction: par % sin mapping COA, asiento omitido', v_pair.account_id;
      return new;
    end if;
    v_description := coalesce(new.description, 'Transferencia interna');
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', new.amount, 'description', v_description || ' (entrada)'),
      jsonb_build_object('system_role', v_pair_role::text, 'credit', new.amount, 'description', v_description || ' (salida)')
    );
  else
    return new;
  end if;

  begin
    perform public.create_journal_entry(
      p_entry_date     := new.transaction_date,
      p_accrual_period := v_period,
      p_description    := v_description,
      p_lines          := v_lines,
      p_source_table   := 'transactions',
      p_source_id      := new.id,
      p_channel_id     := new.channel_id
    );
  exception when sqlstate 'P0002' then
    raise warning 'generate_journal_for_transaction: % (transaction=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

------------------------------------------------------------------------------
-- 3. Re-crear emit_journal_for_invoice con skip fiscal
------------------------------------------------------------------------------
create or replace function public.emit_journal_for_invoice(
  p_invoice public.invoices,
  p_reverse boolean default false,
  p_reversed_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_fiscal boolean;
  v_lines     jsonb;
  v_desc      text;
  v_number    text;
  v_entry     uuid;
begin
  select is_fiscal into v_is_fiscal from public.invoicing_channels where id = p_invoice.channel_id;
  if v_is_fiscal is null then
    raise warning 'emit_journal_for_invoice: channel % no encontrado', p_invoice.channel_id;
    return null;
  end if;

  -- FIX internos: no generar asiento si el canal no es fiscal.
  if not v_is_fiscal then
    return null;
  end if;

  v_lines := public.build_invoice_journal_lines(p_invoice, v_is_fiscal, p_reverse);

  v_number := coalesce(p_invoice.letter::text, '') ||
              lpad(p_invoice.punto_venta::text, 4, '0') || '-' ||
              lpad(p_invoice.numero::text, 8, '0');

  v_desc := case
    when p_reverse then 'Anulación '
    else ''
  end || case p_invoice.kind
    when 'factura' then 'Factura '
    when 'nc'      then 'Nota de crédito '
    when 'nd'      then 'Nota de débito '
  end || v_number;

  begin
    v_entry := public.create_journal_entry(
      p_entry_date      := p_invoice.fecha,
      p_accrual_period  := to_char(p_invoice.fecha, 'YYYY-MM'),
      p_description     := v_desc,
      p_lines           := v_lines,
      p_source_table    := 'invoices',
      p_source_id       := p_invoice.id,
      p_channel_id      := p_invoice.channel_id,
      p_is_reversal     := p_reverse,
      p_reversed_entry_id := p_reversed_entry_id
    );
    return v_entry;
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_invoice: % (invoice=%)', sqlerrm, p_invoice.id;
    return null;
  end;
end;
$$;

------------------------------------------------------------------------------
-- 4. Re-crear emit_journal_for_receipt con skip fiscal
------------------------------------------------------------------------------
create or replace function public.emit_journal_for_receipt(
  p_receipt_id uuid,
  p_reverse boolean default false,
  p_reversed_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r       public.receipts;
  v_line    record;
  v_lines   jsonb := '[]'::jsonb;
  v_role    public.coa_system_role;
  v_dir     numeric;
  v_desc    text;
  v_number  text;
  v_entry   uuid;
begin
  select * into v_r from public.receipts where id = p_receipt_id;
  if v_r.id is null then return null; end if;

  -- FIX internos: skip canal no-fiscal.
  if not public.is_channel_fiscal(v_r.channel_id) then
    return null;
  end if;

  v_dir := case when p_reverse then -1 else 1 end;
  v_number := 'R' || lpad(v_r.punto_venta::text, 4, '0') || '-' || lpad(v_r.numero::text, 8, '0');
  v_desc := case when p_reverse then 'Anulación ' else '' end || 'Recibo ' || v_number;

  for v_line in
    select rpl.account_id, rpl.amount, a.name as account_name
      from public.receipt_payment_lines rpl
      join public.accounts a on a.id = rpl.account_id
     where rpl.receipt_id = p_receipt_id
  loop
    v_role := public.coa_role_for_account(v_line.account_id);
    if v_role is null then
      raise warning 'emit_journal_for_receipt: account % sin mapping COA', v_line.account_id;
      continue;
    end if;
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      case when v_dir > 0 then 'debit' else 'credit' end, v_line.amount,
      'description', v_desc || ' — ' || v_line.account_name
    );
  end loop;

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'clientes',
    case when v_dir > 0 then 'credit' else 'debit' end, v_r.total_amount,
    'description', v_desc || ' — cliente'
  );

  begin
    v_entry := public.create_journal_entry(
      p_entry_date := v_r.receipt_date,
      p_accrual_period := to_char(v_r.receipt_date, 'YYYY-MM'),
      p_description := v_desc,
      p_lines := v_lines,
      p_source_table := 'receipts',
      p_source_id := v_r.id,
      p_channel_id := v_r.channel_id,
      p_is_reversal := p_reverse,
      p_reversed_entry_id := p_reversed_entry_id
    );
    return v_entry;
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_receipt: % (receipt=%)', sqlerrm, v_r.id;
    return null;
  end;
end;
$$;

------------------------------------------------------------------------------
-- 5. Re-crear emit_journal_for_payment_order con skip fiscal
------------------------------------------------------------------------------
create or replace function public.emit_journal_for_payment_order(
  p_payment_order_id uuid,
  p_reverse boolean default false,
  p_reversed_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po      public.payment_orders;
  v_line    record;
  v_lines   jsonb := '[]'::jsonb;
  v_role    public.coa_system_role;
  v_dir     numeric;
  v_desc    text;
  v_number  text;
  v_entry   uuid;
begin
  select * into v_po from public.payment_orders where id = p_payment_order_id;
  if v_po.id is null then return null; end if;

  -- FIX internos: skip canal no-fiscal.
  if not public.is_channel_fiscal(v_po.channel_id) then
    return null;
  end if;

  v_dir := case when p_reverse then -1 else 1 end;
  v_number := 'OP' || lpad(v_po.punto_venta::text, 4, '0') || '-' || lpad(v_po.numero::text, 8, '0');
  v_desc := case when p_reverse then 'Anulación ' else '' end || 'Orden de pago ' || v_number;

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'proveedores',
    case when v_dir > 0 then 'debit' else 'credit' end, v_po.total_amount,
    'description', v_desc || ' — proveedor'
  );

  for v_line in
    select pl.account_id, pl.amount, pl.endorsed_check_id, pl.issued_check_id,
           a.name as account_name
      from public.payment_order_payment_lines pl
      join public.accounts a on a.id = pl.account_id
     where pl.payment_order_id = p_payment_order_id
  loop
    if v_line.issued_check_id is not null then
      v_role := 'cheques_diferidos_emitidos';
    elsif v_line.endorsed_check_id is not null then
      v_role := 'cheques_cartera';
    else
      v_role := public.coa_role_for_account(v_line.account_id);
    end if;

    if v_role is null then
      raise warning 'emit_journal_for_payment_order: account % sin mapping COA', v_line.account_id;
      continue;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      case when v_dir > 0 then 'credit' else 'debit' end, v_line.amount,
      'description', v_desc || ' — ' || v_line.account_name
    );
  end loop;

  begin
    v_entry := public.create_journal_entry(
      p_entry_date := v_po.payment_date,
      p_accrual_period := to_char(v_po.payment_date, 'YYYY-MM'),
      p_description := v_desc,
      p_lines := v_lines,
      p_source_table := 'payment_orders',
      p_source_id := v_po.id,
      p_channel_id := v_po.channel_id,
      p_is_reversal := p_reverse,
      p_reversed_entry_id := p_reversed_entry_id
    );
    return v_entry;
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_payment_order: % (po=%)', sqlerrm, v_po.id;
    return null;
  end;
end;
$$;

------------------------------------------------------------------------------
-- 6. Cleanup — borrar asientos ya generados que ahora son inválidos
------------------------------------------------------------------------------
-- a) Asientos de transactions linkeadas a recibos u OPs (double-counted)
delete from public.journal_entries je
 using public.transactions t
 where je.source_table = 'transactions'
   and je.source_id    = t.id
   and (t.receipt_id is not null or t.payment_order_id is not null);

-- b) Asientos de canales no-fiscales (internos)
delete from public.journal_entries je
 using public.invoicing_channels c
 where je.channel_id = c.id
   and c.is_fiscal = false;

set row_security = on;
