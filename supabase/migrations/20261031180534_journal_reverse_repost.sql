SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- One reversal and one re-post for every auto-posted document
-- (docs/plan-separacion-fiscal-interno.md, phase 4, PR D; decisions D2 and D3).
--
--   * build_*_journal_lines: one builder per origin (invoice, purchase,
--     receipt, payment order, transaction). journal_expected_entry(src, id)
--     reads the document's current row and says which entry it should have;
--     emit_journal(src, id) posts it. The four emit_journal_for_* functions and
--     the p_reverse arity of the builders are dropped, after every call site
--     (9 in 8 functions) moved to emit_journal / reverse_journal_entry.
--   * reverse_journal_entry(id): the only reversal. It clones the entry with
--     its lines swapped, keeping date, period, channel and cost center (even a
--     NULL one); it no longer rebuilds the entry from the document's current
--     state. Cancelling in a closed period still fails with 55006.
--   * repost_journal(src, id): the only re-post, fired by deferred constraint
--     triggers AFTER UPDATE OF the columns the entry reads (never notified_at,
--     notes or description). It compares the current entry against the
--     builder (accounts, amounts, cost center, date, period and channel; not
--     descriptions) and only deletes + re-emits when they differ.
--   * Purchases: replace_purchase_invoice_items no longer touches the journal
--     (the header update it makes re-posts once, at commit). BEFORE UPDATE
--     guards: no channel change once received, no kind change once allocated,
--     no Libro IVA change in a closed period; a deferred guard rejects an edit
--     that leaves the document or its NC origin with a negative open amount,
--     read from the new base view v_purchase_invoice_open (which
--     v_supplier_aging_documents now uses, same columns). D2: a fiscal
--     purchase needs a letter (on insert, or when letter/channel change).
--   * Diagnostics, run by the owner from the SQL editor:
--     journal_missing_entries() and purchase_invoices_fiscal_without_letter().

-- ---------------------------------------------------------------------------
-- Builders
-- ---------------------------------------------------------------------------

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
begin
  -- Counterparty = sum of the posted detail lines → exact balance.
  v_client := (case when v_revenue > 0 then v_revenue else 0 end)
    + (case when p_invoice.imp_iva > 0 then v_iva else 0 end)
    + (case when p_invoice.imp_trib > 0 then v_trib else 0 end);

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'clientes',
    case when v_debit_client then 'debit' else 'credit' end, v_client,
    'description', p_description || ' — cliente'
  );
  if v_revenue > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'ventas',
      case when v_debit_client then 'credit' else 'debit' end, v_revenue,
      'description', p_description || ' — neto'
    );
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
  v_neto   numeric := round(p_invoice.imp_neto * v_rate, 2);
  v_iva    numeric := round(p_invoice.imp_iva * v_rate, 2);
  v_trib   numeric := round(p_invoice.imp_trib * v_rate, 2);
  v_prov   numeric;
begin
  -- Counterparty = sum of the posted detail lines → exact balance.
  v_prov := (case when p_invoice.imp_neto > 0 then v_neto else 0 end)
    + (case when p_invoice.imp_iva > 0 then v_iva else 0 end)
    + (case when p_invoice.imp_trib > 0 then v_trib else 0 end);

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'proveedores',
    case when v_debit_detail then 'credit' else 'debit' end, v_prov,
    'description', p_description || ' — proveedor'
  );
  if p_invoice.imp_neto > 0 then
    v_lines := v_lines || case
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
  if p_invoice.imp_trib > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'percepciones_iibb_pagadas',
      case when v_debit_detail then 'debit' else 'credit' end, v_trib,
      'description', p_description || ' — percepciones'
    );
  end if;
  return v_lines;
end;
$$;

revoke all on function public.build_purchase_invoice_journal_lines(public.purchase_invoices, text) from public, anon, authenticated;

-- Payment lines debited to their account's role; retentions and perceptions
-- the client withheld debited to the asset they are (D12: IIBB perceptions to
-- percepciones_iibb_pagadas, the rest to retenciones_pagadas); the client
-- credited by the receipt total, which includes them.
create or replace function public.build_receipt_journal_lines(
  p_receipt     public.receipts,
  p_description text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_line  record;
  v_role  public.coa_system_role;
begin
  for v_line in
    select rpl.account_id, rpl.amount, a.name as account_name
      from public.receipt_payment_lines rpl
      join public.accounts a on a.id = rpl.account_id
     where rpl.receipt_id = p_receipt.id
     order by rpl.created_at, rpl.id
  loop
    v_role := public.coa_role_for_account(v_line.account_id);
    if v_role is null then
      raise exception 'La cuenta "%" no tiene una cuenta contable asociada: no se puede asentar el recibo', v_line.account_name
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      'debit', v_line.amount,
      'description', p_description || ' — ' || v_line.account_name
    );
  end loop;

  for v_line in
    select rr.kind, rr.tax_type, rr.amount
      from public.receipt_retentions rr
     where rr.receipt_id = p_receipt.id
     order by rr.created_at, rr.id
  loop
    v_lines := v_lines || jsonb_build_object(
      'system_role',
        case when v_line.kind = 'percepcion' and v_line.tax_type = 'iibb'
             then 'percepciones_iibb_pagadas' else 'retenciones_pagadas' end,
      'debit', v_line.amount,
      'description', p_description || ' — ' ||
        case when v_line.kind = 'percepcion' then 'percepción ' else 'retención ' end ||
        v_line.tax_type
    );
  end loop;

  return v_lines || jsonb_build_object(
    'system_role', 'clientes',
    'credit', p_receipt.total_amount,
    'description', p_description || ' — cliente'
  );
end;
$$;

revoke all on function public.build_receipt_journal_lines(public.receipts, text) from public, anon, authenticated;

create or replace function public.build_payment_order_journal_lines(
  p_payment_order public.payment_orders,
  p_description   text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_line  record;
  v_role  public.coa_system_role;
begin
  v_lines := jsonb_build_array(jsonb_build_object(
    'system_role', 'proveedores',
    'debit', p_payment_order.total_amount,
    'description', p_description || ' — proveedor'
  ));

  for v_line in
    select pl.account_id, pl.amount, pl.endorsed_check_id, pl.issued_check_id,
           a.name as account_name
      from public.payment_order_payment_lines pl
      join public.accounts a on a.id = pl.account_id
     where pl.payment_order_id = p_payment_order.id
     order by pl.created_at, pl.id
  loop
    v_role := case
      when v_line.issued_check_id is not null then 'cheques_diferidos_emitidos'::public.coa_system_role
      when v_line.endorsed_check_id is not null then 'cheques_cartera'::public.coa_system_role
      else public.coa_role_for_account(v_line.account_id)
    end;
    if v_role is null then
      raise exception 'La cuenta "%" no tiene una cuenta contable asociada: no se puede asentar la orden de pago', v_line.account_name
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      'credit', v_line.amount,
      'description', p_description || ' — ' || v_line.account_name
    );
  end loop;

  return v_lines;
end;
$$;

revoke all on function public.build_payment_order_journal_lines(public.payment_orders, text) from public, anon, authenticated;

-- NULL when the movement posts nothing: tied to an invoice, receipt or payment
-- order (their own entry covers it), the transfer_out half of a transfer (the
-- transfer_in posts both sides), or an account without a COA role.
create or replace function public.build_transaction_journal_lines(
  p_transaction public.transactions,
  p_description text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role      public.coa_system_role;
  v_pair      public.transactions;
  v_pair_role public.coa_system_role;
begin
  if p_transaction.invoice_id is not null
     or p_transaction.receipt_id is not null
     or p_transaction.payment_order_id is not null
     or p_transaction.kind not in ('income', 'expense', 'transfer_in') then
    return null;
  end if;

  v_role := public.coa_role_for_account(p_transaction.account_id);
  if v_role is null then
    raise warning 'build_transaction_journal_lines: account % sin mapping COA, asiento omitido', p_transaction.account_id;
    return null;
  end if;

  if p_transaction.kind = 'income' then
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', p_transaction.amount, 'description', p_description),
      jsonb_build_object('system_role', 'ajustes_caja', 'credit', p_transaction.amount, 'description', p_description)
    );
  elsif p_transaction.kind = 'expense' then
    return jsonb_build_array(
      jsonb_build_object('system_role', 'gastos', 'debit', p_transaction.amount, 'description', p_description),
      jsonb_build_object('system_role', v_role::text, 'credit', p_transaction.amount, 'description', p_description)
    );
  end if;

  select * into v_pair from public.transactions where id = p_transaction.transfer_pair_id;
  if v_pair.id is null then
    raise warning 'build_transaction_journal_lines: transfer_in % sin par, asiento omitido', p_transaction.id;
    return null;
  end if;
  v_pair_role := public.coa_role_for_account(v_pair.account_id);
  if v_pair_role is null then
    raise warning 'build_transaction_journal_lines: par % sin mapping COA, asiento omitido', v_pair.account_id;
    return null;
  end if;
  return jsonb_build_array(
    jsonb_build_object('system_role', v_role::text, 'debit', p_transaction.amount, 'description', p_description || ' (entrada)'),
    jsonb_build_object('system_role', v_pair_role::text, 'credit', p_transaction.amount, 'description', p_description || ' (salida)')
  );
end;
$$;

revoke all on function public.build_transaction_journal_lines(public.transactions, text) from public, anon, authenticated;

-- The entry a document should have, from its current row: NULL when the
-- document is not live (missing, cancelled, not yet emitted); otherwise its
-- header and `lines`, which is JSON null when it posts nothing (internal
-- channel, zero total, skipped movement).
create or replace function public.journal_expected_entry(p_source text, p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_inv     public.invoices;
  v_pi      public.purchase_invoices;
  v_r       public.receipts;
  v_po      public.payment_orders;
  v_tx      public.transactions;
  v_date    date;
  v_period  text;
  v_desc    text;
  v_channel text;
  v_cc      uuid;
  v_lines   jsonb;
begin
  if p_source = 'invoices' then
    select * into v_inv from public.invoices where id = p_id;
    if not found or v_inv.status <> 'emitted' then return null; end if;
    v_date := v_inv.fecha;
    v_channel := v_inv.channel_id;
    v_cc := v_inv.cost_center_id;
    v_desc := case v_inv.kind
        when 'factura' then 'Factura '
        when 'nc'      then 'Nota de crédito '
        when 'nd'      then 'Nota de débito '
      end || coalesce(v_inv.letter::text, '')
      || lpad(v_inv.punto_venta::text, 4, '0') || '-' || lpad(v_inv.numero::text, 8, '0');
    if public.is_channel_fiscal(v_channel) and coalesce(v_inv.imp_total, 0) > 0 then
      v_lines := public.build_invoice_journal_lines(v_inv, v_desc);
    end if;

  elsif p_source = 'purchase_invoices' then
    select * into v_pi from public.purchase_invoices where id = p_id;
    if not found or v_pi.status <> 'received' then return null; end if;
    v_date := v_pi.fecha;
    v_channel := v_pi.channel_id;
    v_cc := v_pi.cost_center_id;
    v_desc := case v_pi.kind
        when 'factura' then 'Factura compra '
        when 'nc'      then 'NC compra '
        when 'nd'      then 'ND compra '
      end || coalesce(v_pi.letter::text, '')
      || lpad(v_pi.punto_venta::text, 4, '0') || '-' || lpad(v_pi.numero::text, 8, '0');
    if public.is_channel_fiscal(v_channel) and coalesce(v_pi.imp_total, 0) > 0 then
      v_lines := public.build_purchase_invoice_journal_lines(v_pi, v_desc);
    end if;

  elsif p_source = 'receipts' then
    select * into v_r from public.receipts where id = p_id;
    if not found or v_r.status <> 'issued' then return null; end if;
    v_date := v_r.receipt_date;
    v_channel := v_r.channel_id;
    v_cc := v_r.cost_center_id;
    v_desc := 'Recibo R' || lpad(v_r.punto_venta::text, 4, '0') || '-' || lpad(v_r.numero::text, 8, '0');
    if public.is_channel_fiscal(v_channel) then
      v_lines := public.build_receipt_journal_lines(v_r, v_desc);
    end if;

  elsif p_source = 'payment_orders' then
    select * into v_po from public.payment_orders where id = p_id;
    if not found or v_po.status <> 'issued' then return null; end if;
    v_date := v_po.payment_date;
    v_channel := v_po.channel_id;
    v_cc := v_po.cost_center_id;
    v_desc := 'Orden de pago OP' || lpad(v_po.punto_venta::text, 4, '0') || '-' || lpad(v_po.numero::text, 8, '0');
    if public.is_channel_fiscal(v_channel) then
      v_lines := public.build_payment_order_journal_lines(v_po, v_desc);
    end if;

  elsif p_source = 'transactions' then
    select * into v_tx from public.transactions where id = p_id;
    if not found then return null; end if;
    v_date := v_tx.transaction_date;
    v_period := to_char(v_tx.accrual_month, 'YYYY-MM');
    v_channel := v_tx.channel_id;
    v_cc := v_tx.cost_center_id;
    v_desc := coalesce(v_tx.description, case v_tx.kind
      when 'income'  then 'Ingreso de caja'
      when 'expense' then 'Egreso de caja'
      else 'Transferencia interna'
    end);
    if public.is_channel_fiscal(v_channel) then
      v_lines := public.build_transaction_journal_lines(v_tx, v_desc);
    end if;

  else
    raise exception 'journal_expected_entry: origen % desconocido', p_source
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'entry_date',     v_date,
    'accrual_period', coalesce(v_period, to_char(v_date, 'YYYY-MM')),
    'description',    v_desc,
    'channel_id',     v_channel,
    'cost_center_id', v_cc,
    'lines',          v_lines
  );
end;
$$;

revoke all on function public.journal_expected_entry(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Emit, current, reverse, compare, re-post
-- ---------------------------------------------------------------------------

create or replace function public.emit_journal(p_source text, p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected jsonb := public.journal_expected_entry(p_source, p_id);
begin
  if v_expected is null or jsonb_typeof(v_expected -> 'lines') <> 'array' then
    return null;
  end if;
  begin
    return public.create_journal_entry(
      p_entry_date     := (v_expected ->> 'entry_date')::date,
      p_accrual_period := v_expected ->> 'accrual_period',
      p_description    := v_expected ->> 'description',
      p_lines          := v_expected -> 'lines',
      p_source_table   := p_source,
      p_source_id      := p_id,
      p_channel_id     := v_expected ->> 'channel_id'
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal: % (%=%)', sqlerrm, p_source, p_id;
    return null;
  end;
end;
$$;

revoke all on function public.emit_journal(text, uuid) from public, anon, authenticated;

-- The live entries of a document: auto-posted, not a reversal, not reversed.
create or replace function public.current_journal_entries(p_source text, p_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select je.id
      from public.journal_entries je
     where je.source_table = p_source
       and je.source_id = p_id
       and not je.is_reversal
       and not exists (
         select 1 from public.journal_entries r where r.reversed_entry_id = je.id
       )
     order by je.created_at, je.id;
end;
$$;

revoke all on function public.current_journal_entries(text, uuid) from public, anon, authenticated;

create or replace function public.reverse_journal_entry(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reversal uuid;
begin
  -- Lines are inserted one by one: the balance check waits for the last one.
  set constraints public.jel_enforce_balance deferred;

  insert into public.journal_entries (
    entry_date, accrual_period, description, source_table, source_id,
    channel_id, cost_center_id, created_by, is_reversal, reversed_entry_id
  )
  select je.entry_date, je.accrual_period, 'Anulación ' || je.description,
         je.source_table, je.source_id, je.channel_id, je.cost_center_id,
         auth.uid(), true, je.id
    from public.journal_entries je
   where je.id = p_entry_id
  returning id into v_reversal;

  if v_reversal is null then
    return null;
  end if;

  insert into public.journal_entry_lines (
    journal_entry_id, chart_of_accounts_id, debit, credit, description, sort_order
  )
  select v_reversal, l.chart_of_accounts_id, l.credit, l.debit,
         'Anulación ' || l.description, l.sort_order
    from public.journal_entry_lines l
   where l.journal_entry_id = p_entry_id;

  set constraints public.jel_enforce_balance immediate;
  return v_reversal;
end;
$$;

revoke all on function public.reverse_journal_entry(uuid) from public, anon, authenticated;

-- How a document's live entry compares with the one it should have:
--   not_live — the document is cancelled, deleted or not yet emitted
--   none     — no live entry and none expected
--   missing  — no live entry but one expected (journal_missing_entries lists it)
--   match    — one live entry, same accounts/amounts, cost center, date,
--              period and channel (descriptions do not count)
--   differs  — anything else
-- Raises (hint jouve_guard) when an expected line's role has no account.
create or replace function public.journal_entry_status(p_source text, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expected jsonb := public.journal_expected_entry(p_source, p_id);
  v_current  uuid[];
  v_header   public.journal_entries;
  v_line     jsonb;
  v_account  uuid;
  v_resolved jsonb := '[]'::jsonb;
begin
  if v_expected is null then
    return 'not_live';
  end if;

  v_current := array(select public.current_journal_entries(p_source, p_id));
  if cardinality(v_current) = 0 then
    return case when jsonb_typeof(v_expected -> 'lines') = 'array' then 'missing' else 'none' end;
  end if;
  if jsonb_typeof(v_expected -> 'lines') <> 'array' or cardinality(v_current) > 1 then
    return 'differs';
  end if;

  select * into v_header from public.journal_entries where id = v_current[1];
  if v_header.entry_date is distinct from (v_expected ->> 'entry_date')::date
     or v_header.accrual_period is distinct from v_expected ->> 'accrual_period'
     or v_header.channel_id is distinct from v_expected ->> 'channel_id'
     or v_header.cost_center_id is distinct from (v_expected ->> 'cost_center_id')::uuid then
    return 'differs';
  end if;

  for v_line in select * from jsonb_array_elements(v_expected -> 'lines')
  loop
    if v_line ->> 'account_id' is not null then
      v_account := (v_line ->> 'account_id')::uuid;
    else
      v_account := public.find_account_by_role((v_line ->> 'system_role')::public.coa_system_role);
      if v_account is null then
        raise exception 'No se puede re-asentar el documento: no hay cuenta activa asignada al rol "%" del plan de cuentas', v_line ->> 'system_role'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    v_resolved := v_resolved || jsonb_build_object(
      'account', v_account,
      'debit',   coalesce((v_line ->> 'debit')::numeric, 0),
      'credit',  coalesce((v_line ->> 'credit')::numeric, 0)
    );
  end loop;

  if exists (
    (select l.chart_of_accounts_id, l.debit, l.credit
       from public.journal_entry_lines l where l.journal_entry_id = v_header.id
     except all
     select (e ->> 'account')::uuid, (e ->> 'debit')::numeric, (e ->> 'credit')::numeric
       from jsonb_array_elements(v_resolved) e)
    union all
    (select (e ->> 'account')::uuid, (e ->> 'debit')::numeric, (e ->> 'credit')::numeric
       from jsonb_array_elements(v_resolved) e
     except all
     select l.chart_of_accounts_id, l.debit, l.credit
       from public.journal_entry_lines l where l.journal_entry_id = v_header.id)
  ) then
    return 'differs';
  end if;
  return 'match';
end;
$$;

revoke all on function public.journal_entry_status(text, uuid) from public, anon, authenticated;

-- Re-posts a live document whose entry differs from its builder: deletes the
-- live entries and emits again. A closed period rejects both (55006). A
-- document without a live entry is left alone (journal_missing_entries).
create or replace function public.repost_journal(p_source text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid[];
  v_deleted int;
begin
  if public.journal_entry_status(p_source, p_id) <> 'differs' then
    return;
  end if;

  v_current := array(select public.current_journal_entries(p_source, p_id));
  delete from public.journal_entries where id = any (v_current);
  get diagnostics v_deleted = row_count;
  if v_deleted <> cardinality(v_current) then
    raise exception 'No se pudo re-asentar el documento: se borraron % de % asientos vigentes', v_deleted, cardinality(v_current)
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  perform public.emit_journal(p_source, p_id);
end;
$$;

revoke all on function public.repost_journal(text, uuid) from public, anon, authenticated;

create or replace function public.repost_journal_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.repost_journal(tg_table_name, new.id);
  return null;
end;
$$;

revoke all on function public.repost_journal_trigger() from public, anon, authenticated;

-- A reversal keeps the cost center it was cloned with, NULL included.
create or replace function public.set_journal_cost_center()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cc uuid;
begin
  if new.is_reversal or new.cost_center_id is not null or new.source_id is null then
    return new;
  end if;
  case new.source_table
    when 'transactions' then
      select cost_center_id into v_cc from public.transactions where id = new.source_id;
    when 'invoices' then
      select cost_center_id into v_cc from public.invoices where id = new.source_id;
    when 'purchase_invoices' then
      select cost_center_id into v_cc from public.purchase_invoices where id = new.source_id;
    when 'payment_orders' then
      select cost_center_id into v_cc from public.payment_orders where id = new.source_id;
    when 'receipts' then
      select cost_center_id into v_cc from public.receipts where id = new.source_id;
    else
      v_cc := null;
  end case;
  new.cost_center_id := v_cc;
  return new;
end;
$$;

revoke all on function public.set_journal_cost_center() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Call sites: insert, emit and cancel triggers
-- ---------------------------------------------------------------------------

create or replace function public.invoices_after_insert_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'emitted' then
    perform public.emit_journal('invoices', new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.invoices_after_insert_journal() from public, anon, authenticated;

create or replace function public.invoices_after_update_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'emitted' and new.status = 'emitted' then
    perform public.emit_journal('invoices', new.id);
  elsif old.status = 'emitted' and new.status = 'cancelled' then
    perform public.reverse_journal_entry(e.id)
       from public.current_journal_entries('invoices', new.id) as e(id);
  end if;
  return new;
end;
$$;

revoke all on function public.invoices_after_update_journal() from public, anon, authenticated;

create or replace function public.purchase_invoices_after_insert_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'received' then
    perform public.emit_journal('purchase_invoices', new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.purchase_invoices_after_insert_journal() from public, anon, authenticated;

create or replace function public.purchase_invoices_after_update_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'received' and new.status = 'cancelled' then
    perform public.reverse_journal_entry(e.id)
       from public.current_journal_entries('purchase_invoices', new.id) as e(id);
  end if;
  return new;
end;
$$;

revoke all on function public.purchase_invoices_after_update_journal() from public, anon, authenticated;

create or replace function public.receipts_after_insert_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.emit_journal('receipts', new.id);
  return null;
end;
$$;

revoke all on function public.receipts_after_insert_journal() from public, anon, authenticated;

create or replace function public.receipts_after_update_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'issued' and new.status = 'canceled' then
    perform public.reverse_journal_entry(e.id)
       from public.current_journal_entries('receipts', new.id) as e(id);
  end if;
  return new;
end;
$$;

revoke all on function public.receipts_after_update_journal() from public, anon, authenticated;

create or replace function public.payment_orders_after_insert_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.emit_journal('payment_orders', new.id);
  return null;
end;
$$;

revoke all on function public.payment_orders_after_insert_journal() from public, anon, authenticated;

create or replace function public.payment_orders_after_update_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'issued' and new.status = 'canceled' then
    perform public.reverse_journal_entry(e.id)
       from public.current_journal_entries('payment_orders', new.id) as e(id);
  end if;
  return new;
end;
$$;

revoke all on function public.payment_orders_after_update_journal() from public, anon, authenticated;

create or replace function public.generate_journal_for_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.emit_journal('transactions', new.id);
  return new;
end;
$$;

revoke all on function public.generate_journal_for_transaction() from public, anon, authenticated;

-- Items no longer post: the header update below fires the re-post trigger,
-- which runs once at commit with the final totals.
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

  -- Recalc header totals from items. imp_trib (header-level) preserved.
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
         imp_total = v_sum_total + coalesce(imp_trib, 0),
         updated_at = now()
   where id = p_invoice_id;
end;
$$;

revoke all on function public.replace_purchase_invoice_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_purchase_invoice_items(uuid, jsonb) to authenticated, service_role;

-- Internal: no client calls these (ACL postgres/service_role only), and every
-- call site was replaced above (lib/db/journal-emitters.test.ts).
-- squawk-ignore ban-drop-function
drop function public.emit_journal_for_invoice(public.invoices, boolean, uuid);
-- squawk-ignore ban-drop-function
drop function public.emit_journal_for_purchase_invoice(public.purchase_invoices, boolean, uuid);
-- squawk-ignore ban-drop-function
drop function public.emit_journal_for_receipt(uuid, boolean, uuid);
-- squawk-ignore ban-drop-function
drop function public.emit_journal_for_payment_order(uuid, boolean, uuid);
-- squawk-ignore ban-drop-function
drop function public.build_invoice_journal_lines(public.invoices, boolean, boolean);
-- squawk-ignore ban-drop-function
drop function public.build_purchase_invoice_journal_lines(public.purchase_invoices, boolean);

-- ---------------------------------------------------------------------------
-- Re-post triggers (receipts and payment orders: update_receipt /
-- update_payment_order always set the date and total, so every edit compares
-- once at commit; notified_at and notes never fire them)
-- ---------------------------------------------------------------------------

create constraint trigger purchase_invoices_repost_journal
  after update of imp_neto, imp_iva, imp_trib, imp_total, fecha, moneda, cotizacion,
                  account_id, cost_center_id, kind, channel_id
  on public.purchase_invoices
  deferrable initially deferred
  for each row execute function public.repost_journal_trigger();

create constraint trigger receipts_repost_journal
  after update of receipt_date, total_amount, cost_center_id, channel_id
  on public.receipts
  deferrable initially deferred
  for each row execute function public.repost_journal_trigger();

create constraint trigger payment_orders_repost_journal
  after update of payment_date, total_amount, cost_center_id, channel_id
  on public.payment_orders
  deferrable initially deferred
  for each row execute function public.repost_journal_trigger();

-- ---------------------------------------------------------------------------
-- Purchases: open amount, edit guards, fiscal letter
-- ---------------------------------------------------------------------------

-- Every purchase with what was paid (issued OPs), credited (received NCs) and
-- applied from the opening balance. No status or sign filter: aging and the
-- post-edit guard filter on top.
create or replace view public.v_purchase_invoice_open
with (security_invoker = on) as
select
  pi.id as purchase_invoice_id,
  pi.status,
  pi.kind,
  pi.imp_total,
  coalesce(alloc.applied, 0)   as amount_paid,
  coalesce(nc.credited, 0)     as amount_credited_by_nc,
  coalesce(opening.applied, 0) as amount_opening_applied,
  pi.imp_total - coalesce(alloc.applied, 0) - coalesce(nc.credited, 0) - coalesce(opening.applied, 0) as open_amount
from public.purchase_invoices pi
left join (
  select poa.purchase_invoice_id, sum(poa.amount_applied) as applied
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
   where po.status = 'issued'
   group by poa.purchase_invoice_id
) alloc on alloc.purchase_invoice_id = pi.id
left join (
  select nc_1.invoice_origin_id, sum(nc_1.imp_total) as credited
    from public.purchase_invoices nc_1
   where nc_1.kind = 'nc' and nc_1.status = 'received' and nc_1.invoice_origin_id is not null
   group by nc_1.invoice_origin_id
) nc on nc.invoice_origin_id = pi.id
left join (
  select soba.purchase_invoice_id, soba.amount_applied as applied
    from public.supplier_opening_balance_allocations soba
) opening on opening.purchase_invoice_id = pi.id;

revoke all on public.v_purchase_invoice_open from public, anon, authenticated;
grant select on public.v_purchase_invoice_open to authenticated, service_role;

create or replace view public.v_supplier_aging_documents
with (security_invoker = on) as
select
  pi.id as purchase_invoice_id,
  pi.supplier_id,
  pi.fecha,
  pi.kind,
  pi.letter,
  pi.punto_venta,
  pi.numero,
  pi.imp_total,
  o.amount_paid + o.amount_opening_applied as amount_applied,
  o.amount_credited_by_nc,
  o.open_amount,
  current_date - pi.fecha as days_overdue,
  case
    when (current_date - pi.fecha) <= 30 then '0_30'
    when (current_date - pi.fecha) <= 60 then '30_60'
    when (current_date - pi.fecha) <= 90 then '60_90'
    else '90_plus'
  end as bucket,
  pi.channel_id,
  ch.name as channel_name,
  ch.is_fiscal as channel_is_fiscal,
  pi.fch_vto_pago,
  pi.moneda
from public.purchase_invoices pi
join public.v_purchase_invoice_open o on o.purchase_invoice_id = pi.id
join public.invoicing_channels ch on ch.id = pi.channel_id
where pi.status = 'received'
  and pi.kind in ('factura', 'nd')
  and o.open_amount > 0;

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
          new.imp_total, new.moneda, new.cotizacion, new.channel_id, new.status)
         is distinct from
         (old.fecha, old.kind, old.letter, old.punto_venta, old.numero, old.supplier_id,
          old.cae_proveedor, old.cae_vto_proveedor, old.imp_neto, old.imp_iva, old.imp_trib,
          old.imp_total, old.moneda, old.cotizacion, old.channel_id, old.status) then
    raise exception 'El período contable de la factura está cerrado: no se pueden cambiar datos que figuran en el Libro IVA Compras'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_purchase_invoice_edit() from public, anon, authenticated;

create trigger purchase_invoices_guard_edit
  before update on public.purchase_invoices
  for each row execute function public.guard_purchase_invoice_edit();

-- At commit, after the header and its items settled: the edited purchase and
-- its NC origins (old and new) must not end up paid or credited beyond their
-- total. guard_payment_order_allocation (#247) keeps its own check.
create or replace function public.guard_purchase_invoice_open_after_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array_remove(array[new.id, old.invoice_origin_id, new.invoice_origin_id], null);
begin
  perform 1 from public.purchase_invoices
   where id = any (v_ids)
   order by id
     for update;

  if exists (
    select 1 from public.v_purchase_invoice_open o
     where o.purchase_invoice_id = any (v_ids)
       and o.status = 'received'
       and o.kind in ('factura', 'nd')
       and o.open_amount < -0.01
  ) then
    raise exception 'La edición deja un comprobante con más pagado o acreditado que su total'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return null;
end;
$$;

revoke all on function public.guard_purchase_invoice_open_after_edit() from public, anon, authenticated;

create constraint trigger purchase_invoices_open_after_edit
  after update of imp_total, kind, invoice_origin_id
  on public.purchase_invoices
  deferrable initially deferred
  for each row execute function public.guard_purchase_invoice_open_after_edit();

-- D2: a fiscal purchase carries its letter. Checked on insert and when the
-- letter or the channel change, so a historical one without letter can still
-- be corrected.
create or replace function public.guard_purchase_invoice_fiscal_letter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.letter is not null or not coalesce(public.is_channel_fiscal(new.channel_id), false) then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.letter is not distinct from old.letter and new.channel_id is not distinct from old.channel_id then
      return new;
    end if;
  end if;
  raise exception 'Una factura de compra fiscal lleva letra (A, B o C)'
    using errcode = '23514', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_purchase_invoice_fiscal_letter() from public, anon, authenticated;

create trigger purchase_invoices_fiscal_letter
  before insert or update of letter, channel_id on public.purchase_invoices
  for each row execute function public.guard_purchase_invoice_fiscal_letter();

-- ---------------------------------------------------------------------------
-- Diagnostics (owner, SQL editor)
-- ---------------------------------------------------------------------------

-- Live fiscal documents whose journal does not match them: no entry
-- ('missing'), an entry that differs from the builder ('differs'), or one the
-- builder cannot resolve (the error).
create or replace function public.journal_missing_entries()
returns table (source_table text, source_id uuid, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc record;
begin
  for v_doc in
    select 'invoices'::text as src, i.id
      from public.invoices i join public.invoicing_channels c on c.id = i.channel_id
     where c.is_fiscal and i.status = 'emitted'
    union all
    select 'purchase_invoices', p.id
      from public.purchase_invoices p join public.invoicing_channels c on c.id = p.channel_id
     where c.is_fiscal and p.status = 'received'
    union all
    select 'receipts', r.id
      from public.receipts r join public.invoicing_channels c on c.id = r.channel_id
     where c.is_fiscal and r.status = 'issued'
    union all
    select 'payment_orders', po.id
      from public.payment_orders po join public.invoicing_channels c on c.id = po.channel_id
     where c.is_fiscal and po.status = 'issued'
    union all
    select 'transactions', t.id
      from public.transactions t join public.invoicing_channels c on c.id = t.channel_id
     where c.is_fiscal
       and t.invoice_id is null and t.receipt_id is null and t.payment_order_id is null
       and t.kind in ('income', 'expense', 'transfer_in')
  loop
    source_table := v_doc.src;
    source_id := v_doc.id;
    begin
      status := public.journal_entry_status(v_doc.src, v_doc.id);
    exception when others then
      status := sqlerrm;
    end;
    if status not in ('match', 'none', 'not_live') then
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.journal_missing_entries() from public, anon, authenticated;

create or replace function public.purchase_invoices_fiscal_without_letter()
returns table (purchase_invoice_id uuid, supplier_id uuid, fecha date, punto_venta int, numero int, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.supplier_id, p.fecha, p.punto_venta, p.numero, p.status
    from public.purchase_invoices p
    join public.invoicing_channels c on c.id = p.channel_id
   where c.is_fiscal and p.letter is null
   order by p.fecha, p.id;
$$;

revoke all on function public.purchase_invoices_fiscal_without_letter() from public, anon, authenticated;
