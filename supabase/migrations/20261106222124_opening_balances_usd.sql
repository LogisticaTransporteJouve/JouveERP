SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- «Ajustar saldo» also fixes the dollars (owner's request): an opening
-- balance can carry a dollar target next to the peso one.
--
--   1. supplier_opening_balances and client_opening_balances gain
--      target_balance_usd (null = the dollars are not adjusted) and
--      total_settled_usd (what the dollar FIFO applied).
--   2. apply_supplier_opening_balance, apply_client_opening_balance and
--      apply_client_opening_balance_core take p_target_balance_usd (default
--      null, last). With it, the dollar side works like the peso one: real
--      open of the dollar documents up to the cut-off (facturas and ND −
--      NCs − issued payments/receipts, as each side already counts pesos),
--      and real open − target settled FIFO over the dollar documents, capped
--      by each one's open amount. Without it, the dollar target already set
--      is applied again; with none set, the dollars are not adjusted and
--      their allocations up to the cut-off are kept (pesos are rewritten as
--      today). That keeps the dollar purchases settled by hand in production
--      on 2026-11-06 when a supplier's opening is re-applied in pesos (the
--      ARCA bulk accept does); a dollar target deletes and recomputes them,
--      so nothing is settled twice. The header is upserted instead of
--      deleted, so the kept rows keep their header.
--   3. v_aging_documents: a client's dollar NC with no origin up to its
--      opening date stays inside the opening balance when it has a dollar
--      target, as the peso ones always do (20261106105000). The supplier
--      side counts every NC in the real open and its aging spreads the
--      unlinked ones, in pesos and in dollars alike.
--   4. v_client_account_movements and v_supplier_account_movements list the
--      opening balance once per currency it fixes: the peso row as before,
--      plus a dollar row when it has a dollar target.
--
-- No data change: every existing opening keeps a null dollar target.
--
-- Rollback: older code calls the three RPCs with the arguments it knows
-- (the new one defaults to null, which keeps the dollars as they are), never
-- reads the new columns, and gets the dollar opening row of the statements
-- with currency 'USD', which it books in dollars.

------------------------------------------------------------------------------
-- 1. Dollar target
------------------------------------------------------------------------------

alter table public.supplier_opening_balances
  add column target_balance_usd numeric(15, 2) check (target_balance_usd >= 0),
  add column total_settled_usd  numeric(15, 2) check (total_settled_usd >= 0);

alter table public.client_opening_balances
  add column target_balance_usd numeric(15, 2) check (target_balance_usd >= 0),
  add column total_settled_usd  numeric(15, 2) check (total_settled_usd >= 0);

comment on column public.supplier_opening_balances.target_balance_usd is
  'Deuda real en dólares al opening_date. null = los dólares no se ajustan.';
comment on column public.supplier_opening_balances.total_settled_usd is
  'Dólares imputados a facturas y ND en dólares hasta el corte.';
comment on column public.client_opening_balances.target_balance_usd is
  'Deuda real en dólares al opening_date. null = los dólares no se ajustan.';
comment on column public.client_opening_balances.total_settled_usd is
  'Dólares imputados a facturas y ND en dólares hasta el corte.';

------------------------------------------------------------------------------
-- 2. Client
------------------------------------------------------------------------------

-- Recreated below in the same transaction with a new trailing parameter
-- (default null): the six-argument body goes, so the importer's positional
-- call and older callers resolve to the new one.
-- squawk-ignore ban-drop-function
drop function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid);

create function public.apply_client_opening_balance_core(
  p_client_id          uuid,
  p_opening_date       date,
  p_target_balance     numeric,
  p_notes              text,
  p_user_id            uuid,
  p_import_run_id      uuid,
  p_target_balance_usd numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum_invoices   numeric(15, 2);
  v_sum_ncs        numeric(15, 2);
  v_sum_receipts   numeric(15, 2);
  v_real_open      numeric(15, 2);
  v_to_settle      numeric(15, 2);
  v_remaining      numeric(15, 2);
  v_inv            record;
  v_capacity       numeric(15, 2);
  v_apply          numeric(15, 2);
  v_dollar         boolean;
  v_target_usd     numeric(15, 2);
  v_settled_usd    numeric(15, 2);
begin
  if p_target_balance is null or p_target_balance < 0 then
    raise exception 'El saldo de apertura no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_target_balance_usd < 0 then
    raise exception 'El saldo de apertura en dólares no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- Without a dollar target the one already set (if any) is applied again.
  select ob.target_balance_usd into v_target_usd
    from public.client_opening_balances ob
   where ob.client_id = p_client_id
     for update;
  v_target_usd := coalesce(p_target_balance_usd, v_target_usd);

  if v_target_usd is null then
    -- The dollars are not adjusted: their allocations up to the cut-off stay.
    delete from public.client_opening_balance_allocations a
     using public.invoices c
     where a.client_id = p_client_id
       and c.id = a.invoice_id
       and (coalesce(c.moneda, 'PES') not in ('DOL', 'USD') or c.fecha > p_opening_date);
    select sum(a.amount_applied) into v_settled_usd
      from public.client_opening_balance_allocations a
     where a.client_id = p_client_id;
  else
    v_settled_usd := 0;
    delete from public.client_opening_balance_allocations where client_id = p_client_id;
  end if;

  select coalesce(sum(c.imp_total), 0) into v_sum_invoices
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind in ('factura', 'nd')
    and coalesce(c.moneda, 'PES') not in ('DOL', 'USD')
    and c.fecha <= p_opening_date;

  select coalesce(sum(c.imp_total), 0) into v_sum_ncs
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind = 'nc'
    and c.invoice_origin_id is not null
    and coalesce(c.moneda, 'PES') not in ('DOL', 'USD')
    and c.fecha <= p_opening_date;

  select coalesce(sum(ra.amount_applied), 0) into v_sum_receipts
  from public.receipt_allocations ra
  join public.receipts r on r.id = ra.receipt_id
  join public.invoices  c on c.id = ra.invoice_id
  where r.status = 'issued'
    and r.receipt_date <= p_opening_date
    and c.client_id = p_client_id
    and coalesce(c.moneda, 'PES') not in ('DOL', 'USD')
    and c.fecha <= p_opening_date;

  v_real_open := v_sum_invoices - v_sum_ncs - v_sum_receipts;
  v_to_settle := greatest(v_real_open - p_target_balance, 0);

  insert into public.client_opening_balances (
    client_id, opening_date, target_balance, total_settled,
    target_balance_usd, total_settled_usd, notes, created_by, import_run_id
  ) values (
    p_client_id, p_opening_date, p_target_balance, v_to_settle,
    v_target_usd, v_settled_usd, p_notes, p_user_id, p_import_run_id
  )
  on conflict (client_id) do update set
    opening_date       = excluded.opening_date,
    target_balance     = excluded.target_balance,
    total_settled      = excluded.total_settled,
    target_balance_usd = excluded.target_balance_usd,
    total_settled_usd  = excluded.total_settled_usd,
    notes              = excluded.notes,
    created_by         = excluded.created_by,
    import_run_id      = excluded.import_run_id,
    created_at         = now();

  -- Pesos, then (with a dollar target) dollars: the same FIFO over what
  -- receipts and NCs leave open (invoice_open_amount; this side's
  -- allocations were deleted above).
  foreach v_dollar in array (
    case when v_target_usd is null then array[false] else array[false, true] end
  ) loop
    if v_dollar then
      select coalesce(sum(c.imp_total), 0) into v_sum_invoices
      from public.invoices c
      where c.client_id = p_client_id
        and c.status = 'emitted'
        and c.kind in ('factura', 'nd')
        and coalesce(c.moneda, 'PES') in ('DOL', 'USD')
        and c.fecha <= p_opening_date;

      select coalesce(sum(c.imp_total), 0) into v_sum_ncs
      from public.invoices c
      where c.client_id = p_client_id
        and c.status = 'emitted'
        and c.kind = 'nc'
        and c.invoice_origin_id is not null
        and coalesce(c.moneda, 'PES') in ('DOL', 'USD')
        and c.fecha <= p_opening_date;

      select coalesce(sum(ra.amount_applied), 0) into v_sum_receipts
      from public.receipt_allocations ra
      join public.receipts r on r.id = ra.receipt_id
      join public.invoices  c on c.id = ra.invoice_id
      where r.status = 'issued'
        and r.receipt_date <= p_opening_date
        and c.client_id = p_client_id
        and coalesce(c.moneda, 'PES') in ('DOL', 'USD')
        and c.fecha <= p_opening_date;

      v_real_open := v_sum_invoices - v_sum_ncs - v_sum_receipts;
      v_to_settle := greatest(v_real_open - v_target_usd, 0);
    end if;

    v_remaining := v_to_settle;
    for v_inv in
      select c.id, public.invoice_open_amount(c.id) as capacity
      from public.invoices c
      where c.client_id = p_client_id
        and c.status = 'emitted'
        and c.kind in ('factura', 'nd')
        and (coalesce(c.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
        and c.fecha <= p_opening_date
      order by c.fecha asc, c.numero asc, c.created_at asc
    loop
      exit when v_remaining <= 0;
      v_capacity := greatest(v_inv.capacity, 0);
      if v_capacity = 0 then
        continue;
      end if;
      v_apply := least(v_capacity, v_remaining);
      insert into public.client_opening_balance_allocations (
        client_id, invoice_id, amount_applied
      ) values (
        p_client_id, v_inv.id, v_apply
      );
      v_remaining := v_remaining - v_apply;
    end loop;

    if v_dollar then
      update public.client_opening_balances
         set total_settled_usd = v_to_settle - v_remaining
       where client_id = p_client_id;
    elsif v_remaining > 0 then
      update public.client_opening_balances
         set total_settled = v_to_settle - v_remaining
       where client_id = p_client_id;
    end if;
  end loop;
end;
$$;

comment on function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid, numeric) is
  'Cuerpo de apply_client_opening_balance: reemplaza el saldo inicial del cliente en pesos y, con p_target_balance_usd, en dólares; cada moneda se imputa FIFO a sus facturas y ND hasta el corte, sobre lo que dejan abierto recibos y NC con origen: lo anterior al corte queda en el saldo objetivo. Las NC sin origen hasta el corte quedan dentro del saldo (v_aging_documents no las reparte). Sin p_target_balance_usd se reaplica el objetivo en dólares ya fijado; si no hay, las imputaciones en dólares hasta el corte quedan como estaban. Interna: la llaman el RPC del owner y el importador.';

revoke all on function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid, numeric)
  from public, anon, authenticated;

-- Recreated below in the same transaction with p_target_balance_usd
-- (default null) appended; a call with the old arguments resolves to it.
-- squawk-ignore ban-drop-function
drop function public.apply_client_opening_balance(uuid, date, numeric, text);

create function public.apply_client_opening_balance(
  p_client_id          uuid,
  p_opening_date       date,
  p_target_balance     numeric,
  p_notes              text default null,
  p_target_balance_usd numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.user_has_role(array['owner']) then
    raise exception 'Solo el owner puede ajustar saldos de cliente' using errcode = '42501';
  end if;
  perform public.apply_client_opening_balance_core(
    p_client_id, p_opening_date, p_target_balance, p_notes, auth.uid(), null, p_target_balance_usd
  );
end;
$$;

comment on function public.apply_client_opening_balance(uuid, date, numeric, text, numeric) is
  'Fija/sobrescribe el saldo de apertura del cliente en pesos y, con p_target_balance_usd, en dólares. Solo owner.';

revoke all on function public.apply_client_opening_balance(uuid, date, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.apply_client_opening_balance(uuid, date, numeric, text, numeric) to authenticated;

------------------------------------------------------------------------------
-- 3. Supplier
------------------------------------------------------------------------------

-- Recreated below in the same transaction with p_target_balance_usd
-- (default null) appended; a call with the old arguments resolves to it.
-- squawk-ignore ban-drop-function
drop function public.apply_supplier_opening_balance(uuid, date, numeric, text);

create function public.apply_supplier_opening_balance(
  p_supplier_id        uuid,
  p_opening_date       date,
  p_target_balance     numeric,
  p_notes              text default null,
  p_target_balance_usd numeric default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum_invoices   numeric(15, 2);
  v_sum_ncs        numeric(15, 2);
  v_sum_payments   numeric(15, 2);
  v_to_settle      numeric(15, 2);
  v_remaining      numeric(15, 2);
  v_inv            record;
  v_apply          numeric(15, 2);
  v_dollar         boolean;
  v_target         numeric(15, 2);
  v_target_usd     numeric(15, 2);
  v_settled_usd    numeric(15, 2);
begin
  if not public.user_has_role(array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_target_balance is null or p_target_balance < 0 then
    raise exception 'El saldo de apertura no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_target_balance_usd < 0 then
    raise exception 'El saldo de apertura en dólares no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- Without a dollar target the one already set (if any) is applied again.
  select ob.target_balance_usd into v_target_usd
    from public.supplier_opening_balances ob
   where ob.supplier_id = p_supplier_id
     for update;
  v_target_usd := coalesce(p_target_balance_usd, v_target_usd);

  if v_target_usd is null then
    -- The dollars are not adjusted: their allocations up to the cut-off stay
    -- (also the ones loaded by hand on 2026-11-06).
    delete from public.supplier_opening_balance_allocations a
     using public.purchase_invoices pi
     where a.supplier_id = p_supplier_id
       and pi.id = a.purchase_invoice_id
       and (coalesce(pi.moneda, 'PES') not in ('DOL', 'USD') or pi.fecha > p_opening_date);
    select sum(a.amount_applied) into v_settled_usd
      from public.supplier_opening_balance_allocations a
     where a.supplier_id = p_supplier_id;
  else
    v_settled_usd := 0;
    delete from public.supplier_opening_balance_allocations where supplier_id = p_supplier_id;
  end if;

  -- The header goes first: the allocations reference it
  -- (supplier_opening_balance_allocations_header_fk, not deferrable).
  -- total_settled is set by the peso pass below.
  insert into public.supplier_opening_balances (
    supplier_id, opening_date, target_balance, total_settled,
    target_balance_usd, total_settled_usd, notes, created_by
  ) values (
    p_supplier_id, p_opening_date, p_target_balance, 0,
    v_target_usd, v_settled_usd, p_notes, auth.uid()
  )
  on conflict (supplier_id) do update set
    opening_date       = excluded.opening_date,
    target_balance     = excluded.target_balance,
    total_settled      = excluded.total_settled,
    target_balance_usd = excluded.target_balance_usd,
    total_settled_usd  = excluded.total_settled_usd,
    notes              = excluded.notes,
    created_by         = excluded.created_by,
    created_at         = now();

  -- Pesos, then (with a dollar target) dollars. Real open = facturas and ND
  -- − NCs − issued payment orders, all up to the cut-off and in the pass's
  -- currency; real open − target is settled FIFO from the oldest invoice
  -- over what payment orders and NCs leave open (v_purchase_invoice_open;
  -- this side's allocations were deleted above).
  foreach v_dollar in array (
    case when v_target_usd is null then array[false] else array[false, true] end
  ) loop
    v_target := case when v_dollar then v_target_usd else p_target_balance end;

    select coalesce(sum(pi.imp_total), 0) into v_sum_invoices
    from public.purchase_invoices pi
    where pi.supplier_id = p_supplier_id
      and pi.status = 'received'
      and pi.kind in ('factura', 'nd')
      and (coalesce(pi.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
      and pi.fecha <= p_opening_date;

    select coalesce(sum(pi.imp_total), 0) into v_sum_ncs
    from public.purchase_invoices pi
    where pi.supplier_id = p_supplier_id
      and pi.status = 'received'
      and pi.kind = 'nc'
      and (coalesce(pi.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
      and pi.fecha <= p_opening_date;

    select coalesce(sum(poa.amount_applied), 0) into v_sum_payments
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
    join public.purchase_invoices pi on pi.id = poa.purchase_invoice_id
    where po.status = 'issued'
      and po.payment_date <= p_opening_date
      and pi.supplier_id = p_supplier_id
      and (coalesce(pi.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
      and pi.fecha <= p_opening_date;

    v_to_settle := greatest(v_sum_invoices - v_sum_ncs - v_sum_payments - v_target, 0);

    v_remaining := v_to_settle;
    for v_inv in
      select pi.id, o.open_amount as outstanding
      from public.purchase_invoices pi
      join public.v_purchase_invoice_open o on o.purchase_invoice_id = pi.id
      where pi.supplier_id = p_supplier_id
        and pi.status = 'received'
        and pi.kind in ('factura', 'nd')
        and (coalesce(pi.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
        and pi.fecha <= p_opening_date
        and o.open_amount > 0
      order by pi.fecha asc, pi.numero asc, pi.created_at asc
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_inv.outstanding, v_remaining);
      insert into public.supplier_opening_balance_allocations (
        supplier_id, purchase_invoice_id, amount_applied
      ) values (
        p_supplier_id, v_inv.id, v_apply
      );
      v_remaining := v_remaining - v_apply;
    end loop;

    if v_dollar then
      update public.supplier_opening_balances
         set total_settled_usd = v_to_settle - v_remaining
       where supplier_id = p_supplier_id;
    else
      update public.supplier_opening_balances
         set total_settled = v_to_settle - v_remaining
       where supplier_id = p_supplier_id;
    end if;
  end loop;
end;
$$;

comment on function public.apply_supplier_opening_balance(uuid, date, numeric, text, numeric) is
  'Fija/sobrescribe el saldo de apertura del proveedor en pesos y, con p_target_balance_usd, en dólares. Cada moneda imputa FIFO a sus facturas y ND hasta el corte lo que exceda al saldo real (facturas − NC − órdenes de pago). Sin p_target_balance_usd se reaplica el objetivo en dólares ya fijado; si no hay, las imputaciones en dólares hasta el corte quedan como estaban. Solo owner.';

revoke all on function public.apply_supplier_opening_balance(uuid, date, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.apply_supplier_opening_balance(uuid, date, numeric, text, numeric) to authenticated;

------------------------------------------------------------------------------
-- 4. Client aging: dollar NCs up to a dollar opening stay inside it
------------------------------------------------------------------------------

-- 20261106105000's view; only the unlinked NCs' filter changes.
create or replace view public.v_aging_documents with (security_invoker = on) as
  with docs as (
  SELECT c.id AS invoice_id,
    c.client_id,
    c.fecha,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
    c.imp_total,
    COALESCE(alloc.applied, 0::numeric) + COALESCE(opening.applied, 0::numeric) AS amount_applied,
    c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric) AS open_amount,
    CURRENT_DATE - due.due_date AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - due.due_date) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - due.due_date) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - due.due_date) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    c.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    c.fch_vto_pago AS fch_vto_pago,
    c.moneda AS moneda,
    COALESCE(nc.credited, 0::numeric) AS amount_credited_by_nc,
    'invoice'::text AS document_type,
    c.id AS document_id,
    NULL::text AS check_number,
    due.due_date
   FROM invoices c
     JOIN invoicing_channels ch ON ch.id = c.channel_id
     CROSS JOIN LATERAL ( SELECT public.invoice_effective_due_date(c.fecha, c.fch_vto_pago) AS due_date) due
     LEFT JOIN ( SELECT ra.invoice_id,
            sum(ra.amount_applied) AS applied
           FROM receipt_allocations ra
             JOIN receipts r ON r.id = ra.receipt_id
          WHERE r.status = 'issued'::text
          GROUP BY ra.invoice_id) alloc ON alloc.invoice_id = c.id
     LEFT JOIN ( SELECT client_opening_balance_allocations.invoice_id,
            client_opening_balance_allocations.amount_applied AS applied
           FROM client_opening_balance_allocations) opening ON opening.invoice_id = c.id
     LEFT JOIN ( SELECT n.invoice_origin_id,
            sum(n.imp_total) AS credited
           FROM invoices n
          WHERE n.kind = 'nc'::text AND n.status = 'emitted'::text AND n.invoice_origin_id IS NOT NULL
          GROUP BY n.invoice_origin_id) nc ON nc.invoice_origin_id = c.id
  WHERE c.status = 'emitted'::text AND (c.kind = ANY (ARRAY['factura'::text, 'nd'::text])) AND (c.imp_total - COALESCE(alloc.applied, 0::numeric) - COALESCE(opening.applied, 0::numeric) - COALESCE(nc.credited, 0::numeric)) > 0::numeric
  UNION ALL
  SELECT NULL::uuid AS invoice_id,
    o.client_id,
    o.rejected_on AS fecha,
    'rejected_check'::text AS kind,
    NULL::character(1) AS letter,
    o.punto_venta,
    o.numero,
    o.amount::numeric(15,2) AS imp_total,
    o.amount_settled AS amount_applied,
    o.open_amount,
    CURRENT_DATE - o.rejected_on AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - o.rejected_on) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - o.rejected_on) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - o.rejected_on) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    o.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    o.rejected_on AS fch_vto_pago,
    CASE WHEN o.currency = 'USD' THEN 'DOL'::text ELSE 'PES'::text END AS moneda,
    0::numeric AS amount_credited_by_nc,
    'rejected_check'::text AS document_type,
    o.check_id AS document_id,
    o.check_number,
    o.rejected_on AS due_date
   FROM v_rejected_check_open o
     JOIN invoicing_channels ch ON ch.id = o.channel_id
  WHERE o.open_amount > 0::numeric
  ),
  unlinked AS (
  SELECT n.client_id,
    n.channel_id,
    CASE WHEN COALESCE(n.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END AS currency,
    sum(n.imp_total) AS credit
   FROM invoices n
  WHERE n.kind = 'nc'::text AND n.status = 'emitted'::text AND n.invoice_origin_id IS NULL
    -- An NC up to a client's opening date is inside its opening balance: in
    -- pesos always, in dollars when the opening has a dollar target.
    AND NOT EXISTS (
      SELECT 1 FROM client_opening_balances ob
       WHERE ob.client_id = n.client_id AND n.fecha <= ob.opening_date
         AND (COALESCE(n.moneda, 'PES') NOT IN ('DOL', 'USD') OR ob.target_balance_usd IS NOT NULL))
  GROUP BY n.client_id, n.channel_id, (CASE WHEN COALESCE(n.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END)
  ),
  spread AS (
  SELECT d.*,
    LEAST(d.open_amount, GREATEST(COALESCE(u.credit, 0::numeric) - COALESCE(sum(d.open_amount) OVER (
      PARTITION BY d.client_id, d.channel_id, (CASE WHEN COALESCE(d.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END)
      ORDER BY d.days_overdue DESC, d.fecha, d.document_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric), 0::numeric)) AS credited_unlinked
   FROM docs d
     LEFT JOIN unlinked u ON u.client_id = d.client_id AND u.channel_id = d.channel_id
       AND u.currency = (CASE WHEN COALESCE(d.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END)
  )
  SELECT s.invoice_id,
    s.client_id,
    s.fecha,
    s.kind,
    s.letter,
    s.punto_venta,
    s.numero,
    s.imp_total,
    s.amount_applied,
    s.open_amount - s.credited_unlinked AS open_amount,
    s.days_overdue,
    s.bucket,
    s.channel_id,
    s.channel_name,
    s.channel_is_fiscal,
    s.fch_vto_pago,
    s.moneda,
    s.amount_credited_by_nc,
    s.document_type,
    s.document_id,
    s.check_number,
    s.credited_unlinked AS amount_credited_unlinked,
    s.due_date
   FROM spread s
  WHERE s.open_amount - s.credited_unlinked > 0::numeric;

comment on view public.v_aging_documents is
  'Comprobantes (factura/ND) y cheques rechazados de clientes con saldo abierto. open_amount = imp_total − recibos − saldo inicial − NC con origen − la parte del crédito de las NC sin origen del cliente (mismo canal y moneda, de la más vencida a la más nueva; las NC hasta la fecha de su saldo inicial no, quedan dentro de ese saldo: en pesos siempre, en dólares si tiene objetivo en dólares) que tomó el documento (amount_credited_unlinked). due_date = invoice_effective_due_date (el rechazo para un cheque); days_overdue y bucket cuentan desde ahí.';

------------------------------------------------------------------------------
-- 5. Statements: one opening row per currency
------------------------------------------------------------------------------

-- 20261102220000's and 20261104101400's views; only the opening rows change.

create or replace view public.v_client_account_movements with (security_invoker = on) as
  select
    'invoice'::text                      as source_type,
    c.id                                 as source_id,
    c.client_id,
    c.fecha                              as movement_date,
    c.created_at,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
    case when c.kind = 'nc' then -1::numeric * c.imp_total else c.imp_total end as signed_amount,
    c.imp_total                          as gross_amount,
    c.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    c.status,
    case when coalesce(c.moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end as currency
  from public.invoices c
  join public.invoicing_channels ch on ch.id = c.channel_id
  where c.status = 'emitted'
  union all
  select
    'receipt'::text                      as source_type,
    r.id                                 as source_id,
    r.client_id,
    r.receipt_date                       as movement_date,
    r.created_at,
    'receipt'::text                      as kind,
    null::text                           as letter,
    r.punto_venta,
    r.numero,
    -1::numeric * r.total_amount         as signed_amount,
    r.total_amount                       as gross_amount,
    r.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    r.status,
    r.currency
  from public.receipts r
  join public.invoicing_channels ch on ch.id = r.channel_id
  where r.status = 'issued'
  union all
  -- The opening balance: one row per currency it fixes (pesos always,
  -- dollars when it has a dollar target).
  select
    'opening_balance'::text              as source_type,
    null::uuid                           as source_id,
    ob.client_id,
    ob.opening_date                      as movement_date,
    ob.created_at,
    'opening_balance'::text              as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    t.target                             as signed_amount,
    t.target                             as gross_amount,
    null::text                           as channel_id,
    null::boolean                        as channel_is_fiscal,
    null::text                           as channel_name,
    'issued'::text                       as status,
    t.currency                           as currency
  from public.client_opening_balances ob
  cross join lateral (values
    ('ARS'::text, ob.target_balance),
    ('USD'::text, ob.target_balance_usd)
  ) t (currency, target)
  where t.target is not null
  union all
  -- A check of an issued receipt that bounced: the client owes it again. The
  -- receipt's allocations stay (the invoice reads paid); this row puts the
  -- debt back in the running balance. A receipt that settles it credits the
  -- balance like any receipt.
  select
    'rejected_check'::text               as source_type,
    k.id                                 as source_id,
    r.client_id,
    coalesce(rej.event_date, k.updated_at::date) as movement_date,
    coalesce(rej.created_at, k.updated_at)       as created_at,
    'rejected_check'::text               as kind,
    null::text                           as letter,
    r.punto_venta,
    r.numero,
    k.amount                             as signed_amount,
    k.amount                             as gross_amount,
    r.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency
  from public.checks k
  join public.receipts r on r.id = k.source_receipt_id
  join public.invoicing_channels ch on ch.id = r.channel_id
  left join lateral (
    select m.event_date, m.created_at
      from public.check_movements m
     where m.check_id = k.id and m.event = 'rejected'
     order by m.created_at desc, m.id desc
     limit 1
  ) rej on true
  where k.status = 'rechazado'
    and r.status = 'issued'
  union all
  -- A check the client handed over without a receipt (loaded by hand): a
  -- payment on account once it is in the cartera (it has a channel).
  select
    'manual_check'::text                 as source_type,
    k.id                                 as source_id,
    k.source_client_id                   as client_id,
    k.issue_date                         as movement_date,
    k.created_at,
    'manual_check'::text                 as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    -1::numeric * k.amount               as signed_amount,
    k.amount                             as gross_amount,
    k.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency
  from public.checks k
  join public.invoicing_channels ch on ch.id = k.channel_id
  where k.source_kind = 'manual'
    and k.source_client_id is not null
  union all
  -- That check bounced: the client owes it again.
  select
    'rejected_check'::text               as source_type,
    k.id                                 as source_id,
    k.source_client_id                   as client_id,
    coalesce(rej.event_date, k.updated_at::date) as movement_date,
    coalesce(rej.created_at, k.updated_at)       as created_at,
    'rejected_check'::text               as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    k.amount                             as signed_amount,
    k.amount                             as gross_amount,
    k.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency
  from public.checks k
  join public.invoicing_channels ch on ch.id = k.channel_id
  left join lateral (
    select m.event_date, m.created_at
      from public.check_movements m
     where m.check_id = k.id and m.event = 'rejected'
     order by m.created_at desc, m.id desc
     limit 1
  ) rej on true
  where k.source_kind = 'manual'
    and k.source_client_id is not null
    and k.status = 'rechazado';

create or replace view public.v_supplier_account_movements with (security_invoker = on) as
  select
    'purchase_invoice'::text as source_type,
    pi.id as source_id,
    pi.supplier_id,
    pi.fecha as movement_date,
    pi.created_at,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    case when pi.kind = 'nc' then -1::numeric * pi.imp_total else pi.imp_total end as signed_amount,
    pi.imp_total as gross_amount,
    pi.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    pi.status,
    case when coalesce(pi.moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end as currency
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.status = 'received'
  union all
  select
    'payment_order'::text as source_type,
    po.id as source_id,
    po.supplier_id,
    po.payment_date as movement_date,
    po.created_at,
    'payment_order'::text as kind,
    null::text as letter,
    po.punto_venta,
    po.numero,
    -1::numeric * po.total_amount as signed_amount,
    po.total_amount as gross_amount,
    po.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    po.status,
    po.currency
  from public.payment_orders po
  join public.invoicing_channels ch on ch.id = po.channel_id
  where po.status = 'issued'
  union all
  -- The opening balance: one row per currency it fixes (pesos always,
  -- dollars when it has a dollar target).
  select
    'opening_balance'::text as source_type,
    null::uuid as source_id,
    ob.supplier_id,
    ob.opening_date as movement_date,
    ob.created_at,
    'opening_balance'::text as kind,
    null::text as letter,
    null::integer as punto_venta,
    null::integer as numero,
    t.target as signed_amount,
    t.target as gross_amount,
    null::text as channel_id,
    null::boolean as channel_is_fiscal,
    null::text as channel_name,
    'issued'::text as status,
    t.currency as currency
  from public.supplier_opening_balances ob
  cross join lateral (values
    ('ARS'::text, ob.target_balance),
    ('USD'::text, ob.target_balance_usd)
  ) t (currency, target)
  where t.target is not null
  union all
  -- A check delivered by an issued order that bounced: we owe it again.
  -- Numbered with the order that delivered it.
  select
    'rejected_check'::text as source_type,
    o.check_id as source_id,
    o.supplier_id,
    o.rejected_on as movement_date,
    o.rejected_recorded_at as created_at,
    'rejected_check'::text as kind,
    null::text as letter,
    o.punto_venta,
    o.numero,
    o.amount as signed_amount,
    o.amount as gross_amount,
    o.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    'issued'::text as status,
    o.currency
  from public.v_supplier_rejected_check_open o
  join public.invoicing_channels ch on ch.id = o.channel_id;
