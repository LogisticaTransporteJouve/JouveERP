SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Recibos de cobranza use the letter X ("documento no válido como factura");
-- R is the fiscal remito. Only the prefix of the label changes: punto de
-- venta and numero stay, no stored number is rewritten. Each object below is
-- the latest definition, copied as is except for that letter:
--
--   * journal_document_entry (20261102250000): the description of a receipt's
--     entry. Descriptions are stored when the entry is posted, so entries
--     already posted keep "Recibo R…"; new and re-posted ones read
--     "Recibo X…". journal_entry_status ignores descriptions, so the change
--     does not make any posted entry "differs" and nothing is re-posted.
--   * create_receipt / update_receipt (20261031205518): the description of
--     the caja movements a receipt writes. Stored movements keep "Recibo R…"
--     until the receipt is edited (update_receipt rewrites them).
--   * settle_billed_remito (20261101200000): the note of the fiscal receipt
--     that replaces a recibo interno when its remito is billed.
--   * search_index (20261031200410): the receipt title is X…, and the tsv
--     carries both X… and the legacy R… label, so an old printed receipt is
--     still found by its R number. Recreating the materialized view fills it.
--
-- The emit_journal_for_receipt definitions that also built 'R' labels were
-- dropped in 20261031180534; nothing reads them.

-- 1. Journal description ----------------------------------------------------

create or replace function public.journal_document_entry(
  p_source      text,
  p_id          uuid,
  p_fiscal_only boolean default false
)
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
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) and coalesce(v_inv.imp_total, 0) > 0 then
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
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) and coalesce(v_pi.imp_total, 0) > 0 then
      v_lines := public.build_purchase_invoice_journal_lines(v_pi, v_desc);
    end if;

  elsif p_source = 'receipts' then
    select * into v_r from public.receipts where id = p_id;
    if not found or v_r.status <> 'issued' then return null; end if;
    v_date := v_r.receipt_date;
    v_channel := v_r.channel_id;
    v_cc := v_r.cost_center_id;
    v_desc := 'Recibo X' || lpad(v_r.punto_venta::text, 4, '0') || '-' || lpad(v_r.numero::text, 8, '0');
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) then
      v_lines := public.build_receipt_journal_lines(v_r, v_desc);
    end if;

  elsif p_source = 'payment_orders' then
    select * into v_po from public.payment_orders where id = p_id;
    if not found or v_po.status <> 'issued' then return null; end if;
    v_date := v_po.payment_date;
    v_channel := v_po.channel_id;
    v_cc := v_po.cost_center_id;
    v_desc := 'Orden de pago OP' || lpad(v_po.punto_venta::text, 4, '0') || '-' || lpad(v_po.numero::text, 8, '0');
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) then
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
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) then
      v_lines := public.build_transaction_journal_lines(v_tx, v_desc);
    end if;

  else
    raise exception 'journal_document_entry: origen % desconocido', p_source
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

revoke all on function public.journal_document_entry(text, uuid, boolean) from public, anon, authenticated;

-- 2. Caja movements of a receipt -----------------------------------------------

create or replace function public.create_receipt(
  p_channel_id    text,
  p_punto_venta   int,
  p_numero        int,
  p_client_id     uuid,
  p_recibo_date   date,
  p_total_amount  numeric,
  p_currency      text,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb,
  p_retentions    jsonb,
  p_cotizacion    numeric default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_receipt_id    uuid;
  v_payment_sum   numeric := 0;
  v_alloc_sum     numeric := 0;
  v_retention_sum numeric := 0;
  v_accrual_month date;
  v_description   text;
  v_line          jsonb;
  v_line_id       uuid;
  v_account_type  text;
  v_check        jsonb;
  v_check_id     uuid;
begin
  -- Role guard (receipts:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para crear recibos'
      using errcode = '42501';
  end if;

  insert into public.receipts (
    channel_id, punto_venta, numero, client_id, receipt_date,
    total_amount, currency, cotizacion, notes, status, created_by
  ) values (
    p_channel_id, p_punto_venta, p_numero, p_client_id, p_recibo_date,
    p_total_amount, p_currency,
    case when p_currency = 'USD' then p_cotizacion end,
    nullif(trim(p_notes), ''), 'issued', auth.uid()
  )
  returning id into v_receipt_id;

  v_accrual_month := date_trunc('month', p_recibo_date)::date;
  v_description := 'Recibo X'
    || lpad(p_punto_venta::text, 4, '0')
    || '-' || lpad(p_numero::text, 8, '0');

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      v_receipt_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    )
    returning id into v_line_id;

    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;

    -- Income transaction in the destination account.
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, counterparty_client_id, receipt_id, created_by
    ) values (
      (v_line->>'account_id')::uuid,
      p_channel_id,
      'income',
      (v_line->>'amount')::numeric,
      p_currency,
      p_recibo_date,
      v_accrual_month,
      v_description,
      p_client_id,
      v_receipt_id,
      auth.uid()
    );

    -- Auto-create check when applicable: account.type ∈ {checks, echeq}
    -- and the payload includes check metadata.
    select type into v_account_type
      from public.accounts where id = (v_line->>'account_id')::uuid;

    v_check := v_line->'check';
    if v_account_type in ('checks', 'echeq') and v_check is not null
       and jsonb_typeof(v_check) = 'object' then
      insert into public.checks (
        kind, check_number, bank_name, drawer_name, drawer_cuit,
        issue_date, due_date, amount, currency,
        cartera_account_id, source_kind, source_receipt_id,
        source_payment_line_id, source_client_id, notes, created_by
      ) values (
        case when v_account_type = 'echeq' then 'echeq' else 'fisico' end,
        coalesce(nullif(trim(v_check->>'check_number'), ''),
                 v_line->>'reference'),
        v_check->>'bank_name',
        v_check->>'drawer_name',
        nullif(trim(v_check->>'drawer_cuit'), ''),
        coalesce((v_check->>'issue_date')::date, p_recibo_date),
        (v_check->>'due_date')::date,
        (v_line->>'amount')::numeric,
        p_currency,
        (v_line->>'account_id')::uuid,
        'receipt',
        v_receipt_id,
        v_line_id,
        p_client_id,
        nullif(trim(v_check->>'notes'), ''),
        auth.uid()
      )
      returning id into v_check_id;

      insert into public.check_movements (
        check_id, event, event_date, notes, created_by
      ) values (
        v_check_id, 'received', p_recibo_date, null, auth.uid()
      );
    end if;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    if v_line->>'rejected_check_id' is not null then
      insert into public.receipt_rejected_check_allocations (
        receipt_id, check_id, amount_applied
      ) values (
        v_receipt_id,
        (v_line->>'rejected_check_id')::uuid,
        (v_line->>'amount_applied')::numeric
      );
    else
      insert into public.receipt_allocations (
        receipt_id, invoice_id, amount_applied
      ) values (
        v_receipt_id,
        (v_line->>'invoice_id')::uuid,
        (v_line->>'amount_applied')::numeric
      );
    end if;
    v_alloc_sum := v_alloc_sum + (v_line->>'amount_applied')::numeric;
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_retentions, '[]'::jsonb))
  loop
    insert into public.receipt_retentions (
      receipt_id, kind, tax_type, jurisdiction, certificate_number,
      certificate_date, amount, notes
    ) values (
      v_receipt_id,
      v_line->>'kind',
      v_line->>'tax_type',
      nullif(trim(v_line->>'jurisdiction'), ''),
      v_line->>'certificate_number',
      (v_line->>'certificate_date')::date,
      (v_line->>'amount')::numeric,
      nullif(trim(v_line->>'notes'), '')
    );
    v_retention_sum := v_retention_sum + (v_line->>'amount')::numeric;
  end loop;

  if round(v_payment_sum + v_retention_sum, 2) <> round(p_total_amount, 2) then
    raise exception 'payment_lines + retentions sum (%) does not match total_amount (%)',
      v_payment_sum + v_retention_sum, p_total_amount;
  end if;

  if round(v_alloc_sum, 2) > round(p_total_amount, 2) then
    raise exception 'allocations sum (%) exceeds total_amount (%)',
      v_alloc_sum, p_total_amount;
  end if;

  return v_receipt_id;
end;
$$;

revoke all on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb, numeric) to authenticated, service_role;

create or replace function public.update_receipt(
  p_id            uuid,
  p_recibo_date   date,
  p_total_amount  numeric,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb,
  p_retentions    jsonb,
  p_cotizacion    numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status        text;
  v_channel_id    text;
  v_currency      text;
  v_client_id     uuid;
  v_punto_venta   int;
  v_numero        int;
  v_payment_sum   numeric := 0;
  v_alloc_sum     numeric := 0;
  v_retention_sum numeric := 0;
  v_accrual_month date;
  v_description   text;
  v_line          jsonb;
  v_line_id       uuid;
  v_account_type  text;
  v_check        jsonb;
  v_check_id     uuid;
begin
  -- Role guard (receipts:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar recibos'
      using errcode = '42501';
  end if;

  select status, channel_id, currency, client_id, punto_venta, numero
    into v_status, v_channel_id, v_currency, v_client_id, v_punto_venta, v_numero
    from public.receipts where id = p_id
     for update;
  if v_status is null then
    raise exception 'receipt % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled receipt (%)', p_id;
  end if;

  -- An edit that sends no rate keeps the stored one.
  update public.receipts set
    receipt_date  = p_recibo_date,
    total_amount = p_total_amount,
    cotizacion   = case when v_currency = 'USD' then coalesce(p_cotizacion, cotizacion) end,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  -- Cascade-rebuild. Cheques con status <> en_cartera abortan el delete y
  -- forman un mensaje claro al usuario (ver guard_check_delete_in_lifecycle).
  delete from public.receipt_payment_lines where receipt_id = p_id;
  delete from public.receipt_allocations    where receipt_id = p_id;
  delete from public.receipt_rejected_check_allocations where receipt_id = p_id;
  delete from public.receipt_retentions     where receipt_id = p_id;
  delete from public.transactions           where receipt_id = p_id;

  v_accrual_month := date_trunc('month', p_recibo_date)::date;
  v_description := 'Recibo X'
    || lpad(v_punto_venta::text, 4, '0')
    || '-' || lpad(v_numero::text, 8, '0');

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      p_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    )
    returning id into v_line_id;

    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;

    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, counterparty_client_id, receipt_id, created_by
    ) values (
      (v_line->>'account_id')::uuid,
      v_channel_id,
      'income',
      (v_line->>'amount')::numeric,
      v_currency,
      p_recibo_date,
      v_accrual_month,
      v_description,
      v_client_id,
      p_id,
      auth.uid()
    );

    select type into v_account_type
      from public.accounts where id = (v_line->>'account_id')::uuid;
    v_check := v_line->'check';
    if v_account_type in ('checks', 'echeq') and v_check is not null
       and jsonb_typeof(v_check) = 'object' then
      insert into public.checks (
        kind, check_number, bank_name, drawer_name, drawer_cuit,
        issue_date, due_date, amount, currency,
        cartera_account_id, source_kind, source_receipt_id,
        source_payment_line_id, source_client_id, notes, created_by
      ) values (
        case when v_account_type = 'echeq' then 'echeq' else 'fisico' end,
        coalesce(nullif(trim(v_check->>'check_number'), ''),
                 v_line->>'reference'),
        v_check->>'bank_name',
        v_check->>'drawer_name',
        nullif(trim(v_check->>'drawer_cuit'), ''),
        coalesce((v_check->>'issue_date')::date, p_recibo_date),
        (v_check->>'due_date')::date,
        (v_line->>'amount')::numeric,
        v_currency,
        (v_line->>'account_id')::uuid,
        'receipt',
        p_id,
        v_line_id,
        v_client_id,
        nullif(trim(v_check->>'notes'), ''),
        auth.uid()
      )
      returning id into v_check_id;

      insert into public.check_movements (
        check_id, event, event_date, notes, created_by
      ) values (
        v_check_id, 'received', p_recibo_date, null, auth.uid()
      );
    end if;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    if v_line->>'rejected_check_id' is not null then
      insert into public.receipt_rejected_check_allocations (
        receipt_id, check_id, amount_applied
      ) values (
        p_id,
        (v_line->>'rejected_check_id')::uuid,
        (v_line->>'amount_applied')::numeric
      );
    else
      insert into public.receipt_allocations (
        receipt_id, invoice_id, amount_applied
      ) values (
        p_id,
        (v_line->>'invoice_id')::uuid,
        (v_line->>'amount_applied')::numeric
      );
    end if;
    v_alloc_sum := v_alloc_sum + (v_line->>'amount_applied')::numeric;
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_retentions, '[]'::jsonb))
  loop
    insert into public.receipt_retentions (
      receipt_id, kind, tax_type, jurisdiction, certificate_number,
      certificate_date, amount, notes
    ) values (
      p_id,
      v_line->>'kind',
      v_line->>'tax_type',
      nullif(trim(v_line->>'jurisdiction'), ''),
      v_line->>'certificate_number',
      (v_line->>'certificate_date')::date,
      (v_line->>'amount')::numeric,
      nullif(trim(v_line->>'notes'), '')
    );
    v_retention_sum := v_retention_sum + (v_line->>'amount')::numeric;
  end loop;

  if round(v_payment_sum + v_retention_sum, 2) <> round(p_total_amount, 2) then
    raise exception 'payment_lines + retentions sum (%) does not match total_amount (%)',
      v_payment_sum + v_retention_sum, p_total_amount;
  end if;

  if round(v_alloc_sum, 2) > round(p_total_amount, 2) then
    raise exception 'allocations sum (%) exceeds total_amount (%)',
      v_alloc_sum, p_total_amount;
  end if;
end;
$$;

revoke all on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb, numeric) to authenticated, service_role;

-- 3. Receipt that replaces a recibo interno -------------------------------------

create or replace function public.settle_billed_remito(p_factura_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factura record;
  v_remito  record;
  v_receipt record;
  v_pos     int;
  v_numero  int;
  v_lines   jsonb;
  v_blocker text;
  v_open    numeric;
  v_motivo  text;
  v_nc_id   uuid;
  v_existing record;
begin
  select i.id, i.client_id, i.channel_id, i.source_remito_id, i.status,
         i.letter, i.punto_venta, i.numero, i.created_by
    into v_factura
  from public.invoices i
  where i.id = p_factura_id;

  if v_factura is null or v_factura.source_remito_id is null then
    return null;
  end if;
  if v_factura.status <> 'emitted' then
    raise exception 'La factura todavía no está emitida.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- Only this function can draft an NC on a frozen remito, so an NC of the
  -- remito holding the factura's key is the settlement's own.
  select n.id, n.kind, n.invoice_origin_id into v_existing
  from public.invoices n
  where n.idempotency_key::text = p_factura_id::text;
  if v_existing is not null then
    if v_existing.kind <> 'nc'
       or v_existing.invoice_origin_id is distinct from v_factura.source_remito_id then
      raise exception 'Otro comprobante usa la clave de esta acreditación: revisalo antes de reintentar.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_nc_id := v_existing.id;
    update public.invoices
    set status = 'draft'
    where id = v_nc_id and status = 'failed';
    return v_nc_id;
  end if;

  select i.id, i.status, i.channel_id, i.client_id, i.punto_venta, i.concepto,
         i.doc_tipo, i.doc_nro, i.moneda, i.cotizacion
    into v_remito
  from public.invoices i
  where i.id = v_factura.source_remito_id
  for update;
  if v_remito.status <> 'emitted' then
    raise exception 'El remito ya no está emitido: no se puede acreditar.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_blocker := public.billed_remito_blocker(v_remito.id);
  if v_blocker is not null then
    raise exception '%', v_blocker using errcode = '23514', hint = 'jouve_guard';
  end if;

  select sp.numero into v_pos
  from public.sales_points sp
  where sp.channel_id = v_factura.channel_id and sp.is_enabled
  order by sp.numero
  limit 1;

  for v_receipt in
    select r.id, r.receipt_date, r.total_amount, r.currency, r.cotizacion,
           r.punto_venta, r.numero, ra.amount_applied
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
    where ra.invoice_id = v_remito.id
      and r.status = 'issued'
    order by r.receipt_date, r.numero
    for update of r
  loop
    if v_pos is null then
      raise exception 'El canal fiscal no tiene un punto de venta habilitado para recibos.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;

    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'account_id', l.account_id,
                 'amount', l.amount,
                 'reference', l.reference
               )
               order by l.created_at
             ),
             '[]'::jsonb
           )
      into v_lines
    from public.receipt_payment_lines l
    where l.receipt_id = v_receipt.id;

    -- Its treasury movements go with it (handle_receipt_cancellation).
    update public.receipts
    set status = 'canceled',
        canceled_at = now()
    where id = v_receipt.id;

    select coalesce(max(r.numero), 0) + 1 into v_numero
    from public.receipts r
    where r.channel_id = v_factura.channel_id and r.punto_venta = v_pos;

    perform public.create_receipt(
      v_factura.channel_id,
      v_pos,
      v_numero,
      v_factura.client_id,
      v_receipt.receipt_date,
      v_receipt.total_amount,
      v_receipt.currency,
      'Cobro pasado del recibo interno X'
        || lpad(v_receipt.punto_venta::text, 4, '0') || '-'
        || lpad(v_receipt.numero::text, 8, '0')
        || ' al facturar el remito.',
      v_lines,
      jsonb_build_array(
        jsonb_build_object(
          'invoice_id', v_factura.id,
          'amount_applied', v_receipt.amount_applied
        )
      ),
      '[]'::jsonb,
      v_receipt.cotizacion
    );
  end loop;

  v_open := public.invoice_open_amount(v_remito.id);
  if v_open <= 0 then
    return null;
  end if;

  v_motivo := 'Facturado como '
    || coalesce(v_factura.letter, '')
    || lpad(v_factura.punto_venta::text, 4, '0') || '-'
    || lpad(coalesce(v_factura.numero, 0)::text, 8, '0');

  perform set_config('jouve.settling_remito', v_remito.id::text, true);
  insert into public.invoices (
    channel_id, client_id, kind, letter, punto_venta, fecha, concepto,
    doc_tipo, doc_nro, iva_condition_receptor, imp_neto, imp_iva, imp_trib,
    imp_tot_conc, imp_op_ex, imp_total, moneda, cotizacion, status,
    invoice_origin_id, motivo_nc_nd, idempotency_key, created_by
  ) values (
    v_remito.channel_id, v_remito.client_id, 'nc', null, v_remito.punto_venta,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    v_remito.concepto, v_remito.doc_tipo, v_remito.doc_nro, null,
    v_open, 0, 0, 0, 0, v_open, v_remito.moneda, v_remito.cotizacion, 'draft',
    v_remito.id, v_motivo, p_factura_id, v_factura.created_by
  )
  returning id into v_nc_id;
  perform set_config('jouve.settling_remito', '', true);

  insert into public.invoice_items (
    invoice_id, sort_order, description, quantity, unit_price, iva_rate_id,
    line_neto, line_iva, line_total
  ) values (
    v_nc_id, 0, v_motivo, 1, v_open, null, v_open, 0, v_open
  );

  return v_nc_id;
end;
$$;

revoke all on function public.settle_billed_remito(uuid) from public, anon, authenticated;
grant execute on function public.settle_billed_remito(uuid) to service_role;

-- 4. Global search -----------------------------------------------------------------

-- Recreated below in the same transaction; its readers (search_global,
-- refresh_search_index, refresh_search_index_if_dirty) resolve it by name.
-- squawk-ignore ban-drop-view
drop materialized view public.search_index;

create materialized view public.search_index as
  -- Clientes
  select
    'client'::text                                    as entity_type,
    c.id::text                                        as entity_id,
    c.legal_name                                      as title,
    coalesce(c.cuit, '')                              as subtitle,
    coalesce(c.email, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.address, '') as body,
    null::text                                        as channel_id,
    '/clients/' || c.id::text                         as url,
    setweight(to_tsvector('spanish', coalesce(c.legal_name, '')), 'A') ||
      setweight(to_tsvector('spanish', coalesce(c.cuit, '')), 'B') ||
      setweight(to_tsvector('spanish', coalesce(c.email, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.address, '')), 'C') as tsv
  from public.clients c
  where c.is_active = true
  union all
  -- Proveedores
  select 'supplier', s.id::text, s.legal_name, coalesce(s.cuit, ''),
         coalesce(s.email, '') || ' ' || coalesce(s.phone, '') || ' ' || coalesce(s.address, ''),
         null, '/suppliers/' || s.id::text,
         setweight(to_tsvector('spanish', coalesce(s.legal_name, '')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(s.cuit, '')), 'B') ||
           setweight(to_tsvector('spanish', coalesce(s.email, '') || ' ' || coalesce(s.phone, '') || ' ' || coalesce(s.address, '')), 'C')
  from public.suppliers s
  where s.is_active = true
  union all
  -- Comprobantes emitidos
  select 'invoice', i.id::text,
         coalesce(i.letter::text, '') || lpad(i.punto_venta::text, 4, '0') || '-' || lpad(i.numero::text, 8, '0'),
         coalesce(cl.legal_name, ''),
         coalesce(i.cae, '') || ' ' || coalesce(i.doc_nro, ''),
         i.channel_id, '/invoices/' || i.id::text,
         setweight(to_tsvector('simple', coalesce(i.letter::text, '') || lpad(i.punto_venta::text, 4, '0') || '-' || lpad(i.numero::text, 8, '0')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(cl.legal_name, '')), 'B') ||
           setweight(to_tsvector('simple', coalesce(i.cae, '') || ' ' || coalesce(i.doc_nro, '')), 'C')
  from public.invoices i
  left join public.clients cl on cl.id = i.client_id
  where i.status = 'emitted'
  union all
  -- Facturas de compra
  select 'purchase_invoice', p.id::text,
         coalesce(p.letter::text, '') || lpad(p.punto_venta::text, 4, '0') || '-' || lpad(p.numero::text, 8, '0'),
         coalesce(sup.legal_name, ''),
         coalesce(p.cae_proveedor, '') || ' ' || coalesce(sup.cuit, ''),
         p.channel_id, '/purchases/' || p.id::text,
         setweight(to_tsvector('simple', coalesce(p.letter::text, '') || lpad(p.punto_venta::text, 4, '0') || '-' || lpad(p.numero::text, 8, '0')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(sup.legal_name, '')), 'B') ||
           setweight(to_tsvector('simple', coalesce(p.cae_proveedor, '') || ' ' || coalesce(sup.cuit, '')), 'C')
  from public.purchase_invoices p
  left join public.suppliers sup on sup.id = p.supplier_id
  where p.status = 'received'
  union all
  -- Recibos
  select 'receipt', r.id::text,
         'X' || lpad(r.punto_venta::text, 4, '0') || '-' || lpad(r.numero::text, 8, '0'),
         coalesce(cl.legal_name, ''),
         coalesce(r.notes, ''),
         r.channel_id, '/receipts/' || r.id::text,
         setweight(to_tsvector('simple', 'X' || lpad(r.punto_venta::text, 4, '0') || '-' || lpad(r.numero::text, 8, '0')), 'A') ||
           -- The legacy R label, so a receipt printed before the change is still found.
           setweight(to_tsvector('simple', 'R' || lpad(r.punto_venta::text, 4, '0') || '-' || lpad(r.numero::text, 8, '0')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(cl.legal_name, '')), 'B') ||
           setweight(to_tsvector('spanish', coalesce(r.notes, '')), 'C')
  from public.receipts r
  left join public.clients cl on cl.id = r.client_id
  where r.status = 'issued'
  union all
  -- Órdenes de pago
  select 'payment_order', po.id::text,
         'OP' || lpad(po.punto_venta::text, 4, '0') || '-' || lpad(po.numero::text, 8, '0'),
         coalesce(sup.legal_name, ''),
         coalesce(po.notes, ''),
         po.channel_id, '/payment-orders/' || po.id::text,
         setweight(to_tsvector('simple', 'OP' || lpad(po.punto_venta::text, 4, '0') || '-' || lpad(po.numero::text, 8, '0')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(sup.legal_name, '')), 'B') ||
           setweight(to_tsvector('spanish', coalesce(po.notes, '')), 'C')
  from public.payment_orders po
  left join public.suppliers sup on sup.id = po.supplier_id
  where po.status = 'issued'
  union all
  -- Transactions (caja)
  select 'transaction', t.id::text,
         t.kind || ' ' || t.amount::text || ' ' || t.currency,
         coalesce(t.description, ''),
         '',
         t.channel_id,
         '/transactions?account=' || t.account_id::text
           || '&from=' || t.transaction_date::text
           || '&to=' || t.transaction_date::text,
         setweight(to_tsvector('simple', t.kind || ' ' || t.amount::text), 'B') ||
           setweight(to_tsvector('spanish', coalesce(t.description, '')), 'C')
  from public.transactions t
;

-- Unique index requerido para REFRESH CONCURRENTLY. A materialized view
-- created in this transaction has no other writer to block.
-- squawk-ignore require-concurrent-index-creation
create unique index search_index_unique_idx on public.search_index (entity_type, entity_id);
-- squawk-ignore require-concurrent-index-creation
create index search_index_tsv_idx on public.search_index using gin (tsv);

comment on materialized view public.search_index is
  'M.3 FTS global. Refresh on demand vía refresh_search_index() o por trigger en source tables.';

revoke all on public.search_index from anon, authenticated;
