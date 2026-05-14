-- K.3 — Órdenes de pago (OP). Espejo de receipts pero out-flow.
--
-- Una OP registra que le pagamos a un proveedor. Internal-only (no AFIP).
-- Mismo patrón de per-channel correlativo: `OP{POS:4}-{numero:8}`.
--
-- Tres tablas:
--   * payment_orders — header.
--   * payment_order_payment_lines — de qué cuenta salió la plata (una row
--     por cuenta debitada). El "método" se deriva del account.type
--     (cash | bank | cheques | echeq | wallet).
--   * payment_order_allocations — a qué facturas de compra le aplica la
--     OP, y cuánto a cada una. El resto, si hay, queda "a cuenta".
--
-- Edición permitida (mismo opt-in que receipts). Hard-delete bloqueado por
-- RLS. Cancelar = status='canceled', el correlativo queda fijo (gaps mejor
-- que mutar historial).
--
-- Auto-link a transactions (kind=expense): cada payment_line se materializa
-- en una transaction en su account_id. Cancel borra las transactions vía
-- trigger.

set row_security = off;

------------------------------------------------------------------------------
-- 1. payment_orders
------------------------------------------------------------------------------
create table public.payment_orders (
  id              uuid primary key default gen_random_uuid(),
  channel_id      text not null references public.invoicing_channels (id)
                    on delete restrict,
  punto_venta     int  not null check (punto_venta between 1 and 99999),
  numero          int  not null check (numero >= 1),
  supplier_id     uuid not null references public.suppliers (id) on delete restrict,
  payment_date    date not null,
  total_amount    numeric(18, 2) not null check (total_amount > 0),
  currency        text not null check (currency in ('ARS', 'USD')),
  notes           text,
  status          text not null default 'issued'
                    check (status in ('issued', 'canceled')),
  canceled_at     timestamptz,
  canceled_by     uuid references auth.users (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.payment_orders is
  'Órdenes de pago a proveedores. Per-channel correlativo, espejo de receipts.';

create unique index payment_orders_channel_pos_numero_idx
  on public.payment_orders (channel_id, punto_venta, numero);

create index payment_orders_supplier_idx     on public.payment_orders (supplier_id);
create index payment_orders_payment_date_idx on public.payment_orders (payment_date desc);
create index payment_orders_channel_idx      on public.payment_orders (channel_id, payment_date desc);
create index payment_orders_status_idx       on public.payment_orders (status);

------------------------------------------------------------------------------
-- 2. payment_order_payment_lines
------------------------------------------------------------------------------
create table public.payment_order_payment_lines (
  id                 uuid primary key default gen_random_uuid(),
  payment_order_id   uuid not null references public.payment_orders (id) on delete cascade,
  account_id         uuid not null references public.accounts (id) on delete restrict,
  amount             numeric(18, 2) not null check (amount > 0),
  reference          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index payment_order_payment_lines_op_idx on public.payment_order_payment_lines (payment_order_id);
create index payment_order_payment_lines_account_idx on public.payment_order_payment_lines (account_id);

------------------------------------------------------------------------------
-- 3. payment_order_allocations
------------------------------------------------------------------------------
create table public.payment_order_allocations (
  id                    uuid primary key default gen_random_uuid(),
  payment_order_id      uuid not null references public.payment_orders (id) on delete cascade,
  purchase_invoice_id   uuid not null references public.purchase_invoices (id) on delete restrict,
  amount_applied        numeric(18, 2) not null check (amount_applied > 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index payment_order_allocations_unique_pair_idx
  on public.payment_order_allocations (payment_order_id, purchase_invoice_id);

create index payment_order_allocations_invoice_idx on public.payment_order_allocations (purchase_invoice_id);

------------------------------------------------------------------------------
-- 4. updated_at triggers
------------------------------------------------------------------------------
create trigger payment_orders_set_updated_at
  before update on public.payment_orders
  for each row execute function public.set_updated_at();

create trigger payment_order_payment_lines_set_updated_at
  before update on public.payment_order_payment_lines
  for each row execute function public.set_updated_at();

create trigger payment_order_allocations_set_updated_at
  before update on public.payment_order_allocations
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 5. RLS
------------------------------------------------------------------------------
alter table public.payment_orders                enable row level security;
alter table public.payment_order_payment_lines   enable row level security;
alter table public.payment_order_allocations     enable row level security;

create policy "Owners, admins and finance can view payment_orders"
  on public.payment_orders for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert payment_orders"
  on public.payment_orders for insert to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update payment_orders"
  on public.payment_orders for update to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners, admins and finance can view po payment lines"
  on public.payment_order_payment_lines for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert po payment lines"
  on public.payment_order_payment_lines for insert to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update po payment lines"
  on public.payment_order_payment_lines for update to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can delete po payment lines"
  on public.payment_order_payment_lines for delete to authenticated
  using (public.user_has_role(array['owner', 'finance']));

create policy "Owners, admins and finance can view po allocations"
  on public.payment_order_allocations for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert po allocations"
  on public.payment_order_allocations for insert to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update po allocations"
  on public.payment_order_allocations for update to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can delete po allocations"
  on public.payment_order_allocations for delete to authenticated
  using (public.user_has_role(array['owner', 'finance']));

------------------------------------------------------------------------------
-- 6. transactions: payment_order_id + counterparty_supplier_id
------------------------------------------------------------------------------
alter table public.transactions
  add column payment_order_id uuid references public.payment_orders (id) on delete set null;

alter table public.transactions
  add column counterparty_supplier_id uuid references public.suppliers (id) on delete set null;

create index transactions_payment_order_idx on public.transactions (payment_order_id)
  where payment_order_id is not null;

create index transactions_counterparty_supplier_idx on public.transactions (counterparty_supplier_id)
  where counterparty_supplier_id is not null;

comment on column public.transactions.payment_order_id is
  'OP de la que se generó esta transaction (cuando aplica). NULL si se cargó manualmente desde Caja.';
comment on column public.transactions.counterparty_supplier_id is
  'Proveedor al que se le pagó (cuando aplica). Espejo de counterparty_client_id.';

------------------------------------------------------------------------------
-- 7. Trigger: OP canceled → wipe transactions ligadas
------------------------------------------------------------------------------
create or replace function public.handle_payment_order_cancellation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'issued' and new.status = 'canceled' then
    delete from public.transactions where payment_order_id = new.id;
  end if;
  return new;
end;
$$;

create trigger payment_orders_on_cancel_clean_transactions
  after update of status on public.payment_orders
  for each row execute function public.handle_payment_order_cancellation();

------------------------------------------------------------------------------
-- 8. create_payment_order RPC (atomic + sum validation + auto-tx)
------------------------------------------------------------------------------
create or replace function public.create_payment_order(
  p_channel_id    text,
  p_punto_venta   int,
  p_numero        int,
  p_supplier_id   uuid,
  p_payment_date  date,
  p_total_amount  numeric,
  p_currency      text,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_op_id        uuid;
  v_payment_sum  numeric := 0;
  v_alloc_sum    numeric := 0;
  v_line         jsonb;
  v_account_id   uuid;
  v_amount       numeric;
  v_ref          text;
begin
  insert into public.payment_orders (
    channel_id, punto_venta, numero, supplier_id, payment_date,
    total_amount, currency, notes, status, created_by
  ) values (
    p_channel_id, p_punto_venta, p_numero, p_supplier_id, p_payment_date,
    p_total_amount, p_currency, nullif(trim(p_notes), ''), 'issued', auth.uid()
  )
  returning id into v_op_id;

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    v_account_id := (v_line->>'account_id')::uuid;
    v_amount     := (v_line->>'amount')::numeric;
    v_ref        := v_line->>'reference';

    insert into public.payment_order_payment_lines (
      payment_order_id, account_id, amount, reference
    ) values (v_op_id, v_account_id, v_amount, v_ref);

    -- Espejo de F.1: cada payment_line genera una transaction de expense
    -- en la cuenta de la que salió la plata.
    insert into public.transactions (
      account_id,
      channel_id,
      kind,
      amount,
      currency,
      transaction_date,
      accrual_month,
      description,
      counterparty_supplier_id,
      payment_order_id,
      created_by
    ) values (
      v_account_id,
      p_channel_id,
      'expense',
      v_amount,
      p_currency,
      p_payment_date,
      date_trunc('month', p_payment_date)::date,
      coalesce(v_ref, 'OP ' || lpad(p_punto_venta::text, 4, '0') || '-' || lpad(p_numero::text, 8, '0')),
      p_supplier_id,
      v_op_id,
      auth.uid()
    );

    v_payment_sum := v_payment_sum + v_amount;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.payment_order_allocations (
      payment_order_id, purchase_invoice_id, amount_applied
    ) values (
      v_op_id,
      (v_line->>'purchase_invoice_id')::uuid,
      (v_line->>'amount_applied')::numeric
    );
    v_alloc_sum := v_alloc_sum + (v_line->>'amount_applied')::numeric;
  end loop;

  if round(v_payment_sum, 2) <> round(p_total_amount, 2) then
    raise exception 'payment_lines sum (%) does not match total_amount (%)',
      v_payment_sum, p_total_amount;
  end if;

  if round(v_alloc_sum, 2) > round(p_total_amount, 2) then
    raise exception 'allocations sum (%) exceeds total_amount (%)',
      v_alloc_sum, p_total_amount;
  end if;

  return v_op_id;
end;
$$;

revoke all on function public.create_payment_order(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb) from public;
grant execute on function public.create_payment_order(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb) to authenticated;

------------------------------------------------------------------------------
-- 9. update_payment_order RPC (delete + re-insert, atomic)
------------------------------------------------------------------------------
create or replace function public.update_payment_order(
  p_id            uuid,
  p_payment_date  date,
  p_total_amount  numeric,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status       text;
  v_channel_id   text;
  v_pos          int;
  v_numero       int;
  v_supplier_id  uuid;
  v_currency     text;
  v_payment_sum  numeric := 0;
  v_alloc_sum    numeric := 0;
  v_line         jsonb;
  v_account_id   uuid;
  v_amount       numeric;
  v_ref          text;
begin
  select status, channel_id, punto_venta, numero, supplier_id, currency
    into v_status, v_channel_id, v_pos, v_numero, v_supplier_id, v_currency
  from public.payment_orders where id = p_id;

  if v_status is null then
    raise exception 'payment_order % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled payment_order (%)', p_id;
  end if;

  update public.payment_orders set
    payment_date = p_payment_date,
    total_amount = p_total_amount,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  delete from public.transactions             where payment_order_id = p_id;
  delete from public.payment_order_payment_lines where payment_order_id = p_id;
  delete from public.payment_order_allocations   where payment_order_id = p_id;

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    v_account_id := (v_line->>'account_id')::uuid;
    v_amount     := (v_line->>'amount')::numeric;
    v_ref        := v_line->>'reference';

    insert into public.payment_order_payment_lines (
      payment_order_id, account_id, amount, reference
    ) values (p_id, v_account_id, v_amount, v_ref);

    insert into public.transactions (
      account_id,
      channel_id,
      kind,
      amount,
      currency,
      transaction_date,
      accrual_month,
      description,
      counterparty_supplier_id,
      payment_order_id,
      created_by
    ) values (
      v_account_id,
      v_channel_id,
      'expense',
      v_amount,
      v_currency,
      p_payment_date,
      date_trunc('month', p_payment_date)::date,
      coalesce(v_ref, 'OP ' || lpad(v_pos::text, 4, '0') || '-' || lpad(v_numero::text, 8, '0')),
      v_supplier_id,
      p_id,
      auth.uid()
    );

    v_payment_sum := v_payment_sum + v_amount;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.payment_order_allocations (
      payment_order_id, purchase_invoice_id, amount_applied
    ) values (
      p_id,
      (v_line->>'purchase_invoice_id')::uuid,
      (v_line->>'amount_applied')::numeric
    );
    v_alloc_sum := v_alloc_sum + (v_line->>'amount_applied')::numeric;
  end loop;

  if round(v_payment_sum, 2) <> round(p_total_amount, 2) then
    raise exception 'payment_lines sum (%) does not match total_amount (%)',
      v_payment_sum, p_total_amount;
  end if;

  if round(v_alloc_sum, 2) > round(p_total_amount, 2) then
    raise exception 'allocations sum (%) exceeds total_amount (%)',
      v_alloc_sum, p_total_amount;
  end if;
end;
$$;

revoke all on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb) from public;
grant execute on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb) to authenticated;

set row_security = on;
