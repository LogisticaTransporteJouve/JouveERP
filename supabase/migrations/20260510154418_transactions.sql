-- D.2 — transactions (Caja).
--
-- A transaction records that money moved into, out of, or between accounts.
-- Four kinds:
--   * income / expense — single-row transactions tied to one account.
--   * transfer_in / transfer_out — paired rows linked by `transfer_pair_id`,
--     created atomically by the create_transfer RPC. Each pair is two rows
--     (one in each affected account). Same currency only — multi-currency
--     transfers with conversion live in J.7.
--
-- channel_id is mandatory: every move is attributed to a division (Jouve or
-- DZ) so reports can split cashflow by business unit. When the row is tied
-- to a invoice (income from invoice, expense from supplier invoice), a
-- trigger enforces channel consistency: the transaction's channel_id must
-- equal the invoice's channel_id.
--
-- accrual_month captures *when economically* the move belongs (cashflow
-- month in accounting parlance), independent of transaction_date. E.g. a
-- December invoice paid in January: transaction_date = 2026-01-15,
-- accrual_month = 2025-12-01. CHECK enforces day=1 so the dimension is
-- always the start of the accrued month.

set row_security = off;

------------------------------------------------------------------------------
-- 1. transactions table
------------------------------------------------------------------------------
create table public.transactions (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts (id)
                             on delete restrict,
  channel_id               text not null references public.invoicing_channels (id)
                             on delete restrict,
  kind                     text not null check (kind in (
    'income',
    'expense',
    'transfer_in',
    'transfer_out'
  )),
  amount                   numeric(18, 2) not null check (amount > 0),
  currency                 text not null check (currency in ('ARS', 'USD')),
  transaction_date         date not null,
  accrual_month            date not null
                             check (extract(day from accrual_month) = 1),
  description              text,
  invoice_id           uuid references public.invoices (id)
                             on delete restrict,
  counterparty_client_id   uuid references public.clients (id)
                             on delete set null,
  transfer_pair_id         uuid references public.transactions (id)
                             on delete cascade,
  created_by               uuid references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.transactions is
  'Caja movements. Single-row income/expense or paired transfer_in/transfer_out linked via transfer_pair_id.';
comment on column public.transactions.accrual_month is
  'First day of the month this transaction is economically attributed to (cashflow accrual). May differ from transaction_date when a payment lands in a different month than the underlying obligation.';
comment on column public.transactions.transfer_pair_id is
  'Self-FK to the matching half of a transfer (transfer_in ↔ transfer_out). NULL for income/expense, NOT NULL for transfers — enforced by trigger.';

create index transactions_account_idx          on public.transactions (account_id);
create index transactions_channel_idx          on public.transactions (channel_id);
create index transactions_transaction_date_idx on public.transactions (transaction_date desc);
create index transactions_accrual_month_idx    on public.transactions (accrual_month desc);
create index transactions_invoice_idx      on public.transactions (invoice_id)
  where invoice_id is not null;
create index transactions_counterparty_idx     on public.transactions (counterparty_client_id)
  where counterparty_client_id is not null;
create index transactions_pair_idx             on public.transactions (transfer_pair_id)
  where transfer_pair_id is not null;

------------------------------------------------------------------------------
-- 2. updated_at trigger
------------------------------------------------------------------------------
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 3. Consistency triggers
------------------------------------------------------------------------------

-- (a) transfer_pair_id ⇔ kind in ('transfer_in', 'transfer_out')
create or replace function public.check_transaction_kind_pair_consistency()
returns trigger
language plpgsql
as $$
begin
  if new.kind in ('transfer_in', 'transfer_out') then
    if new.transfer_pair_id is null then
      raise exception 'transactions.kind=% requires transfer_pair_id (got NULL)',
        new.kind;
    end if;
  else
    if new.transfer_pair_id is not null then
      raise exception 'transactions.kind=% must not have a transfer_pair_id (got %)',
        new.kind, new.transfer_pair_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger transactions_kind_pair_consistency
  before insert or update of kind, transfer_pair_id on public.transactions
  for each row execute function public.check_transaction_kind_pair_consistency();

-- (b) When linked to a invoice, channel_id must match.
create or replace function public.check_transaction_channel_matches_invoice()
returns trigger
language plpgsql
as $$
declare
  v_invoice_channel text;
begin
  if new.invoice_id is null then
    return new;
  end if;
  -- to_regclass guard so the trigger is harmless if the invoices table
  -- ever vanishes (it won't, but defensive).
  if to_regclass('public.invoices') is null then
    return new;
  end if;
  select channel_id into v_invoice_channel
    from public.invoices
   where id = new.invoice_id;
  if v_invoice_channel is null then
    raise exception 'transactions.invoice_id=% references missing invoice',
      new.invoice_id;
  end if;
  if v_invoice_channel <> new.channel_id then
    raise exception 'transactions.channel_id=% does not match invoice.channel_id=% (invoice_id=%)',
      new.channel_id, v_invoice_channel, new.invoice_id;
  end if;
  return new;
end;
$$;

create trigger transactions_channel_matches_invoice
  before insert or update of channel_id, invoice_id on public.transactions
  for each row execute function public.check_transaction_channel_matches_invoice();

------------------------------------------------------------------------------
-- 4. v_transactions_tagged view
------------------------------------------------------------------------------
-- Enriches each row with channel division ('jouve' | 'dz') and is_fiscal so
-- reports can group by division without re-joining invoicing_channels.
create or replace view public.v_transactions_tagged as
select
  t.*,
  c.division        as channel_division,
  c.is_fiscal       as channel_is_fiscal,
  c.name            as channel_name,
  a.name            as account_name,
  a.type            as account_type
from public.transactions t
join public.invoicing_channels c on c.id = t.channel_id
join public.accounts           a on a.id = t.account_id;

comment on view public.v_transactions_tagged is
  'Transactions joined with their channel (division, is_fiscal) and account (name, type) for reporting.';

------------------------------------------------------------------------------
-- 5. RLS
------------------------------------------------------------------------------
alter table public.transactions enable row level security;

create policy "Owners, admins and finance can view transactions"
  on public.transactions for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert transactions"
  on public.transactions for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update transactions"
  on public.transactions for update
  to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners can delete transactions"
  on public.transactions for delete
  to authenticated
  using (public.user_has_role(array['owner']));

------------------------------------------------------------------------------
-- 6. create_transfer RPC (atomic insert of paired rows)
------------------------------------------------------------------------------
-- Inserts the two halves of a transfer in one transaction, with each row's
-- transfer_pair_id pointing at the other. Source account and destination
-- account must differ; currencies must match (multi-currency transfers go
-- through J.7 cotización flow when added).

create or replace function public.create_transfer(
  p_account_from_id   uuid,
  p_account_to_id     uuid,
  p_channel_id        text,
  p_amount            numeric,
  p_currency          text,
  p_transaction_date  date,
  p_accrual_month     date,
  p_description       text
)
returns table (transfer_out_id uuid, transfer_in_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_from_currency text;
  v_to_currency   text;
  v_out_id        uuid;
  v_in_id         uuid;
begin
  if p_account_from_id = p_account_to_id then
    raise exception 'create_transfer: source and destination accounts must differ';
  end if;

  select currency into v_from_currency from public.accounts where id = p_account_from_id;
  select currency into v_to_currency   from public.accounts where id = p_account_to_id;
  if v_from_currency is null then
    raise exception 'create_transfer: source account % not found', p_account_from_id;
  end if;
  if v_to_currency is null then
    raise exception 'create_transfer: destination account % not found', p_account_to_id;
  end if;
  if v_from_currency <> v_to_currency then
    raise exception 'create_transfer: currency mismatch (% → %); cross-currency transfers not supported',
      v_from_currency, v_to_currency;
  end if;
  if v_from_currency <> p_currency then
    raise exception 'create_transfer: payload currency % does not match accounts (%)',
      p_currency, v_from_currency;
  end if;

  -- Reserve IDs first so each row can carry the other's pointer.
  v_out_id := gen_random_uuid();
  v_in_id  := gen_random_uuid();

  insert into public.transactions (
    id, account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, transfer_pair_id, created_by
  ) values (
    v_out_id, p_account_from_id, p_channel_id, 'transfer_out', p_amount,
    p_currency, p_transaction_date, p_accrual_month,
    nullif(trim(p_description), ''), v_in_id, auth.uid()
  );

  insert into public.transactions (
    id, account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, transfer_pair_id, created_by
  ) values (
    v_in_id, p_account_to_id, p_channel_id, 'transfer_in', p_amount,
    p_currency, p_transaction_date, p_accrual_month,
    nullif(trim(p_description), ''), v_out_id, auth.uid()
  );

  return query select v_out_id, v_in_id;
end;
$$;

revoke all on function public.create_transfer(uuid, uuid, text, numeric, text, date, date, text) from public;
grant execute on function public.create_transfer(uuid, uuid, text, numeric, text, date, date, text) to authenticated;

set row_security = on;
