-- Supplier opening balances (saldo de apertura por proveedor).
--
-- Espejo de client_opening_balances. Caso de uso: tras migrar facturas
-- históricas de compra, todas aparecen como pendientes. El usuario informa
-- "al 2024-12-31 le debíamos $X al proveedor Y" y el sistema imputa FIFO
-- desde la factura más vieja hasta la más nueva con fecha ≤ corte hasta que
-- el remanente coincida con `target_balance`.

set row_security = off;

-- 1. Tabla cabecera ---------------------------------------------------------

create table public.supplier_opening_balances (
  supplier_id    uuid primary key references public.suppliers(id) on delete cascade,
  opening_date   date not null,
  target_balance numeric(14, 2) not null check (target_balance >= 0),
  total_settled  numeric(14, 2) not null check (total_settled >= 0),
  notes          text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.supplier_opening_balances is
  'Saldo de apertura por proveedor. target_balance = deuda real al opening_date. total_settled = monto imputado a facturas anteriores. Editable — sobrescribe.';

create trigger supplier_opening_balances_set_updated_at
  before update on public.supplier_opening_balances
  for each row execute function public.set_updated_at();

-- 2. Imputaciones por factura ----------------------------------------------

create table public.supplier_opening_balance_allocations (
  supplier_id            uuid not null references public.suppliers(id) on delete cascade,
  purchase_invoice_id    uuid primary key references public.purchase_invoices(id) on delete cascade,
  amount_applied         numeric(14, 2) not null check (amount_applied > 0),
  created_at             timestamptz not null default now()
);

comment on table public.supplier_opening_balance_allocations is
  'Imputación por factura de compra del saldo de apertura. Una factura solo se imputa una vez.';

create index supplier_opening_balance_allocations_supplier_idx
  on public.supplier_opening_balance_allocations(supplier_id);

-- Cascade cleanup desde supplier_opening_balances (mirror del fix de clients).
alter table public.supplier_opening_balance_allocations
  add constraint supplier_opening_balance_allocations_header_fk
  foreign key (supplier_id) references public.supplier_opening_balances(supplier_id)
  on delete cascade;

-- 3. RLS --------------------------------------------------------------------

alter table public.supplier_opening_balances enable row level security;
alter table public.supplier_opening_balance_allocations enable row level security;

create policy "Finance can view supplier opening balances"
  on public.supplier_opening_balances for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Finance can view supplier opening allocations"
  on public.supplier_opening_balance_allocations for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

-- Writes solo via RPC (security definer).

-- 4. RPC apply_supplier_opening_balance ------------------------------------

create or replace function public.apply_supplier_opening_balance(
  p_supplier_id    uuid,
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
  if not public.user_has_role(array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_target_balance < 0 then
    raise exception 'target_balance no puede ser negativo';
  end if;

  delete from public.supplier_opening_balances where supplier_id = p_supplier_id;

  -- Sumar facturas + ND recibidas con fecha <= opening_date. NCs no entran.
  select coalesce(sum(pi.imp_total), 0) into v_sum_invoices
  from public.purchase_invoices pi
  where pi.supplier_id = p_supplier_id
    and pi.status = 'received'
    and pi.kind in ('factura', 'nd')
    and pi.fecha <= p_opening_date;

  v_to_settle := v_sum_invoices - p_target_balance;

  if v_to_settle <= 0 then
    insert into public.supplier_opening_balances (
      supplier_id, opening_date, target_balance, total_settled, notes, created_by
    ) values (
      p_supplier_id, p_opening_date, p_target_balance, 0, p_notes, v_user_id
    );
    return;
  end if;

  -- FIFO: imputar desde la factura más vieja, descontando lo ya pagado vía
  -- OPs. Una factura completamente saldada por OPs se ignora; una parcial
  -- recibe solo el restante.
  v_remaining := v_to_settle;
  for v_inv in
    select pi.id,
           pi.imp_total - coalesce(po_paid.applied, 0) as outstanding
    from public.purchase_invoices pi
    left join (
      select poa.purchase_invoice_id, sum(poa.amount_applied) as applied
      from public.payment_order_allocations poa
      join public.payment_orders po on po.id = poa.payment_order_id
      where po.status = 'issued'
      group by poa.purchase_invoice_id
    ) po_paid on po_paid.purchase_invoice_id = pi.id
    where pi.supplier_id = p_supplier_id
      and pi.status = 'received'
      and pi.kind in ('factura', 'nd')
      and pi.fecha <= p_opening_date
      and (pi.imp_total - coalesce(po_paid.applied, 0)) > 0
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

  insert into public.supplier_opening_balances (
    supplier_id, opening_date, target_balance, total_settled, notes, created_by
  ) values (
    p_supplier_id, p_opening_date, p_target_balance,
    v_to_settle - v_remaining, p_notes, v_user_id
  );
end;
$$;

revoke execute on function public.apply_supplier_opening_balance(uuid, date, numeric, text) from public;
grant execute on function public.apply_supplier_opening_balance(uuid, date, numeric, text) to authenticated;

comment on function public.apply_supplier_opening_balance(uuid, date, numeric, text) is
  'Fija/sobrescribe el saldo de apertura del proveedor. Imputa FIFO contra facturas + NDs anteriores al corte. Solo owner.';

-- 5. RPC clear_supplier_opening_balance ------------------------------------

create or replace function public.clear_supplier_opening_balance(p_supplier_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_has_role(array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.supplier_opening_balances where supplier_id = p_supplier_id;
end;
$$;

revoke execute on function public.clear_supplier_opening_balance(uuid) from public;
grant execute on function public.clear_supplier_opening_balance(uuid) to authenticated;

-- 6. Vistas actualizadas ---------------------------------------------------

-- v_supplier_aging_documents: descontar también las opening allocations.
create or replace view public.v_supplier_aging_documents with (security_invoker = on) as
  select
    pi.id                                              as purchase_invoice_id,
    pi.supplier_id                                     as supplier_id,
    pi.fecha                                           as fecha,
    pi.kind                                            as kind,
    pi.letter                                          as letter,
    pi.punto_venta                                     as punto_venta,
    pi.numero                                          as numero,
    pi.imp_total                                       as imp_total,
    coalesce(alloc.applied, 0) + coalesce(opening.applied, 0) as amount_applied,
    (pi.imp_total
       - coalesce(alloc.applied, 0)
       - coalesce(opening.applied, 0))                 as open_amount,
    (current_date - pi.fecha)                          as days_overdue,
    case
      when (current_date - pi.fecha) <= 30 then '0_30'
      when (current_date - pi.fecha) <= 60 then '30_60'
      when (current_date - pi.fecha) <= 90 then '60_90'
      else '90_plus'
    end                                                as bucket,
    pi.channel_id                                      as channel_id,
    ch.name                                            as channel_name,
    ch.is_fiscal                                       as channel_is_fiscal
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  left join (
    select poa.purchase_invoice_id, sum(poa.amount_applied) as applied
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
    where po.status = 'issued'
    group by poa.purchase_invoice_id
  ) alloc on alloc.purchase_invoice_id = pi.id
  left join (
    select purchase_invoice_id, amount_applied as applied
    from public.supplier_opening_balance_allocations
  ) opening on opening.purchase_invoice_id = pi.id
  where pi.status = 'received'
    and pi.kind in ('factura', 'nd')
    and (pi.imp_total
           - coalesce(alloc.applied, 0)
           - coalesce(opening.applied, 0)) > 0;

comment on view public.v_supplier_aging_documents is
  'Facturas + NDs de proveedor con saldo abierto. open_amount = imp_total - allocations de OPs issued - opening_balance_alloc.';

-- v_supplier_account_movements: agregar fila por opening balance.
create or replace view public.v_supplier_account_movements with (security_invoker = on) as
  select
    'purchase_invoice'::text             as source_type,
    pi.id                                as source_id,
    pi.supplier_id                       as supplier_id,
    pi.fecha                             as movement_date,
    pi.created_at                        as created_at,
    pi.kind                              as kind,
    pi.letter                            as letter,
    pi.punto_venta                       as punto_venta,
    pi.numero                            as numero,
    case
      when pi.kind = 'nc' then -1 * pi.imp_total
      else pi.imp_total
    end                                  as signed_amount,
    pi.imp_total                         as gross_amount,
    pi.channel_id                        as channel_id,
    ch.division                          as channel_division,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    pi.status                            as status
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.status = 'received'

  union all

  select
    'payment_order'::text                as source_type,
    po.id                                as source_id,
    po.supplier_id                       as supplier_id,
    po.payment_date                      as movement_date,
    po.created_at                        as created_at,
    'payment_order'::text                as kind,
    null::text                           as letter,
    po.punto_venta                       as punto_venta,
    po.numero                            as numero,
    -1 * po.total_amount                 as signed_amount,
    po.total_amount                      as gross_amount,
    po.channel_id                        as channel_id,
    ch.division                          as channel_division,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    po.status                            as status
  from public.payment_orders po
  join public.invoicing_channels ch on ch.id = po.channel_id
  where po.status = 'issued'

  union all

  -- Saldo de apertura: una sola fila por proveedor, a la fecha del opening.
  -- signed_amount = target_balance (positivo, les debíamos esa plata al corte).
  select
    'opening_balance'::text              as source_type,
    null::uuid                           as source_id,
    ob.supplier_id                       as supplier_id,
    ob.opening_date                      as movement_date,
    ob.created_at                        as created_at,
    'opening_balance'::text              as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    ob.target_balance                    as signed_amount,
    ob.target_balance                    as gross_amount,
    null::text                           as channel_id,
    null::text                           as channel_division,
    null::boolean                        as channel_is_fiscal,
    null::text                           as channel_name,
    'issued'::text                       as status
  from public.supplier_opening_balances ob;

comment on view public.v_supplier_account_movements is
  'Feed cronológico de purchase_invoices + payment_orders + opening_balance por proveedor.';

set row_security = on;
