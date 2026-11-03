SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Opening balances settle what is really open at the cut-off (audit w1-s2 F2
-- and F3). Same signatures; no table changes.
--
--   1. apply_client_opening_balance_core (20261103140100): the opening
--      balance is in pesos (v_client_account_movements books it as ARS), so
--      USD comprobantes and their receipts no longer enter the sums or the
--      FIFO. The FIFO capacity of each invoice is invoice_open_amount (what
--      receipts and NCs against it, drafts included, leave open), so an
--      invoice already credited by an NC no longer takes the settlement that
--      belongs to the next one.
--   2. apply_supplier_opening_balance (20260514221909, search_path fixed in
--      20261031204719): mirror of the client. Real open = facturas and ND −
--      NCs − issued payment orders, all up to the cut-off and in pesos; it
--      settles real open − target, never less than 0. The FIFO capacity is
--      v_purchase_invoice_open (payment orders and NCs). Before, NCs and
--      payments were ignored, so a supplier already paid in part kept a lower
--      aging than its target. The header is written before its allocations,
--      which reference it (the old body wrote it last, so any balance that
--      had something to settle failed on that foreign key).
--
-- Existing opening balances are not recomputed: the owner re-applies one to
-- recompute it (re-applying replaces it).
--
-- Rollback: older code calls the same RPCs with the same arguments.

------------------------------------------------------------------------------
-- 1. Client
------------------------------------------------------------------------------

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
end;
$$;

comment on function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid) is
  'Cuerpo de apply_client_opening_balance: reemplaza el saldo inicial del cliente (en pesos) y lo imputa FIFO a facturas y ND en pesos hasta el corte, sobre lo que dejan abierto recibos y NC. Interna: la llaman el RPC del owner y el importador.';

revoke all on function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid)
  from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2. Supplier
------------------------------------------------------------------------------

create or replace function public.apply_supplier_opening_balance(
  p_supplier_id    uuid,
  p_opening_date   date,
  p_target_balance numeric,
  p_notes          text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum_invoices   numeric(14, 2);
  v_sum_ncs        numeric(14, 2);
  v_sum_payments   numeric(14, 2);
  v_to_settle      numeric(14, 2);
  v_remaining      numeric(14, 2);
  v_inv            record;
  v_apply          numeric(14, 2);
begin
  if not public.user_has_role(array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_target_balance is null or p_target_balance < 0 then
    raise exception 'El saldo de apertura no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- Cascades to supplier_opening_balance_allocations.
  delete from public.supplier_opening_balances where supplier_id = p_supplier_id;

  select coalesce(sum(pi.imp_total), 0) into v_sum_invoices
  from public.purchase_invoices pi
  where pi.supplier_id = p_supplier_id
    and pi.status = 'received'
    and pi.kind in ('factura', 'nd')
    and coalesce(pi.moneda, 'PES') not in ('DOL', 'USD')
    and pi.fecha <= p_opening_date;

  select coalesce(sum(pi.imp_total), 0) into v_sum_ncs
  from public.purchase_invoices pi
  where pi.supplier_id = p_supplier_id
    and pi.status = 'received'
    and pi.kind = 'nc'
    and coalesce(pi.moneda, 'PES') not in ('DOL', 'USD')
    and pi.fecha <= p_opening_date;

  select coalesce(sum(poa.amount_applied), 0) into v_sum_payments
  from public.payment_order_allocations poa
  join public.payment_orders po on po.id = poa.payment_order_id
  join public.purchase_invoices pi on pi.id = poa.purchase_invoice_id
  where po.status = 'issued'
    and po.payment_date <= p_opening_date
    and pi.supplier_id = p_supplier_id
    and coalesce(pi.moneda, 'PES') not in ('DOL', 'USD')
    and pi.fecha <= p_opening_date;

  v_to_settle := greatest(v_sum_invoices - v_sum_ncs - v_sum_payments - p_target_balance, 0);

  -- The header goes first: the allocations reference it
  -- (supplier_opening_balance_allocations_header_fk, not deferrable).
  insert into public.supplier_opening_balances (
    supplier_id, opening_date, target_balance, total_settled, notes, created_by
  ) values (
    p_supplier_id, p_opening_date, p_target_balance, v_to_settle, p_notes, auth.uid()
  );

  -- FIFO from the oldest invoice over what payment orders and NCs leave open
  -- (the supplier's opening allocations were deleted above).
  v_remaining := v_to_settle;
  for v_inv in
    select pi.id, o.open_amount as outstanding
    from public.purchase_invoices pi
    join public.v_purchase_invoice_open o on o.purchase_invoice_id = pi.id
    where pi.supplier_id = p_supplier_id
      and pi.status = 'received'
      and pi.kind in ('factura', 'nd')
      and coalesce(pi.moneda, 'PES') not in ('DOL', 'USD')
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

  if v_remaining > 0 then
    update public.supplier_opening_balances
       set total_settled = v_to_settle - v_remaining
     where supplier_id = p_supplier_id;
  end if;
end;
$$;

comment on function public.apply_supplier_opening_balance(uuid, date, numeric, text) is
  'Fija/sobrescribe el saldo de apertura del proveedor (en pesos). Imputa FIFO a facturas y ND en pesos hasta el corte lo que exceda al saldo real (facturas − NC − órdenes de pago). Solo owner.';

revoke all on function public.apply_supplier_opening_balance(uuid, date, numeric, text) from public, anon;
grant execute on function public.apply_supplier_opening_balance(uuid, date, numeric, text) to authenticated;
