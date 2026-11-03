SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Diferencia de cambio on USD receivables and payables (audit w1-s1 F3).
--
-- A USD factura or ND debits clientes at its own rate; the USD receipt that
-- collects it credited clientes at the receipt's rate, so a rate change left
-- the difference in clientes forever while the aging (in dollars) said 0.
-- Same for a USD purchase paid by a USD payment order and proveedores.
--
--   1. COA: an active result account takes the role diferencia_cambio: the
--      first active leaf account named "diferencia(s) de cambio" with no role, or
--      a new 4.2.x "Diferencias de cambio" (ingresos financieros; a loss
--      posts on its debit side). With no active account holding the role,
--      every builder below posts exactly as before.
--   2. usd_booking_rate(cotizacion, date): the rate a USD document is booked
--      at when it has one (its cotización, else the BCRA rate of its date),
--      NULL when unknown. The fallback of the builders without the final 1.
--   3. build_receipt_journal_lines (20261031205518, every case kept): for a
--      USD receipt, the part applied to each USD factura/ND credits clientes
--      at that comprobante's rate and the difference against the receipt's
--      rate goes to diferencia_cambio (credit = gain, debit = loss). What is
--      not applied (a cuenta) and what settles a rejected check stay at the
--      receipt's rate, as before. With equal rates, or an unknown one, the
--      lines are exactly the old ones.
--   4. build_payment_order_journal_lines (20261031203102, every case kept):
--      the mirror for proveedores (paying more pesos than booked = loss).
--   4b. build_invoice_journal_lines (20261031180534, every case kept): an NC
--      against a USD factura/ND credits clientes at the origin's rate; the
--      difference against the NC's own rate goes to diferencia_cambio.
--   5. The entry is the document's own, so it follows the document: posted
--      at insert, re-posted on edit (only when the lines change), reversed on
--      cancel, refused in a closed period. Applying or un-applying a USD
--      receipt or payment order later (allocate_receipt, the a cuenta flow)
--      re-posts it at commit through a deferred trigger on its allocations;
--      changing the rate, currency or date of a USD purchase re-posts the
--      USD payment orders applied to it (only when one of the three really
--      changes). ARS documents are never re-posted.
--   6. Backfill: issued USD receipts and payment orders applied at another
--      rate, and emitted USD NCs against an origin at another rate, are
--      re-posted; one in a closed period (or with a line that can't be
--      posted) keeps its entry and is counted in a NOTICE.
--
-- build_transaction_journal_lines is not changed (receipt and payment order
-- movements post nothing of their own). Not covered: purchase NCs (their
-- proveedores line stays at their own rate) and NCs with no origin, whose
-- origin rate is unknown (docs/pendientes.md).
--
-- Rollback: the builders and triggers stay with the schema; older code never
-- reads the role, the account or the helper.

------------------------------------------------------------------------------
-- 1. Chart of accounts
------------------------------------------------------------------------------

do $$
declare
  v_parent uuid;
  v_code   text;
begin
  if exists (
    select 1 from public.chart_of_accounts where system_role = 'diferencia_cambio' and is_active
  ) then
    return;
  end if;

  update public.chart_of_accounts
     set system_role = 'diferencia_cambio'
   where id = (
     select c.id from public.chart_of_accounts c
      where c.is_active
        and c.system_role is null
        and c.account_type in ('resultado_positivo', 'resultado_negativo')
        and c.name ~* '^diferencias? de cambio'
        and not exists (select 1 from public.chart_of_accounts ch
                         where ch.parent_id = c.id and ch.is_active)
      order by c.code
      limit 1
   );
  if found then
    return;
  end if;

  -- With no 4.2 the role stays unassigned and the builders post as before
  -- (they only split the difference out when an active account holds it).
  select id into v_parent from public.chart_of_accounts where code = '4.2';
  if v_parent is null then
    raise notice 'diferencia de cambio: falta la cuenta 4.2 (Ingresos financieros); asigná el rol diferencia_cambio a mano';
    return;
  end if;
  select '4.2.' || (coalesce(max(substring(code from '^4\.2\.([0-9]+)$')::int), 0) + 1)
    into v_code
    from public.chart_of_accounts
   where code ~ '^4\.2\.[0-9]+$';
  insert into public.chart_of_accounts (parent_id, code, name, level, account_type, eerr_category, system_role)
  values (v_parent, v_code, 'Diferencias de cambio', 3, 'resultado_positivo', 'ingresos_financieros', 'diferencia_cambio');
end;
$$;

------------------------------------------------------------------------------
-- 2. Booking rate
------------------------------------------------------------------------------

create function public.usd_booking_rate(p_cotizacion numeric, p_date date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select nullif(coalesce(nullif(p_cotizacion, 0), public.get_exchange_rate('USD', p_date)), 1)
$$;

comment on function public.usd_booking_rate(numeric, date) is
  'Cotización con la que se asienta un documento en dólares: la suya o la del BCRA de su fecha; NULL si no se conoce. Interna (builders de asientos).';

revoke all on function public.usd_booking_rate(numeric, date) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 3. Receipts
------------------------------------------------------------------------------

create or replace function public.build_receipt_journal_lines(p_receipt public.receipts, p_description text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lines   jsonb := '[]'::jsonb;
  v_line    record;
  v_role    public.coa_system_role;
  v_rate    numeric := case
    when p_receipt.currency = 'USD' then coalesce(
      nullif(p_receipt.cotizacion, 0),
      public.get_exchange_rate('USD', p_receipt.receipt_date),
      1
    )
    else 1
  end;
  v_amount  numeric;
  v_client  numeric := 0;
  v_rej     numeric;
  v_fx      numeric := 0;
  v_credit  numeric;
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
    v_amount := round(v_line.amount * v_rate, 2);
    v_client := v_client + v_amount;
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      'debit', v_amount,
      'description', p_description || ' — ' || v_line.account_name
    );
  end loop;

  for v_line in
    select rr.kind, rr.tax_type, rr.amount
      from public.receipt_retentions rr
     where rr.receipt_id = p_receipt.id
     order by rr.created_at, rr.id
  loop
    v_amount := round(v_line.amount * v_rate, 2);
    v_client := v_client + v_amount;
    v_lines := v_lines || jsonb_build_object(
      'system_role',
        case when v_line.kind = 'percepcion' and v_line.tax_type = 'iibb'
             then 'percepciones_iibb_pagadas' else 'retenciones_pagadas' end,
      'debit', v_amount,
      'description', p_description || ' — ' ||
        case when v_line.kind = 'percepcion' then 'percepción ' else 'retención ' end ||
        v_line.tax_type
    );
  end loop;

  -- Capped at the client line: converted once, the settlement can round a
  -- cent past the sum of the rounded debits, and the entry must balance.
  select least(round(coalesce(sum(a.amount_applied), 0) * v_rate, 2), v_client)
    into v_rej
    from public.receipt_rejected_check_allocations a
   where a.receipt_id = p_receipt.id;
  if v_rej > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'cheques_rechazados',
      'credit', v_rej,
      'description', p_description || ' — cheque rechazado'
    );
  end if;

  -- What each applied USD comprobante takes off clientes at its own rate,
  -- against the receipt's rate. Only when both rates are known and an
  -- active account holds the role.
  if p_receipt.currency = 'USD'
     and public.usd_booking_rate(p_receipt.cotizacion, p_receipt.receipt_date) is not null
     and exists (select 1 from public.chart_of_accounts
                  where system_role = 'diferencia_cambio' and is_active) then
    select coalesce(sum(
             round(ra.amount_applied * v_rate, 2)
             - round(ra.amount_applied * public.usd_booking_rate(i.cotizacion, i.fecha), 2)
           ), 0)
      into v_fx
      from public.receipt_allocations ra
      join public.invoices i on i.id = ra.invoice_id
     where ra.receipt_id = p_receipt.id
       and coalesce(i.moneda, 'PES') in ('DOL', 'USD')
       and public.usd_booking_rate(i.cotizacion, i.fecha) is not null;
  end if;

  v_credit := v_client - v_rej - v_fx;
  if v_credit > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'clientes',
      'credit', v_credit,
      'description', p_description || ' — cliente'
    );
  elsif v_credit < 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'clientes',
      'debit', -v_credit,
      'description', p_description || ' — cliente'
    );
  end if;
  if v_fx > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'diferencia_cambio',
      'credit', v_fx,
      'description', p_description || ' — diferencia de cambio'
    );
  elsif v_fx < 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'diferencia_cambio',
      'debit', -v_fx,
      'description', p_description || ' — diferencia de cambio'
    );
  end if;
  return v_lines;
end;
$$;

revoke all on function public.build_receipt_journal_lines(public.receipts, text) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 4. Payment orders
------------------------------------------------------------------------------

create or replace function public.build_payment_order_journal_lines(p_payment_order public.payment_orders, p_description text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lines    jsonb := '[]'::jsonb;
  v_line     record;
  v_role     public.coa_system_role;
  v_rate     numeric := case
    when p_payment_order.currency = 'USD' then coalesce(
      nullif(p_payment_order.cotizacion, 0),
      public.get_exchange_rate('USD', p_payment_order.payment_date),
      1
    )
    else 1
  end;
  v_amount   numeric;
  v_supplier numeric := 0;
  v_fx       numeric := 0;
  v_debit    numeric;
begin
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
    v_amount := round(v_line.amount * v_rate, 2);
    v_supplier := v_supplier + v_amount;
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      'credit', v_amount,
      'description', p_description || ' — ' || v_line.account_name
    );
  end loop;

  -- What each paid USD purchase takes off proveedores at its own rate,
  -- against the payment order's rate (paying more pesos = loss). Only when
  -- both rates are known and an active account holds the role.
  if p_payment_order.currency = 'USD'
     and public.usd_booking_rate(p_payment_order.cotizacion, p_payment_order.payment_date) is not null
     and exists (select 1 from public.chart_of_accounts
                  where system_role = 'diferencia_cambio' and is_active) then
    select coalesce(sum(
             round(poa.amount_applied * v_rate, 2)
             - round(poa.amount_applied * public.usd_booking_rate(pi.cotizacion, pi.fecha), 2)
           ), 0)
      into v_fx
      from public.payment_order_allocations poa
      join public.purchase_invoices pi on pi.id = poa.purchase_invoice_id
     where poa.payment_order_id = p_payment_order.id
       and coalesce(pi.moneda, 'PES') in ('DOL', 'USD')
       and public.usd_booking_rate(pi.cotizacion, pi.fecha) is not null;
  end if;

  v_debit := v_supplier - v_fx;
  if v_fx > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'diferencia_cambio',
      'debit', v_fx,
      'description', p_description || ' — diferencia de cambio'
    );
  elsif v_fx < 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'diferencia_cambio',
      'credit', -v_fx,
      'description', p_description || ' — diferencia de cambio'
    );
  end if;

  return jsonb_build_array(jsonb_build_object(
    'system_role', 'proveedores',
    case when v_debit < 0 then 'credit' else 'debit' end, abs(v_debit),
    'description', p_description || ' — proveedor'
  )) || v_lines;
end;
$$;

revoke all on function public.build_payment_order_journal_lines(public.payment_orders, text) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 4b. Credit notes against a USD comprobante
------------------------------------------------------------------------------

-- 20261031180534, every case kept. An NC against a USD factura/ND takes
-- clientes off at the origin's rate (what the aging, in dollars, says it
-- credits) and the difference against its own rate goes to
-- diferencia_cambio; ventas, IVA and percepciones stay at the NC's own rate.
-- An NC with no origin, or with an unknown rate on either side, posts as
-- before. The origin is emitted, so its rate and date are frozen
-- (check_invoice_immutability) and the entry does not need a re-post trigger.
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
begin
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

------------------------------------------------------------------------------
-- 5. Re-post when what the difference reads changes
------------------------------------------------------------------------------

-- A USD receipt's or payment order's entry reads its allocations, and a USD
-- payment order's entry reads the rate of the purchases it pays. Deferred, so
-- it runs once the RPC wrote everything; repost_journal compares first and
-- only replaces an entry whose lines changed (a closed period refuses that).
create function public.repost_usd_settlement_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'receipt_allocations' then
    for v_id in
      select r.id from public.receipts r
       where r.currency = 'USD'
         and r.id in (
           select (to_jsonb(old) ->> 'receipt_id')::uuid
           union
           select (to_jsonb(new) ->> 'receipt_id')::uuid)
    loop
      perform public.repost_journal('receipts', v_id);
    end loop;
  elsif tg_table_name = 'payment_order_allocations' then
    for v_id in
      select po.id from public.payment_orders po
       where po.currency = 'USD'
         and po.id in (
           select (to_jsonb(old) ->> 'payment_order_id')::uuid
           union
           select (to_jsonb(new) ->> 'payment_order_id')::uuid)
    loop
      perform public.repost_journal('payment_orders', v_id);
    end loop;
  elsif tg_table_name = 'purchase_invoices' then
    for v_id in
      select distinct po.id
        from public.payment_order_allocations poa
        join public.payment_orders po on po.id = poa.payment_order_id
       where poa.purchase_invoice_id = new.id
         and po.currency = 'USD'
         and po.status = 'issued'
    loop
      perform public.repost_journal('payment_orders', v_id);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.repost_usd_settlement_journal() from public, anon, authenticated;

create constraint trigger receipt_allocations_repost_usd_journal
  after insert or update or delete on public.receipt_allocations
  deferrable initially deferred
  for each row execute function public.repost_usd_settlement_journal();

create constraint trigger payment_order_allocations_repost_usd_journal
  after insert or update or delete on public.payment_order_allocations
  deferrable initially deferred
  for each row execute function public.repost_usd_settlement_journal();

create constraint trigger purchase_invoices_repost_usd_payments
  after update of moneda, cotizacion, fecha on public.purchase_invoices
  deferrable initially deferred
  for each row
  when (old.moneda is distinct from new.moneda
        or old.cotizacion is distinct from new.cotizacion
        or old.fecha is distinct from new.fecha)
  execute function public.repost_usd_settlement_journal();

------------------------------------------------------------------------------
-- 6. Backfill
------------------------------------------------------------------------------

do $$
declare
  v_doc     record;
  v_skipped int := 0;
begin
  for v_doc in
    select distinct 'receipts'::text as src, r.id
      from public.receipts r
      join public.receipt_allocations ra on ra.receipt_id = r.id
      join public.invoices i on i.id = ra.invoice_id
     where r.status = 'issued'
       and r.currency = 'USD'
       and coalesce(i.moneda, 'PES') in ('DOL', 'USD')
       and public.usd_booking_rate(i.cotizacion, i.fecha)
           is distinct from public.usd_booking_rate(r.cotizacion, r.receipt_date)
    union
    select distinct 'payment_orders', po.id
      from public.payment_orders po
      join public.payment_order_allocations poa on poa.payment_order_id = po.id
      join public.purchase_invoices pi on pi.id = poa.purchase_invoice_id
     where po.status = 'issued'
       and po.currency = 'USD'
       and coalesce(pi.moneda, 'PES') in ('DOL', 'USD')
       and public.usd_booking_rate(pi.cotizacion, pi.fecha)
           is distinct from public.usd_booking_rate(po.cotizacion, po.payment_date)
    union
    select distinct 'invoices', n.id
      from public.invoices n
      join public.invoices o on o.id = n.invoice_origin_id
     where n.kind = 'nc'
       and n.status = 'emitted'
       and coalesce(n.moneda, 'PES') <> 'PES'
       and coalesce(o.moneda, 'PES') <> 'PES'
       and public.usd_booking_rate(o.cotizacion, o.fecha)
           is distinct from public.usd_booking_rate(n.cotizacion, n.fecha)
  loop
    begin
      perform public.repost_journal(v_doc.src, v_doc.id);
    -- 55006: closed period. 23514: a line of the document can't be posted
    -- (an account with no COA role); its entry was already what it is.
    exception when sqlstate '55006' or sqlstate '23514' then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  if v_skipped > 0 then
    raise notice 'diferencia de cambio: % documento(s) conservan su asiento (período cerrado o línea sin cuenta contable)', v_skipped;
  end if;
end;
$$;
