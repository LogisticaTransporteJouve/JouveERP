-- Account opening balances (ajuste de saldo de cuenta).
--
-- Caso de uso: el usuario sabe que la caja "Banco Galicia" tenía $100.000
-- al 2026-05-01, pero el sistema calcula otro número (porque no se cargaron
-- las transacciones históricas o están imperfectas). Fija el target y el
-- sistema inserta una transaction de ajuste por la diferencia.
--
-- Diseño:
--   * Una sola row por account (PK = account_id), editable.
--   * La metadata vive en account_opening_balances; la transaction de
--     ajuste vive en transactions (kind = income | expense según signo).
--   * Re-correr la RPC borra el adjustment_transaction_id anterior + la
--     metadata, y recrea ambas con el nuevo cálculo.
--   * Channel: requerido para respetar el NOT NULL de transactions.
--     El caller pasa un internal channel (jouve_internal / dz_internal)
--     porque el ajuste no es un movimiento fiscal real.

set row_security = off;

-- 1. Tabla --------------------------------------------------------------

create table public.account_opening_balances (
  account_id                uuid primary key references public.accounts(id) on delete cascade,
  adjustment_date           date not null,
  target_balance            numeric(14, 2) not null,
  adjustment_transaction_id uuid references public.transactions(id) on delete set null,
  notes                     text,
  created_by                uuid references auth.users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.account_opening_balances is
  'Saldo de apertura por cuenta. target_balance = saldo real al adjustment_date. La diferencia con el calculado se materializa en una transaction de ajuste enlazada vía adjustment_transaction_id. Editable (sobrescribe).';

create trigger account_opening_balances_set_updated_at
  before update on public.account_opening_balances
  for each row execute function public.set_updated_at();

-- 2. RLS ----------------------------------------------------------------

alter table public.account_opening_balances enable row level security;

create policy "Finance can view account opening balances"
  on public.account_opening_balances for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

-- writes solo via RPC (security definer).

-- 3. RPC apply_account_opening_balance ---------------------------------

create or replace function public.apply_account_opening_balance(
  p_account_id      uuid,
  p_adjustment_date date,
  p_target_balance  numeric,
  p_channel_id      text,
  p_notes           text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id              uuid := auth.uid();
  v_account              record;
  v_calculated_balance   numeric(14, 2);
  v_diff                 numeric(14, 2);
  v_kind                 text;
  v_new_tx_id            uuid;
  v_prior_tx_id          uuid;
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, currency, opening_balance into v_account
  from public.accounts where id = p_account_id;
  if not found then
    raise exception 'account % does not exist', p_account_id;
  end if;

  -- 1) Borrar adjustment previo si existe. Captura el transaction_id para
  --    borrarlo después de remover la fila padre (sino la FK desde
  --    accounts_opening_balances al transaction bloquea el delete).
  select adjustment_transaction_id into v_prior_tx_id
  from public.account_opening_balances where account_id = p_account_id;

  delete from public.account_opening_balances where account_id = p_account_id;

  if v_prior_tx_id is not null then
    delete from public.transactions where id = v_prior_tx_id;
  end if;

  -- 2) Calcular balance "real" del sistema al p_adjustment_date.
  --    Suma opening_balance del account (legacy de D.1) + flujo neto de
  --    transactions con transaction_date <= p_adjustment_date.
  --    Para transfer_in / transfer_out se respeta el signo: el in suma,
  --    el out resta.
  select
    coalesce(v_account.opening_balance, 0)
    + coalesce(sum(
        case
          when t.kind in ('income', 'transfer_in') then t.amount
          when t.kind in ('expense', 'transfer_out') then -t.amount
          else 0
        end
      ), 0)
    into v_calculated_balance
  from public.transactions t
  where t.account_id = p_account_id
    and t.transaction_date <= p_adjustment_date;

  v_diff := p_target_balance - v_calculated_balance;

  -- 3) Insertar la transaction de ajuste si hay diferencia.
  if v_diff > 0 then
    v_kind := 'income';
  elsif v_diff < 0 then
    v_kind := 'expense';
  else
    v_kind := null;
  end if;

  if v_kind is not null then
    insert into public.transactions (
      account_id,
      channel_id,
      kind,
      amount,
      currency,
      transaction_date,
      accrual_month,
      description,
      created_by
    ) values (
      p_account_id,
      p_channel_id,
      v_kind,
      abs(v_diff),
      v_account.currency,
      p_adjustment_date,
      date_trunc('month', p_adjustment_date)::date,
      'Ajuste de saldo de apertura',
      v_user_id
    ) returning id into v_new_tx_id;
  end if;

  insert into public.account_opening_balances (
    account_id,
    adjustment_date,
    target_balance,
    adjustment_transaction_id,
    notes,
    created_by
  ) values (
    p_account_id,
    p_adjustment_date,
    p_target_balance,
    v_new_tx_id,
    p_notes,
    v_user_id
  );
end;
$$;

revoke execute on function public.apply_account_opening_balance(uuid, date, numeric, text, text) from public;
grant execute on function public.apply_account_opening_balance(uuid, date, numeric, text, text) to authenticated;

comment on function public.apply_account_opening_balance(uuid, date, numeric, text, text) is
  'Fija o sobrescribe el saldo de la cuenta al adjustment_date. Calcula la diferencia contra el saldo del sistema y la materializa en una transaction (kind = income | expense). Re-correr borra el ajuste anterior + recrea atómicamente.';

-- 4. RPC clear_account_opening_balance --------------------------------

create or replace function public.clear_account_opening_balance(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior_tx_id uuid;
begin
  if not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select adjustment_transaction_id into v_prior_tx_id
  from public.account_opening_balances where account_id = p_account_id;

  delete from public.account_opening_balances where account_id = p_account_id;

  if v_prior_tx_id is not null then
    delete from public.transactions where id = v_prior_tx_id;
  end if;
end;
$$;

revoke execute on function public.clear_account_opening_balance(uuid) from public;
grant execute on function public.clear_account_opening_balance(uuid) to authenticated;

set row_security = on;
