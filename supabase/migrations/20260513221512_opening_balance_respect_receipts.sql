-- Fix: el ajuste de saldo no consideraba los recibos ni NCs pre-existentes
-- al imputar FIFO. Si la usuaria editaba el ajuste DESPUÉS de cargar
-- recibos que tocaban facturas pre-corte, el RPC podía:
--   (a) sobreimputar la misma factura (receipt_alloc + opening_alloc >
--       imp_total) — la factura aparecía "sobrecubierta", outstanding
--       negativo en el aging.
--   (b) sub-calcular cuánto hay para saldar (no descontaba lo que los
--       recibos ya cubrían), llevando el running balance al target
--       incorrecto.
--
-- Fix:
--   1. La cantidad a saldar ahora es: (sum_facturas+ND) - (sum_NCs) -
--      (sum_receipt_allocations) - target_balance. Es decir, "saldo real
--      calculado al corte" menos target.
--   2. Al iterar facturas, la capacidad efectiva por factura es
--      `imp_total - sum_existing_receipt_alloc` (canceled receipts no
--      cuentan). Las facturas con capacidad 0 se skipean. Última factura
--      puede imputarse parcial.
--
-- Solo invoices/ND/NCs/receipts <= opening_date y con status emitted/issued
-- entran al cálculo.

set row_security = off;

create or replace function public.apply_client_opening_balance(
  p_client_id      uuid,
  p_opening_date   date,
  p_target_balance numeric,
  p_notes          text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
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
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_target_balance < 0 then
    raise exception 'target_balance no puede ser negativo';
  end if;

  -- Borrar opening anterior + allocations. La cascade desde el header está
  -- en una migración previa; acá borramos explícito por defensa.
  delete from public.client_opening_balance_allocations where client_id = p_client_id;
  delete from public.client_opening_balances where client_id = p_client_id;

  -- 1) Sumar facturas+ND emitidas con fecha <= corte.
  select coalesce(sum(c.imp_total), 0) into v_sum_invoices
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind in ('factura', 'nd')
    and c.fecha <= p_opening_date;

  -- 2) Sumar NCs emitidas con fecha <= corte.
  select coalesce(sum(c.imp_total), 0) into v_sum_ncs
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind = 'nc'
    and c.fecha <= p_opening_date;

  -- 3) Sumar receipt_allocations de recibos issued con fecha <= corte.
  select coalesce(sum(ra.amount_applied), 0) into v_sum_receipts
  from public.receipt_allocations ra
  join public.receipts r on r.id = ra.receipt_id
  join public.invoices  c on c.id = ra.invoice_id
  where r.status = 'issued'
    and r.receipt_date <= p_opening_date
    and c.client_id = p_client_id
    and c.fecha <= p_opening_date;

  v_real_open := v_sum_invoices - v_sum_ncs - v_sum_receipts;
  v_to_settle := v_real_open - p_target_balance;

  if v_to_settle <= 0 then
    -- El saldo real calculado ya es <= target. No hay que saldar nada.
    insert into public.client_opening_balances (
      client_id, opening_date, target_balance, total_settled, notes, created_by
    ) values (
      p_client_id, p_opening_date, p_target_balance, 0, p_notes, v_user_id
    );
    return;
  end if;

  -- Insertar el header primero así la FK desde allocations resuelve.
  insert into public.client_opening_balances (
    client_id, opening_date, target_balance, total_settled, notes, created_by
  ) values (
    p_client_id, p_opening_date, p_target_balance, v_to_settle, p_notes, v_user_id
  );

  -- 4) Iterar FIFO con capacidad efectiva (descuenta recibos).
  v_remaining := v_to_settle;
  for v_inv in
    select
      c.id,
      c.imp_total,
      c.imp_total - coalesce((
        select sum(ra.amount_applied)
        from public.receipt_allocations ra
        join public.receipts r on r.id = ra.receipt_id
        where ra.invoice_id = c.id
          and r.status = 'issued'
      ), 0) as capacity
    from public.invoices c
    where c.client_id = p_client_id
      and c.status = 'emitted'
      and c.kind in ('factura', 'nd')
      and c.fecha <= p_opening_date
    order by c.fecha asc, c.numero asc, c.created_at asc
  loop
    exit when v_remaining <= 0;
    v_capacity := greatest(v_inv.capacity, 0);
    if v_capacity = 0 then
      continue; -- ya saldada por recibos
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

set row_security = on;
