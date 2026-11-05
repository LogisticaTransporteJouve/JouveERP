SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- An opening balance closes everything up to its date: facturas, ND and NC
-- (owner's rule: «si se ajusta a 0, es 0 de ahí para atrás»).
--
--   1. v_aging_documents (same columns): the client's peso NCs with no
--      origin dated up to its opening date no longer enter the spread of
--      unlinked credit. The opening balance already counts them; spread
--      again, their credit fell on the first open invoices after the cut-off
--      (a client adjusted to 0 at 1/11 showed November invoices «Pagada»).
--      USD NCs still spread: the opening balance is in pesos.
--   2. apply_client_opening_balance_core: the real open subtracts only NCs
--      with an origin (those already lower each invoice's open amount), so
--      what is left open up to the cut-off is exactly the target. Before,
--      unlinked NCs were subtracted here too and their credit was left for
--      the view's spread.
--
-- No data change: every opening balance in production was applied on 1/11
-- with the earlier core, which settled everything to the target, so the
-- documents up to the cut-off stay as they are.
--
-- Rollback: older code reads the same columns and calls the same RPC.

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
    CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha) AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha)) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha)) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - COALESCE(c.fch_vto_pago, c.fecha)) <= 90 THEN '60_90'::text
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
    NULL::text AS check_number
   FROM invoices c
     JOIN invoicing_channels ch ON ch.id = c.channel_id
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
    o.check_number
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
    -- A peso NC up to a client's opening date is inside its opening balance.
    AND NOT (COALESCE(n.moneda, 'PES') NOT IN ('DOL', 'USD') AND EXISTS (
      SELECT 1 FROM client_opening_balances ob
       WHERE ob.client_id = n.client_id AND n.fecha <= ob.opening_date))
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
    s.credited_unlinked AS amount_credited_unlinked
   FROM spread s
  WHERE s.open_amount - s.credited_unlinked > 0::numeric;

comment on view public.v_aging_documents is
  'Comprobantes (factura/ND) y cheques rechazados de clientes con saldo abierto. open_amount = imp_total − recibos − saldo inicial − NC con origen − la parte del crédito de las NC sin origen del cliente (mismo canal y moneda, de la más vencida a la más nueva; las NC en pesos hasta la fecha de su saldo inicial no, quedan dentro de ese saldo) que tomó el documento (amount_credited_unlinked).';


create or replace function public.apply_client_opening_balance_core(
  p_client_id      uuid,
  p_opening_date   date,
  p_target_balance numeric,
  p_notes          text,
  p_user_id        uuid,
  p_import_run_id  uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum_invoices   numeric(14, 2);
  v_sum_ncs        numeric(14, 2);
  v_sum_receipts   numeric(14, 2);
  v_real_open      numeric(14, 2);
  v_to_settle      numeric(14, 2);
  v_remaining      numeric(14, 2);
  v_inv            record;
  v_capacity       numeric(14, 2);
  v_apply          numeric(14, 2);
begin
  if p_target_balance is null or p_target_balance < 0 then
    raise exception 'El saldo de apertura no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  delete from public.client_opening_balance_allocations where client_id = p_client_id;
  delete from public.client_opening_balances where client_id = p_client_id;

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
    client_id, opening_date, target_balance, total_settled, notes, created_by, import_run_id
  ) values (
    p_client_id, p_opening_date, p_target_balance, v_to_settle, p_notes, p_user_id, p_import_run_id
  );

  if v_to_settle = 0 then
    return;
  end if;

  -- The client's allocations were deleted above, so invoice_open_amount is
  -- what receipts and NCs leave open.
  v_remaining := v_to_settle;
  for v_inv in
    select c.id, public.invoice_open_amount(c.id) as capacity
    from public.invoices c
    where c.client_id = p_client_id
      and c.status = 'emitted'
      and c.kind in ('factura', 'nd')
      and coalesce(c.moneda, 'PES') not in ('DOL', 'USD')
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

  if v_remaining > 0 then
    update public.client_opening_balances
       set total_settled = v_to_settle - v_remaining
     where client_id = p_client_id;
  end if;
end;
$$;

comment on function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid) is
  'Cuerpo de apply_client_opening_balance: reemplaza el saldo inicial del cliente (en pesos) y lo imputa FIFO a facturas y ND en pesos hasta el corte, sobre lo que dejan abierto recibos y NC con origen: lo anterior al corte queda en el saldo objetivo. Las NC sin origen hasta el corte quedan dentro del saldo (v_aging_documents no las reparte). Interna: la llaman el RPC del owner y el importador.';

revoke all on function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid)
  from public, anon, authenticated;
