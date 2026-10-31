SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Money RPCs (audit 2026-10-31, compras F1 pattern, S10 and minors).
--
--   * update_receipt / update_payment_order become SECURITY DEFINER with
--     search_path = ''. As invokers, the owner-only DELETE policy on
--     transactions and check_movements silently kept the old cash movements
--     when finance edited a receipt or OP, and the new ones were added on top.
--     Their role guard stays (the writers of the matrix), and they lock the
--     header row so two edits of one document serialize.
--   * create_payment_order / update_payment_order lock an endorsed check
--     FOR UPDATE before checking it is en_cartera: two OPs can't endorse it.
--   * pay_loan_installment: one transaction claims the pending installment
--     (FOR UPDATE), books the outflow and closes the loan when it was the last.

create or replace function public.update_receipt(p_id uuid, p_recibo_date date, p_total_amount numeric, p_notes text, p_payment_lines jsonb, p_allocations jsonb, p_retentions jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status        text;
  v_channel_id    text;
  v_currency      text;
  v_client_id     uuid;
  v_punto_venta   int;
  v_numero        int;
  v_payment_sum   numeric := 0;
  v_alloc_sum     numeric := 0;
  v_retention_sum numeric := 0;
  v_accrual_month date;
  v_description   text;
  v_line          jsonb;
  v_line_id       uuid;
  v_account_type  text;
  v_check        jsonb;
  v_check_id     uuid;
begin
  -- Role guard (receipts:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar recibos'
      using errcode = '42501';
  end if;

  select status, channel_id, currency, client_id, punto_venta, numero
    into v_status, v_channel_id, v_currency, v_client_id, v_punto_venta, v_numero
    from public.receipts where id = p_id
     for update;
  if v_status is null then
    raise exception 'receipt % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled receipt (%)', p_id;
  end if;

  update public.receipts set
    receipt_date  = p_recibo_date,
    total_amount = p_total_amount,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  -- Cascade-rebuild. Cheques con status <> en_cartera abortan el delete y
  -- forman un mensaje claro al usuario (ver guard_check_delete_in_lifecycle).
  delete from public.receipt_payment_lines where receipt_id = p_id;
  delete from public.receipt_allocations    where receipt_id = p_id;
  delete from public.receipt_retentions     where receipt_id = p_id;
  delete from public.transactions           where receipt_id = p_id;

  v_accrual_month := date_trunc('month', p_recibo_date)::date;
  v_description := 'Recibo R'
    || lpad(v_punto_venta::text, 4, '0')
    || '-' || lpad(v_numero::text, 8, '0');

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      p_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    )
    returning id into v_line_id;

    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;

    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, counterparty_client_id, receipt_id, created_by
    ) values (
      (v_line->>'account_id')::uuid,
      v_channel_id,
      'income',
      (v_line->>'amount')::numeric,
      v_currency,
      p_recibo_date,
      v_accrual_month,
      v_description,
      v_client_id,
      p_id,
      auth.uid()
    );

    select type into v_account_type
      from public.accounts where id = (v_line->>'account_id')::uuid;
    v_check := v_line->'check';
    if v_account_type in ('checks', 'echeq') and v_check is not null
       and jsonb_typeof(v_check) = 'object' then
      insert into public.checks (
        kind, check_number, bank_name, drawer_name, drawer_cuit,
        issue_date, due_date, amount, currency,
        cartera_account_id, source_kind, source_receipt_id,
        source_payment_line_id, source_client_id, notes, created_by
      ) values (
        case when v_account_type = 'echeq' then 'echeq' else 'fisico' end,
        coalesce(nullif(trim(v_check->>'check_number'), ''),
                 v_line->>'reference'),
        v_check->>'bank_name',
        v_check->>'drawer_name',
        nullif(trim(v_check->>'drawer_cuit'), ''),
        coalesce((v_check->>'issue_date')::date, p_recibo_date),
        (v_check->>'due_date')::date,
        (v_line->>'amount')::numeric,
        v_currency,
        (v_line->>'account_id')::uuid,
        'receipt',
        p_id,
        v_line_id,
        v_client_id,
        nullif(trim(v_check->>'notes'), ''),
        auth.uid()
      )
      returning id into v_check_id;

      insert into public.check_movements (
        check_id, event, event_date, notes, created_by
      ) values (
        v_check_id, 'received', p_recibo_date, null, auth.uid()
      );
    end if;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (
      receipt_id, invoice_id, amount_applied
    ) values (
      p_id,
      (v_line->>'invoice_id')::uuid,
      (v_line->>'amount_applied')::numeric
    );
    v_alloc_sum := v_alloc_sum + (v_line->>'amount_applied')::numeric;
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_retentions, '[]'::jsonb))
  loop
    insert into public.receipt_retentions (
      receipt_id, kind, tax_type, jurisdiction, certificate_number,
      certificate_date, amount, notes
    ) values (
      p_id,
      v_line->>'kind',
      v_line->>'tax_type',
      nullif(trim(v_line->>'jurisdiction'), ''),
      v_line->>'certificate_number',
      (v_line->>'certificate_date')::date,
      (v_line->>'amount')::numeric,
      nullif(trim(v_line->>'notes'), '')
    );
    v_retention_sum := v_retention_sum + (v_line->>'amount')::numeric;
  end loop;

  if round(v_payment_sum + v_retention_sum, 2) <> round(p_total_amount, 2) then
    raise exception 'payment_lines + retentions sum (%) does not match total_amount (%)',
      v_payment_sum + v_retention_sum, p_total_amount;
  end if;

  if round(v_alloc_sum, 2) > round(p_total_amount, 2) then
    raise exception 'allocations sum (%) exceeds total_amount (%)',
      v_alloc_sum, p_total_amount;
  end if;
end;
$$;

revoke all on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb) to authenticated, service_role;

create or replace function public.update_payment_order(p_id uuid, p_payment_date date, p_total_amount numeric, p_notes text, p_payment_lines jsonb, p_allocations jsonb)
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

  -- Cleanup de cheques de la versión anterior antes de borrar las líneas.
  -- Endorsed: vuelven a en_cartera + se borra la fila 'endorsed' del
  -- historial. Si se vuelve a endosar el mismo cheque más abajo, el RPC
  -- inserta una nueva fila 'endorsed' fresh.
  for v_old_check_id in
    select endorsed_check_id
    from public.payment_order_payment_lines
    where payment_order_id = p_id
      and endorsed_check_id is not null
  loop
    update public.checks set status = 'en_cartera' where id = v_old_check_id;
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

  update public.payment_orders set
    payment_date = p_payment_date,
    total_amount = p_total_amount,
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

revoke all on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb) to authenticated, service_role;

create or replace function public.create_payment_order(p_channel_id text, p_punto_venta integer, p_numero integer, p_supplier_id uuid, p_payment_date date, p_total_amount numeric, p_currency text, p_notes text, p_payment_lines jsonb, p_allocations jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_op_id            uuid;
  v_payment_sum      numeric := 0;
  v_alloc_sum        numeric := 0;
  v_line             jsonb;
  v_account_id       uuid;
  v_amount           numeric;
  v_ref              text;
  v_line_kind        text;
  v_check            public.checks%rowtype;
  v_check_id         uuid;
  v_issued_check_id  uuid;
  v_issued_data      jsonb;
begin
  -- Role guard (payment_orders:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para crear órdenes de pago'
      using errcode = '42501';
  end if;

  insert into public.payment_orders (
    channel_id, punto_venta, numero, supplier_id, payment_date,
    total_amount, currency, notes, status, created_by
  ) values (
    p_channel_id, p_punto_venta, p_numero, p_supplier_id, p_payment_date,
    p_total_amount, p_currency, nullif(trim(p_notes), ''), 'issued', auth.uid()
  )
  returning id into v_op_id;

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
      if v_check.currency <> p_currency then
        raise exception 'endorse_check: moneda del cheque (%) no coincide con OP (%)',
          v_check.currency, p_currency;
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
          (select legal_name from public.suppliers where id = p_supplier_id),
          'OP'),
        (select cuit from public.suppliers where id = p_supplier_id),
        'OP ' || lpad(p_punto_venta::text, 4, '0') || '-' || lpad(p_numero::text, 8, '0'),
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
          (select legal_name from public.suppliers where id = p_supplier_id)),
        coalesce(v_issued_data->>'beneficiary_cuit',
          (select cuit from public.suppliers where id = p_supplier_id)),
        coalesce((v_issued_data->>'issue_date')::date, p_payment_date),
        (v_issued_data->>'due_date')::date,
        v_amount,
        p_currency,
        v_account_id,
        v_op_id,
        p_supplier_id,
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
      v_op_id, v_account_id, v_amount, v_ref,
      v_check_id, v_issued_check_id
    );

    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, counterparty_supplier_id,
      payment_order_id, created_by
    ) values (
      v_account_id, p_channel_id, 'expense', v_amount, p_currency,
      p_payment_date, date_trunc('month', p_payment_date)::date,
      coalesce(v_ref, 'OP ' || lpad(p_punto_venta::text, 4, '0') || '-' || lpad(p_numero::text, 8, '0')),
      p_supplier_id, v_op_id, auth.uid()
    );

    v_payment_sum := v_payment_sum + v_amount;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.payment_order_allocations (
      payment_order_id, purchase_invoice_id, amount_applied
    ) values (
      v_op_id,
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

  return v_op_id;
end;
$$;

revoke all on function public.create_payment_order(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_payment_order(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb) to authenticated, service_role;

create or replace function public.pay_loan_installment(
  p_installment_id uuid,
  p_paid_date      date,
  p_account_id     uuid,
  p_amount         numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number       int;
  v_loan_id      uuid;
  v_description  text;
  v_currency     text;
  v_channel_id   text;
  v_count        int;
  v_loan_status  text;
  v_account_type text;
  v_tx_id        uuid;
begin
  -- Role guard (accounting:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar pagos de cuotas'
      using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe pagado tiene que ser mayor a cero'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select li.number, li.loan_id into v_number, v_loan_id
    from public.loan_installments li
   where li.id = p_installment_id
     and li.status = 'pendiente'
     for update;
  if not found then
    raise exception 'La cuota no existe o ya está pagada'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select l.description, l.currency, l.channel_id, l.installments_count, l.status::text
    into v_description, v_currency, v_channel_id, v_count, v_loan_status
    from public.loans l
   where l.id = v_loan_id
     for update;
  if v_loan_status = 'cancelled' then
    raise exception 'El préstamo está anulado: no se pueden pagar sus cuotas'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select a.type into v_account_type from public.accounts a where a.id = p_account_id;
  if not found then
    raise exception 'La cuenta de pago no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_account_type in ('checks', 'echeq') then
    raise exception 'Los movimientos en cuentas de cheques se manejan desde Cheques (cargar, depositar, endosar)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, created_by
  ) values (
    p_account_id, v_channel_id, 'expense', p_amount, v_currency, p_paid_date,
    date_trunc('month', p_paid_date)::date,
    'Cuota ' || v_number || '/' || v_count || ' — ' || v_description,
    auth.uid()
  )
  returning id into v_tx_id;

  update public.loan_installments
     set status = 'pagada',
         paid_date = p_paid_date,
         paid_amount = p_amount,
         transaction_id = v_tx_id
   where id = p_installment_id;

  if not exists (
    select 1 from public.loan_installments
     where loan_id = v_loan_id and status = 'pendiente'
  ) then
    update public.loans set status = 'paid' where id = v_loan_id;
  end if;

  return v_tx_id;
end;
$$;

revoke all on function public.pay_loan_installment(uuid, date, uuid, numeric) from public, anon, authenticated;
grant execute on function public.pay_loan_installment(uuid, date, uuid, numeric) to authenticated, service_role;
