SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 2.1 + 2.2 (D2, "a cuenta e imputación posterior").
--
--   1. allocate_receipt / allocate_payment_order: apply what an issued
--      receipt or payment order holds "a cuenta" to open comprobantes later,
--      without touching its payment lines, movements or checks (update_receipt
--      rebuilds all of them and refuses once a check left the cartera). The
--      new rows go through the same allocation guards (client/supplier,
--      channel, currency, open amount); an allocation to a document the payer
--      already applied to adds to it. Invoice allocations do not enter the
--      receipt or OP entry, so the journal is not touched.
--   2. v_receipt_unapplied / v_payment_order_unapplied: what each issued
--      receipt / OP still holds a cuenta (total minus its allocations), for
--      the aging, which lists it apart from the open documents.

-- 1. Later allocation --------------------------------------------------------------------

create function public.allocate_receipt(p_receipt_id uuid, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_total   numeric;
  v_applied numeric;
  v_new     numeric := 0;
  v_line    jsonb;
begin
  -- Role guard (receipts:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para imputar recibos'
      using errcode = '42501';
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Elegí al menos un comprobante para imputar'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select status, total_amount into v_status, v_total
    from public.receipts where id = p_receipt_id
     for update;
  if v_status is null then
    raise exception 'El recibo no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_status <> 'issued' then
    raise exception 'El recibo está anulado: no se puede imputar'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select coalesce((select sum(amount_applied) from public.receipt_allocations where receipt_id = p_receipt_id), 0)
       + coalesce((select sum(amount_applied) from public.receipt_rejected_check_allocations where receipt_id = p_receipt_id), 0)
    into v_applied;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    if coalesce((v_line ->> 'amount_applied')::numeric, 0) <= 0 then
      raise exception 'Cada imputación tiene que ser mayor a cero'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_new := v_new + (v_line ->> 'amount_applied')::numeric;
  end loop;

  if round(v_applied + v_new, 2) > round(v_total, 2) then
    raise exception 'La imputación excede el saldo a cuenta del recibo (%)', round(v_total - v_applied, 2)
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
    values (p_receipt_id, (v_line ->> 'invoice_id')::uuid, (v_line ->> 'amount_applied')::numeric)
    on conflict (receipt_id, invoice_id)
      do update set amount_applied = public.receipt_allocations.amount_applied + excluded.amount_applied;
  end loop;
end;
$$;

revoke all on function public.allocate_receipt(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.allocate_receipt(uuid, jsonb) to authenticated, service_role;

create function public.allocate_payment_order(p_payment_order_id uuid, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_total   numeric;
  v_applied numeric;
  v_new     numeric := 0;
  v_line    jsonb;
begin
  -- Role guard (payment_orders:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para imputar órdenes de pago'
      using errcode = '42501';
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Elegí al menos una factura para imputar'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select status, total_amount into v_status, v_total
    from public.payment_orders where id = p_payment_order_id
     for update;
  if v_status is null then
    raise exception 'La orden de pago no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_status <> 'issued' then
    raise exception 'La orden de pago está anulada: no se puede imputar'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select coalesce(sum(amount_applied), 0) into v_applied
    from public.payment_order_allocations where payment_order_id = p_payment_order_id;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    if coalesce((v_line ->> 'amount_applied')::numeric, 0) <= 0 then
      raise exception 'Cada imputación tiene que ser mayor a cero'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_new := v_new + (v_line ->> 'amount_applied')::numeric;
  end loop;

  if round(v_applied + v_new, 2) > round(v_total, 2) then
    raise exception 'La imputación excede el saldo a cuenta de la orden de pago (%)', round(v_total - v_applied, 2)
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
    values (p_payment_order_id, (v_line ->> 'purchase_invoice_id')::uuid, (v_line ->> 'amount_applied')::numeric)
    on conflict (payment_order_id, purchase_invoice_id)
      do update set amount_applied = public.payment_order_allocations.amount_applied + excluded.amount_applied;
  end loop;
end;
$$;

revoke all on function public.allocate_payment_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.allocate_payment_order(uuid, jsonb) to authenticated, service_role;

-- 2. What is still a cuenta ---------------------------------------------------------------

create view public.v_receipt_unapplied with (security_invoker = on) as
  select r.id as receipt_id,
         r.client_id,
         r.channel_id,
         c.is_fiscal as channel_is_fiscal,
         r.currency,
         r.receipt_date,
         r.total_amount
           - coalesce((select sum(ra.amount_applied) from public.receipt_allocations ra
                        where ra.receipt_id = r.id), 0)
           - coalesce((select sum(rc.amount_applied) from public.receipt_rejected_check_allocations rc
                        where rc.receipt_id = r.id), 0) as unapplied_amount
    from public.receipts r
    join public.invoicing_channels c on c.id = r.channel_id
   where r.status = 'issued'
     and r.total_amount
           - coalesce((select sum(ra.amount_applied) from public.receipt_allocations ra
                        where ra.receipt_id = r.id), 0)
           - coalesce((select sum(rc.amount_applied) from public.receipt_rejected_check_allocations rc
                        where rc.receipt_id = r.id), 0) > 0.005;

comment on view public.v_receipt_unapplied is
  'Recibos emitidos con saldo a cuenta (total menos lo imputado a comprobantes y cheques rechazados).';

grant select on table public.v_receipt_unapplied to authenticated;
grant all on table public.v_receipt_unapplied to service_role;

create view public.v_payment_order_unapplied with (security_invoker = on) as
  select po.id as payment_order_id,
         po.supplier_id,
         po.channel_id,
         c.is_fiscal as channel_is_fiscal,
         po.currency,
         po.payment_date,
         po.total_amount
           - coalesce((select sum(pa.amount_applied) from public.payment_order_allocations pa
                        where pa.payment_order_id = po.id), 0) as unapplied_amount
    from public.payment_orders po
    join public.invoicing_channels c on c.id = po.channel_id
   where po.status = 'issued'
     and po.total_amount
           - coalesce((select sum(pa.amount_applied) from public.payment_order_allocations pa
                        where pa.payment_order_id = po.id), 0) > 0.005;

comment on view public.v_payment_order_unapplied is
  'Órdenes de pago emitidas con saldo a cuenta (total menos lo imputado a facturas).';

grant select on table public.v_payment_order_unapplied to authenticated;
grant all on table public.v_payment_order_unapplied to service_role;
