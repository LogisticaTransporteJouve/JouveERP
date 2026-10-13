-- Role guards on the money RPCs.
--
-- These RPCs are exposed through PostgREST (/rest/v1/rpc/*) and were granted
-- to every authenticated user (and, through Supabase's default privileges, to
-- anon). The callers' server actions check userCan(...), but a direct REST
-- call skips the action. Most are SECURITY INVOKER, so table RLS was the only
-- barrier; replace_purchase_invoice_items is SECURITY DEFINER, bypassed RLS and
-- let any authenticated user rewrite a purchase invoice's items, totals and
-- journal entry.
--
-- Each function below is recreated from its LATEST definition with the body
-- unchanged except for a role guard at the top of the body, modelled on
-- create_journal_entry / grant_vacation_balances
-- (20260704140000_audit_t1a_security_lockdown.sql):
--   * the service role (seed script, any server-side job) passes;
--   * any other caller must hold a role that lib/auth/permissions.ts grants the
--     matching write permission (receipts:write, payment_orders:write,
--     cheques:write, transactions:write, purchase_invoices:write — all held by
--     owner, admin and finance), otherwise SQLSTATE 42501.
-- Signatures, SECURITY mode and SET search_path are unchanged, so
-- CREATE OR REPLACE keeps the same objects (no new overloads). EXECUTE is
-- revoked from public/anon/authenticated by name and granted back to
-- authenticated (the server actions call these with the user-scoped client)
-- and service_role.

------------------------------------------------------------------------------
-- create_receipt — body copied verbatim from 20260510204115_receipt_check_autocreate.sql, plus the guard.
------------------------------------------------------------------------------

create or replace function public.create_receipt(
  p_channel_id    text,
  p_punto_venta   int,
  p_numero        int,
  p_client_id     uuid,
  p_recibo_date   date,
  p_total_amount  numeric,
  p_currency      text,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb,
  p_retentions    jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_receipt_id    uuid;
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
    raise exception 'No autorizado para crear recibos'
      using errcode = '42501';
  end if;

  insert into public.receipts (
    channel_id, punto_venta, numero, client_id, receipt_date,
    total_amount, currency, notes, status, created_by
  ) values (
    p_channel_id, p_punto_venta, p_numero, p_client_id, p_recibo_date,
    p_total_amount, p_currency, nullif(trim(p_notes), ''), 'issued', auth.uid()
  )
  returning id into v_receipt_id;

  v_accrual_month := date_trunc('month', p_recibo_date)::date;
  v_description := 'Recibo R'
    || lpad(p_punto_venta::text, 4, '0')
    || '-' || lpad(p_numero::text, 8, '0');

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    insert into public.receipt_payment_lines (
      receipt_id, account_id, amount, reference
    ) values (
      v_receipt_id,
      (v_line->>'account_id')::uuid,
      (v_line->>'amount')::numeric,
      v_line->>'reference'
    )
    returning id into v_line_id;

    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;

    -- Income transaction in the destination account.
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, counterparty_client_id, receipt_id, created_by
    ) values (
      (v_line->>'account_id')::uuid,
      p_channel_id,
      'income',
      (v_line->>'amount')::numeric,
      p_currency,
      p_recibo_date,
      v_accrual_month,
      v_description,
      p_client_id,
      v_receipt_id,
      auth.uid()
    );

    -- Auto-create check when applicable: account.type ∈ {checks, echeq}
    -- and the payload includes check metadata.
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
        p_currency,
        (v_line->>'account_id')::uuid,
        'receipt',
        v_receipt_id,
        v_line_id,
        p_client_id,
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
      v_receipt_id,
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
      v_receipt_id,
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

  return v_receipt_id;
end;
$$;

revoke all on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb) to authenticated, service_role;

------------------------------------------------------------------------------
-- update_receipt — body copied verbatim from 20260705090100_fix_update_receipt_check_currency.sql, plus the guard.
------------------------------------------------------------------------------

create or replace function public.update_receipt(
  p_id            uuid,
  p_recibo_date   date,
  p_total_amount  numeric,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb,
  p_retentions    jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
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
    from public.receipts where id = p_id;
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

------------------------------------------------------------------------------
-- create_payment_order — body copied verbatim from 20260514215801_payment_orders_with_checks.sql, plus the guard.
------------------------------------------------------------------------------

create or replace function public.create_payment_order(
  p_channel_id    text,
  p_punto_venta   int,
  p_numero        int,
  p_supplier_id   uuid,
  p_payment_date  date,
  p_total_amount  numeric,
  p_currency      text,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
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
      select * into v_check from public.checks where id = v_check_id;
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

------------------------------------------------------------------------------
-- update_payment_order — body copied verbatim from 20260516102448_payment_orders_edit_with_checks.sql, plus the guard.
------------------------------------------------------------------------------

create or replace function public.update_payment_order(
  p_id            uuid,
  p_payment_date  date,
  p_total_amount  numeric,
  p_notes         text,
  p_payment_lines jsonb,
  p_allocations   jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
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
  from public.payment_orders where id = p_id;

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
      select * into v_check from public.checks where id = v_check_id;
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

------------------------------------------------------------------------------
-- deposit_check — body copied verbatim from 20260704210000_audit_t4_check_row_locks.sql, plus the guard.
------------------------------------------------------------------------------

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

revoke all on function public.deposit_check(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.deposit_check(uuid, uuid, date, text, text) to authenticated, service_role;

------------------------------------------------------------------------------
-- credit_check — body copied verbatim from 20260704210000_audit_t4_check_row_locks.sql, plus the guard.
------------------------------------------------------------------------------

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
  -- Role guard (cheques:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para acreditar cheques'
      using errcode = '42501';
  end if;

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

revoke all on function public.credit_check(uuid, date, text) from public, anon, authenticated;
grant execute on function public.credit_check(uuid, date, text) to authenticated, service_role;

------------------------------------------------------------------------------
-- reject_check — body copied verbatim from 20260704210000_audit_t4_check_row_locks.sql, plus the guard.
------------------------------------------------------------------------------

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

revoke all on function public.reject_check(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.reject_check(uuid, uuid, date, text, text) to authenticated, service_role;

------------------------------------------------------------------------------
-- create_transfer — body copied verbatim from 20260510154418_transactions.sql, plus the guard.
------------------------------------------------------------------------------

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

revoke all on function public.create_transfer(uuid, uuid, text, numeric, text, date, date, text) from public, anon, authenticated;
grant execute on function public.create_transfer(uuid, uuid, text, numeric, text, date, date, text) to authenticated, service_role;

------------------------------------------------------------------------------
-- replace_purchase_invoice_items — body copied verbatim from 20260704200000_audit_t3_purchase_items_trigger_fix.sql, plus the guard.
------------------------------------------------------------------------------

create or replace function public.replace_purchase_invoice_items(
  p_invoice_id uuid,
  p_items      jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item        jsonb;
  v_count       int;
  v_sum_neto    numeric(15, 2);
  v_sum_iva     numeric(15, 2);
  v_sum_total   numeric(15, 2);
  v_pi          public.purchase_invoices;
begin
  -- Role guard (purchase_invoices:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar ítems de facturas de compra'
      using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a jsonb array';
  end if;

  delete from public.purchase_invoice_items
   where purchase_invoice_id = p_invoice_id;

  v_count := jsonb_array_length(p_items);

  if v_count = 0 then
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.purchase_invoice_items (
      purchase_invoice_id, sort_order, description,
      quantity, unit_price, iva_rate_id,
      line_neto, line_iva, line_total
    ) values (
      p_invoice_id,
      coalesce((v_item ->> 'sort_order')::int, 0),
      v_item ->> 'description',
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_price')::numeric,
      nullif(v_item ->> 'iva_rate_id', '')::int,
      (v_item ->> 'line_neto')::numeric,
      coalesce((v_item ->> 'line_iva')::numeric, 0),
      (v_item ->> 'line_total')::numeric
    );
  end loop;

  -- Recalc header totals from items. imp_trib (header-level) preserved.
  select
    coalesce(sum(line_neto),  0),
    coalesce(sum(line_iva),   0),
    coalesce(sum(line_total), 0)
    into v_sum_neto, v_sum_iva, v_sum_total
  from public.purchase_invoice_items
  where purchase_invoice_id = p_invoice_id;

  update public.purchase_invoices
     set imp_neto  = v_sum_neto,
         imp_iva   = v_sum_iva,
         imp_total = v_sum_total + coalesce(imp_trib, 0),
         updated_at = now()
   where id = p_invoice_id;

  -- Regenerate the journal from the final totals (replaces the broken
  -- statement-level trigger). Only received (posted) invoices carry an entry.
  select * into v_pi from public.purchase_invoices where id = p_invoice_id;
  if v_pi.id is not null and v_pi.status = 'received' then
    delete from public.journal_entries
     where source_table = 'purchase_invoices'
       and source_id    = p_invoice_id
       and is_reversal   = false;
    perform public.emit_journal_for_purchase_invoice(v_pi, false);
  end if;
end;
$$;

revoke all on function public.replace_purchase_invoice_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_purchase_invoice_items(uuid, jsonb) to authenticated, service_role;
