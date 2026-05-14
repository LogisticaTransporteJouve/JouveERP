-- K.3.c — Permitir pagar OPs con cheques (endosar de cartera o emitir propio).
--
-- Antes: cada payment_line era account_id + amount. Ahora una línea puede ser:
--   * 'account' (default, comportamiento histórico)
--   * 'endorse_check' — endosa un cheque de cartera (status='en_cartera').
--     El RPC marca el cheque como 'endosado', genera check_movement, y la
--     línea usa la cartera_account_id del cheque. El monto es el del cheque.
--   * 'issue_check' — emite un cheque propio (físico o ECHEQ). El RPC inserta
--     un row en issued_checks linkeado a la OP. El monto es el del cheque y
--     la cuenta es la chequera (bank account).
--
-- En ambos casos la transaction de expense se genera igual (el efecto en caja
-- es el mismo: sale plata de la cuenta).
--
-- Editar OPs con cheques linkeados está bloqueado (anular y emitir otra).
-- Al anular: endorsed checks vuelven a en_cartera; issued_checks pasan a
-- 'cancelled'.

set row_security = off;

------------------------------------------------------------------------------
-- 1. Schema: nuevos FKs en payment_order_payment_lines
------------------------------------------------------------------------------
alter table public.payment_order_payment_lines
  add column endorsed_check_id uuid
    references public.checks (id) on delete restrict,
  add column issued_check_id uuid
    references public.issued_checks (id) on delete set null;

alter table public.payment_order_payment_lines
  add constraint payment_order_payment_lines_one_check check (
    not (endorsed_check_id is not null and issued_check_id is not null)
  );

create index payment_order_payment_lines_endorsed_check_idx
  on public.payment_order_payment_lines (endorsed_check_id)
  where endorsed_check_id is not null;

create index payment_order_payment_lines_issued_check_idx
  on public.payment_order_payment_lines (issued_check_id)
  where issued_check_id is not null;

------------------------------------------------------------------------------
-- 2. create_payment_order: soporta line_kind = account | endorse_check | issue_check
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

revoke all on function public.create_payment_order(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb) from public;
grant execute on function public.create_payment_order(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb) to authenticated;

------------------------------------------------------------------------------
-- 3. update_payment_order: bloquea edición si hay cheques linkeados
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
  v_status       text;
  v_channel_id   text;
  v_pos          int;
  v_numero       int;
  v_supplier_id  uuid;
  v_currency     text;
  v_payment_sum  numeric := 0;
  v_alloc_sum    numeric := 0;
  v_line         jsonb;
  v_account_id   uuid;
  v_amount       numeric;
  v_ref          text;
  v_has_checks   boolean;
begin
  select status, channel_id, punto_venta, numero, supplier_id, currency
    into v_status, v_channel_id, v_pos, v_numero, v_supplier_id, v_currency
  from public.payment_orders where id = p_id;

  if v_status is null then
    raise exception 'payment_order % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled payment_order (%)', p_id;
  end if;

  select exists (
    select 1 from public.payment_order_payment_lines
    where payment_order_id = p_id
      and (endorsed_check_id is not null or issued_check_id is not null)
  ) into v_has_checks;

  if v_has_checks then
    raise exception 'No se puede editar una OP con cheques linkeados. Anulá la OP y emití una nueva.';
  end if;

  update public.payment_orders set
    payment_date = p_payment_date,
    total_amount = p_total_amount,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  delete from public.transactions                  where payment_order_id = p_id;
  delete from public.payment_order_payment_lines   where payment_order_id = p_id;
  delete from public.payment_order_allocations     where payment_order_id = p_id;

  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    if coalesce(v_line->>'line_kind', 'account') <> 'account' then
      raise exception 'update_payment_order: agregar cheques en edición no está soportado';
    end if;

    v_account_id := (v_line->>'account_id')::uuid;
    v_amount     := (v_line->>'amount')::numeric;
    v_ref        := v_line->>'reference';

    insert into public.payment_order_payment_lines (
      payment_order_id, account_id, amount, reference
    ) values (p_id, v_account_id, v_amount, v_ref);

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

revoke all on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb) from public;
grant execute on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb) to authenticated;

------------------------------------------------------------------------------
-- 4. Cancel trigger: revertir cheques al anular
------------------------------------------------------------------------------
create or replace function public.handle_payment_order_cancellation()
returns trigger
language plpgsql
as $$
declare
  v_check_id uuid;
begin
  if old.status = 'issued' and new.status = 'canceled' then
    -- Endorsed checks: vuelven a en_cartera y se borra el movimiento de
    -- endoso (queda como si nunca hubiera salido).
    for v_check_id in
      select endorsed_check_id
      from public.payment_order_payment_lines
      where payment_order_id = new.id
        and endorsed_check_id is not null
    loop
      update public.checks set status = 'en_cartera' where id = v_check_id;
      delete from public.check_movements
       where check_id = v_check_id and event = 'endorsed';
    end loop;

    -- Issued checks: si seguían 'emitted' pasan a 'cancelled'. Los que ya
    -- fueron cobrados/rechazados quedan donde están (estado real de mundo).
    update public.issued_checks
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = auth.uid()
     where payment_order_id = new.id
       and status = 'emitted';

    -- Wipe transactions (igual que antes).
    delete from public.transactions where payment_order_id = new.id;
  end if;
  return new;
end;
$$;

set row_security = on;
