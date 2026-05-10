-- F.3 — receipts (recibos editables, internal-only).
--
-- A recibo records that a client paid us. Each row is purely internal — no
-- AFIP roundtrip — but follows the same per-channel correlativo pattern as
-- comprobantes so the display reads `R{POS:4}-{numero:8}`, e.g.
-- `R0003-00000001`.
--
-- Two child tables hold the breakdown:
--   * receipt_payment_lines — how the money actually came in (one row per
--     account that received funds; method is derived from the account's
--     type — cash | bank transfer | cheque físico | echeq | wallet).
--   * receipt_allocations  — which comprobantes the receipt cancels and how
--     much it applies to each. The remainder, if any, stays "a cuenta".
--
-- Editing is allowed — fundamental fields can change post-issue (the user
-- explicitly opted into this; later we may lock once retentions and bank
-- reconciliations land in F.5/F.7). Hard delete is blocked at the RLS
-- layer; cancellation flips status to `canceled` so the row keeps its slot
-- in the correlativo. The unique number is enforced by a partial unique
-- index that ignores canceled rows so reissuing a number after a mistake is
-- not legal — gaps are preferable to mutating audit history.

set row_security = off;

------------------------------------------------------------------------------
-- 1. receipts table
------------------------------------------------------------------------------
create table public.receipts (
  id              uuid primary key default gen_random_uuid(),
  channel_id      text not null references public.invoicing_channels (id)
                    on delete restrict,
  punto_venta     int  not null check (punto_venta between 1 and 99999),
  numero          int  not null check (numero >= 1),
  client_id       uuid not null references public.clients (id) on delete restrict,
  recibo_date     date not null,
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

comment on table public.receipts is
  'Internal recibos. Per-channel correlativo. Editable post-issue, never deletable; cancel by setting status=canceled.';
comment on column public.receipts.numero is
  'Per-channel sequential number. The first receipt of each channel is user-overridable so the business can keep numbering continuity from a prior system.';

-- Strict unique index on the correlativo. Canceled rows still hold their
-- slot — we deliberately do NOT exclude them so the same number cannot be
-- re-used after cancellation.
create unique index receipts_channel_pos_numero_idx
  on public.receipts (channel_id, punto_venta, numero);

create index receipts_client_idx       on public.receipts (client_id);
create index receipts_recibo_date_idx  on public.receipts (recibo_date desc);
create index receipts_channel_idx      on public.receipts (channel_id, recibo_date desc);
create index receipts_status_idx       on public.receipts (status);

------------------------------------------------------------------------------
-- 2. receipt_payment_lines
------------------------------------------------------------------------------
create table public.receipt_payment_lines (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.receipts (id) on delete cascade,
  account_id  uuid not null references public.accounts (id) on delete restrict,
  amount      numeric(18, 2) not null check (amount > 0),
  reference   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.receipt_payment_lines is
  'Money in. One row per account that received funds. Method is derived from the account type (cash | bank transfer | cheque | echeq | wallet).';

create index receipt_payment_lines_receipt_idx on public.receipt_payment_lines (receipt_id);
create index receipt_payment_lines_account_idx on public.receipt_payment_lines (account_id);

------------------------------------------------------------------------------
-- 3. receipt_allocations
------------------------------------------------------------------------------
create table public.receipt_allocations (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.receipts (id) on delete cascade,
  comprobante_id  uuid not null references public.comprobantes (id) on delete restrict,
  amount_applied  numeric(18, 2) not null check (amount_applied > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.receipt_allocations is
  'Which comprobantes the receipt cancels and how much. The leftover, if any, sits "a cuenta".';

-- A given comprobante can be partially paid by multiple receipts but a
-- single receipt should not allocate twice to the same comprobante.
create unique index receipt_allocations_unique_pair_idx
  on public.receipt_allocations (receipt_id, comprobante_id);

create index receipt_allocations_comprobante_idx on public.receipt_allocations (comprobante_id);

------------------------------------------------------------------------------
-- 4. updated_at triggers
------------------------------------------------------------------------------
create trigger receipts_set_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

create trigger receipt_payment_lines_set_updated_at
  before update on public.receipt_payment_lines
  for each row execute function public.set_updated_at();

create trigger receipt_allocations_set_updated_at
  before update on public.receipt_allocations
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 5. RLS
------------------------------------------------------------------------------
alter table public.receipts                enable row level security;
alter table public.receipt_payment_lines   enable row level security;
alter table public.receipt_allocations     enable row level security;

-- RECEIPTS ------------------------------------------------------------------
create policy "Owners, admins and finance can view receipts"
  on public.receipts for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert receipts"
  on public.receipts for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update receipts"
  on public.receipts for update
  to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

-- Hard delete deliberately blocked. Cancellation flips status; the
-- correlativo stays auditable.

-- PAYMENT LINES -------------------------------------------------------------
create policy "Owners, admins and finance can view receipt payment lines"
  on public.receipt_payment_lines for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert receipt payment lines"
  on public.receipt_payment_lines for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update receipt payment lines"
  on public.receipt_payment_lines for update
  to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can delete receipt payment lines"
  on public.receipt_payment_lines for delete
  to authenticated
  using (public.user_has_role(array['owner', 'finance']));

-- ALLOCATIONS ---------------------------------------------------------------
create policy "Owners, admins and finance can view receipt allocations"
  on public.receipt_allocations for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert receipt allocations"
  on public.receipt_allocations for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update receipt allocations"
  on public.receipt_allocations for update
  to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can delete receipt allocations"
  on public.receipt_allocations for delete
  to authenticated
  using (public.user_has_role(array['owner', 'finance']));

------------------------------------------------------------------------------
-- 6. create_receipt RPC (atomic insert with sum validation)
------------------------------------------------------------------------------
-- All-in-one server-side function so the receipt + payment lines +
-- allocations land in a single transaction with sum validation. The action
-- layer calls this; RLS still applies (security invoker).

create or replace function public.create_receipt(
  p_channel_id    text,
  p_punto_venta   int,
  p_numero        int,
  p_client_id     uuid,
  p_recibo_date   date,
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
  v_receipt_id   uuid;
  v_payment_sum  numeric := 0;
  v_alloc_sum    numeric := 0;
  v_line         jsonb;
begin
  insert into public.receipts (
    channel_id, punto_venta, numero, client_id, recibo_date,
    total_amount, currency, notes, status, created_by
  ) values (
    p_channel_id, p_punto_venta, p_numero, p_client_id, p_recibo_date,
    p_total_amount, p_currency, nullif(trim(p_notes), ''), 'issued', auth.uid()
  )
  returning id into v_receipt_id;

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      v_receipt_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    );
    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (
      receipt_id, comprobante_id, amount_applied
    ) values (
      v_receipt_id,
      (v_line->>'comprobante_id')::uuid,
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

  return v_receipt_id;
end;
$$;

revoke all on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb) from public;
grant execute on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb) to authenticated;

------------------------------------------------------------------------------
-- 7. update_receipt RPC (replace lines + allocations atomically)
------------------------------------------------------------------------------
-- The action layer calls this when the user edits a receipt. We delete and
-- re-insert child rows because diffing N lines vs. M lines server-side is
-- noise; the receipt header is immutable except for date/total/notes.

create or replace function public.update_receipt(
  p_id            uuid,
  p_recibo_date   date,
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
  v_payment_sum  numeric := 0;
  v_alloc_sum    numeric := 0;
  v_line         jsonb;
begin
  select status into v_status from public.receipts where id = p_id;
  if v_status is null then
    raise exception 'receipt % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled receipt (%)', p_id;
  end if;

  update public.receipts set
    recibo_date  = p_recibo_date,
    total_amount = p_total_amount,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  delete from public.receipt_payment_lines where receipt_id = p_id;
  delete from public.receipt_allocations    where receipt_id = p_id;

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      p_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    );
    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (
      receipt_id, comprobante_id, amount_applied
    ) values (
      p_id,
      (v_line->>'comprobante_id')::uuid,
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

revoke all on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb) from public;
grant execute on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb) to authenticated;

set row_security = on;
