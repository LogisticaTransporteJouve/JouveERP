-- Consistency fix: el ajuste de saldo de cliente quedó owner-only
-- (apply_client_opening_balance + clear). El de cuenta seguía abierto a
-- finance|admin|owner — esta migración lo iguala. Acepta solo owner para
-- aplicar o borrar el ajuste de cuenta.

set row_security = off;

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
  if not public.user_has_role(array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, currency, opening_balance into v_account
  from public.accounts where id = p_account_id;
  if not found then
    raise exception 'account % does not exist', p_account_id;
  end if;

  select adjustment_transaction_id into v_prior_tx_id
  from public.account_opening_balances where account_id = p_account_id;

  delete from public.account_opening_balances where account_id = p_account_id;

  if v_prior_tx_id is not null then
    delete from public.transactions where id = v_prior_tx_id;
  end if;

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

create or replace function public.clear_account_opening_balance(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior_tx_id uuid;
begin
  if not public.user_has_role(array['owner']) then
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

set row_security = on;
