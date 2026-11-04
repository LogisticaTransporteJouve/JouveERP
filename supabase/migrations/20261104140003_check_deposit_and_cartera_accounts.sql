SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W7 · S2 F3 and S4 N1: a cartera holds exactly the checks in it.
--
-- 1. deposit_check never read p_account_id's row: a check could be
--    «deposited» into another cartera (which gained the amount with no check
--    in it) or into its own (which netted 0 while the check left it). It now
--    takes only what the deposit dialog offers: an active bank account in the
--    check's currency, with the messages sell_checks uses.
-- 2. A check inserted into a bank or cash account as its cartera booked a
--    «Cheque recibido» income there (checks_manual_inflow) and sat
--    «en cartera» of a bank. guard_check_edit now refuses on INSERT a
--    cartera_account_id whose type is not checks / echeq, the check the AI
--    scan and commit_import_run already make; create_receipt and
--    update_receipt only create a check on a line of that type.
-- 3. The 'received' anchor «Nuevo cheque» inserts took any created_at,
--    created_by and event_date: an anchor dated 2999 stayed the latest
--    movement, so cancel_check_sale refused «Anular venta» for good, and the
--    timeline credited another user. guard_check_movement now writes them:
--    now(), auth.uid() and the check's issue_date, which is what
--    createCheckAction and the seed send.
--
-- Existing rows are not touched.
--
-- Rollback: older code deposits only into the accounts the dialog lists,
-- inserts checks only into carteras and sends the anchor with those values,
-- so it is unaffected.

-- Same as 20261031171711 plus the destination account check.
create or replace function public.deposit_check(
  p_check_id    uuid,
  p_account_id  uuid,
  p_event_date  date,
  p_channel_id  text,
  p_description text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_account      public.accounts%rowtype;
  v_channel      text;
  v_out_id       uuid;
  v_in_id        uuid;
  v_movement_id  uuid;
  v_accrual      date;
begin
  -- Role guard (cheques:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para depositar cheques'
      using errcode = '42501';
  end if;

  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status <> 'en_cartera' then
    raise exception 'check % está en estado % — solo se puede depositar desde en_cartera',
      p_check_id, v_check.status;
  end if;

  if v_check.channel_id is not null then
    if p_channel_id is not null and p_channel_id <> v_check.channel_id then
      raise exception 'El cheque ya tiene canal: se deposita en el canal del cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_channel := v_check.channel_id;
  elsif p_channel_id is null then
    raise exception 'El cheque no tiene canal: elegí el canal del depósito'
      using errcode = '23514', hint = 'jouve_guard';
  else
    v_channel := p_channel_id;
  end if;

  select * into v_account from public.accounts where id = p_account_id;
  if v_account.id is null or not v_account.is_active then
    raise exception 'La cuenta destino no existe o está inactiva.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_account.type <> 'bank' then
    raise exception 'Un cheque se deposita en una cuenta bancaria, no en una cartera de cheques, caja o billetera.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_account.currency <> v_check.currency then
    raise exception 'La cuenta bancaria es de otra moneda que el cheque.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_accrual := date_trunc('month', p_event_date)::date;
  v_out_id := gen_random_uuid();
  v_in_id  := gen_random_uuid();

  insert into public.transactions (
    id, account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, transfer_pair_id, created_by
  ) values
    (v_out_id, v_check.cartera_account_id, v_channel, 'transfer_out',
     v_check.amount, v_check.currency, p_event_date, v_accrual,
     coalesce(nullif(trim(p_description), ''),
              'Depósito check ' || v_check.check_number),
     v_in_id, auth.uid()),
    (v_in_id, p_account_id, v_channel, 'transfer_in',
     v_check.amount, v_check.currency, p_event_date, v_accrual,
     coalesce(nullif(trim(p_description), ''),
              'Depósito check ' || v_check.check_number),
     v_out_id, auth.uid());

  update public.checks
     set status = 'depositado',
         channel_id = v_channel
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

revoke all on function public.deposit_check(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.deposit_check(uuid, uuid, date, text, text) to authenticated, service_role;

-- Same as 20261104132000 plus the cartera account check on INSERT.
create or replace function public.guard_check_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.accounts a
       where a.id = new.cartera_account_id and a.type in ('checks', 'echeq')
    ) then
      raise exception 'La cuenta de cartera de un cheque tiene que ser una cartera de cheques (físicos o echeq)'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if new.status = 'en_cartera'
       and new.source_kind = 'manual'
       and new.source_receipt_id is null
       and new.source_payment_line_id is null then
      return new;
    end if;
    get diagnostics v_stack = pg_context;
    if v_stack ~ 'function (public\.)?(create_receipt|update_receipt)\(' then
      return new;
    end if;
    raise exception 'Un cheque de terceros entra a la cartera solo desde su recibo o cargándolo a mano: no se puede insertar con otro estado ni ligado a un recibo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.amount                 is not distinct from old.amount
     and new.currency               is not distinct from old.currency
     and new.cartera_account_id     is not distinct from old.cartera_account_id
     and new.source_kind            is not distinct from old.source_kind
     and new.source_receipt_id      is not distinct from old.source_receipt_id
     and new.source_payment_line_id is not distinct from old.source_payment_line_id
     and new.source_client_id       is not distinct from old.source_client_id
     and new.status                 is not distinct from old.status then
    return new;
  end if;

  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(deposit_check|credit_check|reject_check|sell_checks|reject_sold_check_as_debt|create_payment_order|update_payment_order)\(' then
    return new;
  end if;

  raise exception 'El monto, la moneda, la cartera, el origen (recibo o cliente) y el estado de un cheque se cambian solo desde sus acciones (depositar, acreditar, rechazar, vender) o desde la orden de pago que lo endosa'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_check_edit() from public, anon, authenticated;

-- Same as 20261104132000; the 'received' anchor gets its stamps and date
-- from the database.
create or replace function public.guard_check_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  get diagnostics v_stack = pg_context;
  if v_stack ~ 'function (public\.)?(deposit_check|credit_check|reject_check|sell_checks|reject_sold_check_as_debt|create_payment_order|update_payment_order|create_receipt|update_receipt|commit_import_run|undo_import_run)\(' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT'
     and new.event = 'received'
     and new.destination_account_id is null
     and new.transaction_id is null
     and new.endorsed_to_name is null
     and new.endorsed_to_cuit is null
     and not exists (
       select 1 from public.check_movements m where m.check_id = new.check_id
     ) then
    new.created_at := now();
    new.created_by := auth.uid();
    new.event_date := coalesce(
      (select k.issue_date from public.checks k where k.id = new.check_id),
      new.event_date
    );
    return new;
  end if;

  raise exception 'El historial de un cheque lo escriben solo sus acciones (depositar, acreditar, rechazar, vender), su recibo o la orden de pago que lo endosa'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_check_movement() from public, anon, authenticated;
