SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W1 · S2 F1: cancelling or editing a payment order put a bounced
-- endorsed check back in cartera. Both handlers flipped every endorsed check
-- of the order to 'en_cartera' with no status filter, so a check the bank
-- rejected after the endorsement (status 'rechazado', its debt already back
-- on the client and its rejection entry posted) came back as spendable.
--
--   1. guard_payment_order_cancel_cashed_check (same trigger): also refuses
--      the cancel while an endorsed check of the order is no longer
--      'endosado', reading the checks under a row lock so a concurrent
--      reject_check cannot slip between the read and the reset. Both raises
--      carry hint jouve_guard.
--   2. handle_payment_order_cancellation: only a check still 'endosado' goes
--      back to cartera and loses its endorsement row.
--   3. update_payment_order (same signature): refuses the edit in the same
--      case, and its cleanup restores only checks still 'endosado'.
--
-- Rollback: older code calls the same functions with the same arguments.

create or replace function public.guard_payment_order_cancel_cashed_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'issued' and new.status = 'canceled' then
    if exists (
      select 1 from public.issued_checks ic
       where ic.payment_order_id = old.id
         and ic.status in ('cashed', 'rejected')
    ) then
      raise exception
        'No se puede anular la orden de pago: tiene un cheque emitido ya cobrado o rechazado. Gestioná el cheque primero.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    -- Locked first: reject_check locks the check too, so a bounce registered
    -- while the order is cancelled either lands before this read or waits
    -- for the cancel (and then finds the check back in cartera).
    perform 1
       from public.payment_order_payment_lines pl
       join public.checks c on c.id = pl.endorsed_check_id
      where pl.payment_order_id = old.id
        for update of c;
    if exists (
      select 1
        from public.payment_order_payment_lines pl
        join public.checks c on c.id = pl.endorsed_check_id
       where pl.payment_order_id = old.id
         and c.status <> 'endosado'
    ) then
      raise exception
        'No se puede anular la orden de pago: un cheque de terceros que endosó fue rechazado. Gestioná el rechazo con el proveedor primero.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_payment_order_cancel_cashed_check() from public, anon, authenticated;

-- Same as 20261031193400 except that only a check still 'endosado' goes back.
create or replace function public.handle_payment_order_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_id uuid;
begin
  if old.status = 'issued' and new.status = 'canceled' then
    -- Endorsed checks go back to en_cartera and lose their endorsement. A
    -- check that left the endorsement (rejected) keeps its status and history.
    for v_check_id in
      select pl.endorsed_check_id
        from public.payment_order_payment_lines pl
        join public.checks c on c.id = pl.endorsed_check_id
       where pl.payment_order_id = new.id
         and c.status = 'endosado'
    loop
      update public.checks set status = 'en_cartera'
       where id = v_check_id and status = 'endosado';
      delete from public.check_movements
       where check_id = v_check_id and event = 'endorsed';
    end loop;

    -- Own checks still 'emitted' are cancelled; cashed or rejected ones stay.
    update public.issued_checks
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = auth.uid()
     where payment_order_id = new.id
       and status = 'emitted';

    delete from public.transactions where payment_order_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_payment_order_cancellation() from public, anon, authenticated;

-- Same as 20261031203102 plus the endorsed-check status: an edit is refused
-- while an endorsed check was rejected, and only 'endosado' checks are reset.
create or replace function public.update_payment_order(p_id uuid, p_payment_date date, p_total_amount numeric, p_notes text, p_payment_lines jsonb, p_allocations jsonb, p_cotizacion numeric default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status            text;
  v_channel_id        text;
  v_pos               int;
  v_numero            int;
  v_supplier_id       uuid;
  v_currency          text;
  v_payment_sum       numeric := 0;
  v_alloc_sum         numeric := 0;
  v_line              jsonb;
  v_account_id        uuid;
  v_amount            numeric;
  v_ref               text;
  v_line_kind         text;
  v_check             public.checks%rowtype;
  v_check_id          uuid;
  v_issued_check_id   uuid;
  v_issued_data       jsonb;
  v_blocking_count    int;
  v_old_check_id      uuid;
  v_old_issued_id     uuid;
begin
  -- Role guard (payment_orders:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar órdenes de pago'
      using errcode = '42501';
  end if;

  select status, channel_id, punto_venta, numero, supplier_id, currency
    into v_status, v_channel_id, v_pos, v_numero, v_supplier_id, v_currency
  from public.payment_orders where id = p_id
   for update;

  if v_status is null then
    raise exception 'payment_order % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled payment_order (%)', p_id;
  end if;

  -- Si hay issued_checks linkeados ya cobrados/rechazados, no podemos
  -- reescribir historia: bloqueamos el edit.
  select count(*) into v_blocking_count
    from public.payment_order_payment_lines pl
    join public.issued_checks ic on ic.id = pl.issued_check_id
    where pl.payment_order_id = p_id
      and ic.status in ('cashed', 'rejected');
  if v_blocking_count > 0 then
    raise exception 'No se puede editar la OP: hay cheques propios ya cobrados o rechazados. Anulá la OP en su lugar.';
  end if;

  -- Same for an endorsed check the bank rejected after the endorsement: its
  -- debt is back on the client and it must not return to cartera. Locked
  -- first, as in guard_payment_order_cancel_cashed_check.
  perform 1
     from public.payment_order_payment_lines pl
     join public.checks c on c.id = pl.endorsed_check_id
    where pl.payment_order_id = p_id
      for update of c;
  if exists (
    select 1
      from public.payment_order_payment_lines pl
      join public.checks c on c.id = pl.endorsed_check_id
     where pl.payment_order_id = p_id
       and c.status <> 'endosado'
  ) then
    raise exception 'No se puede editar la OP: un cheque de terceros que endosó fue rechazado. Gestioná el rechazo con el proveedor primero.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- Cleanup de cheques de la versión anterior antes de borrar las líneas.
  -- Endorsed: vuelven a en_cartera + se borra la fila 'endorsed' del
  -- historial. Si se vuelve a endosar el mismo cheque más abajo, el RPC
  -- inserta una nueva fila 'endorsed' fresh.
  for v_old_check_id in
    select pl.endorsed_check_id
      from public.payment_order_payment_lines pl
      join public.checks c on c.id = pl.endorsed_check_id
     where pl.payment_order_id = p_id
       and c.status = 'endosado'
  loop
    update public.checks set status = 'en_cartera'
     where id = v_old_check_id and status = 'endosado';
    delete from public.check_movements
     where check_id = v_old_check_id and event = 'endorsed';
  end loop;

  -- Issued checks emitted: hard delete. Los creó esta OP, son safe to
  -- delete. Si el form reenvía el mismo cheque con otros datos, se
  -- inserta uno nuevo más abajo.
  for v_old_issued_id in
    select issued_check_id
    from public.payment_order_payment_lines
    where payment_order_id = p_id
      and issued_check_id is not null
  loop
    delete from public.issued_checks
      where id = v_old_issued_id and status = 'emitted';
  end loop;

  -- An edit that sends no rate keeps the stored one.
  update public.payment_orders set
    payment_date = p_payment_date,
    total_amount = p_total_amount,
    cotizacion   = case when v_currency = 'USD' then coalesce(p_cotizacion, cotizacion) end,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  -- Wipe lo viejo. Las issued_checks no-emitidas que sobrevivieron al
  -- delete de arriba ya están desligadas (FK on delete set null).
  delete from public.transactions                  where payment_order_id = p_id;
  delete from public.payment_order_payment_lines   where payment_order_id = p_id;
  delete from public.payment_order_allocations     where payment_order_id = p_id;

  -- Reaplicar líneas (mismo flow que create_payment_order).
  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    v_line_kind := coalesce(v_line->>'line_kind', 'account');
    v_ref       := v_line->>'reference';
    v_issued_check_id := null;
    v_check_id  := null;

    if v_line_kind = 'endorse_check' then
      v_check_id := (v_line->>'endorsed_check_id')::uuid;
      select * into v_check from public.checks where id = v_check_id for update;
      if v_check.id is null then
        raise exception 'endorse_check: cheque % no encontrado', v_check_id;
      end if;
      if v_check.status <> 'en_cartera' then
        raise exception 'endorse_check: cheque % está en estado %, no en_cartera',
          v_check_id, v_check.status;
      end if;
      if v_check.currency <> v_currency then
        raise exception 'endorse_check: moneda del cheque (%) no coincide con OP (%)',
          v_check.currency, v_currency;
      end if;

      v_account_id := v_check.cartera_account_id;
      v_amount := v_check.amount;

      update public.checks set status = 'endosado' where id = v_check_id;

      insert into public.check_movements (
        check_id, event, event_date, endorsed_to_name, endorsed_to_cuit,
        notes, created_by
      ) values (
        v_check_id, 'endorsed', p_payment_date,
        coalesce(
          (select legal_name from public.suppliers where id = v_supplier_id),
          'OP'),
        (select cuit from public.suppliers where id = v_supplier_id),
        'OP ' || lpad(v_pos::text, 4, '0') || '-' || lpad(v_numero::text, 8, '0'),
        auth.uid()
      );

    elsif v_line_kind = 'issue_check' then
      v_account_id := (v_line->>'account_id')::uuid;
      v_amount     := (v_line->>'amount')::numeric;
      v_issued_data := v_line->'issued_check';
      if v_issued_data is null then
        raise exception 'issue_check: falta objeto issued_check en la línea';
      end if;

      insert into public.issued_checks (
        kind, check_number, bank_name, beneficiary_name, beneficiary_cuit,
        issue_date, due_date, amount, currency, bank_account_id,
        payment_order_id, supplier_id, notes, created_by
      ) values (
        v_issued_data->>'kind',
        v_issued_data->>'check_number',
        v_issued_data->>'bank_name',
        coalesce(v_issued_data->>'beneficiary_name',
          (select legal_name from public.suppliers where id = v_supplier_id)),
        coalesce(v_issued_data->>'beneficiary_cuit',
          (select cuit from public.suppliers where id = v_supplier_id)),
        coalesce((v_issued_data->>'issue_date')::date, p_payment_date),
        (v_issued_data->>'due_date')::date,
        v_amount,
        v_currency,
        v_account_id,
        p_id,
        v_supplier_id,
        nullif(trim(v_issued_data->>'notes'), ''),
        auth.uid()
      )
      returning id into v_issued_check_id;

    else
      v_account_id := (v_line->>'account_id')::uuid;
      v_amount     := (v_line->>'amount')::numeric;
    end if;

    insert into public.payment_order_payment_lines (
      payment_order_id, account_id, amount, reference,
      endorsed_check_id, issued_check_id
    ) values (
      p_id, v_account_id, v_amount, v_ref,
      v_check_id, v_issued_check_id
    );

    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, counterparty_supplier_id,
      payment_order_id, created_by
    ) values (
      v_account_id, v_channel_id, 'expense', v_amount, v_currency,
      p_payment_date, date_trunc('month', p_payment_date)::date,
      coalesce(v_ref, 'OP ' || lpad(v_pos::text, 4, '0') || '-' || lpad(v_numero::text, 8, '0')),
      v_supplier_id, p_id, auth.uid()
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

revoke all on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb, numeric) to authenticated, service_role;
