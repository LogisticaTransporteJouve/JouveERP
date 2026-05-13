-- Client opening balances (saldo de apertura por cliente).
--
-- Caso de uso: al arrancar el sistema con una migración masiva de facturas
-- viejas, todas aparecen como pendientes. Pero en la realidad muchas ya
-- estaban pagadas. El usuario informa "al 2024-12-31 cliente X debía $80k"
-- y el sistema imputa FIFO (desde la factura más vieja hasta la más nueva
-- anteriores al corte) hasta que el remanente coincida con el target.
--
-- Editable: si después aparecen más facturas migradas, se re-corre la
-- función `apply_client_opening_balance` y se sobrescribe.
--
-- No es factible vía recibo regular porque (a) no hay un pago real
-- asociado, (b) el numerador de recibo es por canal y la apertura cruza
-- canales. Modelamos con una entidad propia y vistas que la consumen.

set row_security = off;

-- 1. Tabla cabecera ---------------------------------------------------------

create table public.client_opening_balances (
  client_id      uuid primary key references public.clients(id) on delete cascade,
  opening_date   date not null,
  target_balance numeric(14, 2) not null check (target_balance >= 0),
  total_settled  numeric(14, 2) not null check (total_settled >= 0),
  notes          text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.client_opening_balances is
  'Saldo de apertura por cliente. target_balance = deuda real al opening_date. total_settled = monto imputado a facturas anteriores. Editable — sobrescribe.';

create trigger client_opening_balances_set_updated_at
  before update on public.client_opening_balances
  for each row execute function public.set_updated_at();

-- 2. Imputaciones por factura ----------------------------------------------

create table public.client_opening_balance_allocations (
  client_id     uuid not null references public.clients(id) on delete cascade,
  invoice_id    uuid primary key references public.invoices(id) on delete cascade,
  amount_applied numeric(14, 2) not null check (amount_applied > 0),
  created_at    timestamptz not null default now()
);

comment on table public.client_opening_balance_allocations is
  'Imputación por factura del saldo de apertura. Una factura solo se imputa una vez (PK invoice_id) — borrar el opening_balance del cliente cascadea estas filas.';

create index client_opening_balance_allocations_client_idx
  on public.client_opening_balance_allocations(client_id);

-- 3. RLS --------------------------------------------------------------------

alter table public.client_opening_balances enable row level security;
alter table public.client_opening_balance_allocations enable row level security;

-- read: finance + admin + owner
create policy "Finance can view client opening balances"
  on public.client_opening_balances for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Finance can view opening allocations"
  on public.client_opening_balance_allocations for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

-- write: solo via RPC (security definer) — no policy directa de INSERT/UPDATE/DELETE.

-- 4. RPC apply_client_opening_balance --------------------------------------

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
  -- Auth gate: solo finance | admin | owner.
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_target_balance < 0 then
    raise exception 'target_balance no puede ser negativo';
  end if;

  -- Borrar opening anterior si existe (cascade allocations).
  delete from public.client_opening_balances where client_id = p_client_id;

  -- Sumar facturas + ND emitidas con fecha <= opening_date. NCs no
  -- entran porque ya descuentan deuda; el saldo abierto sale del aging
  -- normal, no del opening.
  select coalesce(sum(c.imp_total), 0) into v_sum_invoices
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind in ('factura', 'nd')
    and c.fecha <= p_opening_date;

  v_to_settle := v_sum_invoices - p_target_balance;

  if v_to_settle <= 0 then
    -- No hay nada que saldar; el target es mayor o igual a la suma de
    -- facturas. Insertamos el header con total_settled = 0 (queda como
    -- nota informativa que el opening fue revisado).
    insert into public.client_opening_balances (
      client_id, opening_date, target_balance, total_settled, notes, created_by
    ) values (
      p_client_id, p_opening_date, p_target_balance, 0, p_notes, v_user_id
    );
    return;
  end if;

  -- Iterar FIFO (más vieja primero) imputando hasta agotar v_to_settle.
  -- Cada factura recibe hasta su imp_total. La última puede ser parcial.
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

  insert into public.client_opening_balances (
    client_id, opening_date, target_balance, total_settled, notes, created_by
  ) values (
    p_client_id, p_opening_date, p_target_balance, v_to_settle, p_notes, v_user_id
  );
end;
$$;

revoke execute on function public.apply_client_opening_balance(uuid, date, numeric, text) from public;
grant execute on function public.apply_client_opening_balance(uuid, date, numeric, text) to authenticated;

comment on function public.apply_client_opening_balance(uuid, date, numeric, text) is
  'Fija/sobrescribe el saldo de apertura del cliente. Imputa FIFO contra facturas + NDs con fecha ≤ opening_date hasta que el remanente coincida con target_balance. Atómico: borra y recrea.';

-- RPC para borrar el opening (alternativa al edit).
create or replace function public.clear_client_opening_balance(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.client_opening_balances where client_id = p_client_id;
end;
$$;

revoke execute on function public.clear_client_opening_balance(uuid) from public;
grant execute on function public.clear_client_opening_balance(uuid) to authenticated;

-- 5. Vistas actualizadas ---------------------------------------------------

-- v_aging_documents: ahora descuenta también las opening allocations.
-- Una factura solo aparece en aging si (imp_total - receipts_alloc -
-- opening_alloc) > 0.

create or replace view public.v_aging_documents with (security_invoker = on) as
  select
    c.id                                     as invoice_id,
    c.client_id                              as client_id,
    c.fecha                                  as fecha,
    c.kind                                   as kind,
    c.letter                                 as letter,
    c.punto_venta                            as punto_venta,
    c.numero                                 as numero,
    c.imp_total                              as imp_total,
    coalesce(alloc.applied, 0) + coalesce(opening.applied, 0) as amount_applied,
    (c.imp_total
       - coalesce(alloc.applied, 0)
       - coalesce(opening.applied, 0))      as open_amount,
    (current_date - c.fecha)                 as days_overdue,
    case
      when (current_date - c.fecha) <= 30 then '0_30'
      when (current_date - c.fecha) <= 60 then '30_60'
      when (current_date - c.fecha) <= 90 then '60_90'
      else '90_plus'
    end                                      as bucket,
    c.channel_id                             as channel_id,
    ch.name                                  as channel_name,
    ch.is_fiscal                             as channel_is_fiscal
  from public.invoices c
  join public.invoicing_channels ch on ch.id = c.channel_id
  left join (
    select ra.invoice_id, sum(ra.amount_applied) as applied
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
    where r.status = 'issued'
    group by ra.invoice_id
  ) alloc on alloc.invoice_id = c.id
  left join (
    select invoice_id, amount_applied as applied
    from public.client_opening_balance_allocations
  ) opening on opening.invoice_id = c.id
  where c.status = 'emitted'
    and c.kind in ('factura', 'nd')
    and (c.imp_total
           - coalesce(alloc.applied, 0)
           - coalesce(opening.applied, 0)) > 0;

comment on view public.v_aging_documents is
  'Facturas + NDs emitidas con saldo abierto. open_amount = imp_total - receipts_alloc - opening_balance_alloc.';

-- v_client_account_movements: agregar fila por opening balance del cliente.
-- Aparece a la fecha del opening con signo positivo (cliente debe el target).
-- Las imputaciones a facturas se ven en aging; acá el opening es una sola
-- fila de "saldo inicial" que se entiende como el corte conceptual.

create or replace view public.v_client_account_movements with (security_invoker = on) as
  select
    'invoice'::text                      as source_type,
    c.id                                     as source_id,
    c.client_id                              as client_id,
    c.fecha                                  as movement_date,
    c.created_at                             as created_at,
    c.kind                                   as kind,
    c.letter                                 as letter,
    c.punto_venta                            as punto_venta,
    c.numero                                 as numero,
    case
      when c.kind = 'nc' then -1 * c.imp_total
      else c.imp_total
    end                                      as signed_amount,
    c.imp_total                              as gross_amount,
    c.channel_id                             as channel_id,
    ch.division                              as channel_division,
    ch.is_fiscal                             as channel_is_fiscal,
    ch.name                                  as channel_name,
    c.status                                 as status
  from public.invoices c
  join public.invoicing_channels ch on ch.id = c.channel_id
  where c.status = 'emitted'

  union all

  select
    'receipt'::text                          as source_type,
    r.id                                     as source_id,
    r.client_id                              as client_id,
    r.receipt_date                           as movement_date,
    r.created_at                             as created_at,
    'receipt'::text                          as kind,
    null::text                               as letter,
    r.punto_venta                            as punto_venta,
    r.numero                                 as numero,
    -1 * r.total_amount                      as signed_amount,
    r.total_amount                           as gross_amount,
    r.channel_id                             as channel_id,
    ch.division                              as channel_division,
    ch.is_fiscal                             as channel_is_fiscal,
    ch.name                                  as channel_name,
    r.status                                 as status
  from public.receipts r
  join public.invoicing_channels ch on ch.id = r.channel_id
  where r.status = 'issued'

  union all

  -- Saldo de apertura: una sola fila por cliente, a la fecha del opening.
  -- signed_amount = target_balance (positivo, cliente debía ese monto al
  -- corte). Las imputaciones a facturas ya descuentan el resto en aging.
  select
    'opening_balance'::text                  as source_type,
    null::uuid                               as source_id,
    ob.client_id                             as client_id,
    ob.opening_date                          as movement_date,
    ob.created_at                            as created_at,
    'opening_balance'::text                  as kind,
    null::text                               as letter,
    null::integer                            as punto_venta,
    null::integer                            as numero,
    ob.target_balance                        as signed_amount,
    ob.target_balance                        as gross_amount,
    null::text                               as channel_id,
    null::text                               as channel_division,
    null::boolean                            as channel_is_fiscal,
    null::text                               as channel_name,
    'issued'::text                           as status
  from public.client_opening_balances ob;

comment on view public.v_client_account_movements is
  'Feed cronológico unificado: invoices + receipts + opening_balance. signed_amount > 0 = el cliente debe; < 0 = pago / NC.';

set row_security = on;
