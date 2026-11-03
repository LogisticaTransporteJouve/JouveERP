SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Checks paid to a supplier post in pesos at the payment order's rate, on
-- the day of the event (audit w2-s2 F1, w1-s2 F11, w1-s4 F5).
--
--   0. payment_order_rate(order): the rate a payment order books at (its
--      cotización, else the BCRA rate of its payment date, else 1; 1 for
--      ARS), the fallback build_payment_order_journal_lines uses inline.
--   1. emit_journal_for_issued_check_transition (20261104093300, every case
--      kept): an own check from a USD payment order was cashed, rejected or
--      annulled at its dollar amount as pesos, while the order credited
--      cheques_diferidos_emitidos at round(amount × rate, 2). The three
--      transitions now post at the order's rate (0), so the liability
--      reverses exactly. A rejection posts on rejected_at and an annulment
--      on its day (they posted on today).
--   2. emit_journal_for_endorsed_check_rejected (20261031192133, every case
--      kept): an endorsed USD check that bounces gives back proveedores at
--      the order's rate, and posts on the date of the rejection movement,
--      not on today.
--   3. reject_check (20261103100200, every case kept): writes the
--      'rejected' movement before the status, so the trigger of 2 reads its
--      date; and runs on search_path = '' (the body is fully qualified).
--
-- Not covered: a cashing-day rate difference on the bank side of a USD own
-- check (the bank is credited at the order's rate), and entries already
-- posted (docs/pendientes.md).
--
-- Rollback: older code issues the same updates and calls reject_check with
-- the same arguments.

------------------------------------------------------------------------------
-- 0. The rate a payment order books at
------------------------------------------------------------------------------

create function public.payment_order_rate(p_payment_order public.payment_orders)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when p_payment_order.currency = 'USD' then coalesce(
      nullif(p_payment_order.cotizacion, 0),
      public.get_exchange_rate('USD', p_payment_order.payment_date),
      1
    )
    else 1
  end
$$;

comment on function public.payment_order_rate(public.payment_orders) is
  'Cotización con la que se asienta una orden de pago: la suya, la del BCRA de su fecha o 1 (1 en pesos). Interna (asientos de cheques entregados).';

revoke all on function public.payment_order_rate(public.payment_orders) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 1. Own checks
------------------------------------------------------------------------------

create or replace function public.emit_journal_for_issued_check_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_role public.coa_system_role;
  v_lines     jsonb;
  v_desc      text;
  v_amount    numeric;
  v_date      date;
  v_expense   uuid;
  v_po        public.payment_orders%rowtype;
begin
  -- Solo procesamos transiciones desde emitted.
  if old.status <> 'emitted' then
    return new;
  end if;
  if new.status not in ('cashed', 'rejected', 'cancelled') then
    return new;
  end if;

  if new.channel_id is not null and not public.is_channel_fiscal(new.channel_id) then
    return new;
  end if;

  -- A hand-loaded check (no payment order) never booked a supplier liability:
  -- rejecting or annulling it has nothing to give back.
  if new.payment_order_id is null and new.status in ('rejected', 'cancelled') then
    return new;
  end if;

  if new.status = 'cancelled' and exists (
    select 1 from public.payment_orders po
     where po.id = new.payment_order_id and po.status = 'canceled'
  ) then
    return new;
  end if;

  -- Cuenta bancaria mapeada
  v_bank_role := public.coa_role_for_account(new.bank_account_id);
  if v_bank_role is null then
    raise warning 'emit_journal_for_issued_check: bank_account % sin COA role', new.bank_account_id;
    return new;
  end if;

  v_date := coalesce(
    case new.status
      when 'cashed'    then new.cashed_at
      when 'rejected'  then new.rejected_at
      else (new.cancelled_at at time zone 'America/Argentina/Buenos_Aires')::date
    end,
    current_date
  );
  v_amount := new.amount;

  if new.status = 'cashed' and new.payment_order_id is null then
    -- A hand-loaded check is the payment itself: it has no liability to
    -- reverse, so it is an expense (the supplier's default account, if any).
    -- The journal is in pesos: a USD check posts at the rate of its cashing
    -- day (the date of its bank outflow), and with no rate it posts nothing.
    if new.currency = 'USD' then
      v_amount := round(new.amount * public.get_exchange_rate('USD', v_date), 2);
      if v_amount is null then
        raise warning 'emit_journal_for_issued_check: sin cotización USD (issued_check=%)', new.id;
        return new;
      end if;
    end if;
    v_desc := 'Cobro cheque propio #' || new.check_number || ' ' || new.bank_name;
    select s.default_expense_account_id into v_expense
      from public.suppliers s
     where s.id = new.supplier_id;
    v_lines := jsonb_build_array(
      case when v_expense is not null
        then jsonb_build_object('account_id', v_expense, 'debit', v_amount, 'description', v_desc || ' — gasto')
        else jsonb_build_object('system_role', 'gastos', 'debit', v_amount, 'description', v_desc || ' — gasto')
      end,
      jsonb_build_object('system_role', v_bank_role::text, 'credit', v_amount, 'description', v_desc || ' — egreso banco')
    );
  else
    -- A check from a payment order reverses what the order credited to
    -- cheques_diferidos_emitidos: the same pesos, at the order's rate
    -- (build_payment_order_journal_lines).
    select * into v_po from public.payment_orders where id = new.payment_order_id;
    v_amount := round(new.amount * public.payment_order_rate(v_po), 2);

    if new.status = 'cashed' then
      v_desc := 'Cobro cheque propio #' || new.check_number || ' ' || new.bank_name;
      v_lines := jsonb_build_array(
        jsonb_build_object('system_role', 'cheques_diferidos_emitidos', 'debit', v_amount, 'description', v_desc || ' — revierte pasivo'),
        jsonb_build_object('system_role', v_bank_role::text,            'credit', v_amount, 'description', v_desc || ' — egreso banco')
      );
    else
      -- rejected / cancelled: la obligación con el proveedor vuelve a aparecer.
      v_desc := case new.status
        when 'rejected'  then 'Rechazo cheque propio #'
        when 'cancelled' then 'Anulación cheque propio #'
      end || new.check_number || ' ' || new.bank_name;
      v_lines := jsonb_build_array(
        jsonb_build_object('system_role', 'cheques_diferidos_emitidos', 'debit',  v_amount, 'description', v_desc || ' — revierte pasivo'),
        jsonb_build_object('system_role', 'proveedores',                'credit', v_amount, 'description', v_desc || ' — deuda vuelve a aparecer')
      );
    end if;
  end if;

  begin
    perform public.create_journal_entry(
      p_entry_date     := v_date,
      p_accrual_period := to_char(v_date, 'YYYY-MM'),
      p_description    := v_desc,
      p_lines          := v_lines,
      p_source_table   := 'issued_checks',
      p_source_id      := new.id,
      p_channel_id     := new.channel_id
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_issued_check: % (issued_check=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

revoke all on function public.emit_journal_for_issued_check_transition() from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2. Endorsed third-party checks
------------------------------------------------------------------------------

create or replace function public.emit_journal_for_endorsed_check_rejected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po         public.payment_orders%rowtype;
  v_amount     numeric;
  v_desc       text;
  v_date       date;
begin
  if old.status <> 'endosado' or new.status <> 'rechazado' then
    return new;
  end if;

  select po.*
    into v_po
    from public.payment_order_payment_lines pl
    join public.payment_orders po on po.id = pl.payment_order_id
   where pl.endorsed_check_id = new.id
     and po.status <> 'canceled'
   order by po.created_at desc, po.id desc
   limit 1;

  if v_po.id is null then
    raise warning 'Cheque endosado % rechazado sin OP asociada — no se emite reversal', new.id;
    return new;
  end if;

  if not public.is_channel_fiscal(v_po.channel_id) then
    return new;
  end if;

  select pl.amount into v_amount
    from public.payment_order_payment_lines pl
   where pl.payment_order_id = v_po.id and pl.endorsed_check_id = new.id
   order by pl.created_at, pl.id
   limit 1;
  -- The order credited cheques_cartera at its own rate: the same pesos go
  -- back to proveedores.
  v_amount := round(v_amount * public.payment_order_rate(v_po), 2);

  -- reject_check writes the movement before the status.
  select m.event_date into v_date
    from public.check_movements m
   where m.check_id = new.id and m.event = 'rejected'
   order by m.created_at desc, m.id desc
   limit 1;
  v_date := coalesce(v_date, current_date);

  v_desc := 'Rechazo cheque endosado #' || new.check_number || ' ' || new.bank_name;

  begin
    perform public.create_journal_entry(
      p_entry_date     := v_date,
      p_accrual_period := to_char(v_date, 'YYYY-MM'),
      p_description    := v_desc,
      p_lines          := jsonb_build_array(
        jsonb_build_object('system_role', 'cheques_rechazados', 'debit',  v_amount, 'description', v_desc || ' — deudor por cheque rechazado'),
        jsonb_build_object('system_role', 'proveedores',        'credit', v_amount, 'description', v_desc || ' — deuda vuelve')
      ),
      p_source_table   := 'checks',
      p_source_id      := new.id,
      p_channel_id     := v_po.channel_id
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_endorsed_check_rejected: % (check=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

revoke all on function public.emit_journal_for_endorsed_check_rejected() from public, anon, authenticated;
grant execute on function public.emit_journal_for_endorsed_check_rejected() to service_role;

------------------------------------------------------------------------------
-- 3. reject_check
------------------------------------------------------------------------------

create or replace function public.reject_check(
  p_check_id   uuid,
  p_account_id uuid,
  p_event_date date,
  p_channel_id text,
  p_notes      text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_check       public.checks%rowtype;
  v_channel      text;
  v_account_id   uuid;
  v_tx_id        uuid;
  v_movement_id  uuid;
  v_accrual      date;
begin
  -- Role guard (cheques:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para rechazar cheques'
      using errcode = '42501';
  end if;

  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status not in ('depositado', 'en_cartera', 'endosado', 'vendido') then
    raise exception 'check % está en estado % — solo se puede rechazar desde depositado, en_cartera, endosado o vendido',
      p_check_id, v_check.status;
  end if;

  if v_check.channel_id is not null then
    if p_channel_id is not null and p_channel_id <> v_check.channel_id then
      raise exception 'El cheque ya tiene canal: el rechazo va en el canal del cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_channel := v_check.channel_id;
  elsif p_channel_id is null then
    raise exception 'El cheque no tiene canal: elegí el canal del rechazo'
      using errcode = '23514', hint = 'jouve_guard';
  else
    v_channel := p_channel_id;
  end if;

  if v_check.status = 'depositado' then
    select m.destination_account_id into v_account_id
      from public.check_movements m
     where m.check_id = p_check_id and m.event = 'deposited'
     order by m.created_at desc, m.id desc
     limit 1;
    if v_account_id is null then
      v_account_id := p_account_id;
    elsif p_account_id is not null and p_account_id <> v_account_id then
      raise exception 'El rechazo sale de la cuenta donde se depositó el cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_account_id is null then
      raise exception 'El cheque no tiene cuenta de depósito: elegí la cuenta del rechazo'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  elsif v_check.status = 'vendido' then
    select m.destination_account_id into v_account_id
      from public.check_movements m
     where m.check_id = p_check_id and m.event = 'sold'
     order by m.created_at desc, m.id desc
     limit 1;
    v_account_id := coalesce(p_account_id, v_account_id);
    if v_account_id is null then
      raise exception 'Elegí la cuenta de la que sale la devolución al comprador'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  elsif v_check.status = 'en_cartera' then
    v_account_id := v_check.cartera_account_id;
  end if;

  if v_account_id is not null then
    v_accrual := date_trunc('month', p_event_date)::date;
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, rejected_check_id, created_by
    ) values (
      v_account_id, v_channel, 'expense',
      v_check.amount, v_check.currency, p_event_date, v_accrual,
      'Cheque rechazado ' || v_check.check_number, p_check_id, auth.uid()
    )
    returning id into v_tx_id;
  end if;

  -- The movement goes first: the status triggers (the endorsed-check
  -- rejection entry) read its date.
  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, transaction_id, notes, created_by
  ) values (
    p_check_id, 'rejected', p_event_date, v_account_id, v_tx_id,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into v_movement_id;

  update public.checks
     set status = 'rechazado',
         channel_id = v_channel
   where id = p_check_id;

  return v_movement_id;
end;
$$;

revoke all on function public.reject_check(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.reject_check(uuid, uuid, date, text, text) to authenticated, service_role;
