-- F.1 — Recibo → Caja: auto-genera transactions desde payment_lines.
--
-- Cuando se emite un recibo, cada línea de pago debería materializarse como
-- una transaction de income en su account_id correspondiente, así el saldo
-- de Caja refleja la realidad sin doble carga manual. Las retenciones NO
-- generan transactions: son crédito fiscal, no plata real.
--
-- Diseño:
--   1. Nueva columna `transactions.receipt_id` (FK opcional). Permite
--      reconstruir qué transactions pertenecen a qué recibo y limpiar
--      cuando el recibo se anula.
--   2. Los RPCs `create_receipt` / `update_receipt` se extienden para
--      insertar/borrar las transactions atómicamente con los hijos del
--      recibo. Update funciona con el patrón "delete + re-insert".
--   3. Un trigger AFTER UPDATE en `receipts` borra las transactions ligadas
--      cuando el recibo pasa a `canceled`. Así la cancelación desde la
--      action sigue siendo un simple UPDATE sin tener que envolverla en un
--      RPC.

set row_security = off;

------------------------------------------------------------------------------
-- 1. transactions.receipt_id
------------------------------------------------------------------------------
alter table public.transactions
  add column receipt_id uuid references public.receipts (id) on delete set null;

create index transactions_receipt_idx on public.transactions (receipt_id)
  where receipt_id is not null;

comment on column public.transactions.receipt_id is
  'Recibo del que se generó esta transaction (cuando aplica). NULL para movimientos creados manualmente desde Caja.';

------------------------------------------------------------------------------
-- 2. Trigger: receipt cancelado → wipe transactions ligadas
------------------------------------------------------------------------------
create or replace function public.handle_receipt_cancellation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'issued' and new.status = 'canceled' then
    delete from public.transactions where receipt_id = new.id;
  end if;
  return new;
end;
$$;

create trigger receipts_on_cancel_clean_transactions
  after update of status on public.receipts
  for each row execute function public.handle_receipt_cancellation();

------------------------------------------------------------------------------
-- 3. Replace create_receipt / update_receipt RPCs to insert transactions
------------------------------------------------------------------------------
drop function if exists public.create_receipt(
  text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb
);

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
begin
  insert into public.receipts (
    channel_id, punto_venta, numero, client_id, recibo_date,
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
    );
    v_payment_sum := v_payment_sum + (v_line->>'amount')::numeric;

    -- Auto-create the matching income transaction so Caja reflects the
    -- money inflow. counterparty_client_id ties it back to the client.
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
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (
      receipt_id, comprobante_id, amount_applied
    ) values (
      v_receipt_id,
      (v_line->>'comprobante_id')::uuid,
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

revoke all on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_receipt(text, int, int, uuid, date, numeric, text, text, jsonb, jsonb, jsonb) to authenticated;

drop function if exists public.update_receipt(
  uuid, date, numeric, text, jsonb, jsonb, jsonb
);

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
begin
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
    recibo_date  = p_recibo_date,
    total_amount = p_total_amount,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  -- Wipe everything we own and rebuild from the payload. Transactions
  -- linked to this receipt are also deleted so we can re-insert with the
  -- new amounts/accounts.
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
    );
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
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.receipt_allocations (
      receipt_id, comprobante_id, amount_applied
    ) values (
      p_id,
      (v_line->>'comprobante_id')::uuid,
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

revoke all on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.update_receipt(uuid, date, numeric, text, jsonb, jsonb, jsonb) to authenticated;

set row_security = on;
