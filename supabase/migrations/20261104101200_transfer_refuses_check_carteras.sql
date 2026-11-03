SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A transfer never moves money in or out of a check cartera (audit w1-s2
-- F10). A cartera (accounts.type checks / echeq) holds exactly the checks in
-- it; only the check flows (receive, deposit, endorse, sell, reject) change
-- it. create_transfer (20260706090100, every case kept) now refuses a
-- cartera on either side, as createTransactionAction already did for a
-- loose movement, and runs on search_path = ''.
--
-- Rollback: older code calls create_transfer with the same arguments; its
-- form already left carteras out.

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
set search_path = ''
as $$
declare
  v_from_currency text;
  v_to_currency   text;
  v_from_type     text;
  v_to_type       text;
  v_out_id        uuid;
  v_in_id         uuid;
begin
  -- Role guard (transactions:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para crear transferencias'
      using errcode = '42501';
  end if;

  if p_account_from_id = p_account_to_id then
    raise exception 'create_transfer: source and destination accounts must differ';
  end if;

  select currency, type into v_from_currency, v_from_type from public.accounts where id = p_account_from_id;
  select currency, type into v_to_currency, v_to_type     from public.accounts where id = p_account_to_id;
  if v_from_currency is null then
    raise exception 'create_transfer: source account % not found', p_account_from_id;
  end if;
  if v_to_currency is null then
    raise exception 'create_transfer: destination account % not found', p_account_to_id;
  end if;
  if v_from_type in ('checks', 'echeq') or v_to_type in ('checks', 'echeq') then
    raise exception 'Una cartera de cheques no se transfiere: sus movimientos son los de sus cheques (depositar, endosar, vender)'
      using errcode = '23514', hint = 'jouve_guard';
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

revoke all on function public.create_transfer(uuid, uuid, text, numeric, text, date, date, text) from public, anon, authenticated;
grant execute on function public.create_transfer(uuid, uuid, text, numeric, text, date, date, text) to authenticated, service_role;
