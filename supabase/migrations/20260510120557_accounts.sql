-- D.1 — accounts (Caja).
--
-- A single shared catalog of monetary accounts: bank accounts, cash boxes,
-- digital wallets, investment accounts, and a "checks" pseudo-account that
-- holds third-party checks in cartera. Accounts are NOT scoped to a
-- business_unit or channel — multiple channels can credit/debit the same
-- account, and the channel context is recorded on the transaction itself
-- (see D.2).
--
-- Hard delete is blocked at the RLS layer; the action layer falls back to
-- is_active = false. Once D.2 lands, deletion will require zero referencing
-- transactions, mirroring the clients pattern.

set row_security = off;

------------------------------------------------------------------------------
-- 1. accounts table
------------------------------------------------------------------------------
create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  type            text not null check (type in (
    'bank',
    'cash',
    'wallet',
    'investment',
    'checks',
    'echeq'
  )),
  currency        text not null check (currency in ('ARS', 'USD')),
  opening_balance numeric(18, 2) not null default 0,
  notes           text,
  is_active       boolean not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.accounts is
  'Caja accounts (bank, cash, wallet, investment, checks). Shared across all channels.';
comment on column public.accounts.type is
  'bank | cash | wallet | investment | checks | echeq. The checks bucket holds third-party physical checks in cartera; echeq holds electronic checks. They are kept as separate accounts so a physical deposit (or a fisico→echeq conversion) cleanly maps to a transfer transaction in D.2.';
comment on column public.accounts.opening_balance is
  'Saldo inicial al alta de la cuenta. The running balance is computed by summing transactions on top of this.';

-- Names should be unique per (type, currency) so the picker doesn't show two
-- "Caja Chica ARS" entries by mistake.
create unique index accounts_name_type_currency_idx
  on public.accounts (lower(name), type, currency);

create index accounts_is_active_idx on public.accounts (is_active);
create index accounts_type_idx      on public.accounts (type);

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------
alter table public.accounts enable row level security;

create policy "Owners, admins and finance can view accounts"
  on public.accounts for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners and finance can insert accounts"
  on public.accounts for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'finance']));

create policy "Owners and finance can update accounts"
  on public.accounts for update
  to authenticated
  using (public.user_has_role(array['owner', 'finance']))
  with check (public.user_has_role(array['owner', 'finance']));

-- Deliberately no delete policy: hard delete is blocked at RLS. Once D.2
-- lands the action layer will count referencing transactions and use the
-- service role to delete only when zero references exist (clients pattern).

------------------------------------------------------------------------------
-- 3. updated_at trigger
------------------------------------------------------------------------------
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

set row_security = on;
