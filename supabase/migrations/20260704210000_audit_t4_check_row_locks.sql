-- Audit remediation T4 — add FOR UPDATE row locks to the check-lifecycle RPCs.
--
-- deposit_check / credit_check / endorse_check / reject_check did
-- `select * into v_check ... where id = p_check_id` (no lock) then a status
-- precondition check. Under READ COMMITTED two concurrent calls both read the
-- same 'en_cartera'/'depositado' state and both proceed — e.g. two deposit_check
-- calls insert two transfer pairs and the bank is credited twice. Locking the
-- row with FOR UPDATE serializes the transition; the second call blocks, then
-- re-reads the updated status and fails its precondition.
--
-- Bodies are identical to 20260510201808_checks.sql except for the added
-- `for update` on the SELECT ... INTO. Grants are preserved by CREATE OR REPLACE.

set row_security = off;

create or replace function public.deposit_check(
  p_check_id        uuid,
  p_account_id       uuid,
  p_event_date       date,
  p_channel_id       text,
  p_description      text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_out_id       uuid;
  v_in_id        uuid;
  v_movement_id  uuid;
  v_accrual      date;
begin
  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status <> 'en_cartera' then
    raise exception 'check % está en estado % — solo se puede depositar desde en_cartera',
      p_check_id, v_check.status;
  end if;

  v_accrual := date_trunc('month', p_event_date)::date;
  v_out_id := gen_random_uuid();
  v_in_id  := gen_random_uuid();

  insert into public.transactions (
    id, account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, transfer_pair_id, created_by
  ) values
    (v_out_id, v_check.cartera_account_id, p_channel_id, 'transfer_out',
     v_check.amount, v_check.currency, p_event_date, v_accrual,
     coalesce(nullif(trim(p_description), ''),
              'Depósito check ' || v_check.check_number),
     v_in_id, auth.uid()),
    (v_in_id, p_account_id, p_channel_id, 'transfer_in',
     v_check.amount, v_check.currency, p_event_date, v_accrual,
     coalesce(nullif(trim(p_description), ''),
              'Depósito check ' || v_check.check_number),
     v_out_id, auth.uid());

  update public.checks
     set status = 'depositado'
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, transaction_id,
    notes, created_by
  ) values (
    p_check_id, 'deposited', p_event_date, p_account_id, v_out_id,
    nullif(trim(p_description), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

create or replace function public.credit_check(
  p_check_id   uuid,
  p_event_date  date,
  p_notes       text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_movement_id  uuid;
begin
  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status <> 'depositado' then
    raise exception 'check % está en estado % — solo se puede acreditar desde depositado',
      p_check_id, v_check.status;
  end if;

  update public.checks
     set status = 'acreditado'
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, notes, created_by
  ) values (
    p_check_id, 'credited', p_event_date,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

-- NOTE: endorse_check is intentionally NOT re-emitted here — the standalone RPC
-- was dropped in 20260514221121 (endorsing now goes through create_payment_order's
-- endorse_check line type).

create or replace function public.reject_check(
  p_check_id        uuid,
  p_account_id       uuid,
  p_event_date       date,
  p_channel_id       text,
  p_notes            text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_movement_id  uuid;
  v_accrual      date;
begin
  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status not in ('depositado', 'en_cartera') then
    raise exception 'check % está en estado % — solo se puede rechazar desde depositado o en_cartera',
      p_check_id, v_check.status;
  end if;

  v_accrual := date_trunc('month', p_event_date)::date;

  if v_check.status = 'depositado' then
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, created_by
    ) values (
      p_account_id, p_channel_id, 'expense',
      v_check.amount, v_check.currency, p_event_date, v_accrual,
      'Cheque rechazado ' || v_check.check_number, auth.uid()
    );
  end if;

  update public.checks
     set status = 'rechazado'
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, notes, created_by
  ) values (
    p_check_id, 'rejected', p_event_date, p_account_id,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

set row_security = on;
