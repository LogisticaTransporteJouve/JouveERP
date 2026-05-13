-- Fix: la tabla client_opening_balance_allocations cascadea desde clients,
-- pero la cascade desde client_opening_balances no estaba seteada. Cuando
-- el RPC `apply_client_opening_balance` borra la fila header, las
-- allocations quedan colgadas y el siguiente re-run choca con la PK
-- (`duplicate key value violates unique constraint
-- "client_opening_balance_allocations_pkey"`).
--
-- Fix: agregar FK explícita allocations.client_id → opening.client_id con
-- on delete cascade. Como client_id es el PK del header, alcanza con esa
-- referencia para que el cascade funcione.

set row_security = off;

-- Limpieza preventiva: drop allocations huérfanas que pudieran existir.
delete from public.client_opening_balance_allocations a
where not exists (
  select 1 from public.client_opening_balances ob
  where ob.client_id = a.client_id
);

-- La FK existente (client_id → clients.id) sigue. Sumamos una a opening.
alter table public.client_opening_balance_allocations
  add constraint client_opening_balance_allocations_opening_fkey
  foreign key (client_id) references public.client_opening_balances(client_id)
  on delete cascade
  deferrable initially deferred;

-- También el RPC: por las dudas, borrar allocations explícitamente antes
-- del header. Idempotente y robusto si la FK falla por alguna razón.
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
  v_to_settle      numeric(14, 2);
  v_remaining      numeric(14, 2);
  v_inv            record;
  v_apply          numeric(14, 2);
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_target_balance < 0 then
    raise exception 'target_balance no puede ser negativo';
  end if;

  -- Borrar opening anterior + allocations en orden. La nueva FK cascadea
  -- desde el header, pero borramos explícitamente por defensa.
  delete from public.client_opening_balance_allocations where client_id = p_client_id;
  delete from public.client_opening_balances where client_id = p_client_id;

  select coalesce(sum(c.imp_total), 0) into v_sum_invoices
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind in ('factura', 'nd')
    and c.fecha <= p_opening_date;

  v_to_settle := v_sum_invoices - p_target_balance;

  if v_to_settle <= 0 then
    insert into public.client_opening_balances (
      client_id, opening_date, target_balance, total_settled, notes, created_by
    ) values (
      p_client_id, p_opening_date, p_target_balance, 0, p_notes, v_user_id
    );
    return;
  end if;

  -- Insertar el header PRIMERO así la FK desde allocations puede resolverse.
  insert into public.client_opening_balances (
    client_id, opening_date, target_balance, total_settled, notes, created_by
  ) values (
    p_client_id, p_opening_date, p_target_balance, v_to_settle, p_notes, v_user_id
  );

  v_remaining := v_to_settle;
  for v_inv in
    select c.id, c.imp_total
    from public.invoices c
    where c.client_id = p_client_id
      and c.status = 'emitted'
      and c.kind in ('factura', 'nd')
      and c.fecha <= p_opening_date
    order by c.fecha asc, c.numero asc, c.created_at asc
  loop
    exit when v_remaining <= 0;
    v_apply := least(v_inv.imp_total, v_remaining);
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
